import { Injectable } from '@nestjs/common';
import {
  ACTIVE_INTENT_STATUSES,
  ATTEMPT_STATUSES,
  INTENT_STATUSES,
  Money,
  OBLIGATION_STATUSES,
  PAYMENT_METHODS,
  type IntentStatus,
  type JournalPlan,
} from '../../domain';
import {
  ConcurrentModification,
  ObligationAlreadyExists,
  ProviderReferenceTaken,
  ReceiptAlreadyExists,
  type AttemptReconciliation,
  type AttemptRecord,
  type AuditRecord,
  type BillingRepository,
  type BillingUnitOfWork,
  type CustodyReader,
  type CustodyStore,
  type ProviderReader,
  type ProviderStore,
  type FinancialSnapshot,
  type IdempotencyReceipt,
  type IntentRecord,
  type JournalMeta,
  type ObligationChange,
  type ObligationRecord,
  type OutboxEvent,
  type PrincipalKind,
  type PrincipalRef,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import {
  PrismaCustodyReader,
  PrismaCustodyStore,
  toReceipt as toCashReceipt,
} from './prisma-custody.store';
import { PrismaProviderReader, PrismaProviderStore } from './prisma-provider.store';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;
type ObligationRow = Prisma.BillingObligationGetPayload<object>;
type IntentRow = Prisma.PaymentIntentGetPayload<object>;
type AttemptRow = Prisma.PaymentAttemptGetPayload<object>;

/** Rows are written only through this adapter; an unknown value means corruption. */
function member<T extends string>(allowed: readonly T[], value: string, what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (!found) throw new Error(`STORED_${what}_INVALID`);
  return found;
}

const KINDS: readonly PrincipalKind[] = ['account', 'guest'];

function ref(kind: string, subjectId: string): PrincipalRef {
  return { kind: member(KINDS, kind, 'PRINCIPAL_KIND'), subjectId };
}

function toObligation(row: ObligationRow): ObligationRecord {
  return {
    id: row.id,
    owner: ref(row.ownerKind, row.ownerSubject),
    quoteId: row.quoteId,
    amount: Money.of(row.currency, row.amountMinor),
    verified: Money.of(row.currency, row.verifiedMinor),
    status: member(OBLIGATION_STATUSES, row.status, 'OBLIGATION_STATUS'),
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toIntent(row: IntentRow): IntentRecord {
  return {
    id: row.id,
    obligationId: row.obligationId,
    method: member(PAYMENT_METHODS, row.method, 'METHOD'),
    status: member(INTENT_STATUSES, row.status, 'INTENT_STATUS'),
    amount: Money.of(row.currency, row.amountMinor),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAttempt(row: AttemptRow): AttemptRecord {
  const reviewer =
    row.reconciledByKind !== null && row.reconciledBySubject !== null
      ? ref(row.reconciledByKind, row.reconciledBySubject)
      : null;
  return {
    id: row.id,
    intentId: row.intentId,
    obligationId: row.obligationId,
    method: member(PAYMENT_METHODS, row.method, 'METHOD'),
    providerReference: row.providerReference,
    status: member(ATTEMPT_STATUSES, row.status, 'ATTEMPT_STATUS'),
    claimed: Money.of(row.currency, row.claimedMinor),
    submittedAt: row.submittedAt,
    reconciledAt: row.reconciledAt,
    reconciledBy: reviewer,
    observed: row.observedMinor === null ? null : Money.of(row.currency, row.observedMinor),
  };
}

function toReceipt(row: Prisma.BillingIdempotencyReceiptGetPayload<object>): IdempotencyReceipt {
  return {
    actor: ref(row.actorKind, row.actorSubject),
    operation: row.operation,
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    outcome: {
      status: row.responseStatus,
      // Written by saveReceipt from an object; the CHECK keeps it an object.
      body: row.responseBody as Readonly<Record<string, unknown>>,
    },
  };
}

function activeSlot(status: IntentStatus): number | null {
  return ACTIVE_INTENT_STATUSES.includes(status) ? 1 : null;
}

function uniqueViolation(error: unknown, target: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  const meta = JSON.stringify(error.meta ?? {});
  return meta.includes(target);
}

async function findReceipt(
  db: Db,
  actor: PrincipalRef,
  operation: string,
  idempotencyKey: string,
): Promise<IdempotencyReceipt | null> {
  const row = await db.billingIdempotencyReceipt.findUnique({
    where: {
      actorKind_actorSubject_operation_idempotencyKey: {
        actorKind: actor.kind,
        actorSubject: actor.subjectId,
        operation,
        idempotencyKey,
      },
    },
  });
  return row ? toReceipt(row) : null;
}

async function snapshot(db: Db, obligationId: string): Promise<FinancialSnapshot | null> {
  const row = await db.billingObligation.findUnique({ where: { id: obligationId } });
  if (!row) return null;
  const intent = await db.paymentIntent.findFirst({ where: { obligationId, activeSlot: 1 } });
  const attempts = await db.paymentAttempt.findMany({
    where: { obligationId },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
  });
  const receipt = await db.cashReceipt.findFirst({ where: { obligationId, activeSlot: 1 } });
  const credit = await db.providerCredit.findFirst({
    where: { obligationId, status: 'ALLOCATED' },
    select: { id: true },
  });
  let refunded: Money | null = null;
  if (credit) {
    const total = await db.paymentRefund.aggregate({
      where: { creditId: credit.id, status: 'SUCCEEDED' },
      _sum: { amountMinor: true },
    });
    refunded = Money.of(row.currency, total._sum.amountMinor ?? 0n);
  }
  return {
    obligation: toObligation(row),
    activeIntent: intent ? toIntent(intent) : null,
    attempts: attempts.map(toAttempt),
    cashReceipt: receipt ? toCashReceipt(receipt) : null,
    refunded,
  };
}

class PrismaBillingUnitOfWork implements BillingUnitOfWork {
  readonly custody: CustodyStore;
  readonly providers: ProviderStore;

  constructor(private readonly tx: Tx) {
    this.custody = new PrismaCustodyStore(tx);
    this.providers = new PrismaProviderStore(tx);
  }

  findReceipt(actor: PrincipalRef, operation: string, key: string) {
    return findReceipt(this.tx, actor, operation, key);
  }

  async saveReceipt(receipt: IdempotencyReceipt, recordedAt: Date): Promise<void> {
    try {
      await this.tx.billingIdempotencyReceipt.create({
        data: {
          actorKind: receipt.actor.kind,
          actorSubject: receipt.actor.subjectId,
          operation: receipt.operation,
          idempotencyKey: receipt.idempotencyKey,
          requestFingerprint: receipt.requestFingerprint,
          responseStatus: receipt.outcome.status,
          responseBody: receipt.outcome.body as Prisma.InputJsonObject,
          createdAt: recordedAt,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ReceiptAlreadyExists();
      throw error;
    }
  }

  async obligationIdForQuote(quoteId: string): Promise<string | null> {
    const row = await this.tx.billingObligation.findUnique({
      where: { quoteId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async insertObligation(obligation: ObligationRecord, correlationId: string): Promise<void> {
    try {
      await this.tx.billingObligation.create({
        data: {
          id: obligation.id,
          ownerKind: obligation.owner.kind,
          ownerSubject: obligation.owner.subjectId,
          quoteId: obligation.quoteId,
          currency: obligation.amount.currency,
          amountMinor: obligation.amount.amountMinor,
          verifiedMinor: obligation.verified.amountMinor,
          status: obligation.status,
          revision: obligation.revision,
          createdAt: obligation.createdAt,
          updatedAt: obligation.updatedAt,
          correlationId,
        },
      });
    } catch (error: unknown) {
      if (uniqueViolation(error, 'quote_id')) throw new ObligationAlreadyExists();
      throw error;
    }
  }

  async lockObligation(id: string): Promise<ObligationRecord | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.billing_obligation WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.billingObligation.findUnique({ where: { id } });
    return row ? toObligation(row) : null;
  }

  async updateObligation(
    id: string,
    expectedRevision: number,
    change: ObligationChange,
  ): Promise<void> {
    const result = await this.tx.billingObligation.updateMany({
      where: { id, revision: expectedRevision },
      data: {
        verifiedMinor: change.verified.amountMinor,
        status: change.status,
        updatedAt: change.updatedAt,
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConcurrentModification();
  }

  snapshot(obligationId: string) {
    return snapshot(this.tx, obligationId);
  }

  async insertIntent(intent: IntentRecord, correlationId: string): Promise<void> {
    await this.tx.paymentIntent.create({
      data: {
        id: intent.id,
        obligationId: intent.obligationId,
        method: intent.method,
        status: intent.status,
        activeSlot: activeSlot(intent.status),
        currency: intent.amount.currency,
        amountMinor: intent.amount.amountMinor,
        createdAt: intent.createdAt,
        updatedAt: intent.updatedAt,
        correlationId,
      },
    });
  }

  async setIntentStatus(
    intentId: string,
    from: IntentStatus,
    to: IntentStatus,
    at: Date,
  ): Promise<void> {
    const result = await this.tx.paymentIntent.updateMany({
      where: { id: intentId, status: from },
      data: { status: to, activeSlot: activeSlot(to), updatedAt: at },
    });
    if (result.count !== 1) throw new ConcurrentModification();
  }

  countAttempts(obligationId: string): Promise<number> {
    return this.tx.paymentAttempt.count({ where: { obligationId } });
  }

  async insertAttempt(attempt: AttemptRecord, correlationId: string): Promise<void> {
    try {
      await this.tx.paymentAttempt.create({
        data: {
          id: attempt.id,
          intentId: attempt.intentId,
          obligationId: attempt.obligationId,
          method: attempt.method,
          providerReference: attempt.providerReference,
          status: attempt.status,
          currency: attempt.claimed.currency,
          claimedMinor: attempt.claimed.amountMinor,
          observedMinor: null,
          submittedAt: attempt.submittedAt,
          reconciledAt: null,
          reconciledByKind: null,
          reconciledBySubject: null,
          correlationId,
        },
      });
    } catch (error: unknown) {
      if (uniqueViolation(error, 'provider_reference')) throw new ProviderReferenceTaken();
      throw error;
    }
  }

  async reconcileAttempt(
    attemptId: string,
    from: AttemptRecord['status'],
    change: AttemptReconciliation,
  ): Promise<void> {
    const result = await this.tx.paymentAttempt.updateMany({
      where: { id: attemptId, status: from },
      data: {
        status: change.to,
        reconciledAt: change.at,
        reconciledByKind: change.by?.kind ?? null,
        reconciledBySubject: change.by?.subjectId ?? null,
        observedMinor: change.observed?.amountMinor ?? null,
        creditId: change.creditId,
      },
    });
    if (result.count !== 1) throw new ConcurrentModification();
  }

  async postJournal(journal: JournalPlan, meta: JournalMeta): Promise<void> {
    await this.tx.ledgerJournal.create({
      data: {
        id: meta.id,
        kind: journal.kind,
        businessRef: journal.businessRef,
        obligationId: meta.obligationId,
        handoverId: meta.handoverId,
        creditId: meta.creditId ?? null,
        postedAt: meta.postedAt,
        correlationId: meta.correlationId,
      },
    });
    await this.tx.ledgerLine.createMany({
      data: journal.lines.map((line, lineNo) => ({
        journalId: meta.id,
        lineNo,
        account: line.account,
        side: line.side,
        currency: line.amount.currency,
        amountMinor: line.amount.amountMinor,
        holderSubject: line.holder ?? null,
      })),
    });
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    await this.tx.billingAuditEvent.create({
      data: {
        id: record.id,
        occurredAt: record.occurredAt,
        actorKind: record.actor.kind,
        actorSubject: record.actor.subjectId,
        action: record.action,
        obligationId: record.obligationId,
        attemptId: record.attemptId,
        receiptId: record.receiptId,
        handoverId: record.handoverId,
        creditId: record.creditId ?? null,
        refundId: record.refundId ?? null,
        outcome: record.outcome,
        correlationId: record.correlationId,
      },
    });
  }

  async appendOutbox(event: OutboxEvent): Promise<void> {
    await this.tx.outboxMessage.create({
      data: {
        id: event.eventId,
        eventId: event.eventId,
        eventType: event.eventType,
        exchange: event.exchange,
        routingKey: event.routingKey,
        payload: event.payload,
        correlationId: event.correlationId,
        traceParent: event.traceParent,
        createdAt: event.createdAt,
      },
    });
  }
}

@Injectable()
export class PrismaBillingRepository implements BillingRepository {
  private readonly client: PrismaClient;
  readonly custody: CustodyReader;
  readonly providers: ProviderReader;

  constructor(prisma: PrismaService) {
    this.client = prisma.client;
    this.custody = new PrismaCustodyReader(prisma.client);
    this.providers = new PrismaProviderReader(prisma.client);
  }

  transaction<T>(work: (uow: BillingUnitOfWork) => Promise<T>): Promise<T> {
    return this.client.$transaction((tx) => work(new PrismaBillingUnitOfWork(tx)), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  findReceipt(actor: PrincipalRef, operation: string, key: string) {
    return findReceipt(this.client, actor, operation, key);
  }

  /** One REPEATABLE READ transaction, so obligation, intent and attempts agree. */
  snapshot(obligationId: string) {
    return this.client.$transaction((tx) => snapshot(tx, obligationId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5_000,
      timeout: 10_000,
    });
  }

  async obligationIdForQuote(quoteId: string): Promise<string | null> {
    const row = await this.client.billingObligation.findUnique({
      where: { quoteId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async obligationIdForAttempt(attemptId: string): Promise<string | null> {
    const row = await this.client.paymentAttempt.findUnique({
      where: { id: attemptId },
      select: { obligationId: true },
    });
    return row?.obligationId ?? null;
  }
}
