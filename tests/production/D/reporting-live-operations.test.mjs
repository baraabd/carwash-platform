/**
 * P03-D1 live-operations projections on real infrastructure.
 *
 * Part L drives the compiled projector and Prisma store against the reporting
 * database with its RUNTIME identity: assignment milestones independent of
 * delivery order, the reassignment set, integrity conflicts, concurrency,
 * database-enforced invariants, window KPIs (checked value-for-value against
 * the pure nearest-rank reference) and exact cash-state sums.
 *
 * Dispatch (`dispatch.assignment-changed.v1`) and Billing
 * (`billing.obligation-*.v1`) events are NOT published in
 * @carwash/event-contracts yet (CR-D-P03-01), so this suite applies validated
 * domain facts through the projector exactly as the inbox transaction would.
 * It is persistence evidence, not consumer or producer evidence.
 *
 * Part H serves the KPI reads through the real HTTP adapter, authorized by the
 * REAL Identity service for the operations, finance and super-admin roles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, appDsn, context, sql } from '../../integration/_support.mjs';
import { account, bearer, staff, startIdentity } from './_identity.mjs';

const require = createRequire(path.join(ROOT, 'services', 'reporting', 'package.json'));
const dist = (file) => require(path.join(ROOT, 'services', 'reporting', 'dist', file));
const live = dist('domain/live-operations.js');
const { OperationsIntegrityError } = dist('domain/operations.js');
const { OperationsProjector, OperationsQueries } = dist('application/operations.service.js');
const store = dist('infrastructure/persistence/prisma-operations.store.js');
const { sha256Hex } = dist('infrastructure/persistence/prisma-projection.store.js');
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

/** A per-test time base far from other tests (and from the P02 suite's 2031 range). */
function epoch() {
  const day = 1 + Math.floor(Math.random() * 3_000);
  return Date.parse('2041-01-01T00:00:00.000Z') + day * 86_400_000;
}
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;

function assignment({
  assignmentId,
  bookingId,
  version,
  status,
  occurredAt,
  startsAt,
  zoneId,
  resourceId = null,
}) {
  return live.assignmentFact({
    eventId: randomUUID(),
    occurredAt: new Date(occurredAt),
    version,
    assignmentId,
    bookingId,
    status,
    zoneId,
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt + 3_600_000),
    resourceId,
  });
}

function obligation({
  obligationId,
  version,
  cashState,
  amountMinor,
  currency = 'SYP',
  occurredAt,
}) {
  return live.obligationFact({
    eventId: randomUUID(),
    occurredAt: new Date(occurredAt),
    version,
    obligationId,
    cashState,
    outstanding: live.exactAmount({ currency, amountMinor, scale: 2 }),
  });
}

/** One delivery = one transaction, as the inbox consumer runs it. */
function deliver(fact) {
  return app.$transaction((tx) => projector.apply(new store.PrismaOperationsWriter(tx), fact));
}

/** A full assignment lifecycle: created, offered, declined, offered, accepted. */
function lifecycle({ t, zoneId, resourceId = randomUUID() }) {
  const assignmentId = randomUUID();
  const bookingId = randomUUID();
  const startsAt = t + 6 * 3_600_000;
  const base = { assignmentId, bookingId, startsAt, zoneId };
  return {
    assignmentId,
    bookingId,
    resourceId,
    facts: [
      assignment({ ...base, version: 1, status: 'UNASSIGNED', occurredAt: t }),
      assignment({ ...base, version: 2, status: 'OFFERED', occurredAt: t + 2 * MIN }),
      assignment({ ...base, version: 3, status: 'UNASSIGNED', occurredAt: t + 5 * MIN }),
      assignment({ ...base, version: 4, status: 'OFFERED', occurredAt: t + 7 * MIN }),
      assignment({
        ...base,
        version: 5,
        status: 'ASSIGNED',
        occurredAt: t + 9 * MIN,
        resourceId,
      }),
    ],
  };
}

