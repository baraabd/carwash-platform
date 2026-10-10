import { asObject, asUuid, exactKeys } from './envelope';
import { parseEnvelopeV2, type EventEnvelopeV2 } from './envelope-v2';

/**
 * Billing integration events (envelope v2, producer `billing`, exchange
 * `washgo.billing.events`, routing key = event type). Published by Lane E in
 * P04-E1 from Lane B requests CR-B-02 and CR-B-08.2; the obligation and cash
 * shapes conform to what the merged Billing provider already writes to its
 * outbox. `billing.refund-status-changed.v1` is Lane E's contract-first
 * addition with no accepted producer yet.
 *
 * Data carries opaque IDs, statuses, closed reason codes and exact minor-unit
 * amounts only: never a provider/treasury/settlement reference, phone, name,
 * receipt image or customer detail. A collected-cash event never means the
 * company holds the money; a refund event in REQUESTED or OUTCOME_UNKNOWN never
 * means the money went back.
 */

export const BILLING_EVENTS_EXCHANGE = 'washgo.billing.events';
const ASYNCAPI = 'docs/asyncapi/billing-events-v1.yaml';

const CURRENCY_SCALE = { SYP: 2, USD: 2 } as const;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;

export interface MoneyData {
  readonly currency: 'SYP' | 'USD';
  readonly amountMinor: string;
  readonly scale: number;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('INVALID_EVENT_DATA');
  return value;
}

/** Exact non-negative money: integer minor units as a string, scale fixed per currency. */
export function asMoney(value: unknown): MoneyData {
  const m = asObject(value);
  exactKeys(m, ['currency', 'amountMinor', 'scale']);
  const currency = oneOf(m.currency, ['SYP', 'USD'] as const);
  if (typeof m.amountMinor !== 'string' || !MINOR.test(m.amountMinor)) {
    throw new Error('INVALID_EVENT_DATA');
  }
  if (m.scale !== CURRENCY_SCALE[currency]) throw new Error('INVALID_EVENT_DATA');
  return { currency, amountMinor: m.amountMinor, scale: CURRENCY_SCALE[currency] };
}

const optionalMoney = (value: unknown): MoneyData | null =>
  value === null ? null : asMoney(value);

function sameCurrency(...values: readonly (MoneyData | null)[]): void {
  const currencies = new Set(values.filter((v) => v !== null).map((v) => v.currency));
  if (currencies.size > 1) throw new Error('INVALID_EVENT_DATA');
}

export const FINANCIAL_STATUSES_V1 = [
  'UNPAID',
  'AWAITING_CASH',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
  'PAID',
  'CASH_COLLECTED',
  'VOIDED',
] as const;
export type FinancialStatusV1 = (typeof FINANCIAL_STATUSES_V1)[number];
export const CUSTODY_STATUSES_V1 = [
  'HELD',
  'IN_HANDOVER',
  'DEPOSITED',
  'SETTLED',
  'REVERSED',
] as const;
export const HANDOVER_STATUSES_V1 = ['PENDING', 'RECEIVED', 'RECONCILED', 'CANCELLED'] as const;
export const REVERSAL_REASONS_V1 = [
  'RECORDED_IN_ERROR',
  'WRONG_BOOKING',
  'AMOUNT_NOT_RECEIVED',
  'DUPLICATE_RECORD',
] as const;
export const REFUND_STATUSES_V1 = ['REQUESTED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'] as const;
export const REFUND_REASONS_V1 = [
  'BOOKING_CANCELLED',
  'SERVICE_NOT_DELIVERED',
  'DUPLICATE_PAYMENT',
  'SERVICE_QUALITY',
  'PRICE_CORRECTION',
] as const;

interface BillingEventSpec<TType extends string, TData> {
  readonly eventType: TType;
  readonly producer: 'billing';
  readonly aggregateType: string;
  readonly asyncApi: string;
  readonly parseData: (data: unknown) => TData;
}

