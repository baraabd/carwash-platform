import type { Money } from './money';
import type { CreditStatus } from './provider';

/**
 * Refunds of provider credits.
 *
 *  - A refund is requested against one confirmed credit by Finance, and
 *    approved by a DIFFERENT person before any money moves.
 *  - Every refund that may still move money reserves its amount: the sum of
 *    reserving refunds never exceeds the credit (cumulative cap).
 *  - Execution goes through the provider's refund API only when its adapter
 *    declares that capability; otherwise it is an out-of-band manual transfer
 *    whose completion must carry the transfer reference and evidence digest.
 *  - A timeout or an unreadable provider answer is UNKNOWN, never success, and
 *    the reservation stays until the provider's answer resolves it.
 *  - Only SUCCEEDED posts a journal; the original credit is never edited.
 */
export const REFUND_REASONS = [
  'SERVICE_NOT_DELIVERED',
  'BOOKING_CANCELLED',
  'DUPLICATE_PAYMENT',
  'UNALLOCATABLE_CREDIT',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REFUND_STATUSES = [
  'REQUESTED',
  'REJECTED',
  'APPROVED',
  'SUBMITTED',
  'UNKNOWN',
  'SUCCEEDED',
  'FAILED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
/** Refunds whose amount is held against the credit. */
export const RESERVING_REFUND_STATUSES: readonly RefundStatus[] = [
  'REQUESTED',
  'APPROVED',
  'SUBMITTED',
  'UNKNOWN',
  'SUCCEEDED',
];
/** Refunds whose provider outcome is still open. */
export const PROVIDER_PENDING_REFUND_STATUSES: readonly RefundStatus[] = ['SUBMITTED', 'UNKNOWN'];

export const REFUND_CHANNELS = ['PROVIDER_API', 'MANUAL_OUT_OF_BAND'] as const;
export type RefundChannel = (typeof REFUND_CHANNELS)[number];

/** What a provider (or the manual executor) reports about one refund. */
export const REFUND_PROVIDER_OUTCOMES = ['PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'] as const;
export type RefundProviderOutcome = (typeof REFUND_PROVIDER_OUTCOMES)[number];

/** Reasons allowed for money that settled an obligation vs money that did not. */
const ALLOCATED_REASONS: readonly RefundReason[] = ['SERVICE_NOT_DELIVERED', 'BOOKING_CANCELLED'];
const UNALLOCATED_REFUND_REASONS: readonly RefundReason[] = [
  'DUPLICATE_PAYMENT',
  'UNALLOCATABLE_CREDIT',
];

export type RefundRuleCode =
  | 'CREDIT_NOT_REFUNDABLE'
  | 'REFUND_REASON_NOT_ALLOWED'
  | 'REFUND_CURRENCY_MISMATCH'
  | 'REFUND_EXCEEDS_AVAILABLE'
  | 'REFUND_NOT_REQUESTED'
  | 'REFUND_NOT_EXECUTABLE'
  | 'REFUND_NOT_PENDING_AT_PROVIDER'
  | 'REFUND_CHANNEL_MISMATCH'
  | 'SEPARATION_OF_DUTIES';

export class RefundRuleError extends Error {
  constructor(readonly code: RefundRuleCode) {
    super(code);
    this.name = 'RefundRuleError';
  }
}

export interface RefundState {
  readonly status: RefundStatus;
  readonly channel: RefundChannel;
  readonly requestedBy: string;
}

/** The amount of one credit still available for a new refund. */
export function refundableAmount(credit: { readonly amount: Money }, reserved: Money): Money {
  return credit.amount.minus(reserved);
}

export function planRefundRequest(input: {
  readonly credit: { readonly amount: Money; readonly status: CreditStatus };
  readonly reserved: Money;
  readonly amount: Money;
  readonly reason: RefundReason;
}): void {
  const { credit } = input;
  if (credit.status === 'ALLOCATED') {
    if (!ALLOCATED_REASONS.includes(input.reason))
      throw new RefundRuleError('REFUND_REASON_NOT_ALLOWED');
  } else if (credit.status === 'UNALLOCATED') {
    if (!UNALLOCATED_REFUND_REASONS.includes(input.reason))
      throw new RefundRuleError('REFUND_REASON_NOT_ALLOWED');
  } else {
    throw new RefundRuleError('CREDIT_NOT_REFUNDABLE');
  }
  if (input.amount.currency !== credit.amount.currency)
    throw new RefundRuleError('REFUND_CURRENCY_MISMATCH');
  if (
    input.amount.isZero() ||
    input.amount.amountMinor > refundableAmount(credit, input.reserved).amountMinor
  )
    throw new RefundRuleError('REFUND_EXCEEDS_AVAILABLE');
}

/** Approval or rejection by someone other than the requester. */
export function planRefundDecision(input: {
  readonly refund: RefundState;
  readonly decider: string;
}): void {
  if (input.refund.status !== 'REQUESTED') throw new RefundRuleError('REFUND_NOT_REQUESTED');
  if (input.refund.requestedBy === input.decider) throw new RefundRuleError('SEPARATION_OF_DUTIES');
}

/**
 * Maps a provider answer about an APPROVED (first submission) or provider-
 * pending refund to its next status. PENDING means the provider accepted it
 * and will finish later. An UNKNOWN answer on an already UNKNOWN refund keeps
 * it UNKNOWN (no transition is written).
 */
export function planRefundProviderOutcome(input: {
  readonly refund: RefundState;
  readonly outcome: RefundProviderOutcome;
}): RefundStatus {
  const { refund } = input;
  if (refund.channel !== 'PROVIDER_API') throw new RefundRuleError('REFUND_CHANNEL_MISMATCH');
  if (refund.status !== 'APPROVED' && !PROVIDER_PENDING_REFUND_STATUSES.includes(refund.status))
    throw new RefundRuleError('REFUND_NOT_PENDING_AT_PROVIDER');
  switch (input.outcome) {
    case 'PENDING':
      return 'SUBMITTED';
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    case 'UNKNOWN':
      return refund.status === 'SUBMITTED' ? 'SUBMITTED' : 'UNKNOWN';
  }
}

/**
 * Completion of an out-of-band manual refund: the person recording it cannot
 * be the requester, so the request, the approval and the money-out record
 * always involve at least two people.
 */
export function planManualRefundCompletion(input: {
  readonly refund: RefundState;
  readonly recorder: string;
}): void {
  if (input.refund.channel !== 'MANUAL_OUT_OF_BAND')
    throw new RefundRuleError('REFUND_CHANNEL_MISMATCH');
  if (input.refund.status !== 'APPROVED') throw new RefundRuleError('REFUND_NOT_EXECUTABLE');
  if (input.refund.requestedBy === input.recorder)
    throw new RefundRuleError('SEPARATION_OF_DUTIES');
}
