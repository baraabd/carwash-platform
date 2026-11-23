import { DispatchError, invalid } from './errors';
import type { OfferState } from './offer';

/**
 * One assignment per booking: who will do the job, separate from the booking
 * lifecycle that Booking owns. Booking never stores a technician; Dispatch
 * never stores customer, address, vehicle or price.
 *
 *   UNASSIGNED -> OFFERED     (operations offered the job to one resource)
 *   OFFERED    -> ASSIGNED    (the technician accepted the live offer)
 *   OFFERED    -> UNASSIGNED  (declined, expired or withdrawn)
 *   ASSIGNED   -> UNASSIGNED  (operations took the job back to reassign it)
 *   any        -> CANCELLED   (the committed slot was released, or Booking
 *                              cancelled the booking; terminal)
 *   UNASSIGNED -> UNASSIGNED  (rebind: Booking is moving the job to a new slot;
 *                              the binding stays unconfirmed until the new
 *                              hold is committed, P04-C2)
 *
 * `version` is the revision exposed to clients and the guard for every update.
 */
export type AssignmentStatus = 'UNASSIGNED' | 'OFFERED' | 'ASSIGNED' | 'CANCELLED';
export type CancelReason = 'HOLD_RELEASED' | 'HOLD_EXPIRED' | 'BOOKING_CANCELLED';

export interface AssignmentState {
  readonly id: string;
  readonly bookingId: string;
  readonly holdId: string;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: AssignmentStatus;
  /** Set exactly when status is ASSIGNED (database CHECK). */
  readonly resourceId: string | null;
  readonly technicianSubject: string | null;
  readonly cancelReason: CancelReason | null;
  /**
   * The Booking change that rebound this job to a hold that is not committed
   * yet. While set, no offer can be made and a release or expiry of the bound
   * hold does not cancel the job (the change will be confirmed or reverted).
   */
  readonly pendingChangeId: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function openAssignment(input: {
  readonly id: string;
  readonly bookingId: string;
  readonly holdId: string;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly now: Date;
}): AssignmentState {
  if (!(input.endsAt.getTime() > input.startsAt.getTime())) {
    throw invalid('The job window must have a positive length.');
  }
  return {
    id: input.id,
    bookingId: input.bookingId,
    holdId: input.holdId,
    zoneId: input.zoneId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: 'UNASSIGNED',
    resourceId: null,
    technicianSubject: null,
    cancelReason: null,
    pendingChangeId: null,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function assertRevision(assignment: AssignmentState, expectedRevision: number): void {
  if (assignment.version !== expectedRevision) {
    throw new DispatchError('REVISION_CONFLICT', 'The assignment changed; refetch it.');
  }
}

export function assertOpen(assignment: AssignmentState): void {
  if (assignment.status === 'CANCELLED') {
    throw new DispatchError('ASSIGNMENT_CANCELLED', 'The assignment was cancelled.');
  }
}

function bump(
  assignment: AssignmentState,
  change: Partial<
    Pick<
      AssignmentState,
      | 'status'
      | 'resourceId'
      | 'technicianSubject'
      | 'cancelReason'
      | 'pendingChangeId'
      | 'holdId'
      | 'startsAt'
      | 'endsAt'
    >
  >,
  now: Date,
): AssignmentState {
  return { ...assignment, ...change, updatedAt: now, version: assignment.version + 1 };
}

export function markOffered(assignment: AssignmentState, now: Date): AssignmentState {
  assertOpen(assignment);
  if (assignment.pendingChangeId !== null) {
    throw new DispatchError('RESCHEDULE_PENDING', 'The job is being moved to another time.');
  }
  if (assignment.status === 'OFFERED') {
    throw new DispatchError('LIVE_OFFER_EXISTS', 'The job already has a live offer.');
  }
  if (assignment.status === 'ASSIGNED') {
    throw new DispatchError('ASSIGNMENT_ALREADY_ASSIGNED', 'The job is already assigned.');
  }
  if (now.getTime() >= assignment.endsAt.getTime()) {
    throw new DispatchError('JOB_WINDOW_PASSED', 'The job window has passed.');
  }
  return bump(assignment, { status: 'OFFERED' }, now);
}

export function markAssigned(
  assignment: AssignmentState,
  offer: OfferState,
  now: Date,
): AssignmentState {
  if (assignment.status !== 'OFFERED' || offer.assignmentId !== assignment.id) {
    throw new DispatchError('OFFER_NOT_LIVE', 'The offer is no longer live.');
  }
  return bump(
    assignment,
    {
      status: 'ASSIGNED',
      resourceId: offer.resourceId,
      technicianSubject: offer.technicianSubject,
    },
    now,
  );
}

/** Back to UNASSIGNED after a decline, expiry, withdrawal or unassignment. */
export function markUnassigned(assignment: AssignmentState, now: Date): AssignmentState {
  assertOpen(assignment);
  if (assignment.status === 'UNASSIGNED') return assignment;
  return bump(assignment, { status: 'UNASSIGNED', resourceId: null, technicianSubject: null }, now);
}

export function cancel(
  assignment: AssignmentState,
  reason: CancelReason,
  now: Date,
): AssignmentState {
  if (assignment.status === 'CANCELLED') return assignment;
  return bump(
    assignment,
    {
      status: 'CANCELLED',
      resourceId: null,
      technicianSubject: null,
      cancelReason: reason,
      pendingChangeId: null,
    },
    now,
  );
}

export interface JobSlot {
  readonly holdId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Booking is moving the job to a new slot (P04-C2). The caller has already
 * withdrawn the offer and ended a not-started task; the job goes back to
 * UNASSIGNED on the new hold and window, unconfirmed until that hold is
 * committed to the booking.
 */
export function rebind(
  assignment: AssignmentState,
  input: JobSlot & { readonly changeId: string; readonly now: Date },
): AssignmentState {
  assertOpen(assignment);
  if (assignment.pendingChangeId !== null) {
    throw new DispatchError('RESCHEDULE_PENDING', 'Another reschedule of this job is pending.');
  }
  if (!(input.endsAt.getTime() > input.startsAt.getTime())) {
    throw invalid('The job window must have a positive length.');
  }
  return bump(
    assignment,
    {
      status: 'UNASSIGNED',
      resourceId: null,
      technicianSubject: null,
      holdId: input.holdId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      pendingChangeId: input.changeId,
    },
    input.now,
  );
}

/** The new hold is committed to the booking: the binding is final. */
export function confirmBinding(
  assignment: AssignmentState,
  changeId: string,
  now: Date,
): AssignmentState {
  if (assignment.pendingChangeId !== changeId) return assignment;
  return bump(assignment, { pendingChangeId: null }, now);
}

/** The new hold could not be committed: back to the original (still committed) slot. */
export function revertBinding(
  assignment: AssignmentState,
  changeId: string,
  original: JobSlot,
  now: Date,
): AssignmentState {
  if (assignment.pendingChangeId !== changeId) return assignment;
  return bump(
    assignment,
    {
      holdId: original.holdId,
      startsAt: original.startsAt,
      endsAt: original.endsAt,
      pendingChangeId: null,
    },
    now,
  );
}
