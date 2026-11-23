/**
 * Who currently holds a booking's job, as Dispatch states it.
 *
 * Dispatch owns assignments; Booking never stores a technician. Booking asks
 * this port on every technician read and keeps no copy of the answer, so an
 * allow is never cached and a reassignment takes effect on the next request.
 */
export const ASSIGNMENT_STATUSES = ['UNASSIGNED', 'OFFERED', 'ASSIGNED', 'CANCELLED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export interface CurrentAssignee {
  readonly status: AssignmentStatus;
  /** Identity subject of the technician; null when nobody holds the job. */
  readonly technicianSubjectId: string | null;
  readonly revision: number;
}

/**
 * Raised when Dispatch's answer is not known: timeout, network failure, 5xx,
 * a refused service credential or a response that does not parse. The caller
 * must fail closed; it is never interpreted as "not assigned" or "assigned".
 */
export class AssignmentUnavailable extends Error {
  constructor(
    /** Fixed diagnostic code, e.g. TIMEOUT, NETWORK, UPSTREAM_5XX, BAD_RESPONSE. */
    readonly reason: string,
  ) {
    super(`ASSIGNMENT_UNAVAILABLE_${reason}`);
    this.name = 'AssignmentUnavailable';
  }
}

export interface AssignmentVerifier {
  /**
   * Dispatch's current assignment of the booking, or NOT_FOUND when Dispatch
   * has no job for it. Throws AssignmentUnavailable when the answer is unknown.
   */
  currentAssignee(bookingId: string, correlationId: string): Promise<CurrentAssignee | 'NOT_FOUND'>;
}
