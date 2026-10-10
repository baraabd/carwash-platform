import { invalid } from './errors';
import type { OperatorState } from './operator';
import { operationalReadiness } from './readiness';

/**
 * Published `workforce.v1` capacity resources (resource = operator).
 *
 * Mirrors `@carwash/contracts` workforce/v1.ts. Workforce does not depend on
 * that package (the lockfile is Lane E's), so the rules are restated here and
 * tests/production/C/workforce-contract.test.mjs proves parity against the
 * built published parsers.
 */
export const ELIGIBILITY_STATES = ['ELIGIBLE', 'INELIGIBLE'] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

export const MAX_RESOURCE_ZONES = 20;
export const MAX_RESOURCE_SHIFTS = 100;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Readiness evaluated at one instant, as the published eligibility state. */
export function eligibilityAt(
  operator: OperatorState,
  skillCodes: readonly string[],
  at: Date,
): EligibilityState {
  return operationalReadiness(operator, skillCodes, at).ready ? 'ELIGIBLE' : 'INELIGIBLE';
}

// ---------------------------------------------------------------------------
// Query (mirror of parseCapacityResourceQueryV1 + parsePageRequest)
// ---------------------------------------------------------------------------

export interface CapacityQuery {
  readonly zoneId: string;
  readonly from: Date;
  readonly to: Date;
  readonly limit: number;
  /** Opaque cursor text exactly as issued; decoded by the application. */
  readonly cursor: string | null;
}

const QUERY_KEYS = ['zoneId', 'from', 'to', 'limit', 'cursor'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;

function utc(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !UTC.test(value)) invalid(`${field} must be a UTC instant.`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
    invalid(`${field} must be a UTC instant.`);
  }
  return new Date(ms);
}

function limitOf(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_LIMIT;
  const numeric = typeof value === 'string' && /^[0-9]{1,3}$/.test(value) ? Number(value) : value;
  if (
    typeof numeric !== 'number' ||
    !Number.isSafeInteger(numeric) ||
    numeric < 1 ||
    numeric > MAX_PAGE_LIMIT
  ) {
    invalid('limit must be an integer 1-100.');
  }
  return numeric;
}

function cursorOf(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') invalid('cursor must be a string.');
  const normalized = value.normalize('NFC');
  if (!CURSOR.test(normalized)) invalid('cursor is malformed.');
  return normalized;
}

/**
 * Closed query: the five published parameters only. A repeated parameter
 * arrives as an array and is refused like any other non-string value.
 */
export function parseCapacityQuery(query: Readonly<Record<string, unknown>>): CapacityQuery {
  for (const key of Object.keys(query)) {
    if (!QUERY_KEYS.some((allowed) => allowed === key)) {
      invalid(`Unexpected query parameter: ${key.slice(0, 40)}.`);
    }
  }
  const from = utc(query.from, 'from');
  const to = utc(query.to, 'to');
  if (to.getTime() <= from.getTime()) invalid('to must be after from.');
  const zoneId = query.zoneId;
  if (typeof zoneId !== 'string' || !UUID.test(zoneId)) invalid('zoneId must be a UUID.');
  return {
    zoneId: zoneId.toLowerCase(),
    from,
    to,
    limit: limitOf(query.limit),
    cursor: cursorOf(query.cursor),
  };
}

// ---------------------------------------------------------------------------
// Resource projection
// ---------------------------------------------------------------------------

export interface CapacityShift {
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** What the store returns for one operator with an ACTIVE shift in the window. */
export interface CapacityCandidate {
  readonly operator: OperatorState;
  readonly skillCodes: readonly string[];
  /** Distinct zones of ALL ACTIVE shifts overlapping the window. */
  readonly zoneIds: readonly string[];
  /** ACTIVE shifts overlapping the window (the store may return MAX + 1). */
  readonly shifts: readonly CapacityShift[];
}

export interface CapacityResource {
  readonly resourceId: string;
  readonly revision: number;
  readonly eligibility: EligibilityState;
  readonly eligibilityRevision: number;
  readonly zoneIds: readonly string[];
  readonly shifts: ReadonlyArray<{ readonly startsAt: Date; readonly endsAt: Date }>;
}

/**
 * Projects an operator onto the published resource shape.
 *
 * - eligibility: operational readiness at the query's `from`;
 * - zoneIds: sorted distinct zones (always including the queried zone); when
 *   more than 20 exist, the queried zone plus the first 19 others are kept;
 * - shifts: the shift intervals sorted by start, the first 100 kept. ACTIVE
 *   shifts of one operator never overlap (database exclusion constraint), so a
 *   violation here is an internal fault and fails loudly.
 */
export function toCapacityResource(
  candidate: CapacityCandidate,
  query: { readonly zoneId: string; readonly from: Date },
): CapacityResource {
  const others = [...new Set(candidate.zoneIds)].filter((zone) => zone !== query.zoneId).sort();
  const zoneIds = [query.zoneId, ...others.slice(0, MAX_RESOURCE_ZONES - 1)].sort();
  const shifts = [...candidate.shifts]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, MAX_RESOURCE_SHIFTS)
    .map((shift) => ({ startsAt: shift.startsAt, endsAt: shift.endsAt }));
  for (let i = 1; i < shifts.length; i += 1) {
    const previous = shifts[i - 1];
    const current = shifts[i];
    if (previous && current && current.startsAt.getTime() < previous.endsAt.getTime()) {
      throw new Error('CAPACITY_SHIFTS_OVERLAP');
    }
  }
  return {
    resourceId: candidate.operator.id,
    revision: candidate.operator.version,
    eligibility: eligibilityAt(candidate.operator, candidate.skillCodes, query.from),
    eligibilityRevision: candidate.operator.eligibilityRevision,
    zoneIds,
    shifts,
  };
}
