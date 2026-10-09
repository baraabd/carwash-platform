import { VehicleRuleError, VehicleValidationError } from './errors';
import { closedObject, type Owner, type Plate, type Vehicle, type VehicleType } from './vehicle';

/**
 * Immutable copy of a saved vehicle captured into a booking (vehicle.v1
 * VehicleSnapshotV1, source 'saved'). Later edits never change a captured
 * snapshot; Booking stores it. Vehicle produces it only for an authorized
 * service acting for the vehicle's owner, with a declared purpose.
 */
export const RESOLVE_PURPOSES = ['booking-quote', 'booking-create', 'booking-display'] as const;
export type ResolvePurpose = (typeof RESOLVE_PURPOSES)[number];

export interface VehicleSnapshot {
  readonly snapshotSchemaVersion: 1;
  readonly source: 'saved';
  readonly vehicleId: string;
  readonly vehicleRevision: number;
  readonly type: VehicleType;
  readonly make: string | null;
  readonly model: string | null;
  readonly color: string | null;
  readonly plate: Plate | null;
  readonly capturedAt: Date;
}

/** vehicle.v1 ResolveVehicleSnapshotRequestV1. */
export interface ResolveRequest {
  readonly owner: Owner;
  readonly vehicleId: string;
  readonly expectedRevision: number | null;
  readonly purpose: ResolvePurpose;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REVISION = 2_147_483_647;

function uuid(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !UUID.test(raw)) {
    throw new VehicleValidationError(field, 'INVALID_UUID');
  }
  return raw.toLowerCase();
}

export function parseResolveRequest(raw: unknown): ResolveRequest {
  const value = closedObject(raw, ['owner', 'vehicleId', 'expectedRevision', 'purpose'], '$');
  const owner = closedObject(value.owner, ['kind', 'subjectId'], '$.owner');
  if (owner.kind !== 'account' && owner.kind !== 'guest') {
    throw new VehicleValidationError('$.owner.kind', 'INVALID_ENUM');
  }
  const revision = value.expectedRevision;
  if (
    revision !== null &&
    (typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision > MAX_REVISION)
  ) {
    throw new VehicleValidationError('$.expectedRevision', 'INVALID_INTEGER');
  }
  const purpose = RESOLVE_PURPOSES.find((candidate) => candidate === value.purpose);
  if (!purpose) throw new VehicleValidationError('$.purpose', 'INVALID_ENUM');
  return {
    owner: { kind: owner.kind, subject: uuid(owner.subjectId, '$.owner.subjectId') },
    vehicleId: uuid(value.vehicleId, '$.vehicleId'),
    expectedRevision: revision,
    purpose,
  };
}

/**
 * An archived vehicle cannot be priced or booked again. Displaying an existing
 * booking may still resolve it, because the booking already references it.
 */
export function captureSnapshot(
  vehicle: Vehicle,
  purpose: ResolvePurpose,
  capturedAt: Date,
): VehicleSnapshot {
  if (vehicle.archived && purpose !== 'booking-display') {
    throw new VehicleRuleError('VEHICLE_ARCHIVED');
  }
  return {
    snapshotSchemaVersion: 1,
    source: 'saved',
    vehicleId: vehicle.id,
    vehicleRevision: vehicle.revision,
    type: vehicle.type,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    plate: vehicle.plate,
    capturedAt,
  };
}