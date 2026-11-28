import { randomUUID } from 'node:crypto';
import {
  WORKFORCE_ELIGIBILITY_CHANGED_V1,
  WORKFORCE_SHIFT_UPDATED_V1,
} from '@carwash/event-contracts';
import { runReconnectingOutboxLoop, type OutboxRecord } from '@carwash/platform-messaging';
import { createLogger } from '@carwash/service-kit';
import { PrismaOutboxStore } from '../infrastructure/messaging/prisma-outbox.store';
import { PrismaService, databaseUrlFromEnv } from '../infrastructure/persistence/prisma.service';

export function validateWorkforcePublication(record: OutboxRecord): void {
  const raw: unknown = JSON.parse(record.payload);
  const event =
    record.eventType === WORKFORCE_SHIFT_UPDATED_V1.eventType
      ? WORKFORCE_SHIFT_UPDATED_V1.parse(raw)
      : WORKFORCE_ELIGIBILITY_CHANGED_V1.parse(raw);
  if (
    record.exchange !== 'workforce.events' ||
    record.routingKey !== event.eventType ||
    record.eventType !== event.eventType ||
    record.eventId !== event.eventId ||
    record.correlationId !== event.correlationId
  )
    throw new Error('OUTBOX_ENVELOPE_MISMATCH');
}

export async function runRuntime(
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  workerId = `workforce-${randomUUID()}`,
): Promise<void> {
  if (!env.BROKER_URL) throw new Error('BROKER_URL_REQUIRED');
  const logger = createLogger({
    service: 'workforce',
    base: { component: 'runtime-worker', workerId },
  });
  const prisma = new PrismaService(databaseUrlFromEnv(env));
  logger.info('runtime_worker_started', {});
  try {
    await runReconnectingOutboxLoop({
      signal,
      workerId,
      broker: { url: env.BROKER_URL, connectionName: `${workerId}-outbox`, logger },
      topology: {
        exchanges: [{ name: 'workforce.events', type: 'topic' }],
        queues: [],
        bindings: [],
      },
      store: new PrismaOutboxStore(prisma),
      validate: validateWorkforcePublication,
      maxAttempts: 100,
      logger,
    });
  } finally {
    await prisma.client.$disconnect();
    logger.info('runtime_worker_stopped', {});
  }
}
