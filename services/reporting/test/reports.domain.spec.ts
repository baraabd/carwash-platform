import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { OperationsIntegrityError, OperationsRuleError } from '../src/domain/operations';
import {
  MAX_EXPORT_ROWS,
  csvDocument,
  csvField,
  decimalDivide,
  growth,
  idempotencyKey,
  reportPeriod,
  streamStatus,
  REPORT_STALE_AFTER_MS,
} from '../src/domain/reports';
import {
  foldObligation,
  foldRefund,
  obligationCreatedFact,
  obligationStatusFact,
  refundFact,
  revenueFingerprint,
} from '../src/domain/revenue';
import {
  ExportIdempotencyConflict,
  ReportExports,
  ReportQueries,
  exportParameters,
  parseRevenueEvent,
} from '../src/application/reports.service';
import { requireReport } from '../src/application/access';
import { AccessFault, type VerifiedSession } from '../src/ports/identity.ports';
import type {
  ExportAuditRecord,
  ExportStore,
  ReportsReader,
  StoredExport,
} from '../src/ports/reports.ports';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

function rejects(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof OperationsRuleError && e.code === code, code);
}

/* -------------------------------- growth ---------------------------------- */

test('growth is exact decimal math, rounded half away from zero, null on a zero base', () => {
  assert.deepEqual(growth(1182n, 1000n), { ratio: '0.182000', percent: '18.20', reason: null });
  assert.deepEqual(growth(500n, 1000n), { ratio: '-0.500000', percent: '-50.00', reason: null });
  assert.deepEqual(growth(1000n, 1000n), { ratio: '0.000000', percent: '0.00', reason: null });
  assert.deepEqual(growth(5n, 0n), { ratio: null, percent: null, reason: 'ZERO_BASE' });
  assert.deepEqual(growth(0n, 0n), { ratio: null, percent: null, reason: 'ZERO_BASE' });
  // 2/3 growth: 0.6666666.. -> 0.666667 and 66.67 (no binary float involved).
  assert.deepEqual(growth(5n, 3n), { ratio: '0.666667', percent: '66.67', reason: null });
  // Values beyond 2^53 stay exact.
  const big = 2n ** 60n;
  assert.equal(growth(big * 3n, big).percent, '200.00');
  assert.equal(decimalDivide(-1n, 3n, 2), '-0.33');
  assert.equal(decimalDivide(-2n, 3n, 2), '-0.67');
  assert.equal(decimalDivide(1n, 200n, 2), '0.01');
  assert.equal(decimalDivide(-1n, 1000n, 2), '0.00');
  assert.equal(decimalDivide(2_820_000n, 60_000n, 2), '47.00');
});

/* -------------------------------- periods --------------------------------- */

