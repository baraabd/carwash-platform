/**
 * Dispatch consumes the PUBLISHED `scheduling.hold-changed.v1` from real
 * RabbitMQ through the shared InboxConsumer.
 *
 * Real PostgreSQL (runtime role), real RabbitMQ 4.2 (quorum queue with a
 * broker-enforced delivery limit and dead-letter exchange), compiled dispatch
 * artifacts, compiled @carwash/platform-messaging and @carwash/event-contracts.
 * Messages are built and checked with the published contract parser before
 * they are sent, so the test exercises the contract a real producer must meet.
 * The topology is declared here, standing in for the broker bootstrap that
 * Lane E owns (request in CR-P02-C3).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, messaging, readContext, require, serviceDist, startProcess } from './_support.mjs';

const { SCHEDULING_HOLD_CHANGED_V1 } = require(
  path.join(ROOT, 'packages', 'event-contracts', 'dist', 'index.js'),
);
const { PrismaService } = serviceDist('dispatch', 'infrastructure/persistence/prisma.service.js');
const { PrismaDispatchStore } = serviceDist(
  'dispatch',
  'infrastructure/persistence/prisma-dispatch.store.js',
);
const { holdChangedConsumerParts, SCHEDULING_EVENTS_EXCHANGE, HOLD_CHANGED_ROUTING_KEY } =
  serviceDist('dispatch', 'transport/messaging/hold-changed.consumer.js');
const { systemClock, uuidGenerator } = serviceDist('dispatch', 'infrastructure/runtime/system.js');
const { BrokerConnection, InboxConsumer, assertTopology } = messaging();

const CRASH_CONSUMER = path.join(
  ROOT,
  'tests',
  'production',
  'C',
  'support',
  'dispatch-crash-consumer.mjs',
);
const RUN = randomUUID().slice(0, 8);
const QUEUE = `dispatch.hold-changed.${RUN}`;
const DLX = `dispatch.hold-changed.${RUN}.dlx`;
const DLQ = `dispatch.hold-changed.${RUN}.dlq`;

let context;
let prisma;
let store;
let connection;
let consumer;

before(async () => {
  context = await readContext();
  prisma = new PrismaService(context.databases.dispatch.appUrl);
  store = new PrismaDispatchStore(prisma);
  connection = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-dispatch-inbox',
  });
  await assertTopology(connection.channel, {
    exchanges: [
      { name: SCHEDULING_EVENTS_EXCHANGE, type: 'topic' },
      { name: DLX, type: 'topic' },
    ],
    queues: [
      {
        name: QUEUE,
        deadLetterExchange: DLX,
        deadLetterRoutingKey: HOLD_CHANGED_ROUTING_KEY,
        queueType: 'quorum',
        deliveryLimit: 3,
      },
      { name: DLQ },
    ],
    bindings: [
      { queue: QUEUE, exchange: SCHEDULING_EVENTS_EXCHANGE, routingKey: HOLD_CHANGED_ROUTING_KEY },
      { queue: DLQ, exchange: DLX, routingKey: '#' },
    ],
  });
});

after(async () => {
  await consumer?.stop();
  await connection?.channel.deleteQueue(QUEUE).catch(() => {});
  await connection?.channel.deleteQueue(DLQ).catch(() => {});
  await connection?.channel.deleteExchange(DLX).catch(() => {});
  await connection?.close();
  await prisma?.client.$disconnect();
});

function startConsumer() {
  const parts = holdChangedConsumerParts(store, systemClock, uuidGenerator);
  const instance = new InboxConsumer({
    channel: connection.channel,
    queue: QUEUE,
    store: parts.store,
    parse: parts.parse,
    effect: parts.effect,
  });
  return instance;
}

function holdEvent(hold, version, state, eventId = randomUUID()) {
  const event = {
    eventId,
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: hold.holdId, version },
    actor: { kind: 'service', id: 'booking' },
    data: {
      state,
      zoneId: hold.zoneId,
      startsAt: hold.startsAt,
      endsAt: hold.endsAt,
      bookingId: state === 'COMMITTED' ? hold.bookingId : null,
    },
  };
  // The published parser is the gate: what we send is exactly what the contract admits.
  SCHEDULING_HOLD_CHANGED_V1.parse(event);
  return event;
}

function newHold() {
  const startsAt = new Date(Date.now() + 3 * 3_600_000);
  return {
    holdId: randomUUID(),
    zoneId: randomUUID(),
    bookingId: randomUUID(),
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
  };
}

async function publish(body, routingKey = HOLD_CHANGED_ROUTING_KEY) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  connection.channel.publish(SCHEDULING_EVENTS_EXCHANGE, routingKey, Buffer.from(text), {
    persistent: true,
    contentType: 'application/json',
    messageId: typeof body === 'string' ? randomUUID() : body.eventId,
    correlationId: typeof body === 'string' ? randomUUID() : body.correlationId,
  });
  await connection.channel.waitForConfirms();
}

async function until(probe, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await delay(100);
  }
  throw new Error('condition not reached');
}

const one = async (sql, ...params) =>
  Number((await prisma.client.$queryRawUnsafe(sql, ...params))[0]?.n ?? 0);

async function dlqDepth() {
  return (await connection.channel.checkQueue(DLQ)).messageCount;
}

test('committed hold over RabbitMQ opens one job; a duplicate delivery changes nothing', async () => {
  consumer = startConsumer();
  await consumer.start();
  const hold = newHold();
  const event = holdEvent(hold, 2, 'COMMITTED');
  await publish(event);
  await publish(event); // at-least-once delivery: the same message twice
  await until(() => consumer.stats.applied + consumer.stats.duplicates >= 2);
  assert.equal(consumer.stats.duplicates >= 1, true);
  assert.equal(
    await one(
      `SELECT count(*)::int AS n FROM app.assignment WHERE booking_id = $1::uuid`,
      hold.bookingId,
    ),
    1,
  );
  assert.equal(
    await one(
      `SELECT count(*)::int AS n FROM app.inbox_message WHERE event_id = $1::uuid`,
      event.eventId,
    ),
    1,
  );

  // Out of order on the wire: RELEASED v3 then a late COMMITTED v2 for another hold.
  const late = newHold();
  const released = holdEvent(late, 3, 'RELEASED');
  const committed = holdEvent(late, 2, 'COMMITTED');
  await publish(released);
  await publish(committed);
  const outcomes = await until(async () => {
    const rows = await prisma.client.$queryRawUnsafe(
      `SELECT event_id::text AS id, outcome FROM app.inbox_message WHERE event_id = ANY($1::uuid[])`,
      [released.eventId, committed.eventId],
    );
    return rows.length === 2 ? Object.fromEntries(rows.map((r) => [r.id, r.outcome])) : null;
  });
  assert.equal(outcomes[released.eventId], 'NOTHING_TO_CANCEL');
  assert.equal(outcomes[committed.eventId], 'STALE');
  assert.equal(
    await one(
      `SELECT count(*)::int AS n FROM app.assignment WHERE hold_id = $1::uuid`,
      late.holdId,
    ),
    0,
  );
  await consumer.stop();
  consumer = undefined;
});

test('poison and integrity failures are dead-lettered, never applied or retried forever', async () => {
  consumer = startConsumer();
  await consumer.start();
  const before = await dlqDepth();
  await publish('{not json');
  await publish({ ...holdEvent(newHold(), 2, 'COMMITTED'), producer: 'booking' });
  const hold = newHold();
  const event = holdEvent(hold, 2, 'COMMITTED');
  await publish(event);
  await until(() => consumer.stats.applied >= 1);
  // Same event id, different bytes.
  await publish({ ...event, occurredAt: new Date(0).toISOString() });
  await until(async () => (await dlqDepth()) >= before + 3);
  assert.equal(consumer.stats.deadLettered, 3);
  assert.equal(consumer.stats.conflicts, 1);
  assert.equal(
    await one(
      `SELECT count(*)::int AS n FROM app.assignment WHERE booking_id = $1::uuid`,
      hold.bookingId,
    ),
    1,
  );
  await consumer.stop();
  consumer = undefined;
});

test('crash after commit, before ACK (SIGKILL): redelivery is a no-op, the job exists once', async () => {
  const child = startProcess(
    CRASH_CONSUMER,
    {
      CW_PROD_C_CONTEXT:
        process.env.CW_PROD_C_CONTEXT ?? path.join(context.workDir, 'context.json'),
    },
    [QUEUE],
  );
  try {
    await child.waitFor((line) => line.msg === 'consuming');
    const hold = newHold();
    const event = holdEvent(hold, 2, 'COMMITTED');
    await publish(event);
    const committed = await child.waitFor((line) => line.msg === 'committed');
    assert.equal(committed.eventId, event.eventId);
    assert.equal(committed.outcome, 'APPLIED');
    await child.kill(); // no ACK was ever sent
    assert.equal(
      await one(
        `SELECT count(*)::int AS n FROM app.assignment WHERE booking_id = $1::uuid`,
        hold.bookingId,
      ),
      1,
      'the effect committed before the crash',
    );

    consumer = startConsumer();
    await consumer.start();
    await until(() => consumer.stats.duplicates >= 1);
    assert.equal(consumer.stats.applied, 0, 'the redelivered message was not applied again');
    assert.equal(
      await one(
        `SELECT count(*)::int AS n FROM app.assignment WHERE booking_id = $1::uuid`,
        hold.bookingId,
      ),
      1,
    );
    assert.equal(
      await one(
        `SELECT count(*)::int AS n FROM app.outbox_message WHERE payload::jsonb ->> 'causationId' = $1`,
        event.eventId,
      ),
      1,
      'exactly one assignment-changed event for the one effect',
    );
    const queue = await connection.channel.checkQueue(QUEUE);
    assert.equal(queue.messageCount, 0);
  } finally {
    await child.kill();
    await consumer?.stop();
    consumer = undefined;
  }
});
