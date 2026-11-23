import { AMOUNT_MINOR } from './money';

/**
 * PROMOTIONS (owner decision B-10 is open, so every limit is DATA published by
 * an authorized staff member as an immutable revision; nothing is defaulted):
 *
 * - a promotion is a stable code with exactly one customer-facing coupon code,
 *   stored only as a SHA-256 digest of its normalized form;
 * - revisions take effect at strictly increasing instants and state the
 *   discount (percent in basis points with an optional cap, or a fixed amount),
 *   the currency, eligible packages, the minimum subtotal, an optional end, the
 *   total redemption cap and the per-customer cap, and whether it is active;
 * - a QUOTE applies the promotion deterministically and records the discount
 *   as its own component; a quote is never a redemption;
 * - a REDEMPTION is reserved for one booking (counting against the caps), then
 *   COMMITTED when the booking is confirmed or RELEASED on cancellation/failure.
 *
 * Rounding: a percent discount is floor(subtotal * basisPoints / 10000), so it
 * never exceeds the stated percentage; then it is capped by maxDiscount and by
 * the subtotal (a total never goes below zero).
 */
export const PROMOTION_CODE = /^[a-z][a-z0-9-]{2,40}$/;
export const COUPON_CODE = /^[A-Z0-9]{4,32}$/;
const DEFINITION_ID = /^[a-z][a-z0-9-]{1,47}$/;
export const MAX_ELIGIBLE_PACKAGES = 50;
export const MAX_TOTAL_CAP = 1_000_000;
export const MAX_CUSTOMER_CAP = 100;
export const PROMOTION_ROUNDING = 'FLOOR' as const;

export type PromotionRuleCode =
  'PROMOTION_TERMS_MALFORMED' | 'COUPON_CODE_MALFORMED' | 'PROMOTION_CURRENCY_MISMATCH';

export class PromotionRuleError extends Error {
  constructor(
    readonly code: PromotionRuleCode,
    readonly path: string,
  ) {
    super(code);
    this.name = 'PromotionRuleError';
  }
}

export type Discount =
  | {
      readonly kind: 'PERCENT';
      readonly basisPoints: number;
      readonly maxDiscountMinor: bigint | null;
    }
  | { readonly kind: 'FIXED'; readonly amountMinor: bigint };

export interface PromotionTerms {
  readonly discount: Discount;
  readonly currency: string;
  /** Sorted, unique catalog package ids the promotion applies to. */
  readonly packageIds: readonly string[];
  readonly minSubtotalMinor: bigint;
  /** Exclusive end; null = until a later revision deactivates it. */
  readonly endsAt: Date | null;
  readonly totalCap: number;
  readonly perCustomerCap: number;
  readonly active: boolean;
}

/** Customer input is case-insensitive; storage and lookup use the upper-case form. */
export function normalizeCouponCode(raw: unknown): string {
  if (typeof raw !== 'string') throw new PromotionRuleError('COUPON_CODE_MALFORMED', 'couponCode');
  const code = raw.trim().toUpperCase();
  if (!COUPON_CODE.test(code)) throw new PromotionRuleError('COUPON_CODE_MALFORMED', 'couponCode');
  return code;
}

function closed(raw: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', path);
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== [...keys].sort().join(','))
    throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', path);
  return input;
}

function minor(value: unknown, path: string, positive: boolean): bigint {
  if (typeof value !== 'string' || !AMOUNT_MINOR.test(value))
    throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', path);
  const amount = BigInt(value);
  if (positive && amount === 0n) throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', path);
  return amount;
}

function integerIn(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', path);
  return value;
}

function parseDiscount(raw: unknown): Discount {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', 'discount');
  const kind = (raw as Record<string, unknown>).kind;
  if (kind === 'PERCENT') {
    const d = closed(raw, ['kind', 'basisPoints', 'maxDiscountMinor'], 'discount');
    return {
      kind,
      basisPoints: integerIn(d.basisPoints, 1, 10_000, 'discount.basisPoints'),
      maxDiscountMinor:
        d.maxDiscountMinor === null
          ? null
          : minor(d.maxDiscountMinor, 'discount.maxDiscountMinor', true),
    };
  }
  if (kind === 'FIXED') {
    const d = closed(raw, ['kind', 'amountMinor'], 'discount');
    return { kind, amountMinor: minor(d.amountMinor, 'discount.amountMinor', true) };
  }
  throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', 'discount.kind');
}

