import type { OwnerContract } from '../common/route';
import { parseCoordinates, type Coordinates } from '../common/coordinates';
import {
  CURRENCIES,
  parseNonNegativeMoney,
  sumMoney,
  type Currency,
  type Money,
} from '../common/money';
import { PAYMENT_METHODS, type PaymentMethod } from '../common/payment-method';
import { parseSyrianMobile } from '../common/phone';
import { parsePrincipalRef, type PrincipalRef } from '../common/principal';
import { parsePage, parseRevision, type Page } from '../common/protocol';
import {
  BUSINESS_TIME_ZONES,
  parseUtc,
  type BusinessTimeZone,
  type UtcTimestamp,
} from '../common/time';
import { VEHICLE_TYPES, type VehicleType } from '../common/vehicle-type';
import {
  ContractViolation,
  closed,
  integer,
  list,
  oneOf,
  optionalText,
  text,
  uuid,
} from '../common/wire';
import { parseAddressLocationV1, type AddressLocationV1 } from '../customer/v1';
import { parseQuoteLineV1, type QuoteLineV1 } from '../pricing/v1';
import {
  parseInlineVehicleV1,
  parseVehicleSnapshotV1,
  type VehicleInputV1,
  type VehicleSnapshotV1,
} from '../vehicle/v1';

/**
 * booking.v1 — owner: Booking service (Lane C).
 *
 * A booking is created only from server facts the customer already obtained on
 * the seven approved screens: a Pricing quote, a Scheduling hold and a Geo
 * serviceability decision. The beneficiary is ALWAYS the authenticated
 * principal (account or guest); it is never taken from the request body.
 *
 * Booking state is a Booking fact. It never says that money arrived (Billing)
 * or that a technician is assigned (Dispatch).
 *
 * createBooking outcome semantics (owner must implement exactly):
 *   201 + CONFIRMED  quote valid, snapshots captured, hold committed.
 *   202 + PENDING    the hold commit outcome is UNKNOWN (timeout); Booking
 *                    reconciles it and the client polls getBooking. Never
 *                    reported as CONFIRMED until Scheduling confirms.
 *   409/422 + reason the request was refused; a REJECTED booking may be kept
 *                    for audit but no capacity is held for it.
 * The same Idempotency-Key with the same body replays the stored outcome.
 */
export const BOOKING_V1 = {
  id: 'booking.v1',
  owner: 'booking',
  prefix: '/internal/v1/booking',
  routes: {
    createBooking: { method: 'POST', path: '/bookings', access: 'principal', idempotent: true },
    listMine: { method: 'GET', path: '/bookings', access: 'principal', paged: true },
    getBooking: { method: 'GET', path: '/bookings/:bookingId', access: 'principal' },
    cancelBooking: {
      method: 'POST',
      path: '/bookings/:bookingId/cancel',
      access: 'principal',
      idempotent: true,
    },
    getRepeatDraft: {
      method: 'GET',
      path: '/bookings/:bookingId/repeat-draft',
      access: 'principal',
    },
  },
  reasons: [
    'QUOTE_EXPIRED',
    'QUOTE_REVOKED',
    'QUOTE_MISMATCH',
    'HOLD_EXPIRED',
    'HOLD_NOT_ACTIVE',
    'HOLD_MISMATCH',
    'NOT_SERVICEABLE',
    'SERVICEABILITY_EXPIRED',
    'VEHICLE_UNAVAILABLE',
    'ADDRESS_UNAVAILABLE',
    'BOOKING_NOT_CANCELLABLE',
  ],
} as const satisfies OwnerContract;

export const BOOKING_STATES = ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

/** Why a booking could not be confirmed. Mirrors the refusal reason of createBooking. */
export const BOOKING_REJECTION_REASONS = [
  'QUOTE_EXPIRED',
  'QUOTE_REVOKED',
  'QUOTE_MISMATCH',
  'HOLD_EXPIRED',
  'HOLD_NOT_ACTIVE',
  'HOLD_MISMATCH',
  'NOT_SERVICEABLE',
  'SERVICEABILITY_EXPIRED',
  'VEHICLE_UNAVAILABLE',
  'ADDRESS_UNAVAILABLE',
] as const;
export type BookingRejectionReason = (typeof BOOKING_REJECTION_REASONS)[number];