async function row(assignmentId) {
  return app.opsAssignment.findUnique({
    where: { assignmentId },
    include: { resources: { orderBy: { resourceId: 'asc' } } },
  });
}

/* --------------------------------- Part L --------------------------------- */

test('L1: assignment state and milestones converge in every delivery order', async () => {
  const t = epoch();
  const zoneId = randomUUID();
  const results = [];
  for (const order of [
    [0, 1, 2, 3, 4],
    [4, 3, 2, 1, 0],
    [2, 4, 0, 3, 1],
  ]) {
    const life = lifecycle({ t, zoneId });
    const outcomes = [];
    for (const i of order) outcomes.push(await deliver(life.facts[i]));
    const r = await row(life.assignmentId);
    assert.equal(r.status, 'ASSIGNED');
    assert.equal(r.version, 5);
    assert.equal(r.resourceId, life.resourceId);
    assert.equal(r.firstObservedAt.toISOString(), iso(t));
    assert.equal(r.firstOfferedAt.toISOString(), iso(t + 2 * MIN));
    assert.equal(r.firstAssignedAt.toISOString(), iso(t + 9 * MIN));
    assert.equal(r.resources.length, 1);
    results.push(outcomes);
  }
  // In order: every fact applies. Reversed: only the first (newest) applies.
  assert.deepEqual(results[0], ['APPLIED', 'APPLIED', 'APPLIED', 'APPLIED', 'APPLIED']);
  assert.deepEqual(results[1], ['APPLIED', 'STALE', 'STALE', 'STALE', 'STALE']);
});

test('L2: replays are SAME; rival content or another booking is refused and rolls back', async () => {
  const t = epoch();
  const life = lifecycle({ t, zoneId: randomUUID() });
  for (const fact of life.facts) await deliver(fact);
  const before = await row(life.assignmentId);
  assert.equal(await deliver({ ...life.facts[4], eventId: randomUUID() }), 'SAME');

  const freshness = await app.opsFreshness.findUnique({ where: { source: 'dispatch' } });
  await assert.rejects(
    deliver({ ...life.facts[4], resourceId: randomUUID() }),
    (e) => e instanceof OperationsIntegrityError && e.code === 'FACT_VERSION_CONFLICT',
  );
  await assert.rejects(
    deliver({ ...life.facts[4], version: 6, bookingId: randomUUID() }),
    (e) => e instanceof OperationsIntegrityError && e.code === 'ASSIGNMENT_BOOKING_CONFLICT',
  );
  assert.deepEqual(await row(life.assignmentId), before, 'nothing changed');
  const after = await app.opsFreshness.findUnique({ where: { source: 'dispatch' } });
  assert.equal(after.appliedCount, freshness.appliedCount, 'the refused deliveries rolled back');
});

test('L3: a reassignment is recorded once per resource, even from stale deliveries', async () => {
  const t = epoch();
  const zoneId = randomUUID();
  const life = lifecycle({ t, zoneId });
  const second = randomUUID();
  const base = {
    assignmentId: life.assignmentId,
    bookingId: life.bookingId,
    startsAt: t + 6 * 3_600_000,
    zoneId,
  };
  const reassigned = assignment({
    ...base,
    version: 6,
    status: 'ASSIGNED',
    occurredAt: t + 30 * MIN,
    resourceId: second,
  });
  // The reassignment arrives first; the original acceptance afterwards is stale.
  assert.equal(await deliver(reassigned), 'APPLIED');
  for (const fact of life.facts) assert.equal(await deliver(fact), 'STALE');
  const r = await row(life.assignmentId);
  assert.equal(r.resourceId, second);
  assert.deepEqual(r.resources.map((x) => x.resourceId).sort(), [life.resourceId, second].sort());
  assert.equal(r.firstAssignedAt.toISOString(), iso(t + 9 * MIN), 'learned from a stale delivery');
  const detail = await queries.booking(life.bookingId);
  assert.equal(detail.item, null, 'Reporting has no booking fact for it');
  assert.deepEqual(detail.assignments, []);
});

