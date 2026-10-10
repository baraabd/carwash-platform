/**
 * P05-D4 reports and exports on real infrastructure.
 *
 * Part R drives the compiled application/infrastructure modules against the
 * reporting database with its RUNTIME identity. Billing events are built with
 * the REGISTERED `@carwash/event-contracts` shapes and applied through the
 * real Reporting inbox store (`PrismaInboxStore.applyOnce`: inbox row, derived
 * rows and freshness in one transaction), exactly as the consumer runs them.
 * Dispatch has no registered event, so assignment facts use the domain builder
 * through the projector inside one transaction (as P03-D1 did); scheduling
 * holds go through the published parser and the inbox.
 *
 * Part B runs the real revenue consumer process on the real broker. The
 * Billing exchange read grant is NOT in the accepted bootstrap (CR-D-P05-D4-01):
 * the suite first proves the accepted ACL refuses the binding, then applies
 * exactly the requested grant as the infrastructure administrator, runs the
 * consumer, and restores the ACL. Events are published by the infrastructure
 * identity with the registered contract shapes: consumer-side contract
 * evidence, not Billing producer proof.
 *
 * Part H serves the report and export routes through the real HTTP adapter and
 * authorizes every call (allow AND deny) with the REAL Identity service: real
 * operations, finance and customer accounts, roles granted through Identity's
 * own role endpoint, real signed tokens. No stub Identity is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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
import { account, bearer, staff, startIdentity } from './_identity.mjs';

const require = createRequire(path.join(ROOT, 'services', 'reporting', 'package.json'));
const dist = (file) => require(path.join(ROOT, 'services', 'reporting', 'dist', file));
const reportsApp = dist('application/reports.service.js');
const { OperationsProjector, parseOperationsEvent } = dist('application/operations.service.js');
const { assignmentFact } = dist('domain/live-operations.js');
const reportsStore = dist('infrastructure/persistence/prisma-reports.store.js');
const opsStore = dist('infrastructure/persistence/prisma-operations.store.js');
const { sha256Hex } = dist('infrastructure/persistence/prisma-projection.store.js');
const { PrismaInboxStore } = dist('inbox/prisma-inbox.store.js');
const topology = dist('infrastructure/messaging/revenue-topology.js');
const { PrismaClient } = require(
  path.join(ROOT, 'services', 'reporting', 'dist', 'generated', 'prisma', 'client.js'),
);
const { PrismaPg } = require('@prisma/adapter-pg');

const app = new PrismaClient({
  adapter: new PrismaPg({ connectionString: appDsn(context, 'reporting') }, { schema: 'app' }),
});
const realClock = { now: () => new Date() };
const revenueProjector = new reportsApp.RevenueProjector(sha256Hex, realClock);
const opsProjector = new OperationsProjector(sha256Hex, realClock);
const inbox = new PrismaInboxStore({ client: app });
const reader = new reportsStore.PrismaReportsReader(app);
const queries = (clock = realClock) => new reportsApp.ReportQueries(reader, clock);

test.after(async () => {
  await app.$disconnect();
});

/* -------------------------------- fixtures -------------------------------- */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

/** A per-test UTC-midnight time base far from every other test and run. */
function epoch() {
  const day = 1 + Math.floor(Math.random() * 30_000);
  return Date.parse('2040-01-01T00:00:00.000Z') + day * DAY;
}

const syp = (amountMinor) => ({ currency: 'SYP', amountMinor: String(amountMinor), scale: 2 });
const usd = (amountMinor) => ({ currency: 'USD', amountMinor: String(amountMinor), scale: 2 });

function v2(eventType, aggregate, data, occurredAt) {
  return {
    eventId: randomUUID(),
    eventType,
    envelopeVersion: 2,
    producer: 'billing',
    occurredAt: iso(occurredAt),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate,
    actor: { kind: 'service', id: 'billing' },
    data,
  };
}

function created(obligationId, amount, at, financialStatus = 'UNPAID') {
  return v2(
    'billing.obligation-created.v1',
    { type: 'billing-obligation', id: obligationId, version: 1 },
    { quoteId: randomUUID(), amount, financialStatus },
    at,
  );
}

function statusChanged(obligationId, version, previous, status, verified, outstanding, at) {
  return v2(
    'billing.obligation-status-changed.v1',
    { type: 'billing-obligation', id: obligationId, version },
    { previousFinancialStatus: previous, financialStatus: status, verified, outstanding },
    at,
  );
}

function refund(refundId, obligationId, version, previous, status, amount, at) {
  return v2(
    'billing.refund-status-changed.v1',
    { type: 'billing-refund', id: refundId, version },
    { obligationId, previousStatus: previous, status, reason: 'SERVICE_QUALITY', amount },
    at,
  );
}

/** One delivery through the real inbox store: inbox row + effect in one transaction. */
async function deliver(event, raw = JSON.stringify(event)) {
  const parsed = reportsApp.parseRevenueEvent(JSON.parse(raw));
  return inbox.applyOnce(
    {
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      payloadHash: sha256Hex(raw),
      correlationId: parsed.correlationId,
    },
    async (tx) => {
      await revenueProjector.apply(new reportsStore.PrismaRevenueWriter(tx), parsed.fact);
    },
  );
}

