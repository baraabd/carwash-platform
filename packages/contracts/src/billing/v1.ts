import type { OwnerContract } from '../common/route';
import {
  addMoney,
  compareMoney,
  parseNonNegativeMoney,
  type Currency,
  type Money,
} from '../common/money';
import { PAYMENT_METHODS, type PaymentMethod } from '../common/payment-method';
import { parsePrincipalRef, type PrincipalRef } from '../common/principal';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import { ContractViolation, closed, list, oneOf, text, uuid } from '../common/wire';

/**
 * billing.v1 — owner: Billing service (Lane B).
 * Published from Lane B request CR-B-01..03 (docs/production/B/CONTRACT_REQUEST_E_BILLING.md)
 * with Lane E conventions: the shared error envelope, owner reasons and
 * structural invariants checked by the parser.
 *
 * One financial obligation per (owner, quote). The customer chooses a method
 * (payment intent). For a wallet method the customer reports the wallet's
 * transaction reference (payment attempt). Only Finance reconciliation, with
 * the observed amount, settles the obligation. A customer action, receipt or
 * reported reference NEVER makes it PAID. A lost reconciliation outcome is
 * OUTCOME_UNKNOWN, never success.
 *
 * Transfer instructions (payee, QR) are not part of v1: no merchant account is
 * configured, and Billing never invents a payee or a QR payload.
 */
export const BILLING_V1 = {
  id: 'billing.v1',
  owner: 'billing',
  prefix: '/internal/v1/billing',
  routes: {
    createObligation: {
      method: 'POST',
      path: '/obligations',
      access: 'principal',
      idempotent: true,
    },
    getObligation: { method: 'GET', path: '/obligations/:obligationId', access: 'principal' },
    getFinancialStatus: {
      method: 'GET',
      path: '/obligations/:obligationId/financial-status',
      access: 'principal',
    },
    initializePayment: {
      method: 'POST',
      path: '/obligations/:obligationId/payment-intents',
      access: 'principal',
      idempotent: true,
    },
    submitAttempt: {
      method: 'POST',
      path: '/obligations/:obligationId/payment-attempts',
      access: 'principal',
      idempotent: true,
    },
    voidObligation: {
      method: 'POST',
      path: '/obligations/:obligationId/void',
      access: 'principal',
      idempotent: true,
    },
    reconcileAttempt: {
      method: 'POST',
      path: '/payment-attempts/:attemptId/reconciliation',
      access: 'permission:billing.reconcile',
      idempotent: true,
    },
    /** Booking saga (CR-B-03.2): create for the booking's beneficiary. */
    createBookingObligation: {
      method: 'POST',
      path: '/booking-obligations',
      access: 'service:billing.obligation.write',
      idempotent: true,
    },
    /** Booking saga compensation: void when the booking could not be confirmed. */
    voidBookingObligation: {
      method: 'POST',
      path: '/booking-obligations/:obligationId/void',
      access: 'service:billing.obligation.write',
      idempotent: true,
    },
  },
  reasons: [
    'QUOTE_NOT_USABLE',
    'OBLIGATION_ALREADY_EXISTS',
    'AMOUNT_INVALID',
    'CURRENCY_UNSUPPORTED',
    'PROVIDER_REFERENCE_TAKEN',
    'OBLIGATION_SETTLED',
    'OBLIGATION_VOIDED',
    'VOID_NOT_ALLOWED',
    'METHOD_UNCHANGED',
    'PAYMENT_IN_REVIEW',
    'NO_ACTIVE_INTENT',
    'INTENT_NOT_ACCEPTING_ATTEMPTS',
    'ATTEMPT_NOT_OPEN',
    'ALREADY_UNKNOWN',
    'ATTEMPT_LIMIT_REACHED',
    'AMOUNT_NOT_EQUAL_OUTSTANDING',
    'OBSERVED_AMOUNT_REQUIRED',
    'OBSERVED_AMOUNT_NOT_ALLOWED',
    'SELF_RECONCILIATION_FORBIDDEN',
  ],
} as const satisfies OwnerContract;

