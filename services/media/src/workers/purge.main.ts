import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createLogger, serviceTelemetry } from '@carwash/service-kit';
import { IDEMPOTENCY_RETENTION_MS, MediaService } from '../application';
import { loadWorkerConfig } from '../infrastructure/config/media-config';
import {
  PrismaService,
  WORKER_IDLE_IN_TRANSACTION_TIMEOUT_MS,
} from '../infrastructure/persistence/prisma.service';
import { PrismaMediaStore } from '../infrastructure/persistence/prisma-media.store';
import { systemClock, uuidGenerator } from '../infrastructure/runtime/system';
import { S3ObjectStore } from '../infrastructure/storage/s3-object-store';

/**
 * Media purge worker. Runs as its own process (any number of replicas).
 *
 * Each pass, in bounded batches:
 *   1. RESERVED past deadline + grace  -> EXPIRED, stray bytes deleted first;
 *   2. unclaimed AVAILABLE past retention -> PURGED, bytes deleted first;
 *   3. residual keys of finalized objects deleted once no upload URL can be valid;
 *   4. idempotency records older than their retention deleted.
 * It holds no state: every pass re-reads candidates from PostgreSQL and acts
 * on each under its row lock (SKIP LOCKED) after re-checking eligibility, so
 * a crash at any point leaves work for the next pass or another replica, and
 * object-store deletes are idempotent. Claimed objects are never purged.
 *
 * One structured line per pass lets tests synchronise on observations instead
 * of sleeping for a guessed interval. Lines carry counts only: no object ids,
 * subjects, keys or URLs.
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
  const num = (name: string, fallback: number, max: number): number => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      throw new Error(`INVALID_ARG_${name}`);
    }
    return value;
  };
  return {
    once: argv.includes('--once'),
    intervalMs: num('interval-ms', 5_000, 3_600_000),
    batch: num('batch', 50, 1_000),
    maxPasses: argv.includes('--max-passes')
      ? num('max-passes', 1, Number.MAX_SAFE_INTEGER)
      : Number.POSITIVE_INFINITY,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadWorkerConfig(process.env);
  const workerId = `media-purge-${randomUUID().slice(0, 8)}`;
  const telemetry = serviceTelemetry('media');
  const logger = createLogger({ service: 'media', base: { component: 'purge', workerId } });
  const prisma = new PrismaService(config.databaseUrl, {
    idleInTransactionTimeoutMs: WORKER_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
  const store = new PrismaMediaStore(prisma);
  const service = new MediaService(
    store,
    store,
    new S3ObjectStore(config.s3),
    systemClock,
    uuidGenerator,
    config.policy,
  );

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('purge_stopping', { signal });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  let passes = 0;
  let failures = 0;
  try {
    while (!stopping && passes < args.maxPasses) {
      try {
        const result = await service.purgePass(randomUUID(), args.batch);
        const idempotency = await store.purgeIdempotencyBefore(
          new Date(systemClock.now().getTime() - IDEMPOTENCY_RETENTION_MS),
          args.batch,
        );
        passes += 1;
        failures = 0;
        logger.info('purge_pass', { pass: passes, ...result, idempotency });
        if (args.once) break;
        const busy = result.expired + result.purged + result.swept > 0;
        if (!busy) await sleep(args.intervalMs);
      } catch (error: unknown) {
        failures += 1;
        logger.warn('purge_pass_failed', {
          error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          code: (error as { code?: unknown } | null)?.code ?? null,
          failures,
        });
        if (args.once) {
          process.exitCode = 1;
          break;
        }
        // Bounded exponential backoff with full jitter; safe because every
        // step is idempotent and re-derived from the database on each pass.
        const ceiling = Math.min(30_000, args.intervalMs * 2 ** Math.min(failures, 5));
        await sleep(Math.floor(Math.random() * ceiling) + 100);
      }
    }
  } finally {
    await prisma.client.$disconnect();
    logger.info('purge_stopped', { passes });
    await telemetry.shutdown();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error: unknown) => {
  createLogger({ service: 'media' }).error('purge_fatal', {
    error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
  });
  process.exitCode = 1;
});
