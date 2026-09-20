#!/usr/bin/env node
/**
 * Writes the inbox store and consumer runner for the two subscriber services.
 *
 * communications and reporting subscribe INDEPENDENTLY to the same catalog
 * event. They differ only in which local table the effect lands in, so the
 * generator keeps the transactional part identical while each service still owns
 * its own code, its own queue and its own database.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../acceptance/lib/context.mjs';

const SUBSCRIBERS = {
  communications: { model: 'probeNotification', table: 'probe_notification' },
  reporting: { model: 'probeProjection', table: 'probe_projection' },
};

const store = (service) => `import { Injectable } from '@nestjs/common';
import type { InboxOutcome, InboxRecord, InboxStore } from '@carwash/platform-messaging';
import { PrismaService } from '../prisma.service';

/**
 * ${service}'s inbox storage.
 *
 * The inbox row and the local effect are written by ONE transaction. That single
 * fact is what makes redelivery safe: either both exist or neither does, so a
 * crash cannot leave an applied effect that will be applied again, nor an inbox
 * row claiming an effect that never happened.
 *
 * The ACK is sent by the consumer only after this transaction has committed.
 */
@Injectable()
export class PrismaInboxStore implements InboxStore {
  constructor(private readonly prisma: PrismaService) {}

  async applyOnce(record: InboxRecord, effect: (tx: unknown) => Promise<void>): Promise<InboxOutcome> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const existing = await tx.inboxMessage.findUnique({
          where: { eventId: record.eventId },
        });
        if (existing) {
          // Same id, different bytes: an integrity fault. Never apply it, and
          // never retry it either - retrying cannot change the contradiction.
          return existing.payloadHash === record.payloadHash ? 'DUPLICATE' : 'CONFLICT';
        }
        await tx.inboxMessage.create({
          data: {
            eventId: record.eventId,
            eventType: record.eventType,
            payloadHash: record.payloadHash,
            correlationId: record.correlationId,
          },
        });
        await effect(tx);
        return 'APPLIED';
      });
    } catch (error: unknown) {
      // Two deliveries racing each other: both read "not present", one wins the
      // insert and the loser sees a unique violation. That is a duplicate, not
      // an error worth redelivering.
      if (isUniqueViolation(error)) return 'DUPLICATE';
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  // P2002 = Prisma unique constraint, 23505 = PostgreSQL unique_violation.
  return code === 'P2002' || code === '23505';
}
`;

const runner = (service, model) => `import {
  BrokerConnection,
  InboxConsumer,
  assertTopology,
  subscriberTopology,
} from '@carwash/platform-messaging';
import { parseFoundationProbeCreatedV1, type FoundationProbeCreatedV1 } from '@carwash/event-contracts';
import { createLogger, databaseSchemaFromUrl } from '@carwash/service-kit';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaInboxStore } from './prisma-inbox.store';
import type { PrismaService } from '../prisma.service';

/**
 * Standalone ${service} consumer worker.
 *
 * Runs as its own process so that integration tests can terminate it at an exact
 * point - in particular AFTER the local transaction has committed but BEFORE the
 * ACK - and then prove that redelivery does not duplicate the local effect.
 *
 * Every meaningful step is emitted as one JSON line on stdout so tests can
 * synchronise on observed facts rather than on sleeps.
 */
interface ConsumerArgs {
  readonly stopAfter: number;
  readonly crashBeforeAckAfter: number;
  readonly prefetch: number;
  readonly maxTransientAttempts: number;
}

function parseArgs(argv: readonly string[]): ConsumerArgs {
  const num = (name: string, fallback: number): number => {
    const index = argv.indexOf(\`--\${name}\`);
    if (index < 0) return fallback;
    const value = Number(argv[index + 1]);
    if (!Number.isFinite(value) || value < 0) throw new Error(\`INVALID_ARG_\${name}\`);
    return value;
  };
  return {
    stopAfter: num('stop-after', Number.POSITIVE_INFINITY),
    // 0 disables the crash seam.
    crashBeforeAckAfter: num('crash-before-ack-after', 0),
    prefetch: num('prefetch', 1),
    maxTransientAttempts: num('max-transient-attempts', 3),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name}_REQUIRED\`);
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const logger = createLogger({
    service: '${service}',
    level: (process.env.LOG_LEVEL as 'info') ?? 'info',
    base: { component: 'inbox-consumer' },
  });

  const databaseUrl = requireEnv('DATABASE_URL');
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }, { schema: databaseSchemaFromUrl(databaseUrl) }),
  });
  const store = new PrismaInboxStore({ client } as unknown as PrismaService);

  const emit = (record: Record<string, unknown>): void => {
    process.stdout.write(\`\${JSON.stringify(record)}\\n\`);
  };

  const connection = await BrokerConnection.open({
    url: requireEnv('BROKER_URL'),
    connectionName: '${service}-inbox-consumer',
    logger,
  });
  const topology = subscriberTopology('${service}');
  await assertTopology(connection.channel, topology);
  const queue = topology.queues[0]!.name;

  let handled = 0;
  const consumer = new InboxConsumer<FoundationProbeCreatedV1>({
    channel: connection.channel,
    queue,
    store,
    parse: parseFoundationProbeCreatedV1,
    logger,
    prefetch: args.prefetch,
    maxTransientAttempts: args.maxTransientAttempts,
    effect: async (event, tx) => {
      const transaction = tx as PrismaClient;
      // upsert with an increment rather than a silent no-op: if deduplication
      // ever failed, apply_count would become 2 and the test would see it.
      await transaction.${model}.upsert({
        where: { probeId: event.data.probeId },
        create: { probeId: event.data.probeId, label: event.data.label, applyCount: 1 },
        update: { applyCount: { increment: 1 } },
      });
    },
    onBeforeAck: (event, outcome) => {
      handled += 1;
      emit({
        event: 'consumer_committed',
        service: '${service}',
        eventId: event.eventId,
        probeId: event.data.probeId,
        outcome,
        handled,
      });
      if (args.crashBeforeAckAfter > 0 && handled >= args.crashBeforeAckAfter) {
        emit({ event: 'consumer_crash_before_ack', service: '${service}', eventId: event.eventId });
        // Hard exit: no ACK, no graceful close. The broker must redeliver.
        process.exit(9);
      }
    },
  });

  await consumer.start();
  emit({ event: 'consumer_started', service: '${service}', queue });

  const stop = async (signal: string): Promise<void> => {
    emit({ event: 'consumer_stopping', service: '${service}', signal, stats: consumer.stats });
    await consumer.stop().catch(() => {});
    await connection.close();
    await client.$disconnect();
    emit({ event: 'consumer_stopped', service: '${service}', stats: consumer.stats });
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));

  if (Number.isFinite(args.stopAfter)) {
    const timer = setInterval(() => {
      const total = consumer.stats.applied + consumer.stats.duplicates + consumer.stats.deadLettered;
      if (total >= args.stopAfter) {
        clearInterval(timer);
        void stop('stop-after');
      }
    }, 100);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    \`\${JSON.stringify({ event: 'consumer_fatal', error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' })}\\n\`,
  );
  process.exitCode = 1;
});
`;

for (const [service, { model }] of Object.entries(SUBSCRIBERS)) {
  const dir = path.join(ROOT, 'services', service, 'src', 'inbox');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'prisma-inbox.store.ts'), store(service), 'utf8');
  await writeFile(path.join(dir, 'consumer.runner.ts'), runner(service, model), 'utf8');
  console.log(`wrote services/${service}/src/inbox/{prisma-inbox.store,consumer.runner}.ts`);
}
