import { Injectable } from '@nestjs/common';
import {
  ATTEMPT_STATUSES,
  CREDIT_STATUSES,
  CUSTODY_STATUSES,
  HANDOVER_STATUSES,
  INTENT_STATUSES,
  Money,
  OBLIGATION_STATUSES,
  PAYMENT_METHODS,
  REFUND_EXTENTS,
  REFUND_STATUSES,
  type FinanceFacts,
  type LedgerFacts,
  type ObligationFactGroup,
  type StatusTally,
} from '../../domain';
import type { AttemptQueueQuery, AttemptQueueRow, FinanceReadModel } from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;

/** Rows are written only through the Billing adapters; an unknown value means corruption. */
function member<T extends string>(allowed: readonly T[], value: string, what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (!found) throw new Error(`STORED_${what}_INVALID`);
  return found;
}

/** SUM/COUNT text from PostgreSQL to an exact bigint (never a JS number). */
function minor(value: string | null): bigint {
  if (value === null) return 0n;
  if (!/^-?(0|[1-9][0-9]*)$/.test(value)) throw new Error('STORED_AMOUNT_INVALID');
  return BigInt(value);
}

interface ObligationGroupRow {
  currency: string;
  status: string;
  intent_status: string | null;
  intent_method: string | null;
  has_unknown: boolean;
  by_cash: boolean;
  refund: string;
  count: number;
  amount: string;
  verified: string;
}

interface TallyRow {
  source: 'attempt' | 'receipt' | 'handover' | 'credit' | 'refund';
  currency: string;
  status: string;
  count: number;
  amount: string;
}

interface LedgerRow {
  currency: string;
  receivable: string;
  cleared: string;
  custody: string;
  refunds_paid: string;
}

interface QueueRow {
  attempt_id: string;
  obligation_id: string;
  obligation_revision: number;
  intent_id: string;
  method: string;
  status: string;
  provider_reference: string;
  currency: string;
  claimed: string;
  submitted_at: Date;
  reconciled_at: Date | null;
}

function tallies<S extends string>(
  rows: readonly TallyRow[],
  source: TallyRow['source'],
  statuses: readonly S[],
): StatusTally<S>[] {
  return rows
    .filter((row) => row.source === source)
    .map((row) => ({
      currency: row.currency,
      status: member(statuses, row.status, `${source.toUpperCase()}_STATUS`),
      count: row.count,
      amountMinor: minor(row.amount),
    }));
}

function group(row: ObligationGroupRow): ObligationFactGroup {
  if ((row.intent_status === null) !== (row.intent_method === null))
    throw new Error('STORED_INTENT_INVALID');
  return {
    currency: row.currency,
    status: member(OBLIGATION_STATUSES, row.status, 'OBLIGATION_STATUS'),
    activeIntent:
      row.intent_status === null || row.intent_method === null
        ? null
        : {
            method: member(PAYMENT_METHODS, row.intent_method, 'METHOD'),
            status: member(INTENT_STATUSES, row.intent_status, 'INTENT_STATUS'),
          },
    hasUnknownAttempt: row.has_unknown,
    settledByCash: row.by_cash,
    refund: member(REFUND_EXTENTS, row.refund, 'REFUND_EXTENT'),
    count: row.count,
    amountMinor: minor(row.amount),
    verifiedMinor: minor(row.verified),
  };
}

/**
 * Admin finance read model over Billing's own tables (P06-B6). The summary is
 * read in ONE read-only REPEATABLE READ transaction, so obligations, receipts,
 * credits, refunds and the ledger describe the same instant even while
 * commands commit concurrently. The ledger sums mirror the COMMIT-time trigger
 * `billing_assert_obligation_ledger`, aggregated over all obligations.
 *
 * Scale note: the summary scans these tables. That is acceptable for the
 * current volume; incremental balances are a later optimisation that must not
 * change this contract.
 */
@Injectable()
export class PrismaFinanceReadModel implements FinanceReadModel {
  private readonly client: PrismaClient;

  constructor(prisma: PrismaService) {
    this.client = prisma.client;
  }

