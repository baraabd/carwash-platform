/**
 * Booking outbox -> real RabbitMQ, through the shared OutboxRelay.
 *
 * Real PostgreSQL (runtime role), real RabbitMQ 4.2, the COMPILED booking
 * release artifacts (dist/) and the compiled @carwash/platform-messaging
 * relay/publisher. Owner services are the in-process port doubles of the
 * booking test support (declared in the evidence). The test declares the
 * `booking.events` exchange itself, standing in for the broker bootstrap that
 * Lane E owns (topology/ACL request in CR-P02-C2).
 *
 * booking.created.v1 is a REQUESTED (unpublished) contract; nothing here
 * claims a deployed relay. The relay process is blocked on the
 * @carwash/platform-messaging dependency (CR-P02-C2 §2).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, amqplib, messaging, readContext, require, serviceDist } from './_support.mjs';

const { PrismaService } = serviceDist('booking', 'infrastructure/persistence/prisma.service.js');
const { PrismaBookingStore } = serviceDist(
  'booking',
  'infrastructure/persistence/prisma-booking.store.js',
);
const { PrismaOutboxStore } = serviceDist(
  'booking',
  'infrastructure/messaging/prisma-outbox.store.js',
);
const { BookingProcessManager, BookingService } = serviceDist('booking', 'application/index.js');
const support = require(
  path.join(ROOT, 'services', 'booking', 'dist-tests', 'test', 'integration', 'support.js'),
);
const { parseEnvelopeV2 } = require(
  path.join(ROOT, 'packages', 'event-contracts', 'dist', 'envelope-v2.js'),
);
const { BrokerConnection, ConfirmingPublisher, OutboxRelay } = messaging();

let context;
let prisma;
let service;
let connection;
let consumer;
const received = [];
const o = support.owners();

before(async () => {
  context = await readContext();
  prisma = new PrismaService(context.databases.booking.appUrl);
  const store = new PrismaBookingStore(prisma, { sagaLeaseMs: 30_000 });
  const ids = { next: () => randomUUID() };
  const saga = new BookingProcessManager({
    store,
    quotes: o.pricing,
    billing: o.billing,
    holds: o.scheduling,
    clock: o.clock,
    ids,
    random: { next: () => 0.5 },
    observer: support.silent,
    leaseMs: 30_000,
    traceparent: () => '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  });
  service = new BookingService({
    store,
    quotes: o.pricing,
    holds: o.scheduling,
    vehicles: o.snapshots.vehicles,
    addresses: o.snapshots.addresses,
    saga,
    clock: o.clock,
    ids,
    observer: support.silent,
    instanceId: 'mq-test',
    inlineBudgetMs: 5_000,
    claimLeaseMs: 30_000,
  });
  connection = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-booking-outbox',
  });
  consumer = await (await amqplib().connect(context.brokerUrl)).createChannel();
  await consumer.assertExchange('booking.events', 'topic', { durable: true });
  const { queue } = await consumer.assertQueue('', { exclusive: true });
  await consumer.bindQueue(queue, 'booking.events', 'booking.#');
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

async function confirmed() {
  const who = support.customer();
  const meta = who.meta();
  const result = await service.create(meta, support.key(), support.bookingBody(o, who.principal));
  assert.equal(result.view.booking.status, 'CONFIRMED');
  return { id: result.view.booking.id, correlationId: meta.correlationId };
}

function relay(
  publisherChannel = connection.channel,
  workerId = `relay-${randomUUID().slice(0, 8)}`,
) {
  return new OutboxRelay({
    workerId,
    store: new PrismaOutboxStore(prisma),
    publisher: new ConfirmingPublisher(publisherChannel),
    batchSize: 500,
  });
}

async function drain(r) {
  for (let i = 0; i < 100; i += 1) {
    const pass = await r.runOnce();
    if (pass.leased === 0) return;
  }
  throw new Error('relay did not drain');
}

async function waitFor(predicate, count = 1, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hits = received.filter(predicate);
    if (hits.length >= count) return hits;
    await delay(50);
  }
  return received.filter(predicate);
}

test('booking.created.v1 is committed with the confirmation and published with confirms, once', async () => {
  const { id, correlationId } = await confirmed();
  await drain(relay());
  const mine = (m) => m.body.aggregate?.id === id;
  const hits = await waitFor(mine);
  assert.equal(hits.length, 1);
  const [message] = hits;
  assert.equal(message.routingKey, 'booking.created.v1');
  assert.equal(
    message.properties.messageId,
    message.body.eventId,
    'broker message id is the event id',
  );
  assert.equal(
    message.properties.correlationId,
    correlationId,
    'correlation crosses request -> saga -> outbox -> broker',
  );
  assert.equal(
    message.properties.headers.traceparent,
    '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  );
  const parsed = parseEnvelopeV2(
    message.body,
    { eventType: 'booking.created.v1', producer: 'booking', aggregateType: 'booking' },
    (d) => d,
  );
  assert.equal(parsed.data.status, 'CONFIRMED');
  assert.equal(parsed.data.total.amountMinor, '9000000');
  for (const secret of ['سارة', '+963912345678', 'قرب الدوار']) {
    assert.equal(JSON.stringify(message.body).includes(secret), false);
  }
  const [row] = await prisma.client.$queryRawUnsafe(
    `SELECT published_at, attempts FROM app.outbox_message WHERE payload::jsonb #>> '{aggregate,id}' = $1`,
    id,
  );
  assert.ok(row.published_at !== null);
  assert.equal(row.attempts, 1);
  await drain(relay());
  await delay(300);
  assert.equal(received.filter(mine).length, 1, 'nothing left to republish');
});

test('broker unavailable: the event stays pending, is retried, and is published once the broker is back', async () => {
  const { id } = await confirmed();
  const dead = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-booking-dead',
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
    `SELECT published_at, locked_by, last_error FROM app.outbox_message WHERE payload::jsonb #>> '{aggregate,id}' = $1`,
    id,
  );
  assert.equal(row.published_at, null, 'a failed publish is never marked published');
  assert.equal(row.locked_by, null);
  assert.ok(row.last_error);
  await drain(relay());
  assert.equal((await waitFor((m) => m.body.aggregate?.id === id)).length, 1);
});

test('relay crash after publish, before marking: redelivered with the SAME event id (at-least-once)', async () => {
  const { id } = await confirmed();
  const store = new PrismaOutboxStore(prisma);
  // A relay leases the row, publishes it, then dies before markPublished.
  let leased = [];
  for (
    let i = 0;
    i < 50 && !leased.some((r) => JSON.parse(r.payload).aggregate.id === id);
    i += 1
  ) {
    leased = await store.leaseBatch({
      workerId: 'crashed-relay',
      leaseMs: 200,
      limit: 500,
      maxAttempts: 10,
    });
  }
  const record = leased.find((r) => JSON.parse(r.payload).aggregate.id === id);
  assert.ok(record, 'the booking event was leased');
  await new ConfirmingPublisher(connection.channel).publish({
    exchange: record.exchange,
    routingKey: record.routingKey,
    body: record.payload,
    messageId: record.eventId,
    eventType: record.eventType,
    correlationId: record.correlationId,
  });
  await delay(250); // the crashed relay's lease expires
  await drain(relay());
  const copies = await waitFor((m) => m.body.aggregate?.id === id, 2);
  assert.equal(copies.length, 2, 'the event is delivered again after the crash');
  assert.equal(
    new Set(copies.map((c) => c.body.eventId)).size,
    1,
    'duplicates share one event id for inbox dedupe',
  );
  assert.equal(
    await store.markPublished({ id: record.id, workerId: 'crashed-relay' }),
    false,
    'the crashed relay is fenced off',
  );
});