test('periods: aligned, bounded, zone from a closed set, previous equal period', () => {
  const day = reportPeriod({
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-08T00:00:00.000Z',
    timezone: 'UTC',
    granularity: 'day',
  });
  assert.equal(day.buckets.length, 7);
  assert.equal(day.previous.from.toISOString(), '2026-09-24T00:00:00.000Z');
  assert.equal(day.previous.to.toISOString(), '2026-10-01T00:00:00.000Z');

  // Damascus civil days start at 21:00Z (UTC+3).
  const damascus = reportPeriod({
    from: '2026-09-30T21:00:00.000Z',
    to: '2026-10-02T21:00:00.000Z',
    timezone: 'Asia/Damascus',
    granularity: 'day',
  });
  assert.deepEqual(
    damascus.buckets.map((b) => b.toISOString()),
    ['2026-09-30T21:00:00.000Z', '2026-10-01T21:00:00.000Z'],
  );
  const hours = reportPeriod({
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-01T05:00:00Z',
    timezone: 'Asia/Damascus',
    granularity: 'hour',
  });
  assert.equal(hours.buckets.length, 5);

  const base = { timezone: 'UTC', granularity: 'day' };
  rejects(() => reportPeriod({ ...base, from: '2026-10-01', to: '2026-10-02' }), 'INVALID_FROM');
  rejects(
    () => reportPeriod({ ...base, from: '2026-10-01T00:00:00Z', to: '2026-02-30T00:00:00Z' }),
    'INVALID_TO',
  );
  rejects(
    () => reportPeriod({ ...base, from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }),
    'INVALID_PERIOD',
  );
  rejects(
    () => reportPeriod({ ...base, from: '2026-10-01T03:00:00Z', to: '2026-10-02T00:00:00Z' }),
    'PERIOD_NOT_ALIGNED',
  );
  rejects(
    () => reportPeriod({ ...base, from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }),
    'PERIOD_TOO_LARGE',
  );
  rejects(
    () =>
      reportPeriod({
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-09T01:00:00Z',
        timezone: 'UTC',
        granularity: 'hour',
      }),
    'PERIOD_TOO_LARGE',
  );
  rejects(
    () =>
      reportPeriod({
        from: '2026-10-01T00:30:00Z',
        to: '2026-10-01T02:00:00Z',
        timezone: 'UTC',
        granularity: 'hour',
      }),
    'PERIOD_NOT_ALIGNED',
  );
  rejects(
    () =>
      reportPeriod({
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-02T00:00:00Z',
        timezone: 'Europe/Berlin',
        granularity: 'day',
      }),
    'INVALID_TIMEZONE',
  );
  rejects(
    () =>
      reportPeriod({
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-02T00:00:00Z',
        timezone: 'UTC',
        granularity: 'week',
      }),
    'INVALID_GRANULARITY',
  );
});

/* ------------------------------- freshness -------------------------------- */

test('freshness: NEVER_RECEIVED, FRESH within the documented threshold, STALE after', () => {
  const now = new Date('2026-10-11T12:00:00.000Z');
  assert.equal(streamStatus('billing', null, now).state, 'NEVER_RECEIVED');
  assert.equal(streamStatus('billing', null, now).stream, 'washgo.billing.events');
  const at = (ms: number) => ({
    lastEventOccurredAt: new Date(now.getTime() - ms - 5),
    lastAppliedAt: new Date(now.getTime() - ms),
    appliedCount: 3n,
  });
  assert.equal(streamStatus('billing', at(0), now).state, 'FRESH');
  assert.equal(streamStatus('billing', at(REPORT_STALE_AFTER_MS), now).state, 'FRESH');
  assert.equal(streamStatus('billing', at(REPORT_STALE_AFTER_MS + 1), now).state, 'STALE');
  assert.equal(REPORT_STALE_AFTER_MS, 900_000);
});

/* ---------------------------------- CSV ----------------------------------- */

test('CSV: RFC 4180 quoting, formula injection neutralised, BOM and CRLF', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line\nbreak'), '"line\nbreak"');
  for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
    const cell = `${lead}HYPERLINK("http://x")`;
    const out = csvField(cell);
    assert.ok(out.startsWith("'") || out.startsWith(`"'`), JSON.stringify(out));
  }
  assert.equal(csvField('=1+1'), "'=1+1");
  assert.equal(csvField('-2+3'), "'-2+3");
  assert.equal(csvField('@SUM(A1)'), "'@SUM(A1)");
  // A plain signed decimal is a number, never a formula: kept as is.
  assert.equal(csvField('-150'), '-150');
  assert.equal(csvField('-0.50'), '-0.50');
  assert.equal(csvField('الإيرادات'), 'الإيرادات');

  const doc = csvDocument({
    meta: [
      ['report', 'revenue'],
      ['note', '=cmd|calc'],
    ],
    columns: ['bucketStart', 'settledMinor', 'x'],
    rows: [['2026-10-01T00:00:00.000Z', '100', 'a,b']],
  });
  assert.ok(doc.startsWith('﻿'));
  assert.equal(Buffer.from(doc, 'utf8').subarray(0, 3).toString('hex'), 'efbbbf');
  const lines = doc.slice(1).split('\r\n');
  assert.deepEqual(lines, [
    'report,revenue,',
    "note,'=cmd|calc,",
    ',,',
    'bucketStart,settledMinor,x',
    '2026-10-01T00:00:00.000Z,100,"a,b"',
    '',
  ]);
  rejects(
    () =>
      csvDocument({
        meta: [],
        columns: ['a', 'b'],
        rows: Array.from({ length: MAX_EXPORT_ROWS + 1 }, () => ['1', '2']),
      }),
    'EXPORT_TOO_LARGE',
  );
});

