/**
 * P02-D1 operations projections on real infrastructure.
 *
 * Part A drives the compiled application/infrastructure modules against the
 * reporting database with its RUNTIME identity: version monotonicity, integrity
 * conflicts, delivery-order independence, reschedules, concurrency, freshness,
 * database-enforced invariants and the read model.
 *
 * Part B runs the real operations consumer process on the real broker. The
 * producer exchanges and the Reporting read grant they need are NOT in the
 * accepted bootstrap yet (CR-D-P02-03). The suite first proves the accepted ACL
 * refuses the binding, then applies exactly the requested grant as the
 * infrastructure administrator, runs the consumer, and restores the ACL.
 * Booking, Scheduling and Workforce do not publish these contracts yet, so
 * events are published by the infrastructure identity with the published
 * contract shapes: this is consumer-side contract evidence, not producer proof.
 *
 * Part C serves the read API through the real HTTP adapter and authorizes
 * every call with the REAL Identity service (real accounts, real roles granted
 * through Identity's own role endpoint, real signed tokens).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  ROOT,
  amqp,
  appDsn,
  brokerUrl,
  context,
  eventually,
  infraBrokerUrl,
  spawnWorker,
  sql,
} from '../../integration/_support.mjs';
import { composeExec } from '../../../scripts/acceptance/lib/infra.mjs';
import {
  bearer,
  startIdentity,
  staff,
  account,
  bootstrapAdmin,
  identityCall,
} from './_identity.mjs';

const require = createRequire(path.join(ROOT, 'services', 'reporting', 'package.json'));
const dist = (file) => require(path.join(ROOT, 'services', 'reporting', 'dist', file));
const domain = dist('domain/operations.js');
const { OperationsProjector, OperationsQueries, parseOperationsEvent } = dist(
  'application/operations.service.js',
);
const store = dist('infrastructure/persistence/prisma-operations.store.js');
const { sha256Hex } = dist('infrastructure/persistence/prisma-projection.store.js');
const topology = dist('infrastructure/messaging/operations-topology.js');
const { PrismaClient } = require(
  path.join(ROOT, 'services', 'reporting', 'dist', 'generated', 'prisma', 'client.js'),
);
const { PrismaPg } = require('@prisma/adapter-pg');

const app = new PrismaClient({
  adapter: new PrismaPg({ connectionString: appDsn(context, 'reporting') }, { schema: 'app' }),
});
const clock = { now: () => new Date() };
const projector = new OperationsProjector(sha256Hex, clock);
const queries = new OperationsQueries(new store.PrismaOperationsReader(app), clock);

test.after(async () => {
  await app.$disconnect();
});

/* -------------------------------- fixtures -------------------------------- */

/** A per-test time base far from other tests, so window reads are isolated. */
function epoch() {
  const day = 1 + Math.floor(Math.random() * 3_000);
  return Date.parse('2031-01-01T00:00:00.000Z') + day * 86_400_000;
}

const iso = (ms) => new Date(ms).toISOString();

function v2(eventType, producer, aggregate, data, occurredAt) {
  return {
    eventId: randomUUID(),
    eventType,
    envelopeVersion: 2,
    producer,
    occurredAt,
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate,
    actor: { kind: 'service', id: producer },
    data,
  };
}

function holdEvent({ holdId, version, state, zoneId, startsAt, bookingId = null, occurredAt }) {
  return v2(
    'scheduling.hold-changed.v1',
    'scheduling',
    { type: 'hold', id: holdId, version },
    { state, zoneId, startsAt: iso(startsAt), endsAt: iso(startsAt + 3_600_000), bookingId },
    iso(occurredAt),
  );
}

function confirmedEvent({ bookingId, version = 1, customerId = randomUUID(), occurredAt }) {
  return {
    eventId: randomUUID(),
    eventType: 'booking.confirmed.v1',
    schemaVersion: 1,
    producer: 'booking',
    occurredAt: iso(occurredAt),
    correlationId: randomUUID(),
    aggregateVersion: version,
    data: { bookingId, customerId },
  };
}

