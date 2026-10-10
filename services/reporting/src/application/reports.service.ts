import {
  BILLING_EVENTS_EXCHANGE,
  BILLING_OBLIGATION_CREATED_V1,
  BILLING_OBLIGATION_STATUS_CHANGED_V1,
  BILLING_REFUND_STATUS_CHANGED_V1,
} from '@carwash/event-contracts';
import { OperationsRuleError, uuidInput, type OperationsSource } from '../domain/operations';
import {
  EXPORT_REPLAY_TTL_MS,
  REPORT_CURRENCIES,
  REPORT_STALE_AFTER_MS,
  csvDocument,
  decimalDivide,
  exactInteger,
  growth,
  idempotencyKey,
  reportCurrency,
  reportPeriod,
  streamStatus,
  type Growth,
  type ReportCurrency,
  type ReportKind,
  type ReportPeriod,
  type SourceStreamStatus,
} from '../domain/reports';
import {
  PENDING_STATUSES,
  obligationCreatedFact,
  obligationStatusFact,
  refundFact,
  revenueFingerprint,
  type RevenueDecision,
  type RevenueFact,
} from '../domain/revenue';
import type { Hasher } from '../ports/projection.ports';
import type {
  ExportAuditRecord,
  ExportStore,
  ReportsReader,
  RevenueWriter,
} from '../ports/reports.ports';
import type { Authority, OperationsClock } from './operations.service';

/* ------------------------------ consumption ------------------------------- */

/**
 * The REGISTERED Billing events the revenue projection consumes. Cash-receipt,
 * reversal and custody events are not needed: the obligation status event
 * already carries every settlement change, and custody is not revenue.
 */
export const REVENUE_SUBSCRIPTIONS = [
  { exchange: BILLING_EVENTS_EXCHANGE, eventType: BILLING_OBLIGATION_CREATED_V1.eventType },
  { exchange: BILLING_EVENTS_EXCHANGE, eventType: BILLING_OBLIGATION_STATUS_CHANGED_V1.eventType },
  { exchange: BILLING_EVENTS_EXCHANGE, eventType: BILLING_REFUND_STATUS_CHANGED_V1.eventType },
] as const;

export interface RevenueEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly fact: RevenueFact;
}

/**
 * Parses one delivered Billing event with the PUBLISHED contract parser.
 * Anything else throws, and the consumer dead-letters it rather than guessing.
 */
export function parseRevenueEvent(raw: unknown): RevenueEvent {
  const eventType =
    raw !== null && typeof raw === 'object'
      ? (raw as { eventType?: unknown }).eventType
      : undefined;
  switch (eventType) {
    case BILLING_OBLIGATION_CREATED_V1.eventType: {
      const e = BILLING_OBLIGATION_CREATED_V1.parse(raw);
      return {
        eventId: e.eventId.toLowerCase(),
        eventType: e.eventType,
        correlationId: e.correlationId,
        fact: obligationCreatedFact({
          eventId: e.eventId,
          occurredAt: e.occurredAt,
          version: e.aggregate.version,
          obligationId: e.aggregate.id,
          status: e.data.financialStatus,
          amount: e.data.amount,
        }),
      };
    }
    case BILLING_OBLIGATION_STATUS_CHANGED_V1.eventType: {
      const e = BILLING_OBLIGATION_STATUS_CHANGED_V1.parse(raw);
      return {
        eventId: e.eventId.toLowerCase(),
        eventType: e.eventType,
        correlationId: e.correlationId,
        fact: obligationStatusFact({
          eventId: e.eventId,
          occurredAt: e.occurredAt,
          version: e.aggregate.version,
          obligationId: e.aggregate.id,
          status: e.data.financialStatus,
          verified: e.data.verified,
          outstanding: e.data.outstanding,
        }),
      };
    }
    case BILLING_REFUND_STATUS_CHANGED_V1.eventType: {
      const e = BILLING_REFUND_STATUS_CHANGED_V1.parse(raw);
      return {
        eventId: e.eventId.toLowerCase(),
        eventType: e.eventType,
        correlationId: e.correlationId,
        fact: refundFact({
          eventId: e.eventId,
          occurredAt: e.occurredAt,
          version: e.aggregate.version,
          refundId: e.aggregate.id,
          obligationId: e.data.obligationId,
          status: e.data.status,
          amount: e.data.amount,
        }),
      };
    }
    default:
      throw new OperationsRuleError('UNSUPPORTED_EVENT');
  }
}

