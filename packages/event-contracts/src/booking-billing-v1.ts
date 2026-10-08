import { asCanonicalUtc, asObject, asUuid, exactKeys } from './envelope';
import { defineBusinessEvent } from './business-v1';

/**
 * Booking and Billing business events (P02, envelope v2). Data carries opaque
 * IDs, the opaque principal reference, schedule instants and exact amounts
 * only: no contact, address, vehicle or plate data, and no proof reference.
 *
 * `booking.confirmed.v2` is the guest-capable successor of the foundation
 * `booking.confirmed.v1` (envelope v1, account-only `customerId`), which stays
 * unchanged for its existing consumers.
 */

const ASYNCAPI = 'docs/asyncapi/business-events-p02.yaml';
const MONEY_MINOR = /^(0|[1-9][0-9]{0,17})$/;
const PAYMENT_METHODS = ['CASH_AFTER_SERVICE', 'SHAM_CASH', 'SYRIATEL_CASH'] as const;
const CURRENCIES = ['SYP', 'USD'] as const;

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('INVALID_EVENT_DATA');
  return value;
}

function minor(value: unknown): string {
  if (typeof value !== 'string' || !MONEY_MINOR.test(value)) throw new Error('INVALID_EVENT_DATA');
  return value;
}

export interface BeneficiaryRef {
  readonly kind: 'account' | 'guest';
  readonly subjectId: string;
}

function beneficiary(value: unknown): BeneficiaryRef {
  const b = asObject(value);
  exactKeys(b, ['kind', 'subjectId']);
  return { kind: oneOf(b.kind, ['account', 'guest'] as const), subjectId: asUuid(b.subjectId) };
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2 ** 31 - 1)
    throw new Error('INVALID_EVENT_DATA');
  return value;
}

export const BOOKING_CONFIRMED_V2 = defineBusinessEvent({
  eventType: 'booking.confirmed.v2',
  producer: 'booking',
  aggregateType: 'booking',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): {
    readonly beneficiary: BeneficiaryRef;
    readonly holdId: string;
    readonly zoneId: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly quoteId: string;
    readonly quoteRevision: number;
    readonly paymentMethod: (typeof PAYMENT_METHODS)[number];
    readonly currency: (typeof CURRENCIES)[number];
    readonly totalMinor: string;
  } {
    const d = asObject(data);
    exactKeys(d, [
      'beneficiary',
      'holdId',
      'zoneId',
      'startsAt',
      'endsAt',
      'quoteId',
      'quoteRevision',
      'paymentMethod',
      'currency',
      'totalMinor',
    ]);
    const startsAt = asCanonicalUtc(d.startsAt);
    const endsAt = asCanonicalUtc(d.endsAt);
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('INVALID_EVENT_DATA');
    return {
      beneficiary: beneficiary(d.beneficiary),
      holdId: asUuid(d.holdId),
      zoneId: asUuid(d.zoneId),
      startsAt,
      endsAt,
      quoteId: asUuid(d.quoteId),
      quoteRevision: revision(d.quoteRevision),
      paymentMethod: oneOf(d.paymentMethod, PAYMENT_METHODS),
      currency: oneOf(d.currency, CURRENCIES),
      totalMinor: minor(d.totalMinor),
    };
  },
});

export const BOOKING_CANCELLED_V1 = defineBusinessEvent({
  eventType: 'booking.cancelled.v1',
  producer: 'booking',
  aggregateType: 'booking',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): {
    readonly beneficiary: BeneficiaryRef;
    readonly holdId: string;
    readonly reason: 'CUSTOMER_REQUEST' | 'OPERATIONS';
    readonly cancelledAt: string;
  } {
    const d = asObject(data);
    exactKeys(d, ['beneficiary', 'holdId', 'reason', 'cancelledAt']);
    return {
      beneficiary: beneficiary(d.beneficiary),
      holdId: asUuid(d.holdId),
      reason: oneOf(d.reason, ['CUSTOMER_REQUEST', 'OPERATIONS'] as const),
      cancelledAt: asCanonicalUtc(d.cancelledAt),
    };
  },
});

const PAYMENT_STATES = [
  'CASH_DUE',
  'CASH_COLLECTED',
  'AWAITING_TRANSFER',
  'AWAITING_REVIEW',
  'PAID',
  'CANCELLED',
] as const;
const CASH_STATES = ['CASH_DUE', 'CASH_COLLECTED', 'CANCELLED'] as const;

export const BILLING_PAYMENT_STATE_CHANGED_V1 = defineBusinessEvent({
  eventType: 'billing.payment-state-changed.v1',
  producer: 'billing',
  aggregateType: 'payment',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): {
    readonly bookingId: string;
    readonly method: (typeof PAYMENT_METHODS)[number];
    readonly state: (typeof PAYMENT_STATES)[number];
    readonly currency: (typeof CURRENCIES)[number];
    readonly amountMinor: string;
  } {
    const d = asObject(data);
    exactKeys(d, ['bookingId', 'method', 'state', 'currency', 'amountMinor']);
    const method = oneOf(d.method, PAYMENT_METHODS);
    const state = oneOf(d.state, PAYMENT_STATES);
    const cash = method === 'CASH_AFTER_SERVICE';
    const cashState = (CASH_STATES as readonly string[]).includes(state);
    if (state !== 'CANCELLED' && cash !== cashState) throw new Error('INVALID_EVENT_DATA');
    return {
      bookingId: asUuid(d.bookingId),
      method,
      state,
      currency: oneOf(d.currency, CURRENCIES),
      amountMinor: minor(d.amountMinor),
    };
  },
});

export const BUSINESS_EVENTS_P02 = [
  BOOKING_CONFIRMED_V2,
  BOOKING_CANCELLED_V1,
  BILLING_PAYMENT_STATE_CHANGED_V1,
] as const;