/* ---------------------------- revenue folding ----------------------------- */

const OBL = '5b0c2f4e-8a1d-4c3e-9f2a-1b2c3d4e5f60';
const money = (amountMinor: string) => ({ currency: 'SYP', amountMinor, scale: 2 });

function created(version = 1, at = '2026-10-01T10:00:00.000Z') {
  return obligationCreatedFact({
    eventId: randomUUID(),
    occurredAt: at,
    version,
    obligationId: OBL,
    status: 'UNPAID',
    amount: money('150000'),
  });
}

function status(version: number, s: 'PAID' | 'CASH_COLLECTED' | 'AWAITING_CASH', at: string) {
  const settled = s !== 'AWAITING_CASH';
  return obligationStatusFact({
    eventId: randomUUID(),
    occurredAt: at,
    version,
    obligationId: OBL,
    status: s,
    verified: money(settled ? '150000' : '0'),
    outstanding: money(settled ? '0' : '150000'),
  });
}

test('obligation folding: monotonic, creation learned in any order, settlement cleared on reversal', () => {
  const c = created();
  const first = foldObligation(null, c, sha(revenueFingerprint(c)));
  assert.equal(first.decision, 'APPLIED');
  assert.equal(first.next?.settledAt, null);

  const paid = status(2, 'CASH_COLLECTED', '2026-10-01T12:00:00.000Z');
  const second = foldObligation(first.next, paid, sha(revenueFingerprint(paid)));
  assert.equal(second.next?.settledAt?.toISOString(), '2026-10-01T12:00:00.000Z');
  assert.equal(second.next?.amountMinor, 150000n);
  assert.equal(second.next?.createdAt?.toISOString(), '2026-10-01T10:00:00.000Z');

  // Same version, same content: SAME; different content: integrity conflict.
  assert.equal(foldObligation(second.next, paid, sha(revenueFingerprint(paid))).decision, 'SAME');
  assert.throws(
    () => foldObligation(second.next, paid, sha('other')),
    (e: unknown) => e instanceof OperationsIntegrityError && e.code === 'FACT_VERSION_CONFLICT',
  );

  // Reversal: a newer non-settled status removes it from the settled figure.
  const reversed = status(3, 'AWAITING_CASH', '2026-10-02T09:00:00.000Z');
  const third = foldObligation(second.next, reversed, sha(revenueFingerprint(reversed)));
  assert.equal(third.next?.settledAt, null);

  // Out of order: status first, then the (stale) creation fills amount/time only.
  const early = foldObligation(null, paid, sha(revenueFingerprint(paid)));
  assert.equal(early.next?.createdAt, null);
  const late = foldObligation(early.next, c, sha(revenueFingerprint(c)));
  assert.equal(late.decision, 'STALE');
  assert.equal(late.next?.status, 'CASH_COLLECTED');
  assert.equal(late.next?.createdAt?.toISOString(), '2026-10-01T10:00:00.000Z');
  assert.equal(foldObligation(late.next, c, sha(revenueFingerprint(c))).next, null);

  // One obligation keeps one currency.
  const usd = obligationStatusFact({
    eventId: randomUUID(),
    occurredAt: '2026-10-03T00:00:00.000Z',
    version: 9,
    obligationId: OBL,
    status: 'PAID',
    verified: { currency: 'USD', amountMinor: '1', scale: 2 },
    outstanding: { currency: 'USD', amountMinor: '0', scale: 2 },
  });
  assert.throws(
    () => foldObligation(second.next, usd, sha(revenueFingerprint(usd))),
    (e: unknown) => e instanceof OperationsIntegrityError,
  );
  rejects(
    () =>
      obligationStatusFact({
        eventId: randomUUID(),
        occurredAt: '2026-10-03T00:00:00.000Z',
        version: 4,
        obligationId: OBL,
        status: 'PAID',
        verified: money('1'),
        outstanding: money('5'),
      }),
    'CLOSED_OBLIGATION_HAS_OUTSTANDING',
  );
});

