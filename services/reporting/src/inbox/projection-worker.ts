import {
  InboxConsumer,
  runReconnectingInboxLoop,
  type ParsedEvent,
  type TopologySpec,
} from '@carwash/platform-messaging';
import { createLogger, databaseSchemaFromUrl, serviceTelemetry } from '@carwash/service-kit';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client';
import { OperationsIntegrityError } from '../domain/operations';
import { PrismaInboxStore } from './prisma-inbox.store';
import type { PrismaService } from '../prisma.service';

/**
 * Shared standalone worker loop for one Reporting projection queue.
 *
 * One delivery = one local transaction: the inbox row, the derived rows and
 * the freshness checkpoint commit together, and the ACK follows the commit.
 * An integrity conflict rolls the transaction back and NACKs; RabbitMQ's
 * quorum delivery limit then dead-letters it, so a contradictory fact is
 * never folded and never silently ACKed.
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

export interface ProjectionWorkerSpec<TEvent extends ParsedEvent> {
  /** Log component of the consumer and of its lifecycle events. */
  readonly component: string;
  /** Log component of the always-on lifecycle events. */
  readonly eventsComponent: string;
  readonly connectionName: string;
  readonly queue: string;
  readonly topology: () => TopologySpec;
  readonly parse: (raw: unknown) => TEvent;
  /** Applies the event's effect inside the inbox transaction. */
  readonly apply: (event: TEvent, tx: Prisma.TransactionClient) => Promise<void>;
  /** Lifecycle event name logged for an integrity conflict. */
  readonly integrityEvent: string;
}

export async function runProjectionWorker<TEvent extends ParsedEvent>(
  spec: ProjectionWorkerSpec<TEvent>,
): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const telemetry = serviceTelemetry('reporting');
  const logger = createLogger({
    service: 'reporting',
    level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'warn',
    base: { component: spec.component },
  });
  // Lifecycle facts are always emitted: they are how operators and the
  // acceptance suite observe commit/ACK ordering without reading payloads.
  const events = createLogger({
    service: 'reporting',
    level: 'info',
    base: { component: spec.eventsComponent },
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
    await runReconnectingInboxLoop<TEvent>({
      broker: { url: requireEnv('BROKER_URL'), connectionName: spec.connectionName, logger },
      topology: spec.topology(),
      signal: controller.signal,
      logger,
      reconnectMinMs: args.reconnectMinMs,
      reconnectMaxMs: args.reconnectMaxMs,
      createConsumer: (channel) =>
        new InboxConsumer<TEvent>({
          telemetry,
          channel,
          queue: spec.queue,
          store,
          parse: spec.parse,
          logger,
          prefetch: args.prefetch,
          effect: async (event, tx) => {
            try {
              await spec.apply(event, tx as Prisma.TransactionClient);
            } catch (error) {
              if (error instanceof OperationsIntegrityError)
                // Identifiers and the stable code only; never the payload.
                emit({
                  event: spec.integrityEvent,
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
        emit({ event: 'consumer_started', queue: spec.queue, connectionNumber });
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

/** Entry-point wrapper: a fatal error is logged and sets a non-zero exit code. */
export function startProjectionWorker<TEvent extends ParsedEvent>(
  spec: ProjectionWorkerSpec<TEvent>,
): void {
  void runProjectionWorker(spec).catch(async (error: unknown) => {
    const telemetry = serviceTelemetry('reporting');
    telemetry.logger.error('worker_fatal', { error });
    await telemetry.shutdown();
    process.exitCode = 1;
  });
}