function eligibilityEvent({ resourceId, version, eligibility, occurredAt }) {
  return v2(
    'workforce.eligibility-changed.v1',
    'workforce',
    { type: 'capacity-resource', id: resourceId, version },
    { eligibility },
    iso(occurredAt),
  );
}

/** One delivery = one transaction, exactly as the inbox consumer runs it. */
function deliver(event) {
  const { fact } = parseOperationsEvent(event);
  return app.$transaction((tx) => projector.apply(new store.PrismaOperationsWriter(tx), fact));
}

async function bookingRow(bookingId) {
  return app.opsBooking.findUnique({ where: { bookingId } });
}

const integrity = (code) => (error) =>
  error instanceof domain.OperationsIntegrityError && error.code === code;

/* --------------------------------- Part A --------------------------------- */

test('A1: a confirmation applies once; replays are SAME, older versions STALE, rivals refused', async () => {
  const t = epoch();
  const bookingId = randomUUID();
  const customerId = randomUUID();
  const v2event = confirmedEvent({ bookingId, version: 2, customerId, occurredAt: t });
  assert.equal(await deliver(v2event), 'APPLIED');
  assert.equal(await deliver({ ...v2event, eventId: randomUUID() }), 'SAME');
  assert.equal(
    await deliver(confirmedEvent({ bookingId, version: 1, customerId, occurredAt: t - 1 })),
    'STALE',
  );
  await assert.rejects(
    deliver(confirmedEvent({ bookingId, version: 2, occurredAt: t })),
    integrity('FACT_VERSION_CONFLICT'),
  );
  const row = await bookingRow(bookingId);
  assert.equal(row.confirmationVersion, 2);
  assert.equal(row.customerRef, customerId);
  assert.equal(row.confirmedAt.toISOString(), iso(t));
  assert.equal(row.slotHoldId, null);
});

test('A2: a RELEASED that overtakes its COMMITTED is still attributed to the booking', async () => {
  const t = epoch();
  const bookingId = randomUUID();
  const holdId = randomUUID();
  const zoneId = randomUUID();
  const startsAt = t + 86_400_000;
  await deliver(confirmedEvent({ bookingId, occurredAt: t }));
  // Arrival order: v3 RELEASED (no booking in the contract), then v2 COMMITTED.
  assert.equal(
    await deliver(
      holdEvent({ holdId, version: 3, state: 'RELEASED', zoneId, startsAt, occurredAt: t + 3_000 }),
    ),
    'APPLIED',
  );
  assert.equal((await bookingRow(bookingId)).slotHoldId, null, 'no link is known yet');
  assert.equal(
    await deliver(
      holdEvent({
        holdId,
        version: 2,
        state: 'COMMITTED',
        zoneId,
        startsAt,
        bookingId,
        occurredAt: t + 2_000,
      }),
    ),
    'STALE',
  );
  const hold = await app.opsSlotHold.findUnique({ where: { holdId } });
  assert.equal(hold.state, 'RELEASED', 'the stale fact did not regress the hold');
  assert.equal(hold.version, 3);
  assert.equal(hold.bookingId, bookingId, 'but its booking link was learned');
  const row = await bookingRow(bookingId);
  assert.equal(row.slotHoldId, holdId);
  assert.equal(row.slotState, 'RELEASED');
  const view = await queries.booking(bookingId);
  assert.equal(view.item.derivedStatus, 'SLOT_RELEASED');
  assert.equal(view.holds.length, 1);
});

