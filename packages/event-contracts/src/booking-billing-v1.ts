import { asCanonicalUtc, asObject, asUuid, exactKeys } from './envelope';
import { defineBusinessEvent } from './business-v1';

/**
 * Booking and Billing business events (P02, envelope v2). Data carries opaque
 * IDs, the opaque principal reference, schedule instants and exact amounts
 * only: no contact, address, vehicle or plate data, and no provider transaction
 * reference.
 *
 * `booking.confirmed.v2` is the guest-capable successor of the foundation
 * `booking.confirmed.v1` (envelope v1, account-only `customerId`), which stays
 * unchanged for its existing consumers.
 */

const ASYNCAPI = 'docs/asyncapi/business-events-p02.yaml';
const MONEY_MINOR = /^(0|[1-9][0-9]{0,17})$/;
const PAYMENT_METHODS = ['CASH_ON_COMPLETION', 'SHAM_CASH', 'SYRIATEL_CASH'] as const;
/** Currency -> ISO 4217 minor-unit scale; mirrors @carwash/contracts CURRENCIES (tested). */
const CURRENCY_SCALE = { SYP: 2, USD: 2 } as const;
const CURRENCIES = ['SYP', 'USD'] as const;

export interface EventMoney {
  readonly currency: (typeof CURRENCIES)[number];
  readonly amountMinor: string;
  readonly scale: number;
}

/** Non-negative exact money in the shared wire shape {currency, amountMinor, scale}. */
function eventMoney(value: unknown): EventMoney {
  const m = asObject(value);
  exactKeys(m, ['currency', 'amountMinor', 'scale']);
  const currency = oneOf(m.currency, CURRENCIES);
  if (m.scale !== CURRENCY_SCALE[currency]) throw new Error('INVALID_EVENT_DATA');
  return { currency, amountMinor: minor(m.amountMinor), scale: CURRENCY_SCALE[currency] };
}

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
    readonly obligationId: string;
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
      'obligationId',
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
      obligationId: asUuid(d.obligationId),
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

const FINANCIAL_STATUSES = [
  'UNPAID',
  'AWAITING_CASH',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
  'PAID',
  'VOIDED',
] as const;
type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];

/** Published from Lane B request CR-B-02. Aggregate version = obligation revision. */
export const BILLING_OBLIGATION_CREATED_V1 = defineBusinessEvent({
  eventType: 'billing.obligation-created.v1',
  producer: 'billing',
  aggregateType: 'billing-obligation',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): {
    readonly quoteId: string;
    readonly amount: EventMoney;
    readonly financialStatus: FinancialStatus;
  } {
    const d = asObject(data);
    exactKeys(d, ['quoteId', 'amount', 'financialStatus']);
    return {
      quoteId: asUuid(d.quoteId),
      amount: eventMoney(d.amount),
      financialStatus: oneOf(d.financialStatus, FINANCIAL_STATUSES),
    };
  },
});

/** Emitted only when the derived financial status changes (previous !== current). */
export const BILLING_OBLIGATION_STATUS_CHANGED_V1 = defineBusinessEvent({
  eventType: 'billing.obligation-status-changed.v1',
  producer: 'billing',
  aggregateType: 'billing-obligation',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): {
    readonly previousFinancialStatus: FinancialStatus;
    readonly financialStatus: FinancialStatus;
    readonly verified: EventMoney;
    readonly outstanding: EventMoney;
  } {
    const d = asObject(data);
    exactKeys(d, ['previousFinancialStatus', 'financialStatus', 'verified', 'outstanding']);
    const previous = oneOf(d.previousFinancialStatus, FINANCIAL_STATUSES);
    const current = oneOf(d.financialStatus, FINANCIAL_STATUSES);
    const verified = eventMoney(d.verified);
    const outstanding = eventMoney(d.outstanding);
    if (previous === current || verified.currency !== outstanding.currency)
      throw new Error('INVALID_EVENT_DATA');
    if ((current === 'PAID') !== (outstanding.amountMinor === '0' && current !== 'VOIDED'))
      throw new Error('INVALID_EVENT_DATA');
    return { previousFinancialStatus: previous, financialStatus: current, verified, outstanding };
  },
});

export const BUSINESS_EVENTS_P02 = [
  BOOKING_CONFIRMED_V2,
  BOOKING_CANCELLED_V1,
  BILLING_OBLIGATION_CREATED_V1,
  BILLING_OBLIGATION_STATUS_CHANGED_V1,
] as const;