test('L4: concurrent deliveries on one assignment serialize and converge', async () => {
  const t = epoch();
  const life = lifecycle({ t, zoneId: randomUUID() });
  const extra = [6, 7, 8].map((version) =>
    assignment({
      assignmentId: life.assignmentId,
      bookingId: life.bookingId,
      startsAt: t + 6 * 3_600_000,
      zoneId: life.facts[0].zoneId,
      version,
      status: version % 2 === 0 ? 'OFFERED' : 'UNASSIGNED',
      occurredAt: t + version * 10 * MIN,
    }),
  );
  const all = [...life.facts, ...extra];
  const outcomes = await Promise.all(all.map((fact) => deliver(fact)));
  assert.equal(outcomes.filter((o) => o === 'APPLIED').length >= 1, true);
  const r = await row(life.assignmentId);
  assert.equal(r.version, 8);
  assert.equal(r.status, 'OFFERED');
  assert.equal(r.resourceId, null);
  assert.equal(r.firstObservedAt.toISOString(), iso(t));
  assert.equal(r.firstAssignedAt.toISOString(), iso(t + 9 * MIN));
  assert.equal(r.resources.length, 1);
});

test('L5: the database refuses live-operations rows that break invariants', async () => {
  const url = appDsn(context, 'reporting');
  const id = () => `'${randomUUID()}'`;
  const fp = `'${'b'.repeat(64)}'`;
  const at = `'2041-01-01T00:00:00Z'`;
  const end = `'2041-01-01T01:00:00Z'`;
  const cols =
    '(assignment_id, booking_id, version, status, zone_id, starts_at, ends_at, resource_id, fingerprint, source_event_id, occurred_at, first_observed_at, first_offered_at, first_assigned_at)';
  const ins = (values) => `INSERT INTO app.ops_assignment ${cols} VALUES (${values})`;
  const refused = [
    ins(
      `${id()}, ${id()}, 1, 'EN_ROUTE', ${id()}, ${at}, ${end}, NULL, ${fp}, ${id()}, ${at}, ${at}, NULL, NULL`,
    ),
    ins(
      `${id()}, ${id()}, 1, 'ASSIGNED', ${id()}, ${at}, ${end}, NULL, ${fp}, ${id()}, ${at}, ${at}, NULL, ${at}`,
    ),
    ins(
      `${id()}, ${id()}, 1, 'OFFERED', ${id()}, ${at}, ${end}, ${id()}, ${fp}, ${id()}, ${at}, ${at}, ${at}, NULL`,
    ),
    ins(
      `${id()}, ${id()}, 1, 'ASSIGNED', ${id()}, ${at}, ${end}, ${id()}, ${fp}, ${id()}, ${at}, ${at}, NULL, NULL`,
    ),
    ins(
      `${id()}, ${id()}, 1, 'OFFERED', ${id()}, ${at}, ${at}, NULL, ${fp}, ${id()}, ${at}, ${at}, NULL, NULL`,
    ),
    ins(
      `${id()}, ${id()}, 0, 'OFFERED', ${id()}, ${at}, ${end}, NULL, ${fp}, ${id()}, ${at}, ${at}, NULL, NULL`,
    ),
    ins(
      `${id()}, ${id()}, 1, 'OFFERED', ${id()}, ${at}, ${end}, NULL, ${fp}, ${id()}, ${at}, ${end}, NULL, NULL`,
    ),
    ins(
      `${id()}, ${id()}, 1, 'OFFERED', ${id()}, ${at}, ${end}, NULL, ${fp}, ${id()}, ${end}, ${end}, ${at}, NULL`,
    ),
    `INSERT INTO app.ops_obligation VALUES (${id()}, 1, 'SETTLED', 0, 'SYP', 2, ${at}, ${fp}, ${id()}, ${at})`,
    `INSERT INTO app.ops_obligation VALUES (${id()}, 1, 'PAID', 1, 'SYP', 2, ${at}, ${fp}, ${id()}, ${at})`,
    `INSERT INTO app.ops_obligation VALUES (${id()}, 1, 'AWAITING_CASH', -1, 'SYP', 2, ${at}, ${fp}, ${id()}, ${at})`,
    `INSERT INTO app.ops_obligation VALUES (${id()}, 1, 'AWAITING_CASH', 1, 'syp', 2, ${at}, ${fp}, ${id()}, ${at})`,
    `INSERT INTO app.ops_obligation VALUES (${id()}, 1, 'AWAITING_CASH', 1, 'SYP', 9, ${at}, ${fp}, ${id()}, ${at})`,
    `INSERT INTO app.ops_obligation VALUES (${id()}, 1, 'AWAITING_CASH', 1, 'SYP', 2, ${end}, ${fp}, ${id()}, ${at})`,
    `INSERT INTO app.ops_freshness VALUES ('wallet', ${at}, ${at}, 1)`,
  ];
  for (const statement of refused) {
    const result = await sql(url, statement);
    assert.equal(result.ok, false, `must be refused: ${statement}`);
    assert.equal(result.code, '23514', `a CHECK constraint refuses it: ${result.message}`);
  }
  const orphan = await sql(
    url,
    `INSERT INTO app.ops_assignment_resource VALUES (${id()}, ${id()}, ${at})`,
  );
  assert.equal(orphan.code, '23503', 'a resource row needs its assignment');
  for (const statement of [
    'TRUNCATE app.ops_assignment CASCADE',
    'ALTER TABLE app.ops_obligation DROP CONSTRAINT ops_obligation_closed_settled',
    'DROP TABLE app.ops_assignment_resource',
  ]) {
    const result = await sql(url, statement);
    assert.equal(result.code, '42501', `${statement} refused for lack of privilege`);
  }
});

