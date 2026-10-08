import {
  CURRENCY_SCALE,
  QUOTE_LINE_KINDS,
  VEHICLE_TYPES,
  isCurrency,
  money,
  sumMoney,
  type AddressLocation,
  type AddressSnapshot,
  type Currency,
  type Money,
  type PrincipalRef,
  type QuoteLineSnapshot,
  type QuoteSnapshot,
  type VehicleSnapshot,
} from '../../domain';
import type { HoldView, QuoteRead } from '../../ports';

/**
 * Anti-corruption parsers for the PUBLISHED owner contracts Booking consumes:
 * pricing.v1 (QuoteV1, QuoteValidationV1), scheduling.v1 (HoldV1), vehicle.v1
 * (VehicleSnapshotV1) and customer.v1 (AddressSnapshotV1).
 *
 * Booking cannot import @carwash/contracts yet (the lockfile is Lane E's; see
 * CR-P02-C2 §2), so the rules are restated here as closed, fail-closed checks.
 * tests/production/C/booking-contract-parity.test.mjs runs these parsers and the
 * published ones over the same accepted and rejected documents; any divergence
 * fails the build. Once the dependency is granted this file is replaced by
 * imports, not extended.
 */
export class ContractViolation extends Error {
  constructor(readonly path: string) {
    super(`CONTRACT_VIOLATION ${path}`);
    this.name = 'ContractViolation';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MINOR = /^(0|-?[1-9][0-9]{0,17})$/;
const PLATE = /^[A-Z0-9٠-٩ء-ي-]+( [A-Z0-9٠-٩ء-ي-]+)*$/;
const COORDINATE = /^-?(0|[1-9][0-9]{0,2})\.[0-9]{6}$/;
const MAX_REVISION = 2_147_483_647;

function closed(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ContractViolation(path);
  const record = value as Record<string, unknown>;
  const present = Object.keys(record);
  if (present.length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) {
    throw new ContractViolation(path);
  }
  return record;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ContractViolation(path);
  return value.toLowerCase();
}

function optionalUuid(value: unknown, path: string): string | null {
  return value === null ? null : uuid(value, path);
}

function revision(value: unknown, path: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_REVISION
  ) {
    throw new ContractViolation(path);
  }
  return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ContractViolation(path);
  }
  return value;
}

function utc(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UTC.test(value)) throw new ContractViolation(path);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value)
    throw new ContractViolation(path);
  return value;
}

function isOneOf<const T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return allowed.includes(value);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
): T[number] {
  if (typeof value !== 'string' || !isOneOf(value, allowed)) throw new ContractViolation(path);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ContractViolation(path);
  return value;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
  });
}

function text(value: unknown, path: string, max: number, min = 1, pattern?: RegExp): string {
  if (typeof value !== 'string') throw new ContractViolation(path);
  const normalized = value.normalize('NFC');
  const length = [...normalized].length;
  if (length < min || length > max || hasControlCharacter(normalized))
    throw new ContractViolation(path);
  if (pattern && !pattern.test(normalized)) throw new ContractViolation(path);
  return normalized;
}

function optionalText(value: unknown, path: string, max: number, min = 1): string | null {
  if (value === null || value === undefined) return null;
  return text(value, path, max, min);
}

function principal(value: unknown, path: string): PrincipalRef {
  const v = closed(value, path, ['kind', 'subjectId']);
  return {
    kind: oneOf(v.kind, `${path}.kind`, ['account', 'guest'] as const),
    subjectId: uuid(v.subjectId, `${path}.subjectId`),
  };
}

function moneyValue(value: unknown, path: string, nonNegative: boolean): Money {
  const v = closed(value, path, ['currency', 'amountMinor', 'scale']);
  if (!isCurrency(v.currency)) throw new ContractViolation(`${path}.currency`);
  if (typeof v.amountMinor !== 'string' || !MINOR.test(v.amountMinor)) {
    throw new ContractViolation(`${path}.amountMinor`);
  }
  if (nonNegative && v.amountMinor.startsWith('-'))
    throw new ContractViolation(`${path}.amountMinor`);
  if (v.scale !== CURRENCY_SCALE[v.currency]) throw new ContractViolation(`${path}.scale`);
  return money(v.currency, BigInt(v.amountMinor));
}

/** Published common/money `Money`, non-negative. */
export function moneyFromWireStrict(value: unknown, path = '$'): Money {
  return moneyValue(value, path, true);
}