export const CANCELLATION_REASONS = ['CUSTOMER_REQUEST', 'OPERATIONS'] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

/** Human-facing booking number: WG- plus 8 Crockford base32 characters. Not a secret. */
const REFERENCE = /^WG-[0-9A-HJKMNP-TV-Z]{8}$/;
export const MAX_NOTES_LENGTH = 500;

export interface RefV1 {
  readonly id: string;
  readonly revision: number;
}

export type BookingVehicleInputV1 =
  | { readonly source: 'saved'; readonly vehicleId: string; readonly expectedRevision: number }
  | { readonly source: 'inline'; readonly vehicle: VehicleInputV1 };

export type BookingAddressInputV1 =
  | { readonly source: 'saved'; readonly addressId: string; readonly expectedRevision: number }
  | {
      readonly source: 'inline';
      readonly location: AddressLocationV1;
      readonly details: string | null;
    };

export interface BookingContactV1 {
  readonly displayName: string;
  /** Typed by the customer; ownership of the number is NOT verified by this field. */
  readonly phone: string;
}

export interface ServiceabilityRefV1 {
  readonly decisionId: string;
  readonly expectedZoneRevision: number;
  /** The pin the decision was made for; Geo re-validates it (POINT_MISMATCH). */
  readonly point: Coordinates;
}

export interface CreateBookingRequestV1 {
  readonly quoteRef: { readonly quoteId: string; readonly revision: number };
  readonly holdRef: { readonly holdId: string; readonly revision: number };
  readonly serviceability: ServiceabilityRefV1;
  readonly vehicle: BookingVehicleInputV1;
  readonly address: BookingAddressInputV1;
  readonly contact: BookingContactV1;
  readonly notes: string | null;
  readonly paymentMethod: PaymentMethod;
  /** The explicit confirmation on the review screen. Must be literally true. */
  readonly customerConfirmed: true;
}

/** Immutable address copy. `inline` = typed for this booking only, never saved. */
export interface BookingAddressSnapshotV1 {
  readonly snapshotSchemaVersion: 1;
  readonly source: 'saved' | 'inline';
  readonly addressId: string | null;
  readonly addressRevision: number | null;
  readonly location: AddressLocationV1;
  readonly details: string | null;
  readonly capturedAt: UtcTimestamp;
}

/** Immutable price copy of the validated quote. Never recomputed by Booking. */
export interface BookingPriceV1 {
  readonly quoteId: string;
  readonly quoteRevision: number;
  readonly catalogRevision: number;
  readonly priceBookRevision: number;
  readonly vehicleType: VehicleType;
  readonly currency: Currency;
  readonly lines: readonly QuoteLineV1[];
  readonly total: Money;
}

export interface BookingScheduleV1 {
  readonly holdId: string;
  readonly zoneId: string;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly timezone: BusinessTimeZone;
}