test('L6: operations KPIs equal the nearest-rank reference and respect window and zone', async () => {
  const t = epoch();
  const zoneId = randomUUID();
  const otherZone = randomUUID();
  const from = t;
  const to = t + 86_400_000;
  const expected = { toOffer: [], toAssign: [], offerToAssign: [] };
  let reassigned = 0;
  let late = 0;
  for (let i = 0; i < 11; i += 1) {
    const assignmentId = randomUUID();
    const bookingId = randomUUID();
    const created = t + i * 3_600_000;
    const startsAt = created + (i === 3 ? 30 * MIN : 4 * 3_600_000);
    const offerAt = created + (i + 1) * MIN;
    const assignAt = offerAt + (2 * i + 1) * MIN;
    const base = { assignmentId, bookingId, startsAt, zoneId };
    await deliver(assignment({ ...base, version: 1, status: 'UNASSIGNED', occurredAt: created }));
    await deliver(assignment({ ...base, version: 2, status: 'OFFERED', occurredAt: offerAt }));
    expected.toOffer.push(offerAt - created);
    if (i === 3) {
      // Accepted only after the job window opened.
      const lateAt = startsAt + 5 * MIN;
      await deliver(
        assignment({
          ...base,
          version: 3,
          status: 'ASSIGNED',
          occurredAt: lateAt,
          resourceId: randomUUID(),
        }),
      );
      expected.toAssign.push(lateAt - created);
      expected.offerToAssign.push(lateAt - offerAt);
      late += 1;
    } else if (i % 4 !== 0) {
      await deliver(
        assignment({
          ...base,
          version: 3,
          status: 'ASSIGNED',
          occurredAt: assignAt,
          resourceId: randomUUID(),
        }),
      );
      expected.toAssign.push(assignAt - created);
      expected.offerToAssign.push(assignAt - offerAt);
      if (i === 5) {
        await deliver(
          assignment({
            ...base,
            version: 4,
            status: 'ASSIGNED',
            occurredAt: assignAt + 20 * MIN,
            resourceId: randomUUID(),
          }),
        );
        reassigned += 1;
      }
    }
  }
  // Outside the window or zone: must not count.
  await deliver(
    assignment({
      assignmentId: randomUUID(),
      bookingId: randomUUID(),
      startsAt: to + 3_600_000,
      zoneId,
      version: 1,
      status: 'UNASSIGNED',
      occurredAt: t,
    }),
  );
  await deliver(
    assignment({
      assignmentId: randomUUID(),
      bookingId: randomUUID(),
      startsAt: t + 3_600_000,
      zoneId: otherZone,
      version: 1,
      status: 'UNASSIGNED',
      occurredAt: t,
    }),
  );

  const kpi = await queries.operationsKpis({ from: iso(from), to: iso(to), zoneId });
  assert.equal(kpi.derived, true);
  const byStatus = Object.fromEntries(kpi.assignmentsByStatus);
  assert.deepEqual(byStatus, { UNASSIGNED: 0, OFFERED: 3, ASSIGNED: 8, CANCELLED: 0 });
  assert.equal(kpi.reassigned, reassigned);
  assert.equal(kpi.assignedAfterStart, late);
  assert.deepEqual(kpi.timeToFirstOffer, live.summarizeDurations(expected.toOffer));
  assert.deepEqual(kpi.timeToAssign, live.summarizeDurations(expected.toAssign));
  assert.deepEqual(kpi.offerToAssign, live.summarizeDurations(expected.offerToAssign));

  const wide = await queries.operationsKpis({ from: iso(from), to: iso(to), zoneId: undefined });
  assert.equal(
    [...wide.assignmentsByStatus.values()].reduce((a, b) => a + b, 0),
    12,
    'the other zone counts without a zone filter; the out-of-window one never does',
  );
  const empty = await queries.operationsKpis({
    from: iso(to + 40 * 86_400_000),
    to: iso(to + 41 * 86_400_000),
    zoneId,
  });
  assert.deepEqual(empty.timeToAssign, { count: 0, p50Ms: null, p90Ms: null, maxMs: null });
});

