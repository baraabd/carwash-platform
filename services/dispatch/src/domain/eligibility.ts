/**
 * Workforce eligibility as Dispatch sees it, from the PUBLISHED contracts only:
 *   - workforce.v1 `listCapacityResources` (read before an offer and again
 *     before an acceptance), and
 *   - workforce.eligibility-changed.v1 (pushed revisions, kept as a watermark).
 *
 * Whichever source carries the higher eligibilityRevision wins, so a stale
 * read can never resurrect a resource that an event already marked
 * INELIGIBLE, and a stale event can never block a newer ELIGIBLE read.
 */
export type Eligibility = 'ELIGIBLE' | 'INELIGIBLE';

export interface CapacityShift {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** One `CapacityResourceV1` as returned for the job's zone and window. */
export interface CapacityResource {
  readonly resourceId: string;
  readonly revision: number;
  readonly eligibility: Eligibility;
  readonly eligibilityRevision: number;
  readonly zoneIds: readonly string[];
  readonly shifts: readonly CapacityShift[];
}

export interface ResourceObservation {
  readonly resourceId: string;
  readonly eligibility: Eligibility;
  readonly revision: number;
}

export interface JobWindow {
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export type EligibilityVerdict =
  | { readonly eligible: true; readonly eligibilityRevision: number }
  | {
      readonly eligible: false;
      readonly reason: 'NOT_LISTED' | 'INELIGIBLE' | 'NO_COVERING_SHIFT' | 'OBSERVED_INELIGIBLE';
    };

/**
 * The resource must be listed for the job's zone and window, ELIGIBLE, and
 * hold one shift covering the whole window. `workforce.v1` reports shifts per
 * resource, not per zone; the query is filtered by the job's zone, so a
 * covering shift of a resource listed for that zone is accepted (documented
 * contract limitation, CR-P03-C4 §2).
 */
export function decideEligibility(
  job: JobWindow,
  resource: CapacityResource | null,
  observed: ResourceObservation | null,
): EligibilityVerdict {
  if (resource === null) return { eligible: false, reason: 'NOT_LISTED' };
  if (
    observed !== null &&
    observed.revision > resource.eligibilityRevision &&
    observed.eligibility === 'INELIGIBLE'
  ) {
    return { eligible: false, reason: 'OBSERVED_INELIGIBLE' };
  }
  if (resource.eligibility !== 'ELIGIBLE') return { eligible: false, reason: 'INELIGIBLE' };
  if (!resource.zoneIds.includes(job.zoneId)) return { eligible: false, reason: 'NOT_LISTED' };
  const covered = resource.shifts.some(
    (shift) =>
      shift.startsAt.getTime() <= job.startsAt.getTime() &&
      shift.endsAt.getTime() >= job.endsAt.getTime(),
  );
  if (!covered) return { eligible: false, reason: 'NO_COVERING_SHIFT' };
  return { eligible: true, eligibilityRevision: resource.eligibilityRevision };
}

export type ObservationDecision = 'APPLY' | 'STALE';

/** Revisions only move forward; an equal or older revision is a duplicate/out-of-order event. */
export function decideObservation(
  previous: ResourceObservation | null,
  next: ResourceObservation,
): ObservationDecision {
  if (previous !== null && previous.revision >= next.revision) return 'STALE';
  return 'APPLY';
}
