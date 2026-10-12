import type { OwnerContract } from '../common/route';
import { parsePrincipalRef, type PrincipalRef } from '../common/principal';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import { ContractViolation, closed, oneOf, text, uuid } from '../common/wire';
import { parseQuoteV1, type QuoteV1 } from '../pricing/v1';

/**
 * promotion.v1 — owner: Pricing service (Lane B), which owns promotions per the
 * service catalog. Contract-first (P05-E1); no accepted provider. Published as
 * its own major beside pricing.v1 so the merged quote provider's surface and
 * status stay unchanged.
 *
 * Separate facts (W07-A-02, B/W07 PROMOTIONS_AND_PRICING_ADMIN):
 *  - ELIGIBILITY is a read. It consumes no quota and may become stale;
 *  - a PROMOTION QUOTE is a new immutable Pricing quote whose DISCOUNT line the
 *    owner computed. The client never submits a discount, percentage or total;
 *  - a RESERVATION holds one use for one Booking and quote. Reserve is not
 *    redeem. REDEEMED is final: cancellation or refund never restores it here;
 *  - UNAVAILABLE (policy/owner cannot decide) is never INELIGIBLE or zero.
 * Eligibility rules, budgets, windows and stacking are approved policy, never
 * fixed by this contract.
 */
export const PROMOTION_V1 = {
  id: 'promotion.v1',
  owner: 'pricing',
  prefix: '/internal/v1/pricing',
  routes: {
    checkEligibility: {
      method: 'POST',
      path: '/promotions/eligibility',
      access: 'principal',
      safe: true,
    },
    createPromotionQuote: {
      method: 'POST',
      path: '/promotion-quotes',
      access: 'principal',
      idempotent: true,
    },
    reservePromotion: {
      method: 'POST',
      path: '/promotion-reservations',
      access: 'service:pricing.promotion.reserve',
      idempotent: true,
    },
    resolvePromotion: {
      method: 'POST',
      path: '/promotion-reservations/:reservationId/resolution',
      access: 'service:pricing.promotion.resolve',
      idempotent: true,
    },
    getPromotionReservation: {
      method: 'GET',
      path: '/promotion-reservations/:reservationId',
      access: 'service:pricing.promotion.read',
    },
  },
  reasons: [
    'PROMOTION_INELIGIBLE',
    'PROMOTION_UNAVAILABLE',
    'PROMOTION_EXHAUSTED',
    'PROMOTION_EXPIRED',
    'PROMOTION_NOT_COMBINABLE',
    'PROMOTION_QUOTE_MISMATCH',
    'PROMOTION_RESERVATION_NOT_ACTIVE',
    'PROMOTION_BOOKING_MISMATCH',
  ],
} as const satisfies OwnerContract;

/** Normalised upper-case code; codes are not authorization and never enumerable. */
export const PROMOTION_CODE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
export const ELIGIBILITY_STATES = ['ELIGIBLE', 'INELIGIBLE', 'UNAVAILABLE'] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];
/** Safe, non-enumerating reasons: never another beneficiary's usage or a campaign counter. */
export const INELIGIBILITY_REASONS = [
  'UNKNOWN_OR_INACTIVE_CODE',
  'NOT_APPLICABLE_TO_SELECTION',
  'USAGE_LIMIT_REACHED',
  'NOT_COMBINABLE',
  'OUTSIDE_VALIDITY',
] as const;
export type IneligibilityReason = (typeof INELIGIBILITY_REASONS)[number];

export function parsePromotionCode(value: unknown, path: string): string {
  return text(value, path, { min: 3, max: 32, pattern: PROMOTION_CODE });
}

export interface PromotionRefV1 {
  readonly promotionId: string;
  readonly version: number;
}

function parsePromotionRef(value: unknown, path: string): PromotionRefV1 {
  const v = closed(value, path, ['promotionId', 'version']);
  return {
    promotionId: uuid(v.promotionId, `${path}.promotionId`),
    version: parseRevision(v.version, `${path}.version`),
  };
}

export interface CheckEligibilityRequestV1 {
  readonly code: string;
  readonly quoteId: string;
}

export function parseCheckEligibilityRequestV1(value: unknown): CheckEligibilityRequestV1 {
  const v = closed(value, '$', ['code', 'quoteId']);
  return { code: parsePromotionCode(v.code, '$.code'), quoteId: uuid(v.quoteId, '$.quoteId') };
}

export interface EligibilityV1 {
  readonly state: EligibilityState;
  /** Non-null exactly when ELIGIBLE. */
  readonly promotion: PromotionRefV1 | null;
  /** Non-null exactly when INELIGIBLE. */
  readonly reason: IneligibilityReason | null;
  readonly quoteId: string;
  readonly evaluatedAt: UtcTimestamp;
}

export function parseEligibilityV1(value: unknown, path = '$'): EligibilityV1 {
  const v = closed(value, path, ['state', 'promotion', 'reason', 'quoteId', 'evaluatedAt']);
  const state = oneOf(v.state, `${path}.state`, ELIGIBILITY_STATES);
  const promotion =
    v.promotion === null ? null : parsePromotionRef(v.promotion, `${path}.promotion`);
  const reason =
    v.reason === null ? null : oneOf(v.reason, `${path}.reason`, INELIGIBILITY_REASONS);
  if ((state === 'ELIGIBLE') !== (promotion !== null))
    throw new ContractViolation('INCONSISTENT_ELIGIBILITY', `${path}.promotion`);
  if ((state === 'INELIGIBLE') !== (reason !== null))
    throw new ContractViolation('INCONSISTENT_ELIGIBILITY', `${path}.reason`);
  return {
    state,
    promotion,
    reason,
    quoteId: uuid(v.quoteId, `${path}.quoteId`),
    evaluatedAt: parseUtc(v.evaluatedAt, `${path}.evaluatedAt`),
  };
}

