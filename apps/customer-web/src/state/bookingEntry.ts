import {
  BOOKING_FIRST_STEP,
  BOOKING_REVIEW_STEP,
  resolveBookingEntryStep,
  type BookingDraft,
  type CarePackageId,
} from './bookingDraft.ts';
import {
  REPEAT_BOOKING_NOTICE,
  type CustomerOrderSnapshot,
  type CustomerSessionState,
  type SessionTransition,
} from './customerSession.ts';
import { prefillAddressFromBook } from './savedAddresses.ts';

/**
 * Entry commands into the booking journey. Each one only prepares the local
 * draft and says where to go next. None of them creates, submits or pays for a
 * booking — that stays an explicit confirmation on the review step, owned by the
 * booking sprints and, in production, by the Booking service.
 */

/** Primary CTA and package cards: begin (or continue editing) the draft at step one. */
export function startBooking(
  state: CustomerSessionState,
  service?: CarePackageId,
): SessionTransition {
  // A draft that describes no car yet starts with the first saved one, as in the
  // reference; a car the customer already chose or typed is never replaced.
  const firstSaved = state.vehicles[0];
  const describesNoCar = !state.draft.carId && !state.draft.carName && !state.draft.plate;
  const savedCar =
    firstSaved && describesNoCar
      ? {
          vehicleType: firstSaved.type,
          carId: firstSaved.id,
          carName: firstSaved.name,
          plate: firstSaved.plate,
          color: firstSaved.color,
        }
      : {};
  // Likewise a draft with no address starts with the first saved one.
  const draft: BookingDraft = {
    ...prefillAddressFromBook(state.draft, state.addresses),
    ...savedCar,
    service: service ?? state.draft.service,
    contactName: state.draft.contactName || state.profile.name,
    contactPhone: state.draft.contactPhone || state.profile.phone,
    touched: true,
  };
  return {
    state: { ...state, draft, bookingMode: 'standard' },
    intent: { kind: 'booking-step', step: BOOKING_FIRST_STEP },
  };
}

/** "أكمل": return to the step the saved draft was left at, never past missing input. */
export function resumeBooking(state: CustomerSessionState): SessionTransition {
  if (!state.draft.touched) return { state, intent: null };
  return {
    state: { ...state, bookingMode: 'standard' },
    intent: {
      kind: 'booking-step',
      step: resolveBookingEntryStep(state.draft, state.draftStep),
    },
  };
}

function draftFromOrder(order: CustomerOrderSnapshot, state: CustomerSessionState): BookingDraft {
  return {
    vehicleType: order.vehicleType,
    // An order keeps its own copy of the car; it is not linked to a saved one.
    carId: null,
    carName: order.carName,
    plate: order.plate,
    color: order.color,
    saveVehicle: true,
    service: order.service,
    extras: [...order.extras],
    address: order.address,
    addressLabel: order.addressLabel,
    locationNote: order.locationNote,
    // An order keeps the written address only; the pin starts from the default.
    place: null,
    saveAddress: true,
    // The finished order's slot is in the past and is never reused.
    slot: state.nextAvailableSlot,
    contactName: order.contactName,
    contactPhone: order.contactPhone,
    note: order.note,
    paymentMethod: order.paymentMethod,
    touched: true,
  };
}

/**
 * "نكرر نفس الغسلة؟": copy a past order's choices into the draft and send the
 * customer to review them. The order list is returned untouched: repeating
 * derives a draft only and the customer still has to confirm it themselves.
 */
export function repeatOrder(state: CustomerSessionState, orderId: string): SessionTransition {
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) return { state, intent: null };
  const draft = draftFromOrder(order, state);
  return {
    state: {
      ...state,
      draft,
      bookingMode: 'repeat',
      notice: { message: REPEAT_BOOKING_NOTICE, sequence: (state.notice?.sequence ?? 0) + 1 },
    },
    intent: { kind: 'booking-step', step: resolveBookingEntryStep(draft, BOOKING_REVIEW_STEP) },
  };
}

/** "متابعة": open tracking for an order that exists; unknown ids go nowhere. */
export function viewOrder(state: CustomerSessionState, orderId: string): SessionTransition {
  const exists = state.orders.some((order) => order.id === orderId);
  return { state, intent: exists ? { kind: 'order-tracking', orderId } : null };
}
