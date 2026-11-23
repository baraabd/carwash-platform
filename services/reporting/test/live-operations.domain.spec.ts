import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  OperationsRuleError,
  factFingerprint,
  type AssignmentStatus,
} from '../src/domain/operations';
import {
  assignmentFact,
  exactAmount,
  incompleteSources,
  mergeMilestones,
  nearestRank,
  obligationFact,
  summarizeDurations,
} from '../src/domain/live-operations';
import { OperationsProjector, OperationsQueries } from '../src/application/operations.service';
import { requireRead } from '../src/application/access';
import { AccessFault, type VerifiedSession } from '../src/ports/identity.ports';
import type {
  FactOutcome,
  OperationsReader,
  OperationsWriter,
} from '../src/ports/operations.ports';

const T0 = Date.parse('2026-10-09T08:00:00.000Z');
const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

function rejects(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof OperationsRuleError && e.code === code);
}

function assignment(
  status: AssignmentStatus,
  patch: Partial<Parameters<typeof assignmentFact>[0]> = {},
) {
  return assignmentFact({
    eventId: randomUUID(),
    occurredAt: new Date(T0),
    version: 1,
    assignmentId: randomUUID(),
    bookingId: randomUUID(),
    status,
    zoneId: randomUUID(),
    startsAt: new Date(T0 + 3_600_000),
    endsAt: new Date(T0 + 7_200_000),
    resourceId: status === 'ASSIGNED' ? randomUUID() : null,
    ...patch,
  });
}

/* ---------------------------------- facts --------------------------------- */

test('assignment fact: a resource is named exactly when ASSIGNED', () => {
  assert.equal(assignment('ASSIGNED').status, 'ASSIGNED');
  rejects(() => assignment('ASSIGNED', { resourceId: null }), 'ASSIGNMENT_RESOURCE_MISMATCH');
  rejects(
    () => assignment('OFFERED', { resourceId: randomUUID() }),
    'ASSIGNMENT_RESOURCE_MISMATCH',
  );
  rejects(() => assignment('UNASSIGNED', { status: 'EN_ROUTE' }), 'INVALID_ASSIGNMENT_STATUS');
});

test('assignment fact: empty windows, bad ids, versions and instants are rejected', () => {
  rejects(() => assignment('OFFERED', { endsAt: new Date(T0 + 3_600_000) }), 'INVALID_JOB_WINDOW');
  rejects(() => assignment('OFFERED', { bookingId: 'booking-1' }), 'INVALID_BOOKING_ID');
  rejects(() => assignment('OFFERED', { version: 0 }), 'INVALID_VERSION');
  rejects(() => assignment('OFFERED', { version: 1.5 }), 'INVALID_VERSION');
  rejects(() => assignment('OFFERED', { occurredAt: new Date(Number.NaN) }), 'INVALID_OCCURRED_AT');
  const upper = randomUUID().toUpperCase();
  assert.equal(assignment('OFFERED', { assignmentId: upper }).assignmentId, upper.toLowerCase());
});

test('exact amount: integer minor units only, never a float, inside BIGINT', () => {
  assert.equal(
    exactAmount({ currency: 'SYP', amountMinor: '1500000', scale: 2 }).amountMinor,
    1_500_000n,
  );
  for (const amountMinor of ['1.5', '-1', '01', '1e3', '', '1000000000000000000'])
    rejects(() => exactAmount({ currency: 'SYP', amountMinor, scale: 2 }), 'INVALID_AMOUNT');
  rejects(() => exactAmount({ currency: 'syp', amountMinor: '1', scale: 2 }), 'INVALID_CURRENCY');
  rejects(() => exactAmount({ currency: 'SYP', amountMinor: '1', scale: 5 }), 'INVALID_SCALE');
});

test('obligation fact: a PAID or VOIDED obligation cannot still owe money', () => {
  const base = {
    eventId: randomUUID(),
    occurredAt: new Date(T0),
    version: 2,
    obligationId: randomUUID(),
  };
  const owed = exactAmount({ currency: 'SYP', amountMinor: '500000', scale: 2 });
  const zero = exactAmount({ currency: 'SYP', amountMinor: '0', scale: 2 });
  assert.equal(
    obligationFact({ ...base, cashState: 'AWAITING_CASH', outstanding: owed }).cashState,
    'AWAITING_CASH',
  );
  assert.equal(obligationFact({ ...base, cashState: 'PAID', outstanding: zero }).cashState, 'PAID');
  rejects(
    () => obligationFact({ ...base, cashState: 'PAID', outstanding: owed }),
    'CLOSED_OBLIGATION_HAS_OUTSTANDING',
  );
  rejects(
    () => obligationFact({ ...base, cashState: 'VOIDED', outstanding: owed }),
    'CLOSED_OBLIGATION_HAS_OUTSTANDING',
  );
  rejects(
    () => obligationFact({ ...base, cashState: 'SETTLED', outstanding: zero }),
    'INVALID_CASH_STATE',
  );
});

