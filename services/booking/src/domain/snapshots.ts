import { invalid } from './errors';
import type { Currency, Money } from './money';

/**
 * Immutable copies captured into a booking at creation time.
 *
 * Booking owns the booking, not the source records: a later edit of the
 * customer's address, vehicle, the catalog or the price book never changes a
 * booking. Snapshots that come from an owner service (vehicle, address, quote)
 * keep the owner's ids and revisions so the origin stays traceable. The
 * database refuses any UPDATE of a snapshot column (see the migration).
 */

export const PRINCIPAL_KINDS = ['account', 'guest'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export interface PrincipalRef {
  readonly kind: PrincipalKind;
  /** Identity subject UUID, lower case. Never a phone, email or name. */
  readonly subjectId: string;
}

export const VEHICLE_TYPES = ['sedan', 'suv', 'large', 'pickup'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const PAYMENT_METHODS = ['CASH_ON_COMPLETION', 'SHAM_CASH', 'SYRIATEL_CASH'] as const;
/** The customer's choice only; whether money arrived is Billing's server fact. */
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Step 5 ("بياناتك"): who the technician contacts. Personal data, never evented. */
export interface ContactSnapshot {
  readonly name: string;
  /** Normalised E.164 form, e.g. +963912345678. */
  readonly phone: string;
  readonly notes: string | null;
}

export interface PlateSnapshot {
  readonly text: string;
  readonly region: string | null;
}

/** Same field set as vehicle.v1 `VehicleSnapshotV1`. The plate stays optional. */
export interface VehicleSnapshot {
  readonly snapshotSchemaVersion: 1;
  readonly source: 'saved' | 'inline';
  readonly vehicleId: string | null;
  readonly vehicleRevision: number | null;
  readonly type: VehicleType;
  readonly make: string | null;
  readonly model: string | null;
  readonly color: string | null;
  readonly plate: PlateSnapshot | null;
  readonly capturedAt: string;
}

export type AddressLocation =
  | { readonly mode: 'manual'; readonly description: string }
  | {
      readonly mode: 'coordinates';
      readonly point: { readonly latitude: string; readonly longitude: string };
      readonly description: string | null;
    };

/** Same field set as customer.v1 `AddressSnapshotV1`. */
export interface AddressSnapshot {
  readonly snapshotSchemaVersion: 1;
  readonly addressId: string;
  readonly addressRevision: number;
  readonly location: AddressLocation;
  readonly details: string | null;
  readonly capturedAt: string;
}

export const QUOTE_LINE_KINDS = [
  'PACKAGE',
  'EXTRA',
  'VEHICLE_SURCHARGE',
  'DISCOUNT',
  'FEE',
  'TAX',
] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export interface QuoteLineSnapshot {
  readonly lineId: string;
  readonly kind: QuoteLineKind;
  /** Catalog definition selected by the customer (package/extra), else null. */
  readonly definitionId: string | null;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly amount: Money;
}

/** The priced catalog selection exactly as Pricing issued it (pricing.v1 QuoteV1). */
export interface QuoteSnapshot {
  readonly quoteId: string;
  readonly revision: number;
  readonly beneficiary: PrincipalRef;
  readonly vehicleType: VehicleType;
  readonly zoneId: string | null;
  readonly currency: Currency;
  readonly lines: readonly QuoteLineSnapshot[];
  readonly total: Money;
  readonly catalogRevision: number;
  readonly priceBookRevision: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/** The committed slot, as returned by Scheduling when the hold was committed. */
export interface SlotSnapshot {
  readonly holdId: string;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLATE = /^[A-Z0-9٠-٩ء-ي-]+( [A-Z0-9٠-٩ء-ي-]+)*$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function uuidField(value: unknown, field: string): string {
  if (!isUuid(value)) throw invalid(`${field} must be a UUID.`);
  return value.toLowerCase();
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
  });
}

/** NFC, trimmed, inner whitespace collapsed, control characters refused. */
export function cleanText(
  value: unknown,
  field: string,
  limits: { readonly min: number; readonly max: number },
): string {
  if (typeof value !== 'string') throw invalid(`${field} must be a string.`);
  const normalized = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...normalized].length;
  if (length < limits.min || length > limits.max || hasControlCharacter(normalized)) {
    throw invalid(`${field} must contain ${limits.min}-${limits.max} printable characters.`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  field: string,
  limits: { readonly min: number; readonly max: number },
): string | null {
  if (value === null || value === undefined) return null;
  return cleanText(value, field, limits);
}

/**
 * Syrian mobile numbers in local (09…), national (9…) or international form
 * (+963 / 00963) become +963XXXXXXXXX. Any other international number must be
 * given with its "+" and is kept as E.164. Nothing is guessed beyond that.
 */
export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32) throw invalid('phone must be a string.');
  const compact = value.replace(/[\s().-]/g, '');
  let e164: string;
  if (/^09\d{8}$/.test(compact)) e164 = `+963${compact.slice(1)}`;
  else if (/^9\d{8}$/.test(compact)) e164 = `+963${compact}`;
  else if (/^00963\d{9}$/.test(compact)) e164 = `+${compact.slice(2)}`;
  else if (/^\+[1-9]\d{7,14}$/.test(compact)) e164 = compact;
  else throw invalid('phone is not a valid number.');
  if (e164.startsWith('+963') && !/^\+9639\d{8}$/.test(e164)) {
    throw invalid('phone is not a valid Syrian mobile number.');
  }
  return e164;
}

export function contactSnapshot(input: {
  readonly name: unknown;
  readonly phone: unknown;
  readonly notes: unknown;
}): ContactSnapshot {
  return {
    name: cleanText(input.name, 'contact.name', { min: 2, max: 80 }),
    phone: normalizePhone(input.phone),
    notes: optionalText(input.notes, 'contact.notes', { min: 1, max: 500 }),
  };
}

function isVehicleType(value: unknown): value is VehicleType {
  return typeof value === 'string' && VEHICLE_TYPES.some((type) => type === value);
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && PAYMENT_METHODS.some((method) => method === value);
}

/**
 * A one-time vehicle typed into the booking and never saved (vehicle.v1
 * `source: inline`). The plate is optional in the approved journey.
 */
export function inlineVehicleSnapshot(input: unknown, capturedAt: Date): VehicleSnapshot {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalid('vehicle.inline must be an object.');
  }
  const v = input as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!['type', 'make', 'model', 'color', 'plate'].includes(key)) {
      throw invalid(`vehicle.inline has unexpected field ${key.slice(0, 40)}.`);
    }
  }
  if (!isVehicleType(v.type)) throw invalid('vehicle.inline.type is not supported.');
  let plate: PlateSnapshot | null = null;
  if (v.plate !== null && v.plate !== undefined) {
    if (typeof v.plate !== 'object' || Array.isArray(v.plate)) {
      throw invalid('vehicle.inline.plate must be an object.');
    }
    const p = v.plate as Record<string, unknown>;
    for (const key of Object.keys(p)) {
      if (key !== 'text' && key !== 'region') throw invalid('vehicle.inline.plate is invalid.');
    }
    const text = cleanText(p.text, 'vehicle.inline.plate.text', { min: 1, max: 12 }).toUpperCase();
    if (!PLATE.test(text)) throw invalid('vehicle.inline.plate.text is invalid.');
    plate = {
      text,
      region: optionalText(p.region, 'vehicle.inline.plate.region', { min: 1, max: 30 }),
    };
  }
  return {
    snapshotSchemaVersion: 1,
    source: 'inline',
    vehicleId: null,
    vehicleRevision: null,
    type: v.type,
    make: optionalText(v.make, 'vehicle.inline.make', { min: 1, max: 40 }),
    model: optionalText(v.model, 'vehicle.inline.model', { min: 1, max: 40 }),
    color: optionalText(v.color, 'vehicle.inline.color', { min: 1, max: 40 }),
    plate,
    capturedAt: capturedAt.toISOString(),
  };
}

export function samePrincipal(a: PrincipalRef, b: PrincipalRef): boolean {
  return a.kind === b.kind && a.subjectId.toLowerCase() === b.subjectId.toLowerCase();
}
