import { randomUUID } from 'node:crypto';
import { InboxConsumer, runReconnectingInboxLoop } from '@carwash/platform-messaging';
import { createLogger, databaseSchemaFromUrl, serviceTelemetry } from '@carwash/service-kit';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client';
import {
  EventNotificationHandler,
  NotificationIntegrityError,
  parseTriggerEvent,
  type TriggerEvent,
} from '../application/event-notifications.service';
import { EnqueueNotification } from '../application/notification.service';
import {
  PrismaNotificationIntake,
  sha256Hex,
} from '../infrastructure/persistence/prisma-notification.repository';
import {
  EVENT_NOTIFICATIONS_QUEUE,
  eventNotificationsTopology,
} from '../infrastructure/messaging/event-notifications-topology';
import { PrismaInboxStore } from './prisma-inbox.store';
import type { PrismaService } from '../prisma.service';

/**
 * Standalone worker that turns published business events into notification
 * intents (today: `booking.confirmed.v1`).
 *
 * One delivery = one local transaction: the inbox row and the intent commit
 * together, and the ACK follows the commit. Nothing is sent here; the delivery
 * worker does that later. A conflicting intent for the same business key rolls
 * back and NACKs, and RabbitMQ's quorum delivery limit then dead-letters it. A
 * confirmation older than its notification window is recorded in the inbox and
 * skipped, never sent late.
 */
interface WorkerArgs {
  readonly stopAfter: number;
  readonly crashBeforeAckAfter: number;
  readonly prefetch: number;
  readonly reconnectMinMs: number;
  readonly reconnectMaxMs: number;
}

function parseArgs(argv: readonly string[]): WorkerArgs {
  const num = (name: string, fallback: number): number => {
    const index = argv.indexOf(`--${name}`);
    if (index < 0) return fallback;
    const value = Number(argv[index + 1]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`INVALID_ARG_${name}`);
    return value;
  };
  return {
    stopAfter: num('stop-after', Number.POSITIVE_INFINITY),
    // Acceptance-only crash seam between commit and ACK; 0 disables it.
    crashBeforeAckAfter: num('crash-before-ack-after', 0),
    prefetch: num('prefetch', 4),
    reconnectMinMs: num('reconnect-min-ms', 200),
    reconnectMaxMs: num('reconnect-max-ms', 5_000),
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
    level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'warn',
    base: { component: 'event-notifications-consumer' },
  });
  // Lifecycle facts are always emitted: they are how operators and the
  // acceptance suite observe commit/ACK ordering without reading payloads.
  const events = createLogger({
    service: 'communications',
    level: 'info',
    base: { component: 'event-notifications-worker-events' },
  });
  const emit = (record: Record<string, unknown>): void => {
    events.info('worker_event', record);
  };

  const databaseUrl = requireEnv('DATABASE_URL');
  const pool = new Pool({ connectionString: databaseUrl });
  telemetry.metrics.observePool(() => pool);
  const client = new PrismaClient({
    adapter: new PrismaPg(pool, {
      schema: databaseSchemaFromUrl(databaseUrl),
      disposeExternalPool: true,
    }),
  });
  const store = new PrismaInboxStore({ client } as unknown as PrismaService);
  const clock = { now: () => new Date() };
  const handler = new EventNotificationHandler(
    new EnqueueNotification(clock, sha256Hex, () => randomUUID()),
    clock,
  );
  const controller = new AbortController();

  let handled = 0;
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    emit({ event: 'consumer_stopping', signal, handled });
    controller.abort();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  try {
    await runReconnectingInboxLoop<TriggerEvent>({
      broker: {
        url: requireEnv('BROKER_URL'),
        connectionName: 'communications-event-notifications-consumer',
        logger,
      },
      topology: eventNotificationsTopology(),
      signal: controller.signal,
      logger,
      reconnectMinMs: args.reconnectMinMs,
      reconnectMaxMs: args.reconnectMaxMs,
      createConsumer: (channel) =>
        new InboxConsumer<TriggerEvent>({
          telemetry,
          channel,
          queue: EVENT_NOTIFICATIONS_QUEUE,
          store,
          parse: parseTriggerEvent,
          logger,
          prefetch: args.prefetch,
          effect: async (event, tx) => {
            try {
              const outcome = await handler.handle(
                new PrismaNotificationIntake(tx as Prisma.TransactionClient),
                event.trigger,
              );
              // Identifiers and outcome only; never the recipient or content.
              emit({
                event: 'notification_intent',
                eventId: event.eventId,
                eventType: event.eventType,
                correlationId: event.correlationId,
                outcome: outcome.kind,
                ...(outcome.kind === 'SKIPPED'
                  ? { reason: outcome.reason }
                  : { notificationId: outcome.notificationId }),
              });
            } catch (error) {
              if (error instanceof NotificationIntegrityError)
                emit({
                  event: 'notification_integrity_conflict',
                  code: error.code,
                  eventId: event.eventId,
                  eventType: event.eventType,
                });
              throw error;
            }
          },
          onTransientFailure: (event, deliveryCount) => {
            emit({
              event: 'consumer_transient_failure',
              eventId: event.eventId,
              eventType: event.eventType,
              deliveryCount,
            });
          },
          onBeforeAck: (event, outcome) => {
            handled += 1;
            emit({
              event: 'consumer_committed',
              eventId: event.eventId,
              eventType: event.eventType,
              outcome,
              handled,
            });
            if (args.crashBeforeAckAfter > 0 && handled >= args.crashBeforeAckAfter) {
              emit({ event: 'consumer_crash_before_ack', eventId: event.eventId });
              process.exit(9);
            }
            if (Number.isFinite(args.stopAfter) && handled >= args.stopAfter)
              setImmediate(() => stop('stop-after'));
          },
        }),
      onConnected: ({ connectionNumber }) => {
        emit({ event: 'consumer_started', queue: EVENT_NOTIFICATIONS_QUEUE, connectionNumber });
      },
      onDisconnected: ({ connectionNumber }) => {
        emit({ event: 'consumer_disconnected', connectionNumber });
      },
      onUnavailable: ({ error, nextDelayMs }) => {
        emit({
          event: 'consumer_broker_unavailable',
          error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          nextDelayMs,
        });
      },
    });
  } finally {
    await client.$disconnect();
    emit({ event: 'consumer_stopped', handled });
    await telemetry.shutdown();
  }
}

void main().catch(async (error: unknown) => {
  const telemetry = serviceTelemetry('communications');
  telemetry.logger.error('worker_fatal', { error });
  await telemetry.shutdown();
  process.exitCode = 1;
});
