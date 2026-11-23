import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createLogger, serviceTelemetry } from '@carwash/service-kit';
import { DispatchService, IDEMPOTENCY_RETENTION_MS } from '../application';
import { PrismaService, databaseUrlFromEnv } from '../infrastructure/persistence/prisma.service';
import { PrismaDispatchStore } from '../infrastructure/persistence/prisma-dispatch.store';
import { systemClock, uuidGenerator } from '../infrastructure/runtime/system';

/**
 * Offer-expiry worker. Runs as its own process (any number of replicas).
 *
 * It holds no state of its own: every pass re-reads due offers from PostgreSQL
 * and expires them under the assignment row lock (SKIP LOCKED), re-checking the
 * deadline under that lock, so a crash at any point simply leaves work for the
 * next pass or another replica. Expiry correctness does not depend on this
 * worker: every accept/decline/offer command evaluates the deadline itself.
 * The worker returns jobs to UNASSIGNED promptly, emits their events and
 * purges idempotency records older than the documented retention.
 *
 * One structured line per pass lets tests synchronise on observations instead
 * of sleeping for a guessed interval.
 */
interface Args {
  readonly once: boolean;
  readonly intervalMs: number;
  readonly batch: number;
  readonly maxPasses: number;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const num = (name: string, fallback: number): number => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`INVALID_ARG_${name}`);
    return value;
  };
  return {
    once: argv.includes('--once'),
    intervalMs: num('interval-ms', 1_000),
    batch: num('batch', 50),
    maxPasses: argv.includes('--max-passes') ? num('max-passes', 1) : Number.POSITIVE_INFINITY,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workerId = `offer-expiry-${randomUUID().slice(0, 8)}`;
  const telemetry = serviceTelemetry('dispatch');
  const logger = createLogger({
    service: 'dispatch',
    base: { component: 'offer-expiry', workerId },
  });
  const prisma = new PrismaService(databaseUrlFromEnv());
  const store = new PrismaDispatchStore(prisma);
  const service = new DispatchService(store, store, systemClock, uuidGenerator);

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('expiry_stopping', { signal });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  let passes = 0;
  let failures = 0;
  try {
    while (!stopping && passes < args.maxPasses) {
      try {
        const result = await service.expireDue(randomUUID(), args.batch);
        const purged = await store.purgeIdempotencyBefore(
          new Date(systemClock.now().getTime() - IDEMPOTENCY_RETENTION_MS),
          args.batch,
        );
        passes += 1;
        failures = 0;
        logger.info('expiry_pass', { pass: passes, offers: result.offers, purged });
        if (args.once) break;
        if (result.offers === 0) await sleep(args.intervalMs);
      } catch (error: unknown) {
        failures += 1;
        logger.warn('expiry_pass_failed', {
          error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          failures,
        });
        if (args.once) {
          process.exitCode = 1;
          break;
        }
        // Bounded exponential backoff with full jitter; safe because expiry is
        // idempotent and re-derived from the database on every pass.
        const ceiling = Math.min(30_000, args.intervalMs * 2 ** Math.min(failures, 5));
        await sleep(Math.floor(Math.random() * ceiling) + 100);
      }
    }
  } finally {
    await prisma.client.$disconnect();
    logger.info('expiry_stopped', { passes });
    await telemetry.shutdown();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error: unknown) => {
  createLogger({ service: 'dispatch' }).error('expiry_fatal', { error });
  process.exitCode = 1;
});
