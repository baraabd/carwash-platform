import { resolveBookingEntryStep } from './bookingDraft.ts';
import type { CustomerSessionState, SessionTransition } from './customerSession.ts';

/**
 * Commands of the seventh booking step, Review, and of its «تعديل» edit loop.
 * Each one only changes where the customer is in the local, unsent draft:
 * nothing here confirms a booking, creates an order, reserves a time, writes the
 * profile, saves a car or an address, or starts a payment. Confirmation is owned
 * by the booking confirmation sprint and, in production, by the Booking service.
 */

export const PAYMENT_STEP_INDEX = 5;
export const REVIEW_STEP_INDEX = 6;

/** The steps Review can open for editing, in source order: Vehicle … Payment. */
export const REVIEW_EDIT_TARGETS: readonly number[] = Object.freeze([0, 1, 2, 3, 4, 5]);

/**
 * Runtime check of an edit target. The reference clamps `Number(value) || 0`, so a
 * bad value silently opens Vehicle; here only an integer 0–5 is accepted. Strings,
 * fractions, negatives, out-of-range numbers and prototype-derived values are not.
 */
export function isReviewEditTarget(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5;
}

/**
 * «تعديل» on a Review line: open that step in edit mode. The destination is the
 * step itself unless an earlier prerequisite stopped holding at `now` (for example
 * the appointment expired while Review was open); then it is that prerequisite, in
 * one transition, so the customer never passes through a screen that redirects.
 */
export function openReviewEdit(
  state: CustomerSessionState,
  target: unknown,
  now: Date,
): SessionTransition {
  if (!isReviewEditTarget(target)) return { state, intent: null };
  return {
    state: { ...state, reviewEditing: true },
    intent: { kind: 'booking-step', step: resolveBookingEntryStep(state.draft, target, now) },
  };
}

/**
 * Where a successful step submission goes while editing from Review. The step's own
 * validation has already run inside `submitted`; a valid edit returns to Review and
 * leaves edit mode (the reference's `next()`), in the same transition. Review's
 * entry guard is applied at the same `now`: if another prerequisite no longer holds,
 * the customer goes to that step instead of to an invalid summary.
 *
 * A refused submission (no intent) and any submission outside edit mode are
 * returned unchanged, so ordinary sequential navigation is untouched.
 */
export function completeReviewEdit<Submission extends SessionTransition>(
  submitted: Submission,
  now: Date,
): Submission {
  if (!submitted.state.reviewEditing || submitted.intent?.kind !== 'booking-step') {
    return submitted;
  }
  const step = resolveBookingEntryStep(submitted.state.draft, REVIEW_STEP_INDEX, now);
  return {
    ...submitted,
    state: { ...submitted.state, reviewEditing: false, draftStep: step },
    intent: { kind: 'booking-step', step },
  };
}

/**
 * Header Back while editing: return to Review and leave edit mode, keeping every
 * change already made on the step (the reference keeps them too). Unlike the
 * reference, Review's prerequisite guard still applies, so a draft an edit made
 * incomplete goes to the step that owns the missing input.
 */
export function leaveReviewEdit(state: CustomerSessionState, now: Date): SessionTransition {
  return {
    state: { ...state, reviewEditing: false },
    intent: {
      kind: 'booking-step',
      step: resolveBookingEntryStep(state.draft, REVIEW_STEP_INDEX, now),
    },
  };
}

/** Header Back on Review itself: return to Payment. The draft is untouched. */
export function returnToPaymentStep(state: CustomerSessionState): SessionTransition {
  return { state, intent: { kind: 'booking-step', step: PAYMENT_STEP_INDEX } };
}

/**
 * Leave edit mode without moving: browser history (a POP) and any route outside
 * the booking journey end an edit, as the reference's `fromRoute()` and `go()` do.
 */
export function endReviewEdit(state: CustomerSessionState): CustomerSessionState {
  return state.reviewEditing ? { ...state, reviewEditing: false } : state;
}