async function cashSnapshot() {
  const states = await queries.cashKpis();
  const map = new Map();
  for (const s of states.states) {
    const totals = new Map(s.outstanding.map((o) => [o.currency, BigInt(o.amountMinor)]));
    map.set(s.cashState, { count: s.count, totals, oldestSince: s.oldestSince });
  }
  return { map, meta: states };
}

function delta(before, after, state, currency) {
  const b = before.map.get(state);
  const a = after.map.get(state);
  return {
    count: a.count - b.count,
    amount: (a.totals.get(currency) ?? 0n) - (b.totals.get(currency) ?? 0n),
  };
}

test('L7: cash states sum exactly beyond 2^53, newest revision wins, stale is ignored', async () => {
  const t = epoch();
  const before = await cashSnapshot();
  const big = '9007199254740993'; // 2^53 + 1: not representable as a binary float
  const a = randomUUID();
  const b = randomUUID();
  const c = randomUUID();
  await deliver(
    obligation({
      obligationId: a,
      version: 1,
      cashState: 'AWAITING_CASH',
      amountMinor: big,
      occurredAt: t,
    }),
  );
  await deliver(
    obligation({
      obligationId: b,
      version: 1,
      cashState: 'AWAITING_CASH',
      amountMinor: big,
      occurredAt: t + MIN,
    }),
  );
  await deliver(
    obligation({
      obligationId: c,
      version: 1,
      cashState: 'AWAITING_PAYMENT',
      amountMinor: '250000',
      currency: 'USD',
      occurredAt: t,
    }),
  );
  // c moves to review, then is paid; a late stale revision must not reopen it.
  await deliver(
    obligation({
      obligationId: c,
      version: 2,
      cashState: 'UNDER_REVIEW',
      amountMinor: '250000',
      currency: 'USD',
      occurredAt: t + 2 * MIN,
    }),
  );
  await deliver(
    obligation({
      obligationId: c,
      version: 3,
      cashState: 'PAID',
      amountMinor: '0',
      currency: 'USD',
      occurredAt: t + 3 * MIN,
    }),
  );
  assert.equal(
    await deliver(
      obligation({
        obligationId: c,
        version: 2,
        cashState: 'UNDER_REVIEW',
        amountMinor: '250000',
        currency: 'USD',
        occurredAt: t + 2 * MIN,
      }),
    ),
    'STALE',
  );
  await assert.rejects(
    deliver(
      obligation({
        obligationId: a,
        version: 2,
        cashState: 'AWAITING_CASH',
        amountMinor: '1',
        currency: 'USD',
        occurredAt: t,
      }),
    ),
    (e) => e instanceof OperationsIntegrityError && e.code === 'OBLIGATION_CURRENCY_CONFLICT',
  );
  const after = await cashSnapshot();
  assert.deepEqual(delta(before, after, 'AWAITING_CASH', 'SYP'), {
    count: 2,
    amount: 2n * 9007199254740993n,
  });
  assert.deepEqual(delta(before, after, 'PAID', 'USD'), { count: 1, amount: 0n });
  assert.deepEqual(delta(before, after, 'UNDER_REVIEW', 'USD'), { count: 0, amount: 0n });
  const awaiting = after.meta.states.find((s) => s.cashState === 'AWAITING_CASH');
  const syp = awaiting.outstanding.find((o) => o.currency === 'SYP');
  assert.equal(typeof syp.amountMinor, 'string');
  assert.equal(syp.scale, 2);
  assert.ok(awaiting.oldestSince.getTime() <= t, 'oldest backlog entry is at least this old');
  assert.deepEqual(
    after.meta.authority.map((x) => x.owner),
    ['billing'],
  );
});

