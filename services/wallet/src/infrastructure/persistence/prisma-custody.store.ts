import {
  HANDOVER_STATUSES,
  amountOf,
  isCurrency,
  type Amount,
  type Currency,
  type HandoverState,
  type ReceiptState,
} from '../../domain';
import {
  INBOX_OUTCOMES,
  type AccountRef,
  type CommittedInbox,
  type CustodyAccountView,
  type CustodyProjectionStore,
  type CustodyUnitOfWork,
  type InboxEntry,
  type MovementRecord,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import type { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;

export const CUSTODY_PURPOSE = 'TECHNICIAN_CUSTODY';

/** Rows are written only through this adapter; an unknown value means corruption. */
function member<T extends string>(allowed: readonly T[], value: string, what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (!found) throw new Error(`STORED_${what}_INVALID`);
  return found;
}

function currencyOf(value: string): Currency {
  if (!isCurrency(value)) throw new Error('STORED_CURRENCY_INVALID');
  return value;
}

const optional = (currency: Currency, minor: bigint | null): Amount | null =>
  minor === null ? null : amountOf(currency, minor);

class PrismaCustodyUnitOfWork implements CustodyUnitOfWork {
  constructor(private readonly tx: Tx) {}

  async inbox(eventId: string): Promise<CommittedInbox | null> {
    const row = await this.tx.walletInbox.findUnique({ where: { eventId } });
    if (!row) return null;
    return {
      payloadHash: row.payloadHash,
      outcome: member(INBOX_OUTCOMES, row.outcome, 'INBOX_OUTCOME'),
    };
  }

  async claimInbox(entry: InboxEntry): Promise<boolean> {
    // ON CONFLICT DO NOTHING waits for a concurrent claimant of the same id and
    // then reports zero rows, without aborting this transaction.
    const inserted = await this.tx.$executeRaw`
      INSERT INTO "app"."wallet_inbox" ("event_id", "event_type", "payload_hash", "outcome", "reason",
        "aggregate_type", "aggregate_id", "aggregate_version", "correlation_id", "occurred_at", "received_at")
      VALUES (${entry.eventId}::uuid, ${entry.eventType}, ${entry.payloadHash}, ${entry.outcome},
        ${entry.reason}, ${entry.aggregate?.type ?? null}, ${entry.aggregate?.id ?? null}::uuid,
        ${entry.aggregate?.version ?? null}::integer, ${entry.correlationId}::uuid,
        ${entry.occurredAt}::timestamptz, ${entry.receivedAt}::timestamptz)
      ON CONFLICT ("event_id") DO NOTHING`;
    return inserted === 1;
  }

  async recordInboxConflict(eventId: string, payloadHash: string, detectedAt: Date) {
    await this.tx.walletInboxConflict.create({ data: { eventId, payloadHash, detectedAt } });
  }

  async lockAggregate(aggregateId: string): Promise<void> {
    await this.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:aggregate:${aggregateId}`}, 0))`;
  }

  async receipt(receiptId: string): Promise<ReceiptState | null> {
    const row = await this.tx.walletCustodyReceipt.findUnique({ where: { receiptId } });
    if (!row) return null;
    return {
      receiptId: row.receiptId,
      holder: row.holderSubject,
      amount: amountOf(currencyOf(row.currency), row.amountMinor),
      collectedEventId: row.collectedEventId,
      reversedEventId: row.reversedEventId,
      version: row.version,
    };
  }

  async saveReceipt(state: ReceiptState, existed: boolean, now: Date): Promise<void> {
    const data = {
      holderSubject: state.holder,
      collectedEventId: state.collectedEventId,
      reversedEventId: state.reversedEventId,
      version: state.version,
      updatedAt: now,
    };
    if (existed) {
      await this.tx.walletCustodyReceipt.update({ where: { receiptId: state.receiptId }, data });
      return;
    }
    await this.tx.walletCustodyReceipt.create({
      data: {
        ...data,
        receiptId: state.receiptId,
        currency: state.amount.currency,
        amountMinor: state.amount.minor,
        createdAt: now,
      },
    });
  }

  async handover(handoverId: string): Promise<HandoverState | null> {
    const row = await this.tx.walletCustodyHandover.findUnique({ where: { handoverId } });
    if (!row) return null;
    const currency = currencyOf(row.currency);
    return {
      handoverId: row.handoverId,
      holder: row.holderSubject,
      status: member(HANDOVER_STATUSES, row.status, 'HANDOVER_STATUS'),
      receiptCount: row.receiptCount,
      declared: amountOf(currency, row.declaredMinor),
      counted: optional(currency, row.countedMinor),
      shortage: optional(currency, row.shortageMinor),
      overage: optional(currency, row.overageMinor),
      version: row.version,
      lastEventId: row.lastEventId,
    };
  }

  async saveHandover(state: HandoverState, existed: boolean, now: Date): Promise<void> {
    const data = {
      status: state.status,
      countedMinor: state.counted?.minor ?? null,
      shortageMinor: state.shortage?.minor ?? null,
      overageMinor: state.overage?.minor ?? null,
      version: state.version,
      lastEventId: state.lastEventId,
      updatedAt: now,
    };
    if (existed) {
      await this.tx.walletCustodyHandover.update({
        where: { handoverId: state.handoverId },
        data,
      });
      return;
    }
    await this.tx.walletCustodyHandover.create({
      data: {
        ...data,
        handoverId: state.handoverId,
        holderSubject: state.holder,
        currency: state.declared.currency,
        receiptCount: state.receiptCount,
        declaredMinor: state.declared.minor,
        createdAt: now,
      },
    });
  }

  async lockAccount(
    holder: string,
    currency: Currency,
    newId: string,
    now: Date,
  ): Promise<AccountRef> {
    await this.tx.$executeRaw`
      INSERT INTO "app"."wallet_accounts" ("id", "holder_subject", "currency", "purpose", "collected_minor",
        "reversed_minor", "in_handover_minor", "received_minor", "settled_minor", "shortage_minor",
        "overage_minor", "revision", "created_at", "updated_at")
      VALUES (${newId}::uuid, ${holder}::uuid, ${currency}, ${CUSTODY_PURPOSE}, 0, 0, 0, 0, 0, 0, 0, 0,
        ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT ("holder_subject", "currency", "purpose") DO NOTHING`;
    const rows = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT "id"::text AS "id" FROM "app"."wallet_accounts"
       WHERE "holder_subject" = ${holder}::uuid AND "currency" = ${currency}
         AND "purpose" = ${CUSTODY_PURPOSE}
       FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error('WALLET_ACCOUNT_MISSING_AFTER_UPSERT');
    return { id: row.id, holder, currency };
  }

  async refreshAccount(
    account: AccountRef,
    lastEvent: { readonly eventId: string; readonly occurredAt: Date },
    now: Date,
  ): Promise<number> {
    // Same fold as domain positionOf(): collected/reversed from attributed
    // receipts, declared amounts by handover status, shortage/overage from
    // counted handovers. Every statement sees rows committed before the
    // account lock was granted, plus this transaction's own writes.
    const rows = await this.tx.$queryRaw<{ revision: number }[]>`
      WITH r AS (
        SELECT COALESCE(SUM("amount_minor"), 0)::bigint AS collected,
               COALESCE(SUM("amount_minor") FILTER (WHERE "reversed_event_id" IS NOT NULL), 0)::bigint AS reversed
          FROM "app"."wallet_custody_receipt"
         WHERE "holder_subject" = ${account.holder}::uuid AND "currency" = ${account.currency}
           AND "collected_event_id" IS NOT NULL
      ), h AS (
        SELECT COALESCE(SUM("declared_minor") FILTER (WHERE "status" = 'PENDING'), 0)::bigint AS in_handover,
               COALESCE(SUM("declared_minor") FILTER (WHERE "status" = 'RECEIVED'), 0)::bigint AS received,
               COALESCE(SUM("declared_minor") FILTER (WHERE "status" = 'RECONCILED'), 0)::bigint AS settled,
               COALESCE(SUM("shortage_minor"), 0)::bigint AS shortage,
               COALESCE(SUM("overage_minor"), 0)::bigint AS overage
          FROM "app"."wallet_custody_handover"
         WHERE "holder_subject" = ${account.holder}::uuid AND "currency" = ${account.currency}
      )
      UPDATE "app"."wallet_accounts" a
         SET "collected_minor" = r.collected, "reversed_minor" = r.reversed,
             "in_handover_minor" = h.in_handover, "received_minor" = h.received,
             "settled_minor" = h.settled, "shortage_minor" = h.shortage, "overage_minor" = h.overage,
             "revision" = a."revision" + 1,
             "last_event_id" = ${lastEvent.eventId}::uuid,
             "last_event_at" = GREATEST(COALESCE(a."last_event_at", ${lastEvent.occurredAt}::timestamptz), ${lastEvent.occurredAt}::timestamptz),
             "updated_at" = ${now}::timestamptz
        FROM r, h
       WHERE a."id" = ${account.id}::uuid
      RETURNING a."revision"`;
    const row = rows[0];
    if (!row) throw new Error('WALLET_ACCOUNT_MISSING');
    return row.revision;
  }

  async appendMovement(movement: MovementRecord): Promise<void> {
    await this.tx.walletMovement.create({
      data: {
        id: movement.id,
        accountId: movement.account.id,
        eventId: movement.eventId,
        appliedWithEventId: movement.appliedWithEventId,
        kind: movement.kind,
        currency: movement.account.currency,
        amountMinor: movement.amountMinor,
        sourceType: movement.source.type,
        sourceId: movement.source.id,
        accountRevision: movement.accountRevision,
        recordedAt: movement.recordedAt,
      },
    });
  }
}

/**
 * Wallet's custody projection persistence. READ COMMITTED: ordering comes from
 * the per-aggregate advisory lock and the account row lock, so every
 * statement after a lock sees all transactions committed before it.
 */
export class PrismaCustodyStore implements CustodyProjectionStore {
  private readonly client: PrismaClient;

  constructor(prisma: PrismaService) {
    this.client = prisma.client;
  }

  transaction<T>(work: (uow: CustodyUnitOfWork) => Promise<T>): Promise<T> {
    return this.client.$transaction((tx) => work(new PrismaCustodyUnitOfWork(tx)), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      // A burst of deliveries can exceed the pool; waiting for a connection is
      // safe (nothing is written yet) and a timeout surfaces as a retryable
      // failure, never as an applied event.
      maxWait: 10_000,
      timeout: 10_000,
    });
  }

  async accounts(holder: string): Promise<CustodyAccountView[]> {
    const rows = await this.client.walletAccount.findMany({
      where: { holderSubject: holder, purpose: CUSTODY_PURPOSE, revision: { gt: 0 } },
      orderBy: { currency: 'asc' },
    });
    return rows.map((row) => {
      if (row.lastEventId === null || row.lastEventAt === null)
        throw new Error('STORED_ACCOUNT_WITHOUT_EVENT');
      return {
        currency: currencyOf(row.currency),
        totals: {
          collected: row.collectedMinor,
          reversed: row.reversedMinor,
          inHandover: row.inHandoverMinor,
          receivedByTreasury: row.receivedMinor,
          settled: row.settledMinor,
          shortage: row.shortageMinor,
          overage: row.overageMinor,
        },
        revision: row.revision,
        lastEventId: row.lastEventId,
        lastEventAt: row.lastEventAt,
        updatedAt: row.updatedAt,
      };
    });
  }
}
