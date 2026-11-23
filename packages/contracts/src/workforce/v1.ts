import type { OwnerContract } from '../common/route';
import { parsePageRequest, parseRevision, type PageRequest } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import { ContractViolation, closed, list, oneOf, uuid } from '../common/wire';

/**
 * workforce.v1 — owner: Workforce service (Lane C).
 * Minimal capacity provider for Scheduling: which eligible resources can work
 * in which zones and when. Deliberately carries NO personal data (no names,
 * phones, documents); identities stay inside Workforce.
 */
export const WORKFORCE_V1 = {
  id: 'workforce.v1',
  owner: 'workforce',
  prefix: '/internal/v1/workforce',
  routes: {
    listCapacityResources: {
      method: 'GET',
      path: '/capacity-resources',
      access: 'service:workforce.capacity.read',
      paged: true,
    },
  },
  reasons: ['RESOURCE_NOT_FOUND'],
} as const satisfies OwnerContract;

export const ELIGIBILITY_STATES = ['ELIGIBLE', 'INELIGIBLE'] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

export const MAX_RESOURCE_ZONES = 20;
export const MAX_RESOURCE_SHIFTS = 100;

/** Half-open [startsAt, endsAt) in UTC. */
export interface ShiftV1 {
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
}

export interface CapacityResourceV1 {
  readonly resourceId: string;
  readonly revision: number;
  readonly eligibility: EligibilityState;
  readonly eligibilityRevision: number;
  readonly zoneIds: readonly string[];
  readonly shifts: readonly ShiftV1[];
}

export interface CapacityResourceQueryV1 {
  readonly zoneId: string;
  readonly from: UtcTimestamp;
  readonly to: UtcTimestamp;
  readonly page: PageRequest;
}

function shift(value: unknown, path: string): ShiftV1 {
  const v = closed(value, path, ['startsAt', 'endsAt']);
  const startsAt = parseUtc(v.startsAt, `${path}.startsAt`);
  const endsAt = parseUtc(v.endsAt, `${path}.endsAt`);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new ContractViolation('INVALID_INTERVAL', path);
  }
  return { startsAt, endsAt };
}

export function parseCapacityResourceV1(value: unknown, path = '$'): CapacityResourceV1 {
  const v = closed(value, path, [
    'resourceId',
    'revision',
    'eligibility',
    'eligibilityRevision',
    'zoneIds',
    'shifts',
  ]);
  const zoneIds = list(v.zoneIds, `${path}.zoneIds`, MAX_RESOURCE_ZONES, uuid);
  if (zoneIds.length === 0) throw new ContractViolation('EMPTY_ZONES', `${path}.zoneIds`);
  if (new Set(zoneIds).size !== zoneIds.length) {
    throw new ContractViolation('DUPLICATE_ZONE', `${path}.zoneIds`);
  }
  const shifts = list(v.shifts, `${path}.shifts`, MAX_RESOURCE_SHIFTS, shift);
  for (let i = 1; i < shifts.length; i += 1) {
    const previous = shifts[i - 1];
    const current = shifts[i];
    if (previous && current && Date.parse(current.startsAt) < Date.parse(previous.endsAt)) {
      throw new ContractViolation('OVERLAPPING_OR_UNSORTED_INTERVALS', `${path}.shifts[${i}]`);
    }
  }
  return {
    resourceId: uuid(v.resourceId, `${path}.resourceId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    eligibility: oneOf(v.eligibility, `${path}.eligibility`, ELIGIBILITY_STATES),
    eligibilityRevision: parseRevision(v.eligibilityRevision, `${path}.eligibilityRevision`),
    zoneIds,
    shifts,
  };
}

export function parseCapacityResourceQueryV1(query: {
  readonly zoneId?: unknown;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly limit?: unknown;
  readonly cursor?: unknown;
}): CapacityResourceQueryV1 {
  const from = parseUtc(query.from, 'query.from');
  const to = parseUtc(query.to, 'query.to');
  if (Date.parse(to) <= Date.parse(from)) throw new ContractViolation('INVALID_INTERVAL', 'query');
  return {
    zoneId: uuid(query.zoneId, 'query.zoneId'),
    from,
    to,
    page: parsePageRequest({ limit: query.limit, cursor: query.cursor }),
  };
}