function spec<TType extends string, TData>(
  value: Omit<BillingEventSpec<TType, TData>, 'producer' | 'asyncApi'>,
): BillingEventSpec<TType, TData> & {
  parse(value: unknown): EventEnvelopeV2<TType, 'billing', TData>;
} {
  const full = { ...value, producer: 'billing' as const, asyncApi: ASYNCAPI };
  return { ...full, parse: (event: unknown) => parseEnvelopeV2(event, full, full.parseData) };
}

export const BILLING_OBLIGATION_CREATED_V1 = spec({
  eventType: 'billing.obligation-created.v1',
  aggregateType: 'billing-obligation',
  parseData(data: unknown): {
    readonly quoteId: string;
    readonly amount: MoneyData;
    readonly financialStatus: FinancialStatusV1;
  } {
    const d = asObject(data);
    exactKeys(d, ['quoteId', 'amount', 'financialStatus']);
    return {
      quoteId: asUuid(d.quoteId),
      amount: asMoney(d.amount),
      financialStatus: oneOf(d.financialStatus, FINANCIAL_STATUSES_V1),
    };
  },
});

export const BILLING_OBLIGATION_STATUS_CHANGED_V1 = spec({
  eventType: 'billing.obligation-status-changed.v1',
  aggregateType: 'billing-obligation',
  parseData(data: unknown): {
    readonly previousFinancialStatus: FinancialStatusV1;
    readonly financialStatus: FinancialStatusV1;
    readonly verified: MoneyData;
    readonly outstanding: MoneyData;
  } {
    const d = asObject(data);
    exactKeys(d, ['previousFinancialStatus', 'financialStatus', 'verified', 'outstanding']);
    const previous = oneOf(d.previousFinancialStatus, FINANCIAL_STATUSES_V1);
    const current = oneOf(d.financialStatus, FINANCIAL_STATUSES_V1);
    // Emitted only when the derived status changes.
    if (previous === current) throw new Error('INVALID_EVENT_DATA');
    const verified = asMoney(d.verified);
    const outstanding = asMoney(d.outstanding);
    sameCurrency(verified, outstanding);
    return { previousFinancialStatus: previous, financialStatus: current, verified, outstanding };
  },
});

export const BILLING_CASH_COLLECTED_V1 = spec({
  eventType: 'billing.cash-collected.v1',
  aggregateType: 'billing-cash-receipt',
  parseData(data: unknown): {
    readonly obligationId: string;
    readonly bookingId: string;
    readonly assignmentId: string;
    readonly amount: MoneyData;
    readonly custodyStatus: (typeof CUSTODY_STATUSES_V1)[number];
  } {
    const d = asObject(data);
    exactKeys(d, ['obligationId', 'bookingId', 'assignmentId', 'amount', 'custodyStatus']);
    return {
      obligationId: asUuid(d.obligationId),
      bookingId: asUuid(d.bookingId),
      assignmentId: asUuid(d.assignmentId),
      amount: asMoney(d.amount),
      custodyStatus: oneOf(d.custodyStatus, CUSTODY_STATUSES_V1),
    };
  },
});

export const BILLING_CASH_COLLECTION_REVERSED_V1 = spec({
  eventType: 'billing.cash-collection-reversed.v1',
  aggregateType: 'billing-cash-receipt',
  parseData(data: unknown): {
    readonly obligationId: string;
    readonly bookingId: string;
    readonly amount: MoneyData;
    readonly reason: (typeof REVERSAL_REASONS_V1)[number];
  } {
    const d = asObject(data);
    exactKeys(d, ['obligationId', 'bookingId', 'amount', 'reason']);
    return {
      obligationId: asUuid(d.obligationId),
      bookingId: asUuid(d.bookingId),
      amount: asMoney(d.amount),
      reason: oneOf(d.reason, REVERSAL_REASONS_V1),
    };
  },
});

