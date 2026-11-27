import { randomUUID } from 'node:crypto';
import {
  DISPATCH_ASSIGNMENT_CHANGED_V1,
  DISPATCH_TASK_PROGRESSED_V1,
  DISPATCH_CASH_DECLARED_V1,
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
import { DispatchService, EvidenceFenceRelay, FENCE_STUCK_ATTEMPTS } from '../application';
import { AutomaticAssignmentService } from '../application/automatic-assignment.service';
import { ServiceHttp, parseServiceTarget } from '../infrastructure/http/service-http';
import { MediaEvidenceClient } from '../infrastructure/media/media-evidence.client';
import { PrismaOutboxStore } from '../infrastructure/messaging/prisma-outbox.store';
import { PrismaDispatchStore } from '../infrastructure/persistence/prisma-dispatch.store';
import { PrismaEvidenceFenceStore } from '../infrastructure/persistence/prisma-evidence-fence.store';
import { PrismaService, databaseUrlFromEnv } from '../infrastructure/persistence/prisma.service';
import { systemClock, uuidGenerator } from '../infrastructure/runtime/system';
import { WorkforceCapacityClient } from '../infrastructure/workforce/workforce-capacity.client';
import { AssignmentCandidatesClient } from '../infrastructure/workforce/assignment-candidates.client';
import type { DispatchTransaction } from '../ports';
import { holdChangedConsumerParts } from '../transport/messaging/hold-changed.consumer';
import { eligibilityChangedConsumerParts } from '../transport/messaging/eligibility-changed.consumer';

export const HOLD_QUEUE = 'dispatch.scheduling.hold-changed';
export const ELIGIBILITY_QUEUE = 'dispatch.workforce.eligibility-changed';
export function consumerTopology(
  queue: string,
  exchange: string,
  routingKey: string,
): TopologySpec {
  return {
    exchanges: [{ name: 'dispatch.dlx', type: 'topic' }],
    queues: [
      { name: queue, queueType: 'quorum', deliveryLimit: 30, deadLetterExchange: 'dispatch.dlx' },
      { name: 'dispatch.dlq' },
    ],
    bindings: [
      { queue, exchange, routingKey },
      { queue: 'dispatch.dlq', exchange: 'dispatch.dlx', routingKey: '#' },
    ],
  };
}
export function validateDispatchPublication(record: OutboxRecord): void {
  const contract = [
    DISPATCH_ASSIGNMENT_CHANGED_V1,
    DISPATCH_TASK_PROGRESSED_V1,
    DISPATCH_CASH_DECLARED_V1,
  ].find((candidate) => candidate.eventType === record.eventType);
  if (!contract) throw new Error('UNSUPPORTED_DISPATCH_EVENT');
  const event = contract.parse(JSON.parse(record.payload));
  if (
    record.exchange !== 'dispatch.events' ||
    record.routingKey !== event.eventType ||
    record.eventId !== event.eventId ||
    record.correlationId !== event.correlationId
  )
    throw new Error('OUTBOX_ENVELOPE_MISMATCH');
}

export async function runRuntime(
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  workerId = `dispatch-${randomUUID()}`,
): Promise<void> {
  const brokerUrl = env.BROKER_URL;
  if (!brokerUrl) throw new Error('BROKER_URL_REQUIRED');
  const workforce = parseServiceTarget(env, 'DISPATCH_WORKFORCE');
  const media = parseServiceTarget(env, 'DISPATCH_MEDIA');
  if (!workforce || !media) throw new Error('DISPATCH_WORKFORCE_AND_MEDIA_REQUIRED');
  const logger = createLogger({
    service: 'dispatch',
    base: { component: 'runtime-worker', workerId },
  });
  const prisma = new PrismaService(databaseUrlFromEnv(env));
  const store = new PrismaDispatchStore(prisma);
  const service = new DispatchService(
    store,
    store,
    systemClock,
    uuidGenerator,
    new WorkforceCapacityClient(new ServiceHttp(workforce)),
  );
  const hold = holdChangedConsumerParts(store, systemClock, uuidGenerator);
  const eligibility = eligibilityChangedConsumerParts(store, systemClock, uuidGenerator);
  const fenceStore = new PrismaEvidenceFenceStore(prisma);
  const fences = new EvidenceFenceRelay(
    fenceStore,
    new MediaEvidenceClient(new ServiceHttp(media)),
  );
  const automatic = new AutomaticAssignmentService(
    store,
    store,
    new AssignmentCandidatesClient(new ServiceHttp(workforce)),
    systemClock,
    uuidGenerator,
  );
  logger.info('runtime_worker_started', {});
  try {
    await runWorkerGroup(signal, [
      (stop) =>
        runReconnectingOutboxLoop({
          signal: stop,
          workerId,
          broker: { url: brokerUrl, connectionName: `${workerId}-outbox`, logger },
          topology: {
            exchanges: [{ name: 'dispatch.events', type: 'topic' }],
            queues: [],
            bindings: [],
          },
          store: new PrismaOutboxStore(prisma),
          validate: validateDispatchPublication,
          maxAttempts: 100,
          logger,
        }),
      (stop) =>
        runReconnectingInboxLoop({
          signal: stop,
          broker: { url: brokerUrl, connectionName: `${workerId}-holds`, logger },
          topology: consumerTopology(HOLD_QUEUE, 'scheduling.events', 'scheduling.hold-changed.v1'),
          logger,
          createConsumer: (channel) =>
            new InboxConsumer({
              channel,
              queue: HOLD_QUEUE,
              store: hold.store,
              parse: hold.parse,
              prefetch: 8,
              retryDelayMs: 1_000,
              logger,
              effect: async (event, tx) => {
                await hold.effect(event, tx as DispatchTransaction);
              },
            }),
        }),
      (stop) =>
        runReconnectingInboxLoop({
          signal: stop,
          broker: { url: brokerUrl, connectionName: `${workerId}-eligibility`, logger },
          topology: consumerTopology(
            ELIGIBILITY_QUEUE,
            'workforce.events',
            'workforce.eligibility-changed.v1',
          ),
          logger,
          createConsumer: (channel) =>
            new InboxConsumer({
              channel,
              queue: ELIGIBILITY_QUEUE,
              store: eligibility.store,
              parse: eligibility.parse,
              prefetch: 8,
              retryDelayMs: 1_000,
              logger,
              effect: async (event, tx) => {
                await eligibility.effect(event, tx as DispatchTransaction);
              },
            }),
        }),
      (stop) =>
        runPollingLoop({
          signal: stop,
          intervalMs: 1_000,
          logger,
          work: async () => {
            const expired = await service.expireDue(randomUUID(), 50);
            // One bounded HTTP operation per lease pass keeps the 30-second fence
            // lease and shutdown drain inside the configured owner-call budget.
            const fenced = await fences.pass(workerId, randomUUID(), 1);
            const stuck = await fenceStore.countStuck(FENCE_STUCK_ATTEMPTS);
            logger.info('dispatch_maintenance_pass', { expired, ...fenced, stuck });
          },
        }),
      (stop) =>
        runPollingLoop({
          signal: stop,
          intervalMs: 2_000,
          logger,
          work: async () => {
            const offered = await automatic.runDue(randomUUID(), 20, stop);
            logger.info('dispatch_automatic_pass', { offered });
          },
        }),
    ]);
  } finally {
    await prisma.client.$disconnect();
    logger.info('runtime_worker_stopped', {});
  }
}
