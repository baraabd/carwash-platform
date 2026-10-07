import type { OwnerContract } from '../common/route';
import { VEHICLE_TYPES, type VehicleType } from '../common/vehicle-type';
import {
  parsePrincipalRef,
  parseResolvePurpose,
  type PrincipalRef,
  type ResolvePurpose,
} from '../common/principal';
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
 * vehicle.v1 — owner: Vehicle service (Lane A).
 * Saved vehicles of a principal (account or guest) and immutable booking snapshots.
 * The plate is OPTIONAL and has NO global uniqueness: two principals may save the
 * same plate, and a plate never identifies or authorizes a principal.
 */
export const VEHICLE_V1 = {
  id: 'vehicle.v1',
  owner: 'vehicle',
  prefix: '/internal/v1/vehicle',
  routes: {
    listMine: { method: 'GET', path: '/mine', access: 'principal', paged: true },
    create: { method: 'POST', path: '/mine', access: 'principal', idempotent: true },
    update: {
      method: 'PATCH',
      path: '/mine/:vehicleId',
      access: 'principal',
      idempotent: true,
      revisioned: true,
    },
    archive: {
      method: 'POST',
      path: '/mine/:vehicleId/archive',
      access: 'principal',
      idempotent: true,
      revisioned: true,
    },
    resolveVehicleSnapshot: {
      method: 'POST',
      path: '/vehicle-snapshots/resolve',
      access: 'service:vehicle.snapshot.resolve',
      safe: true,
    },
  },
  reasons: ['VEHICLE_ARCHIVED', 'VEHICLE_LIMIT_REACHED', 'VEHICLE_NOT_FOUND'],
} as const satisfies OwnerContract;

export { VEHICLE_TYPES, type VehicleType };
export const MAX_SAVED_VEHICLES = 10;

/**
 * Normalized plate text: 1-12 characters of uppercase Latin letters, Arabic
 * letters, ASCII digits, Arabic-Indic digits (U+0660-U+0669) and '-', with
 * single internal spaces and no leading/trailing space. Input is trimmed,
 * internal whitespace runs collapse to one space and Latin letters are
 * uppercased BEFORE this pattern is applied.
 */
const PLATE = /^[A-Z0-9٠-٩ء-ي-]+( [A-Z0-9٠-٩ء-ي-]+)*$/;

export interface PlateV1 {
  readonly text: string;
  readonly region: string | null;
}

export interface VehicleInputV1 {
  readonly type: VehicleType;
  readonly make: string | null;
  readonly model: string | null;
  readonly color: string | null;
  readonly nickname: string | null;
  readonly plate: PlateV1 | null;
}