  financeFacts(): Promise<FinanceFacts> {
    return this.client.$transaction((tx) => this.facts(tx), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  private async facts(tx: Tx): Promise<FinanceFacts> {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const obligations = await tx.$queryRaw<ObligationGroupRow[]>`
      WITH refunded AS (
        SELECT c.obligation_id, SUM(r.amount_minor) AS amount
          FROM app.provider_credit c JOIN app.payment_refund r ON r.credit_id = c.id
         WHERE c.status = 'ALLOCATED' AND r.status = 'SUCCEEDED'
         GROUP BY c.obligation_id
      ), facts AS (
        SELECT o.currency, o.status, i.status AS intent_status, i.method AS intent_method,
               EXISTS (SELECT 1 FROM app.payment_attempt a
                        WHERE a.obligation_id = o.id AND a.status = 'UNKNOWN') AS has_unknown,
               EXISTS (SELECT 1 FROM app.cash_receipt r
                        WHERE r.obligation_id = o.id AND r.active_slot = 1) AS by_cash,
               CASE WHEN COALESCE(f.amount, 0) = 0 THEN 'NONE'
                    WHEN f.amount = o.amount_minor THEN 'FULL'
                    ELSE 'PARTIAL' END AS refund,
               o.amount_minor, o.verified_minor
          FROM app.billing_obligation o
          LEFT JOIN app.payment_intent i ON i.obligation_id = o.id AND i.active_slot = 1
          LEFT JOIN refunded f ON f.obligation_id = o.id
      )
      SELECT currency::text AS currency, status::text AS status,
             intent_status::text AS intent_status, intent_method::text AS intent_method,
             has_unknown, by_cash, refund,
             COUNT(*)::int AS count,
             SUM(amount_minor)::text AS amount, SUM(verified_minor)::text AS verified
        FROM facts
       GROUP BY 1, 2, 3, 4, 5, 6, 7
       ORDER BY 1, 2, 3, 4, 5, 6, 7`;
    const rows = await tx.$queryRaw<TallyRow[]>`
      SELECT 'attempt' AS source, currency::text AS currency, status::text AS status,
             COUNT(*)::int AS count, SUM(claimed_minor)::text AS amount
        FROM app.payment_attempt GROUP BY 2, 3
      UNION ALL
      SELECT 'receipt', currency::text, custody_status::text, COUNT(*)::int, SUM(amount_minor)::text
        FROM app.cash_receipt GROUP BY 2, 3
      UNION ALL
      SELECT 'handover', currency::text, status::text, COUNT(*)::int, SUM(declared_minor)::text
        FROM app.custody_handover GROUP BY 2, 3
      UNION ALL
      SELECT 'credit', currency::text, status::text, COUNT(*)::int, SUM(amount_minor)::text
        FROM app.provider_credit GROUP BY 2, 3
      UNION ALL
      SELECT 'refund', currency::text, status::text, COUNT(*)::int, SUM(amount_minor)::text
        FROM app.payment_refund GROUP BY 2, 3`;
    const ledger = await tx.$queryRaw<LedgerRow[]>`
      SELECT l.currency::text AS currency,
        COALESCE(SUM(CASE WHEN j.obligation_id IS NOT NULL AND l.account = 'CUSTOMER_RECEIVABLE'
          THEN CASE WHEN l.side = 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END END), 0)::text
          AS receivable,
        COALESCE(SUM(CASE WHEN j.obligation_id IS NOT NULL
                           AND l.account IN ('CLEARING_SHAM_CASH', 'CLEARING_SYRIATEL_CASH',
                                             'CASH_IN_CUSTODY', 'PROVIDER_CREDITS_UNALLOCATED')
          THEN CASE WHEN l.side = 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END END), 0)::text
          AS cleared,
        COALESCE(SUM(CASE WHEN l.account = 'CASH_IN_CUSTODY'
          THEN CASE WHEN l.side = 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END END), 0)::text
          AS custody,
        COALESCE(SUM(CASE WHEN j.kind = 'REFUND_PAID' AND l.side = 'CREDIT'
          THEN l.amount_minor END), 0)::text AS refunds_paid
        FROM app.ledger_line l JOIN app.ledger_journal j ON j.id = l.journal_id
       GROUP BY l.currency
       ORDER BY l.currency`;
    return {
      obligations: obligations.map(group),
      attempts: tallies(rows, 'attempt', ATTEMPT_STATUSES),
      receipts: tallies(rows, 'receipt', CUSTODY_STATUSES),
      handovers: tallies(rows, 'handover', HANDOVER_STATUSES),
      credits: tallies(rows, 'credit', CREDIT_STATUSES),
      refunds: tallies(rows, 'refund', REFUND_STATUSES),
      ledger: ledger.map((row): LedgerFacts => ({
        currency: row.currency,
        receivableMinor: minor(row.receivable),
        clearedMinor: minor(row.cleared),
        custodyMinor: minor(row.custody),
        refundsPaidMinor: minor(row.refunds_paid),
      })),
    };
  }

  async attemptQueue(query: AttemptQueueQuery): Promise<readonly AttemptQueueRow[]> {
    const after = query.after;
    // Keyset on (submitted_at, id) ascending: oldest claim first, stable under inserts.
    const keyset = after
      ? Prisma.sql`AND (a.submitted_at, a.id) > (${after.submittedAt}::timestamptz, ${after.attemptId}::uuid)`
      : Prisma.empty;
    const rows = await this.client.$queryRaw<QueueRow[]>`
      SELECT a.id::text AS attempt_id, a.obligation_id::text AS obligation_id,
             o.revision AS obligation_revision, a.intent_id::text AS intent_id,
             a.method::text AS method, a.status::text AS status,
             a.provider_reference::text AS provider_reference, a.currency::text AS currency,
             a.claimed_minor::text AS claimed, a.submitted_at, a.reconciled_at
        FROM app.payment_attempt a
        JOIN app.billing_obligation o ON o.id = a.obligation_id
       WHERE a.status = ${query.status} ${keyset}
       ORDER BY a.submitted_at, a.id
       LIMIT ${query.limit}`;
    return rows.map((row) => ({
      attemptId: row.attempt_id,
      obligationId: row.obligation_id,
      obligationRevision: row.obligation_revision,
      intentId: row.intent_id,
      method: member(PAYMENT_METHODS, row.method, 'METHOD'),
      status: member(ATTEMPT_STATUSES, row.status, 'ATTEMPT_STATUS'),
      providerReference: row.provider_reference,
      claimed: Money.of(row.currency, minor(row.claimed)),
      submittedAt: row.submitted_at,
      reconciledAt: row.reconciled_at,
    }));
  }
}