async function deliverOps(event) {
  const raw = JSON.stringify(event);
  const parsed = parseOperationsEvent(JSON.parse(raw));
  return inbox.applyOnce(
    {
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      payloadHash: sha256Hex(raw),
      correlationId: parsed.correlationId,
    },
    async (tx) => {
      await opsProjector.apply(new opsStore.PrismaOperationsWriter(tx), parsed.fact);
    },
  );
}

function holdEvent({ holdId, version, state, zoneId, startsAt, minutes, bookingId, occurredAt }) {
  return {
    eventId: randomUUID(),
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: iso(occurredAt),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: holdId, version },
    actor: { kind: 'service', id: 'scheduling' },
    data: {
      state,
      zoneId,
      startsAt: iso(startsAt),
      endsAt: iso(startsAt + minutes * 60_000),
      bookingId,
    },
  };
}

function applyAssignment(input) {
  const fact = assignmentFact(input);
  return app.$transaction((tx) =>
    opsProjector.apply(new opsStore.PrismaOperationsWriter(tx), fact),
  );
}

/**
 * Seeds one revenue scenario around day `d` (UTC midnight):
 * - previous period: G settled PAID 2000.00 on d-2;
 * - period [d, d+7): A cash-collected 1500.00 at d+1 22:30Z, B paid 2500.00 on
 *   d+2, C unpaid 700.00 created d+2, D awaiting cash 300.00 created d+3,
 *   E voided, F settled in USD (other currency), refund of 500.00 on B
 *   requested d+4 and succeeded d+5.
 */
async function seedRevenue(d) {
  const [A, B, C, D, E, F, G] = Array.from({ length: 7 }, () => randomUUID());
  const R = randomUUID();
  const events = [
    created(G, syp(200000), d - 3 * DAY),
    statusChanged(G, 2, 'UNPAID', 'PAID', syp(200000), syp(0), d - 2 * DAY),
    created(A, syp(150000), d + 10 * HOUR),
    statusChanged(
      A,
      2,
      'AWAITING_CASH',
      'CASH_COLLECTED',
      syp(150000),
      syp(0),
      d + DAY + 22.5 * HOUR,
    ),
    created(B, syp(250000), d + DAY),
    statusChanged(B, 2, 'UNPAID', 'PAID', syp(250000), syp(0), d + 2 * DAY + HOUR),
    created(C, syp(70000), d + 2 * DAY + 2 * HOUR),
    created(D, syp(30000), d + 3 * DAY),
    statusChanged(D, 2, 'UNPAID', 'AWAITING_CASH', syp(0), syp(30000), d + 3 * DAY + HOUR),
    created(E, syp(99000), d + 3 * DAY),
    statusChanged(E, 2, 'UNPAID', 'VOIDED', syp(0), syp(0), d + 3 * DAY + HOUR),
    created(F, usd(4000), d + DAY),
    statusChanged(F, 2, 'UNPAID', 'PAID', usd(4000), usd(0), d + DAY + HOUR),
    refund(R, B, 1, null, 'REQUESTED', syp(50000), d + 4 * DAY),
    refund(R, B, 2, 'REQUESTED', 'SUCCEEDED', syp(50000), d + 5 * DAY),
  ];
  for (const e of events) assert.equal(await deliver(e), 'APPLIED');
  return { events, ids: { A, B, C, D, E, F, G, R } };
}

const week = (d, extra = {}) => ({
  from: iso(d),
  to: iso(d + 7 * DAY),
  timezone: 'UTC',
  granularity: 'day',
  currency: 'SYP',
  ...extra,
});

/* --------------------------------- Part R --------------------------------- */

