import type { OwnerContract } from '../common/route';
import { parseCoordinates, type Coordinates } from '../common/coordinates';
import { parseResolvePurpose, type ResolvePurpose } from '../common/principal';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import {
  ContractViolation,
  boolean,
  closed,
  oneOf,
  optionalText,
  text,
  uuid,
} from '../common/wire';

/**
 * geo.v1 — owner: Geo service (Lane A).
 * Service zones and serviceability decisions. Zone polygons never leave Geo.
 * A Geo outage or missing dataset yields INDETERMINATE (or an error envelope),
 * NEVER a SERVICEABLE decision.
 */
export const GEO_V1 = {
  id: 'geo.v1',
  owner: 'geo',
  prefix: '/internal/v1/geo',
  routes: {
    listZones: { method: 'GET', path: '/service-zones', access: 'public' },
    checkServiceability: {
      method: 'POST',
      path: '/serviceability',
      access: 'principal',
      safe: true,
    },
    validateDecision: {
      method: 'POST',
      path: '/serviceability/validate',
      access: 'service:geo.serviceability.validate',
      safe: true,
    },
  },
  reasons: ['GEO_DATASET_UNAVAILABLE', 'LOCATION_UNRESOLVED'],
} as const satisfies OwnerContract;

export interface ServiceZoneV1 {
  readonly zoneId: string;
  readonly revision: number;
  readonly name: { readonly ar: string; readonly en: string | null };
  readonly status: 'ACTIVE' | 'SUSPENDED';
}

export const SERVICEABILITY_DECISIONS = ['SERVICEABLE', 'OUTSIDE_ZONE', 'INDETERMINATE'] as const;
export type ServiceabilityDecision = (typeof SERVICEABILITY_DECISIONS)[number];
export const INDETERMINATE_REASONS = ['GEO_DATASET_UNAVAILABLE', 'LOCATION_UNRESOLVED'] as const;
export type IndeterminateReason = (typeof INDETERMINATE_REASONS)[number];

export interface ServiceabilityRequestV1 {
  readonly point: Coordinates;
}

export interface ServiceabilityDecisionV1 {
  readonly decisionId: string;
  readonly decision: ServiceabilityDecision;
  readonly zoneId: string | null;
  readonly zoneRevision: number | null;
  readonly datasetRevision: number;
  readonly point: Coordinates;
  readonly checkedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  readonly reason: IndeterminateReason | null;
}

export interface ValidateDecisionRequestV1 {
  readonly decisionId: string;
  readonly expectedZoneRevision: number;
  readonly point: Coordinates;
  readonly purpose: ResolvePurpose;
}

export const VALIDATION_REASONS = [
  'DECISION_EXPIRED',
  'ZONE_CHANGED',
  'POINT_MISMATCH',
  'DECISION_NOT_FOUND',
] as const;
export type ValidationReason = (typeof VALIDATION_REASONS)[number];

export interface ValidateDecisionResultV1 {
  readonly decisionId: string;
  readonly valid: boolean;
  readonly reason: ValidationReason | null;
  readonly zoneId: string | null;
  readonly zoneRevision: number | null;
}

