import {
  REDEMPTION_RELEASE_REASONS,
  REDEMPTION_STATUSES,
  type Discount,
  type PromotionTerms,
} from '../../domain';
import {
  PromotionUniqueConflict,
  type OutboxEvent,
  type PromotionAuditRecord,
  type PromotionReader,
  type PromotionRecord,
  type PromotionRevisionRecord,
  type PromotionUnitOfWork,
  type PromotionUniqueTarget,
  type PromotionUsage,
  type RedemptionRecord,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

function member<T extends string>(value: string, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error('STORED_VALUE_UNKNOWN');
  return found;
}

function toDiscount(row: Prisma.PromotionRevisionGetPayload<object>): Discount {
  if (row.discountKind === 'PERCENT' && row.basisPoints !== null)
    return {
      kind: 'PERCENT',
      basisPoints: row.basisPoints,
      maxDiscountMinor: row.maxDiscountMinor,
    };
  if (row.discountKind === 'FIXED' && row.fixedAmountMinor !== null)
    return { kind: 'FIXED', amountMinor: row.fixedAmountMinor };
  throw new Error('STORED_DISCOUNT_INVALID');
}

function toTerms(row: Prisma.PromotionRevisionGetPayload<object>): PromotionTerms {
  return {
    discount: toDiscount(row),
    currency: row.currency,
    packageIds: [...row.packageIds],
    minSubtotalMinor: row.minSubtotalMinor,
    endsAt: row.endsAt,
    totalCap: row.totalCap,
    perCustomerCap: row.perCustomerCap,
    active: row.active,
  };
}

function toRevision(row: Prisma.PromotionRevisionGetPayload<object>): PromotionRevisionRecord {
  return {
    promotionCode: row.promotionCode,
    revision: row.revision,
    effectiveFrom: row.effectiveFrom,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
    correlationId: row.correlationId,
    terms: toTerms(row),
  };
}

function toRedemption(row: Prisma.PromotionRedemptionGetPayload<object>): RedemptionRecord {
  return {
    id: row.id,
    promotionCode: row.promotionCode,
    capsRevision: row.capsRevision,
    quoteId: row.quoteId,
    bookingId: row.bookingId,
    customerSubject: row.customerSubject,
    discountMinor: row.discountMinor,
    currency: row.currency,
    status: member(row.status, REDEMPTION_STATUSES),
    version: row.version,
    reservedAt: row.reservedAt,
    reservedBy: row.reservedBy,
    settledAt: row.settledAt,
    settledBy: row.settledBy,
    reason: row.reason === null ? null : member(row.reason, REDEMPTION_RELEASE_REASONS),
    correlationId: row.correlationId,
  };
}

function uniqueTarget(
  error: unknown,
  targets: Readonly<Record<string, PromotionUniqueTarget>>,
): PromotionUniqueTarget | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return null;
  const meta = JSON.stringify(error.meta ?? {});
  for (const [index, target] of Object.entries(targets)) if (meta.includes(index)) return target;
  return null;
}

async function revisionsOf(db: Db, code: string): Promise<PromotionRevisionRecord[]> {
  const rows = await db.promotionRevision.findMany({
    where: { promotionCode: code },
    orderBy: { revision: 'asc' },
  });
  return rows.map(toRevision);
}