export interface BookingV1 {
  readonly bookingId: string;
  readonly reference: string;
  readonly revision: number;
  readonly state: BookingState;
  readonly beneficiary: PrincipalRef;
  readonly schedule: BookingScheduleV1;
  readonly serviceability: { readonly decisionId: string; readonly zoneRevision: number };
  readonly vehicle: VehicleSnapshotV1;
  readonly address: BookingAddressSnapshotV1;
  readonly contact: BookingContactV1;
  readonly notes: string | null;
  readonly price: BookingPriceV1;
  readonly paymentMethod: PaymentMethod;
  /** Non-null exactly when state is REJECTED. */
  readonly rejectionReason: BookingRejectionReason | null;
  /** Non-null exactly when state is CANCELLED. */
  readonly cancellation: {
    readonly reason: CancellationReason;
    readonly cancelledAt: UtcTimestamp;
  } | null;
  /** Non-null when the booking was ever CONFIRMED (CONFIRMED or CANCELLED). */
  readonly confirmedAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

/** List item: no contact, address or notes (personal data stays on the detail read). */
export interface BookingSummaryV1 {
  readonly bookingId: string;
  readonly reference: string;
  readonly revision: number;
  readonly state: BookingState;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly total: Money;
  readonly paymentMethod: PaymentMethod;
  readonly createdAt: UtcTimestamp;
}

export interface CancelBookingRequestV1 {
  readonly expectedRevision: number;
  readonly reason: 'CUSTOMER_REQUEST';
}

/**
 * Repeat booking: restores the details only. It carries NO time, hold or quote,
 * so a new availability choice and a new quote are always required and nothing
 * is booked automatically. Saved references carry no revision: the client
 * re-reads the current saved vehicle/address before using them.
 */
export interface RepeatDraftV1 {
  readonly sourceBookingId: string;
  readonly vehicle:
    | { readonly source: 'saved'; readonly vehicleId: string }
    | { readonly source: 'inline'; readonly vehicle: VehicleInputV1 };
  readonly address:
    | { readonly source: 'saved'; readonly addressId: string }
    | {
        readonly source: 'inline';
        readonly location: AddressLocationV1;
        readonly details: string | null;
      };
  readonly vehicleType: VehicleType;
  readonly selections: readonly { readonly definitionId: string; readonly quantity: number }[];
  readonly paymentMethod: PaymentMethod;
  readonly contact: BookingContactV1;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function ref(value: unknown, path: string, idField: 'quoteId' | 'holdId'): RefV1 {
  const v = closed(value, path, [idField, 'revision']);
  return {
    id: uuid(v[idField], `${path}.${idField}`),
    revision: parseRevision(v.revision, `${path}.revision`),
  };
}

function details(value: unknown, path: string): string | null {
  return optionalText(value, path, { max: 300 });
}

export function parseBookingContactV1(value: unknown, path: string): BookingContactV1 {
  const v = closed(value, path, ['displayName', 'phone']);
  return {
    displayName: text(v.displayName, `${path}.displayName`, { min: 2, max: 80 }),
    phone: parseSyrianMobile(v.phone, `${path}.phone`),
  };
}

function notes(value: unknown, path: string): string | null {
  return optionalText(value, path, { max: MAX_NOTES_LENGTH });
}

export function parseBookingVehicleInputV1(value: unknown, path: string): BookingVehicleInputV1 {
  const source = closed(
    value,
    path,
    ['source'],
    ['vehicleId', 'expectedRevision', 'vehicle'],
  ).source;
  if (source === 'saved') {
    const v = closed(value, path, ['source', 'vehicleId', 'expectedRevision']);
    return {
      source,
      vehicleId: uuid(v.vehicleId, `${path}.vehicleId`),
      expectedRevision: parseRevision(v.expectedRevision, `${path}.expectedRevision`),
    };
  }
  if (source === 'inline') {
    const v = closed(value, path, ['source', 'vehicle']);
    return { source, vehicle: parseInlineVehicleV1(v.vehicle, `${path}.vehicle`) };
  }
  throw new ContractViolation('INVALID_ENUM', `${path}.source`);
}

export function parseBookingAddressInputV1(value: unknown, path: string): BookingAddressInputV1 {
  const source = closed(
    value,
    path,
    ['source'],
    ['addressId', 'expectedRevision', 'location', 'details'],
  ).source;
  if (source === 'saved') {
    const v = closed(value, path, ['source', 'addressId', 'expectedRevision']);
    return {
      source,
      addressId: uuid(v.addressId, `${path}.addressId`),
      expectedRevision: parseRevision(v.expectedRevision, `${path}.expectedRevision`),
    };
  }
  if (source === 'inline') {
    const v = closed(value, path, ['source', 'location', 'details']);
    return {
      source,
      location: parseAddressLocationV1(v.location, `${path}.location`),
      details: details(v.details, `${path}.details`),
    };
  }
  throw new ContractViolation('INVALID_ENUM', `${path}.source`);
}

export function parseCreateBookingRequestV1(value: unknown): CreateBookingRequestV1 {
  const v = closed(value, '$', [
    'quoteRef',
    'holdRef',
    'serviceability',
    'vehicle',
    'address',
    'contact',
    'notes',
    'paymentMethod',
    'customerConfirmed',
  ]);
  if (v.customerConfirmed !== true) {
    throw new ContractViolation('CONFIRMATION_REQUIRED', '$.customerConfirmed');
  }
  const quote = ref(v.quoteRef, '$.quoteRef', 'quoteId');
  const hold = ref(v.holdRef, '$.holdRef', 'holdId');
  const s = closed(v.serviceability, '$.serviceability', [
    'decisionId',
    'expectedZoneRevision',
    'point',
  ]);
  return {
    quoteRef: { quoteId: quote.id, revision: quote.revision },
    holdRef: { holdId: hold.id, revision: hold.revision },
    serviceability: {
      decisionId: uuid(s.decisionId, '$.serviceability.decisionId'),
      expectedZoneRevision: parseRevision(
        s.expectedZoneRevision,
        '$.serviceability.expectedZoneRevision',
      ),
      point: parseCoordinates(s.point, '$.serviceability.point'),
    },
    vehicle: parseBookingVehicleInputV1(v.vehicle, '$.vehicle'),
    address: parseBookingAddressInputV1(v.address, '$.address'),
    contact: parseBookingContactV1(v.contact, '$.contact'),
    notes: notes(v.notes, '$.notes'),
    paymentMethod: oneOf(v.paymentMethod, '$.paymentMethod', PAYMENT_METHODS),
    customerConfirmed: true,
  };
}

export function parseBookingAddressSnapshotV1(
  value: unknown,
  path = '$',
): BookingAddressSnapshotV1 {
  const v = closed(value, path, [
    'snapshotSchemaVersion',
    'source',
    'addressId',
    'addressRevision',
    'location',
    'details',
    'capturedAt',
  ]);
  if (v.snapshotSchemaVersion !== 1) {
    throw new ContractViolation('UNSUPPORTED_SNAPSHOT', `${path}.snapshotSchemaVersion`);
  }
  const source = oneOf(v.source, `${path}.source`, ['saved', 'inline'] as const);
  let addressId: string | null = null;
  let addressRevision: number | null = null;
  if (source === 'saved') {
    addressId = uuid(v.addressId, `${path}.addressId`);
    addressRevision = parseRevision(v.addressRevision, `${path}.addressRevision`);
  } else if (v.addressId !== null || v.addressRevision !== null) {
    throw new ContractViolation('INLINE_SNAPSHOT_HAS_ADDRESS', `${path}.addressId`);
  }
  return {
    snapshotSchemaVersion: 1,
    source,
    addressId,
    addressRevision,
    location: parseAddressLocationV1(v.location, `${path}.location`),
    details: details(v.details, `${path}.details`),
    capturedAt: parseUtc(v.capturedAt, `${path}.capturedAt`),
  };
}

const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];

export function parseBookingPriceV1(value: unknown, path: string): BookingPriceV1 {
  const v = closed(value, path, [
    'quoteId',
    'quoteRevision',
    'catalogRevision',
    'priceBookRevision',
    'vehicleType',
    'currency',
    'lines',
    'total',
  ]);
  const currency = oneOf(v.currency, `${path}.currency`, CURRENCY_CODES);
  const lines = list(v.lines, `${path}.lines`, 30, parseQuoteLineV1);
  if (lines.length === 0) throw new ContractViolation('EMPTY_LIST', `${path}.lines`);
  if (lines.some((line) => line.amount.currency !== currency)) {
    throw new ContractViolation('CURRENCY_MISMATCH', `${path}.lines`);
  }
  const total = parseNonNegativeMoney(v.total, `${path}.total`);
  if (total.currency !== currency) {
    throw new ContractViolation('CURRENCY_MISMATCH', `${path}.total`);
  }
  const computed = sumMoney(
    currency,
    lines.map((line) => line.amount),
  );
  if (computed.amountMinor !== total.amountMinor) {
    throw new ContractViolation('TOTAL_MISMATCH', `${path}.total`);
  }
  return {
    quoteId: uuid(v.quoteId, `${path}.quoteId`),
    quoteRevision: parseRevision(v.quoteRevision, `${path}.quoteRevision`),
    catalogRevision: parseRevision(v.catalogRevision, `${path}.catalogRevision`),
    priceBookRevision: parseRevision(v.priceBookRevision, `${path}.priceBookRevision`),
    vehicleType: oneOf(v.vehicleType, `${path}.vehicleType`, VEHICLE_TYPES),
    currency,
    lines,
    total,
  };
}

function schedule(value: unknown, path: string): BookingScheduleV1 {
  const v = closed(value, path, ['holdId', 'zoneId', 'startsAt', 'endsAt', 'timezone']);
  const startsAt = parseUtc(v.startsAt, `${path}.startsAt`);
  const endsAt = parseUtc(v.endsAt, `${path}.endsAt`);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new ContractViolation('INVALID_INTERVAL', path);
  }
  return {
    holdId: uuid(v.holdId, `${path}.holdId`),
    zoneId: uuid(v.zoneId, `${path}.zoneId`),
    startsAt,
    endsAt,
    timezone: oneOf(v.timezone, `${path}.timezone`, BUSINESS_TIME_ZONES),
  };
}