test('L8: state_since keeps the entry time of an unchanged state and resets on change', async () => {
  const t = epoch();
  const id = randomUUID();
  await deliver(
    obligation({
      obligationId: id,
      version: 1,
      cashState: 'AWAITING_CASH',
      amountMinor: '1000',
      occurredAt: t,
    }),
  );
  await deliver(
    obligation({
      obligationId: id,
      version: 2,
      cashState: 'AWAITING_CASH',
      amountMinor: '600',
      occurredAt: t + 10 * MIN,
    }),
  );
  let r = await app.opsObligation.findUnique({ where: { obligationId: id } });
  assert.equal(r.stateSince.toISOString(), iso(t));
  assert.equal(r.outstandingMinor, 600n);
  await deliver(
    obligation({
      obligationId: id,
      version: 3,
      cashState: 'OUTCOME_UNKNOWN',
      amountMinor: '600',
      occurredAt: t + 20 * MIN,
    }),
  );
  r = await app.opsObligation.findUnique({ where: { obligationId: id } });
  assert.equal(r.stateSince.toISOString(), iso(t + 20 * MIN));
  assert.equal(r.cashState, 'OUTCOME_UNKNOWN');
});

test('L9: dispatch and billing freshness are reported with their own clocks', async () => {
  const kpi = await queries.operationsKpis({
    from: '2041-01-01T00:00:00Z',
    to: '2041-01-02T00:00:00Z',
    zoneId: undefined,
  });
  const dispatch = kpi.freshness.find((f) => f.source === 'dispatch');
  assert.equal(dispatch.status, 'FRESH');
  assert.ok(dispatch.appliedCount > 0n);
  assert.ok(!kpi.incompleteSources.includes('dispatch'));
  const cash = await queries.cashKpis();
  assert.deepEqual(
    cash.freshness.map((f) => [f.source, f.status]),
    [['billing', 'FRESH']],
  );
  assert.deepEqual(cash.incompleteSources, []);
});