function quoteLine(value: unknown, path: string): QuoteLineSnapshot {
  const v = closed(value, path, [
    'lineId',
    'kind',
    'definitionId',
    'quantity',
    'unitPrice',
    'amount',
  ]);
  const kind = oneOf(v.kind, `${path}.kind`, QUOTE_LINE_KINDS);
  const definitionId = optionalUuid(v.definitionId, `${path}.definitionId`);
  if ((kind === 'PACKAGE' || kind === 'EXTRA') !== (definitionId !== null)) {
    throw new ContractViolation(`${path}.definitionId`);
  }
  const quantity = integer(v.quantity, `${path}.quantity`, 1, 10);
  const unitPrice = moneyValue(v.unitPrice, `${path}.unitPrice`, true);
  const amount = moneyValue(v.amount, `${path}.amount`, false);
  if (amount.currency !== unitPrice.currency) throw new ContractViolation(`${path}.amount`);
  const gross = unitPrice.amountMinor * BigInt(quantity);
  if (amount.amountMinor !== (kind === 'DISCOUNT' ? -gross : gross)) {
    throw new ContractViolation(`${path}.amount`);
  }
  return {
    lineId: uuid(v.lineId, `${path}.lineId`),
    kind,
    definitionId,
    quantity,
    unitPrice,
    amount,
  };
}

/** pricing.v1 QuoteV1, including exact line and total arithmetic. */
export function parseQuote(value: unknown, path = '$'): QuoteRead {
  const v = closed(value, path, [
    'quoteId',
    'revision',
    'status',
    'beneficiary',
    'vehicleType',
    'zoneId',
    'currency',
    'lines',
    'total',
    'catalogRevision',
    'priceBookRevision',
    'issuedAt',
    'expiresAt',
  ]);
  if (!isCurrency(v.currency)) throw new ContractViolation(`${path}.currency`);
  const currency: Currency = v.currency;
  if (!Array.isArray(v.lines) || v.lines.length === 0 || v.lines.length > 30) {
    throw new ContractViolation(`${path}.lines`);
  }
  const lines = v.lines.map((line: unknown, i: number) => quoteLine(line, `${path}.lines[${i}]`));
  if (new Set(lines.map((l) => l.lineId)).size !== lines.length)
    throw new ContractViolation(`${path}.lines`);
  if (lines.some((l) => l.amount.currency !== currency))
    throw new ContractViolation(`${path}.lines`);
  const total = moneyValue(v.total, `${path}.total`, true);
  if (total.currency !== currency) throw new ContractViolation(`${path}.total`);
  if (
    sumMoney(
      currency,
      lines.map((l) => l.amount),
    ).amountMinor !== total.amountMinor
  ) {
    throw new ContractViolation(`${path}.total`);
  }
  const issuedAt = utc(v.issuedAt, `${path}.issuedAt`);
  const expiresAt = utc(v.expiresAt, `${path}.expiresAt`);
  if (Date.parse(expiresAt) <= Date.parse(issuedAt))
    throw new ContractViolation(`${path}.expiresAt`);
  const snapshot: QuoteSnapshot = {
    quoteId: uuid(v.quoteId, `${path}.quoteId`),
    revision: revision(v.revision, `${path}.revision`),
    beneficiary: principal(v.beneficiary, `${path}.beneficiary`),
    vehicleType: oneOf(v.vehicleType, `${path}.vehicleType`, VEHICLE_TYPES),
    zoneId: optionalUuid(v.zoneId, `${path}.zoneId`),
    currency,
    lines,
    total,
    catalogRevision: revision(v.catalogRevision, `${path}.catalogRevision`),
    priceBookRevision: revision(v.priceBookRevision, `${path}.priceBookRevision`),
    issuedAt,
    expiresAt,
  };
  return {
    snapshot,
    status: oneOf(v.status, `${path}.status`, ['USABLE', 'EXPIRED', 'REVOKED'] as const),
  };
}

export const QUOTE_VALIDATION_REASONS = [
  'QUOTE_EXPIRED',
  'QUOTE_REVOKED',
  'REVISION_MISMATCH',
  'BENEFICIARY_MISMATCH',
] as const;

/** pricing.v1 QuoteValidationV1. */
export function parseQuoteValidation(value: unknown, path = '$') {
  const v = closed(value, path, ['quoteId', 'revision', 'valid', 'reason', 'total']);
  const valid = boolean(v.valid, `${path}.valid`);
  const reason =
    v.reason === null ? null : oneOf(v.reason, `${path}.reason`, QUOTE_VALIDATION_REASONS);
  if (valid !== (reason === null)) throw new ContractViolation(`${path}.valid`);
  return {
    quoteId: uuid(v.quoteId, `${path}.quoteId`),
    revision: revision(v.revision, `${path}.revision`),
    valid,
    reason,
    total: moneyValue(v.total, `${path}.total`, true),
  };
}