/** Re-prices `baseQuoteId` with the code. A changed price needs the customer's new consent. */
export interface CreatePromotionQuoteRequestV1 {
  readonly baseQuoteId: string;
  readonly code: string;
}

export function parseCreatePromotionQuoteRequestV1(value: unknown): CreatePromotionQuoteRequestV1 {
  const v = closed(value, '$', ['baseQuoteId', 'code']);
  return {
    baseQuoteId: uuid(v.baseQuoteId, '$.baseQuoteId'),
    code: parsePromotionCode(v.code, '$.code'),
  };
}

export interface PromotionQuoteV1 {
  readonly promotion: PromotionRefV1;
  readonly baseQuoteId: string;
  /** A new immutable quote carrying exactly one DISCOUNT line for this promotion. */
  readonly quote: QuoteV1;
}

export function parsePromotionQuoteV1(value: unknown, path = '$'): PromotionQuoteV1 {
  const v = closed(value, path, ['promotion', 'baseQuoteId', 'quote']);
  const baseQuoteId = uuid(v.baseQuoteId, `${path}.baseQuoteId`);
  const quote = parseQuoteV1(v.quote, `${path}.quote`);
  if (quote.quoteId === baseQuoteId)
    throw new ContractViolation('PROMOTION_QUOTE_NOT_NEW', `${path}.quote.quoteId`);
  if (quote.lines.filter((line) => line.kind === 'DISCOUNT').length !== 1)
    throw new ContractViolation('PROMOTION_DISCOUNT_LINE', `${path}.quote.lines`);
  return { promotion: parsePromotionRef(v.promotion, `${path}.promotion`), baseQuoteId, quote };
}

export const PROMOTION_RESERVATION_STATUSES = [
  'RESERVED',
  'REDEEMED',
  'RELEASED',
  'EXPIRED',
] as const;
export type PromotionReservationStatus = (typeof PROMOTION_RESERVATION_STATUSES)[number];
export const PROMOTION_RESOLUTIONS = ['REDEEM', 'RELEASE'] as const;
export type PromotionResolution = (typeof PROMOTION_RESOLUTIONS)[number];

export interface PromotionReservationV1 {
  readonly reservationId: string;
  readonly revision: number;
  readonly promotion: PromotionRefV1;
  readonly quoteId: string;
  readonly bookingId: string;
  readonly beneficiary: PrincipalRef;
  readonly status: PromotionReservationStatus;
  readonly reservedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  /** Non-null exactly when not RESERVED. */
  readonly resolvedAt: UtcTimestamp | null;
}

export function parsePromotionReservationV1(value: unknown, path = '$'): PromotionReservationV1 {
  const v = closed(value, path, [
    'reservationId',
    'revision',
    'promotion',
    'quoteId',
    'bookingId',
    'beneficiary',
    'status',
    'reservedAt',
    'expiresAt',
    'resolvedAt',
  ]);
  const status = oneOf(v.status, `${path}.status`, PROMOTION_RESERVATION_STATUSES);
  const reservedAt = parseUtc(v.reservedAt, `${path}.reservedAt`);
  const expiresAt = parseUtc(v.expiresAt, `${path}.expiresAt`);
  if (expiresAt <= reservedAt) throw new ContractViolation('INVALID_EXPIRY', `${path}.expiresAt`);
  const resolvedAt = v.resolvedAt === null ? null : parseUtc(v.resolvedAt, `${path}.resolvedAt`);
  if ((status === 'RESERVED') !== (resolvedAt === null))
    throw new ContractViolation('INCONSISTENT_RESOLUTION', `${path}.resolvedAt`);
  return {
    reservationId: uuid(v.reservationId, `${path}.reservationId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    promotion: parsePromotionRef(v.promotion, `${path}.promotion`),
    quoteId: uuid(v.quoteId, `${path}.quoteId`),
    bookingId: uuid(v.bookingId, `${path}.bookingId`),
    beneficiary: parsePrincipalRef(v.beneficiary, `${path}.beneficiary`),
    status,
    reservedAt,
    expiresAt,
    resolvedAt,
  };
}

/** Called by the Booking coordinator; binds one promotion quote to one Booking. */
export interface ReservePromotionRequestV1 {
  readonly promotion: PromotionRefV1;
  readonly quoteId: string;
  readonly bookingId: string;
  readonly beneficiary: PrincipalRef;
}

export function parseReservePromotionRequestV1(value: unknown): ReservePromotionRequestV1 {
  const v = closed(value, '$', ['promotion', 'quoteId', 'bookingId', 'beneficiary']);
  return {
    promotion: parsePromotionRef(v.promotion, '$.promotion'),
    quoteId: uuid(v.quoteId, '$.quoteId'),
    bookingId: uuid(v.bookingId, '$.bookingId'),
    beneficiary: parsePrincipalRef(v.beneficiary, '$.beneficiary'),
  };
}

/** REDEEM at Booking commit; RELEASE as a saga compensation before redemption. */
export interface ResolvePromotionRequestV1 {
  readonly action: PromotionResolution;
  readonly bookingId: string;
}

export function parseResolvePromotionRequestV1(value: unknown): ResolvePromotionRequestV1 {
  const v = closed(value, '$', ['action', 'bookingId']);
  return {
    action: oneOf(v.action, '$.action', PROMOTION_RESOLUTIONS),
    bookingId: uuid(v.bookingId, '$.bookingId'),
  };
}
