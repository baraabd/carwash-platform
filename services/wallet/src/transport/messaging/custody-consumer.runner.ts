import 'reflect-metadata';
import { setTimeout as delay } from 'node:timers/promises';
import { BrokerConnection, assertTopology } from '@carwash/platform-messaging';
import { createLogger, serviceTelemetry } from '@carwash/service-kit';
import { CustodyProjector } from '../../application';
import { PrismaService, databaseUrlFromEnv } from '../../infrastructure/persistence/prisma.service';
import { PrismaWalletRepository } from '../../infrastructure/persistence/prisma-wallet.repository';
import { RandomIds, SystemClock } from '../../infrastructure/system/system.adapters';
import { CustodyBrokerConsumer } from './custody-broker.consumer';
import { walletCustodyTopology } from './custody-topology';

async function closedOrAborted(connection: BrokerConnection, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      signal.removeEventListener('abort', done);
      resolve();
    };
    signal.addEventListener('abort', done, { once: true });
    connection.onClose(done);
  });
}

/** Standalone subscriber; every business read/write remains inside Wallet. */
async function main(): Promise<void> {
  const brokerUrl = process.env.BROKER_URL;
  if (!brokerUrl) throw new Error('BROKER_URL_REQUIRED');
  const prisma = new PrismaService(databaseUrlFromEnv());
  const telemetry = serviceTelemetry('wallet');
  const logger = createLogger({
    service: 'wallet',
    level: 'info',
    base: { component: 'custody-consumer' },
  });
  const emit = (event: string, fields: Record<string, unknown> = {}): void => {
    logger.info('worker_event', { event, ...fields });
  };
  const projector = new CustodyProjector({
    repository: new PrismaWalletRepository(prisma),
    clock: new SystemClock(),
    ids: new RandomIds(),
  });
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  let backoff = 200;
  let connections = 0;
  try {
    while (!controller.signal.aborted) {
      let connection: BrokerConnection | undefined;
      let consumer: CustodyBrokerConsumer | undefined;
      try {
        connection = await BrokerConnection.open({
          url: brokerUrl,
          connectionName: 'wallet-custody-consumer',
          logger,
        });
        await assertTopology(connection.channel, walletCustodyTopology);
        consumer = new CustodyBrokerConsumer({
          channel: connection.channel,
          projector,
          logger,
          onBeforeAck: (eventId, outcome) => {
            emit('consumer_committed', { eventId, outcome: outcome.outcome });
          },
          onRetry: (eventId, attempt) => emit('consumer_retry', { eventId, attempt }),
        });
        await consumer.start();
        connections += 1;
        backoff = 200;
        emit('consumer_started', { connections });
        await closedOrAborted(connection, controller.signal);
        if (!controller.signal.aborted) emit('consumer_disconnected', { connections });
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          emit('consumer_unavailable', {
            reason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          });
      } finally {
        await consumer?.stop();
        await connection?.close();
      }
      if (!controller.signal.aborted) {
        await delay(backoff, undefined, { signal: controller.signal }).catch(() => {});
        backoff = Math.min(backoff * 2, 5_000);
      }
    }
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await prisma.onModuleDestroy();
    await telemetry.shutdown();
  }
}

void main().catch(() => {
  createLogger({ service: 'wallet' }).error('custody_consumer_failed');
  process.exitCode = 1;
});