/** scheduling.v1 HoldV1. */
export function parseHold(value: unknown, path = '$'): HoldView {
  const v = closed(value, path, [
    'holdId',
    'revision',
    'state',
    'beneficiary',
    'zoneId',
    'startsAt',
    'endsAt',
    'expiresAt',
    'bookingId',
    'createdAt',
    'updatedAt',
  ]);
  const state = oneOf(v.state, `${path}.state`, [
    'HELD',
    'COMMITTED',
    'RELEASED',
    'EXPIRED',
  ] as const);
  const bookingId = optionalUuid(v.bookingId, `${path}.bookingId`);
  if ((state === 'COMMITTED') !== (bookingId !== null))
    throw new ContractViolation(`${path}.bookingId`);
  const startsAt = utc(v.startsAt, `${path}.startsAt`);
  const endsAt = utc(v.endsAt, `${path}.endsAt`);
  const minutes = (Date.parse(endsAt) - Date.parse(startsAt)) / 60_000;
  if (minutes < 5 || minutes > 480) throw new ContractViolation(path);
  utc(v.createdAt, `${path}.createdAt`);
  utc(v.updatedAt, `${path}.updatedAt`);
  return {
    holdId: uuid(v.holdId, `${path}.holdId`),
    revision: revision(v.revision, `${path}.revision`),
    state,
    beneficiary: principal(v.beneficiary, `${path}.beneficiary`),
    zoneId: uuid(v.zoneId, `${path}.zoneId`),
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    expiresAt: new Date(utc(v.expiresAt, `${path}.expiresAt`)),
    bookingId,
  };
}

function plate(value: unknown, path: string): VehicleSnapshot['plate'] {
  if (value === null) return null;
  const v = closed(value, path, ['text', 'region']);
  if (typeof v.text !== 'string') throw new ContractViolation(`${path}.text`);
  const normalized = v.text.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();
  return {
    text: text(normalized, `${path}.text`, 12, 1, PLATE),
    region: optionalText(v.region, `${path}.region`, 30),
  };
}

/** vehicle.v1 VehicleSnapshotV1. */
export function parseVehicleSnapshot(value: unknown, path = '$'): VehicleSnapshot {
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
  if (v.snapshotSchemaVersion !== 1) throw new ContractViolation(`${path}.snapshotSchemaVersion`);
  const source = oneOf(v.source, `${path}.source`, ['saved', 'inline'] as const);
  let vehicleId: string | null = null;
  let vehicleRevision: number | null = null;
  if (source === 'saved') {
    vehicleId = uuid(v.vehicleId, `${path}.vehicleId`);
    vehicleRevision = revision(v.vehicleRevision, `${path}.vehicleRevision`);
  } else if (v.vehicleId !== null || v.vehicleRevision !== null) {
    throw new ContractViolation(`${path}.vehicleId`);
  }
  return {
    snapshotSchemaVersion: 1,
    source,
    vehicleId,
    vehicleRevision,
    type: oneOf(v.type, `${path}.type`, VEHICLE_TYPES),
    make: optionalText(v.make, `${path}.make`, 40),
    model: optionalText(v.model, `${path}.model`, 40),
    color: optionalText(v.color, `${path}.color`, 40),
    plate: plate(v.plate, `${path}.plate`),
    capturedAt: utc(v.capturedAt, `${path}.capturedAt`),
  };
}

function coordinate(value: unknown, path: string, limit: number): string {
  if (typeof value !== 'string' || !COORDINATE.test(value) || value === '-0.000000') {
    throw new ContractViolation(path);
  }
  // Integer micro-degrees: an exact range check without binary floating point.
  const micro = BigInt(value.replace('.', ''));
  const bound = BigInt(limit) * 1_000_000n;
  if (micro < -bound || micro > bound) throw new ContractViolation(path);
  return value;
}

function location(value: unknown, path: string): AddressLocation {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ContractViolation(path);
  const mode = (value as { mode?: unknown }).mode;
  if (mode === 'manual') {
    const v = closed(value, path, ['mode', 'description']);
    return { mode, description: text(v.description, `${path}.description`, 300, 3) };
  }
  if (mode === 'coordinates') {
    const v = closed(value, path, ['mode', 'point', 'description']);
    const p = closed(v.point, `${path}.point`, ['latitude', 'longitude']);
    return {
      mode,
      point: {
        latitude: coordinate(p.latitude, `${path}.point.latitude`, 90),
        longitude: coordinate(p.longitude, `${path}.point.longitude`, 180),
      },
      description: optionalText(v.description, `${path}.description`, 300),
    };
  }
  throw new ContractViolation(`${path}.mode`);
}

/** customer.v1 AddressSnapshotV1. */
export function parseAddressSnapshot(value: unknown, path = '$'): AddressSnapshot {
  const v = closed(value, path, [
    'snapshotSchemaVersion',
    'addressId',
    'addressRevision',
    'location',
    'details',
    'capturedAt',
  ]);
  if (v.snapshotSchemaVersion !== 1) throw new ContractViolation(`${path}.snapshotSchemaVersion`);
  return {
    snapshotSchemaVersion: 1,
    addressId: uuid(v.addressId, `${path}.addressId`),
    addressRevision: revision(v.addressRevision, `${path}.addressRevision`),
    location: location(v.location, `${path}.location`),
    details: optionalText(v.details, `${path}.details`, 300),
    capturedAt: utc(v.capturedAt, `${path}.capturedAt`),
  };
}
