import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import type { FreshnessCheckpoint, OperationsSource } from '../../domain/operations';
import { REPORT_KINDS, type ReportKind } from '../../domain/reports';
import {
  FINANCIAL_STATUSES,
  PENDING_STATUSES,
  REFUND_STATUSES,
  foldObligation,
  foldRefund,
  type FinancialStatus,
  type ObligationCreatedFact,
  type ObligationRevenueState,
  type ObligationStatusChangedFact,
  type RefundState,
  type RefundStatus,
  type RefundStatusFact,
  type RevenueDecision,
} from '../../domain/revenue';
import type {
  ExportAuditRecord,
  ExportStore,
  OperationsBucketRow,
  PendingStatusTotal,
  PeriodQuery,
  RefundTotals,
  ReportsReader,
  RevenueBucketRow,
  RevenueWriter,
  ScheduledDurationRow,
  SettledTotals,
  StoredExport,
} from '../../ports/reports.ports';
import { PrismaOperationsReader, PrismaOperationsWriter } from './prisma-operations.store';

function financialStatusOf(value: string): FinancialStatus {
  const status = FINANCIAL_STATUSES.find((s) => s === value);
  if (!status) throw new Error('CORRUPT_PERSISTED_FINANCIAL_STATUS');
  return status;
}

function refundStatusOf(value: string): RefundStatus {
  const status = REFUND_STATUSES.find((s) => s === value);
  if (!status) throw new Error('CORRUPT_PERSISTED_REFUND_STATUS');
  return status;
}

function reportKindOf(value: string): ReportKind {
  const kind = REPORT_KINDS.find((k) => k === value);
  if (!kind) throw new Error('CORRUPT_PERSISTED_REPORT_KIND');
  return kind;
}

async function lock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/**
 * Transaction-bound writer for the revenue read model. One advisory lock per
 * aggregate (`rpt-obligation:*` or `rpt-refund:*`); it never nests with any
 * other projection lock, so no lock-order cycle can form.
 */
export class PrismaRevenueWriter implements RevenueWriter {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async applyObligation(
    fact: ObligationCreatedFact | ObligationStatusChangedFact,
    hash: string,
  ): Promise<RevenueDecision> {
    await lock(this.tx, `rpt-obligation:${fact.obligationId}`);
    const row = await this.tx.rptObligation.findUnique({
      where: { obligationId: fact.obligationId },
    });
    const current: ObligationRevenueState | null = row && {
      version: row.version,
      fingerprint: row.fingerprint,
      status: financialStatusOf(row.financialStatus),
      currency: row.currency,
      scale: row.scale,
      amountMinor: row.amountMinor,
      verifiedMinor: row.verifiedMinor,
      outstandingMinor: row.outstandingMinor,
      createdAt: row.createdAt,
      settledAt: row.settledAt,
      sourceEventId: row.sourceEventId,
      occurredAt: row.occurredAt,
    };
    const { decision, next } = foldObligation(current, fact, hash);
    if (next) {
      const data = {
        version: next.version,
        financialStatus: next.status,
        currency: next.currency,
        scale: next.scale,
        amountMinor: next.amountMinor,
        verifiedMinor: next.verifiedMinor,
        outstandingMinor: next.outstandingMinor,
        createdAt: next.createdAt,
        settledAt: next.settledAt,
        fingerprint: next.fingerprint,
        sourceEventId: next.sourceEventId,
        occurredAt: next.occurredAt,
      };
      await this.tx.rptObligation.upsert({
        where: { obligationId: fact.obligationId },
        create: { obligationId: fact.obligationId, ...data },
        update: data,
      });
    }
    return decision;
  }

