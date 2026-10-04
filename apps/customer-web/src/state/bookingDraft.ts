import { isSlotAvailable } from './scheduling.ts';

export type VehicleTypeId = 'sedan' | 'suv' | 'large' | 'pickup';
export type CarePackageId = 'exterior' | 'complete' | 'premium';
export type CareExtraId = 'seats' | 'wheels' | 'fresh';
export type PaymentMethodId = 'cash' | 'sham' | 'syriatel';

/** The approved payment choices, in source order. The one closed list every check uses. */
export const PAYMENT_METHOD_IDS: readonly PaymentMethodId[] = Object.freeze([
  'cash',
  'sham',
  'syriatel',
]);

/**
 * Runtime check of a method id (the reference's `methodOf`). The type alone does
 * not protect a value read from a link or an old draft: unknown ids and prototype
 * keys such as `__proto__` are rejected.
 */
export function isPaymentMethodId(value: unknown): value is PaymentMethodId {
  return typeof value === 'string' && (PAYMENT_METHOD_IDS as readonly string[]).includes(value);
}

/** A slot the customer picked or was offered. Its availability is owned by Scheduling. */
export interface BookingSlot {
  readonly date: string;
  readonly time: string;
}

export type BookingPlaceKind = 'home' | 'work' | 'map' | 'gps' | 'manual';

/**
 * Where the pin sits on the illustrative map. `x`/`y` are positions in the
 * drawing (700×500), not geographic coordinates: the map is a picture, and a
 * device location is never stored here or anywhere else.
 */
export interface BookingPlace {
  readonly kind: BookingPlaceKind;
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

/**
 * The customer's unsent booking choices. A draft is never a booking: nothing is
 * created, reserved or charged until the review step is explicitly confirmed.
 */
export interface BookingDraft {
  readonly vehicleType: VehicleTypeId;
  /** The saved car these fields were copied from, if any. A link, not ownership. */
  readonly carId: string | null;
  readonly carName: string;
  readonly plate: string;
  readonly color: string;
  /** The customer's wish to keep this car for next time. Nothing is saved here. */
  readonly saveVehicle: boolean;
  readonly service: CarePackageId;
  readonly extras: readonly CareExtraId[];
  readonly address: string;
  readonly addressLabel: string;
  readonly locationNote: string;
  readonly place: BookingPlace | null;
  /** The customer's wish to keep this address for next time. Nothing is saved here. */
  readonly saveAddress: boolean;
  /**
   * The day the time step highlights. It can be set while no time is chosen, and
   * is null until scheduling first records one (the default is then derived from
   * the clock). A non-null `slot` is always on this day.
   */
  readonly scheduleDay: string | null;
  /** A complete appointment, or null. A day alone is not an appointment. */
  readonly slot: BookingSlot | null;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly note: string;
  readonly paymentMethod: PaymentMethodId | null;
  readonly touched: boolean;
}

export const BOOKING_FIRST_STEP = 0;
export const BOOKING_REVIEW_STEP = 6;

export function blankBookingDraft(): BookingDraft {
  return {
    vehicleType: 'sedan',
    carId: null,
    carName: '',
    plate: '',
    color: '',
    saveVehicle: true,
    service: 'exterior',
    extras: [],
    address: '',
    addressLabel: 'المنزل',
    locationNote: '',
    place: null,
    saveAddress: true,
    scheduleDay: null,
    slot: null,
    contactName: '',
    contactPhone: '',
    note: '',
    paymentMethod: null,
    touched: false,
  };
}

const ARABIC_INDIC_ZERO = 0x0660;
const EASTERN_ARABIC_INDIC_ZERO = 0x06f0;

// Arabic-Indic (U+0660–U+0669) and Eastern Arabic-Indic (U+06F0–U+06F9) digits.
function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - EASTERN_ARABIC_INDIC_ZERO));
}

export const PLATE_MAX_LENGTH = 20;

/**
 * What the draft stores for a typed plate: Arabic-Indic and Eastern Arabic-Indic
 * digits become Latin digits and the value is capped. Letters, spaces and hyphens
 * are kept exactly as typed, as in the approved reference.
 */
export function normalizePlateInput(value: string): string {
  return toLatinDigits(value).slice(0, PLATE_MAX_LENGTH);
}

/**
 * The plate is optional in the approved journey; when present it must look like
 * one: 2–20 Latin/Arabic letters, digits, spaces or hyphens with at least one
 * digit. Only a truly empty value counts as "left blank" — spaces alone do not.
 */
export function isPlateAcceptable(plate: string): boolean {
  const value = toLatinDigits(plate);
  return value === '' || (/^[A-Za-zء-ي0-9\s-]{2,20}$/.test(value) && /\d/.test(value));
}

/**
 * Booking name rule of the reference (`str(d.name).length<2`): at least two
 * characters once surrounding whitespace is removed. No other identity check.
 */
export function isContactNameAcceptable(name: string): boolean {
  return name.trim().length >= 2;
}

/**
 * Booking contact-number rule of the reference (`phoneOK`): after Arabic-Indic
 * and Eastern Arabic-Indic digits become Latin and spaces, parentheses and
 * hyphens are removed, an optional leading `+` and 8–15 digits. A demo format
 * check only — not reachability, ownership or E.164 validity. The typed value is
 * never rewritten by it.
 */
export function isContactPhoneAcceptable(phone: string): boolean {
  return /^\+?\d{8,15}$/.test(toLatinDigits(phone).replace(/[\s()-]/g, ''));
}

/**
 * The furthest step a draft may be entered at. Resuming or repeating never drops
 * the customer past a step whose required input is still missing, so no screen is
 * skipped and nothing is confirmed on their behalf.
 *
 * The appointment is judged at `now`: a time that is missing, malformed or no
 * longer offered sends the customer back to the time step.
 */
export function resolveBookingEntryStep(
  draft: BookingDraft,
  requestedStep: number,
  now: Date,
): number {
  const requested = Number.isFinite(requestedStep) ? Math.trunc(requestedStep) : BOOKING_FIRST_STEP;
  const step = Math.max(BOOKING_FIRST_STEP, Math.min(BOOKING_REVIEW_STEP, requested));
  if (step > 0 && !isPlateAcceptable(draft.plate)) return 0;
  if (step > 2 && draft.address.trim().length < 4) return 2;
  if (step > 3 && !(draft.slot && isSlotAvailable(now, draft.slot.date, draft.slot.time))) return 3;
  if (
    step > 4 &&
    (!isContactNameAcceptable(draft.contactName) || !isContactPhoneAcceptable(draft.contactPhone))
  )
    return 4;
  if (step > 5 && !isPaymentMethodId(draft.paymentMethod)) return 5;
  return step;
}
