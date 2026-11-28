import { randomUUID } from 'node:crypto';
import {
  BOOKING_CREATED_V1,
  BOOKING_CANCELLED_V1,
  BOOKING_RESCHEDULED_V1,
  BOOKING_LIFECYCLE_PROGRESSED_V1,
  DISPATCH_TASK_PROGRESSED_V1,
  DISPATCH_ASSIGNMENT_CHANGED_V1,
} from '@carwash/event-contracts';
import {
  InboxConsumer,
  runPollingLoop,
  runReconnectingInboxLoop,
  runReconnectingOutboxLoop,
  runWorkerGroup,
  type OutboxRecord,
  type TopologySpec,
} from '@carwash/platform-messaging';
import { createLogger } from '@carwash/service-kit';
import { dispatchAssignmentConfig } from '../infrastructure/dispatch/dispatch-assignment.client';
import { DispatchExecutionReader } from '../infrastructure/dispatch/dispatch-execution.reader';
import { OwnerHttpClient } from '../infrastructure/http/owner-http.client';
import { DispatchProjectionStore } from '../infrastructure/messaging/dispatch-projection.store';
import { PrismaOutboxStore } from '../infrastructure/messaging/prisma-outbox.store';
import { PrismaService, databaseUrlFromEnv } from '../infrastructure/persistence/prisma.service';
import { compose, positiveInt } from '../infrastructure/runtime/composition';
import { EntitlementConsumptionWorker } from '../application/entitlement-consumption.worker';
import { PrismaEntitlementConsumptionStore } from '../infrastructure/persistence/prisma-entitlement-consumption.store';

export const EXECUTION_QUEUE = 'booking.dispatch.execution';
export const executionTopology: TopologySpec = {
  exchanges: [{ name: 'booking.dlx', type: 'topic' }],
  queues: [
    {
      name: EXECUTION_QUEUE,
      queueType: 'quorum',
      deliveryLimit: 120,
      deadLetterExchange: 'booking.dlx',
    },
    { name: 'booking.dlq' },
  ],
  bindings: [
    {
      queue: EXECUTION_QUEUE,
      exchange: 'dispatch.events',
      routingKey: DISPATCH_TASK_PROGRESSED_V1.eventType,
    },
    {
      queue: EXECUTION_QUEUE,
      exchange: 'dispatch.events',
      routingKey: DISPATCH_ASSIGNMENT_CHANGED_V1.eventType,
    },
    { queue: 'booking.dlq', exchange: 'booking.dlx', routingKey: '#' },
  ],
};

export function parseDispatchExecutionTrigger(raw: unknown) {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'eventType' in raw &&
    raw.eventType === DISPATCH_ASSIGNMENT_CHANGED_V1.eventType
  )
    return DISPATCH_ASSIGNMENT_CHANGED_V1.parse(raw);
  return DISPATCH_TASK_PROGRESSED_V1.parse(raw);
}

export function validateBookingPublication(record: OutboxRecord): void {
  const contract = [
    BOOKING_CREATED_V1,
    BOOKING_CANCELLED_V1,
    BOOKING_RESCHEDULED_V1,
    BOOKING_LIFECYCLE_PROGRESSED_V1,
  ].find((candidate) => candidate.eventType === record.eventType);
  if (!contract) throw new Error('UNSUPPORTED_BOOKING_EVENT');
  const event = contract.parse(JSON.parse(record.payload));
  if (
    record.exchange !== 'booking.events' ||
    record.routingKey !== event.eventType ||
    record.eventId !== event.eventId ||
    record.correlationId !== event.correlationId
  )
    throw new Error('OUTBOX_ENVELOPE_MISMATCH');
}

export async function runRuntime(
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  workerId = `booking-${randomUUID()}`,
): Promise<void> {
  const brokerUrl = env.BROKER_URL;
  if (!brokerUrl) throw new Error('BROKER_URL_REQUIRED');
  const target = dispatchAssignmentConfig(env);
  if (target === null) throw new Error('BOOKING_DISPATCH_REQUIRED');
  const logger = createLogger({
    service: 'booking',
    base: { component: 'runtime-worker', workerId },
  });
  const prisma = new PrismaService(databaseUrlFromEnv(env));
  const { saga, changeSaga, entitlements } = compose(prisma, env, {
    instanceId: workerId,
    component: 'runtime-worker',
  });
  const consumption = new EntitlementConsumptionWorker(
    new PrismaEntitlementConsumptionStore(prisma),
    entitlements,
  );
  const projection = new DispatchProjectionStore(prisma);
  const reader = new DispatchExecutionReader(
    new OwnerHttpClient({
      owner: 'dispatch',
      baseUrl: target.baseUrl.toString(),
      timeoutMs: target.timeoutMs,
      service: { clientId: target.clientId, token: target.token },
    }),
  );
  const budgetMs = positiveInt(env.BOOKING_WORKER_SAGA_BUDGET_MS, 10_000);
  logger.info('runtime_worker_started', {});
  try {
    await runWorkerGroup(signal, [
      (stop) =>
        runReconnectingOutboxLoop({
          signal: stop,
          workerId,
          broker: { url: brokerUrl, connectionName: `${workerId}-outbox`, logger },
          topology: {
            exchanges: [{ name: 'booking.events', type: 'topic' }],
            queues: [],
            bindings: [],
          },
          store: new PrismaOutboxStore(prisma),
          validate: validateBookingPublication,
          maxAttempts: 100,
          logger,
        }),
      (stop) =>
        runReconnectingInboxLoop({
          signal: stop,
          broker: { url: brokerUrl, connectionName: `${workerId}-execution`, logger },
          topology: executionTopology,
          logger,
          createConsumer: (channel) =>
            new InboxConsumer({
              channel,
              queue: EXECUTION_QUEUE,
              store: projection,
              parse: parseDispatchExecutionTrigger,
              prefetch: 8,
              retryDelayMs: 1_000,
              prepare: (event) => reader.read(event.data.bookingId, event.correlationId),
              effect: (event, tx, snapshot) => projection.project(tx, snapshot, event),
              logger,
            }),
        }),
      (stop) =>
        runPollingLoop({
          signal: stop,
          intervalMs: 500,
          logger,
          work: async () => {
            const created = await saga.runDue(workerId, 1, budgetMs);
            const changed = await changeSaga.runDue(workerId, 1, budgetMs);
            logger.info('booking_saga_pass', { created, changed });
          },
        }),
      (stop) =>
        runPollingLoop({
          signal: stop,
          intervalMs: 1_000,
          logger,
          work: async () => {
            logger.info('booking_entitlement_consumption_pass', await consumption.pass(workerId));
          },
        }),
    ]);
  } finally {
    await prisma.client.$disconnect();
    logger.info('runtime_worker_stopped', {});
  }
}
