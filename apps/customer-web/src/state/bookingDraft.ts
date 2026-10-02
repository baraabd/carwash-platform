export type VehicleTypeId = 'sedan' | 'suv' | 'large' | 'pickup';
export type CarePackageId = 'exterior' | 'complete' | 'premium';
export type CareExtraId = 'seats' | 'wheels' | 'fresh';
export type PaymentMethodId = 'cash' | 'sham' | 'syriatel';

/** A slot the customer picked or was offered. Its availability is owned by Scheduling. */
export interface BookingSlot {
  readonly date: string;
  readonly time: string;
}

/**
 * The customer's unsent booking choices. A draft is never a booking: nothing is
 * created, reserved or charged until the review step is explicitly confirmed.
 */
export interface BookingDraft {
  readonly vehicleType: VehicleTypeId;
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
    carName: '',
    plate: '',
    color: '',
    saveVehicle: true,
    service: 'exterior',
    extras: [],
    address: '',
    addressLabel: 'المنزل',
    locationNote: '',
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

function isPhoneAcceptable(phone: string): boolean {
  return /^\+?\d{8,15}$/.test(toLatinDigits(phone).replace(/[\s()-]/g, ''));
}

/**
 * The furthest step a draft may be entered at. Resuming or repeating never drops
 * the customer past a step whose required input is still missing, so no screen is
 * skipped and nothing is confirmed on their behalf.
 */
export function resolveBookingEntryStep(draft: BookingDraft, requestedStep: number): number {
  const requested = Number.isFinite(requestedStep) ? Math.trunc(requestedStep) : BOOKING_FIRST_STEP;
  const step = Math.max(BOOKING_FIRST_STEP, Math.min(BOOKING_REVIEW_STEP, requested));
  if (step > 0 && !isPlateAcceptable(draft.plate)) return 0;
  if (step > 2 && draft.address.trim().length < 4) return 2;
  if (step > 3 && draft.slot === null) return 3;
  if (step > 4 && (draft.contactName.trim().length < 2 || !isPhoneAcceptable(draft.contactPhone)))
    return 4;
  if (step > 5 && draft.paymentMethod === null) return 5;
  return step;
}
