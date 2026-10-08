/**
 * Dispatch outbox -> real RabbitMQ, through the shared OutboxRelay.
 *
 * Real PostgreSQL (runtime role), real RabbitMQ 4.2, compiled dispatch
 * artifacts and the compiled @carwash/platform-messaging relay/publisher.
 * `dispatch.assignment-changed.v1` is PRODUCER-PENDING (requested from Lane E
 * in CR-P02-C3): received messages are checked with the PUBLISHED envelope-v2
 * parser plus the requested data shape, nothing more is claimed.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, amqplib, messaging, readContext, require, serviceDist } from './_support.mjs';

const { parseEnvelopeV2 } = require(
  path.join(ROOT, 'packages', 'event-contracts', 'dist', 'index.js'),
);
const { PrismaService } = serviceDist('dispatch', 'infrastructure/persistence/prisma.service.js');
const { PrismaDispatchStore } = serviceDist(
  'dispatch',
  'infrastructure/persistence/prisma-dispatch.store.js',
);
const { PrismaOutboxStore } = serviceDist(
  'dispatch',
  'infrastructure/messaging/prisma-outbox.store.js',
);
const { DispatchService, HoldChangeHandler, parseHoldChanged } = serviceDist(
  'dispatch',
  'application/index.js',
);
const { PrismaInboxStore } = serviceDist(
  'dispatch',
  'infrastructure/messaging/prisma-inbox.store.js',
);
const { BrokerConnection, ConfirmingPublisher, OutboxRelay } = messaging();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = ['UNASSIGNED', 'OFFERED', 'ASSIGNED', 'CANCELLED'];

/** The REQUESTED data shape (CR-P02-C3 §1), closed and PII-free. */
function parseAssignmentData(data) {
  const keys = ['bookingId', 'status', 'zoneId', 'startsAt', 'endsAt', 'resourceId'];
  if (typeof data !== 'object' || data === null) throw new Error('EXPECTED_OBJECT');
  if (Object.keys(data).length !== keys.length || keys.some((k) => !Object.hasOwn(data, k)))
    throw new Error('UNEXPECTED_EVENT_FIELDS');
  if (!UUID.test(data.bookingId) || !UUID.test(data.zoneId)) throw new Error('INVALID_UUID');
  if (!STATUSES.includes(data.status)) throw new Error('INVALID_STATUS');
  if ((data.status === 'ASSIGNED') !== (data.resourceId !== null))
    throw new Error('INVALID_RESOURCE');
  if (!(Date.parse(data.endsAt) > Date.parse(data.startsAt))) throw new Error('INVALID_WINDOW');
  return data;
}

const parseAssignmentChanged = (raw) =>
  parseEnvelopeV2(
    raw,
    {
      eventType: 'dispatch.assignment-changed.v1',
      producer: 'dispatch',
      aggregateType: 'assignment',
    },
    parseAssignmentData,
  );

let context;
let prisma;
let store;
let connection;
let consumer;
const received = [];
const clock = { now: () => new Date() };
const ids = { next: () => randomUUID() };
const OPS = { kind: 'USER', subject: randomUUID(), permissions: ['operations.dispatch'] };

before(async () => {
  context = await readContext();
  prisma = new PrismaService(context.databases.dispatch.appUrl);
  store = new PrismaDispatchStore(prisma);
  connection = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-dispatch-outbox',
  });
  consumer = await (await amqplib().connect(context.brokerUrl)).createChannel();
  await consumer.assertExchange('dispatch.events', 'topic', { durable: true });
  const { queue } = await consumer.assertQueue('', { exclusive: true });
  await consumer.bindQueue(queue, 'dispatch.events', 'dispatch.#');
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
  for (let i = 0; i < 200; i += 1) {
    const pass = await relay.runOnce();
    if (pass.leased === 0) return;
  }
  throw new Error('relay did not drain');
}

async function waitReceived(predicate, minimum, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = received.filter(predicate);
    if (hit.length >= minimum) return hit;
    await delay(50);
  }
  return received.filter(predicate);
}