const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Strict parse. The currency must be the one prices are published in (B-03
 * policy): a promotion in another currency could never apply and is refused.
 */
export function normalizePromotionTerms(raw: unknown, policyCurrency: string): PromotionTerms {
  const input = closed(
    raw,
    [
      'discount',
      'currency',
      'packageIds',
      'minSubtotalMinor',
      'endsAt',
      'totalCap',
      'perCustomerCap',
      'active',
    ],
    'terms',
  );
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency))
    throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', 'currency');
  if (input.currency !== policyCurrency)
    throw new PromotionRuleError('PROMOTION_CURRENCY_MISMATCH', 'currency');
  if (
    !Array.isArray(input.packageIds) ||
    input.packageIds.length === 0 ||
    input.packageIds.length > MAX_ELIGIBLE_PACKAGES
  )
    throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', 'packageIds');
  const packages = new Set<string>();
  for (const [index, id] of input.packageIds.entries()) {
    if (typeof id !== 'string' || !DEFINITION_ID.test(id) || packages.has(id))
      throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', `packageIds[${index}]`);
    packages.add(id);
  }
  let endsAt: Date | null = null;
  if (input.endsAt !== null) {
    if (typeof input.endsAt !== 'string' || !UTC_MILLIS.test(input.endsAt))
      throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', 'endsAt');
    endsAt = new Date(input.endsAt);
    if (Number.isNaN(endsAt.getTime()) || endsAt.toISOString() !== input.endsAt)
      throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', 'endsAt');
  }
  if (typeof input.active !== 'boolean')
    throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', 'active');
  const totalCap = integerIn(input.totalCap, 1, MAX_TOTAL_CAP, 'totalCap');
  const perCustomerCap = integerIn(input.perCustomerCap, 1, MAX_CUSTOMER_CAP, 'perCustomerCap');
  if (perCustomerCap > totalCap)
    throw new PromotionRuleError('PROMOTION_TERMS_MALFORMED', 'perCustomerCap');
  return {
    discount: parseDiscount(input.discount),
    currency: input.currency,
    packageIds: [...packages].sort(),
    minSubtotalMinor: minor(input.minSubtotalMinor, 'minSubtotalMinor', false),
    endsAt,
    totalCap,
    perCustomerCap,
    active: input.active,
  };
}

export interface PromotionRevisionHead {
  readonly revision: number;
  readonly effectiveFrom: Date;
}

export type PromotionRevisionRejection =
  | 'REVISION_CONFLICT'
  | 'EFFECTIVE_FROM_IN_PAST'
  | 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS'
  | 'EFFECTIVE_FROM_TOO_FAR';