/** Applies one Billing fact inside the caller's (inbox) transaction. */
export class RevenueProjector {
  constructor(
    private readonly hash: Hasher,
    private readonly clock: OperationsClock,
  ) {}

  async apply(writer: RevenueWriter, fact: RevenueFact): Promise<RevenueDecision> {
    const fingerprint = this.hash(revenueFingerprint(fact));
    const outcome =
      fact.kind === 'REVENUE_REFUND'
        ? await writer.applyRefund(fact, fingerprint)
        : await writer.applyObligation(fact, fingerprint);
    // A stale or repeated fact still proves the stream is flowing.
    await writer.touchFreshness(fact.source, fact.occurredAt, this.clock.now());
    return outcome;
  }
}

/* -------------------------------- reports --------------------------------- */

export const REVENUE_AUTHORITY: readonly Authority[] = [
  { owner: 'billing', reads: 'obligations, verification, settlement, custody, refunds and ledger' },
];

export const OPERATIONS_REPORT_AUTHORITY: readonly Authority[] = [
  { owner: 'scheduling', reads: 'authoritative slots, holds and capacity calendars' },
  { owner: 'dispatch', reads: 'assignments and field progress' },
  { owner: 'workforce', reads: 'capacity resources, shifts and eligibility' },
];

const REVENUE_SOURCES: readonly OperationsSource[] = ['billing'];
const OPERATIONS_REPORT_SOURCES: readonly OperationsSource[] = [
  'scheduling',
  'dispatch',
  'workforce',
];

export interface SourceView {
  readonly source: OperationsSource;
  readonly stream: string;
  readonly state: SourceStreamStatus['state'];
  readonly lastEventOccurredAt: string | null;
  readonly lastAppliedAt: string | null;
  readonly appliedCount: string;
}

interface ReportEnvelope {
  readonly derived: true;
  readonly generatedAt: string;
  readonly authority: readonly Authority[];
  readonly period: {
    readonly from: string;
    readonly to: string;
    readonly timezone: string;
    readonly granularity: string;
  };
  readonly sources: readonly SourceView[];
  readonly freshnessPolicy: {
    readonly staleAfterSeconds: number;
    readonly basis: 'LAST_APPLIED_AT';
  };
  /** Sources this report depends on that are not FRESH: the figures may be partial. */
  readonly incompleteSources: readonly OperationsSource[];
}

export interface RevenueReport extends ReportEnvelope {
  readonly report: 'revenue';
  readonly previousPeriod: { readonly from: string; readonly to: string };
  readonly currency: ReportCurrency;
  readonly scale: number;
  readonly market: { readonly filtered: false; readonly reason: 'NO_MARKET_DIMENSION_IN_SOURCE' };
  readonly settled: {
    readonly totalMinor: string;
    readonly verifiedPaymentMinor: string;
    readonly cashCollectedMinor: string;
    readonly obligationCount: number;
    readonly amountUnknownCount: number;
  };
  readonly previousSettled: { readonly totalMinor: string; readonly obligationCount: number };
  readonly growth: Growth & { readonly basis: 'SETTLED_TOTAL' };
  readonly pending: {
    readonly totalMinor: string;
    readonly obligationCount: number;
    readonly byStatus: readonly {
      readonly status: string;
      readonly count: number;
      readonly amountMinor: string;
    }[];
  };
  readonly refunds: {
    readonly succeededMinor: string;
    readonly succeededCount: number;
    readonly openMinor: string;
    readonly openCount: number;
  };
  readonly netSettledMinor: string;
  readonly voidedCount: number;
  readonly series: readonly {
    readonly bucketStart: string;
    readonly settledMinor: string;
    readonly pendingCreatedMinor: string;
    readonly refundedMinor: string;
  }[];
}

