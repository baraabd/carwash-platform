/**
 * P04-C1: booking commitment changes -> outbox -> real RabbitMQ.
 *
 * Real PostgreSQL (runtime role), real RabbitMQ 4.2, compiled scheduling
 * artifacts and the compiled @carwash/platform-messaging relay. Every message
 * is validated with the PUBLISHED parser of scheduling.hold-changed.v1.
 *
 * What Dispatch relies on (P04-C2): a reschedule publishes the old hold's
 * RELEASED and the new hold's COMMITTED for the SAME booking, both from one
 * transaction and each exactly once; a cancellation publishes RELEASED once,
 * however often Booking retries it. The two holds are different aggregates:
 * their relative order is NOT guaranteed (one transaction stamps both rows
 * with the same created_at), so no consumer may depend on it.
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
const { CapacityService, CommitmentsService, HoldsV1Service } = serviceDist(
  'scheduling',
  'application/index.js',
);
const { BrokerConnection, ConfirmingPublisher, OutboxRelay } = messaging();
const { SCHEDULING_HOLD_CHANGED_V1 } = publishedContracts().events;

let prisma;
let holds;
let capacity;
let commitments;
let connection;
let consumer;
let queue;
const received = [];
const now = new Date();
const clock = { now: () => new Date(now.getTime()) };
const ids = { next: () => randomUUID() };
const OPS = {
  kind: 'USER',
  principalKind: 'account',
  subject: randomUUID(),
  permissions: ['operations.dispatch'],
};
const BOOKING = {
  kind: 'SERVICE',
  clientId: 'booking',
  scopes: ['scheduling.hold.commit', 'scheduling.commitment.change'],
};
const meta = (actor, correlationId = randomUUID()) => ({ actor, correlationId });
const key = () => `mq-${randomUUID()}`;

before(async () => {
  const context = await readContext();
  prisma = new PrismaService(context.databases.scheduling.appUrl);
  const store = new PrismaSchedulingStore(prisma);
  holds = new HoldsV1Service(store, store, clock, ids);
  capacity = new CapacityService(store, store, clock, ids);
  commitments = new CommitmentsService(store, store, clock, ids);
  connection = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-commitment-test',
  });
  consumer = await (await amqplib().connect(context.brokerUrl)).createChannel();
  await consumer.assertExchange('scheduling.events', 'topic', { durable: true });
  queue = (await consumer.assertQueue('', { exclusive: true })).queue;
  await consumer.bindQueue(queue, 'scheduling.events', 'scheduling.#');
  await consumer.consume(queue, (message) => {
    received.push({
      body: JSON.parse(message.content.toString('utf8')),
      properties: message.properties,
    });
    consumer.ack(message);
  });
});

after(async () => {
  await consumer?.connection.close();
  await connection?.close();
  await prisma?.client.$disconnect();
});

async function drain() {
  const relay = new OutboxRelay({
    workerId: `relay-${randomUUID().slice(0, 8)}`,
    store: new PrismaOutboxStore(prisma),
    publisher: new ConfirmingPublisher(connection.channel),
    batchSize: 200,
  });
  for (let i = 0; i < 100; i += 1) {
    if ((await relay.runOnce()).leased === 0) return;
  }
  throw new Error('relay did not drain');
}

async function waitFor(predicate, count, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (received.filter(predicate).length >= count) break;
    await delay(50);
  }
  return received.filter(predicate);
}

async function window(zoneId, hoursAhead) {
  const startsAt = new Date(now.getTime() + hoursAhead * 3_600_000);
  startsAt.setUTCSeconds(0, 0);
  return (
    await capacity.defineWindow(meta(OPS), {
      zoneId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      capacity: 1,
    })
  ).value;
}

async function hold(who, w) {
  const response = await holds.createHold(
    meta(who),
    {
      beneficiary: { kind: who.principalKind, subjectId: who.subject },
      zoneId: w.zoneId,
      startsAt: w.startsAt,
      durationMinutes: 30,
      quoteRef: { quoteId: randomUUID(), revision: 1 },
    },
    key(),
  );
  return response.body;
}

const guest = () => ({
  kind: 'USER',
  principalKind: 'guest',
  subject: randomUUID(),
  permissions: ['bookings.create:self'],
});

test('a reschedule publishes RELEASED(old) and COMMITTED(new) for one booking, once each', async () => {
  const zoneId = randomUUID();
  const who = guest();
  const origin = await hold(who, await window(zoneId, 2));
  const bookingId = randomUUID();
  await holds.commitHold(meta(BOOKING), origin.holdId, { expectedRevision: 1, bookingId }, key());
  const target = await hold(who, await window(zoneId, 5));
  const correlationId = randomUUID();
  const body = { fromHoldId: origin.holdId, toHoldId: target.holdId, toExpectedRevision: 1 };
  await commitments.replaceCommitment(meta(BOOKING, correlationId), bookingId, body, key());
  // Booking lost the response and retried with a new key: nothing new is published.
  await commitments.replaceCommitment(meta(BOOKING), bookingId, body, key());
  await drain();

  const ofChange = (m) => m.body.correlationId === correlationId;
  const change = await waitFor(ofChange, 2);
  await delay(300);
  assert.equal(received.filter(ofChange).length, 2, 'exactly two events for the change');
  for (const message of change) SCHEDULING_HOLD_CHANGED_V1.parse(message.body);
  const byHold = (id) => change.find((m) => m.body.aggregate.id === id);
  assert.deepEqual(
    [byHold(origin.holdId), byHold(target.holdId)].map((m) => [
      m.body.aggregate.id,
      m.body.data.state,
      m.body.data.bookingId,
      m.body.aggregate.version,
    ]),
    [
      [origin.holdId, 'RELEASED', null, 3],
      [target.holdId, 'COMMITTED', bookingId, 2],
    ],
  );
  for (const message of change) {
    assert.deepEqual(message.body.actor, { kind: 'service', id: 'booking' });
    assert.equal(message.properties.correlationId, correlationId);
  }
});

test('a cancellation retried five times publishes RELEASED once', async () => {
  const who = guest();
  const origin = await hold(who, await window(randomUUID(), 3));
  const bookingId = randomUUID();
  await holds.commitHold(meta(BOOKING), origin.holdId, { expectedRevision: 1, bookingId }, key());
  for (let i = 0; i < 5; i += 1) {
    await commitments.releaseCommitment(meta(BOOKING), bookingId, { holdId: origin.holdId }, key());
  }
  await drain();
  const of = (m) => m.body.aggregate?.id === origin.holdId;
  await waitFor(of, 3);
  await delay(300);
  const states = received
    .filter(of)
    .map((m) => SCHEDULING_HOLD_CHANGED_V1.parse(m.body).data.state);
  assert.deepEqual(states, ['HELD', 'COMMITTED', 'RELEASED']);
});
