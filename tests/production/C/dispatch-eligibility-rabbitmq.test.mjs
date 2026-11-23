/**
 * Dispatch consumes the PUBLISHED `workforce.eligibility-changed.v1` from real
 * RabbitMQ through the shared InboxConsumer (stale-eligibility handling).
 *
 * Real PostgreSQL (runtime role), real RabbitMQ 4.2 (quorum queue, delivery
 * limit, dead-letter exchange), compiled dispatch artifacts, compiled
 * @carwash/platform-messaging and @carwash/event-contracts. Every message is
 * checked with the published parser before it is sent. Topology is declared
 * here, standing in for Lane E's broker bootstrap (CR-P03-C4 §4).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, messaging, readContext, require, serviceDist } from './_support.mjs';
import { eligibleWorkforce } from './support/dispatch-workforce-double.mjs';

const { WORKFORCE_ELIGIBILITY_CHANGED_V1 } = require(
  path.join(ROOT, 'packages', 'event-contracts', 'dist', 'index.js'),
);
const { PrismaService } = serviceDist('dispatch', 'infrastructure/persistence/prisma.service.js');
const { PrismaDispatchStore } = serviceDist(
  'dispatch',
  'infrastructure/persistence/prisma-dispatch.store.js',
);
const { DispatchService } = serviceDist('dispatch', 'application/index.js');
const { holdChangedConsumerParts } = serviceDist(
  'dispatch',
  'transport/messaging/hold-changed.consumer.js',
);
const {
  eligibilityChangedConsumerParts,
  WORKFORCE_EVENTS_EXCHANGE,
  ELIGIBILITY_CHANGED_ROUTING_KEY,
} = serviceDist('dispatch', 'transport/messaging/eligibility-changed.consumer.js');
const { systemClock, uuidGenerator } = serviceDist('dispatch', 'infrastructure/runtime/system.js');
const { BrokerConnection, InboxConsumer, assertTopology } = messaging();

const RUN = randomUUID().slice(0, 8);
const QUEUE = `dispatch.eligibility.${RUN}`;
const DLX = `dispatch.eligibility.${RUN}.dlx`;
const DLQ = `dispatch.eligibility.${RUN}.dlq`;
const OPS = { kind: 'USER', subject: randomUUID(), permissions: ['operations.dispatch'] };

let context;
let prisma;
let store;
let connection;
let consumer;
let service;

before(async () => {
  context = await readContext();
  prisma = new PrismaService(context.databases.dispatch.appUrl);
  store = new PrismaDispatchStore(prisma);
  service = new DispatchService(store, store, systemClock, uuidGenerator, eligibleWorkforce);
  connection = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-dispatch-eligibility',
  });
  await assertTopology(connection.channel, {
    exchanges: [
      { name: WORKFORCE_EVENTS_EXCHANGE, type: 'topic' },
      { name: DLX, type: 'topic' },
    ],
    queues: [
      {
        name: QUEUE,
        deadLetterExchange: DLX,
        deadLetterRoutingKey: ELIGIBILITY_CHANGED_ROUTING_KEY,
        queueType: 'quorum',
        deliveryLimit: 3,
      },
      { name: DLQ },
    ],
    bindings: [
      {
        queue: QUEUE,
        exchange: WORKFORCE_EVENTS_EXCHANGE,
        routingKey: ELIGIBILITY_CHANGED_ROUTING_KEY,
      },
      { queue: DLQ, exchange: DLX, routingKey: '#' },
    ],
  });
  const parts = eligibilityChangedConsumerParts(store, systemClock, uuidGenerator);
  consumer = new InboxConsumer({
    channel: connection.channel,
    queue: QUEUE,
    store: parts.store,
    parse: parts.parse,
    effect: parts.effect,
  });
  await consumer.start();
});

after(async () => {
  await consumer?.stop();
  await connection?.channel.deleteQueue(QUEUE).catch(() => {});
  await connection?.channel.deleteQueue(DLQ).catch(() => {});
  await connection?.channel.deleteExchange(DLX).catch(() => {});
  await connection?.close();
  await prisma?.client.$disconnect();
});

async function until(probe, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await delay(100);
  }
  throw new Error('condition not reached');
}

function event(resourceId, revision, eligibility, eventId = randomUUID()) {
  const raw = {
    eventId,
    eventType: 'workforce.eligibility-changed.v1',
    envelopeVersion: 2,
    producer: 'workforce',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'capacity-resource', id: resourceId, version: revision },
    actor: { kind: 'system', id: null },
    data: { eligibility },
  };
  WORKFORCE_ELIGIBILITY_CHANGED_V1.parse(raw);
  return raw;
}

async function publish(body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  connection.channel.publish(
    WORKFORCE_EVENTS_EXCHANGE,
    ELIGIBILITY_CHANGED_ROUTING_KEY,
    Buffer.from(text),
    {
      persistent: true,
      contentType: 'application/json',
      messageId: typeof body === 'string' ? randomUUID() : body.eventId,
      correlationId: typeof body === 'string' ? randomUUID() : body.correlationId,
    },
  );
  await connection.channel.waitForConfirms();
}

/** Opens a job (committed hold, as delivered by Scheduling) and offers it to `resourceId`. */
async function offeredTo(resourceId, offsetHours) {
  const parts = holdChangedConsumerParts(store, systemClock, uuidGenerator);
  const startsAt = new Date(Date.now() + offsetHours * 3_600_000);
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
  const body = JSON.stringify(raw);
  const message = parts.parse(JSON.parse(body));
  await parts.store.applyOnce(
    {
      eventId: message.eventId,
      eventType: message.eventType,
      payloadHash: createHash('sha256').update(body).digest('hex'),
      correlationId: message.correlationId,
    },
    (tx) => parts.effect(message, tx),
  );
  const assignment = await store.findAssignmentByBooking(bookingId);
  const { value } = await service.offer(
    { actor: OPS, correlationId: randomUUID() },
    assignment.id,
    { expectedRevision: 1, resourceId, technicianSubject: randomUUID() },
    `mq-${randomUUID()}`,
  );
  return value.offer.id;
}

