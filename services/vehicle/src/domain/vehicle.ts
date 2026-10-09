import { VehicleRuleError, VehicleValidationError } from './errors';
import { codePointLength, hasControlCharacters, singleLine } from './text';

/**
 * Saved-vehicle rules of vehicle.v1 (packages/contracts vehicle/v1.ts).
 *
 * The plate is OPTIONAL and descriptive only: it is not proof of title and is
 * never globally unique. Two principals may save the same plate, and a plate
 * never links, merges or authorizes records. Saving is explicit create plus
 * update by id; the prototype's upsert-by-plate is not reproduced.
 *
 * Every rule here accepts no more than the published contract parser accepts.
 * Where the provider is stricter (free text is trimmed and inner whitespace
 * collapsed, so whitespace-only text is refused) the difference is documented
 * in docs/production/A/P02-A2_VEHICLE_V1_PROVIDER.md.
 */

/** The approved size alphabet, in the approved order (common/vehicle-type). */
export const VEHICLE_TYPES = ['sedan', 'suv', 'large', 'pickup'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/** vehicle.v1 MAX_SAVED_VEHICLES: the limit on ACTIVE saved vehicles per principal. */
export const MAX_SAVED_VEHICLES = 10;
export const VEHICLE_TEXT_MAX = 40;
export const PLATE_TEXT_MAX = 12;
export const PLATE_REGION_MAX = 30;

/**
 * vehicle.v1 normalized plate: uppercase Latin letters, Arabic letters, ASCII
 * and Arabic-Indic digits and '-', single inner spaces, no outer space.
 */
const PLATE = /^[A-Z0-9٠-٩ء-ي-]+( [A-Z0-9٠-٩ء-ي-]+)*$/;

export type PrincipalKind = 'account' | 'guest';

/** The authenticated owner. Ownership comes from the session, never from a request field. */
export interface Owner {
  readonly kind: PrincipalKind;
  readonly subject: string;
}

export interface Plate {
  readonly text: string;
  readonly region: string | null;
}

/** vehicle.v1 VehicleInputV1. */
export interface VehicleInput {
  readonly type: VehicleType;
  readonly make: string | null;
  readonly model: string | null;
  readonly color: string | null;
  readonly nickname: string | null;
  readonly plate: Plate | null;
}

export interface Vehicle extends VehicleInput {
  readonly id: string;
  readonly owner: Owner;
  readonly archived: boolean;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
}

export const INPUT_KEYS = ['type', 'make', 'model', 'color', 'nickname', 'plate'] as const;

/** Closed object: every listed key present, nothing else. */
export function closedObject(
  raw: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new VehicleValidationError(field, 'EXPECTED_OBJECT');
  }
  const value = raw as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new VehicleValidationError(`${field}.${key}`, 'MISSING_FIELD');
    }
  }
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra !== undefined) {
    throw new VehicleValidationError(`${field}.${extra}`, 'UNEXPECTED_FIELD');
  }
  return value;
}

export function parseVehicleType(raw: unknown, field = '$.type'): VehicleType {
  const found = VEHICLE_TYPES.find((type) => type === raw);
  if (!found) throw new VehicleValidationError(field, 'INVALID_ENUM');
  return found;
}

/** Optional single-line text: null stays null; stored trimmed with inner whitespace collapsed. */
function optionalText(raw: unknown, max: number, field: string): string | null {
  if (raw === null) return null;
  if (typeof raw !== 'string') throw new VehicleValidationError(field, 'EXPECTED_STRING');
  if (raw.length > max * 4) throw new VehicleValidationError(field, 'INVALID_LENGTH');
  // Checked before whitespace collapsing, so a vertical tab is refused as the
  // contract refuses it instead of silently becoming a space.
  if (hasControlCharacters(raw)) throw new VehicleValidationError(field, 'INVALID_CHARACTERS');
  const value = singleLine(raw);
  const length = codePointLength(value);
  if (length < 1 || length > max) throw new VehicleValidationError(field, 'INVALID_LENGTH');
  return value;
}

/** vehicle.v1 normalizePlateText: NFC, trimmed, inner whitespace collapsed, uppercase. */
export function normalizePlateText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function parsePlate(raw: unknown, field = '$.plate'): Plate | null {
  if (raw === null) return null;
  const value = closedObject(raw, ['text', 'region'], field);
  if (typeof value.text !== 'string') {
    throw new VehicleValidationError(`${field}.text`, 'EXPECTED_STRING');
  }
  if (value.text.length > PLATE_TEXT_MAX * 4) {
    throw new VehicleValidationError(`${field}.text`, 'INVALID_LENGTH');
  }
  const text = normalizePlateText(value.text);
  const length = codePointLength(text);
  if (length < 1 || length > PLATE_TEXT_MAX) {
    throw new VehicleValidationError(`${field}.text`, 'INVALID_LENGTH');
  }
  if (!PLATE.test(text)) throw new VehicleValidationError(`${field}.text`, 'INVALID_FORMAT');
  return { text, region: optionalText(value.region, PLATE_REGION_MAX, `${field}.region`) };
}

/** Full VehicleInputV1. An update replaces the whole input (closed object). */
export function parseVehicleInput(raw: unknown, field = '$'): VehicleInput {
  const value = closedObject(raw, INPUT_KEYS, field);
  return {
    type: parseVehicleType(value.type, `${field}.type`),
    make: optionalText(value.make, VEHICLE_TEXT_MAX, `${field}.make`),
    model: optionalText(value.model, VEHICLE_TEXT_MAX, `${field}.model`),
    color: optionalText(value.color, VEHICLE_TEXT_MAX, `${field}.color`),
    nickname: optionalText(value.nickname, VEHICLE_TEXT_MAX, `${field}.nickname`),
    plate: parsePlate(value.plate, `${field}.plate`),
  };
}

export function assertEditable(vehicle: Vehicle): void {
  if (vehicle.archived) throw new VehicleRuleError('VEHICLE_ARCHIVED');
}

export function assertBelowLimit(activeVehicles: number): void {
  if (activeVehicles >= MAX_SAVED_VEHICLES) throw new VehicleRuleError('VEHICLE_LIMIT_REACHED');
}

export function sameVehicleInput(a: VehicleInput, b: VehicleInput): boolean {
  return (
    a.type === b.type &&
    a.make === b.make &&
    a.model === b.model &&
    a.color === b.color &&
    a.nickname === b.nickname &&
    (a.plate === null || b.plate === null
      ? a.plate === b.plate
      : a.plate.text === b.plate.text && a.plate.region === b.plate.region)
  );
}

export function vehicleInputOf(vehicle: Vehicle): VehicleInput {
  return {
    type: vehicle.type,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    nickname: vehicle.nickname,
    plate: vehicle.plate,
  };
}
