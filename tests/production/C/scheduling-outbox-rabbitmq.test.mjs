/**
 * Scheduling outbox -> real RabbitMQ, through the shared OutboxRelay.
 *
 * Real PostgreSQL (runtime role), real RabbitMQ 4.2, compiled scheduling
 * artifacts and the compiled @carwash/platform-messaging relay/publisher.
 * Every received message is validated with the PUBLISHED parser of
 * scheduling.hold-changed.v1 (@carwash/event-contracts business-v1).
 * The test declares the `scheduling.events` exchange itself, standing in for
 * the broker bootstrap that Lane E owns (topology/ACL request in CR-C1).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { amqplib, messaging, publishedContracts, readContext, serviceDist } from './_support.mjs';

const { PrismaService } = serviceDist('scheduling', 'infrastructure/persistence/prisma.service.js');
const { PrismaSchedulingStore } = serviceDist(
  'scheduling',
  'infrastructure/persistence/prisma-scheduling.store.js',
);
const { PrismaOutboxStore } = serviceDist(
  'scheduling',
  'infrastructure/messaging/prisma-outbox.store.js',
);
const { CapacityService, HoldsV1Service } = serviceDist('scheduling', 'application/index.js');
const { BrokerConnection, ConfirmingPublisher, OutboxRelay } = messaging();
const { SCHEDULING_HOLD_CHANGED_V1 } = publishedContracts().events;

let context;
let prisma;
let holds;
let capacity;
let connection;
let consumer;
let queue;
const received = [];
let now = new Date();
const clock = { now: () => new Date(now.getTime()) };
const ids = { next: () => randomUUID() };
const OPS = {
  kind: 'USER',
  principalKind: 'account',
  subject: randomUUID(),
  permissions: ['operations.dispatch'],
};
const BOOKING = { kind: 'SERVICE', clientId: 'booking', scopes: ['scheduling.hold.commit'] };
const meta = (actor, correlationId = randomUUID()) => ({ actor, correlationId });
const key = () => `mq-${randomUUID()}`;

before(async () => {
  context = await readContext();
  prisma = new PrismaService(context.databases.scheduling.appUrl);
  const store = new PrismaSchedulingStore(prisma);
  holds = new HoldsV1Service(store, store, clock, ids);
  capacity = new CapacityService(store, store, clock, ids);
  connection = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-outbox-test',
  });
  consumer = await (await amqplib().connect(context.brokerUrl)).createChannel();
  await consumer.assertExchange('scheduling.events', 'topic', { durable: true });
  queue = (await consumer.assertQueue('', { exclusive: true })).queue;
  await consumer.bindQueue(queue, 'scheduling.events', 'scheduling.#');
  await consumer.consume(queue, (message) => {
    received.push({
      body: JSON.parse(message.content.toString('utf8')),
      properties: message.properties,
      routingKey: message.fields.routingKey,
    });
    consumer.ack(message);
  });
});

after(async () => {
  await consumer?.connection.close();
  await connection?.close();
  await prisma?.client.$disconnect();
});

async function drain(relay) {
  let total = 0;
  for (let i = 0; i < 100; i += 1) {
    const pass = await relay.runOnce();
    total += pass.published;
    if (pass.leased === 0) return total;
  }
  throw new Error('relay did not drain');
}

async function waitReceived(predicate, count = 1, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = received.filter(predicate);
    if (hit.length >= count) return hit;
    await delay(50);
  }
  return received.filter(predicate);
}

function relay(channel = connection.channel) {
  return new OutboxRelay({
    workerId: `relay-${randomUUID().slice(0, 8)}`,
    store: new PrismaOutboxStore(prisma),
    publisher: new ConfirmingPublisher(channel),
    batchSize: 200,
  });
}

async function window(cap = 1, hoursAhead = 2) {
  const startsAt = new Date(now.getTime() + hoursAhead * 3_600_000);
  startsAt.setUTCSeconds(0, 0);
  return (
    await capacity.defineWindow(meta(OPS), {
      zoneId: randomUUID(),
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      capacity: cap,
    })
  ).value;
}

async function hold(w, correlationId = randomUUID()) {
  const who = {
    kind: 'USER',
    principalKind: 'guest',
    subject: randomUUID(),
    permissions: ['bookings.create:self'],
  };
  const response = await holds.createHold(
    meta(who, correlationId),
    {
      beneficiary: { kind: 'guest', subjectId: who.subject },
      zoneId: w.zoneId,
      startsAt: w.startsAt,
      durationMinutes: 30,
      quoteRef: { quoteId: randomUUID(), revision: 1 },
    },
    key(),
  );
  return response.body;
}

test('HELD, COMMITTED and EXPIRED changes are committed with the change and published with confirms', async () => {
  const correlationId = randomUUID();
  const committed = await hold(await window(), correlationId);
  const bookingId = randomUUID();
  await holds.commitHold(
    meta(BOOKING),
    committed.holdId,
    { expectedRevision: 1, bookingId },
    key(),
  );
  const expiring = await hold(await window(1, 3));
  now = new Date(now.getTime() + 601_000);
  await capacity.expireDue(randomUUID(), 500);
  await drain(relay());

  const of = (id) => (m) => m.body.aggregate?.id === id;
  const first = await waitReceived(of(committed.holdId), 2);
  const second = await waitReceived(of(expiring.holdId), 2);
  // Every message passes the PUBLISHED parser unchanged.
  for (const message of [...first, ...second]) {
    const parsed = SCHEDULING_HOLD_CHANGED_V1.parse(message.body);
    assert.equal(parsed.eventType, 'scheduling.hold-changed.v1');
    assert.equal(message.routingKey, 'scheduling.hold-changed.v1');
    assert.equal(
      message.properties.messageId,
      message.body.eventId,
      'broker message id = event id',
    );
  }
  assert.deepEqual(
    first.map((m) => [m.body.data.state, m.body.data.bookingId, m.body.aggregate.version]),
    [
      ['HELD', null, 1],
      ['COMMITTED', bookingId, 2],
    ],
  );
  assert.deepEqual(first[1].body.actor, { kind: 'service', id: 'booking' });
  assert.equal(first[0].body.actor.kind, 'guest');
  assert.equal(
    first[0].properties.correlationId,
    correlationId,
    'correlation crosses request -> outbox -> broker',
  );
  assert.deepEqual(
    second.map((m) => m.body.data.state),
    ['HELD', 'EXPIRED'],
  );
  assert.deepEqual(second[1].body.actor, { kind: 'system', id: null });
  // A second relay pass has nothing left to publish for these holds.
  const before = received.length;
  await drain(relay());
  await delay(300);
  assert.equal(
    received.filter((m) => [committed.holdId, expiring.holdId].includes(m.body.aggregate?.id))
      .length,
    4,
  );
  assert.ok(received.length >= before);
});

test('broker unavailable: rows stay pending and are retried, never marked published', async () => {
  const created = await hold(await window(1, 5));
  const dead = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-dead',
  });
  const channel = dead.channel;
  await dead.close();
  const failing = new OutboxRelay({
    workerId: `relay-${randomUUID().slice(0, 8)}`,
    store: new PrismaOutboxStore(prisma),
    publisher: new ConfirmingPublisher(channel, undefined, 1_000),
    batchSize: 500,
  });
  const pass = await failing.runOnce();
  assert.ok(pass.failed >= 1 && pass.published === 0);
  const [row] = await prisma.client.$queryRawUnsafe(
    `SELECT published_at, attempts, last_error, locked_by FROM app.outbox_message
      WHERE (payload::jsonb -> 'aggregate' ->> 'id') = $1`,
    created.holdId,
  );
  assert.equal(row.published_at, null);
  assert.equal(row.locked_by, null, 'released for the next attempt');
  assert.ok(row.attempts >= 1 && row.last_error);
  await drain(relay());
  assert.equal((await waitReceived((m) => m.body.aggregate?.id === created.holdId)).length, 1);
});

test('lease fencing: a relay whose lease expired cannot finalise the row another relay owns', async () => {
  await hold(await window(1, 7));
  const store = new PrismaOutboxStore(prisma);
  const stale = await store.leaseBatch({
    workerId: 'stale-worker',
    leaseMs: 1,
    limit: 1,
    maxAttempts: 5,
  });
  assert.equal(stale.length, 1);
  await delay(20);
  const fresh = await store.leaseBatch({
    workerId: 'fresh-worker',
    leaseMs: 30_000,
    limit: 1,
    maxAttempts: 5,
  });
  assert.equal(fresh[0]?.id, stale[0].id, 'the expired lease was taken over');
  assert.equal(await store.markPublished({ id: stale[0].id, workerId: 'stale-worker' }), false);
  assert.equal(
    await store.markFailed({
      id: stale[0].id,
      workerId: 'stale-worker',
      error: 'X',
      maxAttempts: 5,
    }),
    false,
  );
  assert.equal(await store.markPublished({ id: stale[0].id, workerId: 'fresh-worker' }), true);
});