export interface OperationsReport extends ReportEnvelope {
  readonly report: 'operations';
  readonly zoneId: string | null;
  readonly executionDuration: {
    readonly available: false;
    readonly averageMs: null;
    readonly reason: 'NO_FIELD_PROGRESS_SOURCE';
  };
  readonly scheduledServiceDuration: {
    readonly basis: 'ASSIGNED_JOB_WINDOW';
    readonly count: number;
    readonly averageMs: string | null;
    readonly averageMinutes: string | null;
    readonly p50Ms: number | null;
    readonly p90Ms: number | null;
    readonly reason: 'NO_DATA' | null;
  };
  readonly capacityUtilization: {
    readonly available: false;
    readonly ratio: null;
    readonly reason: 'NO_CAPACITY_SUPPLY_SOURCE';
    readonly committedHolds: number;
    readonly bookedMinutes: string;
    readonly eligibleResources: number;
  };
  readonly series: readonly {
    readonly bucketStart: string;
    readonly committedHolds: number;
    readonly bookedMinutes: string;
    readonly assignedJobs: number;
  }[];
}

export type ReportInput = {
  readonly from: unknown;
  readonly to: unknown;
  readonly timezone: unknown;
  readonly granularity: unknown;
};

function zoneInput(value: unknown): string | null {
  return value === undefined || value === null ? null : uuidInput(value, 'INVALID_ZONE');
}

const iso = (d: Date): string => d.toISOString();

export class ReportQueries {
  constructor(
    private readonly reader: ReportsReader,
    private readonly clock: OperationsClock,
    private readonly staleAfterMs = REPORT_STALE_AFTER_MS,
  ) {}

  private async envelope(
    sources: readonly OperationsSource[],
    authority: readonly Authority[],
    period: ReportPeriod,
  ): Promise<ReportEnvelope> {
    const checkpoints = await this.reader.checkpoints();
    const now = this.clock.now();
    const statuses = sources.map((s) =>
      streamStatus(s, checkpoints.get(s) ?? null, now, this.staleAfterMs),
    );
    return {
      derived: true,
      generatedAt: iso(now),
      authority,
      period: {
        from: iso(period.from),
        to: iso(period.to),
        timezone: period.timezone,
        granularity: period.granularity,
      },
      sources: statuses.map((s) => ({
        source: s.source,
        stream: s.stream,
        state: s.state,
        lastEventOccurredAt: s.lastEventOccurredAt && iso(s.lastEventOccurredAt),
        lastAppliedAt: s.lastAppliedAt && iso(s.lastAppliedAt),
        appliedCount: s.appliedCount.toString(),
      })),
      freshnessPolicy: { staleAfterSeconds: this.staleAfterMs / 1000, basis: 'LAST_APPLIED_AT' },
      incompleteSources: statuses.filter((s) => s.state !== 'FRESH').map((s) => s.source),
    };
  }