export const BILLING_CUSTODY_HANDOVER_CHANGED_V1 = spec({
  eventType: 'billing.custody-handover-changed.v1',
  aggregateType: 'billing-custody-handover',
  parseData(data: unknown): {
    readonly holder: string;
    readonly previousStatus: (typeof HANDOVER_STATUSES_V1)[number] | null;
    readonly status: (typeof HANDOVER_STATUSES_V1)[number];
    readonly receiptCount: number;
    readonly declared: MoneyData;
    readonly counted: MoneyData | null;
    readonly shortage: MoneyData | null;
    readonly overage: MoneyData | null;
  } {
    const d = asObject(data);
    exactKeys(d, [
      'holder',
      'previousStatus',
      'status',
      'receiptCount',
      'declared',
      'counted',
      'shortage',
      'overage',
    ]);
    const previous =
      d.previousStatus === null ? null : oneOf(d.previousStatus, HANDOVER_STATUSES_V1);
    const status = oneOf(d.status, HANDOVER_STATUSES_V1);
    if (previous === status) throw new Error('INVALID_EVENT_DATA');
    if (
      typeof d.receiptCount !== 'number' ||
      !Number.isInteger(d.receiptCount) ||
      d.receiptCount < 1 ||
      d.receiptCount > 200
    ) {
      throw new Error('INVALID_EVENT_DATA');
    }
    const declared = asMoney(d.declared);
    const counted = optionalMoney(d.counted);
    const shortage = optionalMoney(d.shortage);
    const overage = optionalMoney(d.overage);
    sameCurrency(declared, counted, shortage, overage);
    return {
      holder: asUuid(d.holder),
      previousStatus: previous,
      status,
      receiptCount: d.receiptCount,
      declared,
      counted,
      shortage,
      overage,
    };
  },
});

export const BILLING_REFUND_STATUS_CHANGED_V1 = spec({
  eventType: 'billing.refund-status-changed.v1',
  aggregateType: 'billing-refund',
  parseData(data: unknown): {
    readonly obligationId: string;
    readonly previousStatus: (typeof REFUND_STATUSES_V1)[number] | null;
    readonly status: (typeof REFUND_STATUSES_V1)[number];
    readonly reason: (typeof REFUND_REASONS_V1)[number];
    readonly amount: MoneyData;
  } {
    const d = asObject(data);
    exactKeys(d, ['obligationId', 'previousStatus', 'status', 'reason', 'amount']);
    const previous = d.previousStatus === null ? null : oneOf(d.previousStatus, REFUND_STATUSES_V1);
    const status = oneOf(d.status, REFUND_STATUSES_V1);
    // Allowed transitions only: null->REQUESTED, REQUESTED->{any outcome},
    // OUTCOME_UNKNOWN->{SUCCEEDED, FAILED}. Terminal states never change.
    const allowed =
      (previous === null && status === 'REQUESTED') ||
      (previous === 'REQUESTED' && status !== 'REQUESTED') ||
      (previous === 'OUTCOME_UNKNOWN' && (status === 'SUCCEEDED' || status === 'FAILED'));
    if (!allowed) throw new Error('INVALID_EVENT_DATA');
    const amount = asMoney(d.amount);
    if (amount.amountMinor === '0') throw new Error('INVALID_EVENT_DATA');
    return {
      obligationId: asUuid(d.obligationId),
      previousStatus: previous,
      status,
      reason: oneOf(d.reason, REFUND_REASONS_V1),
      amount,
    };
  },
});

export const BILLING_EVENTS_V1 = [
  BILLING_OBLIGATION_CREATED_V1,
  BILLING_OBLIGATION_STATUS_CHANGED_V1,
  BILLING_CASH_COLLECTED_V1,
  BILLING_CASH_COLLECTION_REVERSED_V1,
  BILLING_CUSTODY_HANDOVER_CHANGED_V1,
  BILLING_REFUND_STATUS_CHANGED_V1,
] as const;