test('R1: revenue figures are exact, settled and pending separate, growth vs the previous period', async () => {
  const d = epoch();
  await seedRevenue(d);
  const r = await queries().revenue(week(d));
  assert.equal(r.report, 'revenue');
  assert.equal(r.derived, true);
  assert.equal(r.currency, 'SYP');
  assert.equal(r.scale, 2);
  assert.deepEqual(r.settled, {
    totalMinor: '400000',
    verifiedPaymentMinor: '250000',
    cashCollectedMinor: '150000',
    obligationCount: 2,
    amountUnknownCount: 0,
  });
  assert.deepEqual(r.previousSettled, { totalMinor: '200000', obligationCount: 1 });
  assert.deepEqual(r.growth, {
    basis: 'SETTLED_TOTAL',
    ratio: '1.000000',
    percent: '100.00',
    reason: null,
  });
  assert.equal(r.pending.totalMinor, '100000');
  assert.equal(r.pending.obligationCount, 2);
  assert.deepEqual(
    r.pending.byStatus.filter((s) => s.count > 0),
    [
      { status: 'UNPAID', count: 1, amountMinor: '70000' },
      { status: 'AWAITING_CASH', count: 1, amountMinor: '30000' },
    ],
  );
  assert.deepEqual(r.refunds, {
    succeededMinor: '50000',
    succeededCount: 1,
    openMinor: '0',
    openCount: 0,
  });
  assert.equal(r.netSettledMinor, '350000');
  assert.equal(r.voidedCount, 1);
  assert.deepEqual(r.previousPeriod, { from: iso(d - 7 * DAY), to: iso(d) });
  assert.deepEqual(
    r.series.map((b) => [b.bucketStart, b.settledMinor, b.pendingCreatedMinor, b.refundedMinor]),
    [
      [iso(d), '0', '0', '0'],
      [iso(d + DAY), '150000', '0', '0'],
      [iso(d + 2 * DAY), '250000', '70000', '0'],
      [iso(d + 3 * DAY), '0', '30000', '0'],
      [iso(d + 4 * DAY), '0', '0', '0'],
      [iso(d + 5 * DAY), '0', '0', '50000'],
      [iso(d + 6 * DAY), '0', '0', '0'],
    ],
  );
  assert.deepEqual(
    r.sources.map((s) => [s.source, s.stream]),
    [['billing', 'washgo.billing.events']],
  );

  // USD is its own report; never mixed into SYP.
  const dollars = await queries().revenue(week(d, { currency: 'USD' }));
  assert.equal(dollars.settled.totalMinor, '4000');
  assert.equal(dollars.growth.reason, 'ZERO_BASE');
  assert.equal(dollars.growth.ratio, null);

  // Asia/Damascus civil days start 21:00Z: A (22:30Z on d+1) moves to the next day bucket.
  const damascus = await queries().revenue({
    from: iso(d - 3 * HOUR),
    to: iso(d + 7 * DAY - 3 * HOUR),
    timezone: 'Asia/Damascus',
    granularity: 'day',
    currency: 'SYP',
  });
  const bucketOf = (at) => damascus.series.find((b) => b.bucketStart === iso(at));
  assert.equal(bucketOf(d + DAY - 3 * HOUR).settledMinor, '0');
  assert.equal(
    bucketOf(d + 2 * DAY - 3 * HOUR).settledMinor,
    '400000',
    'A and B share a Damascus day',
  );

  // Hourly series on day d+2: B settles at 01:00Z, C is created at 02:00Z.
  const hourly = await queries().revenue({
    from: iso(d + 2 * DAY),
    to: iso(d + 3 * DAY),
    timezone: 'UTC',
    granularity: 'hour',
    currency: 'SYP',
  });
  assert.equal(hourly.series.length, 24);
  assert.equal(hourly.series[1].settledMinor, '250000');
  assert.equal(hourly.series[2].pendingCreatedMinor, '70000');
});

test('R2: duplicates never double count; replayed facts are SAME; rival bytes are an inbox CONFLICT', async () => {
  const d = epoch();
  const { events, ids } = await seedRevenue(d);
  const before = await queries().revenue(week(d));
  const freshBefore = await app.opsFreshness.findUnique({ where: { source: 'billing' } });

  // 1. Exact redelivery (same eventId, same bytes): DUPLICATE, effect not re-run.
  for (const e of events) assert.equal(await deliver(e), 'DUPLICATE');
  const freshAfterDup = await app.opsFreshness.findUnique({ where: { source: 'billing' } });
  assert.equal(freshAfterDup.appliedCount, freshBefore.appliedCount, 'no effect ran');

  // 2. Same eventId, different bytes: integrity CONFLICT, nothing folded.
  const settleB = events[5];
  const rival = { ...settleB, data: { ...settleB.data, verified: syp(999999) } };
  assert.equal(await deliver(rival), 'CONFLICT');

  // 3. A re-published fact under a NEW eventId: the projection's own version
  //    rule makes it SAME (no double count) though the inbox applies it.
  assert.equal(await deliver({ ...settleB, eventId: randomUUID() }), 'APPLIED');
  // 4. A rival fact for the same Billing version is refused and rolls back.
  await assert.rejects(
    deliver({ ...settleB, eventId: randomUUID(), data: { ...settleB.data, verified: syp(1) } }),
    (e) => e?.code === 'FACT_VERSION_CONFLICT',
  );

  const after = await queries().revenue(week(d));
  assert.deepEqual(after.settled, before.settled);
  assert.deepEqual(after.pending, before.pending);
  assert.deepEqual(after.series, before.series);
  assert.equal(
    (await app.rptObligation.findUnique({ where: { obligationId: ids.B } })).verifiedMinor,
    250000n,
  );

  // 5. A reversal (newer status) takes A out of the settled figure; a late
  //    stale settlement cannot bring it back.
  assert.equal(
    await deliver(
      statusChanged(ids.A, 3, 'CASH_COLLECTED', 'AWAITING_CASH', syp(0), syp(150000), d + 2 * DAY),
    ),
    'APPLIED',
  );
  assert.equal(await deliver({ ...events[3], eventId: randomUUID() }), 'APPLIED');
  const reversed = await queries().revenue(week(d));
  assert.equal(reversed.settled.totalMinor, '250000');
  assert.equal(reversed.settled.cashCollectedMinor, '0');
  assert.equal(reversed.pending.totalMinor, '250000', 'A is pending again (created in period)');
});