test('refund folding: succeededAt only while SUCCEEDED; earliest observation kept', () => {
  const refundId = randomUUID();
  const mk = (version: number, s: 'REQUESTED' | 'SUCCEEDED', at: string) =>
    refundFact({
      eventId: randomUUID(),
      occurredAt: at,
      version,
      refundId,
      obligationId: OBL,
      status: s,
      amount: money('5000'),
    });
  const ok = mk(2, 'SUCCEEDED', '2026-10-02T00:00:00.000Z');
  const a = foldRefund(null, ok, sha(revenueFingerprint(ok)));
  assert.equal(a.next?.succeededAt?.toISOString(), '2026-10-02T00:00:00.000Z');
  const req = mk(1, 'REQUESTED', '2026-10-01T00:00:00.000Z');
  const b = foldRefund(a.next, req, sha(revenueFingerprint(req)));
  assert.equal(b.decision, 'STALE');
  assert.equal(b.next?.firstObservedAt.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(b.next?.status, 'SUCCEEDED');
});

test('parseRevenueEvent accepts only the registered Billing contract', () => {
  const event = {
    eventId: randomUUID(),
    eventType: 'billing.obligation-created.v1',
    envelopeVersion: 2,
    producer: 'billing',
    occurredAt: '2026-10-01T10:00:00.000Z',
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'billing-obligation', id: OBL, version: 1 },
    actor: { kind: 'service', id: 'billing' },
    data: { quoteId: randomUUID(), amount: money('150000'), financialStatus: 'UNPAID' },
  };
  const parsed = parseRevenueEvent(event);
  assert.equal(parsed.fact.kind, 'REVENUE_OBLIGATION_CREATED');
  assert.throws(() => parseRevenueEvent({ ...event, data: { ...event.data, extra: 1 } }));
  assert.throws(() => parseRevenueEvent({ ...event, eventType: 'billing.cash-collected.v1' }));
  rejects(
    () => parseRevenueEvent({ ...event, eventType: 'billing.unknown.v1' }),
    'UNSUPPORTED_EVENT',
  );
});

/* ---------------------------- access + exports ---------------------------- */

const session = (permissions: string[]): VerifiedSession => ({
  subject: randomUUID(),
  sessionId: randomUUID(),
  authVersion: 1,
  permissions,
});

