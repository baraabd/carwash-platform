import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { createLogger, serviceTelemetry } from '@carwash/service-kit';
import { FundingRecoveryService } from '../application/funding-recovery.service';
import { PrismaService, databaseUrlFromEnv } from '../infrastructure/persistence/prisma.service';
import { PrismaFundingReleaseQueue } from '../infrastructure/persistence/prisma-funding-release.queue';
import {
  BillingFundingAuthority,
  billingFundingConfigFromEnv,
} from '../infrastructure/billing/billing-funding.authority';
import { SystemClock } from '../infrastructure/system/system.adapters';

export async function main(): Promise<void> {
  const config = billingFundingConfigFromEnv(process.env);
  if (!config.origin || !config.clientId || !config.token)
    throw new Error('FUNDING_OWNER_CONFIG_REQUIRED');
  const prisma = new PrismaService(databaseUrlFromEnv());
  const logger = createLogger({ service: 'subscription', base: { component: 'funding-recovery' } });
  const telemetry = serviceTelemetry('subscription');
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const worker = new FundingRecoveryService({
    queue: new PrismaFundingReleaseQueue(prisma.client),
    funding: new BillingFundingAuthority(config),
    clock: new SystemClock(),
    workerId: randomUUID(),
  });
  try {
    while (!controller.signal.aborted) {
      try {
        const result = await worker.runBatch();
        if (result.attempted) logger.info('funding_release_batch', result);
      } catch (error) {
        logger.error('funding_release_retry', {
          error: error instanceof Error ? error.name : 'UNKNOWN',
        });
      }
      try {
        await setTimeout(2000, undefined, { signal: controller.signal });
      } catch {
        if (!controller.signal.aborted) throw new Error('FUNDING_WAIT_FAILED');
      }
    }
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await prisma.onModuleDestroy();
    await telemetry.shutdown();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    createLogger({ service: 'subscription' }).error('funding_worker_fatal', {
      error: error instanceof Error ? error.name : 'UNKNOWN',
    });
    process.exitCode = 1;
  });