test('R3: freshness is reported per stream and turns STALE past the documented threshold', async () => {
  const d = epoch();
  const id = randomUUID();
  assert.equal(await deliver(created(id, syp(1000), d)), 'APPLIED');
  const now = await queries().revenue(week(d));
  const billing = now.sources[0];
  assert.equal(billing.state, 'FRESH');
  assert.ok(billing.lastAppliedAt !== null && billing.lastEventOccurredAt !== null);
  assert.ok(Date.parse(billing.lastEventOccurredAt) >= d, 'newest occurrence moves forward only');
  assert.deepEqual(now.freshnessPolicy, { staleAfterSeconds: 900, basis: 'LAST_APPLIED_AT' });
  assert.deepEqual(now.incompleteSources, []);
  assert.ok(Date.parse(now.generatedAt) >= Date.parse(billing.lastAppliedAt));

  const later = { now: () => new Date(Date.parse(billing.lastAppliedAt) + 900_001) };
  const stale = await queries(later).revenue(week(d));
  assert.equal(stale.sources[0].state, 'STALE');
  assert.equal(stale.sources[0].lastAppliedAt, billing.lastAppliedAt);
  assert.deepEqual(stale.incompleteSources, ['billing']);
  assert.equal(stale.generatedAt, later.now().toISOString(), 'generatedAt is the injected clock');
  assert.equal(stale.pending.totalMinor, '1000', 'figures are still shown, labelled partial');
});

test('R4: operations report: scheduled duration and booked time; execution and capacity UNAVAILABLE', async () => {
  const d = epoch();
  const zoneId = randomUUID();
  // Two committed holds (45 and 49 minutes) and one released hold.
  const holds = [
    { minutes: 45, state: 'COMMITTED', startsAt: d + 9 * HOUR },
    { minutes: 49, state: 'COMMITTED', startsAt: d + 11 * HOUR },
    { minutes: 30, state: 'RELEASED', startsAt: d + 11 * HOUR },
  ];
  for (const h of holds)
    assert.equal(
      await deliverOps(
        holdEvent({
          holdId: randomUUID(),
          version: 2,
          zoneId,
          bookingId: h.state === 'COMMITTED' ? randomUUID() : null,
          occurredAt: d,
          ...h,
        }),
      ),
      'APPLIED',
    );
  // Two ASSIGNED jobs (45 and 49 minute windows), one only OFFERED.
  const jobs = [
    { status: 'ASSIGNED', startsAt: d + 9 * HOUR, minutes: 45 },
    { status: 'ASSIGNED', startsAt: d + 11 * HOUR, minutes: 49 },
    { status: 'OFFERED', startsAt: d + 11 * HOUR, minutes: 120 },
  ];
  for (const j of jobs)
    await applyAssignment({
      eventId: randomUUID(),
      occurredAt: new Date(d),
      version: 1,
      assignmentId: randomUUID(),
      bookingId: randomUUID(),
      status: j.status,
      zoneId,
      startsAt: new Date(j.startsAt),
      endsAt: new Date(j.startsAt + j.minutes * 60_000),
      resourceId: j.status === 'ASSIGNED' ? randomUUID() : null,
    });

  const r = await queries().operations({
    from: iso(d),
    to: iso(d + DAY),
    timezone: 'UTC',
    granularity: 'hour',
    zoneId,
  });
  assert.equal(r.report, 'operations');
  assert.deepEqual(r.executionDuration, {
    available: false,
    averageMs: null,
    reason: 'NO_FIELD_PROGRESS_SOURCE',
  });
  assert.deepEqual(r.scheduledServiceDuration, {
    basis: 'ASSIGNED_JOB_WINDOW',
    count: 2,
    averageMs: '2820000',
    averageMinutes: '47.00',
    p50Ms: 2_700_000,
    p90Ms: 2_940_000,
    reason: null,
  });
  assert.equal(r.capacityUtilization.available, false);
  assert.equal(r.capacityUtilization.ratio, null);
  assert.equal(r.capacityUtilization.reason, 'NO_CAPACITY_SUPPLY_SOURCE');
  assert.equal(r.capacityUtilization.committedHolds, 2);
  assert.equal(r.capacityUtilization.bookedMinutes, '94.00');
  assert.equal(r.series.length, 24);
  assert.deepEqual(r.series[9], {
    bucketStart: iso(d + 9 * HOUR),
    committedHolds: 1,
    bookedMinutes: '45.00',
    assignedJobs: 1,
  });
  assert.deepEqual(r.series[11], {
    bucketStart: iso(d + 11 * HOUR),
    committedHolds: 1,
    bookedMinutes: '49.00',
    assignedJobs: 1,
  });
  assert.deepEqual(
    r.sources.map((s) => s.source),
    ['scheduling', 'dispatch', 'workforce'],
  );
  // Another zone sees nothing of this one.
  const other = await queries().operations({
    from: iso(d),
    to: iso(d + DAY),
    timezone: 'UTC',
    granularity: 'day',
    zoneId: randomUUID(),
  });
  assert.equal(other.scheduledServiceDuration.count, 0);
  assert.equal(other.scheduledServiceDuration.reason, 'NO_DATA');
});

