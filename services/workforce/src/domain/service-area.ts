import { WorkforceError, invalid } from './errors';
import { MAX_RESOURCE_ZONES } from './capacity';
import { assertUuid, type OperatorState } from './operator';

/**
 * The zones an operator may work in (P05-C1). Operations own it; the home
 * zone is always part of it and is not stored as an extra zone.
 *
 * No stored row means "never configured": the area is the home zone alone at
 * revision 0. A shift, a weekly window or an availability exception may only
 * name a zone inside the area at the moment it is written.
 */
export interface ServiceAreaState {
  readonly operatorId: string;
  /** Extra zones besides the home zone, sorted, distinct, never the home zone. */
  readonly extraZoneIds: readonly string[];
  readonly revision: number;
  readonly updatedAt: Date | null;
}

/** Home zone + extras, bounded so a capacity resource never exceeds the published zone cap. */
export const MAX_EXTRA_SERVICE_ZONES = MAX_RESOURCE_ZONES - 1;
export const MAX_SERVICE_AREA_REVISION = 2_147_483_647;

export function initialServiceArea(operatorId: string): ServiceAreaState {
  return { operatorId, extraZoneIds: [], revision: 0, updatedAt: null };
}

export function serviceZoneIds(operator: OperatorState, area: ServiceAreaState): string[] {
  return [...new Set([operator.homeZoneId, ...area.extraZoneIds])].sort();
}

export function assertInServiceArea(
  operator: OperatorState,
  area: ServiceAreaState,
  zoneId: string,
): void {
  if (!serviceZoneIds(operator, area).includes(zoneId.toLowerCase())) {
    throw new WorkforceError('ZONE_OUTSIDE_SERVICE_AREA', 'Zone is outside the service area.');
  }
}

/**
 * Replaces the extra zones. The home zone in the input is accepted and
 * dropped (it is implicit); duplicates are refused rather than merged so a
 * client bug is visible.
 */
export function replaceServiceArea(
  operator: OperatorState,
  current: ServiceAreaState,
  input: { readonly zoneIds: readonly string[]; readonly expectedRevision: number },
  now: Date,
): { readonly next: ServiceAreaState; readonly changed: boolean } {
  if (input.expectedRevision !== current.revision) {
    throw new WorkforceError('REVISION_CONFLICT', 'Service area changed; refetch and retry.');
  }
  const normalized: string[] = [];
  for (const zoneId of input.zoneIds) {
    assertUuid(zoneId, 'zoneIds[]');
    normalized.push(zoneId.toLowerCase());
  }
  if (new Set(normalized).size !== normalized.length) invalid('zoneIds must be distinct.');
  const extras = normalized.filter((zone) => zone !== operator.homeZoneId).sort();
  if (extras.length > MAX_EXTRA_SERVICE_ZONES) {
    invalid(`At most ${MAX_EXTRA_SERVICE_ZONES} zones besides the home zone.`);
  }
  if (extras.join(',') === current.extraZoneIds.join(',')) return { next: current, changed: false };
  if (current.revision >= MAX_SERVICE_AREA_REVISION) invalid('Service area revision exhausted.');
  return {
    next: { ...current, extraZoneIds: extras, revision: current.revision + 1, updatedAt: now },
    changed: true,
  };
}
