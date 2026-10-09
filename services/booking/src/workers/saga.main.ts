import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createLogger, serviceTelemetry } from '@carwash/service-kit';
import { PrismaService, databaseUrlFromEnv } from '../infrastructure/persistence/prisma.service';
import { compose, positiveInt } from '../infrastructure/runtime/composition';

/**
 * Booking saga worker (process manager). Runs as its own process; any number
 * of replicas.
 *
 * It holds no state of its own: every pass leases due sagas from PostgreSQL
 * (SKIP LOCKED, fenced lease) and advances them with idempotent owner calls.
 * A crash at any point leaves the saga to the next pass or another replica
 * once the lease ends; a stalled replica that wakes up after losing its lease
 * cannot write (fence) and its duplicate remote call has no second effect.
 *
 * One structured line per pass lets tests synchronise on observations.
 */
interface Args {
  readonly once: boolean;
  readonly intervalMs: number;
  readonly batch: number;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    once: argv.includes('--once'),
    intervalMs: positiveInt(get('interval-ms'), 500),
    batch: positiveInt(get('batch'), 20),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workerId = `saga-${randomUUID().slice(0, 8)}`;
  const telemetry = serviceTelemetry('booking');
  const logger = createLogger({ service: 'booking', base: { component: 'saga-worker', workerId } });
  const prisma = new PrismaService(databaseUrlFromEnv());
  const { saga } = compose(prisma, process.env, { instanceId: workerId, component: 'saga-worker' });
  const budgetMs = positiveInt(process.env.BOOKING_WORKER_SAGA_BUDGET_MS, 10_000);

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('saga_worker_stopping', { signal });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  logger.info('saga_worker_started', {});

  let passes = 0;
  let failures = 0;
  try {
    while (!stopping) {
      try {
        const leased = await saga.runDue(workerId, args.batch, budgetMs);
        passes += 1;
        failures = 0;
        logger.info('saga_pass', { pass: passes, leased });
        if (args.once) break;
        if (leased === 0) await sleep(args.intervalMs);
      } catch (error: unknown) {
        failures += 1;
        logger.warn('saga_pass_failed', {
          error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          failures,
        });
        if (args.once) {
          process.exitCode = 1;
          break;
        }
        // Bounded exponential backoff with full jitter; every pass re-derives
        // its work from the database, so retrying the pass is always safe.
        const ceiling = Math.min(30_000, args.intervalMs * 2 ** Math.min(failures, 6));
        await sleep(Math.floor(Math.random() * ceiling) + 100);
      }
    }
  } finally {
    await prisma.client.$disconnect();
    logger.info('saga_worker_stopped', { passes });
    await telemetry.shutdown();
  }
}

void main().catch((error: unknown) => {
  createLogger({ service: 'booking' }).error('saga_worker_fatal', { error });
  process.exitCode = 1;
});