const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/** One linear chain per promotion, optimistic on the expected head revision. */
export function planPromotionRevision(input: {
  readonly head: PromotionRevisionHead | null;
  readonly expectedRevision: number;
  readonly effectiveFrom: Date | null;
  readonly now: Date;
}):
  | { readonly accepted: true; readonly revision: number; readonly effectiveFrom: Date }
  | { readonly accepted: false; readonly reason: PromotionRevisionRejection } {
  const current = input.head?.revision ?? 0;
  if (input.expectedRevision !== current) return { accepted: false, reason: 'REVISION_CONFLICT' };
  const effectiveFrom = input.effectiveFrom ?? input.now;
  if (effectiveFrom.getTime() < input.now.getTime())
    return { accepted: false, reason: 'EFFECTIVE_FROM_IN_PAST' };
  if (effectiveFrom.getTime() - input.now.getTime() > MAX_SCHEDULE_AHEAD_MS)
    return { accepted: false, reason: 'EFFECTIVE_FROM_TOO_FAR' };
  if (input.head && effectiveFrom.getTime() <= input.head.effectiveFrom.getTime())
    return { accepted: false, reason: 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS' };
  return { accepted: true, revision: current + 1, effectiveFrom };
}

/** The revision in force at `at`: the latest whose effectiveFrom <= at. */
export function promotionRevisionInForce<T extends PromotionRevisionHead>(
  revisions: readonly T[],
  at: Date,
): T | null {
  let found: T | null = null;
  for (const revision of revisions)
    if (
      revision.effectiveFrom.getTime() <= at.getTime() &&
      (!found || revision.revision > found.revision)
    )
      found = revision;
  return found;
}

export type IneligibleReason =
  | 'PROMOTION_INACTIVE'
  | 'PROMOTION_ENDED'
  | 'PROMOTION_NOT_STARTED'
  | 'PACKAGE_NOT_ELIGIBLE'
  | 'SUBTOTAL_TOO_LOW'
  | 'PROMOTION_CURRENCY_MISMATCH';

export type Eligibility =
  | { readonly eligible: true; readonly discountMinor: bigint }
  | { readonly eligible: false; readonly reason: IneligibleReason };

/** Exact, deterministic discount for one priced selection. */
export function discountFor(discount: Discount, subtotalMinor: bigint): bigint {
  const raw =
    discount.kind === 'FIXED'
      ? discount.amountMinor
      : (subtotalMinor * BigInt(discount.basisPoints)) / 10_000n;
  const capped =
    discount.kind === 'PERCENT' &&
    discount.maxDiscountMinor !== null &&
    raw > discount.maxDiscountMinor
      ? discount.maxDiscountMinor
      : raw;
  return capped > subtotalMinor ? subtotalMinor : capped;
}

export function evaluatePromotion(input: {
  readonly terms: PromotionTerms | null;
  readonly now: Date;
  readonly packageId: string;
  readonly subtotalMinor: bigint;
  readonly currency: string;
}): Eligibility {
  const { terms } = input;
  if (!terms) return { eligible: false, reason: 'PROMOTION_NOT_STARTED' };
  if (!terms.active) return { eligible: false, reason: 'PROMOTION_INACTIVE' };
  if (terms.endsAt && input.now.getTime() >= terms.endsAt.getTime())
    return { eligible: false, reason: 'PROMOTION_ENDED' };
  if (terms.currency !== input.currency)
    return { eligible: false, reason: 'PROMOTION_CURRENCY_MISMATCH' };
  if (!terms.packageIds.includes(input.packageId))
    return { eligible: false, reason: 'PACKAGE_NOT_ELIGIBLE' };
  if (input.subtotalMinor < terms.minSubtotalMinor)
    return { eligible: false, reason: 'SUBTOTAL_TOO_LOW' };
  const discountMinor = discountFor(terms.discount, input.subtotalMinor);
  // A zero discount (e.g. 1 bp of a tiny subtotal) is not an applied promotion.
  if (discountMinor === 0n) return { eligible: false, reason: 'SUBTOTAL_TOO_LOW' };
  return { eligible: true, discountMinor };
}

export const REDEMPTION_STATUSES = ['RESERVED', 'COMMITTED', 'RELEASED'] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];
export const LIVE_REDEMPTION_STATUSES: readonly RedemptionStatus[] = ['RESERVED', 'COMMITTED'];
export const REDEMPTION_RELEASE_REASONS = [
  'BOOKING_CANCELLED',
  'BOOKING_FAILED',
  'SAGA_COMPENSATION',
] as const;
export type RedemptionReleaseReason = (typeof REDEMPTION_RELEASE_REASONS)[number];

export type CapRejection = 'PROMOTION_EXHAUSTED' | 'CUSTOMER_LIMIT_REACHED';

/** Caps of the revision in force at reservation time; live = reserved + committed. */
export function capCheck(input: {
  readonly terms: PromotionTerms;
  readonly liveTotal: number;
  readonly liveForCustomer: number;
}): CapRejection | null {
  if (input.liveTotal >= input.terms.totalCap) return 'PROMOTION_EXHAUSTED';
  if (input.liveForCustomer >= input.terms.perCustomerCap) return 'CUSTOMER_LIMIT_REACHED';
  return null;
}

export function nextRedemptionStatus(
  current: RedemptionStatus,
  action: 'COMMIT' | 'RELEASE',
): RedemptionStatus | null {
  if (current !== 'RESERVED') return null;
  return action === 'COMMIT' ? 'COMMITTED' : 'RELEASED';
}
