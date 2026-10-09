import type { Money } from './money';

/**
 * Billing's financial aggregate: one obligation (what is owed for one priced
 * quote), at most one ACTIVE payment intent (the chosen method, with the amount
 * fixed when it was chosen) and payment attempts (a customer-reported provider
 * reference awaiting reconciliation).
 *
 * The rules that matter most:
 *  - Choosing a method or reporting a transaction number NEVER means money was
 *    received. Only a MATCHED reconciliation increases the verified amount.
 *  - A reconciliation that cannot be decided is UNKNOWN, never success.
 *  - Cash after the wash stays AWAITING_CASH_COLLECTION until an authorised
 *    collection receipt (domain/cash.ts) moves it to SUCCEEDED; custody,
 *    handover and settlement are separate facts after that.
 */
export const PAYMENT_METHODS = ['CASH_ON_COMPLETION', 'SHAM_CASH', 'SYRIATEL_CASH'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const ELECTRONIC_METHODS: readonly PaymentMethod[] = ['SHAM_CASH', 'SYRIATEL_CASH'];

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

export const ACTIVE_INTENT_STATUSES: readonly IntentStatus[] = [
  'AWAITING_CASH_COLLECTION',
  'AWAITING_CUSTOMER_PAYMENT',
  'UNDER_REVIEW',
];
export const OPEN_ATTEMPT_STATUSES: readonly AttemptStatus[] = ['PENDING_REVIEW', 'UNKNOWN'];
/** Bounds abuse of the review queue with guessed transaction numbers. */
export const MAX_ATTEMPTS_PER_OBLIGATION = 5;

export type PaymentRuleCode =
  | 'OBLIGATION_SETTLED'
  | 'OBLIGATION_VOIDED'
  | 'VOID_NOT_ALLOWED'
  | 'METHOD_UNCHANGED'
  | 'PAYMENT_IN_REVIEW'
  | 'NO_ACTIVE_INTENT'
  | 'INTENT_NOT_ACCEPTING_ATTEMPTS'
  | 'ATTEMPT_LIMIT_REACHED'
  | 'ATTEMPT_NOT_OPEN'
  | 'AMOUNT_NOT_EQUAL_OUTSTANDING'
  | 'OBSERVED_AMOUNT_REQUIRED'
  | 'OBSERVED_AMOUNT_NOT_ALLOWED'
  | 'ALREADY_UNKNOWN';

export class PaymentRuleError extends Error {
  constructor(readonly code: PaymentRuleCode) {
    super(code);
    this.name = 'PaymentRuleError';
  }
}

export interface ObligationState {
  readonly amount: Money;
  readonly verified: Money;
  readonly status: ObligationStatus;
}

export interface IntentState {
  readonly method: PaymentMethod;
  readonly status: IntentStatus;
}

export function isElectronic(method: PaymentMethod): boolean {
  return ELECTRONIC_METHODS.includes(method);
}

export function outstanding(obligation: ObligationState): Money {
  return obligation.amount.minus(obligation.verified);
}

function assertOpen(obligation: ObligationState): void {
  if (obligation.status === 'SETTLED') throw new PaymentRuleError('OBLIGATION_SETTLED');
  if (obligation.status === 'VOIDED') throw new PaymentRuleError('OBLIGATION_VOIDED');
}

export function initialIntentStatus(method: PaymentMethod): IntentStatus {
  return isElectronic(method) ? 'AWAITING_CUSTOMER_PAYMENT' : 'AWAITING_CASH_COLLECTION';
}

/**
 * Choosing (or switching) the method. A switch supersedes the current intent,
 * but only while nothing is in flight: once a transaction number is under
 * review, money may already have moved and the method cannot change.
 */
export function planMethodSelection(input: {
  readonly obligation: ObligationState;
  readonly current: IntentState | null;
  readonly method: PaymentMethod;
}): { readonly supersedeCurrent: boolean; readonly status: IntentStatus; readonly amount: Money } {
  assertOpen(input.obligation);
  if (input.current) {
    if (input.current.status === 'UNDER_REVIEW') throw new PaymentRuleError('PAYMENT_IN_REVIEW');
    if (input.current.method === input.method) throw new PaymentRuleError('METHOD_UNCHANGED');
  }
  return {
    supersedeCurrent: input.current !== null,
    status: initialIntentStatus(input.method),
    amount: outstanding(input.obligation),
  };
}

/** Reporting a provider transaction reference moves the intent to review only. */
export function planAttemptSubmission(input: {
  readonly obligation: ObligationState;
  readonly intent: IntentState | null;
  readonly attemptsSoFar: number;
}): void {
  assertOpen(input.obligation);
  if (!input.intent) throw new PaymentRuleError('NO_ACTIVE_INTENT');
  if (input.intent.status !== 'AWAITING_CUSTOMER_PAYMENT' || !isElectronic(input.intent.method))
    throw new PaymentRuleError('INTENT_NOT_ACCEPTING_ATTEMPTS');
  if (input.attemptsSoFar >= MAX_ATTEMPTS_PER_OBLIGATION)
    throw new PaymentRuleError('ATTEMPT_LIMIT_REACHED');
}

export interface ReconciliationPlan {
  readonly attemptStatus: AttemptStatus;
  readonly intentStatus: IntentStatus;
  /** Present only for MATCHED: the exact amount to recognise as received. */
  readonly received: Money | null;
  readonly obligationStatus: ObligationStatus;
}

/**
 * MATCHED requires the observed amount to equal the outstanding amount exactly
 * (no partial or over-payment is silently accepted; a different amount is a
 * MISMATCHED outcome). UNKNOWN keeps the intent under review; an UNKNOWN attempt
 * can later be resolved to MATCHED or MISMATCHED, never back to UNKNOWN.
 */
export function planReconciliation(input: {
  readonly obligation: ObligationState;
  readonly attemptStatus: AttemptStatus;
  readonly outcome: ReconciliationOutcome;
  readonly observed: Money | null;
}): ReconciliationPlan {
  if (!OPEN_ATTEMPT_STATUSES.includes(input.attemptStatus))
    throw new PaymentRuleError('ATTEMPT_NOT_OPEN');
  // An open attempt implies an OPEN obligation (void refuses while any attempt
  // exists, settlement closes the attempt); this is defence in depth.
  assertOpen(input.obligation);
  switch (input.outcome) {
    case 'MATCHED': {
      if (!input.observed) throw new PaymentRuleError('OBSERVED_AMOUNT_REQUIRED');
      const due = outstanding(input.obligation);
      if (due.isZero() || !input.observed.equals(due))
        throw new PaymentRuleError('AMOUNT_NOT_EQUAL_OUTSTANDING');
      return {
        attemptStatus: 'MATCHED',
        intentStatus: 'SUCCEEDED',
        received: input.observed,
        obligationStatus: 'SETTLED',
      };
    }
    case 'MISMATCHED':
      return {
        attemptStatus: 'MISMATCHED',
        intentStatus: 'AWAITING_CUSTOMER_PAYMENT',
        received: null,
        obligationStatus: input.obligation.status,
      };
    case 'UNKNOWN':
      if (input.observed) throw new PaymentRuleError('OBSERVED_AMOUNT_NOT_ALLOWED');
      if (input.attemptStatus === 'UNKNOWN') throw new PaymentRuleError('ALREADY_UNKNOWN');
      return {
        attemptStatus: 'UNKNOWN',
        intentStatus: 'UNDER_REVIEW',
        received: null,
        obligationStatus: input.obligation.status,
      };
  }
}

/**
 * Compensation for a booking that will not happen (saga step). Only an
 * obligation on which no payment was ever reported may be voided: once a
 * transaction number exists money may have moved, and only Finance, through a
 * later refund/adjustment flow (owner decision B-06), may close it.
 */
export function planVoid(input: {
  readonly obligation: ObligationState;
  readonly attemptsSoFar: number;
}): void {
  assertOpen(input.obligation);
  if (input.attemptsSoFar > 0 || !input.obligation.verified.isZero())
    throw new PaymentRuleError('VOID_NOT_ALLOWED');
}

export const FINANCIAL_STATUSES = [
  'VOIDED',
  'PAID',
  /** Settled by an authorised cash collection receipt; company custody is a separate fact. */
  'CASH_COLLECTED',
  'UNPAID',
  'AWAITING_CASH',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];

/**
 * Customer-facing financial summary derived only from server facts. An
 * obligation settled by cash shows CASH_COLLECTED, never PAID: the customer
 * owes nothing, but whether that cash reached the company is a separate
 * custody/settlement fact.
 */
export function financialStatus(input: {
  readonly obligation: ObligationState;
  readonly activeIntent: IntentState | null;
  readonly hasUnknownAttempt: boolean;
  readonly settledByCash: boolean;
}): FinancialStatus {
  if (input.obligation.status === 'VOIDED') return 'VOIDED';
  if (input.obligation.status === 'SETTLED') return input.settledByCash ? 'CASH_COLLECTED' : 'PAID';
  const intent = input.activeIntent;
  if (!intent) return 'UNPAID';
  switch (intent.status) {
    case 'AWAITING_CASH_COLLECTION':
      return 'AWAITING_CASH';
    case 'AWAITING_CUSTOMER_PAYMENT':
      return 'AWAITING_PAYMENT';
    case 'UNDER_REVIEW':
      return input.hasUnknownAttempt ? 'OUTCOME_UNKNOWN' : 'UNDER_REVIEW';
    default:
      return 'UNPAID';
  }
}

export const PROVIDER_REFERENCE = /^[A-Za-z0-9-]{4,64}$/;

/**
 * Provider references are compared case-insensitively and without separators,
 * so "ab-12cd" and "AB12CD" are the same transaction and cannot be claimed twice.
 */
export function normalizeProviderReference(raw: unknown): string | null {
  if (typeof raw !== 'string' || !PROVIDER_REFERENCE.test(raw)) return null;
  const normalized = raw.replaceAll('-', '').toUpperCase();
  return normalized.length >= 4 ? normalized : null;
}

/** Display form: never the full reference, only its last four characters. */
export function maskProviderReference(normalized: string): string {
  return `…${normalized.slice(-4)}`;
}