test('fingerprints: same content same print, any field change differs', () => {
  const a = assignment('ASSIGNED');
  assert.equal(factFingerprint(a), factFingerprint({ ...a, eventId: randomUUID() }));
  assert.notEqual(factFingerprint(a), factFingerprint({ ...a, resourceId: randomUUID() }));
  const o = obligationFact({
    eventId: randomUUID(),
    occurredAt: new Date(T0),
    version: 1,
    obligationId: randomUUID(),
    cashState: 'AWAITING_CASH',
    outstanding: exactAmount({ currency: 'SYP', amountMinor: '100', scale: 2 }),
  });
  assert.notEqual(
    factFingerprint(o),
    factFingerprint({ ...o, outstanding: { ...o.outstanding, amountMinor: 101n } }),
  );
});

/* -------------------------------- milestones ------------------------------- */

test('milestones: earliest occurrence per status, whatever the delivery order', () => {
  const facts: { status: AssignmentStatus; occurredAt: Date }[] = [
    { status: 'UNASSIGNED', occurredAt: new Date(T0) },
    { status: 'OFFERED', occurredAt: new Date(T0 + 60_000) },
    { status: 'UNASSIGNED', occurredAt: new Date(T0 + 120_000) },
    { status: 'OFFERED', occurredAt: new Date(T0 + 180_000) },
    { status: 'ASSIGNED', occurredAt: new Date(T0 + 240_000) },
    { status: 'ASSIGNED', occurredAt: new Date(T0 + 300_000) },
  ];
  const permutations = [
    facts,
    [...facts].reverse(),
    [facts[4], facts[1], facts[5], facts[0], facts[3], facts[2]],
  ];
  for (const order of permutations) {
    const result = order.reduce(
      (m, f) => mergeMilestones(m, f!),
      null as ReturnType<typeof mergeMilestones> | null,
    );
    assert.deepEqual(result, {
      firstObservedAt: new Date(T0),
      firstOfferedAt: new Date(T0 + 60_000),
      firstAssignedAt: new Date(T0 + 240_000),
    });
  }
});

/* -------------------------------- percentiles ------------------------------ */

test('nearest rank equals PostgreSQL percentile_disc on known series', () => {
  const series = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(nearestRank(series, 0.5), 50);
  assert.equal(nearestRank(series, 0.9), 90);
  assert.equal(nearestRank([7], 0.9), 7);
  assert.equal(nearestRank([], 0.5), null);
  assert.equal(nearestRank([1, 2, 3], 0.5), 2);
  rejects(() => nearestRank([1], 0), 'INVALID_PERCENTILE');
  assert.deepEqual(summarizeDurations([30, 10, 20, -5, Number.NaN]), {
    count: 3,
    p50Ms: 20,
    p90Ms: 30,
    maxMs: 30,
  });
  assert.deepEqual(summarizeDurations([]), { count: 0, p50Ms: null, p90Ms: null, maxMs: null });
});

test('incomplete sources: anything not FRESH makes the KPI partial', () => {
  assert.deepEqual(
    incompleteSources([
      { source: 'booking', status: 'FRESH' },
      { source: 'dispatch', status: 'NO_DATA' },
      { source: 'scheduling', status: 'STALE' },
    ]),
    ['dispatch', 'scheduling'],
  );
});

/* -------------------------------- application ------------------------------ */

