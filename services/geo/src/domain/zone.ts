import { GeoDomainError, parseRing, placePoint, type Point, type Ring } from './geometry';

/**
 * Service zones and serviceability.
 *
 * Geo owns zones only. It never stores or edits a customer address; it answers
 * "is this coordinate inside an ACTIVE approved zone". No zone exists until one
 * is imported from an approved dataset with an explicit provenance reference.
 * There are no built-in, sample or "Aleppo" polygons: without approved data the
 * answer is INDETERMINATE, never SERVICEABLE.
 *
 * Boundary, overlap and effective-window rules are pending an owner decision,
 * so every unclear case fails closed as INDETERMINATE:
 *  - a point exactly on a zone edge or vertex,
 *  - a point inside more than one ACTIVE zone.
 */
export type ZoneStatus = 'ACTIVE' | 'RETIRED';

export interface Zone {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly datasetRef: string;
  readonly ring: Ring;
  readonly status: ZoneStatus;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly retiredAt: Date | null;
}

export interface ZoneDefinition {
  readonly code: string;
  readonly name: string;
  readonly datasetRef: string;
  readonly ring: Ring;
}

const CODE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const DATASET_REF = /^[a-z0-9][a-z0-9._:-]{2,119}$/;

export function parseZoneCode(raw: unknown): string {
  if (typeof raw !== 'string' || !CODE.test(raw))
    throw new GeoDomainError('INVALID_ZONE_CODE', 'code');
  return raw;
}

export function parseZoneDefinition(raw: unknown): ZoneDefinition {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new GeoDomainError('INVALID_INPUT');
  const value = raw as Record<string, unknown>;
  const extra = Object.keys(value).find(
    (key) => !['code', 'name', 'datasetRef', 'polygon'].includes(key),
  );
  if (extra !== undefined) throw new GeoDomainError('INVALID_INPUT', extra);
  const name =
    typeof value.name === 'string' ? value.name.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  // eslint-disable-next-line no-control-regex
  if (name.length < 2 || [...name].length > 80 || /[\u0000-\u001F\u007F-\u009F]/.test(name)) {
    throw new GeoDomainError('INVALID_ZONE_NAME', 'name');
  }
  if (typeof value.datasetRef !== 'string' || !DATASET_REF.test(value.datasetRef)) {
    throw new GeoDomainError('INVALID_DATASET_REF', 'datasetRef');
  }
  return {
    code: parseZoneCode(value.code),
    name,
    datasetRef: value.datasetRef,
    ring: parseRing(value.polygon),
  };
}

export function sameZoneDefinition(zone: Zone, definition: ZoneDefinition): boolean {
  return (
    zone.name === definition.name &&
    zone.datasetRef === definition.datasetRef &&
    JSON.stringify(zone.ring.vertices.map((p) => [p.longitude, p.latitude])) ===
      JSON.stringify(definition.ring.vertices.map((p) => [p.longitude, p.latitude]))
  );
}

export type Serviceability =
  | {
      readonly result: 'SERVICEABLE';
      readonly zone: { readonly zoneId: string; readonly code: string; readonly revision: number };
    }
  | { readonly result: 'OUTSIDE_ZONE' }
  | {
      readonly result: 'INDETERMINATE';
      readonly reason: 'NO_APPROVED_ZONES' | 'ON_ZONE_BOUNDARY' | 'OVERLAPPING_ZONES';
    };

/**
 * Evaluates a point. `candidates` must contain every ACTIVE zone whose bounding
 * box contains the point; zones outside their box cannot contain or touch it.
 */
export function evaluateServiceability(
  anyActive: boolean,
  candidates: readonly Zone[],
  point: Point,
): Serviceability {
  if (!anyActive) return { result: 'INDETERMINATE', reason: 'NO_APPROVED_ZONES' };
  const inside: Zone[] = [];
  for (const zone of candidates) {
    const placement = placePoint(zone.ring, point);
    if (placement === 'BOUNDARY') return { result: 'INDETERMINATE', reason: 'ON_ZONE_BOUNDARY' };
    if (placement === 'INSIDE') inside.push(zone);
  }
  if (inside.length > 1) return { result: 'INDETERMINATE', reason: 'OVERLAPPING_ZONES' };
  const [zone] = inside;
  if (!zone) return { result: 'OUTSIDE_ZONE' };
  return {
    result: 'SERVICEABLE',
    zone: { zoneId: zone.id, code: zone.code, revision: zone.revision },
  };
}
