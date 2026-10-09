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
 *   any        -> CANCELLED   (the committed slot was released; terminal)
 *
 * `version` is the revision exposed to clients and the guard for every update.
 */
export type AssignmentStatus = 'UNASSIGNED' | 'OFFERED' | 'ASSIGNED' | 'CANCELLED';
export type CancelReason = 'HOLD_RELEASED' | 'HOLD_EXPIRED';

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
    Pick<AssignmentState, 'status' | 'resourceId' | 'technicianSubject' | 'cancelReason'>
  >,
  now: Date,
): AssignmentState {
  return { ...assignment, ...change, updatedAt: now, version: assignment.version + 1 };
}

export function markOffered(assignment: AssignmentState, now: Date): AssignmentState {
  assertOpen(assignment);
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
    { status: 'CANCELLED', resourceId: null, technicianSubject: null, cancelReason: reason },
    now,
  );
}