  async applyRefund(fact: RefundStatusFact, hash: string): Promise<RevenueDecision> {
    await lock(this.tx, `rpt-refund:${fact.refundId}`);
    const row = await this.tx.rptRefund.findUnique({ where: { refundId: fact.refundId } });
    const current: RefundState | null = row && {
      version: row.version,
      fingerprint: row.fingerprint,
      obligationId: row.obligationId,
      status: refundStatusOf(row.status),
      currency: row.currency,
      scale: row.scale,
      amountMinor: row.amountMinor,
      firstObservedAt: row.firstObservedAt,
      succeededAt: row.succeededAt,
      sourceEventId: row.sourceEventId,
      occurredAt: row.occurredAt,
    };
    const { decision, next } = foldRefund(current, fact, hash);
    if (next) {
      const data = {
        obligationId: next.obligationId,
        version: next.version,
        status: next.status,
        currency: next.currency,
        scale: next.scale,
        amountMinor: next.amountMinor,
        firstObservedAt: next.firstObservedAt,
        succeededAt: next.succeededAt,
        fingerprint: next.fingerprint,
        sourceEventId: next.sourceEventId,
        occurredAt: next.occurredAt,
      };
      await this.tx.rptRefund.upsert({
        where: { refundId: fact.refundId },
        create: { refundId: fact.refundId, ...data },
        update: data,
      });
    }
    return decision;
  }

  touchFreshness(source: OperationsSource, occurredAt: Date, appliedAt: Date): Promise<void> {
    return new PrismaOperationsWriter(this.tx).touchFreshness(source, occurredAt, appliedAt);
  }
}

/**
 * Bucket start of a timestamp column. Day buckets are civil days of the
 * report zone; hour buckets are UTC hours, which equal local hours in every
 * allowed zone (whole-hour offsets) and stay unambiguous across a DST change.
 */
function bucket(period: PeriodQuery, column: string): Prisma.Sql {
  const zone = period.granularity === 'hour' ? 'UTC' : period.timezone;
  return Prisma.sql`(date_trunc(${period.granularity}::text, ${Prisma.raw(column)} AT TIME ZONE ${zone}::text) AT TIME ZONE ${zone}::text)`;
}

const PENDING = Prisma.join(PENDING_STATUSES);

interface SettledSql {
  n: number;
  paid: string;
  cash: string;
  unknown: number;
}

/** Report aggregates over Reporting's own projections only; summed as NUMERIC. */
export class PrismaReportsReader implements ReportsReader {
  constructor(private readonly client: PrismaClient) {}

  async settled(currency: string, from: Date, to: Date): Promise<SettledTotals> {
    const [row] = await this.client.$queryRaw<SettledSql[]>`
      SELECT count(*)::int AS n,
             COALESCE(sum(verified_minor) FILTER (WHERE financial_status = 'PAID'), 0)::text AS paid,
             COALESCE(sum(verified_minor) FILTER (WHERE financial_status = 'CASH_COLLECTED'), 0)::text AS cash,
             count(*) FILTER (WHERE verified_minor IS NULL)::int AS unknown
        FROM app.rpt_obligation
       WHERE currency = ${currency} AND settled_at >= ${from} AND settled_at < ${to}`;
    if (!row) throw new Error('REPORT_AGGREGATE_MISSING');
    return {
      obligationCount: row.n,
      verifiedPaymentMinor: row.paid,
      cashCollectedMinor: row.cash,
      amountUnknownCount: row.unknown,
    };
  }

  async pending(currency: string, from: Date, to: Date): Promise<readonly PendingStatusTotal[]> {
    const rows = await this.client.$queryRaw<{ status: string; n: number; total: string }[]>`
      SELECT financial_status AS status, count(*)::int AS n,
             COALESCE(sum(COALESCE(outstanding_minor, amount_minor)), 0)::text AS total
        FROM app.rpt_obligation
       WHERE currency = ${currency} AND created_at >= ${from} AND created_at < ${to}
         AND financial_status IN (${PENDING})
       GROUP BY financial_status`;
    return rows.map((r) => ({
      status: financialStatusOf(r.status),
      count: r.n,
      amountMinor: r.total,
    }));
  }

  async voided(currency: string, from: Date, to: Date): Promise<number> {
    return this.client.rptObligation.count({
      where: { currency, financialStatus: 'VOIDED', createdAt: { gte: from, lt: to } },
    });
  }

