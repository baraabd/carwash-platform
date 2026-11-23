import { randomUUID } from 'node:crypto';
import type { WorkEvidence, WorkState } from '../../src/domain';
import { WorkAuthorityUnavailable, type WorkAuthority } from '../../src/ports';

/**
 * TEST DOUBLE of the lane C work owner (Dispatch/Booking) behind Billing's
 * WorkAuthority port. This double proves only Billing's side:
 * that collection obeys whatever assignment/completion the owner reports.
 */
export class WorkDouble implements WorkAuthority {
  readonly bookings = new Map<string, WorkEvidence>();
  readonly calls: { bookingId: string; credential: string; correlationId: string }[] = [];
  unavailable = false;

  book(input: {
    bookingId: string;
    technicianSubject: string | null;
    workState?: WorkState;
  }): WorkEvidence {
    const evidence: WorkEvidence = {
      bookingId: input.bookingId,
      assignmentId: randomUUID(),
      assignmentRevision: 2,
      technicianSubject: input.technicianSubject,
      workState: input.workState ?? 'COMPLETED',
      taskId: randomUUID(),
      taskStage: 'CLOSED',
      taskRevision: 8,
    };
    this.bookings.set(evidence.bookingId, evidence);
    return evidence;
  }

  set(bookingId: string, change: Partial<WorkEvidence>): void {
    const current = this.bookings.get(bookingId);
    if (!current) throw new Error('UNKNOWN_TEST_BOOKING');
    this.bookings.set(bookingId, { ...current, ...change });
  }

  evidenceFor(
    bookingId: string,
    credential: string,
    correlationId: string,
  ): Promise<WorkEvidence | null> {
    this.calls.push({ bookingId, credential, correlationId });
    if (this.unavailable) return Promise.reject(new WorkAuthorityUnavailable());
    return Promise.resolve(this.bookings.get(bookingId) ?? null);
  }
}