test('assignment changes commit with their events and reach the broker exactly as written', async () => {
  // Open a job through the inbox path (causation = the scheduling event id).
  const startsAt = new Date(Date.now() + 5 * 3_600_000);
  const hold = { holdId: randomUUID(), zoneId: randomUUID(), bookingId: randomUUID() };
  const sourceEventId = randomUUID();
  const raw = {
    eventId: sourceEventId,
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: hold.holdId, version: 2 },
    actor: { kind: 'service', id: 'booking' },
    data: {
      state: 'COMMITTED',
      zoneId: hold.zoneId,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      bookingId: hold.bookingId,
    },
  };
  const message = parseHoldChanged(raw);
  const handler = new HoldChangeHandler(clock, ids);
  await new PrismaInboxStore(store).applyOnce(
    {
      eventId: message.eventId,
      eventType: message.eventType,
      payloadHash: 'a'.repeat(64),
      correlationId: message.correlationId,
    },
    (tx) => handler.apply(tx, message),
  );
  const service = new DispatchService(store, store, clock, ids);
  const assignment = await store.findAssignmentByBooking(hold.bookingId);
  const correlationId = randomUUID();
  const tech = { kind: 'USER', subject: randomUUID(), permissions: ['work.execute:assigned'] };
  const { value } = await service.offer(
    { actor: OPS, correlationId },
    assignment.id,
    { expectedRevision: 1, resourceId: randomUUID(), technicianSubject: tech.subject },
    `mq-${randomUUID()}`,
  );
  await service.acceptOffer(
    { actor: tech, correlationId: randomUUID() },
    value.offer.id,
    `mq-${randomUUID()}`,
  );

  const relay = new OutboxRelay({
    workerId: `relay-${randomUUID().slice(0, 8)}`,
    store: new PrismaOutboxStore(prisma),
    publisher: new ConfirmingPublisher(connection.channel),
    batchSize: 200,
  });
  await drain(relay);

  const mine = (m) => m.body.aggregate?.id === assignment.id;
  const events = await waitReceived(mine, 3);
  assert.equal(events.length, 3);
  const parsed = events.map((m) => parseAssignmentChanged(m.body));
  assert.deepEqual(
    parsed.map((e) => [e.aggregate.version, e.data.status]),
    [
      [1, 'UNASSIGNED'],
      [2, 'OFFERED'],
      [3, 'ASSIGNED'],
    ],
  );
  assert.equal(
    parsed[0].causationId,
    sourceEventId,
    'the job event names the hold event that caused it',
  );
  assert.deepEqual(parsed[0].actor, { kind: 'system', id: null });
  assert.deepEqual(parsed[1].actor, { kind: 'account', id: OPS.subject });
  assert.equal(
    events[1].properties.correlationId,
    correlationId,
    'correlation crosses command -> outbox -> broker',
  );
  assert.equal(events[1].properties.messageId, events[1].body.eventId);
  assert.equal(events[1].routingKey, 'dispatch.assignment-changed.v1');
  for (const event of events) {
    const text = JSON.stringify(event.body.data);
    assert.ok(!text.includes(tech.subject), 'event data carries no technician identity');
  }

  // A second drain publishes nothing more for these rows.
  const before = received.filter(mine).length;
  await drain(relay);
  await delay(300);
  assert.equal(received.filter(mine).length, before);
});

test('broker unavailable: rows stay pending and are retried, never marked published', async () => {
  const startsAt = new Date(Date.now() + 9 * 3_600_000);
  const bookingId = randomUUID();
  const raw = {
    eventId: randomUUID(),
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: randomUUID(), version: 2 },
    actor: { kind: 'service', id: 'booking' },
    data: {
      state: 'COMMITTED',
      zoneId: randomUUID(),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      bookingId,
    },
  };
  const message = parseHoldChanged(raw);
  await new PrismaInboxStore(store).applyOnce(
    {
      eventId: message.eventId,
      eventType: message.eventType,
      payloadHash: 'b'.repeat(64),
      correlationId: message.correlationId,
    },
    (tx) => new HoldChangeHandler(clock, ids).apply(tx, message),
  );
  const assignment = await store.findAssignmentByBooking(bookingId);
  const dead = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-dispatch-dead',
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
    `SELECT published_at, locked_by, attempts, last_error FROM app.outbox_message
      WHERE payload::jsonb -> 'aggregate' ->> 'id' = $1`,
    assignment.id,
  );
  assert.equal(row.published_at, null);
  assert.equal(row.locked_by, null);
  assert.ok(row.attempts >= 1 && row.last_error);
  await drain(
    new OutboxRelay({
      workerId: `relay-${randomUUID().slice(0, 8)}`,
      store: new PrismaOutboxStore(prisma),
      publisher: new ConfirmingPublisher(connection.channel),
      batchSize: 500,
    }),
  );
  assert.equal((await waitReceived((m) => m.body.aggregate?.id === assignment.id, 1)).length, 1);
});