test('A3: a reschedule converges on the new committed slot in every delivery order', async () => {
  const orders = [
    [0, 1, 2],
    [2, 1, 0],
    [1, 2, 0],
    [2, 0, 1],
  ];
  for (const order of orders) {
    const t = epoch();
    const bookingId = randomUUID();
    const zoneId = randomUUID();
    const oldHold = randomUUID();
    const newHold = randomUUID();
    const events = [
      holdEvent({
        holdId: oldHold,
        version: 2,
        state: 'COMMITTED',
        zoneId,
        startsAt: t + 86_400_000,
        bookingId,
        occurredAt: t,
      }),
      holdEvent({
        holdId: newHold,
        version: 2,
        state: 'COMMITTED',
        zoneId,
        startsAt: t + 2 * 86_400_000,
        bookingId,
        occurredAt: t + 1_000,
      }),
      // The old hold is released AFTER the new one commits.
      holdEvent({
        holdId: oldHold,
        version: 3,
        state: 'RELEASED',
        zoneId,
        startsAt: t + 86_400_000,
        occurredAt: t + 2_000,
      }),
    ];
    await deliver(confirmedEvent({ bookingId, occurredAt: t - 1_000 }));
    for (const index of order) await deliver(events[index]);
    const row = await bookingRow(bookingId);
    assert.equal(row.slotHoldId, newHold, `order ${order.join(',')}`);
    assert.equal(row.slotState, 'COMMITTED');
    assert.equal(row.slotStartsAt.toISOString(), iso(t + 2 * 86_400_000));
    assert.equal(row.updatedAt.toISOString(), iso(t + 2_000), 'newest source time folded');
    assert.equal((await queries.booking(bookingId)).item.derivedStatus, 'SCHEDULED');
  }
});

test('A4: a hold re-linked to another booking is an integrity conflict and changes nothing', async () => {
  const t = epoch();
  const holdId = randomUUID();
  const zoneId = randomUUID();
  const first = randomUUID();
  await deliver(
    holdEvent({
      holdId,
      version: 2,
      state: 'COMMITTED',
      zoneId,
      startsAt: t,
      bookingId: first,
      occurredAt: t,
    }),
  );
  await assert.rejects(
    deliver(
      holdEvent({
        holdId,
        version: 3,
        state: 'COMMITTED',
        zoneId,
        startsAt: t,
        bookingId: randomUUID(),
        occurredAt: t + 1,
      }),
    ),
    integrity('HOLD_BOOKING_CONFLICT'),
  );
  const hold = await app.opsSlotHold.findUnique({ where: { holdId } });
  assert.equal(hold.version, 2);
  assert.equal(hold.bookingId, first);
});

test('A5: concurrent facts on one booking serialize without deadlock and converge', async () => {
  const t = epoch();
  const bookingId = randomUUID();
  const zoneId = randomUUID();
  const holds = Array.from({ length: 16 }, (_, i) => ({
    holdId: randomUUID(),
    occurredAt: t + i * 1_000,
    startsAt: t + 86_400_000 + i * 3_600_000,
  }));
  // Every hold commits for the booking; all but the last are then released.
  const events = [
    confirmedEvent({ bookingId, occurredAt: t }),
    ...holds.map((h) => holdEvent({ ...h, version: 2, state: 'COMMITTED', zoneId, bookingId })),
    ...holds
      .slice(0, -1)
      .map((h) =>
        holdEvent({ ...h, version: 3, state: 'RELEASED', zoneId, occurredAt: h.occurredAt + 500 }),
      ),
  ].sort(() => Math.random() - 0.5);
  // Eight concurrent deliveries: several consumer replicas with prefetch, not an
  // unbounded burst that would only measure connection-pool waiting.
  const outcomes = [];
  const queue = [...events];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let event = queue.shift(); event; event = queue.shift())
        outcomes.push(await deliver(event));
    }),
  );
  assert.equal(outcomes.length, events.length);
  const last = holds.at(-1);
  const row = await bookingRow(bookingId);
  assert.equal(row.slotHoldId, last.holdId);
  assert.equal(row.slotState, 'COMMITTED');
  assert.equal(await app.opsSlotHold.count({ where: { bookingId } }), holds.length);
  assert.equal((await queries.booking(bookingId)).item.derivedStatus, 'SCHEDULED');
});