test('projector routes dispatch and billing facts and moves their freshness', async () => {
  const seen: string[] = [];
  const writer: OperationsWriter = {
    applyBookingConfirmed: () => Promise.reject(new Error('unexpected')),
    applyHoldChanged: () => Promise.reject(new Error('unexpected')),
    applyEligibilityChanged: () => Promise.reject(new Error('unexpected')),
    applyAssignmentChanged: (fact): Promise<FactOutcome> => {
      seen.push(`assignment:${fact.status}`);
      return Promise.resolve('APPLIED');
    },
    applyObligationStatus: (fact): Promise<FactOutcome> => {
      seen.push(`obligation:${fact.cashState}`);
      return Promise.resolve('STALE');
    },
    touchFreshness: (source) => {
      seen.push(`fresh:${source}`);
      return Promise.resolve();
    },
  };
  const projector = new OperationsProjector(sha256Hex, { now: () => new Date(T0) });
  assert.equal(await projector.apply(writer, assignment('OFFERED')), 'APPLIED');
  const owed = exactAmount({ currency: 'USD', amountMinor: '2500', scale: 2 });
  assert.equal(
    await projector.apply(
      writer,
      obligationFact({
        eventId: randomUUID(),
        occurredAt: new Date(T0),
        version: 3,
        obligationId: randomUUID(),
        cashState: 'UNDER_REVIEW',
        outstanding: owed,
      }),
    ),
    'STALE',
  );
  assert.deepEqual(seen, [
    'assignment:OFFERED',
    'fresh:dispatch',
    'obligation:UNDER_REVIEW',
    'fresh:billing',
  ]);
});

function reader(overrides: Partial<OperationsReader>): OperationsReader {
  const never = () => Promise.reject(new Error('not used'));
  return {
    listBookings: never,
    booking: never,
    bookingHolds: never,
    bookingAssignments: never,
    listResources: never,
    resourceSummary: never,
    operationsKpis: never,
    cashKpis: never,
    checkpoints: () => Promise.resolve(new Map()),
    ...overrides,
  };
}

test('KPI queries: validated window, derived label, owners and partial-source flag', async () => {
  let asked: unknown = null;
  const queries = new OperationsQueries(
    reader({
      operationsKpis: (input) => {
        asked = input;
        return Promise.resolve({
          bookingsByStatus: new Map(),
          assignmentsByStatus: new Map(),
          reassigned: 0,
          assignedAfterStart: 0,
          timeToFirstOffer: summarizeDurations([]),
          timeToAssign: summarizeDurations([]),
          offerToAssign: summarizeDurations([]),
        });
      },
      cashKpis: () => Promise.resolve([]),
    }),
    { now: () => new Date(T0) },
  );
  const kpi = await queries.operationsKpis({
    from: '2026-10-09T00:00:00Z',
    to: '2026-10-10T00:00:00Z',
    zoneId: undefined,
  });
  assert.deepEqual(asked, {
    from: new Date('2026-10-09T00:00:00Z'),
    to: new Date('2026-10-10T00:00:00Z'),
    zoneId: null,
  });
  assert.equal(kpi.derived, true);
  assert.deepEqual(kpi.incompleteSources, ['booking', 'scheduling', 'dispatch']);
  assert.ok(kpi.authority.some((a) => a.owner === 'dispatch'));
  await assert.rejects(
    queries.operationsKpis({
      from: '2026-10-09T00:00:00Z',
      to: '2026-12-09T00:00:00Z',
      zoneId: undefined,
    }),
    (e: unknown) => e instanceof OperationsRuleError && e.code === 'WINDOW_TOO_LARGE',
  );
  const cash = await queries.cashKpis();
  assert.deepEqual(cash.incompleteSources, ['billing']);
  assert.deepEqual(
    cash.authority.map((a) => a.owner),
    ['billing'],
  );
  assert.equal(cash.asOf.getTime(), T0);
});

function session(permissions: string[]): VerifiedSession {
  return { subject: randomUUID(), sessionId: randomUUID(), authVersion: 1, permissions };
}

test('KPI access: operations sees operations KPIs only, finance sees cash only', () => {
  const forbidden = (fn: () => void) =>
    assert.throws(fn, (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_FORBIDDEN');
  const operations = session(['operations.dispatch']);
  const finance = session(['billing.read', 'billing.refund']);
  const reviewer = session(['verification.review']);
  requireRead(operations, 'operationsKpis');
  forbidden(() => requireRead(operations, 'cashKpis'));
  requireRead(finance, 'cashKpis');
  requireRead(finance, 'freshness');
  forbidden(() => requireRead(finance, 'operationsKpis'));
  forbidden(() => requireRead(finance, 'bookings'));
  forbidden(() => requireRead(reviewer, 'cashKpis'));
  forbidden(() => requireRead(reviewer, 'operationsKpis'));
});