test('R5: the database refuses invalid revenue rows and any change to the export audit', async () => {
  const dsn = appDsn(context, 'reporting');
  const fp = 'a'.repeat(64);
  const settledWithoutTime = await sql(
    dsn,
    `INSERT INTO app.rpt_obligation (obligation_id, version, financial_status, currency, scale,
       fingerprint, source_event_id, occurred_at)
     VALUES ('${randomUUID()}', 1, 'PAID', 'SYP', 2, '${fp}', '${randomUUID()}', now())`,
  );
  assert.equal(settledWithoutTime.ok, false);
  assert.match(settledWithoutTime.message, /rpt_obligation_settled_iff_status/);
  const unknownStatus = await sql(
    dsn,
    `INSERT INTO app.rpt_refund (refund_id, obligation_id, version, status, currency, scale,
       amount_minor, first_observed_at, fingerprint, source_event_id, occurred_at)
     VALUES ('${randomUUID()}', '${randomUUID()}', 1, 'DONE', 'SYP', 2, 5, now(), '${fp}', '${randomUUID()}', now())`,
  );
  assert.equal(unknownStatus.ok, false);

  const exportId = randomUUID();
  const inserted = await sql(
    dsn,
    `INSERT INTO app.report_export_audit (export_id, subject, idempotency_key, report,
       parameters_hash, row_count, generated_at, content_sha256)
     VALUES ('${exportId}', '${randomUUID()}', 'r5-key-${exportId.slice(0, 8)}', 'revenue',
       '${fp}', 3, now(), '${fp}')`,
  );
  assert.equal(inserted.ok, true, inserted.message);
  for (const statement of [
    `UPDATE app.report_export_audit SET row_count = 4 WHERE export_id = '${exportId}'`,
    `DELETE FROM app.report_export_audit WHERE export_id = '${exportId}'`,
  ]) {
    const refused = await sql(dsn, statement);
    assert.equal(refused.ok, false, statement);
    assert.match(refused.message, /REPORTING_LEDGER_IMMUTABLE/);
  }
});

/* --------------------------------- Part B --------------------------------- */

const vhost = context.vhost;
const READ_ACCEPTED = '^(reporting\\.|catalog\\.events$)';
const READ_REQUESTED = '^(reporting\\.|catalog\\.events$|washgo\\.billing\\.events$)';

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

/** The infrastructure bootstrap declares Billing's exchange (E owns this step). */
async function declareBillingExchange() {
  await withChannel(infraBrokerUrl(context), (channel) =>
    channel.assertExchange('washgo.billing.events', 'topic', { durable: true }),
  );
}