test('A6: freshness counts every applied delivery exactly and only moves its clock forward', async () => {
  const before = await app.opsFreshness.findUnique({ where: { source: 'workforce' } });
  const t = epoch();
  const n = 12;
  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      deliver(
        eligibilityEvent({
          resourceId: randomUUID(),
          version: 1,
          eligibility: 'ELIGIBLE',
          occurredAt: t - i * 1_000,
        }),
      ),
    ),
  );
  const after = await app.opsFreshness.findUnique({ where: { source: 'workforce' } });
  assert.equal(after.appliedCount - (before?.appliedCount ?? 0n), BigInt(n), 'no lost increments');
  const newest = Math.max(t, before?.lastEventOccurredAt.getTime() ?? 0);
  assert.equal(after.lastEventOccurredAt.getTime(), newest, 'only the newest occurrence is kept');
  const [workforce] = await queries
    .freshness()
    .then((all) => all.filter((f) => f.source === 'workforce'));
  assert.equal(workforce.status, 'FRESH');
});

test('A7: the database refuses rows that break the read model invariants', async () => {
  const url = appDsn(context, 'reporting');
  const id = () => `'${randomUUID()}'`;
  const fp = `'${'a'.repeat(64)}'`;
  const now = `'2031-01-01T00:00:00Z'`;
  const refused = [
    `INSERT INTO app.ops_slot_hold VALUES (${id()}, 1, 'BOOKED', ${id()}, ${now}, '2031-01-01T01:00:00Z', NULL, ${fp}, ${id()}, ${now})`,
    `INSERT INTO app.ops_slot_hold VALUES (${id()}, 1, 'HELD', ${id()}, ${now}, ${now}, NULL, ${fp}, ${id()}, ${now})`,
    `INSERT INTO app.ops_slot_hold VALUES (${id()}, 0, 'HELD', ${id()}, ${now}, '2031-01-01T01:00:00Z', NULL, ${fp}, ${id()}, ${now})`,
    `INSERT INTO app.ops_slot_hold VALUES (${id()}, 1, 'HELD', ${id()}, ${now}, '2031-01-01T01:00:00Z', NULL, 'not-a-hash', ${id()}, ${now})`,
    `INSERT INTO app.ops_booking (booking_id, updated_at) VALUES (${id()}, ${now})`,
    `INSERT INTO app.ops_booking (booking_id, confirmed_at, updated_at) VALUES (${id()}, ${now}, ${now})`,
    `INSERT INTO app.ops_booking (booking_id, slot_hold_id, slot_state, updated_at) VALUES (${id()}, ${id()}, 'HELD', ${now})`,
    `INSERT INTO app.ops_resource_eligibility VALUES (${id()}, 1, 'MAYBE', ${fp}, ${id()}, ${now})`,
    `INSERT INTO app.ops_freshness VALUES ('billing', ${now}, ${now}, 1)`,
    `INSERT INTO app.ops_freshness VALUES ('booking', ${now}, ${now}, 0)`,
  ];
  for (const statement of refused) {
    const result = await sql(url, statement);
    assert.equal(result.ok, false, `must be refused: ${statement}`);
    assert.equal(result.code, '23514', `a CHECK constraint refuses it: ${result.message}`);
  }
  // The runtime identity holds DML only: no DDL, no TRUNCATE.
  for (const statement of [
    'TRUNCATE app.ops_booking',
    'ALTER TABLE app.ops_booking DROP CONSTRAINT ops_booking_has_fact',
    'DROP TABLE app.ops_freshness',
  ]) {
    const result = await sql(url, statement);
    assert.equal(result.ok, false, `${statement} must be refused`);
    assert.equal(result.code, '42501', `refused for lack of privilege: ${result.message}`);
  }
});