export interface VehicleV1 extends VehicleInputV1 {
  readonly vehicleId: string;
  readonly revision: number;
  readonly archived: boolean;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

/** Immutable copy captured into a booking. Later vehicle edits never change it. */
export interface VehicleSnapshotV1 {
  readonly snapshotSchemaVersion: 1;
  /** `inline` = one-time vehicle entered for a booking and never saved. */
  readonly source: 'saved' | 'inline';
  readonly vehicleId: string | null;
  readonly vehicleRevision: number | null;
  readonly type: VehicleType;
  readonly make: string | null;
  readonly model: string | null;
  readonly color: string | null;
  readonly plate: PlateV1 | null;
  readonly capturedAt: UtcTimestamp;
}

export interface ResolveVehicleSnapshotRequestV1 {
  readonly owner: PrincipalRef;
  readonly vehicleId: string;
  readonly expectedRevision: number | null;
  readonly purpose: ResolvePurpose;
}

export function normalizePlateText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function parsePlateV1(value: unknown, path: string): PlateV1 | null {
  if (value === null) return null;
  const v = closed(value, path, ['text', 'region']);
  if (typeof v.text !== 'string') throw new ContractViolation('EXPECTED_STRING', `${path}.text`);
  return {
    text: text(normalizePlateText(v.text), `${path}.text`, { max: 12, pattern: PLATE }),
    region: optionalText(v.region, `${path}.region`, { max: 30 }),
  };
}

function short(value: unknown, path: string): string | null {
  return optionalText(value, path, { max: 40 });
}

export function parseVehicleInputV1(value: unknown, path = '$'): VehicleInputV1 {
  const v = closed(value, path, ['type', 'make', 'model', 'color', 'nickname', 'plate']);
  return {
    type: oneOf(v.type, `${path}.type`, VEHICLE_TYPES),
    make: short(v.make, `${path}.make`),
    model: short(v.model, `${path}.model`),
    color: short(v.color, `${path}.color`),
    nickname: short(v.nickname, `${path}.nickname`),
    plate: parsePlateV1(v.plate, `${path}.plate`),
  };
}

/** One-time vehicle for a single booking; same shape as a saved vehicle input. */
export function parseInlineVehicleV1(value: unknown, path = '$'): VehicleInputV1 {
  return parseVehicleInputV1(value, path);
}

export function parseVehicleV1(value: unknown, path = '$'): VehicleV1 {
  const v = closed(value, path, [
    'vehicleId',
    'revision',
    'type',
    'make',
    'model',
    'color',
    'nickname',
    'plate',
    'archived',
    'createdAt',
    'updatedAt',
  ]);
  const input = parseVehicleInputV1(
    {
      type: v.type,
      make: v.make,
      model: v.model,
      color: v.color,
      nickname: v.nickname,
      plate: v.plate,
    },
    path,
  );
  return {
    vehicleId: uuid(v.vehicleId, `${path}.vehicleId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    ...input,
    archived: boolean(v.archived, `${path}.archived`),
    createdAt: parseUtc(v.createdAt, `${path}.createdAt`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

export function parseResolveVehicleSnapshotRequestV1(
  value: unknown,
): ResolveVehicleSnapshotRequestV1 {
  const v = closed(value, '$', ['owner', 'vehicleId', 'expectedRevision', 'purpose']);
  return {
    owner: parsePrincipalRef(v.owner, '$.owner'),
    vehicleId: uuid(v.vehicleId, '$.vehicleId'),
    expectedRevision:
      v.expectedRevision === null ? null : parseRevision(v.expectedRevision, '$.expectedRevision'),
    purpose: parseResolvePurpose(v.purpose, '$.purpose'),
  };
}

export function parseVehicleSnapshotV1(value: unknown, path = '$'): VehicleSnapshotV1 {
  const v = closed(value, path, [
    'snapshotSchemaVersion',
    'source',
    'vehicleId',
    'vehicleRevision',
    'type',
    'make',
    'model',
    'color',
    'plate',
    'capturedAt',
  ]);
  if (v.snapshotSchemaVersion !== 1) {
    throw new ContractViolation('UNSUPPORTED_SNAPSHOT', `${path}.snapshotSchemaVersion`);
  }
  const source = oneOf(v.source, `${path}.source`, ['saved', 'inline'] as const);
  let vehicleId: string | null = null;
  let vehicleRevision: number | null = null;
  if (source === 'saved') {
    vehicleId = uuid(v.vehicleId, `${path}.vehicleId`);
    vehicleRevision = parseRevision(v.vehicleRevision, `${path}.vehicleRevision`);
  } else if (v.vehicleId !== null || v.vehicleRevision !== null) {
    throw new ContractViolation('INLINE_SNAPSHOT_HAS_VEHICLE', `${path}.vehicleId`);
  }
  return {
    snapshotSchemaVersion: 1,
    source,
    vehicleId,
    vehicleRevision,
    type: oneOf(v.type, `${path}.type`, VEHICLE_TYPES),
    make: short(v.make, `${path}.make`),
    model: short(v.model, `${path}.model`),
    color: short(v.color, `${path}.color`),
    plate: parsePlateV1(v.plate, `${path}.plate`),
    capturedAt: parseUtc(v.capturedAt, `${path}.capturedAt`),
  };
}
