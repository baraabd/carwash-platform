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

import { parseCashReceiptV1, type CashReceiptV1 } from './custody';

export * from './custody';
export * from './refunds';

/**
 * billing.v1 — owner: Billing service (Lane B).
 *
 * Published by Lane E (P04-E1) from Lane B requests CR-B-01..08
 * (docs/production/B/CONTRACT_REQUEST_E_BILLING.md). The payment, void and cash
 * custody shapes CONFORM to the merged provider (P02-B1 + P03-B1); the refund
 * and provider-notification routes are Lane E's contract-first additions for
 * P04 and have no accepted provider yet. Registry status for the whole
 * contract stays `published-provider-pending`.
 *
 * Money truth:
 *  - choosing a method or reporting a transaction reference NEVER means money
 *    was received; only a MATCHED reconciliation (or an authorised cash
 *    receipt) settles an obligation;
 *  - an outcome that cannot be known is OUTCOME_UNKNOWN, never success;
 *  - a refund is a separate fact with its own outcome; REQUESTED or
 *    OUTCOME_UNKNOWN never means the money went back.
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
    /** Compensation before any payment was reported (booking not confirmed / cancelled unpaid). */
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
    /** Booking saga compensation: void when the booking could not be confirmed or was cancelled unpaid. */
    voidBookingObligation: {
      method: 'POST',
      path: '/booking-obligations/:obligationId/void',
      access: 'service:billing.obligation.write',
      idempotent: true,
    },
    // Cash collection, custody and settlement (CR-B-08, conforms to P03-B1).
    recordCashCollection: {
      method: 'POST',
      path: '/obligations/:obligationId/cash-collections',
      access: 'permission:billing.cash.collect',
      idempotent: true,
    },
    getCashReceipt: { method: 'GET', path: '/cash-receipts/:receiptId', access: 'principal' },
    reverseCashCollection: {
      method: 'POST',
      path: '/cash-receipts/:receiptId/reversal',
      access: 'permission:billing.cash.correct',
      idempotent: true,
    },
    declareHandover: {
      method: 'POST',
      path: '/custody/handovers',
      access: 'permission:billing.cash.collect',
      idempotent: true,
    },
    getHandover: { method: 'GET', path: '/custody/handovers/:handoverId', access: 'principal' },
    cancelHandover: {
      method: 'POST',
      path: '/custody/handovers/:handoverId/cancel',
      access: 'principal',
      idempotent: true,
    },
    receiveHandover: {
      method: 'POST',
      path: '/custody/handovers/:handoverId/treasury-receipt',
      access: 'permission:billing.treasury.receive',
      idempotent: true,
    },
    reconcileHandover: {
      method: 'POST',
      path: '/custody/handovers/:handoverId/reconciliation',
      access: 'permission:billing.reconcile',
      idempotent: true,
    },
    getMyCustody: {
      method: 'GET',
      path: '/custody/holders/me',
      access: 'permission:billing.cash.collect',
    },
    getHolderCustody: {
      method: 'GET',
      path: '/custody/holders/:subject',
      access: 'permission:billing.read',
    },
    getCustodyReconciliation: {
      method: 'GET',
      path: '/custody/reconciliation',
      access: 'permission:billing.read',
    },
    // Refunds (P04, contract-first; no accepted provider yet).
    requestRefund: {
      method: 'POST',
      path: '/obligations/:obligationId/refunds',
      access: 'permission:billing.refund',
      idempotent: true,
    },
    listObligationRefunds: {
      method: 'GET',
      path: '/obligations/:obligationId/refunds',
      access: 'principal',
    },
    getRefund: { method: 'GET', path: '/refunds/:refundId', access: 'permission:billing.read' },
    recordRefundOutcome: {
      method: 'POST',
      path: '/refunds/:refundId/outcome',
      access: 'permission:billing.reconcile',
      idempotent: true,
    },
    // Provider server notifications (P04, contract-first). Signature verified by Billing.
    receiveProviderNotification: {
      method: 'POST',
      path: '/provider-notifications/:provider',
      access: 'provider-signed',
    },
  },
  reasons: [
    'QUOTE_NOT_USABLE',
    'OBLIGATION_ALREADY_EXISTS',
    'AMOUNT_INVALID',
    'CURRENCY_UNSUPPORTED',
    'CURRENCY_MISMATCH',
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
    // Cash custody (P03-B1).
    'COLLECTION_ALREADY_RECORDED',
    'TREASURY_REFERENCE_TAKEN',
    'INTENT_NOT_CASH',
    'WORK_NOT_COMPLETED',
    'COLLECTOR_NOT_ASSIGNED',
    'SELF_COLLECTION_FORBIDDEN',
    'SEPARATION_OF_DUTIES',
    'RECEIPT_ALREADY_REVERSED',
    'RECEIPT_NOT_HELD',
    'HANDOVER_NOT_PENDING',
    'HANDOVER_NOT_RECEIVED',
    'HANDOVER_EMPTY',
    'HANDOVER_TOO_LARGE',
    'HANDOVER_DUPLICATE_RECEIPT',
    'HANDOVER_MIXED_CURRENCY',
    'DECLARED_TOTAL_MISMATCH',
    // Refunds (P04).
    'OBLIGATION_NOT_SETTLED',
    'REFUND_EXCEEDS_REFUNDABLE',
    'REFUND_IN_PROGRESS',
    'REFUND_NOT_OPEN',
    'REFUND_REFERENCE_REQUIRED',
    'REFUND_REFERENCE_NOT_ALLOWED',
    'REFUND_REFERENCE_TAKEN',
    // Provider notifications (P04). The caller learns nothing more than the code.
    'NOTIFICATION_SIGNATURE_INVALID',
    'NOTIFICATION_STALE',
    'NOTIFICATION_PROVIDER_DISABLED',
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

/**
 * Customer-facing summary DERIVED by Billing from server facts only.
 * CASH_COLLECTED: settled by an authorised cash receipt (the customer owes
 * nothing); whether that cash reached the company is a separate custody fact.
 * Refunds do not change this value in v1; read them with listObligationRefunds.
 */
export const FINANCIAL_STATUSES = [
  'UNPAID',
  'AWAITING_CASH',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
  'PAID',
  'CASH_COLLECTED',
  'VOIDED',
] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];

