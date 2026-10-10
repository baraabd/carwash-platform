import {
  CUSTODY_STATUSES,
  HANDOVER_STATUSES,
  Money,
  REVERSAL_REASONS,
  SUPPORTED_SCALES,
  type CustodyStatus,
} from '../../domain';
import {
  CollectionAlreadyRecorded,
  ConcurrentModification,
  TreasuryReferenceTaken,
  type CashReceiptRecord,
  type CustodyBalance,
  type CustodyReader,
  type CustodyReconciliationReport,
  type CustodyStore,
  type HandoverItem,
  type HandoverRecord,
  type HandoverView,
  type HolderInvariant,
  type HolderPosition,
  type ReversalRecord,
  type TreasuryPosition,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;
type ReceiptRow = Prisma.CashReceiptGetPayload<object>;
type HandoverRow = Prisma.CustodyHandoverGetPayload<object>;
type ReversalRow = Prisma.CashReceiptReversalGetPayload<object>;

/** Rows are written only through these adapters; an unknown value means corruption. */
function member<T extends string>(allowed: readonly T[], value: string, what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (!found) throw new Error(`STORED_${what}_INVALID`);
  return found;
}

function optionalMoney(currency: string, value: bigint | null): Money | null {
  return value === null ? null : Money.of(currency, value);
}

export function toReceipt(row: ReceiptRow): CashReceiptRecord {
  return {
    id: row.id,
    obligationId: row.obligationId,
    intentId: row.intentId,
    bookingId: row.bookingId,
    assignmentId: row.assignmentId,
    assignmentRevision: row.assignmentRevision,
    collector: row.collectorSubject,
    amount: Money.of(row.currency, row.amountMinor),
    custodyStatus: member(CUSTODY_STATUSES, row.custodyStatus, 'CUSTODY_STATUS'),
    handoverId: row.handoverId,
    revision: row.revision,
    collectedAt: row.collectedAt,
    updatedAt: row.updatedAt,
  };
}

function toHandover(row: HandoverRow): HandoverRecord {
  return {
    id: row.id,
    holder: row.holderSubject,
    declared: Money.of(row.currency, row.declaredMinor),
    receiptCount: row.receiptCount,
    status: member(HANDOVER_STATUSES, row.status, 'HANDOVER_STATUS'),
    counted: optionalMoney(row.currency, row.countedMinor),
    shortage: optionalMoney(row.currency, row.shortageMinor),
    overage: optionalMoney(row.currency, row.overageMinor),
    treasuryReference: row.treasuryReference,
    receivedBy: row.receivedBySubject,
    receivedAt: row.receivedAt,
    settlementReference: row.settlementReference,
    reconciledBy: row.reconciledBySubject,
    reconciledAt: row.reconciledAt,
    cancelledBy: row.cancelledBySubject,
    cancelledAt: row.cancelledAt,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toReversal(row: ReversalRow): ReversalRecord {
  return {
    id: row.id,
    receiptId: row.receiptId,
    obligationId: row.obligationId,
    reason: member(REVERSAL_REASONS, row.reason, 'REVERSAL_REASON'),
    reversedBy: row.reversedBySubject,
    reversedAt: row.reversedAt,
  };
}

function handoverData(next: HandoverRecord) {
  return {
    status: next.status,
    countedMinor: next.counted?.amountMinor ?? null,
    shortageMinor: next.shortage?.amountMinor ?? null,
    overageMinor: next.overage?.amountMinor ?? null,
    treasuryReference: next.treasuryReference,
    receivedBySubject: next.receivedBy,
    receivedAt: next.receivedAt,
    settlementReference: next.settlementReference,
    reconciledBySubject: next.reconciledBy,
    reconciledAt: next.reconciledAt,
    cancelledBySubject: next.cancelledBy,
    cancelledAt: next.cancelledAt,
    updatedAt: next.updatedAt,
  };
}

function uniqueOn(error: unknown, targets: readonly string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  const meta = JSON.stringify(error.meta ?? {});
  return targets.some((target) => meta.includes(target));
}

async function handoverReceiptIds(db: Db, handoverId: string): Promise<string[]> {
  const items = await db.custodyHandoverItem.findMany({
    where: { handoverId },
    select: { receiptId: true },
    orderBy: { receiptId: 'asc' },
  });
  return items.map((item) => item.receiptId);
}

/** Custody writes on the caller's transaction (see BillingUnitOfWork.custody). */
export class PrismaCustodyStore implements CustodyStore {
  constructor(private readonly tx: Tx) {}

  async lockReceipt(id: string): Promise<CashReceiptRecord | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.cash_receipt WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.cashReceipt.findUnique({ where: { id } });
    return row ? toReceipt(row) : null;
  }

  async lockReceipts(ids: readonly string[]): Promise<CashReceiptRecord[]> {
    if (ids.length === 0) return [];
    const ordered = [...ids].sort();
    await this.tx.$queryRaw`
      SELECT id FROM app.cash_receipt WHERE id = ANY(${ordered}::uuid[]) ORDER BY id FOR UPDATE`;
    const rows = await this.tx.cashReceipt.findMany({
      where: { id: { in: ordered } },
      orderBy: { id: 'asc' },
    });
    return rows.map(toReceipt);
  }

  async insertReceipt(receipt: CashReceiptRecord, correlationId: string): Promise<void> {
    try {
      await this.tx.cashReceipt.create({
        data: {
          id: receipt.id,
          obligationId: receipt.obligationId,
          intentId: receipt.intentId,
          bookingId: receipt.bookingId,
          assignmentId: receipt.assignmentId,
          assignmentRevision: receipt.assignmentRevision,
          collectorSubject: receipt.collector,
          currency: receipt.amount.currency,
          amountMinor: receipt.amount.amountMinor,
          custodyStatus: receipt.custodyStatus,
          activeSlot: 1,
          handoverId: null,
          revision: receipt.revision,
          collectedAt: receipt.collectedAt,
          updatedAt: receipt.updatedAt,
          correlationId,
        },
      });
    } catch (error: unknown) {
      if (uniqueOn(error, ['obligation_id', 'booking_id'])) throw new CollectionAlreadyRecorded();
      throw error;
    }
  }

  async updateReceiptCustody(
    id: string,
    expectedRevision: number,
    to: CustodyStatus,
    handoverId: string | null,
    at: Date,
  ): Promise<void> {
    const result = await this.tx.cashReceipt.updateMany({
      where: { id, revision: expectedRevision },
      data: {
        custodyStatus: to,
        activeSlot: to === 'REVERSED' ? null : 1,
        handoverId,
        updatedAt: at,
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConcurrentModification();
  }

  async insertReversal(reversal: ReversalRecord, correlationId: string): Promise<void> {
    try {
      await this.tx.cashReceiptReversal.create({
        data: {
          id: reversal.id,
          receiptId: reversal.receiptId,
          obligationId: reversal.obligationId,
          reason: reversal.reason,
          reversedBySubject: reversal.reversedBy,
          reversedAt: reversal.reversedAt,
          correlationId,
        },
      });
    } catch (error: unknown) {
      // A second reversal of the same receipt lost a race the lock should have
      // serialised; report it as a concurrent change, never as success.
      if (uniqueOn(error, ['receipt_id'])) throw new ConcurrentModification();
      throw error;
    }
  }

  async lockHandover(id: string): Promise<HandoverRecord | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.custody_handover WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.custodyHandover.findUnique({ where: { id } });
    return row ? toHandover(row) : null;
  }

  async insertHandover(
    handover: HandoverRecord,
    items: readonly HandoverItem[],
    correlationId: string,
  ): Promise<void> {
    await this.tx.custodyHandover.create({
      data: {
        id: handover.id,
        holderSubject: handover.holder,
        currency: handover.declared.currency,
        declaredMinor: handover.declared.amountMinor,
        receiptCount: handover.receiptCount,
        revision: handover.revision,
        createdAt: handover.createdAt,
        correlationId,
        ...handoverData(handover),
      },
    });
    await this.tx.custodyHandoverItem.createMany({
      data: items.map((item) => ({
        handoverId: handover.id,
        receiptId: item.receiptId,
        currency: item.amount.currency,
        amountMinor: item.amount.amountMinor,
      })),
    });
  }

  async updateHandover(id: string, expectedRevision: number, next: HandoverRecord): Promise<void> {
    let count: number;
    try {
      ({ count } = await this.tx.custodyHandover.updateMany({
        where: { id, revision: expectedRevision },
        data: { ...handoverData(next), revision: { increment: 1 } },
      }));
    } catch (error: unknown) {
      if (uniqueOn(error, ['treasury_reference', 'settlement_reference']))
        throw new TreasuryReferenceTaken();
      throw error;
    }
    if (count !== 1) throw new ConcurrentModification();
  }

  handoverReceiptIds(handoverId: string): Promise<string[]> {
    return handoverReceiptIds(this.tx, handoverId);
  }
}

interface BalanceRow {
  currency: string;
  ledger: string;
  held: string;
  held_count: number;
  in_handover: string;
  in_handover_count: number;
  shortage: string;
}

interface InvariantRow {
  holder: string;
  currency: string;
  ledger: string;
  receipts: string;
}

interface TreasuryRow {
  currency: string;
  unreconciled: string;
  reconciled: string;
  shortage: string;
  overage: string;
}

/**
 * Net balances that the COMMIT-time checks keep non-negative. A negative value
 * would mean corruption: Money.of refuses it and the read fails loudly instead
 * of showing a clamped number.
 */
const money = (currency: string, value: string): Money => Money.of(currency, BigInt(value));

/** Read side. Multi-query answers run in ONE REPEATABLE READ snapshot. */
export class PrismaCustodyReader implements CustodyReader {
  constructor(private readonly client: PrismaClient) {}

  private snapshotRead<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.client.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5_000,
      timeout: 10_000,
    });
  }

  async receipt(id: string): Promise<CashReceiptRecord | null> {
    const row = await this.client.cashReceipt.findUnique({ where: { id } });
    return row ? toReceipt(row) : null;
  }

  async reversalFor(receiptId: string): Promise<ReversalRecord | null> {
    const row = await this.client.cashReceiptReversal.findUnique({ where: { receiptId } });
    return row ? toReversal(row) : null;
  }

  handover(id: string): Promise<HandoverView | null> {
    return this.snapshotRead(async (tx) => {
      const row = await tx.custodyHandover.findUnique({ where: { id } });
      if (!row) return null;
      return { handover: toHandover(row), receiptIds: await handoverReceiptIds(tx, id) };
    });
  }

  holderPosition(holder: string): Promise<HolderPosition> {
    return this.snapshotRead(async (tx) => {
      const rows = await tx.$queryRaw<BalanceRow[]>`
        WITH currencies AS (
          SELECT currency FROM app.cash_receipt WHERE collector_subject = ${holder}::uuid
          UNION
          SELECT currency FROM app.ledger_line WHERE holder_subject = ${holder}::uuid
        )
        SELECT c.currency::text AS currency,
          COALESCE((SELECT SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END)
                      FROM app.ledger_line l
                     WHERE l.account = 'CASH_IN_CUSTODY' AND l.holder_subject = ${holder}::uuid
                       AND l.currency = c.currency), 0)::text AS ledger,
          COALESCE((SELECT SUM(r.amount_minor) FROM app.cash_receipt r
                     WHERE r.collector_subject = ${holder}::uuid AND r.currency = c.currency
                       AND r.custody_status = 'HELD'), 0)::text AS held,
          (SELECT COUNT(*) FROM app.cash_receipt r
            WHERE r.collector_subject = ${holder}::uuid AND r.currency = c.currency
              AND r.custody_status = 'HELD')::int AS held_count,
          COALESCE((SELECT SUM(r.amount_minor) FROM app.cash_receipt r
                     WHERE r.collector_subject = ${holder}::uuid AND r.currency = c.currency
                       AND r.custody_status = 'IN_HANDOVER'), 0)::text AS in_handover,
          (SELECT COUNT(*) FROM app.cash_receipt r
            WHERE r.collector_subject = ${holder}::uuid AND r.currency = c.currency
              AND r.custody_status = 'IN_HANDOVER')::int AS in_handover_count,
          COALESCE((SELECT SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END)
                      FROM app.ledger_line l
                     WHERE l.account = 'CUSTODY_SHORTAGE_RECEIVABLE' AND l.holder_subject = ${holder}::uuid
                       AND l.currency = c.currency), 0)::text AS shortage
          FROM currencies c
         ORDER BY c.currency`;
      const balances: CustodyBalance[] = rows
        .filter((row) => SUPPORTED_SCALES[row.currency] !== undefined)
        .map((row) => ({
          currency: row.currency,
          ledgerCustody: money(row.currency, row.ledger),
          held: money(row.currency, row.held),
          heldCount: row.held_count,
          inHandover: money(row.currency, row.in_handover),
          inHandoverCount: row.in_handover_count,
          shortageOutstanding: money(row.currency, row.shortage),
        }));
      return { holder, balances };
    });
  }

  reconciliationReport(now: Date): Promise<CustodyReconciliationReport> {
    return this.snapshotRead(async (tx) => {
      const invariants = await tx.$queryRaw<InvariantRow[]>`
        WITH ledger AS (
          SELECT holder_subject AS holder, currency,
                 SUM(CASE WHEN side = 'DEBIT' THEN amount_minor ELSE -amount_minor END) AS amount
            FROM app.ledger_line WHERE account = 'CASH_IN_CUSTODY'
           GROUP BY holder_subject, currency
        ), receipts AS (
          SELECT collector_subject AS holder, currency, SUM(amount_minor) AS amount
            FROM app.cash_receipt WHERE custody_status IN ('HELD', 'IN_HANDOVER')
           GROUP BY collector_subject, currency
        )
        SELECT COALESCE(l.holder, r.holder)::text AS holder,
               COALESCE(l.currency, r.currency)::text AS currency,
               COALESCE(l.amount, 0)::text AS ledger,
               COALESCE(r.amount, 0)::text AS receipts
          FROM ledger l FULL OUTER JOIN receipts r ON r.holder = l.holder AND r.currency = l.currency
         ORDER BY 1, 2`;
      const [orphans] = await tx.$queryRaw<{ receipts: number; settlements: number }[]>`
        SELECT
          (SELECT COUNT(*) FROM app.cash_receipt r JOIN app.billing_obligation o ON o.id = r.obligation_id
            WHERE r.active_slot = 1 AND o.status <> 'SETTLED')::int AS receipts,
          (SELECT COUNT(*) FROM app.payment_intent i
            WHERE i.method = 'CASH_ON_COMPLETION' AND i.status = 'SUCCEEDED'
              AND NOT EXISTS (SELECT 1 FROM app.cash_receipt r
                               WHERE r.intent_id = i.id AND r.active_slot = 1))::int AS settlements`;
      const [handovers] = await tx.$queryRaw<
        { pending: number; awaiting: number; discrepancy: number }[]
      >`
        SELECT COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
               COUNT(*) FILTER (WHERE status = 'RECEIVED')::int AS awaiting,
               COUNT(*) FILTER (WHERE status IN ('RECEIVED', 'RECONCILED')
                                  AND (shortage_minor > 0 OR overage_minor > 0))::int AS discrepancy
          FROM app.custody_handover`;
      const treasury = await tx.$queryRaw<TreasuryRow[]>`
        SELECT currency::text AS currency,
          COALESCE(SUM(CASE WHEN account = 'TREASURY_CASH_UNRECONCILED' THEN
              CASE WHEN side = 'DEBIT' THEN amount_minor ELSE -amount_minor END END), 0)::text AS unreconciled,
          COALESCE(SUM(CASE WHEN account = 'TREASURY_CASH' THEN
              CASE WHEN side = 'DEBIT' THEN amount_minor ELSE -amount_minor END END), 0)::text AS reconciled,
          COALESCE(SUM(CASE WHEN account = 'CUSTODY_SHORTAGE_RECEIVABLE' THEN
              CASE WHEN side = 'DEBIT' THEN amount_minor ELSE -amount_minor END END), 0)::text AS shortage,
          COALESCE(SUM(CASE WHEN account = 'CUSTODY_OVERAGE_SUSPENSE' THEN
              CASE WHEN side = 'CREDIT' THEN amount_minor ELSE -amount_minor END END), 0)::text AS overage
          FROM app.ledger_line
         WHERE account IN ('TREASURY_CASH_UNRECONCILED', 'TREASURY_CASH',
                           'CUSTODY_SHORTAGE_RECEIVABLE', 'CUSTODY_OVERAGE_SUSPENSE')
         GROUP BY currency ORDER BY currency`;
      const mismatches: HolderInvariant[] = invariants
        .filter((row) => row.ledger !== row.receipts)
        .map((row) => ({
          holder: row.holder,
          currency: row.currency,
          // Exact signed minor units: a mismatch is reported, never clamped.
          ledgerCustodyMinor: row.ledger,
          receiptsInCustodyMinor: row.receipts,
        }));
      const positions: TreasuryPosition[] = treasury.map((row) => ({
        currency: row.currency,
        unreconciled: money(row.currency, row.unreconciled),
        reconciled: money(row.currency, row.reconciled),
        shortageOutstanding: money(row.currency, row.shortage),
        overageSuspense: money(row.currency, row.overage),
      }));
      return {
        evaluatedAt: now,
        holderMismatches: mismatches,
        holdersChecked: invariants.length,
        receiptsWithoutSettledObligation: orphans?.receipts ?? 0,
        cashSettlementsWithoutReceipt: orphans?.settlements ?? 0,
        handoversPending: handovers?.pending ?? 0,
        handoversAwaitingReconciliation: handovers?.awaiting ?? 0,
        handoversWithDiscrepancy: handovers?.discrepancy ?? 0,
        treasury: positions,
      };
    });
  }
}