  async refunds(currency: string, from: Date, to: Date): Promise<RefundTotals> {
    const [row] = await this.client.$queryRaw<
      { s_n: number; s_total: string; o_n: number; o_total: string }[]
    >`
      SELECT count(*) FILTER (WHERE succeeded_at >= ${from} AND succeeded_at < ${to})::int AS s_n,
             COALESCE(sum(amount_minor) FILTER (WHERE succeeded_at >= ${from} AND succeeded_at < ${to}), 0)::text AS s_total,
             count(*) FILTER (WHERE status IN ('REQUESTED', 'OUTCOME_UNKNOWN')
                                AND first_observed_at >= ${from} AND first_observed_at < ${to})::int AS o_n,
             COALESCE(sum(amount_minor) FILTER (WHERE status IN ('REQUESTED', 'OUTCOME_UNKNOWN')
                                AND first_observed_at >= ${from} AND first_observed_at < ${to}), 0)::text AS o_total
        FROM app.rpt_refund
       WHERE currency = ${currency}
         AND ((succeeded_at >= ${from} AND succeeded_at < ${to})
              OR (first_observed_at >= ${from} AND first_observed_at < ${to}))`;
    if (!row) throw new Error('REPORT_AGGREGATE_MISSING');
    return {
      succeededCount: row.s_n,
      succeededMinor: row.s_total,
      openCount: row.o_n,
      openMinor: row.o_total,
    };
  }

  async revenueSeries(currency: string, period: PeriodQuery): Promise<readonly RevenueBucketRow[]> {
    const rows = await this.client.$queryRaw<
      { b: Date; settled: string | null; pending: string | null; refunded: string | null }[]
    >`
      WITH s AS (
        SELECT ${bucket(period, 'settled_at')} AS b, sum(verified_minor) AS v
          FROM app.rpt_obligation
         WHERE currency = ${currency} AND settled_at >= ${period.from} AND settled_at < ${period.to}
         GROUP BY 1
      ), p AS (
        SELECT ${bucket(period, 'created_at')} AS b,
               sum(COALESCE(outstanding_minor, amount_minor)) AS v
          FROM app.rpt_obligation
         WHERE currency = ${currency} AND created_at >= ${period.from} AND created_at < ${period.to}
           AND financial_status IN (${PENDING})
         GROUP BY 1
      ), r AS (
        SELECT ${bucket(period, 'succeeded_at')} AS b, sum(amount_minor) AS v
          FROM app.rpt_refund
         WHERE currency = ${currency} AND succeeded_at >= ${period.from} AND succeeded_at < ${period.to}
         GROUP BY 1
      )
      SELECT k.b, s.v::text AS settled, p.v::text AS pending, r.v::text AS refunded
        FROM (SELECT b FROM s UNION SELECT b FROM p UNION SELECT b FROM r) k
        LEFT JOIN s ON s.b = k.b LEFT JOIN p ON p.b = k.b LEFT JOIN r ON r.b = k.b
       ORDER BY k.b`;
    return rows.map((r) => ({
      bucketStart: r.b,
      settledMinor: r.settled ?? '0',
      pendingCreatedMinor: r.pending ?? '0',
      refundedMinor: r.refunded ?? '0',
    }));
  }

  async scheduledDuration(
    from: Date,
    to: Date,
    zoneId: string | null,
  ): Promise<ScheduledDurationRow> {
    const [row] = await this.client.$queryRaw<
      { n: number; total: string; p50: bigint | null; p90: bigint | null }[]
    >`
      WITH d AS (
        SELECT (EXTRACT(EPOCH FROM (ends_at - starts_at)) * 1000)::bigint AS ms
          FROM app.ops_assignment
         WHERE status = 'ASSIGNED' AND starts_at >= ${from} AND starts_at < ${to}
           AND (${zoneId}::uuid IS NULL OR zone_id = ${zoneId}::uuid)
      )
      SELECT count(*)::int AS n, COALESCE(sum(ms), 0)::text AS total,
             percentile_disc(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
             percentile_disc(0.9) WITHIN GROUP (ORDER BY ms) AS p90
        FROM d`;
    if (!row) throw new Error('REPORT_AGGREGATE_MISSING');
    return {
      count: row.n,
      totalMs: row.total,
      p50Ms: row.p50 === null ? null : Number(row.p50),
      p90Ms: row.p90 === null ? null : Number(row.p90),
    };
  }

