/**
 * Scheduling outbox -> real RabbitMQ, through the shared OutboxRelay.
 *
 * Real PostgreSQL (runtime role), real RabbitMQ 4.2, compiled scheduling
 * artifacts and the compiled @carwash/platform-messaging relay/publisher.
 * The test declares the `scheduling.events` exchange itself, standing in for
 * the broker bootstrap that Lane E owns (topology/ACL request in CR-C1).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { amqplib, messaging, readContext, serviceDist } from './_support.mjs';

const { PrismaService } = serviceDist('scheduling', 'infrastructure/persistence/prisma.service.js');
const { PrismaSchedulingStore } = serviceDist(
  'scheduling',
  'infrastructure/persistence/prisma-scheduling.store.js',
);
const { PrismaOutboxStore } = serviceDist(
  'scheduling',
  'infrastructure/messaging/prisma-outbox.store.js',
);
const { SchedulingService } = serviceDist('scheduling', 'application/index.js');
const { BrokerConnection, ConfirmingPublisher, OutboxRelay } = messaging();

let context;
let prisma;
let service;
let connection;
let consumer;
let queue;
const received = [];
let now = new Date();
const clock = { now: () => new Date(now.getTime()) };
const ids = { next: () => randomUUID() };
const OPS = { kind: 'USER', subject: randomUUID(), permissions: ['operations.dispatch'] };
const BOOKING = { kind: 'SERVICE', clientId: 'booking', scopes: ['scheduling.holds.write'] };
const meta = (actor) => ({ actor, correlationId: randomUUID() });

before(async () => {
  context = await readContext();
  prisma = new PrismaService(context.databases.scheduling.appUrl);
  const store = new PrismaSchedulingStore(prisma);
  service = new SchedulingService(store, store, clock, ids);
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

async function waitReceived(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = received.filter(predicate);
    if (hit.length > 0) return hit;
    await delay(50);
  }
  return [];
}

test('hold-created and hold-expired are committed with the change and published with confirms', async () => {
  const startsAt = new Date(now.getTime() + 2 * 3_600_000);
  const { value: window } = await service.defineWindow(meta(OPS), {
    zoneId: randomUUID(),
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    capacity: 1,
  });
  const correlationId = randomUUID();
  const { value: hold } = await service.acquireHold(
    { actor: BOOKING, correlationId },
    {
      windowId: window.id,
      holderRef: randomUUID(),
      units: 1,
      ttlSeconds: 60,
      idempotencyKey: `mq-${randomUUID()}`,
    },
  );
  now = new Date(now.getTime() + 61_000);
  await service.expireDue(randomUUID(), 100);

  const relay = new OutboxRelay({
    workerId: `relay-${randomUUID().slice(0, 8)}`,
    store: new PrismaOutboxStore(prisma),
    publisher: new ConfirmingPublisher(connection.channel),
    batchSize: 200,
  });
  await drain(relay);

  const mine = (m) => m.body.data?.holdId === hold.id;
  const created = await waitReceived(
    (m) => mine(m) && m.body.eventType === 'scheduling.hold-created.v1',
  );
  const expired = await waitReceived(
    (m) => mine(m) && m.body.eventType === 'scheduling.hold-expired.v1',
  );
  assert.equal(created.length, 1);
  assert.equal(expired.length, 1);
  assert.equal(created[0].routingKey, 'scheduling.hold-created.v1');
  assert.equal(
    created[0].properties.messageId,
    created[0].body.eventId,
    'broker message id is the event id',
  );
  assert.equal(
    created[0].properties.correlationId,
    correlationId,
    'correlation crosses HTTP -> outbox -> broker',
  );
  assert.equal(created[0].body.producer, 'scheduling');
  assert.equal(expired[0].body.data.expiredAt, new Date(hold.expiresAt.getTime()).toISOString());

  const rows = await prisma.client.$queryRawUnsafe(
    `SELECT published_at, attempts FROM app.outbox_message WHERE (payload::jsonb -> 'data' ->> 'holdId') = $1`,
    hold.id,
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.published_at !== null && r.attempts === 1));

  // A second relay pass has nothing left to publish for these rows.
  const before = received.filter(mine).length;
  await drain(relay);
  await delay(300);
  assert.equal(received.filter(mine).length, before);
});

test('broker unavailable: rows stay pending and are retried, never marked published', async () => {
  const startsAt = new Date(now.getTime() + 4 * 3_600_000);
  const { value: window } = await service.defineWindow(meta(OPS), {
    zoneId: randomUUID(),
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    capacity: 1,
  });
  const { value: hold } = await service.acquireHold(meta(BOOKING), {
    windowId: window.id,
    holderRef: randomUUID(),
    units: 1,
    idempotencyKey: `mq-${randomUUID()}`,
  });
  const dead = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-dead',
  });
  const channel = dead.channel;
  await dead.close();
  const relay = new OutboxRelay({
    workerId: `relay-${randomUUID().slice(0, 8)}`,
    store: new PrismaOutboxStore(prisma),
    publisher: new ConfirmingPublisher(channel, undefined, 1_000),
    batchSize: 500,
  });
  const pass = await relay.runOnce();
  assert.ok(pass.failed >= 1 && pass.published === 0);
  const [row] = await prisma.client.$queryRawUnsafe(
    `SELECT published_at, attempts, last_error, locked_by FROM app.outbox_message
      WHERE (payload::jsonb -> 'data' ->> 'holdId') = $1`,
    hold.id,
  );
  assert.equal(row.published_at, null);
  assert.equal(row.locked_by, null, 'released for the next attempt');
  assert.ok(row.attempts >= 1 && row.last_error);

  const healthy = new OutboxRelay({
    workerId: `relay-${randomUUID().slice(0, 8)}`,
    store: new PrismaOutboxStore(prisma),
    publisher: new ConfirmingPublisher(connection.channel),
    batchSize: 200,
  });
  await drain(healthy);
  assert.equal((await waitReceived((m) => m.body.data?.holdId === hold.id)).length, 1);
});

test('lease fencing: a relay whose lease expired cannot finalise the row another relay owns', async () => {
  const startsAt = new Date(now.getTime() + 6 * 3_600_000);
  const { value: window } = await service.defineWindow(meta(OPS), {
    zoneId: randomUUID(),
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    capacity: 1,
  });
  await service.acquireHold(meta(BOOKING), {
    windowId: window.id,
    holderRef: randomUUID(),
    units: 1,
    idempotencyKey: `mq-${randomUUID()}`,
  });
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