const offerStatus = async (id) =>
  (
    await prisma.client.$queryRawUnsafe(
      `SELECT status, withdraw_reason FROM app.dispatch_offer WHERE id = $1::uuid`,
      id,
    )
  )[0];

test('INELIGIBLE over RabbitMQ withdraws the live offer once; duplicates and stale revisions change nothing', async () => {
  const resourceId = randomUUID();
  const offerId = await offeredTo(resourceId, 30);
  const change = event(resourceId, 5, 'INELIGIBLE');
  await publish(change);
  await publish(change); // at-least-once: the same message again
  await publish(event(resourceId, 4, 'ELIGIBLE')); // older revision arriving late
  await until(async () => (await offerStatus(offerId)).status === 'WITHDRAWN');
  await until(() => consumer.stats.applied + consumer.stats.duplicates >= 3);
  assert.deepEqual(await offerStatus(offerId), {
    status: 'WITHDRAWN',
    withdraw_reason: 'RESOURCE_INELIGIBLE',
  });
  const rows = await prisma.client.$queryRawUnsafe(
    `SELECT eligibility, revision FROM app.resource_observation WHERE resource_id = $1::uuid`,
    resourceId,
  );
  assert.deepEqual(rows, [{ eligibility: 'INELIGIBLE', revision: 5 }]);
  const [{ n }] = await prisma.client.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM app.inbox_message WHERE event_id = $1::uuid`,
    change.eventId,
  );
  assert.equal(n, 1);
});

test('a message the published contract rejects is dead-lettered, never applied', async () => {
  const before = (await connection.channel.checkQueue(DLQ)).messageCount;
  const resourceId = randomUUID();
  const offerId = await offeredTo(resourceId, 33);
  const bad = { ...event(resourceId, 9, 'INELIGIBLE'), data: { eligibility: 'SUSPENDED' } };
  await publish(bad);
  await publish('{not json');
  await until(async () => (await connection.channel.checkQueue(DLQ)).messageCount >= before + 2);
  assert.equal((await offerStatus(offerId)).status, 'OFFERED');
});
