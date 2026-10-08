import { BookingError } from './errors';
import { transitionBooking, type BookingState as LifecycleState } from './lifecycle';
import { sameMoney, type Money } from './money';
import {
  samePrincipal,
  type AddressSnapshot,
  type ContactSnapshot,
  type PaymentMethod,
  type PrincipalRef,
  type QuoteSnapshot,
  type SlotSnapshot,
  type VehicleSnapshot,
} from './snapshots';

/**
 * The Booking aggregate.
 *
 * Booking owns the booking lifecycle and its immutable snapshots. It does not
 * own the customer, vehicle, address, catalog, price, capacity, payment or
 * technician records; those stay with their owners and are referenced by id
 * and revision only. Technician selection is Dispatch's and never stored here.
 *
 * A booking is created PENDING_CONFIRMATION by the creation saga and becomes
 * CONFIRMED only after Scheduling committed the hold to it (the pivot), or
 * REJECTED when the saga failed before the pivot.
 */
export type BookingStatus = LifecycleState;

export const REJECTION_REASONS = [
  'QUOTE_EXPIRED',
  'QUOTE_REVOKED',
  'QUOTE_INVALID',
  'OBLIGATION_REJECTED',
  'HOLD_EXPIRED',
  'HOLD_UNAVAILABLE',
  'DEADLINE_EXCEEDED',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** The hold the customer selected in step 4, as read from Scheduling before commit. */
export interface RequestedSlot {
  readonly holdId: string;
  readonly holdRevision: number;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface Booking {
  readonly id: string;
  readonly beneficiary: PrincipalRef;
  readonly status: BookingStatus;
  readonly rejectionReason: RejectionReason | null;
  readonly paymentMethod: PaymentMethod;
  readonly contact: ContactSnapshot;
  readonly vehicle: VehicleSnapshot;
  readonly address: AddressSnapshot;
  readonly quote: QuoteSnapshot;
  readonly requestedSlot: RequestedSlot;
  /** Set exactly when CONFIRMED (or later); equals the committed hold. */
  readonly slot: SlotSnapshot | null;
  readonly total: Money;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly confirmedAt: Date | null;
}

export interface NewBooking {
  readonly id: string;
  readonly beneficiary: PrincipalRef;
  readonly paymentMethod: PaymentMethod;
  readonly contact: ContactSnapshot;
  readonly vehicle: VehicleSnapshot;
  readonly address: AddressSnapshot;
  readonly quote: QuoteSnapshot;
  readonly requestedSlot: RequestedSlot;
  readonly now: Date;
}

/**
 * Cross-snapshot invariants checked before anything is persisted. A violation
 * means the inputs belong to different journeys; nothing is reserved yet.
 */
export function createBooking(input: NewBooking): Booking {
  const { quote, vehicle, requestedSlot } = input;
  if (!samePrincipal(quote.beneficiary, input.beneficiary)) {
    throw new BookingError('QUOTE_MISMATCH', 'The quote belongs to another principal.');
  }
  if (quote.vehicleType !== vehicle.type) {
    throw new BookingError(
      'QUOTE_MISMATCH',
      'The quote was priced for another vehicle type.',
      'VEHICLE_TYPE_MISMATCH',
    );
  }
  if (quote.zoneId !== null && quote.zoneId !== requestedSlot.zoneId) {
    throw new BookingError(
      'QUOTE_MISMATCH',
      'The quote was priced for another zone.',
      'ZONE_MISMATCH',
    );
  }
  if (requestedSlot.endsAt.getTime() <= requestedSlot.startsAt.getTime()) {
    throw new BookingError('INVALID_INPUT', 'The selected slot is empty.');
  }
  if (requestedSlot.startsAt.getTime() <= input.now.getTime()) {
    throw new BookingError(
      'INVALID_INPUT',
      'The selected slot has already started.',
      'SLOT_STARTED',
    );
  }
  return {
    id: input.id,
    beneficiary: input.beneficiary,
    status: 'PENDING_CONFIRMATION',
    rejectionReason: null,
    paymentMethod: input.paymentMethod,
    contact: input.contact,
    vehicle,
    address: input.address,
    quote,
    requestedSlot,
    slot: null,
    total: quote.total,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
    confirmedAt: null,
  };
}

/**
 * Whether a committed hold is exactly the slot the customer chose. Anything else
 * means the owner answered for a different hold or time; the booking must go to
 * reconciliation instead of being confirmed with a slot nobody selected.
 */
export function matchesRequestedSlot(booking: Booking, slot: SlotSnapshot): boolean {
  const requested = booking.requestedSlot;
  return (
    slot.holdId === requested.holdId &&
    slot.zoneId === requested.zoneId &&
    slot.startsAt.getTime() === requested.startsAt.getTime() &&
    slot.endsAt.getTime() === requested.endsAt.getTime()
  );
}

export function confirmBooking(booking: Booking, slot: SlotSnapshot, now: Date): Booking {
  if (!matchesRequestedSlot(booking, slot)) {
    throw new BookingError('INVALID_TRANSITION', 'The committed slot differs from the request.');
  }
  const next = transitionBooking(
    { id: booking.id, state: booking.status, version: booking.version },
    'CONFIRMED',
    booking.version,
  );
  return {
    ...booking,
    status: next.state,
    version: next.version,
    slot,
    updatedAt: now,
    confirmedAt: now,
  };
}

export function rejectBooking(booking: Booking, reason: RejectionReason, now: Date): Booking {
  const next = transitionBooking(
    { id: booking.id, state: booking.status, version: booking.version },
    'REJECTED',
    booking.version,
  );
  return {
    ...booking,
    status: next.state,
    version: next.version,
    rejectionReason: reason,
    updatedAt: now,
  };
}

/** Pricing's validated total must equal the snapshot the customer saw. */
export function totalMatches(booking: Booking, validatedTotal: Money): boolean {
  return sameMoney(booking.total, validatedTotal);
}
