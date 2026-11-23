import type { Money } from './money';
import {
  OPEN_ATTEMPT_STATUSES,
  outstanding,
  type AttemptStatus,
  type IntentState,
  type ObligationState,
  type PaymentMethod,
} from './payment';

/**
 * Provider credits: money a payment provider independently says reached one of
 * the company's merchant accounts. A credit is the ONLY fact from which Billing
 * recognises electronic money; a customer's reported reference (an attempt) is
 * a claim that a credit may later be allocated to.
 *
 *  - Received money is never erased: a credit that cannot be allocated (no
 *    claim, closed claim, wrong amount or currency, obligation no longer open)
 *    stays UNALLOCATED and visible until it is allocated to a later matching
 *    claim or refunded.
 *  - A credit recorded from a merchant statement needs a second person's
 *    approval before it counts (PENDING_APPROVAL), so one person can neither
 *    invent nor confirm money alone.
 */
export const PROVIDERS = ['SHAM_CASH', 'SYRIATEL_CASH'] as const satisfies readonly PaymentMethod[];
export type ProviderId = (typeof PROVIDERS)[number];

export const CREDIT_SOURCES = [
  /** Pushed by the provider and authenticated by its adapter. */
  'PROVIDER_NOTIFICATION',
  /** Pulled from the provider by an authenticated, verified query. */
  'PROVIDER_QUERY',
  /** Recorded by Finance from the merchant's own statement, with evidence. */
  'MERCHANT_STATEMENT',
] as const;
export type CreditSource = (typeof CREDIT_SOURCES)[number];

export const CREDIT_STATUSES = [
  'PENDING_APPROVAL',
  'REJECTED',
  'UNALLOCATED',
  'ALLOCATED',
] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];
/** Statuses in which the money is established as received. */
export const CONFIRMED_CREDIT_STATUSES: readonly CreditStatus[] = ['UNALLOCATED', 'ALLOCATED'];

export const UNALLOCATED_REASONS = [
  'NO_CLAIM',
  'CLAIM_CLOSED',
  'OBLIGATION_NOT_OPEN',
  'CURRENCY_MISMATCH',
  'AMOUNT_MISMATCH',
  /** A refund was reserved before a matching claim arrived. */
  'REFUND_RESERVED',
] as const;
export type UnallocatedReason = (typeof UNALLOCATED_REASONS)[number];

export const STATEMENT_REJECTION_REASONS = [
  'NOT_ON_STATEMENT',
  'DETAILS_DIFFER',
  'WRONG_MERCHANT_ACCOUNT',
  'DUPLICATE_ENTRY',
] as const;
export type StatementRejectionReason = (typeof STATEMENT_REJECTION_REASONS)[number];

export type ProviderRuleCode =
  'CREDIT_NOT_PENDING' | 'CREDIT_NOT_CONFIRMED' | 'SEPARATION_OF_DUTIES' | 'OCCURRED_IN_FUTURE';

export class ProviderRuleError extends Error {
  constructor(readonly code: ProviderRuleCode) {
    super(code);
    this.name = 'ProviderRuleError';
  }
}

export interface CreditState {
  readonly provider: ProviderId;
  readonly amount: Money;
  readonly status: CreditStatus;
  readonly recordedBy: string | null;
}

export interface ClaimState {
  readonly id: string;
  readonly intentId: string;
  readonly status: AttemptStatus;
  readonly claimed: Money;
}

export interface IntentClaimState extends IntentState {
  readonly id: string;
}

export type AllocationPlan =
  | { readonly kind: 'ALLOCATE'; readonly received: Money }
  | { readonly kind: 'UNALLOCATED'; readonly reason: UnallocatedReason };

/**
 * Decides whether a confirmed credit settles the claim carrying its reference.
 * Allocation needs an open claim on the active intent of an OPEN obligation, the
 * same currency and EXACTLY the outstanding amount (which is also the claimed
 * amount: the intent fixed it). Anything else leaves the money unallocated with
 * an explicit reason; nothing is partially applied or silently absorbed.
 */
export function planCreditAllocation(input: {
  readonly credit: { readonly amount: Money };
  readonly reservedForRefund: Money | null;
  readonly claim: ClaimState | null;
  readonly obligation: ObligationState | null;
  readonly intent: IntentClaimState | null;
}): AllocationPlan {
  const { credit, claim, obligation, intent } = input;
  if (input.reservedForRefund && !input.reservedForRefund.isZero())
    return { kind: 'UNALLOCATED', reason: 'REFUND_RESERVED' };
  if (!claim || !obligation) return { kind: 'UNALLOCATED', reason: 'NO_CLAIM' };
  if (!OPEN_ATTEMPT_STATUSES.includes(claim.status))
    return { kind: 'UNALLOCATED', reason: 'CLAIM_CLOSED' };
  if (obligation.status !== 'OPEN') return { kind: 'UNALLOCATED', reason: 'OBLIGATION_NOT_OPEN' };
  if (!intent || intent.id !== claim.intentId || intent.status !== 'UNDER_REVIEW')
    return { kind: 'UNALLOCATED', reason: 'CLAIM_CLOSED' };
  const due = outstanding(obligation);
  if (credit.amount.currency !== due.currency)
    return { kind: 'UNALLOCATED', reason: 'CURRENCY_MISMATCH' };
  if (due.isZero() || !credit.amount.equals(due) || !credit.amount.equals(claim.claimed))
    return { kind: 'UNALLOCATED', reason: 'AMOUNT_MISMATCH' };
  return { kind: 'ALLOCATE', received: credit.amount };
}

/** A statement credit is decided by someone other than the person who recorded it. */
export function planStatementDecision(input: {
  readonly credit: CreditState;
  readonly decider: string;
}): void {
  if (input.credit.status !== 'PENDING_APPROVAL') throw new ProviderRuleError('CREDIT_NOT_PENDING');
  if (input.credit.recordedBy === null || input.credit.recordedBy === input.decider)
    throw new ProviderRuleError('SEPARATION_OF_DUTIES');
}

/** A provider cannot report money that arrives after Billing observed it. */
export function assertOccurredBefore(occurredAt: Date, observedAt: Date): void {
  if (occurredAt.getTime() > observedAt.getTime())
    throw new ProviderRuleError('OCCURRED_IN_FUTURE');
}

export const MERCHANT_ACCOUNT = /^[A-Za-z0-9_-]{1,64}$/;
export const EVIDENCE_DIGEST = /^[0-9a-f]{64}$/;