/** Wallet transaction reference as typed by the customer from the wallet app. */
export const PROVIDER_REFERENCE = /^[A-Za-z0-9-]{4,64}$/;
/** Echoed form: an ellipsis and the last four normalized characters, never the full number. */
export const MASKED_REFERENCE = /^…[A-Za-z0-9-]{4}$/;
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
  /** Masked: `…` + last four characters. The full reference never leaves Billing. */
  readonly reference: string;
  readonly claimed: Money;
  readonly submittedAt: UtcTimestamp;
  /** Non-null exactly when Finance recorded an outcome (status is not PENDING_REVIEW). */
  readonly reconciledAt: UtcTimestamp | null;
}

/** Owner-safe cash summary; custody and treasury facts are never shown to the customer. */
export interface CashReceiptSummaryV1 {
  readonly receiptId: string;
  readonly amount: Money;
  readonly collectedAt: UtcTimestamp;
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
  readonly cashReceipt: CashReceiptSummaryV1 | null;
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

export function sameCurrencyMoney(value: unknown, path: string, currency: Currency): Money {
  const parsed = parseNonNegativeMoney(value, path);
  if (parsed.currency !== currency) throw new ContractViolation('CURRENCY_MISMATCH', path);
  return parsed;
}

export function parseMaskedReference(value: unknown, path: string): string {
  return text(value, path, { max: 5, pattern: MASKED_REFERENCE });
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
    reference: parseMaskedReference(v.reference, `${path}.reference`),
    claimed: parseNonNegativeMoney(v.claimed, `${path}.claimed`),
    submittedAt: parseUtc(v.submittedAt, `${path}.submittedAt`),
    reconciledAt,
  };
}

const SETTLED_STATUSES: readonly FinancialStatus[] = ['PAID', 'CASH_COLLECTED'];

/** verified + outstanding = amount (outstanding 0 once voided); settled iff nothing is outstanding. */
function amounts(
  v: Record<string, unknown>,
  path: string,
  status: FinancialStatus,
): { amount: Money; verified: Money; outstanding: Money } {
  const amount = parseNonNegativeMoney(v.amount, `${path}.amount`);
  const verified = sameCurrencyMoney(v.verified, `${path}.verified`, amount.currency);
  const outstanding = sameCurrencyMoney(v.outstanding, `${path}.outstanding`, amount.currency);
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
  const settled = SETTLED_STATUSES.includes(status);
  if (settled !== (status !== 'VOIDED' && outstanding.amountMinor === '0')) {
    throw new ContractViolation('INCONSISTENT_SETTLEMENT', `${path}.financialStatus`);
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

function parseCashReceiptSummary(
  value: unknown,
  path: string,
  currency: Currency,
): CashReceiptSummaryV1 {
  const v = closed(value, path, ['receiptId', 'amount', 'collectedAt']);
  return {
    receiptId: uuid(v.receiptId, `${path}.receiptId`),
    amount: sameCurrencyMoney(v.amount, `${path}.amount`, currency),
    collectedAt: parseUtc(v.collectedAt, `${path}.collectedAt`),
  };
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
    'cashReceipt',
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
  const cashReceipt =
    v.cashReceipt === null
      ? null
      : parseCashReceiptSummary(v.cashReceipt, `${path}.cashReceipt`, money.amount.currency);
  // The financial status is DERIVED from server facts; a mismatch is a provider defect.
  const expected =
    status === 'VOIDED'
      ? 'VOIDED'
      : status === 'SETTLED'
        ? cashReceipt
          ? 'CASH_COLLECTED'
          : 'PAID'
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
    cashReceipt,
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
  const method = v.method === null ? null : oneOf(v.method, `${path}.method`, PAYMENT_METHODS);
  return {
    obligationId: uuid(v.obligationId, `${path}.obligationId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    financialStatus,
    ...amounts(v, path, financialStatus),
    method,
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
      min: 4,
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

/** Response of recordCashCollection and reverseCashCollection. */
export interface CashCollectionResultV1 {
  readonly receipt: CashReceiptV1;
  readonly obligation: FinancialStatusViewV1;
}

export function parseCashCollectionResultV1(value: unknown, path = '$'): CashCollectionResultV1 {
  const v = closed(value, path, ['receipt', 'obligation']);
  const receipt = parseCashReceiptV1(v.receipt, `${path}.receipt`);
  const obligation = parseFinancialStatusViewV1(v.obligation, `${path}.obligation`);
  if (receipt.obligationId !== obligation.obligationId) {
    throw new ContractViolation('FOREIGN_RECEIPT', `${path}.receipt.obligationId`);
  }
  return { receipt, obligation };
}