export const OBLIGATION_STATUSES = ['OPEN', 'SETTLED', 'VOIDED'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const INTENT_STATUSES = [
  'AWAITING_CASH_COLLECTION',
  'AWAITING_CUSTOMER_PAYMENT',
  'UNDER_REVIEW',
  'SUCCEEDED',
  'SUPERSEDED',
  'CANCELLED',
] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const ATTEMPT_STATUSES = ['PENDING_REVIEW', 'MATCHED', 'MISMATCHED', 'UNKNOWN'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const RECONCILIATION_OUTCOMES = ['MATCHED', 'MISMATCHED', 'UNKNOWN'] as const;
export type ReconciliationOutcome = (typeof RECONCILIATION_OUTCOMES)[number];

export const FINANCIAL_STATUSES = [
  'UNPAID',
  'AWAITING_CASH',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
  'PAID',
  'VOIDED',
] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];

/** Wallet transaction reference as typed by the customer from the wallet app. */
export const PROVIDER_REFERENCE = /^[A-Za-z0-9-]{4,64}$/;
/** Echoed form: an ellipsis and the last four normalized characters, never the full number. */
const MASKED_REFERENCE = /^…[A-Z0-9]{4}$/;
export const MAX_ATTEMPTS_PER_OBLIGATION = 5;

export interface PaymentIntentV1 {
  readonly intentId: string;
  readonly method: PaymentMethod;
  readonly status: IntentStatus;
  readonly amount: Money;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface PaymentAttemptV1 {
  readonly attemptId: string;
  readonly intentId: string;
  readonly method: PaymentMethod;
  readonly status: AttemptStatus;
  readonly reference: string;
  readonly claimed: Money;
  readonly submittedAt: UtcTimestamp;
  /** Non-null exactly when Finance recorded an outcome (status is not PENDING_REVIEW). */
  readonly reconciledAt: UtcTimestamp | null;
}

export interface ObligationV1 {
  readonly obligationId: string;
  readonly revision: number;
  readonly status: ObligationStatus;
  readonly financialStatus: FinancialStatus;
  readonly quoteId: string;
  readonly amount: Money;
  readonly verified: Money;
  readonly outstanding: Money;
  readonly activeIntent: PaymentIntentV1 | null;
  /** Newest first. */
  readonly attempts: readonly PaymentAttemptV1[];
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface FinancialStatusViewV1 {
  readonly obligationId: string;
  readonly revision: number;
  readonly financialStatus: FinancialStatus;
  readonly amount: Money;
  readonly verified: Money;
  readonly outstanding: Money;
  readonly method: PaymentMethod | null;
}

export interface CreateObligationRequestV1 {
  readonly quoteId: string;
}

export interface CreateBookingObligationRequestV1 {
  readonly beneficiary: PrincipalRef;
  readonly quoteId: string;
  readonly bookingId: string;
}

export interface InitializePaymentRequestV1 {
  readonly expectedRevision: number;
  readonly method: PaymentMethod;
}

export interface SubmitAttemptRequestV1 {
  readonly expectedRevision: number;
  readonly providerReference: string;
}

export interface ReconcileAttemptRequestV1 {
  readonly expectedRevision: number;
  readonly outcome: ReconciliationOutcome;
  /** Required for MATCHED/MISMATCHED (what the statement shows); null for UNKNOWN. */
  readonly observedAmount: Money | null;
}

export interface VoidObligationRequestV1 {
  readonly expectedRevision: number;
}

function sameCurrency(value: unknown, path: string, currency: Currency): Money {
  const parsed = parseNonNegativeMoney(value, path);
  if (parsed.currency !== currency) throw new ContractViolation('CURRENCY_MISMATCH', path);
  return parsed;
}

export function parsePaymentIntentV1(value: unknown, path: string): PaymentIntentV1 {
  const v = closed(value, path, [
    'intentId',
    'method',
    'status',
    'amount',
    'createdAt',
    'updatedAt',
  ]);
  const method = oneOf(v.method, `${path}.method`, PAYMENT_METHODS);
  const status = oneOf(v.status, `${path}.status`, INTENT_STATUSES);
  const cash = method === 'CASH_ON_COMPLETION';
  if (
    (cash && (status === 'AWAITING_CUSTOMER_PAYMENT' || status === 'UNDER_REVIEW')) ||
    (!cash && status === 'AWAITING_CASH_COLLECTION')
  )
    throw new ContractViolation('STATUS_NOT_ALLOWED_FOR_METHOD', `${path}.status`);
  return {
    intentId: uuid(v.intentId, `${path}.intentId`),
    method,
    status,
    amount: parseNonNegativeMoney(v.amount, `${path}.amount`),
    createdAt: parseUtc(v.createdAt, `${path}.createdAt`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

export function parsePaymentAttemptV1(value: unknown, path: string): PaymentAttemptV1 {
  const v = closed(value, path, [
    'attemptId',
    'intentId',
    'method',
    'status',
    'reference',
    'claimed',
    'submittedAt',
    'reconciledAt',
  ]);
  const method = oneOf(v.method, `${path}.method`, PAYMENT_METHODS);
  if (method === 'CASH_ON_COMPLETION') {
    throw new ContractViolation('CASH_HAS_ATTEMPT', `${path}.method`);
  }
  const status = oneOf(v.status, `${path}.status`, ATTEMPT_STATUSES);
  const reconciledAt =
    v.reconciledAt === null ? null : parseUtc(v.reconciledAt, `${path}.reconciledAt`);
  if ((status === 'PENDING_REVIEW') !== (reconciledAt === null)) {
    throw new ContractViolation('INCONSISTENT_RECONCILIATION', `${path}.reconciledAt`);
  }
  return {
    attemptId: uuid(v.attemptId, `${path}.attemptId`),
    intentId: uuid(v.intentId, `${path}.intentId`),
    method,
    status,
    reference: text(v.reference, `${path}.reference`, { max: 5, pattern: MASKED_REFERENCE }),
    claimed: parseNonNegativeMoney(v.claimed, `${path}.claimed`),
    submittedAt: parseUtc(v.submittedAt, `${path}.submittedAt`),
    reconciledAt,
  };
}

/** verified + outstanding = amount (outstanding 0 once voided); PAID iff nothing is outstanding. */
function amounts(
  v: Record<string, unknown>,
  path: string,
  status: FinancialStatus,
): { amount: Money; verified: Money; outstanding: Money } {
  const amount = parseNonNegativeMoney(v.amount, `${path}.amount`);
  const verified = sameCurrency(v.verified, `${path}.verified`, amount.currency);
  const outstanding = sameCurrency(v.outstanding, `${path}.outstanding`, amount.currency);
  if (compareMoney(verified, amount) > 0) {
    throw new ContractViolation('VERIFIED_EXCEEDS_AMOUNT', `${path}.verified`);
  }
  if (status === 'VOIDED') {
    if (outstanding.amountMinor !== '0') {
      throw new ContractViolation('VOIDED_HAS_OUTSTANDING', `${path}.outstanding`);
    }
  } else if (addMoney(verified, outstanding).amountMinor !== amount.amountMinor) {
    throw new ContractViolation('AMOUNTS_DO_NOT_ADD_UP', `${path}.outstanding`);
  }
  if ((status === 'PAID') !== (status !== 'VOIDED' && outstanding.amountMinor === '0')) {
    throw new ContractViolation('INCONSISTENT_PAID', `${path}.financialStatus`);
  }
  return { amount, verified, outstanding };
}

/** The financial status Billing derives for an OPEN obligation. */
function derivedOpenStatus(
  intent: PaymentIntentV1 | null,
  attempts: readonly PaymentAttemptV1[],
): FinancialStatus {
  switch (intent?.status) {
    case 'AWAITING_CASH_COLLECTION':
      return 'AWAITING_CASH';
    case 'AWAITING_CUSTOMER_PAYMENT':
      return 'AWAITING_PAYMENT';
    case 'UNDER_REVIEW':
      return attempts.some((a) => a.status === 'UNKNOWN') ? 'OUTCOME_UNKNOWN' : 'UNDER_REVIEW';
    default:
      return 'UNPAID';
  }
}

export function parseObligationV1(value: unknown, path = '$'): ObligationV1 {
  const v = closed(value, path, [
    'obligationId',
    'revision',
    'status',
    'financialStatus',
    'quoteId',
    'amount',
    'verified',
    'outstanding',
    'activeIntent',
    'attempts',
    'createdAt',
    'updatedAt',
  ]);
  const status = oneOf(v.status, `${path}.status`, OBLIGATION_STATUSES);
  const financialStatus = oneOf(v.financialStatus, `${path}.financialStatus`, FINANCIAL_STATUSES);
  const money = amounts(v, path, financialStatus);
  const activeIntent =
    v.activeIntent === null ? null : parsePaymentIntentV1(v.activeIntent, `${path}.activeIntent`);
  if (activeIntent && activeIntent.amount.currency !== money.amount.currency) {
    throw new ContractViolation('CURRENCY_MISMATCH', `${path}.activeIntent.amount`);
  }
  const attempts = list(v.attempts, `${path}.attempts`, MAX_ATTEMPTS_PER_OBLIGATION, (a, at) =>
    parsePaymentAttemptV1(a, at),
  );
  if (new Set(attempts.map((a) => a.attemptId)).size !== attempts.length) {
    throw new ContractViolation('DUPLICATE_ITEM', `${path}.attempts`);
  }
  for (let i = 1; i < attempts.length; i += 1) {
    const newer = attempts[i - 1];
    const older = attempts[i];
    if (newer && older && Date.parse(newer.submittedAt) < Date.parse(older.submittedAt)) {
      throw new ContractViolation('ATTEMPTS_NOT_NEWEST_FIRST', `${path}.attempts`);
    }
  }
  // The financial status is DERIVED from server facts; a mismatch is a provider defect.
  const expected =
    status === 'VOIDED'
      ? 'VOIDED'
      : status === 'SETTLED'
        ? 'PAID'
        : derivedOpenStatus(activeIntent, attempts);
  if (expected !== financialStatus) {
    throw new ContractViolation('INCONSISTENT_FINANCIAL_STATUS', `${path}.financialStatus`);
  }
  return {
    obligationId: uuid(v.obligationId, `${path}.obligationId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    status,
    financialStatus,
    quoteId: uuid(v.quoteId, `${path}.quoteId`),
    ...money,
    activeIntent,
    attempts,
    createdAt: parseUtc(v.createdAt, `${path}.createdAt`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

export function parseFinancialStatusViewV1(value: unknown, path = '$'): FinancialStatusViewV1 {
  const v = closed(value, path, [
    'obligationId',
    'revision',
    'financialStatus',
    'amount',
    'verified',
    'outstanding',
    'method',
  ]);
  const financialStatus = oneOf(v.financialStatus, `${path}.financialStatus`, FINANCIAL_STATUSES);
  return {
    obligationId: uuid(v.obligationId, `${path}.obligationId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    financialStatus,
    ...amounts(v, path, financialStatus),
    method: v.method === null ? null : oneOf(v.method, `${path}.method`, PAYMENT_METHODS),
  };
}

export function parseCreateObligationRequestV1(value: unknown): CreateObligationRequestV1 {
  const v = closed(value, '$', ['quoteId']);
  return { quoteId: uuid(v.quoteId, '$.quoteId') };
}

export function parseCreateBookingObligationRequestV1(
  value: unknown,
): CreateBookingObligationRequestV1 {
  const v = closed(value, '$', ['beneficiary', 'quoteId', 'bookingId']);
  return {
    beneficiary: parsePrincipalRef(v.beneficiary, '$.beneficiary'),
    quoteId: uuid(v.quoteId, '$.quoteId'),
    bookingId: uuid(v.bookingId, '$.bookingId'),
  };
}

export function parseInitializePaymentRequestV1(value: unknown): InitializePaymentRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'method']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    method: oneOf(v.method, '$.method', PAYMENT_METHODS),
  };
}

export function parseSubmitAttemptRequestV1(value: unknown): SubmitAttemptRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'providerReference']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    providerReference: text(v.providerReference, '$.providerReference', {
      max: 64,
      pattern: PROVIDER_REFERENCE,
    }),
  };
}

export function parseReconcileAttemptRequestV1(value: unknown): ReconcileAttemptRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'outcome', 'observedAmount']);
  const outcome = oneOf(v.outcome, '$.outcome', RECONCILIATION_OUTCOMES);
  if ((outcome === 'UNKNOWN') !== (v.observedAmount === null)) {
    throw new ContractViolation(
      outcome === 'UNKNOWN' ? 'OBSERVED_AMOUNT_NOT_ALLOWED' : 'OBSERVED_AMOUNT_REQUIRED',
      '$.observedAmount',
    );
  }
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    outcome,
    observedAmount:
      v.observedAmount === null
        ? null
        : parseNonNegativeMoney(v.observedAmount, '$.observedAmount'),
  };
}

export function parseVoidObligationRequestV1(value: unknown): VoidObligationRequestV1 {
  const v = closed(value, '$', ['expectedRevision']);
  return { expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision') };
}
