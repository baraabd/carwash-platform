import { GeoDomainError, samePoint, type Point } from './geometry';
import type { Serviceability } from './zone';

/**
 * Serviceability decisions (geo.v1 ServiceabilityDecisionV1).
 *
 * A decision records what Geo answered for one point against one dataset
 * revision, so a later booking step can ask Geo whether that answer still
 * holds (validateDecision) instead of trusting a client copy. Decisions are
 * append-only and short-lived: they contain a precise location, which is
 * personal data, and are purged after their retention window.
 *
 * Only two wire reasons exist for INDETERMINATE. The finer internal detail is
 * kept for diagnosis and never changes the published decision:
 *  - NO_APPROVED_ZONES                     -> GEO_DATASET_UNAVAILABLE
 *  - ON_ZONE_BOUNDARY, OVERLAPPING_ZONES   -> LOCATION_UNRESOLVED
 */
export type DecisionOutcome = 'SERVICEABLE' | 'OUTSIDE_ZONE' | 'INDETERMINATE';
export type IndeterminateReason = 'GEO_DATASET_UNAVAILABLE' | 'LOCATION_UNRESOLVED';
export type IndeterminateDetail = 'NO_APPROVED_ZONES' | 'ON_ZONE_BOUNDARY' | 'OVERLAPPING_ZONES';

export interface ZoneRef {
  readonly zoneId: string;
  readonly revision: number;
}

export interface Decision {
  readonly id: string;
  readonly outcome: DecisionOutcome;
  readonly zone: ZoneRef | null;
  readonly reason: IndeterminateReason | null;
  readonly detail: IndeterminateDetail | null;
  readonly datasetRevision: number;
  readonly point: Point;
  readonly checkedAt: Date;
  readonly expiresAt: Date;
}

/** How long a decision may be relied on; bounded so a stale answer cannot live long. */
export const DECISION_TTL_MIN_MS = 60_000;
export const DECISION_TTL_MAX_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DECISION_TTL_MS = 30 * 60 * 1000;

export function reasonFor(detail: IndeterminateDetail): IndeterminateReason {
  return detail === 'NO_APPROVED_ZONES' ? 'GEO_DATASET_UNAVAILABLE' : 'LOCATION_UNRESOLVED';
}

export function decide(input: {
  readonly id: string;
  readonly serviceability: Serviceability;
  readonly datasetRevision: number;
  readonly point: Point;
  readonly checkedAt: Date;
  readonly ttlMs: number;
}): Decision {
  if (
    !Number.isSafeInteger(input.ttlMs) ||
    input.ttlMs < DECISION_TTL_MIN_MS ||
    input.ttlMs > DECISION_TTL_MAX_MS
  ) {
    throw new Error('INVALID_DECISION_TTL');
  }
  if (!Number.isSafeInteger(input.datasetRevision) || input.datasetRevision < 1) {
    throw new Error('INVALID_DATASET_REVISION');
  }
  const base = {
    id: input.id,
    datasetRevision: input.datasetRevision,
    point: input.point,
    checkedAt: input.checkedAt,
    expiresAt: new Date(input.checkedAt.getTime() + input.ttlMs),
  };
  const s = input.serviceability;
  if (s.result === 'SERVICEABLE') {
    return {
      ...base,
      outcome: 'SERVICEABLE',
      zone: { zoneId: s.zone.zoneId, revision: s.zone.revision },
      reason: null,
      detail: null,
    };
  }
  if (s.result === 'OUTSIDE_ZONE') {
    return { ...base, outcome: 'OUTSIDE_ZONE', zone: null, reason: null, detail: null };
  }
  return {
    ...base,
    outcome: 'INDETERMINATE',
    zone: null,
    reason: reasonFor(s.reason),
    detail: s.reason,
  };
}

export type ValidationReason =
  'DECISION_EXPIRED' | 'ZONE_CHANGED' | 'POINT_MISMATCH' | 'DECISION_NOT_FOUND';

export interface DecisionValidation {
  readonly valid: boolean;
  readonly reason: ValidationReason | null;
  readonly zone: ZoneRef | null;
}

export interface ValidationRequest {
  readonly decisionId: string;
  readonly expectedZoneRevision: number;
  readonly point: Point;
}

/**
 * Whether a stored decision still authorizes service at `point` NOW.
 *
 * Checked in this order, first failure wins:
 *  1. the decision exists and was SERVICEABLE (geo.v1 has no separate reason
 *     for "was never serviceable", so it is DECISION_NOT_FOUND: there is no
 *     serviceable decision with this id),
 *  2. the caller's point is exactly the decided point (POINT_MISMATCH),
 *  3. the decision has not expired (half-open: expiresAt itself is expired),
 *  4. the caller saw the same zone revision (ZONE_CHANGED),
 *  5. re-evaluating the point against the CURRENT dataset still yields the
 *     same zone at the same revision. A new overlapping zone, a revision, a
 *     retirement or a dataset outage all invalidate (ZONE_CHANGED).
 */
export function validateDecision(
  decision: Decision | null,
  request: ValidationRequest,
  now: Date,
  current: Serviceability,
): DecisionValidation {
  if (decision === null || decision.outcome !== 'SERVICEABLE' || decision.zone === null) {
    return { valid: false, reason: 'DECISION_NOT_FOUND', zone: null };
  }
  const decided = decision.zone;
  if (!samePoint(decision.point, request.point)) {
    return { valid: false, reason: 'POINT_MISMATCH', zone: decided };
  }
  if (now.getTime() >= decision.expiresAt.getTime()) {
    return { valid: false, reason: 'DECISION_EXPIRED', zone: decided };
  }
  if (request.expectedZoneRevision !== decided.revision) {
    return { valid: false, reason: 'ZONE_CHANGED', zone: decided };
  }
  if (
    current.result !== 'SERVICEABLE' ||
    current.zone.zoneId !== decided.zoneId ||
    current.zone.revision !== decided.revision
  ) {
    const zone =
      current.result === 'SERVICEABLE'
        ? { zoneId: current.zone.zoneId, revision: current.zone.revision }
        : decided;
    return { valid: false, reason: 'ZONE_CHANGED', zone };
  }
  return { valid: true, reason: null, zone: decided };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REVISION = 2_147_483_647;

export function parseDecisionId(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !UUID.test(raw)) throw new GeoDomainError('INVALID_UUID', field);
  return raw.toLowerCase();
}

export function parseRevisionNumber(raw: unknown, field: string): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > MAX_REVISION) {
    throw new GeoDomainError('INVALID_REVISION', field);
  }
  return raw;
}