function reference(value: unknown, path: string): string {
  return text(value, path, { max: 11, pattern: REFERENCE });
}

export function parseBookingV1(value: unknown, path = '$'): BookingV1 {
  const v = closed(value, path, [
    'bookingId',
    'reference',
    'revision',
    'state',
    'beneficiary',
    'schedule',
    'serviceability',
    'vehicle',
    'address',
    'contact',
    'notes',
    'price',
    'paymentMethod',
    'rejectionReason',
    'cancellation',
    'confirmedAt',
    'createdAt',
    'updatedAt',
  ]);
  const state = oneOf(v.state, `${path}.state`, BOOKING_STATES);
  const rejectionReason =
    v.rejectionReason === null
      ? null
      : oneOf(v.rejectionReason, `${path}.rejectionReason`, BOOKING_REJECTION_REASONS);
  let cancellation: BookingV1['cancellation'] = null;
  if (v.cancellation !== null) {
    const c = closed(v.cancellation, `${path}.cancellation`, ['reason', 'cancelledAt']);
    cancellation = {
      reason: oneOf(c.reason, `${path}.cancellation.reason`, CANCELLATION_REASONS),
      cancelledAt: parseUtc(c.cancelledAt, `${path}.cancellation.cancelledAt`),
    };
  }
  const confirmedAt =
    v.confirmedAt === null ? null : parseUtc(v.confirmedAt, `${path}.confirmedAt`);
  if ((state === 'REJECTED') !== (rejectionReason !== null)) {
    throw new ContractViolation('INCONSISTENT_BOOKING_STATE', `${path}.rejectionReason`);
  }
  if ((state === 'CANCELLED') !== (cancellation !== null)) {
    throw new ContractViolation('INCONSISTENT_BOOKING_STATE', `${path}.cancellation`);
  }
  // Only a confirmed booking can be cancelled, so CANCELLED keeps its confirmation time.
  if ((state === 'CONFIRMED' || state === 'CANCELLED') !== (confirmedAt !== null)) {
    throw new ContractViolation('INCONSISTENT_BOOKING_STATE', `${path}.confirmedAt`);
  }
  const s = closed(v.serviceability, `${path}.serviceability`, ['decisionId', 'zoneRevision']);
  const vehicle = parseVehicleSnapshotV1(v.vehicle, `${path}.vehicle`);
  const price = parseBookingPriceV1(v.price, `${path}.price`);
  if (price.vehicleType !== vehicle.type) {
    throw new ContractViolation('VEHICLE_TYPE_MISMATCH', `${path}.price.vehicleType`);
  }
  return {
    bookingId: uuid(v.bookingId, `${path}.bookingId`),
    reference: reference(v.reference, `${path}.reference`),
    revision: parseRevision(v.revision, `${path}.revision`),
    state,
    beneficiary: parsePrincipalRef(v.beneficiary, `${path}.beneficiary`),
    schedule: schedule(v.schedule, `${path}.schedule`),
    serviceability: {
      decisionId: uuid(s.decisionId, `${path}.serviceability.decisionId`),
      zoneRevision: parseRevision(s.zoneRevision, `${path}.serviceability.zoneRevision`),
    },
    vehicle,
    address: parseBookingAddressSnapshotV1(v.address, `${path}.address`),
    contact: parseBookingContactV1(v.contact, `${path}.contact`),
    notes: notes(v.notes, `${path}.notes`),
    price,
    paymentMethod: oneOf(v.paymentMethod, `${path}.paymentMethod`, PAYMENT_METHODS),
    rejectionReason,
    cancellation,
    confirmedAt,
    createdAt: parseUtc(v.createdAt, `${path}.createdAt`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

export function parseBookingSummaryV1(value: unknown, path = '$'): BookingSummaryV1 {
  const v = closed(value, path, [
    'bookingId',
    'reference',
    'revision',
    'state',
    'startsAt',
    'endsAt',
    'total',
    'paymentMethod',
    'createdAt',
  ]);
  const startsAt = parseUtc(v.startsAt, `${path}.startsAt`);
  const endsAt = parseUtc(v.endsAt, `${path}.endsAt`);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new ContractViolation('INVALID_INTERVAL', path);
  }
  return {
    bookingId: uuid(v.bookingId, `${path}.bookingId`),
    reference: reference(v.reference, `${path}.reference`),
    revision: parseRevision(v.revision, `${path}.revision`),
    state: oneOf(v.state, `${path}.state`, BOOKING_STATES),
    startsAt,
    endsAt,
    total: parseNonNegativeMoney(v.total, `${path}.total`),
    paymentMethod: oneOf(v.paymentMethod, `${path}.paymentMethod`, PAYMENT_METHODS),
    createdAt: parseUtc(v.createdAt, `${path}.createdAt`),
  };
}

export function parseBookingPageV1(value: unknown, path = '$'): Page<BookingSummaryV1> {
  return parsePage(value, path, parseBookingSummaryV1);
}

export function parseCancelBookingRequestV1(value: unknown): CancelBookingRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'reason']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    reason: oneOf(v.reason, '$.reason', ['CUSTOMER_REQUEST'] as const),
  };
}