/* --------------------------------- Part H --------------------------------- */

const reportingRequire = createRequire(path.join(ROOT, 'services', 'reporting', 'package.json'));

async function startReporting(identityBase) {
  process.env.DATABASE_URL = appDsn(context, 'reporting');
  process.env.IDENTITY_ORIGIN = identityBase;
  process.env.REPORTING_READS_PER_MINUTE = '1000';
  reportingRequire('reflect-metadata');
  const { createHttpApplication } = reportingRequire('./dist/transport/http/create-app.js');
  const server = await createHttpApplication();
  await server.listen(0, '127.0.0.1');
  const base = (await server.getUrl())
    .replace('[::1]', '127.0.0.1')
    .replace('localhost', '127.0.0.1');
  return { server, base };
}

test('H1: three staff roles over real Identity — each sees only its KPIs', async (t) => {
  const identity = await startIdentity();
  t.after(() => identity.app.close().catch(() => {}));
  const reporting = await startReporting(identity.base);
  t.after(() => reporting.server.close());
  const get = async (route, who) => {
    const response = await fetch(`${reporting.base}/internal/v1/reporting/operations${route}`, {
      headers: who ? { authorization: bearer(who) } : {},
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  const operations = await staff(identity, ['operations']);
  const finance = await staff(identity, ['finance']);
  const superAdmin = await staff(identity, ['super-admin']);
  const customer = await account(identity);

  const day = epoch();
  const life = lifecycle({ t: day, zoneId: randomUUID() });
  for (const fact of life.facts) await deliver(fact);
  const window = `?from=${iso(day)}&to=${iso(day + 86_400_000)}`;

  const ops = await get(`/kpis/operations${window}`, operations);
  assert.equal(ops.status, 200);
  assert.equal(ops.body.derived, true);
  assert.equal(ops.body.assignments.byStatus.ASSIGNED >= 1, true);
  assert.equal(ops.body.assignments.timeToAssign.count >= 1, true);
  assert.deepEqual(ops.body.fieldStages, { available: false, reason: 'NO_PUBLISHED_SOURCE' });
  assert.deepEqual(
    ops.body.freshness.map((f) => f.source),
    ['booking', 'scheduling', 'dispatch'],
  );
  assert.ok(Array.isArray(ops.body.incompleteSources));

  const cash = await get('/kpis/cash', finance);
  assert.equal(cash.status, 200);
  assert.deepEqual(
    cash.body.states.map((s) => s.cashState),
    [
      'UNPAID',
      'AWAITING_CASH',
      'AWAITING_PAYMENT',
      'UNDER_REVIEW',
      'OUTCOME_UNKNOWN',
      'PAID',
      'VOIDED',
    ],
  );
  for (const s of cash.body.states)
    for (const o of s.outstanding) assert.match(o.amountMinor, /^(0|[1-9][0-9]*)$/);

  // Denials: each role is refused the other's KPI, customers everything.
  assert.equal((await get('/kpis/cash', operations)).status, 403);
  assert.equal((await get(`/kpis/operations${window}`, finance)).status, 403);
  assert.equal((await get(`/bookings${window}`, finance)).status, 403);
  assert.equal((await get(`/kpis/operations${window}`, customer)).status, 403);
  assert.equal((await get('/kpis/cash', customer)).status, 403);
  assert.equal((await get('/kpis/cash')).status, 401);
  assert.equal((await get(`/kpis/operations?from=bad&to=bad`, operations)).status, 422);

  // super-admin holds every permission and reads both.
  assert.equal((await get(`/kpis/operations${window}`, superAdmin)).status, 200);
  assert.equal((await get('/kpis/cash', superAdmin)).status, 200);
});