  async bookedCapacity(
    from: Date,
    to: Date,
    zoneId: string | null,
  ): Promise<{ readonly committedHolds: number; readonly bookedMs: string }> {
    const [row] = await this.client.$queryRaw<{ n: number; total: string }[]>`
      SELECT count(*)::int AS n,
             COALESCE(sum((EXTRACT(EPOCH FROM (ends_at - starts_at)) * 1000)::bigint), 0)::text AS total
        FROM app.ops_slot_hold
       WHERE state = 'COMMITTED' AND starts_at >= ${from} AND starts_at < ${to}
         AND (${zoneId}::uuid IS NULL OR zone_id = ${zoneId}::uuid)`;
    if (!row) throw new Error('REPORT_AGGREGATE_MISSING');
    return { committedHolds: row.n, bookedMs: row.total };
  }

  eligibleResources(): Promise<number> {
    return this.client.opsResourceEligibility.count({ where: { eligibility: 'ELIGIBLE' } });
  }

  async operationsSeries(
    period: PeriodQuery,
    zoneId: string | null,
  ): Promise<readonly OperationsBucketRow[]> {
    const rows = await this.client.$queryRaw<
      { b: Date; holds: number | null; booked: string | null; assigned: number | null }[]
    >`
      WITH h AS (
        SELECT ${bucket(period, 'starts_at')} AS b, count(*)::int AS n,
               sum((EXTRACT(EPOCH FROM (ends_at - starts_at)) * 1000)::bigint) AS ms
          FROM app.ops_slot_hold
         WHERE state = 'COMMITTED' AND starts_at >= ${period.from} AND starts_at < ${period.to}
           AND (${zoneId}::uuid IS NULL OR zone_id = ${zoneId}::uuid)
         GROUP BY 1
      ), a AS (
        SELECT ${bucket(period, 'starts_at')} AS b, count(*)::int AS n
          FROM app.ops_assignment
         WHERE status = 'ASSIGNED' AND starts_at >= ${period.from} AND starts_at < ${period.to}
           AND (${zoneId}::uuid IS NULL OR zone_id = ${zoneId}::uuid)
         GROUP BY 1
      )
      SELECT k.b, h.n AS holds, h.ms::text AS booked, a.n AS assigned
        FROM (SELECT b FROM h UNION SELECT b FROM a) k
        LEFT JOIN h ON h.b = k.b LEFT JOIN a ON a.b = k.b
       ORDER BY k.b`;
    return rows.map((r) => ({
      bucketStart: r.b,
      committedHolds: r.holds ?? 0,
      bookedMs: r.booked ?? '0',
      assignedJobs: r.assigned ?? 0,
    }));
  }

  checkpoints(): Promise<ReadonlyMap<OperationsSource, FreshnessCheckpoint>> {
    return new PrismaOperationsReader(this.client).checkpoints();
  }
}

/** Bounded purge of expired replay content, run inside each new export. */
const PURGE_BATCH = 100;

export class PrismaExportStore implements ExportStore {
  constructor(private readonly client: PrismaClient) {}

  async find(subject: string, idempotencyKey: string, now: Date): Promise<StoredExport | null> {
    const row = await this.client.reportExportAudit.findUnique({
      where: { subject_idempotencyKey: { subject, idempotencyKey } },
      include: { content: true },
    });
    if (!row) return null;
    const { content, ...audit } = row;
    return {
      audit: { ...audit, report: reportKindOf(audit.report) },
      content: content && content.expiresAt.getTime() > now.getTime() ? content.content : null,
    };
  }

  async createOnce(
    audit: ExportAuditRecord,
    content: string,
    expiresAt: Date,
    now: Date,
  ): Promise<{ readonly created: boolean; readonly stored: StoredExport }> {
    const created = await this.client.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM app.report_export_content
         WHERE export_id IN (SELECT export_id FROM app.report_export_content
                              WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${PURGE_BATCH})`;
      // ON CONFLICT DO NOTHING: a concurrent request with the same key waits on
      // the unique index for the first transaction and then inserts nothing.
      const inserted = await tx.reportExportAudit.createMany({
        data: [audit],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return false;
      await tx.reportExportContent.create({
        data: { exportId: audit.exportId, content, expiresAt },
      });
      return true;
    });
    if (created) return { created, stored: { audit, content } };
    const stored = await this.find(audit.subject, audit.idempotencyKey, now);
    if (!stored) throw new Error('EXPORT_KEY_WINNER_MISSING');
    return { created, stored };
  }
}
