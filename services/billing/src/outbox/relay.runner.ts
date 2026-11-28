import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BrokerConnection,
  ConfirmingPublisher,
  OutboxRelay,
  assertTopology,
} from '@carwash/platform-messaging';
import { createLogger, serviceTelemetry } from '@carwash/service-kit';
import { PrismaService, databaseUrlFromEnv } from '../infrastructure/persistence/prisma.service';
import { billingCustodyProducerTopology, validateCustodyOutbox } from './custody-events';
import { PrismaCustodyOutboxStore } from './prisma-outbox.store';
import { OBLIGATION_EVENT_TYPES, validateObligationOutbox } from './obligation-events';

function numberArg(name: string, fallback: number, maximum: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`INVALID_ARG_${name}`);
  return value;
}

/** Separate from the API process: only Billing's runtime DB and broker identities. */
async function main(): Promise<void> {
  const familyIndex = process.argv.indexOf('--family');
  const family = familyIndex < 0 ? 'custody' : process.argv[familyIndex + 1];
  if (family !== 'custody' && family !== 'obligations') throw new Error('INVALID_RELAY_FAMILY');
  const brokerUrl = process.env.BROKER_URL;
  if (!brokerUrl) throw new Error('BROKER_URL_REQUIRED');
  const prisma = new PrismaService(databaseUrlFromEnv());
  const telemetry = serviceTelemetry('billing');
  const logger = createLogger({
    service: 'billing',
    level: 'info',
    base: { component: family === 'custody' ? 'cash-relay' : 'obligation-relay' },
  });
  const emit = (event: string, fields: Record<string, unknown> = {}): void => {
    logger.info('worker_event', { event, ...fields });
  };
  const workerId = `billing-${family}-${randomUUID()}`;
  const once = process.argv.includes('--once');
  // Twenty bounded five-second publishes still fit within the default lease.
  const leaseMs = numberArg('lease-ms', 120_000, 300_000);
  const intervalMs = numberArg('interval-ms', 250, 60_000);
  const maxAttempts = numberArg('max-attempts', 10, 100);
  const batchSize = numberArg('batch-size', 20, 500);
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  let connection: BrokerConnection | undefined;
  let publisher: ConfirmingPublisher | undefined;
  let backoff = 200;
  try {
    while (!controller.signal.aborted) {
      try {
        if (!connection) {
          const opened = await BrokerConnection.open({
            url: brokerUrl,
            connectionName: workerId,
            logger,
          });
          connection = opened;
          opened.onClose(() => {
            if (connection === opened) {
              connection = undefined;
              publisher = undefined;
            }
          });
          await assertTopology(opened.channel, billingCustodyProducerTopology);
          publisher = new ConfirmingPublisher(opened.channel, logger, 5_000, telemetry);
          emit('relay_connected');
        }
        const current = connection;
        if (!current || !publisher) continue;
        const relay = new OutboxRelay({
          workerId,
          store: new PrismaCustodyOutboxStore(
            prisma,
            family === 'obligations' ? OBLIGATION_EVENT_TYPES : undefined,
          ),
          publisher,
          logger,
          telemetry,
          validate: family === 'obligations' ? validateObligationOutbox : validateCustodyOutbox,
          leaseMs,
          batchSize,
          maxAttempts,
          onLeased: (records) => {
            if (!records.length) return;
            emit('relay_leased', { count: records.length });
          },
        });
        const result = await relay.runOnce(controller.signal);
        emit('relay_pass', { ...result });
        if (once) {
          if (result.failed || result.leaseLost) throw new Error('RELAY_PASS_INCOMPLETE');
          return;
        }
        if (result.failed || result.leaseLost) {
          await delay(backoff, undefined, { signal: controller.signal });
          backoff = Math.min(backoff * 2, 5_000);
        } else {
          backoff = 200;
          await delay(intervalMs, undefined, { signal: controller.signal });
        }
      } catch (error: unknown) {
        await connection?.close();
        connection = undefined;
        publisher = undefined;
        if (controller.signal.aborted) break;
        emit('relay_unavailable', {
          reason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        });
        if (once) throw new Error('RELAY_ONCE_FAILED', { cause: error });
        await delay(backoff, undefined, { signal: controller.signal }).catch(() => {});
        backoff = Math.min(backoff * 2, 5_000);
      }
    }
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await connection?.close();
    await prisma.onModuleDestroy();
    await telemetry.shutdown();
  }
}

void main().catch(() => {
  createLogger({ service: 'billing' }).error('billing_relay_failed');
  process.exitCode = 1;
});
