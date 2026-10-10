import { BookingError, isUuid, type Booking, type BookingStatus } from '../domain';
import type {
  Actor,
  AssignmentVerifier,
  BookingStore,
  CurrentAssignee,
  Observer,
  RequestMeta,
} from '../ports';

/**
 * Technician read of a booking (REQUESTED booking.v1 addition, P03-C3).
 *
 * Purpose limitation: the technician who currently holds the job may read what
 * is needed to do it (slot, vehicle, address, contact, lines, total, payment
 * method), and nobody else may use this route. Who holds the job is Dispatch's
 * fact, so it is asked synchronously on every request and never cached here:
 *   - Dispatch says ASSIGNED to the caller            -> allowed;
 *   - anything else (other technician, OFFERED, UNASSIGNED, CANCELLED, no job)
 *     and bookings a technician does not work on       -> 404 BOOKING_NOT_FOUND;
 *   - Dispatch's answer is unknown                     -> 503 ASSIGNMENT_UNVERIFIED.
 * Dispatch is asked BEFORE the booking is read, so a 404 and a 503 never
 * reveal whether a booking id exists. Every successful read is audited before
 * the view is returned; a read that cannot be audited is not served.
 */
export const TECHNICIAN_READ_PERMISSION = 'work.read:assigned';
export const TECHNICIAN_VIEW_AUDIT_ACTION = 'booking.technician-view.read';

/** Statuses in which an assigned technician works on, or closes, the job. */
export const TECHNICIAN_VISIBLE_STATUSES: readonly BookingStatus[] = [
  'CONFIRMED',
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
];

export type AccessDecision =
  | { readonly kind: 'ALLOW' }
  | {
      readonly kind: 'DENY';
      readonly reason:
        'NO_JOB' | 'NOT_ASSIGNED' | 'OTHER_TECHNICIAN' | 'NO_BOOKING' | 'STATUS_NOT_VISIBLE';
    };

/** Pure decision on Dispatch's answer alone (the booking is not read yet). */
export function decideAssignment(
  subject: string,
  assignee: CurrentAssignee | 'NOT_FOUND',
): AccessDecision {
  if (assignee === 'NOT_FOUND') return { kind: 'DENY', reason: 'NO_JOB' };
  if (assignee.status !== 'ASSIGNED' || assignee.technicianSubjectId === null) {
    return { kind: 'DENY', reason: 'NOT_ASSIGNED' };
  }
  if (assignee.technicianSubjectId.toLowerCase() !== subject.toLowerCase()) {
    return { kind: 'DENY', reason: 'OTHER_TECHNICIAN' };
  }
  return { kind: 'ALLOW' };
}

/** Pure decision on the booking once Dispatch allowed the caller. */
export function decideBooking(booking: Booking | null): AccessDecision {
  if (booking === null) return { kind: 'DENY', reason: 'NO_BOOKING' };
  if (!TECHNICIAN_VISIBLE_STATUSES.includes(booking.status)) {
    return { kind: 'DENY', reason: 'STATUS_NOT_VISIBLE' };
  }
  return { kind: 'ALLOW' };
}

export interface TechnicianViewDeps {
  readonly store: Pick<BookingStore, 'find' | 'recordAudit'>;
  readonly assignments: AssignmentVerifier;
  readonly observer: Observer;
}

function requireTechnician(actor: Actor): string {
  if (actor.kind !== 'USER' || !actor.permissions.includes(TECHNICIAN_READ_PERMISSION)) {
    throw new BookingError('FORBIDDEN', 'The operation is not allowed.');
  }
  return actor.subject;
}

function notFound(): BookingError {
  // One error for every denial: the caller cannot tell which rule refused it.
  return new BookingError('BOOKING_NOT_FOUND', 'Booking not found.', 'BOOKING_NOT_FOUND');
}

export class TechnicianViewQuery {
  constructor(private readonly deps: TechnicianViewDeps) {}

  async read(meta: RequestMeta, bookingId: string): Promise<Booking> {
    const subject = requireTechnician(meta.actor);
    if (!isUuid(bookingId)) throw notFound();
    const id = bookingId.toLowerCase();

    let assignee: CurrentAssignee | 'NOT_FOUND';
    try {
      assignee = await this.deps.assignments.currentAssignee(id, meta.correlationId);
    } catch (error) {
      // Unknown is never allowed, whatever the failure was.
      this.deps.observer.record('technician_view_unverified', {
        bookingId: id,
        cause: error instanceof Error ? error.name : 'UNKNOWN',
      });
      throw new BookingError(
        'ASSIGNMENT_UNVERIFIED',
        'The assignment could not be verified; retry.',
        'ASSIGNMENT_UNVERIFIED',
      );
    }
    const assignment = decideAssignment(subject, assignee);
    if (assignment.kind === 'DENY') {
      this.deps.observer.record('technician_view_denied', {
        bookingId: id,
        reason: assignment.reason,
      });
      throw notFound();
    }

    const record = await this.deps.store.find(id);
    const booking = record?.booking ?? null;
    const visible = decideBooking(booking);
    if (visible.kind === 'DENY' || booking === null) {
      this.deps.observer.record('technician_view_denied', {
        bookingId: id,
        reason: visible.kind === 'DENY' ? visible.reason : 'NO_BOOKING',
      });
      throw notFound();
    }

    await this.deps.store.recordAudit({
      action: TECHNICIAN_VIEW_AUDIT_ACTION,
      actor: meta.actor,
      bookingId: booking.id,
      correlationId: meta.correlationId,
      details: {
        assignmentRevision: assignee === 'NOT_FOUND' ? null : assignee.revision,
        bookingRevision: booking.version,
      },
    });
    return booking;
  }
}