  /**
   * Revenue over a period, exact per currency. Settled is what Billing settled
   * (PAID or CASH_COLLECTED) by the settlement occurrence time; pending is
   * obligations created in the period that Billing still reports open. They
   * are never added together, and pending is never called earned.
   */
  async revenue(input: ReportInput & { readonly currency: unknown }): Promise<RevenueReport> {
    const period = reportPeriod(input);
    const currency = reportCurrency(input.currency);
    const [settled, previous, pending, refunds, voidedCount, series] = await Promise.all([
      this.reader.settled(currency, period.from, period.to),
      this.reader.settled(currency, period.previous.from, period.previous.to),
      this.reader.pending(currency, period.from, period.to),
      this.reader.refunds(currency, period.from, period.to),
      this.reader.voided(currency, period.from, period.to),
      this.reader.revenueSeries(currency, period),
    ]);
    const total = (s: typeof settled): bigint =>
      exactInteger(s.verifiedPaymentMinor) + exactInteger(s.cashCollectedMinor);
    const settledTotal = total(settled);
    const previousTotal = total(previous);
    const byStatus = PENDING_STATUSES.map((status) => {
      const row = pending.find((p) => p.status === status);
      return { status, count: row?.count ?? 0, amountMinor: row?.amountMinor ?? '0' };
    });
    const bucketed = new Map(series.map((r) => [r.bucketStart.getTime(), r]));
    return {
      report: 'revenue',
      ...(await this.envelope(REVENUE_SOURCES, REVENUE_AUTHORITY, period)),
      previousPeriod: { from: iso(period.previous.from), to: iso(period.previous.to) },
      currency,
      scale: REPORT_CURRENCIES[currency],
      market: { filtered: false, reason: 'NO_MARKET_DIMENSION_IN_SOURCE' },
      settled: {
        totalMinor: settledTotal.toString(),
        verifiedPaymentMinor: exactInteger(settled.verifiedPaymentMinor).toString(),
        cashCollectedMinor: exactInteger(settled.cashCollectedMinor).toString(),
        obligationCount: settled.obligationCount,
        amountUnknownCount: settled.amountUnknownCount,
      },
      previousSettled: {
        totalMinor: previousTotal.toString(),
        obligationCount: previous.obligationCount,
      },
      growth: { basis: 'SETTLED_TOTAL', ...growth(settledTotal, previousTotal) },
      pending: {
        totalMinor: byStatus.reduce((n, s) => n + exactInteger(s.amountMinor), 0n).toString(),
        obligationCount: byStatus.reduce((n, s) => n + s.count, 0),
        byStatus,
      },
      refunds: {
        succeededMinor: exactInteger(refunds.succeededMinor).toString(),
        succeededCount: refunds.succeededCount,
        openMinor: exactInteger(refunds.openMinor).toString(),
        openCount: refunds.openCount,
      },
      netSettledMinor: (settledTotal - exactInteger(refunds.succeededMinor)).toString(),
      voidedCount,
      series: period.buckets.map((b) => {
        const row = bucketed.get(b.getTime());
        return {
          bucketStart: iso(b),
          settledMinor: exactInteger(row?.settledMinor ?? null).toString(),
          pendingCreatedMinor: exactInteger(row?.pendingCreatedMinor ?? null).toString(),
          refundedMinor: exactInteger(row?.refundedMinor ?? null).toString(),
        };
      }),
    };
  }

  /**
   * Operational report. Actual execution time and capacity utilisation are
   * reported as unavailable, with the reason, because no owner publishes field
   * progress or capacity supply; the scheduled job window is reported under
   * its own name and is never presented as measured execution time.
   */
  async operations(input: ReportInput & { readonly zoneId: unknown }): Promise<OperationsReport> {
    const period = reportPeriod(input);
    const zoneId = zoneInput(input.zoneId);
    const [duration, capacity, eligibleResources, series] = await Promise.all([
      this.reader.scheduledDuration(period.from, period.to, zoneId),
      this.reader.bookedCapacity(period.from, period.to, zoneId),
      this.reader.eligibleResources(),
      this.reader.operationsSeries(period, zoneId),
    ]);
    const count = BigInt(duration.count);
    const totalMs = exactInteger(duration.totalMs);
    const bucketed = new Map(series.map((r) => [r.bucketStart.getTime(), r]));
    return {
      report: 'operations',
      ...(await this.envelope(OPERATIONS_REPORT_SOURCES, OPERATIONS_REPORT_AUTHORITY, period)),
      zoneId,
      executionDuration: { available: false, averageMs: null, reason: 'NO_FIELD_PROGRESS_SOURCE' },
      scheduledServiceDuration: {
        basis: 'ASSIGNED_JOB_WINDOW',
        count: duration.count,
        averageMs: count === 0n ? null : decimalDivide(totalMs, count, 0),
        averageMinutes: count === 0n ? null : decimalDivide(totalMs, count * 60_000n, 2),
        p50Ms: duration.p50Ms,
        p90Ms: duration.p90Ms,
        reason: count === 0n ? 'NO_DATA' : null,
      },
      capacityUtilization: {
        available: false,
        ratio: null,
        reason: 'NO_CAPACITY_SUPPLY_SOURCE',
        committedHolds: capacity.committedHolds,
        bookedMinutes: decimalDivide(exactInteger(capacity.bookedMs), 60_000n, 2),
        eligibleResources,
      },
      series: period.buckets.map((b) => {
        const row = bucketed.get(b.getTime());
        return {
          bucketStart: iso(b),
          committedHolds: row?.committedHolds ?? 0,
          bookedMinutes: decimalDivide(exactInteger(row?.bookedMs ?? null), 60_000n, 2),
          assignedJobs: row?.assignedJobs ?? 0,
        };
      }),
    };
  }
}