function toPromotion(row: Prisma.PromotionGetPayload<object>): PromotionRecord {
  return {
    code: row.code,
    couponDigest: row.couponDigest,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

/** Promotion persistence inside one Pricing transaction. */
export class PrismaPromotionUnitOfWork implements PromotionUnitOfWork {
  constructor(protected readonly tx: Tx) {}

  async lockPromotion(code: string): Promise<PromotionRecord | null> {
    const locked = await this.tx.$queryRaw<{ code: string }[]>`
      SELECT code FROM app.promotion WHERE code = ${code} FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.promotion.findUnique({ where: { code } });
    return row ? toPromotion(row) : null;
  }

  async insertPromotion(promotion: PromotionRecord): Promise<void> {
    try {
      await this.tx.promotion.create({ data: { ...promotion } });
    } catch (error: unknown) {
      const target = uniqueTarget(error, { promotion_coupon_digest_key: 'COUPON_CODE' });
      if (target) throw new PromotionUniqueConflict(target);
      throw error;
    }
  }

  promotionRevisions(code: string): Promise<PromotionRevisionRecord[]> {
    return revisionsOf(this.tx, code);
  }

  async insertPromotionRevision(revision: PromotionRevisionRecord): Promise<void> {
    const { discount } = revision.terms;
    await this.tx.promotionRevision.create({
      data: {
        promotionCode: revision.promotionCode,
        revision: revision.revision,
        effectiveFrom: revision.effectiveFrom,
        publishedAt: revision.publishedAt,
        publishedBy: revision.publishedBy,
        correlationId: revision.correlationId,
        discountKind: discount.kind,
        basisPoints: discount.kind === 'PERCENT' ? discount.basisPoints : null,
        maxDiscountMinor: discount.kind === 'PERCENT' ? discount.maxDiscountMinor : null,
        fixedAmountMinor: discount.kind === 'FIXED' ? discount.amountMinor : null,
        currency: revision.terms.currency,
        packageIds: [...revision.terms.packageIds],
        minSubtotalMinor: revision.terms.minSubtotalMinor,
        endsAt: revision.terms.endsAt,
        totalCap: revision.terms.totalCap,
        perCustomerCap: revision.terms.perCustomerCap,
        active: revision.terms.active,
      },
    });
  }

  async promotionByCoupon(couponDigest: string): Promise<PromotionRecord | null> {
    const row = await this.tx.promotion.findUnique({ where: { couponDigest } });
    return row ? toPromotion(row) : null;
  }

  async liveRedemptions(
    code: string,
    customerSubject: string,
  ): Promise<{ total: number; customer: number }> {
    const total = await this.tx.promotionRedemption.count({
      where: { promotionCode: code, liveSlot: 1 },
    });
    const customer = await this.tx.promotionRedemption.count({
      where: { promotionCode: code, liveSlot: 1, customerSubject },
    });
    return { total, customer };
  }

  async redemptionFor(code: string, bookingId: string): Promise<RedemptionRecord | null> {
    const row = await this.tx.promotionRedemption.findUnique({
      where: { promotionCode_bookingId: { promotionCode: code, bookingId } },
    });
    return row ? toRedemption(row) : null;
  }

  async lockRedemption(id: string): Promise<RedemptionRecord | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.promotion_redemption WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.promotionRedemption.findUnique({ where: { id } });
    return row ? toRedemption(row) : null;
  }

  async insertRedemption(redemption: RedemptionRecord): Promise<void> {
    try {
      await this.tx.promotionRedemption.create({ data: { ...redemption, liveSlot: 1 } });
    } catch (error: unknown) {
      const target = uniqueTarget(error, {
        promotion_redemption_live_booking_key: 'LIVE_BOOKING_REDEMPTION',
        promotion_redemption_quote_key: 'QUOTE_REDEEMED',
        promotion_redemption_booking_key: 'REDEMPTION_BOOKING',
      });
      if (target) throw new PromotionUniqueConflict(target);
      throw error;
    }
  }

  async updateRedemption(redemption: RedemptionRecord): Promise<void> {
    await this.tx.promotionRedemption.update({
      where: { id: redemption.id },
      data: {
        status: redemption.status,
        version: redemption.version,
        settledAt: redemption.settledAt,
        settledBy: redemption.settledBy,
        reason: redemption.reason,
        liveSlot: redemption.status === 'RELEASED' ? null : 1,
      },
    });
  }

  async appendPromotionAudit(record: PromotionAuditRecord): Promise<void> {
    await this.tx.promotionAuditEvent.create({
      data: {
        id: record.id,
        occurredAt: record.occurredAt,
        actorKind: record.actor.kind,
        actorId: record.actor.id,
        action: record.action,
        promotionCode: record.promotionCode,
        redemptionId: record.redemptionId,
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

/** Read side of promotions outside a transaction. */
export class PrismaPromotionReader implements PromotionReader {
  constructor(protected readonly client: PrismaClient) {}

  async promotionCodes(limit: number): Promise<string[]> {
    const rows = await this.client.promotion.findMany({
      orderBy: { code: 'asc' },
      take: limit,
      select: { code: true },
    });
    return rows.map((row) => row.code);
  }

  async promotion(code: string): Promise<PromotionRecord | null> {
    const row = await this.client.promotion.findUnique({ where: { code } });
    return row ? toPromotion(row) : null;
  }

  promotionRevisions(code: string): Promise<PromotionRevisionRecord[]> {
    return revisionsOf(this.client, code);
  }

  async promotionUsage(code: string): Promise<PromotionUsage> {
    const groups = await this.client.promotionRedemption.groupBy({
      by: ['status'],
      where: { promotionCode: code },
      _count: { _all: true },
    });
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    return {
      reserved: count('RESERVED'),
      committed: count('COMMITTED'),
      released: count('RELEASED'),
    };
  }

  async redemption(id: string): Promise<RedemptionRecord | null> {
    const row = await this.client.promotionRedemption.findUnique({ where: { id } });
    return row ? toRedemption(row) : null;
  }

  async redemptionsForBooking(bookingId: string): Promise<RedemptionRecord[]> {
    const rows = await this.client.promotionRedemption.findMany({
      where: { bookingId },
      orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRedemption);
  }
}
