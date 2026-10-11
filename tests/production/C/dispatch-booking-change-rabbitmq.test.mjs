/**
 * P04-C2: Booking's changes racing the PUBLISHED `scheduling.hold-changed.v1`
 * delivered over real RabbitMQ through the shared InboxConsumer.
 *
 * Real PostgreSQL (runtime role), real RabbitMQ 4.2 (quorum queue + DLX),
 * compiled dispatch artifacts and @carwash/platform-messaging. Every event is
 * checked with the published parser before it is sent.
 *
 * What it proves:
 *   - a cancellation recorded before the job exists stops a COMMITTED event
 *     that arrives afterwards from opening it (tombstone);
 *   - after a rebind, the old hold's RELEASED and the new hold's COMMITTED
 *     (the two events of Scheduling's replace, in EITHER order, redelivered)
 *     never cancel the moved job and make the binding final;
 *   - after a rebind whose new hold EXPIRED, the job is kept for the revert.
 * Topology is declared here, standing in for Lane E's broker bootstrap.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, messaging, readContext, require, serviceDist } from './_support.mjs';

const { SCHEDULING_HOLD_CHANGED_V1 } = require(
  path.join(ROOT, 'packages', 'event-contracts', 'dist', 'index.js'),
);
const { PrismaService } = serviceDist('dispatch', 'infrastructure/persistence/prisma.service.js');
const { PrismaDispatchStore } = serviceDist(
  'dispatch',
  'infrastructure/persistence/prisma-dispatch.store.js',
);
const { BookingChangeService } = serviceDist('dispatch', 'application/index.js');
const { holdChangedConsumerParts, SCHEDULING_EVENTS_EXCHANGE, HOLD_CHANGED_ROUTING_KEY } =
  serviceDist('dispatch', 'transport/messaging/hold-changed.consumer.js');
const { systemClock, uuidGenerator } = serviceDist('dispatch', 'infrastructure/runtime/system.js');
const { BrokerConnection, InboxConsumer, assertTopology } = messaging();

const RUN = randomUUID().slice(0, 8);
const QUEUE = `dispatch.hold-changed.change.${RUN}`;
const DLX = `${QUEUE}.dlx`;
const DLQ = `${QUEUE}.dlq`;
const BOOKING = {
  kind: 'SERVICE',
  clientId: 'booking',
  scopes: ['dispatch.assignment.read', 'dispatch.booking.change'],
};
const meta = () => ({ actor: BOOKING, correlationId: randomUUID() });
const key = () => `lane-${randomUUID()}`;

let prisma;
let store;
let changes;
let connection;
let consumer;

before(async () => {
  const context = await readContext();
  prisma = new PrismaService(context.databases.dispatch.appUrl);
  store = new PrismaDispatchStore(prisma);
  changes = new BookingChangeService(store, store, systemClock, uuidGenerator);
  connection = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'lane-c-dispatch-booking-change',
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
  const parts = holdChangedConsumerParts(store, systemClock, uuidGenerator);
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

function hold(bookingId = randomUUID(), zoneId = randomUUID(), hoursAhead = 4) {
  const startsAt = new Date(Date.now() + hoursAhead * 3_600_000);
  startsAt.setUTCSeconds(0, 0);
  return {
    holdId: randomUUID(),
    zoneId,
    bookingId,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
  };
}

function event(h, version, state) {
  const body = {
    eventId: randomUUID(),
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: h.holdId, version },
    actor: { kind: 'service', id: 'booking' },
    data: {
      state,
      zoneId: h.zoneId,
      startsAt: h.startsAt,
      endsAt: h.endsAt,
      bookingId: state === 'COMMITTED' ? h.bookingId : null,
    },
  };
  SCHEDULING_HOLD_CHANGED_V1.parse(body);
  return body;
}

async function publish(body) {
  connection.channel.publish(
    SCHEDULING_EVENTS_EXCHANGE,
    HOLD_CHANGED_ROUTING_KEY,
    Buffer.from(JSON.stringify(body)),
    {
      persistent: true,
      contentType: 'application/json',
      messageId: body.eventId,
      correlationId: body.correlationId,
    },
  );
  await connection.channel.waitForConfirms();
}

async function outcome(eventId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await prisma.client.$queryRawUnsafe(
      `SELECT outcome FROM app.inbox_message WHERE event_id = $1::uuid`,
      eventId,
    );
    if (row) return row.outcome;
    await delay(100);
  }
  throw new Error('event not consumed');
}

async function job(bookingId) {
  const [row] = await prisma.client.$queryRawUnsafe(
    `SELECT status, hold_id::text, pending_change_id::text FROM app.assignment WHERE booking_id = $1::uuid`,
    bookingId,
  );
  return row ?? null;
}

test('a cancellation tombstone beats a COMMITTED event that arrives later on the broker', async () => {
  const h = hold();
  const view = await changes.cancel(meta(), h.bookingId, { changeId: randomUUID() }, key());
  assert.equal(view.outcome, 'NOT_OPENED');
  const committed = event(h, 2, 'COMMITTED');
  await publish(committed);
  await publish(committed); // redelivery
  assert.equal(await outcome(committed.eventId), 'SUPPRESSED_CANCELLED');
  assert.equal(await job(h.bookingId), null);
});

for (const order of ['RELEASED_FIRST', 'COMMITTED_FIRST']) {
  test(`reschedule events in ${order} order never cancel the moved job and confirm it`, async () => {
    const original = hold(undefined, undefined, 6);
    const opened = event(original, 2, 'COMMITTED');
    await publish(opened);
    assert.equal(await outcome(opened.eventId), 'OPENED');
    const target = hold(original.bookingId, original.zoneId, 9);
    const changeId = randomUUID();
    const rebound = await changes.rebind(
      meta(),
      original.bookingId,
      {
        changeId,
        holdId: target.holdId,
        zoneId: target.zoneId,
        startsAt: new Date(target.startsAt),
        endsAt: new Date(target.endsAt),
      },
      key(),
    );
    assert.equal(rebound.outcome, 'REBOUND');
    // Scheduling's replace: old RELEASED (v3) and new COMMITTED (v2), any order, redelivered.
    const released = event(original, 3, 'RELEASED');
    const committed = event(target, 2, 'COMMITTED');
    const sequence =
      order === 'RELEASED_FIRST'
        ? [released, committed, released]
        : [committed, released, committed];
    for (const message of sequence) await publish(message);
    assert.equal(await outcome(released.eventId), 'NOTHING_TO_CANCEL');
    assert.equal(await outcome(committed.eventId), 'BINDING_CONFIRMED');
    const row = await job(original.bookingId);
    assert.deepEqual(row, {
      status: 'UNASSIGNED',
      hold_id: target.holdId,
      pending_change_id: null,
    });
    // Booking's own confirm afterwards is a replay.
    const confirm = await changes.confirm(meta(), original.bookingId, { changeId }, key());
    assert.equal(confirm.outcome, 'CONFIRMED');
  });
}

test('an EXPIRED new hold keeps the rebound job; the revert restores the original binding', async () => {
  const original = hold(undefined, undefined, 12);
  const opened = event(original, 2, 'COMMITTED');
  await publish(opened);
  assert.equal(await outcome(opened.eventId), 'OPENED');
  const target = hold(original.bookingId, original.zoneId, 15);
  const changeId = randomUUID();
  await changes.rebind(
    meta(),
    original.bookingId,
    {
      changeId,
      holdId: target.holdId,
      zoneId: target.zoneId,
      startsAt: new Date(target.startsAt),
      endsAt: new Date(target.endsAt),
    },
    key(),
  );
  const expired = event(target, 2, 'EXPIRED');
  await publish(expired);
  assert.equal(await outcome(expired.eventId), 'PENDING_BINDING_KEPT');
  assert.equal((await job(original.bookingId)).status, 'UNASSIGNED');
  const reverted = await changes.revert(meta(), original.bookingId, { changeId }, key());
  assert.equal(reverted.outcome, 'REVERTED');
  assert.deepEqual(await job(original.bookingId), {
    status: 'UNASSIGNED',
    hold_id: original.holdId,
    pending_change_id: null,
  });
  assert.equal((await connection.channel.checkQueue(DLQ)).messageCount, 0, 'nothing dead-lettered');
});