test('report access: finance reads revenue, operations reads operations, deny by default', () => {
  requireReport(session(['billing.read']), 'revenue');
  requireReport(session(['operations.dispatch']), 'operations');
  for (const [perms, report] of [
    [['operations.dispatch'], 'revenue'],
    [['billing.read'], 'operations'],
    [[], 'revenue'],
    [['support.cases.read', 'verification.review'], 'operations'],
  ] as const)
    assert.throws(
      () => requireReport(session([...perms]), report),
      (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_FORBIDDEN',
    );
});

function emptyReader(): ReportsReader {
  return {
    settled: async () => ({
      obligationCount: 0,
      verifiedPaymentMinor: '0',
      cashCollectedMinor: '0',
      amountUnknownCount: 0,
    }),
    pending: async () => [],
    voided: async () => 0,
    refunds: async () => ({ succeededCount: 0, succeededMinor: '0', openCount: 0, openMinor: '0' }),
    revenueSeries: async () => [],
    scheduledDuration: async () => ({ count: 0, totalMs: '0', p50Ms: null, p90Ms: null }),
    bookedCapacity: async () => ({ committedHolds: 0, bookedMs: '0' }),
    eligibleResources: async () => 0,
    operationsSeries: async () => [],
    checkpoints: async () => new Map(),
  };
}

class MemoryExports implements ExportStore {
  readonly rows = new Map<string, StoredExport>();
  async find(subject: string, key: string): Promise<StoredExport | null> {
    return this.rows.get(`${subject}|${key}`) ?? null;
  }
  async createOnce(audit: ExportAuditRecord, content: string) {
    const k = `${audit.subject}|${audit.idempotencyKey}`;
    const existing = this.rows.get(k);
    if (existing) return { created: false, stored: existing };
    const stored = { audit, content };
    this.rows.set(k, stored);
    return { created: true, stored };
  }
}

test('exports: replay by key, conflict on different parameters, no data in the audit', async () => {
  const clock = { now: () => new Date('2026-10-11T00:00:00.000Z') };
  const store = new MemoryExports();
  const exports = new ReportExports(
    new ReportQueries(emptyReader(), clock),
    store,
    sha,
    clock,
    randomUUID,
  );
  const subject = randomUUID();
  const parameters = exportParameters('revenue', {
    report: 'revenue',
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-03T00:00:00.000Z',
    timezone: 'UTC',
    granularity: 'day',
    currency: 'SYP',
  });
  const first = await exports.create({ subject, idempotencyKey: 'export-key-0001', parameters });
  assert.equal(first.created, true);
  assert.equal(first.audit.rowCount, 2);
  assert.ok(first.csv.includes('source.billing.state,NEVER_RECEIVED'));
  assert.ok(first.csv.includes('growthUnavailableReason,ZERO_BASE'));
  const again = await exports.create({ subject, idempotencyKey: 'export-key-0001', parameters });
  assert.equal(again.created, false);
  assert.equal(again.csv, first.csv);
  await assert.rejects(
    exports.create({
      subject,
      idempotencyKey: 'export-key-0001',
      parameters: exportParameters('revenue', {
        report: 'revenue',
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-03T00:00:00.000Z',
        timezone: 'UTC',
        granularity: 'day',
        currency: 'USD',
      }),
    }),
    (e: unknown) => e instanceof ExportIdempotencyConflict,
  );
  assert.deepEqual(Object.keys(first.audit).sort(), [
    'contentSha256',
    'exportId',
    'generatedAt',
    'idempotencyKey',
    'parametersHash',
    'report',
    'rowCount',
    'subject',
  ]);
  rejects(() => idempotencyKey('short'), 'IDEMPOTENCY_KEY_INVALID');
  rejects(
    () => exportParameters('revenue', { ...parameters, zoneId: randomUUID() }),
    'INVALID_EXPORT_REQUEST',
  );
  rejects(
    () => exportParameters('revenue', { ...parameters, currency: 'EUR' }),
    'INVALID_CURRENCY',
  );
});

test('operations report says unavailable instead of inventing execution time or capacity', async () => {
  const clock = { now: () => new Date('2026-10-11T00:00:00.000Z') };
  const report = await new ReportQueries(emptyReader(), clock).operations({
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-02T00:00:00.000Z',
    timezone: 'UTC',
    granularity: 'hour',
    zoneId: undefined,
  });
  assert.deepEqual(report.executionDuration, {
    available: false,
    averageMs: null,
    reason: 'NO_FIELD_PROGRESS_SOURCE',
  });
  assert.equal(report.scheduledServiceDuration.reason, 'NO_DATA');
  assert.equal(report.scheduledServiceDuration.averageMs, null);
  assert.equal(report.capacityUtilization.available, false);
  assert.equal(report.capacityUtilization.ratio, null);
  assert.equal(report.series.length, 24);
  assert.deepEqual(report.incompleteSources, ['scheduling', 'dispatch', 'workforce']);
});