export function parseServiceZoneV1(value: unknown, path = '$'): ServiceZoneV1 {
  const v = closed(value, path, ['zoneId', 'revision', 'name', 'status']);
  const n = closed(v.name, `${path}.name`, ['ar', 'en']);
  return {
    zoneId: uuid(v.zoneId, `${path}.zoneId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    name: {
      ar: text(n.ar, `${path}.name.ar`, { max: 80 }),
      en: optionalText(n.en, `${path}.name.en`, { max: 80 }),
    },
    status: oneOf(v.status, `${path}.status`, ['ACTIVE', 'SUSPENDED'] as const),
  };
}

export function parseServiceabilityRequestV1(value: unknown): ServiceabilityRequestV1 {
  const v = closed(value, '$', ['point']);
  return { point: parseCoordinates(v.point, '$.point') };
}

function nullableUuid(value: unknown, path: string): string | null {
  return value === null ? null : uuid(value, path);
}

function nullableRevision(value: unknown, path: string): number | null {
  return value === null ? null : parseRevision(value, path);
}

export function parseServiceabilityDecisionV1(
  value: unknown,
  path = '$',
): ServiceabilityDecisionV1 {
  const v = closed(value, path, [
    'decisionId',
    'decision',
    'zoneId',
    'zoneRevision',
    'datasetRevision',
    'point',
    'checkedAt',
    'expiresAt',
    'reason',
  ]);
  const decision = oneOf(v.decision, `${path}.decision`, SERVICEABILITY_DECISIONS);
  const zoneId = nullableUuid(v.zoneId, `${path}.zoneId`);
  const zoneRevision = nullableRevision(v.zoneRevision, `${path}.zoneRevision`);
  const reason =
    v.reason === null ? null : oneOf(v.reason, `${path}.reason`, INDETERMINATE_REASONS);
  if ((zoneId === null) !== (zoneRevision === null)) {
    throw new ContractViolation('INCONSISTENT_ZONE', `${path}.zoneRevision`);
  }
  if (decision === 'SERVICEABLE' && (zoneId === null || reason !== null)) {
    throw new ContractViolation('INCONSISTENT_DECISION', `${path}.decision`);
  }
  if (decision === 'OUTSIDE_ZONE' && (zoneId !== null || reason !== null)) {
    throw new ContractViolation('INCONSISTENT_DECISION', `${path}.decision`);
  }
  if (decision === 'INDETERMINATE' && (zoneId !== null || reason === null)) {
    throw new ContractViolation('INCONSISTENT_DECISION', `${path}.decision`);
  }
  const checkedAt = parseUtc(v.checkedAt, `${path}.checkedAt`);
  const expiresAt = parseUtc(v.expiresAt, `${path}.expiresAt`);
  if (Date.parse(expiresAt) <= Date.parse(checkedAt)) {
    throw new ContractViolation('INVALID_EXPIRY', `${path}.expiresAt`);
  }
  return {
    decisionId: uuid(v.decisionId, `${path}.decisionId`),
    decision,
    zoneId,
    zoneRevision,
    datasetRevision: parseRevision(v.datasetRevision, `${path}.datasetRevision`),
    point: parseCoordinates(v.point, `${path}.point`),
    checkedAt,
    expiresAt,
    reason,
  };
}

export function parseValidateDecisionRequestV1(value: unknown): ValidateDecisionRequestV1 {
  const v = closed(value, '$', ['decisionId', 'expectedZoneRevision', 'point', 'purpose']);
  return {
    decisionId: uuid(v.decisionId, '$.decisionId'),
    expectedZoneRevision: parseRevision(v.expectedZoneRevision, '$.expectedZoneRevision'),
    point: parseCoordinates(v.point, '$.point'),
    purpose: parseResolvePurpose(v.purpose, '$.purpose'),
  };
}

export function parseValidateDecisionResultV1(
  value: unknown,
  path = '$',
): ValidateDecisionResultV1 {
  const v = closed(value, path, ['decisionId', 'valid', 'reason', 'zoneId', 'zoneRevision']);
  const valid = boolean(v.valid, `${path}.valid`);
  const reason = v.reason === null ? null : oneOf(v.reason, `${path}.reason`, VALIDATION_REASONS);
  if (valid !== (reason === null)) {
    throw new ContractViolation('INCONSISTENT_VALIDATION', `${path}.valid`);
  }
  const zoneId = nullableUuid(v.zoneId, `${path}.zoneId`);
  const zoneRevision = nullableRevision(v.zoneRevision, `${path}.zoneRevision`);
  if ((zoneId === null) !== (zoneRevision === null) || (valid && zoneId === null)) {
    throw new ContractViolation('INCONSISTENT_ZONE', `${path}.zoneId`);
  }
  return {
    decisionId: uuid(v.decisionId, `${path}.decisionId`),
    valid,
    reason,
    zoneId,
    zoneRevision,
  };
}
