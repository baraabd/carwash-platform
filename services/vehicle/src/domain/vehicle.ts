import { codePointLength, hasControlCharacters, latinDigits, singleLine } from './text';

/**
 * Saved-vehicle rules, mirroring the approved vehicle step and garage editor
 * (docs/customer/C004, C005).
 *
 * The plate is OPTIONAL and descriptive only: it is not proof of title and is
 * never globally unique. Two customers may save the same plate, and a plate
 * never links or merges records. Saving is explicit create plus update by id;
 * the prototype's upsert-by-plate is a deduplication behaviour that needs a
 * separate owner decision, so it is not reproduced on the server.
 */
export type VehicleErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_VEHICLE_TYPE'
  | 'INVALID_DISPLAY_NAME'
  | 'INVALID_PLATE'
  | 'INVALID_COLOR'
  | 'VEHICLE_LIMIT_REACHED'
  | 'VEHICLE_ARCHIVED';

export class VehicleDomainError extends Error {
  constructor(
    readonly code: VehicleErrorCode,
    readonly field?: string,
  ) {
    super(code);
    this.name = 'VehicleDomainError';
  }
}

/** The approved size alphabet, in the approved order. */
export const VEHICLE_TYPES = ['sedan', 'suv', 'large', 'pickup'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const DISPLAY_NAME_MAX = 60;
export const PLATE_MAX = 20;
export const COLOR_MAX = 30;

export type PrincipalKind = 'account' | 'guest';

/** The authenticated owner. Ownership comes from the session, never from a request field. */
export interface Owner {
  readonly kind: PrincipalKind;
  readonly subject: string;
}

export type VehicleStatus = 'ACTIVE' | 'ARCHIVED';

export interface VehicleDetails {
  readonly type: VehicleType;
  readonly displayName: string | null;
  readonly plate: string | null;
  readonly color: string | null;
}

export interface Vehicle extends VehicleDetails {
  readonly id: string;
  readonly owner: Owner;
  readonly status: VehicleStatus;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
}

export function parseVehicleType(raw: unknown): VehicleType {
  const found = VEHICLE_TYPES.find((type) => type === raw);
  if (!found) throw new VehicleDomainError('INVALID_VEHICLE_TYPE', 'type');
  return found;
}

function optionalText(
  raw: unknown,
  max: number,
  code: 'INVALID_DISPLAY_NAME' | 'INVALID_COLOR',
  field: string,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length > max * 4) throw new VehicleDomainError(code, field);
  const value = singleLine(raw);
  if (value.length === 0) return null;
  if (codePointLength(value) > max || hasControlCharacters(value)) {
    throw new VehicleDomainError(code, field);
  }
  return value;
}

/** Latin letters, Arabic letters (ء-ي), digits, spaces and hyphens. */
const PLATE = /^[A-Za-zء-ي0-9 -]{2,20}$/;

/**
 * Empty or absent means "no plate". Otherwise: Arabic-Indic digits become
 * Latin, the value is trimmed and inner whitespace collapsed, then it must be
 * 2-20 allowed characters with at least one digit. Letters keep their case.
 * Whitespace-only input is refused, as in the approved step.
 */
export function parsePlate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > PLATE_MAX * 4) {
    throw new VehicleDomainError('INVALID_PLATE', 'plate');
  }
  const value = latinDigits(raw.normalize('NFC')).trim().replace(/\s+/g, ' ');
  if (!PLATE.test(value) || !/[0-9]/.test(value)) {
    throw new VehicleDomainError('INVALID_PLATE', 'plate');
  }
  return value;
}

const FIELDS = ['type', 'displayName', 'plate', 'color'] as const;

function onlyKnownKeys(raw: Readonly<Record<string, unknown>>): void {
  const extra = Object.keys(raw).find((key) => !(FIELDS as readonly string[]).includes(key));
  if (extra !== undefined) throw new VehicleDomainError('INVALID_INPUT', extra);
}

export function parseVehicleDetails(raw: Readonly<Record<string, unknown>>): VehicleDetails {
  onlyKnownKeys(raw);
  return {
    type: parseVehicleType(raw.type),
    displayName: optionalText(
      raw.displayName,
      DISPLAY_NAME_MAX,
      'INVALID_DISPLAY_NAME',
      'displayName',
    ),
    plate: parsePlate(raw.plate),
    color: optionalText(raw.color, COLOR_MAX, 'INVALID_COLOR', 'color'),
  };
}

/** Partial update: absent keys keep their value; present keys are fully validated. */
export function applyVehicleChanges(
  current: Vehicle,
  raw: Readonly<Record<string, unknown>>,
): VehicleDetails {
  if (current.status === 'ARCHIVED') throw new VehicleDomainError('VEHICLE_ARCHIVED');
  onlyKnownKeys(raw);
  if (Object.keys(raw).length === 0) throw new VehicleDomainError('INVALID_INPUT');
  const pick = (key: (typeof FIELDS)[number]) =>
    Object.hasOwn(raw, key) ? raw[key] : current[key];
  return parseVehicleDetails({
    type: pick('type'),
    displayName: pick('displayName'),
    plate: pick('plate'),
    color: pick('color'),
  });
}

export function sameVehicleDetails(a: VehicleDetails, b: VehicleDetails): boolean {
  return (
    a.type === b.type &&
    a.displayName === b.displayName &&
    a.plate === b.plate &&
    a.color === b.color
  );
}
