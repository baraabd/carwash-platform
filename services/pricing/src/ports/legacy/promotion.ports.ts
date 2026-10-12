import type {
  PromotionRevisionHead,
  PromotionTerms,
  RedemptionReleaseReason,
  RedemptionStatus,
} from '../../domain/legacy';

export interface PromotionRecord {
  readonly code: string;
  /** SHA-256 of the normalized coupon code; the code itself is never stored. */
  readonly couponDigest: string;
  readonly createdAt: Date;
  readonly createdBy: string;
}

export interface PromotionRevisionRecord extends PromotionRevisionHead {
  readonly promotionCode: string;
  readonly publishedAt: Date;
  readonly publishedBy: string;
  readonly correlationId: string;
  readonly terms: PromotionTerms;
}

/** The promotion component recorded on a quote (a quote is never a redemption). */
export interface QuoteDiscount {
  readonly promotionCode: string;
  readonly promotionRevision: number;
  readonly amountMinor: bigint;
}

export interface RedemptionRecord {
  readonly id: string;
  readonly promotionCode: string;
  /** Revision in force at reservation: its caps were enforced. */
  readonly capsRevision: number;
  readonly quoteId: string;
  readonly bookingId: string;
  readonly customerSubject: string;
  readonly discountMinor: bigint;
  readonly currency: string;
  readonly status: RedemptionStatus;
  readonly version: number;
  readonly reservedAt: Date;
  readonly reservedBy: string;
  readonly settledAt: Date | null;
  readonly settledBy: string | null;
  readonly reason: RedemptionReleaseReason | null;
  readonly correlationId: string;
}

export interface PromotionUsage {
  readonly reserved: number;
  readonly committed: number;
  readonly released: number;
}

export const PROMOTION_AUDIT_ACTIONS = [
  'pricing.promotion.revision-published',
  'pricing.promotion.revision-rejected',
  'pricing.promotion.redemption-reserved',
  'pricing.promotion.redemption-committed',
  'pricing.promotion.redemption-released',
] as const;
export type PromotionAuditAction = (typeof PROMOTION_AUDIT_ACTIONS)[number];

export interface PromotionActor {
  readonly kind: 'account' | 'service';
  readonly id: string;
}

export interface PromotionAuditRecord {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actor: PromotionActor;
  readonly action: PromotionAuditAction;
  readonly promotionCode: string;
  readonly redemptionId: string | null;
  readonly outcome: string;
  readonly correlationId: string;
}

export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly payload: string;
  readonly correlationId: string;
  readonly traceParent: string | null;
  readonly createdAt: Date;
}

export type PromotionUniqueTarget =
  'COUPON_CODE' | 'REDEMPTION_BOOKING' | 'LIVE_BOOKING_REDEMPTION' | 'QUOTE_REDEEMED';

export class PromotionUniqueConflict extends Error {
  constructor(readonly target: PromotionUniqueTarget) {
    super(`UNIQUE_CONFLICT_${target}`);
    this.name = 'PromotionUniqueConflict';
  }
}

export interface PromotionUnitOfWork {
  /** Row-locks the promotion (serialises publishers and redemptions of one promotion). */
  lockPromotion(code: string): Promise<PromotionRecord | null>;
  /** Throws PromotionUniqueConflict('COUPON_CODE') when the coupon belongs to another promotion. */
  insertPromotion(promotion: PromotionRecord): Promise<void>;
  promotionRevisions(code: string): Promise<PromotionRevisionRecord[]>;
  insertPromotionRevision(revision: PromotionRevisionRecord): Promise<void>;
  promotionByCoupon(couponDigest: string): Promise<PromotionRecord | null>;
  /** Live (reserved + committed) redemptions of a promotion, overall and for one customer. */
  liveRedemptions(
    code: string,
    customerSubject: string,
  ): Promise<{ total: number; customer: number }>;
  redemptionFor(code: string, bookingId: string): Promise<RedemptionRecord | null>;
  lockRedemption(id: string): Promise<RedemptionRecord | null>;
  insertRedemption(redemption: RedemptionRecord): Promise<void>;
  updateRedemption(redemption: RedemptionRecord): Promise<void>;
  appendPromotionAudit(record: PromotionAuditRecord): Promise<void>;
  appendOutbox(event: OutboxEvent): Promise<void>;
}

export interface PromotionReader {
  promotionCodes(limit: number): Promise<string[]>;
  promotion(code: string): Promise<PromotionRecord | null>;
  promotionRevisions(code: string): Promise<PromotionRevisionRecord[]>;
  promotionUsage(code: string): Promise<PromotionUsage>;
  redemption(id: string): Promise<RedemptionRecord | null>;
  redemptionsForBooking(bookingId: string): Promise<RedemptionRecord[]>;
}

/** Service-to-service scopes Pricing defines for promotions (deny by default). */
export const PRICING_SERVICE_SCOPES = [
  'pricing.quote.validate',
  'pricing.promotion.redeem',
] as const;
export type PricingServiceScope = (typeof PRICING_SERVICE_SCOPES)[number];

export interface ServiceCallerAuthority {
  authorize(
    clientId: string | undefined,
    token: string | undefined,
    scope: PricingServiceScope,
  ): string | null;
}
