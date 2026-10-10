import type { WorkEvidence } from '../../domain';
import { WorkAuthorityUnavailable, type WorkAuthority } from '../../ports';

/**
 * Production WorkAuthority until lane C publishes the work-execution contract.
 *
 * Billing must know, from the work owner and for the calling technician, that
 * the booking is assigned to them and that the service is COMPLETED. Today no
 * service owns a work-completion state (Dispatch stops at ASSIGNED) and there
 * is no published Dispatch/Booking contract that binds a booking to its quote,
 * so there is nothing truthful to call. Every collection therefore fails
 * closed with 503 UPSTREAM_UNAVAILABLE instead of trusting a client assertion
 * (blocker B-P03-01, contract request CR-B-08.3).
 */
export class UnpublishedWorkAuthority implements WorkAuthority {
  evidenceFor(): Promise<WorkEvidence | null> {
    return Promise.reject(new WorkAuthorityUnavailable());
  }
}