/* -------------------------------- exports --------------------------------- */

type Meta = readonly [string, string];

function envelopeMeta(r: RevenueReport | OperationsReport): Meta[] {
  const meta: Meta[] = [
    ['report', r.report],
    ['generatedAt', r.generatedAt],
    ['derived', 'true'],
    ['periodFrom', r.period.from],
    ['periodTo', r.period.to],
    ['timezone', r.period.timezone],
    ['granularity', r.period.granularity],
    ['freshnessStaleAfterSeconds', String(r.freshnessPolicy.staleAfterSeconds)],
    ['incompleteSources', r.incompleteSources.join(' ')],
  ];
  for (const s of r.sources)
    meta.push(
      [`source.${s.source}.stream`, s.stream],
      [`source.${s.source}.state`, s.state],
      [`source.${s.source}.lastEventOccurredAt`, s.lastEventOccurredAt ?? ''],
      [`source.${s.source}.lastAppliedAt`, s.lastAppliedAt ?? ''],
      [`source.${s.source}.appliedCount`, s.appliedCount],
    );
  return meta;
}

export function revenueCsv(r: RevenueReport): { readonly csv: string; readonly rowCount: number } {
  const rows = r.series.map((s) => [
    s.bucketStart,
    s.settledMinor,
    s.pendingCreatedMinor,
    s.refundedMinor,
  ]);
  return {
    rowCount: rows.length,
    csv: csvDocument({
      meta: [
        ...envelopeMeta(r),
        ['currency', r.currency],
        ['scale', String(r.scale)],
        ['amountUnit', 'integer minor units'],
        ['settledTotalMinor', r.settled.totalMinor],
        ['settledVerifiedPaymentMinor', r.settled.verifiedPaymentMinor],
        ['settledCashCollectedMinor', r.settled.cashCollectedMinor],
        ['previousSettledTotalMinor', r.previousSettled.totalMinor],
        ['growthRatio', r.growth.ratio ?? ''],
        ['growthPercent', r.growth.percent ?? ''],
        ['growthUnavailableReason', r.growth.reason ?? ''],
        ['pendingTotalMinor', r.pending.totalMinor],
        ['refundsSucceededMinor', r.refunds.succeededMinor],
        ['netSettledMinor', r.netSettledMinor],
      ],
      columns: ['bucketStart', 'settledMinor', 'pendingCreatedMinor', 'refundedMinor'],
      rows,
    }),
  };
}

export function operationsCsv(r: OperationsReport): {
  readonly csv: string;
  readonly rowCount: number;
} {
  const rows = r.series.map((s) => [
    s.bucketStart,
    String(s.committedHolds),
    s.bookedMinutes,
    String(s.assignedJobs),
  ]);
  const d = r.scheduledServiceDuration;
  return {
    rowCount: rows.length,
    csv: csvDocument({
      meta: [
        ...envelopeMeta(r),
        ['zoneId', r.zoneId ?? ''],
        ['executionDurationAvailable', 'false'],
        ['executionDurationReason', r.executionDuration.reason],
        ['scheduledServiceDurationCount', String(d.count)],
        ['scheduledServiceDurationAverageMs', d.averageMs ?? ''],
        ['capacityUtilizationAvailable', 'false'],
        ['capacityUtilizationReason', r.capacityUtilization.reason],
        ['bookedMinutes', r.capacityUtilization.bookedMinutes],
      ],
      columns: ['bucketStart', 'committedHolds', 'bookedMinutes', 'assignedJobs'],
      rows,
    }),
  };
}

export interface ExportResult {
  readonly created: boolean;
  readonly audit: ExportAuditRecord;
  readonly csv: string;
}

