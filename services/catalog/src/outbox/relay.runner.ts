import { randomUUID } from 'node:crypto';
import {
  BrokerConnection,
  ConfirmingPublisher,
  OutboxRelay,
  assertTopology,
  producerTopology,
} from '@carwash/platform-messaging';
import { createLogger, databaseSchemaFromUrl } from '@carwash/service-kit';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaOutboxStore } from './prisma-outbox.store';
import type { PrismaService } from '../prisma.service';

/**
 * Standalone outbox relay worker.
 *
 * It runs as its own process, not inside an API replica, so that publishing
 * pressure and API traffic cannot starve each other and so that integration
 * tests can kill it at an exact point and prove recovery.
 *
 * Every pass is reported as one JSON line on stdout. Tests synchronise on those
 * observations instead of sleeping for a guessed interval, which is what makes
 * the failure tests deterministic rather than flaky.
 */
interface RelayArgs {
  readonly workerId: string;
  readonly once: boolean;
  readonly intervalMs: number;
  readonly leaseMs: number;
  readonly batchSize: number;
  readonly maxAttempts: number;
  readonly maxPasses: number;
  /** Acceptance-only hard-crash seam immediately after a lease is acquired. */
  readonly crashAfterLease: boolean;
  /** Acceptance-only pause to cut the broker between lease and publish. */
  readonly pauseAfterLeaseMs: number;
}

function parseArgs(argv: readonly string[]): RelayArgs {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const num = (name: string, fallback: number): number => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`INVALID_ARG_${name}`);
    return value;
  };
  return {
    workerId: get('worker-id') ?? `relay-${randomUUID().slice(0, 8)}`,
    once: argv.includes('--once'),
    intervalMs: num('interval-ms', 250),
    leaseMs: num('lease-ms', 30_000),
    batchSize: num('batch-size', 20),
    maxAttempts: num('max-attempts', 5),
    maxPasses: num('max-passes', Number.POSITIVE_INFINITY),
    crashAfterLease: argv.includes('--crash-after-lease'),
    pauseAfterLeaseMs: num('pause-after-lease-ms', 0),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const logger = createLogger({
    service: 'catalog',
    level: (process.env.LOG_LEVEL as 'info') ?? 'info',
    base: { component: 'outbox-relay', workerId: args.workerId },
  });

  const databaseUrl = requireEnv('DATABASE_URL');
  const brokerUrl = requireEnv('BROKER_URL');

  const adapter = new PrismaPg(
    { connectionString: databaseUrl },
    { schema: databaseSchemaFromUrl(databaseUrl) },
  );
  const client = new PrismaClient({ adapter });
  const store = new PrismaOutboxStore({ client } as unknown as PrismaService);

  let stopping = false;
  let connection: BrokerConnection | undefined;

  const emit = (record: Record<string, unknown>): void => {
    // One JSON object per line on stdout; logs go to stderr via the logger.
    process.stdout.write(`${JSON.stringify(record)}\n`);
  };

  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('relay_stopping', { signal });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  let passes = 0;
  let backoffMs = 200;

  try {
    while (!stopping && passes < args.maxPasses) {
      if (connection === undefined) {
        try {
          connection = await BrokerConnection.open({
            url: brokerUrl,
            connectionName: `catalog-outbox-relay-${args.workerId}`,
            logger,
          });
          // A dropped connection invalidates the channel; clearing it here makes
          // the next pass reconnect instead of publishing into a dead channel.
          connection.onClose(() => {
            connection = undefined;
          });
          await assertTopology(connection.channel, producerTopology);
          backoffMs = 200;
          emit({ event: 'relay_connected', workerId: args.workerId });
        } catch (error: unknown) {
          // Broker down: committed outbox rows simply stay pending. Nothing is
          // lost and nothing is marked published.
          emit({
            event: 'relay_broker_unavailable',
            workerId: args.workerId,
            error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          });
          if (args.once) break;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          backoffMs = Math.min(backoffMs * 2, 5_000);
          continue;
        }
      }

      const relay = new OutboxRelay({
        workerId: args.workerId,
        store,
        publisher: new ConfirmingPublisher(connection.channel, logger),
        logger,
        leaseMs: args.leaseMs,
        batchSize: args.batchSize,
        maxAttempts: args.maxAttempts,
        onLeased: async (records) => {
          if (records.length === 0) return;
          emit({ event: 'relay_leased', workerId: args.workerId, leased: records.length });
          if (args.crashAfterLease) {
            emit({
              event: 'relay_crash_after_lease',
              workerId: args.workerId,
              leased: records.length,
            });
            // Flush the observation before the intentional hard exit. No finally
            // block runs: the lease must remain exactly as a crashed worker left it.
            await new Promise<void>((resolve) => {
              process.stdout.write('', () => resolve());
            });
            process.exit(8);
          }
          if (args.pauseAfterLeaseMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, args.pauseAfterLeaseMs));
          }
        },
      });

      let pass;
      try {
        pass = await relay.runOnce();
      } catch (error: unknown) {
        emit({
          event: 'relay_pass_failed',
          workerId: args.workerId,
          error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        });
        connection = undefined;
        if (args.once) break;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      passes += 1;
      emit({ event: 'relay_pass', workerId: args.workerId, pass: passes, ...pass });
      if (args.once) break;
      if (pass.leased === 0) await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
    }
  } finally {
    await connection?.close();
    await client.$disconnect();
    emit({ event: 'relay_stopped', workerId: args.workerId, passes });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ event: 'relay_fatal', error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' })}\n`,
  );
  process.exitCode = 1;
});
