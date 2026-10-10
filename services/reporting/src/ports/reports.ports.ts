import type { FreshnessCheckpoint, OperationsSource } from '../domain/operations';
import type { ReportGranularity, ReportKind, ReportTimeZone } from '../domain/reports';
import type {
  FinancialStatus,
  ObligationCreatedFact,
  ObligationStatusChangedFact,
  RefundStatusFact,
  RevenueDecision,
} from '../domain/revenue';

/**
 * Transaction-bound writer for the revenue read model. It is created with the
 * inbox transaction, so the derived rows, the freshness checkpoint and the
 * inbox record commit together. Integrity conflicts are thrown.
 */
export interface RevenueWriter {
  applyObligation(
    fact: ObligationCreatedFact | ObligationStatusChangedFact,
    fingerprintHash: string,
  ): Promise<RevenueDecision>;
  applyRefund(fact: RefundStatusFact, fingerprintHash: string): Promise<RevenueDecision>;
  touchFreshness(source: OperationsSource, occurredAt: Date, appliedAt: Date): Promise<void>;
}

/** A period query: half-open [from, to), buckets in the given zone. */
export interface PeriodQuery {
  readonly from: Date;
  readonly to: Date;
  readonly timezone: ReportTimeZone;
  readonly granularity: ReportGranularity;
}

/** Exact totals as decimal strings of integer minor units (database NUMERIC sums). */
export interface SettledTotals {
  readonly obligationCount: number;
  readonly verifiedPaymentMinor: string;
  readonly cashCollectedMinor: string;
  /** Settled obligations for which no verified amount was published. */
  readonly amountUnknownCount: number;
}

export interface PendingStatusTotal {
  readonly status: FinancialStatus;
  readonly count: number;
  readonly amountMinor: string;
}

export interface RefundTotals {
  readonly succeededCount: number;
  readonly succeededMinor: string;
  readonly openCount: number;
  readonly openMinor: string;
}

export interface RevenueBucketRow {
  readonly bucketStart: Date;
  readonly settledMinor: string;
  readonly pendingCreatedMinor: string;
  readonly refundedMinor: string;
}

export interface OperationsBucketRow {
  readonly bucketStart: Date;
  readonly committedHolds: number;
  readonly bookedMs: string;
  readonly assignedJobs: number;
}

export interface ScheduledDurationRow {
  readonly count: number;
  readonly totalMs: string;
  readonly p50Ms: number | null;
  readonly p90Ms: number | null;
}

export interface ReportsReader {
  settled(currency: string, from: Date, to: Date): Promise<SettledTotals>;
  pending(currency: string, from: Date, to: Date): Promise<readonly PendingStatusTotal[]>;
  voided(currency: string, from: Date, to: Date): Promise<number>;
  refunds(currency: string, from: Date, to: Date): Promise<RefundTotals>;
  revenueSeries(currency: string, period: PeriodQuery): Promise<readonly RevenueBucketRow[]>;
  scheduledDuration(from: Date, to: Date, zoneId: string | null): Promise<ScheduledDurationRow>;
  bookedCapacity(
    from: Date,
    to: Date,
    zoneId: string | null,
  ): Promise<{ readonly committedHolds: number; readonly bookedMs: string }>;
  eligibleResources(): Promise<number>;
  operationsSeries(
    period: PeriodQuery,
    zoneId: string | null,
  ): Promise<readonly OperationsBucketRow[]>;
  checkpoints(): Promise<ReadonlyMap<OperationsSource, FreshnessCheckpoint>>;
}

/** The audit record of one export. It never contains report data. */
export interface ExportAuditRecord {
  readonly exportId: string;
  readonly subject: string;
  readonly idempotencyKey: string;
  readonly report: ReportKind;
  readonly parametersHash: string;
  readonly rowCount: number;
  readonly generatedAt: Date;
  readonly contentSha256: string;
}

export interface StoredExport {
  readonly audit: ExportAuditRecord;
  /** The CSV bytes kept for idempotent replay; null once the replay window expired. */
  readonly content: string | null;
}

export interface ExportStore {
  /** The export holding (subject, key); its content is null once expired at `now`. */
  find(subject: string, idempotencyKey: string, now: Date): Promise<StoredExport | null>;
  /**
   * Inserts the audit row and the replay content in one transaction, unless a
   * row for (subject, idempotencyKey) already exists. Returns whichever
   * export holds the key afterwards and whether this call created it.
   */
  createOnce(
    audit: ExportAuditRecord,
    content: string,
    expiresAt: Date,
    now: Date,
  ): Promise<{ readonly created: boolean; readonly stored: StoredExport }>;
}
