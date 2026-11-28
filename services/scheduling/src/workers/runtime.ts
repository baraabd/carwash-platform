import { randomUUID } from 'node:crypto';
import { SCHEDULING_HOLD_CHANGED_V1 } from '@carwash/event-contracts';
import {
  runPollingLoop,
  runReconnectingOutboxLoop,
  runWorkerGroup,
  type OutboxRecord,
} from '@carwash/platform-messaging';
import { createLogger } from '@carwash/service-kit';
import { CapacityService } from '../application';
import { PrismaOutboxStore } from '../infrastructure/messaging/prisma-outbox.store';
import { PrismaSchedulingStore } from '../infrastructure/persistence/prisma-scheduling.store';
import { PrismaService, databaseUrlFromEnv } from '../infrastructure/persistence/prisma.service';
import { systemClock, uuidGenerator } from '../infrastructure/runtime/system';

export function validateSchedulingPublication(record: OutboxRecord): void {
  const event = SCHEDULING_HOLD_CHANGED_V1.parse(JSON.parse(record.payload));
  if (
    record.exchange !== 'scheduling.events' ||
    record.routingKey !== event.eventType ||
    record.eventType !== event.eventType ||
    record.eventId !== event.eventId ||
    record.correlationId !== event.correlationId
  )
    throw new Error('OUTBOX_ENVELOPE_MISMATCH');
}

/** Production composition: HTTP never starts another copy of these loops. */
export async function runRuntime(
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  workerId = `scheduling-${randomUUID()}`,
): Promise<void> {
  if (!env.BROKER_URL) throw new Error('BROKER_URL_REQUIRED');
  const logger = createLogger({
    service: 'scheduling',
    base: { component: 'runtime-worker', workerId },
  });
  const prisma = new PrismaService(databaseUrlFromEnv(env));
  const store = new PrismaSchedulingStore(prisma);
  const service = new CapacityService(store, store, systemClock, uuidGenerator);
  logger.info('runtime_worker_started', {});
  try {
    await runWorkerGroup(signal, [
      (stop) =>
        runReconnectingOutboxLoop({
          signal: stop,
          workerId,
          broker: { url: env.BROKER_URL!, connectionName: `${workerId}-outbox`, logger },
          topology: {
            exchanges: [{ name: 'scheduling.events', type: 'topic' }],
            queues: [],
            bindings: [],
          },
          store: new PrismaOutboxStore(prisma),
          validate: validateSchedulingPublication,
          maxAttempts: 100,
          logger,
        }),
      (stop) =>
        runPollingLoop({
          signal: stop,
          intervalMs: 1_000,
          logger,
          work: async () => {
            const expired = await service.expireDue(randomUUID(), 50);
            const purged = await service.purgeIdempotency(7 * 24 * 60 * 60_000);
            logger.info('scheduling_maintenance_pass', { ...expired, purged });
          },
        }),
    ]);
  } finally {
    await prisma.client.$disconnect();
    logger.info('runtime_worker_stopped', {});
  }
}
