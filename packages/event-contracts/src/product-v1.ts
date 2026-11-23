import { asObject, asUuid, exactKeys } from './envelope';
import { parseEnvelopeV2, type EventEnvelopeV2, type EventProducer } from './envelope-v2';

/**
 * Advanced product events (envelope v2), published by Lane E in P05-E1:
 * subscription, promotion (Pricing), support cases and reviews. Exchange per
 * producer: `<producer>.events`, routing key = event type.
 *
 * Data is closed and carries opaque IDs, statuses, closed codes and counts
 * only. Never: a review comment, case summary/note, phone, name, address,
 * plate, promotion code or provider reference.
 * Support events conform to the merged provider (PR #126), which writes them to
 * its outbox (no relay runs yet); every other event has no accepted producer yet.
 */

const ASYNCAPI = 'docs/asyncapi/product-events-v1.yaml';

export const PRODUCT_EVENT_EXCHANGES = {
  subscription: 'subscription.events',
  pricing: 'pricing.events',
  support: 'support.events',
  reviews: 'reviews.events',
} as const;

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('INVALID_EVENT_DATA');
  return value;
}

function count(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new Error('INVALID_EVENT_DATA');
  return value;
}

function nullable<T>(value: unknown, parse: (v: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

interface ProductEventSpec<TType extends string, TProducer extends EventProducer, TData> {
  readonly eventType: TType;
  readonly producer: TProducer;
  readonly aggregateType: string;
  readonly parseData: (data: unknown) => TData;
}

function spec<TType extends string, TProducer extends EventProducer, TData>(
  value: ProductEventSpec<TType, TProducer, TData>,
) {
  const full = { ...value, asyncApi: ASYNCAPI };
  return {
    ...full,
    parse: (event: unknown): EventEnvelopeV2<TType, TProducer, TData> =>
      parseEnvelopeV2(event, full, full.parseData),
  };
}

/** A status-change event never repeats a status and never moves out of a terminal one. */
function transition<const T extends readonly string[]>(
  previous: unknown,
  current: unknown,
  allowed: T,
  terminal: readonly T[number][],
): { previous: T[number] | null; current: T[number] } {
  const p = nullable(previous, (v) => oneOf(v, allowed));
  const c = oneOf(current, allowed);
  if (p === c || (p !== null && terminal.includes(p))) throw new Error('INVALID_EVENT_DATA');
  return { previous: p, current: c };
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

const PURCHASE_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_UNDER_REVIEW',
  'PAYMENT_UNKNOWN',
  'ACTIVATED',
  'REJECTED',
  'EXPIRED',
] as const;
const SUBSCRIPTION_STATUSES = ['ACTIVE', 'FROZEN', 'EXHAUSTED', 'EXPIRED', 'CANCELLED'] as const;
const RESERVATION_STATUSES = ['RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED'] as const;

export const SUBSCRIPTION_PURCHASE_STATUS_CHANGED_V1 = spec({
  eventType: 'subscription.purchase-status-changed.v1',
  producer: 'subscription',
  aggregateType: 'subscription-purchase',
  parseData(data: unknown) {
    const d = asObject(data);
    exactKeys(d, [
      'planId',
      'planVersion',
      'previousStatus',
      'status',
      'obligationId',
      'subscriptionId',
    ]);
    const { previous, current } = transition(d.previousStatus, d.status, PURCHASE_STATUSES, [
      'ACTIVATED',
      'REJECTED',
      'EXPIRED',
    ]);
    const subscriptionId = nullable(d.subscriptionId, asUuid);
    if ((current === 'ACTIVATED') !== (subscriptionId !== null))
      throw new Error('INVALID_EVENT_DATA');
    return {
      planId: asUuid(d.planId),
      planVersion: count(d.planVersion, 2_147_483_647),
      previousStatus: previous,
      status: current,
      obligationId: nullable(d.obligationId, asUuid),
      subscriptionId,
    };
  },
});

export const SUBSCRIPTION_CHANGED_V1 = spec({
  eventType: 'subscription.subscription-changed.v1',
  producer: 'subscription',
  aggregateType: 'subscription',
  parseData(data: unknown) {
    const d = asObject(data);
    exactKeys(d, ['previousStatus', 'status', 'unitsTotal', 'unitsReserved', 'unitsConsumed']);
    const previous = nullable(d.previousStatus, (v) => oneOf(v, SUBSCRIPTION_STATUSES));
    const status = oneOf(d.status, SUBSCRIPTION_STATUSES);
    const total = count(d.unitsTotal, 1000);
    const reserved = count(d.unitsReserved, 1000);
    const consumed = count(d.unitsConsumed, 1000);
    if (total < 1 || reserved + consumed > total) throw new Error('INVALID_EVENT_DATA');
    if ((status === 'EXHAUSTED') !== (consumed === total)) throw new Error('INVALID_EVENT_DATA');
    // A unit movement without a status change is still a change (same status allowed).
    if (previous === 'CANCELLED' || previous === 'EXPIRED') throw new Error('INVALID_EVENT_DATA');
    return {
      previousStatus: previous,
      status,
      unitsTotal: total,
      unitsReserved: reserved,
      unitsConsumed: consumed,
    };
  },
});

export const SUBSCRIPTION_ENTITLEMENT_RESERVATION_CHANGED_V1 = spec({
  eventType: 'subscription.entitlement-reservation-changed.v1',
  producer: 'subscription',
  aggregateType: 'subscription-entitlement-reservation',
  parseData(data: unknown) {
    const d = asObject(data);
    exactKeys(d, ['subscriptionId', 'bookingId', 'previousStatus', 'status']);
    const { previous, current } = transition(d.previousStatus, d.status, RESERVATION_STATUSES, [
      'CONSUMED',
      'RELEASED',
      'EXPIRED',
    ]);
    if ((previous === null) !== (current === 'RESERVED')) throw new Error('INVALID_EVENT_DATA');
    return {
      subscriptionId: asUuid(d.subscriptionId),
      bookingId: asUuid(d.bookingId),
      previousStatus: previous,
      status: current,
    };
  },
});

// ---------------------------------------------------------------------------
// Promotion (producer: pricing)
// ---------------------------------------------------------------------------

const PROMOTION_RESERVATION_STATUSES = ['RESERVED', 'REDEEMED', 'RELEASED', 'EXPIRED'] as const;

export const PRICING_PROMOTION_RESERVATION_CHANGED_V1 = spec({
  eventType: 'pricing.promotion-reservation-changed.v1',
  producer: 'pricing',
  aggregateType: 'pricing-promotion-reservation',
  parseData(data: unknown) {
    const d = asObject(data);
    exactKeys(d, [
      'promotionId',
      'promotionVersion',
      'quoteId',
      'bookingId',
      'previousStatus',
      'status',
    ]);
    const { previous, current } = transition(
      d.previousStatus,
      d.status,
      PROMOTION_RESERVATION_STATUSES,
      ['REDEEMED', 'RELEASED', 'EXPIRED'],
    );
    if ((previous === null) !== (current === 'RESERVED')) throw new Error('INVALID_EVENT_DATA');
    return {
      promotionId: asUuid(d.promotionId),
      promotionVersion: count(d.promotionVersion, 2_147_483_647),
      quoteId: asUuid(d.quoteId),
      bookingId: asUuid(d.bookingId),
      previousStatus: previous,
      status: current,
    };
  },
});

// ---------------------------------------------------------------------------
// Support (conforms to PR #126 services/support/src/application/events.ts)
// ---------------------------------------------------------------------------

const CASE_KINDS = [
  'PAYMENT_REVIEW',
  'REFUND',
  'LATE_PAYMENT',
  'BOOKING_CANCELLATION',
  'BOOKING_RESCHEDULE',
] as const;
const CASE_STATUSES = [
  'OPEN',
  'AWAITING_APPROVAL',
  'EXECUTING',
  'OUTCOME_UNKNOWN',
  'BLOCKED_ON_OWNER',
  'OWNER_REJECTED',
  'RESOLVED',
  'CLOSED',
] as const;
const SUBJECT_TYPES = ['billing.payment-attempt', 'billing.obligation', 'booking'] as const;
const CASE_ACTIONS = [
  'APPROVE_MATCH',
  'REJECT_MISMATCH',
  'MARK_UNKNOWN',
  'ACCEPT_LATE_PAYMENT',
  'REFUND',
  'CANCEL_BOOKING',
  'RESCHEDULE_BOOKING',
  'DISMISS',
] as const;

export const SUPPORT_CASE_OPENED_V1 = spec({
  eventType: 'support.case-opened.v1',
  producer: 'support',
  aggregateType: 'support-case',
  parseData(data: unknown) {
    const d = asObject(data);
    exactKeys(d, ['kind', 'subjectType', 'subjectId', 'status']);
    return {
      kind: oneOf(d.kind, CASE_KINDS),
      subjectType: oneOf(d.subjectType, SUBJECT_TYPES),
      subjectId: asUuid(d.subjectId),
      status: oneOf(d.status, CASE_STATUSES),
    };
  },
});

export const SUPPORT_CASE_STATUS_CHANGED_V1 = spec({
  eventType: 'support.case-status-changed.v1',
  producer: 'support',
  aggregateType: 'support-case',
  parseData(data: unknown) {
    const d = asObject(data);
    exactKeys(d, ['kind', 'previousStatus', 'status', 'decisionNo', 'action']);
    const previousStatus = oneOf(d.previousStatus, CASE_STATUSES);
    const status = oneOf(d.status, CASE_STATUSES);
    if (previousStatus === status) throw new Error('INVALID_EVENT_DATA');
    const decisionNo = nullable(d.decisionNo, (v) => {
      const n = count(v, 999_999);
      if (n < 1) throw new Error('INVALID_EVENT_DATA');
      return n;
    });
    return {
      kind: oneOf(d.kind, CASE_KINDS),
      previousStatus,
      status,
      decisionNo,
      action: nullable(d.action, (v) => oneOf(v, CASE_ACTIONS)),
    };
  },
});

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

const REVIEW_STATUSES = [
  'PENDING_MODERATION',
  'PRIVATE',
  'PUBLISHED',
  'REJECTED',
  'HIDDEN',
] as const;

export const REVIEWS_REVIEW_STATUS_CHANGED_V1 = spec({
  eventType: 'reviews.review-status-changed.v1',
  producer: 'reviews',
  aggregateType: 'review',
  parseData(data: unknown) {
    const d = asObject(data);
    exactKeys(d, ['bookingId', 'rating', 'previousStatus', 'status']);
    const previous = nullable(d.previousStatus, (v) => oneOf(v, REVIEW_STATUSES));
    const status = oneOf(d.status, REVIEW_STATUSES);
    if (previous === status) throw new Error('INVALID_EVENT_DATA');
    // A review is born PENDING_MODERATION or PRIVATE; consent never flips afterwards here.
    if (previous === null && status !== 'PENDING_MODERATION' && status !== 'PRIVATE')
      throw new Error('INVALID_EVENT_DATA');
    if (previous === 'PRIVATE' || (previous !== null && status === 'PRIVATE'))
      throw new Error('INVALID_EVENT_DATA');
    const rating = count(d.rating, 5);
    if (rating < 1) throw new Error('INVALID_EVENT_DATA');
    return { bookingId: asUuid(d.bookingId), rating, previousStatus: previous, status };
  },
});

export const PRODUCT_EVENTS_V1 = [
  SUBSCRIPTION_PURCHASE_STATUS_CHANGED_V1,
  SUBSCRIPTION_CHANGED_V1,
  SUBSCRIPTION_ENTITLEMENT_RESERVATION_CHANGED_V1,
  PRICING_PROMOTION_RESERVATION_CHANGED_V1,
  SUPPORT_CASE_OPENED_V1,
  SUPPORT_CASE_STATUS_CHANGED_V1,
  REVIEWS_REVIEW_STATUS_CHANGED_V1,
] as const;