export function parseRepeatDraftV1(value: unknown, path = '$'): RepeatDraftV1 {
  const v = closed(value, path, [
    'sourceBookingId',
    'vehicle',
    'address',
    'vehicleType',
    'selections',
    'paymentMethod',
    'contact',
  ]);
  const vehicleSource = closed(
    v.vehicle,
    `${path}.vehicle`,
    ['source'],
    ['vehicleId', 'vehicle'],
  ).source;
  let vehicle: RepeatDraftV1['vehicle'];
  if (vehicleSource === 'saved') {
    const x = closed(v.vehicle, `${path}.vehicle`, ['source', 'vehicleId']);
    vehicle = { source: 'saved', vehicleId: uuid(x.vehicleId, `${path}.vehicle.vehicleId`) };
  } else if (vehicleSource === 'inline') {
    const x = closed(v.vehicle, `${path}.vehicle`, ['source', 'vehicle']);
    vehicle = {
      source: 'inline',
      vehicle: parseInlineVehicleV1(x.vehicle, `${path}.vehicle.vehicle`),
    };
  } else throw new ContractViolation('INVALID_ENUM', `${path}.vehicle.source`);
  const addressSource = closed(
    v.address,
    `${path}.address`,
    ['source'],
    ['addressId', 'location', 'details'],
  ).source;
  let address: RepeatDraftV1['address'];
  if (addressSource === 'saved') {
    const x = closed(v.address, `${path}.address`, ['source', 'addressId']);
    address = { source: 'saved', addressId: uuid(x.addressId, `${path}.address.addressId`) };
  } else if (addressSource === 'inline') {
    const x = closed(v.address, `${path}.address`, ['source', 'location', 'details']);
    address = {
      source: 'inline',
      location: parseAddressLocationV1(x.location, `${path}.address.location`),
      details: details(x.details, `${path}.address.details`),
    };
  } else throw new ContractViolation('INVALID_ENUM', `${path}.address.source`);
  const selections = list(v.selections, `${path}.selections`, 20, (entry, at) => {
    const s = closed(entry, at, ['definitionId', 'quantity']);
    return {
      definitionId: uuid(s.definitionId, `${at}.definitionId`),
      quantity: integer(s.quantity, `${at}.quantity`, 1, 10),
    };
  });
  if (selections.length === 0) throw new ContractViolation('EMPTY_LIST', `${path}.selections`);
  if (new Set(selections.map((s) => s.definitionId)).size !== selections.length) {
    throw new ContractViolation('DUPLICATE_ITEM', `${path}.selections`);
  }
  const vehicleType = oneOf(v.vehicleType, `${path}.vehicleType`, VEHICLE_TYPES);
  if (vehicle.source === 'inline' && vehicle.vehicle.type !== vehicleType) {
    throw new ContractViolation('VEHICLE_TYPE_MISMATCH', `${path}.vehicleType`);
  }
  return {
    sourceBookingId: uuid(v.sourceBookingId, `${path}.sourceBookingId`),
    vehicle,
    address,
    vehicleType,
    selections,
    paymentMethod: oneOf(v.paymentMethod, `${path}.paymentMethod`, PAYMENT_METHODS),
    contact: parseBookingContactV1(v.contact, `${path}.contact`),
  };
}
