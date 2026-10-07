import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createLogger, databaseSchemaFromUrl, serviceTelemetry } from '@carwash/service-kit';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import { DeliveryWorker } from '../application/notification.service';
import { PrismaNotificationRepository } from '../infrastructure/persistence/prisma-notification.repository';
import { httpProviderFromEnv } from '../infrastructure/provider/http-notification.provider';

/**
 * Standalone notification delivery worker.
 *
 * Startup fails closed: without a declared provider (endpoint, token and an
 * explicit idempotency capability) it exits instead of claiming work it cannot
 * send. Intents then stay QUEUED and expire honestly.
 */
interface RunnerArgs {
  readonly once: boolean;
  readonly intervalMs: number;
  readonly batchSize: number;
  readonly submitTimeoutMs: number;
}

function parseArgs(argv: readonly string[]): RunnerArgs {
  const num = (name: string, fallback: number, min: number, max: number): number => {
    const index = argv.indexOf(`--${name}`);
    if (index < 0) return fallback;
    const value = Number(argv[index + 1]);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`INVALID_ARG_${name}`);
    return value;
  };
  return {
    once: argv.includes('--once'),
    intervalMs: num('interval-ms', 1_000, 50, 60_000),
    batchSize: num('batch-size', 20, 1, 200),
    submitTimeoutMs: num('submit-timeout-ms', 10_000, 100, 15_000),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const telemetry = serviceTelemetry('communications');
  const logger = createLogger({
    service: 'communications',
    level: 'info',
    base: { component: 'delivery-worker' },
  });
  const provider = httpProviderFromEnv(process.env);
  const workerId = `delivery-${process.pid}-${randomInt(1_000_000)}`;

  const databaseUrl = requireEnv('DATABASE_URL');
  const pool = new Pool({ connectionString: databaseUrl });
  telemetry.metrics.observePool(() => pool);
  const client = new PrismaClient({
    adapter: new PrismaPg(pool, {
      schema: databaseSchemaFromUrl(databaseUrl),
      disposeExternalPool: true,
    }),
  });
  const worker = new DeliveryWorker(
    new PrismaNotificationRepository(client),
    provider,
    { now: () => new Date() },
    Math.random,
    { workerId, batchSize: args.batchSize, submitTimeoutMs: args.submitTimeoutMs },
  );

  const controller = new AbortController();
  const stop = (signal: string): void => {
    if (controller.signal.aborted) return;
    logger.info('worker_event', { event: 'delivery_stopping', signal });
    controller.abort();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  logger.info('worker_event', {
    event: 'delivery_started',
    workerId,
    provider: provider.name,
    idempotentProvider: provider.idempotentSubmission,
  });
  try {
    do {
      // Counts and outcome kinds only: never recipients, parameters or tokens.
      const report = await worker.runOnce();
      if (report.claimed > 0) logger.info('worker_event', { event: 'delivery_pass', ...report });
      if (args.once) break;
      await delay(args.intervalMs, undefined, { signal: controller.signal }).catch(() => undefined);
    } while (!controller.signal.aborted);
  } finally {
    await client.$disconnect();
    logger.info('worker_event', { event: 'delivery_stopped', workerId });
    await telemetry.shutdown();
  }
}

void main().catch(async (error: unknown) => {
  const telemetry = serviceTelemetry('communications');
  telemetry.logger.error('worker_fatal', {
    error: error instanceof Error ? error.message : 'UNKNOWN',
  });
  await telemetry.shutdown();
  process.exitCode = 1;
});
