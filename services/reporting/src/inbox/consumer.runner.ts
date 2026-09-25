import {
  InboxConsumer,
  runReconnectingInboxLoop,
  subscriberQueueName,
  subscriberTopology,
} from '@carwash/platform-messaging';
import {
  parseFoundationProbeCreatedV1,
  type FoundationProbeCreatedV1,
} from '@carwash/event-contracts';
import { createLogger, databaseSchemaFromUrl } from '@carwash/service-kit';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaInboxStore } from './prisma-inbox.store';
import type { PrismaService } from '../prisma.service';

/**
 * Standalone reporting consumer worker.
 *
 * RabbitMQ owns durable queue state and the quorum delivery limit; this process
 * owns only a reconnect loop and the local transactional Inbox/effect. A broker
 * restart therefore recreates the connection/channel/consumer session without
 * resetting the retry budget.
 */
interface ConsumerArgs {
  readonly stopAfter: number;
  readonly crashBeforeAckAfter: number;
  readonly prefetch: number;
  /** Acceptance-only fault seam: fail the local transaction before any effect. */
  readonly failEffect: boolean;
  readonly reconnectMinMs: number;
  readonly reconnectMaxMs: number;
}

function parseArgs(argv: readonly string[]): ConsumerArgs {
  const num = (name: string, fallback: number): number => {
    const index = argv.indexOf(`--${name}`);
    if (index < 0) return fallback;
    const value = Number(argv[index + 1]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`INVALID_ARG_${name}`);
    return value;
  };
  return {
    stopAfter: num('stop-after', Number.POSITIVE_INFINITY),
    // 0 disables the crash seam.
    crashBeforeAckAfter: num('crash-before-ack-after', 0),
    prefetch: num('prefetch', 1),
    failEffect: argv.includes('--fail-effect'),
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
  const logger = createLogger({
    service: 'reporting',
    level: (process.env.LOG_LEVEL as 'info') ?? 'info',
    base: { component: 'inbox-consumer' },
  });

  const databaseUrl = requireEnv('DATABASE_URL');
  const client = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: databaseUrl },
      { schema: databaseSchemaFromUrl(databaseUrl) },
    ),
  });
  const store = new PrismaInboxStore({ client } as unknown as PrismaService);
  const topology = subscriberTopology('reporting');
  const queue = subscriberQueueName('reporting');
  const controller = new AbortController();

  let handled = 0;
  let connections = 0;
  let stopping = false;

  const emit = (record: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  };

  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    emit({ event: 'consumer_stopping', service: 'reporting', signal, handled, connections });
    controller.abort();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  try {
    await runReconnectingInboxLoop<FoundationProbeCreatedV1>({
      broker: {
        url: requireEnv('BROKER_URL'),
        connectionName: 'reporting-inbox-consumer',
        logger,
      },
      topology,
      signal: controller.signal,
      logger,
      reconnectMinMs: args.reconnectMinMs,
      reconnectMaxMs: args.reconnectMaxMs,
      createConsumer: (channel) =>
        new InboxConsumer<FoundationProbeCreatedV1>({
          channel,
          queue,
          store,
          parse: parseFoundationProbeCreatedV1,
          logger,
          prefetch: args.prefetch,
          effect: async (event, tx) => {
            if (args.failEffect) throw new Error('SIMULATED_TRANSIENT_EFFECT_FAILURE');
            const transaction = tx as PrismaClient;
            // Increment on update makes any dedupe defect observable.
            await transaction.probeProjection.upsert({
              where: { probeId: event.data.probeId },
              create: { probeId: event.data.probeId, label: event.data.label, applyCount: 1 },
              update: { applyCount: { increment: 1 } },
            });
          },
          onBeforeAck: (event, outcome) => {
            handled += 1;
            emit({
              event: 'consumer_committed',
              service: 'reporting',
              eventId: event.eventId,
              probeId: event.data.probeId,
              outcome,
              handled,
            });
            if (args.crashBeforeAckAfter > 0 && handled >= args.crashBeforeAckAfter) {
              emit({
                event: 'consumer_crash_before_ack',
                service: 'reporting',
                eventId: event.eventId,
              });
              process.exit(9);
            }
            if (Number.isFinite(args.stopAfter) && handled >= args.stopAfter) {
              // ACK is synchronous and happens immediately after this hook
              // returns; abort on the next turn so shutdown cannot race it.
              setImmediate(() => stop('stop-after'));
            }
          },
        }),
      onConnected: ({ connectionNumber }) => {
        connections = connectionNumber;
        emit({
          event: 'consumer_started',
          service: 'reporting',
          queue,
          connectionNumber,
          reconnected: connectionNumber > 1,
        });
      },
      onDisconnected: ({ connectionNumber }) => {
        emit({ event: 'consumer_disconnected', service: 'reporting', connectionNumber });
      },
      onUnavailable: ({ error, nextDelayMs }) => {
        emit({
          event: 'consumer_broker_unavailable',
          service: 'reporting',
          error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          nextDelayMs,
        });
      },
    });
  } finally {
    await client.$disconnect();
    emit({ event: 'consumer_stopped', service: 'reporting', handled, connections });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ event: 'consumer_fatal', error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' })}\n`,
  );
  process.exitCode = 1;
});
