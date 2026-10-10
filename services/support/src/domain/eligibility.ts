import type { CaseAction, CaseKind, ExactAmount } from './case';

/**
 * Whether the owner's CURRENT state makes a case of this kind meaningful.
 * These are Support's own intake rules over the owner's answer; the owner
 * still enforces its own rules when a decision is carried out.
 */
export type IneligibleReason = 'ATTEMPT_NOT_UNDER_REVIEW' | 'NOTHING_RECEIVED' | 'BOOKING_FINISHED';

/** Attempts that still await a finance answer in Billing. */
const OPEN_ATTEMPTS = ['PENDING_REVIEW', 'UNKNOWN'];
/** Bookings that can still be cancelled or moved by operations. */
const CHANGEABLE_BOOKINGS = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
];
const RESCHEDULABLE_BOOKINGS = ['PENDING_CONFIRMATION', 'CONFIRMED', 'ASSIGNED'];

export function paymentEligibility(
  kind: CaseKind,
  input: { readonly attemptStatus: string | null; readonly verified: ExactAmount },
): IneligibleReason | null {
  if (kind === 'PAYMENT_REVIEW' && !OPEN_ATTEMPTS.includes(input.attemptStatus ?? ''))
    return 'ATTEMPT_NOT_UNDER_REVIEW';
  if (kind === 'REFUND' && input.verified.amountMinor === '0') return 'NOTHING_RECEIVED';
  return null;
}

export function bookingEligibility(kind: CaseKind, status: string): IneligibleReason | null {
  const allowed = kind === 'BOOKING_RESCHEDULE' ? RESCHEDULABLE_BOOKINGS : CHANGEABLE_BOOKINGS;
  return allowed.includes(status) ? null : 'BOOKING_FINISHED';
}

/** The Billing reconciliation outcome a finance action asks for. */
export function reconciliationOutcome(action: CaseAction): 'MATCHED' | 'MISMATCHED' | 'UNKNOWN' {
  switch (action) {
    case 'APPROVE_MATCH':
    case 'ACCEPT_LATE_PAYMENT':
      return 'MATCHED';
    case 'REJECT_MISMATCH':
      return 'MISMATCHED';
    case 'MARK_UNKNOWN':
      return 'UNKNOWN';
    default:
      throw new Error('NOT_A_RECONCILIATION_ACTION');
  }
}
