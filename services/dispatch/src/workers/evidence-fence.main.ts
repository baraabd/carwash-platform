import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createLogger, serviceTelemetry } from '@carwash/service-kit';
import { EvidenceFenceRelay, FENCE_STUCK_ATTEMPTS } from '../application';
import { ServiceHttp, parseServiceTarget } from '../infrastructure/http/service-http';
import { MediaEvidenceClient } from '../infrastructure/media/media-evidence.client';
import { PrismaService, databaseUrlFromEnv } from '../infrastructure/persistence/prisma.service';
import { PrismaEvidenceFenceStore } from '../infrastructure/persistence/prisma-evidence-fence.store';

/**
 * Evidence-fence worker (CR-P08-C1). Runs as its own process (any number of
 * replicas).
 *
 * It delivers the owner-access fences that task-ending transactions queued in
 * PostgreSQL to Media. It holds no state of its own: a crash at any point
 * leaves the lease to expire and the request for the next pass, and the
 * Idempotency-Key makes the re-delivery the same request. It needs the same
 * DISPATCH_MEDIA_* target as the API, with the `media.object.fence` scope.
 *
 * One structured line per pass lets tests synchronise on observations instead
 * of sleeping for a guessed interval; `stuck` counts requests that keep failing.
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
  const workerId = `evidence-fence-${randomUUID().slice(0, 8)}`;
  const telemetry = serviceTelemetry('dispatch');
  const logger = createLogger({
    service: 'dispatch',
    base: { component: 'evidence-fence', workerId },
  });
  const target = parseServiceTarget(process.env, 'DISPATCH_MEDIA');
  if (target === null) throw new Error('DISPATCH_MEDIA_REQUIRED');
  const prisma = new PrismaService(databaseUrlFromEnv());
  const queue = new PrismaEvidenceFenceStore(prisma);
  const relay = new EvidenceFenceRelay(queue, new MediaEvidenceClient(new ServiceHttp(target)));

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('fence_stopping', { signal });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  let passes = 0;
  let failures = 0;
  try {
    while (!stopping && passes < args.maxPasses) {
      try {
        const result = await relay.pass(workerId, randomUUID(), args.batch);
        const stuck = await queue.countStuck(FENCE_STUCK_ATTEMPTS);
        passes += 1;
        failures = 0;
        const line = { pass: passes, ...result, stuck };
        if (stuck > 0) logger.warn('fence_pass', line);
        else logger.info('fence_pass', line);
        if (args.once) break;
        if (result.leased === 0) await sleep(args.intervalMs);
      } catch (error: unknown) {
        failures += 1;
        logger.warn('fence_pass_failed', {
          error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          failures,
        });
        if (args.once) {
          process.exitCode = 1;
          break;
        }
        const ceiling = Math.min(30_000, args.intervalMs * 2 ** Math.min(failures, 5));
        await sleep(Math.floor(Math.random() * ceiling) + 100);
      }
    }
  } finally {
    await prisma.client.$disconnect();
    logger.info('fence_stopped', { passes });
    await telemetry.shutdown();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error: unknown) => {
  createLogger({ service: 'dispatch' }).error('fence_fatal', { error });
  process.exitCode = 1;
});