test('A8: discovery reads filter, page with a stable cursor and keep owners separate', async () => {
  const t = epoch();
  const zoneId = randomUUID();
  const ids = [];
  for (let i = 0; i < 7; i += 1) {
    const bookingId = randomUUID();
    ids.push(bookingId);
    const holdId = randomUUID();
    if (i !== 3) await deliver(confirmedEvent({ bookingId, occurredAt: t + i }));
    await deliver(
      holdEvent({
        holdId,
        version: 2,
        state: 'COMMITTED',
        zoneId,
        startsAt: t + 3_600_000 * (i % 3),
        bookingId,
        occurredAt: t + i,
      }),
    );
  }
  const unscheduled = randomUUID();
  await deliver(confirmedEvent({ bookingId: unscheduled, occurredAt: t + 30_000 }));
  const window = { from: iso(t - 1), to: iso(t + 86_400_000) };

  const seen = [];
  let cursor;
  do {
    const page = await queries.bookings({
      ...window,
      zoneId,
      status: undefined,
      limit: '3',
      cursor,
    });
    assert.ok(page.items.length <= 3);
    seen.push(...page.items.map((b) => b.bookingId));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual([...seen].sort(), [...ids].sort(), 'every booking exactly once across pages');
  const starts = [];
  for (const id of seen) starts.push((await bookingRow(id)).slotStartsAt.getTime());
  assert.deepEqual(
    starts,
    [...starts].sort((a, b) => a - b),
    'ordered by slot start',
  );

  const unconfirmed = await queries.bookings({
    ...window,
    zoneId,
    status: 'SLOT_COMMITTED_UNCONFIRMED',
    limit: undefined,
    cursor: undefined,
  });
  assert.deepEqual(
    unconfirmed.items.map((b) => b.bookingId),
    [ids[3]],
  );
  const pending = await queries.bookings({
    ...window,
    zoneId: undefined,
    status: 'CONFIRMED_UNSCHEDULED',
    limit: '100',
    cursor: undefined,
  });
  assert.ok(
    pending.items.some((b) => b.bookingId === unscheduled),
    'found by confirmation time',
  );
  assert.ok(pending.items.every((b) => b.slot === null || b.slot.state === 'HELD'));
  assert.equal(pending.derived, true);
  assert.deepEqual(
    pending.authority.map((a) => a.owner),
    ['booking', 'scheduling', 'dispatch'],
  );
  await assert.rejects(
    queries.bookings({
      ...window,
      zoneId,
      status: undefined,
      limit: undefined,
      cursor: 'AAAAAAAAAAAA',
    }),
    (e) => e instanceof domain.OperationsRuleError && e.code === 'INVALID_CURSOR',
  );

  const resources = await queries.resources({
    eligibility: 'ELIGIBLE',
    limit: '5',
    cursor: undefined,
  });
  assert.ok(resources.summary.eligible >= 1);
  assert.ok(resources.items.every((r) => r.eligibility === 'ELIGIBLE'));
});

/* --------------------------------- Part B --------------------------------- */

const vhost = context.vhost;
const READ_ACCEPTED = '^(reporting\\.|catalog\\.events$)';
const READ_REQUESTED =
  '^(reporting\\.|catalog\\.events$|booking\\.events$|scheduling\\.events$|workforce\\.events$)';

async function setReportingRead(pattern) {
  const result = await composeExec(context, 'rabbitmq', [
    'rabbitmqctl',
    'set_permissions',
    '-p',
    vhost,
    'cw_reporting_app',
    '^reporting\\.',
    '^reporting\\.',
    pattern,
  ]);
  if (result.code !== 0) throw new Error(`SET_PERMISSIONS_FAILED ${result.stderr}`);
}

async function withChannel(url, fn) {
  const { connect } = amqp();
  const connection = await connect(url);
  connection.on('error', () => {});
  try {
    const channel = await connection.createConfirmChannel();
    channel.on('error', () => {});
    try {
      return await fn(channel);
    } finally {
      await channel.close().catch(() => {});
    }
  } finally {
    await connection.close().catch(() => {});
  }
}

/** The infrastructure bootstrap declares producer exchanges (E owns this step). */
async function declareProducerExchanges() {
  await withChannel(infraBrokerUrl(context), async (channel) => {
    for (const name of ['booking.events', 'scheduling.events', 'workforce.events'])
      await channel.assertExchange(name, 'topic', { durable: true });
  });
}

async function publish(exchange, routingKey, body) {
  await withChannel(
    infraBrokerUrl(context),
    (channel) =>
      new Promise((resolve, reject) => {
        channel.publish(
          exchange,
          routingKey,
          Buffer.from(body, 'utf8'),
          { persistent: true, mandatory: true, contentType: 'application/json' },
          (error) => (error ? reject(error) : resolve()),
        );
      }),
  );
}

async function depth(queue) {
  return withChannel(brokerUrl(context, 'reporting'), async (channel) => {
    const info = await channel.checkQueue(queue);
    return info.messageCount;
  });
}

function startWorker(extra = []) {
  return spawnWorker(
    [
      path.join('services', 'reporting', 'dist', 'inbox', 'operations-consumer.runner.js'),
      ...extra,
    ],
    {
      DATABASE_URL: appDsn(context, 'reporting'),
      BROKER_URL: brokerUrl(context, 'reporting'),
      LOG_LEVEL: 'info',
    },
    { label: 'reporting-operations' },
  );
}

/** Worker log lines are pino-style JSON: the fields sit at the top level. */
const at = (worker, event, eventId) =>
  worker.lines.filter((l) => l.event === event && (eventId === undefined || l.eventId === eventId));

test('B1: the accepted broker ACL refuses the operations bindings (CR-D-P02-03)', async () => {
  await declareProducerExchanges();
  await setReportingRead(READ_ACCEPTED);
  const { assertTopology } = require(
    path.join(ROOT, 'packages', 'platform-messaging', 'dist', 'index.js'),
  );
  await assert.rejects(
    withChannel(brokerUrl(context, 'reporting'), (channel) =>
      assertTopology(channel, topology.operationsTopology()),
    ),
    (error) => error?.code === 403,
    'reporting may not read producer exchanges it was never granted',
  );
});

test('B2: real consumer — duplicates, crash before ACK, conflicts and malformed events', async (t) => {
  await declareProducerExchanges();
  await setReportingRead(READ_REQUESTED);
  t.after(() => setReportingRead(READ_ACCEPTED));
  let worker = startWorker();
  t.after(() => worker.stop());
  await worker.waitFor((l) => l.event === 'consumer_started', { description: 'consumer start' });
  for (const queue of [topology.OPERATIONS_QUEUE, topology.OPERATIONS_DLQ])
    await withChannel(brokerUrl(context, 'reporting'), (c) => c.purgeQueue(queue));
  const dlqBefore = await depth(topology.OPERATIONS_DLQ);

  // 1. The same bytes three times: one effect.
  const base = epoch();
  const bookingId = randomUUID();
  const confirmation = JSON.stringify(confirmedEvent({ bookingId, occurredAt: base }));
  const confirmationId = JSON.parse(confirmation).eventId;
  for (let i = 0; i < 3; i += 1)
    await publish('booking.events', 'booking.confirmed.v1', confirmation);
  await eventually(() => at(worker, 'consumer_committed', confirmationId).length === 3, {
    description: 'three deliveries',
  });
  assert.deepEqual(
    at(worker, 'consumer_committed', confirmationId)
      .map((l) => l.outcome)
      .sort(),
    ['APPLIED', 'DUPLICATE', 'DUPLICATE'],
  );

  // 2. Hold and eligibility through their own exchanges.
  const holdId = randomUUID();
  const hold = holdEvent({
    holdId,
    version: 2,
    state: 'COMMITTED',
    zoneId: randomUUID(),
    startsAt: base + 86_400_000,
    bookingId,
    occurredAt: base + 1_000,
  });
  await publish('scheduling.events', 'scheduling.hold-changed.v1', JSON.stringify(hold));
  const resourceId = randomUUID();
  const eligible = eligibilityEvent({
    resourceId,
    version: 1,
    eligibility: 'ELIGIBLE',
    occurredAt: base,
  });
  await publish('workforce.events', 'workforce.eligibility-changed.v1', JSON.stringify(eligible));
  await eventually(
    () =>
      at(worker, 'consumer_committed', hold.eventId).length === 1 &&
      at(worker, 'consumer_committed', eligible.eventId).length === 1,
    { description: 'hold and eligibility applied' },
  );
  const row = await bookingRow(bookingId);
  assert.equal(row.slotHoldId, holdId);
  assert.equal((await queries.booking(bookingId)).item.derivedStatus, 'SCHEDULED');
  assert.equal(
    (await app.opsResourceEligibility.findUnique({ where: { resourceId } })).eligibility,
    'ELIGIBLE',
  );

  // 3. Crash after commit and before ACK: the redelivery is a DUPLICATE.
  await worker.stop();
  worker = startWorker(['--crash-before-ack-after', '1']);
  await worker.waitFor((l) => l.event === 'consumer_started', { description: 'crashing consumer' });
  const ineligible = eligibilityEvent({
    resourceId,
    version: 2,
    eligibility: 'INELIGIBLE',
    occurredAt: base + 5_000,
  });
  await publish('workforce.events', 'workforce.eligibility-changed.v1', JSON.stringify(ineligible));
  await worker.exited;
  assert.equal(at(worker, 'consumer_crash_before_ack', ineligible.eventId).length, 1);
  worker = startWorker();
  await eventually(() => at(worker, 'consumer_committed', ineligible.eventId).length === 1, {
    description: 'redelivery after crash',
  });
  assert.equal(at(worker, 'consumer_committed', ineligible.eventId)[0].outcome, 'DUPLICATE');
  const resource = await app.opsResourceEligibility.findUnique({ where: { resourceId } });
  assert.equal(resource.version, 2);
  assert.equal(resource.eligibility, 'INELIGIBLE');

  // 4. A contradictory fact is NACKed until the broker dead-letters it.
  const rival = holdEvent({
    holdId,
    version: 3,
    state: 'COMMITTED',
    zoneId: randomUUID(),
    startsAt: base,
    bookingId: randomUUID(),
    occurredAt: base + 9_000,
  });
  await publish('scheduling.events', 'scheduling.hold-changed.v1', JSON.stringify(rival));
  // 5. The local (unpublished) Workforce shape is refused on parse, not retried.
  const local = {
    ...eligibilityEvent({ resourceId, version: 3, eligibility: 'ELIGIBLE', occurredAt: base }),
    data: { operatorId: resourceId, eligible: true },
  };
  await publish('workforce.events', 'workforce.eligibility-changed.v1', JSON.stringify(local));
  await eventually(async () => (await depth(topology.OPERATIONS_DLQ)) === dlqBefore + 2, {
    description: 'rival and malformed dead-lettered',
    timeoutMs: 60_000,
  });
  assert.equal(at(worker, 'consumer_committed', rival.eventId).length, 0, 'never ACKed as applied');
  assert.ok(
    at(worker, 'operations_integrity_conflict', rival.eventId).every(
      (l) => l.code === 'HOLD_BOOKING_CONFLICT',
    ),
  );
  assert.equal(await app.inboxMessage.findUnique({ where: { eventId: rival.eventId } }), null);
  assert.equal((await app.opsSlotHold.findUnique({ where: { holdId } })).bookingId, bookingId);
  // Worker logs carry identifiers and codes only, never customer references.
  const customerId = JSON.parse(confirmation).data.customerId;
  assert.ok(!JSON.stringify(worker.lines).includes(customerId), 'no customer reference in logs');
});

/* --------------------------------- Part C --------------------------------- */

const reportingRequire = createRequire(path.join(ROOT, 'services', 'reporting', 'package.json'));

async function startReporting(identityBase, readsPerMinute) {
  process.env.DATABASE_URL = appDsn(context, 'reporting');
  process.env.IDENTITY_ORIGIN = identityBase;
  process.env.REPORTING_READS_PER_MINUTE = String(readsPerMinute);
  reportingRequire('reflect-metadata');
  const { createHttpApplication } = reportingRequire('./dist/transport/http/create-app.js');
  const server = await createHttpApplication();
  await server.listen(0, '127.0.0.1');
  const base = (await server.getUrl())
    .replace('[::1]', '127.0.0.1')
    .replace('localhost', '127.0.0.1');
  return { server, base };
}

function reader(base) {
  return async (route, headers = {}) => {
    const response = await fetch(`${base}/internal/v1/reporting/operations${route}`, { headers });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

test('C1: every read is authorized by the real Identity, deny by default, fail closed', async (t) => {
  const identity = await startIdentity();
  t.after(() => identity.app.close().catch(() => {}));
  const reporting = await startReporting(identity.base, 1_000);
  t.after(() => reporting.server.close());
  const get = reader(reporting.base);

  const operations = await staff(identity, ['operations']);
  const reviewer = await staff(identity, ['reviewer']);
  const technician = await staff(identity, ['technician']);
  const customer = await account(identity);

  const day = epoch();
  const bookingId = randomUUID();
  await deliver(confirmedEvent({ bookingId, occurredAt: day }));
  const window = `?from=${iso(day - 1)}&to=${iso(day + 86_400_000)}&status=CONFIRMED_UNSCHEDULED`;

  assert.equal((await get(`/bookings${window}`)).status, 401, 'no credential');
  assert.equal(
    (await get(`/bookings${window}`, { authorization: `Bearer ${'x'.repeat(64)}` })).status,
    401,
    'a token Identity does not recognise',
  );
  for (const who of [customer, technician])
    for (const route of [`/bookings${window}`, '/resources', '/freshness'])
      assert.equal((await get(route, { authorization: bearer(who) })).status, 403, `${route}`);
  assert.equal((await get(`/bookings${window}`, { authorization: bearer(reviewer) })).status, 403);
  assert.equal((await get('/resources', { authorization: bearer(reviewer) })).status, 200);

  const list = await get(`/bookings${window}`, { authorization: bearer(operations) });
  assert.equal(list.status, 200);
  assert.equal(list.body.derived, true);
  assert.deepEqual(
    list.body.freshness.map((f) => f.source),
    ['booking', 'scheduling'],
  );
  assert.ok(list.body.items.some((b) => b.bookingId === bookingId));
  const detail = await get(`/bookings/${bookingId}`, { authorization: bearer(operations) });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.item.derivedStatus, 'CONFIRMED_UNSCHEDULED');
  assert.deepEqual(Object.keys(detail.body.item).sort(), [
    'bookingId',
    'confirmedAt',
    'customerRef',
    'derivedStatus',
    'slot',
    'sourceUpdatedAt',
  ]);
  assert.equal(
    (await get(`/bookings/${randomUUID()}`, { authorization: bearer(operations) })).status,
    404,
  );
  for (const bad of [
    '?from=2031-01-01&to=2031-01-02',
    `${window}&limit=1000`,
    `${window.replace('CONFIRMED_UNSCHEDULED', 'DONE')}`,
  ]) {
    const refused = await get(`/bookings${bad}`, { authorization: bearer(operations) });
    assert.equal(refused.status, 422, bad);
  }
  assert.equal(
    (await get('/bookings/not-a-uuid', { authorization: bearer(operations) })).status,
    422,
  );

  // The gateway's forwarded subject must agree with Identity's.
  const forged = await get(`/bookings${window}`, {
    authorization: bearer(operations),
    'x-auth-subject': reviewer.subject,
  });
  assert.equal(forged.status, 401);

  // Revocation is immediate: Identity bumps the authorization version.
  const admin = await bootstrapAdmin(identity);
  const suspended = await identityCall(
    identity,
    admin,
    `/accounts/${operations.subject}/status`,
    'POST',
    {
      status: 'SUSPENDED',
    },
  );
  assert.equal(suspended.status, 204);
  assert.equal(
    (await get(`/bookings${window}`, { authorization: bearer(operations) })).status,
    401,
  );

  // Identity unreachable: 503, never an allow.
  await identity.app.close();
  const down = await get('/freshness', { authorization: bearer(reviewer) });
  assert.equal(down.status, 503);
  assert.equal(down.body.error.code, 'AUTH_UNAVAILABLE');
});

test('C2: a per-subject read budget bounds one caller and not another', async (t) => {
  const identity = await startIdentity();
  t.after(() => identity.app.close().catch(() => {}));
  const reporting = await startReporting(identity.base, 5);
  t.after(() => reporting.server.close());
  const get = reader(reporting.base);
  const noisy = await staff(identity, ['reviewer']);
  const quiet = await staff(identity, ['reviewer']);
  const statuses = [];
  for (let i = 0; i < 7; i += 1)
    statuses.push((await get('/freshness', { authorization: bearer(noisy) })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
  assert.equal((await get('/freshness', { authorization: bearer(quiet) })).status, 200);
});