/** Canonical, validated parameters of one export request. */
export type ExportParameters =
  | {
      readonly report: 'revenue';
      readonly from: string;
      readonly to: string;
      readonly timezone: string;
      readonly granularity: string;
      readonly currency: ReportCurrency;
    }
  | {
      readonly report: 'operations';
      readonly from: string;
      readonly to: string;
      readonly timezone: string;
      readonly granularity: string;
      readonly zoneId: string | null;
    };

const EXPORT_KEYS: Readonly<Record<ReportKind, readonly string[]>> = {
  revenue: ['report', 'from', 'to', 'timezone', 'granularity', 'currency'],
  operations: ['report', 'from', 'to', 'timezone', 'granularity', 'zoneId'],
};

/** Validates an export body for a report kind already authorised by the caller. */
export function exportParameters(kind: ReportKind, body: unknown): ExportParameters {
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    throw new OperationsRuleError('INVALID_EXPORT_REQUEST');
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !EXPORT_KEYS[kind].includes(k)))
    throw new OperationsRuleError('INVALID_EXPORT_REQUEST');
  const period = reportPeriod({
    from: b.from,
    to: b.to,
    timezone: b.timezone,
    granularity: b.granularity,
  });
  const common = {
    from: iso(period.from),
    to: iso(period.to),
    timezone: period.timezone,
    granularity: period.granularity,
  };
  return kind === 'revenue'
    ? { report: kind, ...common, currency: reportCurrency(b.currency) }
    : { report: kind, ...common, zoneId: zoneInput(b.zoneId) };
}

export class ExportIdempotencyConflict extends Error {
  constructor() {
    super('IDEMPOTENCY_CONFLICT');
    this.name = 'ExportIdempotencyConflict';
  }
}

export class ExportExpired extends Error {
  constructor() {
    super('EXPORT_EXPIRED');
    this.name = 'ExportExpired';
  }
}

/**
 * Bounded synchronous CSV export. Same subject + same Idempotency-Key + same
 * parameters returns the original bytes; a different parameter set under the
 * same key is a conflict. Exactly one audit row exists per (subject, key),
 * enforced by a database unique constraint, never by a check-then-insert.
 */
export class ReportExports {
  constructor(
    private readonly queries: ReportQueries,
    private readonly store: ExportStore,
    private readonly hash: Hasher,
    private readonly clock: OperationsClock,
    private readonly newId: () => string,
  ) {}

  async create(input: {
    readonly subject: string;
    readonly idempotencyKey: unknown;
    readonly parameters: ExportParameters;
  }): Promise<ExportResult> {
    const key = idempotencyKey(input.idempotencyKey);
    const parametersHash = this.hash(JSON.stringify(input.parameters));
    const existing = await this.store.find(input.subject, key, this.clock.now());
    if (existing) return this.replay(existing, input.parameters.report, parametersHash);

    const { csv, rowCount } = await this.render(input.parameters);
    const generatedAt = this.clock.now();
    const audit: ExportAuditRecord = {
      exportId: this.newId(),
      subject: input.subject,
      idempotencyKey: key,
      report: input.parameters.report,
      parametersHash,
      rowCount,
      generatedAt,
      contentSha256: this.hash(csv),
    };
    const outcome = await this.store.createOnce(
      audit,
      csv,
      new Date(generatedAt.getTime() + EXPORT_REPLAY_TTL_MS),
      generatedAt,
    );
    if (outcome.created) return { created: true, audit, csv };
    // A concurrent request with the same key committed first: answer with its result.
    return this.replay(outcome.stored, input.parameters.report, parametersHash);
  }

  private replay(
    stored: { readonly audit: ExportAuditRecord; readonly content: string | null },
    report: ReportKind,
    parametersHash: string,
  ): ExportResult {
    if (stored.audit.report !== report || stored.audit.parametersHash !== parametersHash)
      throw new ExportIdempotencyConflict();
    if (stored.content === null) throw new ExportExpired();
    return { created: false, audit: stored.audit, csv: stored.content };
  }

  private async render(
    p: ExportParameters,
  ): Promise<{ readonly csv: string; readonly rowCount: number }> {
    return p.report === 'revenue'
      ? revenueCsv(await this.queries.revenue(p))
      : operationsCsv(await this.queries.operations(p));
  }
}
