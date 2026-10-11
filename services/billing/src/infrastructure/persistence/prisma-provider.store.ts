import {
  CREDIT_SOURCES,
  CREDIT_STATUSES,
  Money,
  PROVIDERS,
  REFUND_CHANNELS,
  REFUND_REASONS,
  REFUND_STATUSES,
  RESERVING_REFUND_STATUSES,
  STATEMENT_REJECTION_REASONS,
  UNALLOCATED_REASONS,
  type ProviderId,
} from '../../domain';
import {
  ConcurrentModification,
  ProviderCreditTaken,
  ProviderRefundReferenceTaken,
  type ClaimLocation,
  type CreditQueueFilter,
  type ProviderCreditRecord,
  type ProviderReader,
  type ProviderStore,
  type RefundQueueFilter,
  type RefundRecord,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;
type CreditRow = Prisma.ProviderCreditGetPayload<object>;
type RefundRow = Prisma.PaymentRefundGetPayload<object>;

/** Rows are written only through these adapters; an unknown value means corruption. */
function member<T extends string>(allowed: readonly T[], value: string, what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (!found) throw new Error(`STORED_${what}_INVALID`);
  return found;
}

function optionalMember<T extends string>(
  allowed: readonly T[],
  value: string | null,
  what: string,
): T | null {
  return value === null ? null : member(allowed, value, what);
}

function toCredit(row: CreditRow): ProviderCreditRecord {
  return {
    id: row.id,
    provider: member(PROVIDERS, row.provider, 'PROVIDER'),
    merchantAccount: row.merchantAccount,
    reference: row.providerReference,
    amount: Money.of(row.currency, row.amountMinor),
    occurredAt: row.occurredAt,
    source: member(CREDIT_SOURCES, row.source, 'CREDIT_SOURCE'),
    evidenceDigest: row.evidenceDigest,
    status: member(CREDIT_STATUSES, row.status, 'CREDIT_STATUS'),
    unallocatedReason: optionalMember(
      UNALLOCATED_REASONS,
      row.unallocatedReason,
      'UNALLOCATED_REASON',
    ),
    attemptId: row.attemptId,
    obligationId: row.obligationId,
    recordedBy: row.recordedBySubject,
    decidedBy: row.decidedBySubject,
    decidedAt: row.decidedAt,
    rejectionReason: optionalMember(
      STATEMENT_REJECTION_REASONS,
      row.rejectionReason,
      'REJECTION_REASON',
    ),
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRefund(row: RefundRow): RefundRecord {
  return {
    id: row.id,
    creditId: row.creditId,
    provider: member(PROVIDERS, row.provider, 'PROVIDER'),
    amount: Money.of(row.currency, row.amountMinor),
    reason: member(REFUND_REASONS, row.reason, 'REFUND_REASON'),
    channel: member(REFUND_CHANNELS, row.channel, 'REFUND_CHANNEL'),
    status: member(REFUND_STATUSES, row.status, 'REFUND_STATUS'),
    requestedBy: row.requestedBySubject,
    requestedAt: row.requestedAt,
    decidedBy: row.decidedBySubject,
    decidedAt: row.decidedAt,
    providerRefundReference: row.providerRefundReference,
    evidenceDigest: row.evidenceDigest,
    completedBy: row.completedBySubject,
    completedAt: row.completedAt,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

function uniqueOn(error: unknown, targets: readonly string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  const meta = JSON.stringify(error.meta ?? {});
  return targets.some((target) => meta.includes(target));
}

function creditData(next: ProviderCreditRecord) {
  return {
    status: next.status,
    unallocatedReason: next.unallocatedReason,
    attemptId: next.attemptId,
    obligationId: next.obligationId,
    activeSlot: next.status === 'REJECTED' ? null : 1,
    decidedBySubject: next.decidedBy,
    decidedAt: next.decidedAt,
    rejectionReason: next.rejectionReason,
    revision: next.revision,
    updatedAt: next.updatedAt,
  };
}

/** Provider writes on the caller's transaction (see BillingUnitOfWork.providers). */
export class PrismaProviderStore implements ProviderStore {
  constructor(private readonly tx: Tx) {}

  async lockReference(provider: ProviderId, reference: string): Promise<void> {
    // Two-key advisory lock namespaced to provider references; released at
    // COMMIT/ROLLBACK. hashtext collisions only serialise unrelated writers.
    await this.tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext('billing.provider-reference'), hashtext(${`${provider}:${reference}`}))`;
  }

  async effectiveCredit(
    provider: ProviderId,
    merchantAccount: string,
    reference: string,
  ): Promise<ProviderCreditRecord | null> {
    const row = await this.tx.providerCredit.findFirst({
      where: { provider, merchantAccount, providerReference: reference, activeSlot: 1 },
    });
    return row ? toCredit(row) : null;
  }

  async unallocatedCreditFor(
    provider: ProviderId,
    reference: string,
  ): Promise<ProviderCreditRecord | null> {
    const row = await this.tx.providerCredit.findFirst({
      where: { provider, providerReference: reference, status: 'UNALLOCATED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return row ? toCredit(row) : null;
  }

  async claimFor(provider: ProviderId, reference: string): Promise<ClaimLocation | null> {
    const row = await this.tx.paymentAttempt.findUnique({
      where: { method_providerReference: { method: provider, providerReference: reference } },
      select: { id: true, obligationId: true },
    });
    return row ? { attemptId: row.id, obligationId: row.obligationId } : null;
  }

  async lockCredit(id: string): Promise<ProviderCreditRecord | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.provider_credit WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.providerCredit.findUnique({ where: { id } });
    return row ? toCredit(row) : null;
  }

  async insertCredit(credit: ProviderCreditRecord, correlationId: string): Promise<void> {
    try {
      await this.tx.providerCredit.create({
        data: {
          id: credit.id,
          provider: credit.provider,
          merchantAccount: credit.merchantAccount,
          providerReference: credit.reference,
          currency: credit.amount.currency,
          amountMinor: credit.amount.amountMinor,
          occurredAt: credit.occurredAt,
          source: credit.source,
          evidenceDigest: credit.evidenceDigest,
          recordedBySubject: credit.recordedBy,
          createdAt: credit.createdAt,
          correlationId,
          ...creditData(credit),
        },
      });
    } catch (error: unknown) {
      if (uniqueOn(error, ['provider_credit_key', 'merchant_account']))
        throw new ProviderCreditTaken();
      throw error;
    }
  }

  async updateCredit(
    id: string,
    expectedRevision: number,
    next: ProviderCreditRecord,
  ): Promise<void> {
    const result = await this.tx.providerCredit.updateMany({
      where: { id, revision: expectedRevision },
      data: creditData(next),
    });
    if (result.count !== 1) throw new ConcurrentModification();
  }

  async reservedForRefund(credit: ProviderCreditRecord): Promise<Money> {
    const total = await this.tx.paymentRefund.aggregate({
      where: { creditId: credit.id, status: { in: [...RESERVING_REFUND_STATUSES] } },
      _sum: { amountMinor: true },
    });
    return Money.of(credit.amount.currency, total._sum.amountMinor ?? 0n);
  }

  async insertRefund(refund: RefundRecord, correlationId: string): Promise<void> {
    await this.tx.paymentRefund.create({
      data: {
        id: refund.id,
        creditId: refund.creditId,
        provider: refund.provider,
        currency: refund.amount.currency,
        amountMinor: refund.amount.amountMinor,
        reason: refund.reason,
        channel: refund.channel,
        status: refund.status,
        requestedBySubject: refund.requestedBy,
        requestedAt: refund.requestedAt,
        revision: refund.revision,
        updatedAt: refund.updatedAt,
        correlationId,
      },
    });
  }

  async lockRefund(id: string): Promise<RefundRecord | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.payment_refund WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.paymentRefund.findUnique({ where: { id } });
    return row ? toRefund(row) : null;
  }

  async updateRefund(id: string, expectedRevision: number, next: RefundRecord): Promise<void> {
    try {
      const result = await this.tx.paymentRefund.updateMany({
        where: { id, revision: expectedRevision },
        data: {
          status: next.status,
          decidedBySubject: next.decidedBy,
          decidedAt: next.decidedAt,
          providerRefundReference: next.providerRefundReference,
          evidenceDigest: next.evidenceDigest,
          completedBySubject: next.completedBy,
          completedAt: next.completedAt,
          revision: next.revision,
          updatedAt: next.updatedAt,
        },
      });
      if (result.count !== 1) throw new ConcurrentModification();
    } catch (error: unknown) {
      if (uniqueOn(error, ['payment_refund_provider_reference_key', 'provider_refund_reference']))
        throw new ProviderRefundReferenceTaken();
      throw error;
    }
  }
}

const MAX_QUEUE = 200;

/** Finance reads of credits and refunds (no transaction needed: single-row or list reads). */
export class PrismaProviderReader implements ProviderReader {
  constructor(private readonly client: PrismaClient) {}

  async credit(id: string): Promise<ProviderCreditRecord | null> {
    const row = await this.client.providerCredit.findUnique({ where: { id } });
    return row ? toCredit(row) : null;
  }

  async refund(id: string): Promise<RefundRecord | null> {
    const row = await this.client.paymentRefund.findUnique({ where: { id } });
    return row ? toRefund(row) : null;
  }

  async refundsForCredit(creditId: string): Promise<readonly RefundRecord[]> {
    const rows = await this.client.paymentRefund.findMany({
      where: { creditId },
      orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRefund);
  }

  async credits(filter: CreditQueueFilter): Promise<readonly ProviderCreditRecord[]> {
    const rows = await this.client.providerCredit.findMany({
      where: { status: filter.status },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: Math.min(filter.limit, MAX_QUEUE),
    });
    return rows.map(toCredit);
  }

  async refunds(filter: RefundQueueFilter): Promise<readonly RefundRecord[]> {
    const rows = await this.client.paymentRefund.findMany({
      where: { status: filter.status },
      orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
      take: Math.min(filter.limit, MAX_QUEUE),
    });
    return rows.map(toRefund);
  }
}