async function publish(routingKey, body) {
  await withChannel(
    infraBrokerUrl(context),
    (channel) =>
      new Promise((resolve, reject) => {
        channel.publish(
          'washgo.billing.events',
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
    [path.join('services', 'reporting', 'dist', 'inbox', 'revenue-consumer.runner.js'), ...extra],
    {
      DATABASE_URL: appDsn(context, 'reporting'),
      BROKER_URL: brokerUrl(context, 'reporting'),
      LOG_LEVEL: 'info',
    },
    { label: 'reporting-revenue' },
  );
}

const at = (worker, event, eventId) =>
  worker.lines.filter((l) => l.event === event && (eventId === undefined || l.eventId === eventId));

test('B1: the accepted broker ACL refuses the Billing binding (CR-D-P05-D4-01)', async () => {
  await declareBillingExchange();
  await setReportingRead(READ_ACCEPTED);
  const { assertTopology } = require(
    path.join(ROOT, 'packages', 'platform-messaging', 'dist', 'index.js'),
  );
  await assert.rejects(
    withChannel(brokerUrl(context, 'reporting'), (channel) =>
      assertTopology(channel, topology.revenueTopology()),
    ),
    (error) => error?.code === 403,
    'reporting may not read the Billing exchange it was never granted',
  );
});

test('B2: real revenue consumer — duplicate bytes counted once, crash before ACK, malformed dead-lettered', async (t) => {
  await declareBillingExchange();
  await setReportingRead(READ_REQUESTED);
  t.after(() => setReportingRead(READ_ACCEPTED));
  let worker = startWorker();
  t.after(() => worker.stop());
  await worker.waitFor((l) => l.event === 'consumer_started', { description: 'consumer start' });
  for (const queue of [topology.REVENUE_QUEUE, topology.REVENUE_DLQ])
    await withChannel(brokerUrl(context, 'reporting'), (c) => c.purgeQueue(queue));

  const d = epoch();
  const obligationId = randomUUID();
  const creation = JSON.stringify(created(obligationId, syp(123456), d + HOUR));
  const creationId = JSON.parse(creation).eventId;
  for (let i = 0; i < 3; i += 1) await publish('billing.obligation-created.v1', creation);
  await eventually(() => at(worker, 'consumer_committed', creationId).length === 3, {
    description: 'three deliveries',
  });
  assert.deepEqual(
    at(worker, 'consumer_committed', creationId)
      .map((l) => l.outcome)
      .sort(),
    ['APPLIED', 'DUPLICATE', 'DUPLICATE'],
  );
  const report = await queries().revenue(week(d));
  assert.equal(report.pending.totalMinor, '123456', 'three deliveries, one contribution');

  // Crash after commit and before ACK: the redelivery is a DUPLICATE.
  await worker.stop();
  worker = startWorker(['--crash-before-ack-after', '1']);
  await worker.waitFor((l) => l.event === 'consumer_started', { description: 'crashing consumer' });
  const settle = statusChanged(
    obligationId,
    2,
    'UNPAID',
    'PAID',
    syp(123456),
    syp(0),
    d + 2 * HOUR,
  );
  await publish('billing.obligation-status-changed.v1', JSON.stringify(settle));
  await worker.exited;
  assert.equal(at(worker, 'consumer_crash_before_ack', settle.eventId).length, 1);
  worker = startWorker();
  await eventually(() => at(worker, 'consumer_committed', settle.eventId).length === 1, {
    description: 'redelivery after crash',
  });
  assert.equal(at(worker, 'consumer_committed', settle.eventId)[0].outcome, 'DUPLICATE');
  const settled = await queries().revenue(week(d));
  assert.equal(settled.settled.totalMinor, '123456');
  assert.equal(settled.pending.totalMinor, '0');

  // A shape outside the registered contract is dead-lettered, never folded.
  const dlqBefore = await depth(topology.REVENUE_DLQ);
  const malformed = created(randomUUID(), syp(5), d + 3 * HOUR);
  malformed.data.bookingId = randomUUID();
  await publish('billing.obligation-created.v1', JSON.stringify(malformed));
  await eventually(async () => (await depth(topology.REVENUE_DLQ)) === dlqBefore + 1, {
    description: 'malformed dead-lettered',
    timeoutMs: 60_000,
  });
  assert.equal(await app.inboxMessage.findUnique({ where: { eventId: malformed.eventId } }), null);
  assert.equal((await queries().revenue(week(d))).pending.totalMinor, '0');
});

/* --------------------------------- Part H --------------------------------- */

const reportingRequire = createRequire(path.join(ROOT, 'services', 'reporting', 'package.json'));

async function startReporting(identityBase, { reads = 1_000, exports = 1_000 } = {}) {
  process.env.DATABASE_URL = appDsn(context, 'reporting');
  process.env.IDENTITY_ORIGIN = identityBase;
  process.env.REPORTING_READS_PER_MINUTE = String(reads);
  process.env.REPORTING_EXPORTS_PER_MINUTE = String(exports);
  reportingRequire('reflect-metadata');
  const { createHttpApplication } = reportingRequire('./dist/transport/http/create-app.js');
  const server = await createHttpApplication();
  await server.listen(0, '127.0.0.1');
  const base = (await server.getUrl())
    .replace('[::1]', '127.0.0.1')
    .replace('localhost', '127.0.0.1');
  return { server, base };
}

function client(base) {
  const get = async (route, who) => {
    const response = await fetch(`${base}/internal/v1/reporting/reports${route}`, {
      headers: who ? { authorization: bearer(who) } : {},
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const exportCsv = async (who, body, key) => {
    const headers = { 'content-type': 'application/json' };
    if (who) headers.authorization = bearer(who);
    if (key !== undefined) headers['idempotency-key'] = key;
    const response = await fetch(`${base}/internal/v1/reporting/reports/exports`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, bytes };
  };
  return { get, exportCsv };
}

const query = (o) => `?${new URLSearchParams(o).toString()}`;

async function auditRows(subject) {
  return app.reportExportAudit.findMany({ where: { subject }, orderBy: { recordedAt: 'asc' } });
}

test('H1: report reads are authorized by the real Identity, deny by default, with validated periods', async (t) => {
  const identity = await startIdentity();
  t.after(() => identity.app.close().catch(() => {}));
  const reporting = await startReporting(identity.base);
  t.after(() => reporting.server.close());
  const { get } = client(reporting.base);

  const operations = await staff(identity, ['operations']);
  const finance = await staff(identity, ['finance']);
  const support = await staff(identity, ['support']);
  const customer = await account(identity);

  const d = epoch();
  await seedRevenue(d);
  const revenue = `/revenue${query(week(d))}`;
  const ops = `/operations${query({ from: iso(d), to: iso(d + DAY), timezone: 'UTC', granularity: 'hour' })}`;

  assert.equal((await get(revenue)).status, 401, 'no credential');
  for (const who of [operations, support, customer])
    assert.equal((await get(revenue, who)).status, 403, 'revenue needs billing.read');
  for (const who of [finance, support, customer])
    assert.equal((await get(ops, who)).status, 403, 'operations report needs operations.dispatch');

  const ok = await get(revenue, finance);
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.body).sort(), [
    'authority',
    'currency',
    'derived',
    'freshnessPolicy',
    'generatedAt',
    'growth',
    'incompleteSources',
    'market',
    'netSettledMinor',
    'pending',
    'period',
    'previousPeriod',
    'previousSettled',
    'refunds',
    'report',
    'scale',
    'series',
    'settled',
    'sources',
    'voidedCount',
  ]);
  assert.equal(ok.body.settled.totalMinor, '400000');
  assert.equal(ok.body.growth.percent, '100.00');
  assert.equal((await get(ops, operations)).status, 200);

  for (const bad of [
    week(d, { timezone: 'Europe/Paris' }),
    week(d, { granularity: 'month' }),
    week(d, { from: iso(d + HOUR) }),
    week(d, { to: iso(d + 120 * DAY) }),
    week(d, { to: iso(d - DAY) }),
    week(d, { from: '2040-01-01' }),
    week(d, { currency: 'EUR' }),
  ]) {
    const refused = await get(`/revenue${query(bad)}`, finance);
    assert.equal(refused.status, 422, JSON.stringify(bad));
  }
  const noCurrency = week(d);
  delete noCurrency.currency;
  const missing = await get(`/revenue${query(noCurrency)}`, finance);
  assert.equal(missing.status, 422);
  assert.equal(missing.body.error.code, 'INVALID_CURRENCY');
  assert.equal((await get(`${ops}&zoneId=nope`, operations)).status, 422);
});

const exportBody = (d, extra = {}) => ({ report: 'revenue', ...week(d), ...extra });

test('H2: exports — same authorization as the report, CSV safe for spreadsheets, idempotent, audited', async (t) => {
  const identity = await startIdentity();
  t.after(() => identity.app.close().catch(() => {}));
  const reporting = await startReporting(identity.base);
  t.after(() => reporting.server.close());
  const { exportCsv } = client(reporting.base);

  const operations = await staff(identity, ['operations']);
  const finance = await staff(identity, ['finance']);
  const d = epoch();
  await seedRevenue(d);
  const key = `exp-${randomUUID()}`;

  // Operations staff cannot export the financial report: 403, nothing audited.
  const denied = await exportCsv(operations, exportBody(d), key);
  assert.equal(denied.status, 403);
  assert.equal((await auditRows(operations.subject)).length, 0);
  assert.equal((await exportCsv(undefined, exportBody(d), key)).status, 401);
  assert.equal(
    (await exportCsv(finance, { ...exportBody(d), report: 'payroll' }, key)).status,
    422,
  );
  // Finance cannot export the operations report either.
  const opsBody = {
    report: 'operations',
    from: iso(d),
    to: iso(d + DAY),
    timezone: 'UTC',
    granularity: 'hour',
  };
  assert.equal((await exportCsv(finance, opsBody, key)).status, 403);

  // Finance exports revenue.
  const first = await exportCsv(finance, exportBody(d), key);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(first.headers.get('idempotency-replayed'), 'false');
  assert.match(first.headers.get('content-disposition'), /^attachment; filename="washgo-revenue-/);
  assert.equal(first.headers.get('x-export-row-count'), '7');
  assert.equal(first.bytes.subarray(0, 3).toString('hex'), 'efbbbf', 'UTF-8 BOM');
  const text = first.bytes.subarray(3).toString('utf8');
  const lines = text.split('\r\n');
  assert.equal(lines.at(-1), '', 'every record ends with CRLF');
  assert.ok(
    lines.every((l) => l === '' || l.split(',').length === 4),
    'uniform field count',
  );
  assert.ok(lines.includes('report,revenue,,'));
  assert.ok(lines.includes('source.billing.stream,washgo.billing.events,,'));
  assert.ok(lines.some((l) => /^source\.billing\.state,(FRESH|STALE),,$/.test(l)));
  assert.ok(lines.some((l) => /^source\.billing\.lastAppliedAt,\d{4}-/.test(l)));
  assert.ok(lines.includes('settledTotalMinor,400000,,'));
  assert.ok(lines.includes('growthPercent,100.00,,'));
  assert.ok(lines.includes('bucketStart,settledMinor,pendingCreatedMinor,refundedMinor'));
  assert.ok(lines.includes(`${iso(d + 2 * DAY)},250000,70000,0`));

  const [audit] = await auditRows(finance.subject);
  assert.equal(audit.report, 'revenue');
  assert.equal(audit.rowCount, 7);
  assert.equal(audit.idempotencyKey, key);
  assert.match(audit.parametersHash, /^[0-9a-f]{64}$/);
  assert.equal(audit.contentSha256, sha256Hex(first.bytes.toString('utf8')));
  assert.equal(audit.exportId, first.headers.get('x-export-id'));
  assert.equal(audit.generatedAt.toISOString(), first.headers.get('x-export-generated-at'));
  assert.deepEqual(Object.keys(audit).sort(), [
    'contentSha256',
    'exportId',
    'generatedAt',
    'idempotencyKey',
    'parametersHash',
    'recordedAt',
    'report',
    'rowCount',
    'subject',
  ]);

  // Replay: same key + same parameters -> the original bytes, no new audit row.
  const replay = await exportCsv(finance, exportBody(d), key);
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.ok(replay.bytes.equals(first.bytes));
  // Same key, different parameters -> 409.
  const conflict = await exportCsv(finance, exportBody(d, { currency: 'USD' }), key);
  assert.equal(conflict.status, 409);
  assert.equal((await auditRows(finance.subject)).length, 1);
  // The key is scoped to its subject: another caller's identical key is independent.
  const finance2 = await staff(identity, ['finance']);
  assert.equal((await exportCsv(finance2, exportBody(d), key)).status, 201);

  // Validation negatives.
  assert.equal((await exportCsv(finance, exportBody(d))).status, 422, 'missing key');
  assert.equal((await exportCsv(finance, exportBody(d), 'short')).status, 422, 'bad key');
  for (const bad of [
    exportBody(d, { timezone: 'Mars/Base' }),
    exportBody(d, { to: iso(d + 200 * DAY) }),
    exportBody(d, { zoneId: randomUUID() }),
    exportBody(d, { currency: 'GBP' }),
  ])
    assert.equal((await exportCsv(finance, bad, `exp-${randomUUID()}`)).status, 422);

  // Operations staff export the operations report.
  const opsExport = await exportCsv(operations, opsBody, `exp-${randomUUID()}`);
  assert.equal(opsExport.status, 201);
  assert.equal(opsExport.headers.get('x-export-row-count'), '24');
  assert.ok(
    opsExport.bytes.toString('utf8').includes('executionDurationReason,NO_FIELD_PROGRESS_SOURCE'),
  );
  assert.equal((await auditRows(operations.subject)).length, 1);
});

test('H3: concurrent exports with one key write exactly one audit row and return identical bytes', async (t) => {
  const identity = await startIdentity();
  t.after(() => identity.app.close().catch(() => {}));
  const reporting = await startReporting(identity.base);
  t.after(() => reporting.server.close());
  const { exportCsv } = client(reporting.base);
  const finance = await staff(identity, ['finance']);
  const d = epoch();
  await seedRevenue(d);
  const key = `race-${randomUUID()}`;

  const results = await Promise.all(
    Array.from({ length: 10 }, () => exportCsv(finance, exportBody(d), key)),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
  assert.ok(
    results.every((r) => r.bytes.equals(results[0].bytes)),
    'one result for one key',
  );
  const rows = await app.reportExportAudit.findMany({
    where: { subject: finance.subject, idempotencyKey: key },
  });
  assert.equal(rows.length, 1);
  assert.equal(await app.reportExportContent.count({ where: { exportId: rows[0].exportId } }), 1);

  // Store-level race without HTTP: 16 concurrent creates through the real store.
  const store = new reportsStore.PrismaExportStore(app);
  const exportsService = new reportsApp.ReportExports(
    queries(),
    store,
    sha256Hex,
    realClock,
    randomUUID,
  );
  const subject = randomUUID();
  const parameters = reportsApp.exportParameters('revenue', exportBody(d));
  const raced = await Promise.all(
    Array.from({ length: 16 }, () =>
      exportsService.create({ subject, idempotencyKey: 'store-race-key', parameters }),
    ),
  );
  assert.equal(raced.filter((r) => r.created).length, 1);
  assert.equal(new Set(raced.map((r) => r.audit.exportId)).size, 1);
  assert.equal((await auditRows(subject)).length, 1);
});

test('H4: the export budget bounds one caller; replay content expires but the audit stays', async (t) => {
  const identity = await startIdentity();
  t.after(() => identity.app.close().catch(() => {}));
  const reporting = await startReporting(identity.base, { exports: 2 });
  t.after(() => reporting.server.close());
  const { exportCsv } = client(reporting.base);
  const finance = await staff(identity, ['finance']);
  const d = epoch();
  const statuses = [];
  for (let i = 0; i < 4; i += 1)
    statuses.push((await exportCsv(finance, exportBody(d), `budget-${randomUUID()}`)).status);
  assert.deepEqual(statuses, [201, 201, 429, 429]);

  // Expiry: a replay after the content window is 410, never a regenerated file.
  const store = new reportsStore.PrismaExportStore(app);
  const subject = randomUUID();
  const parameters = reportsApp.exportParameters('revenue', exportBody(d));
  const made = await new reportsApp.ReportExports(
    queries(),
    store,
    sha256Hex,
    realClock,
    randomUUID,
  ).create({
    subject,
    idempotencyKey: 'expiry-key-001',
    parameters,
  });
  const afterTtl = { now: () => new Date(Date.now() + 25 * HOUR) };
  await assert.rejects(
    new reportsApp.ReportExports(queries(), store, sha256Hex, afterTtl, randomUUID).create({
      subject,
      idempotencyKey: 'expiry-key-001',
      parameters,
    }),
    (e) => e instanceof reportsApp.ExportExpired,
  );
  assert.equal((await auditRows(subject))[0].exportId, made.audit.exportId);
});
