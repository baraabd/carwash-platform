import {
  blankBookingDraft,
  BOOKING_FIRST_STEP,
  BOOKING_REVIEW_STEP,
  isCareExtraId,
  isCarePackageId,
  isPaymentMethodId,
  isVehicleTypeId,
  resolveBookingEntryStep,
  type BookingDraft,
  type BookingSlot,
  type CarePackageId,
} from './bookingDraft.ts';
import {
  REPEAT_BOOKING_NOTICE,
  type CustomerOrderSnapshot,
  type CustomerSessionState,
  type SessionTransition,
} from './customerSession.ts';
import { prefillAddressFromBook } from './savedAddresses.ts';
import { draftWithCurrentSchedule } from './scheduleStep.ts';
import { defaultScheduleDay, earliestSlot } from './scheduling.ts';

/**
 * Entry commands into the booking journey. Each one only prepares the local
 * draft and says where to go next. None of them creates, submits or pays for a
 * booking — that stays an explicit confirmation on the review step, owned by the
 * booking sprints and, in production, by the Booking service.
 */

/** Primary CTA and package cards: begin (or continue editing) the draft at step one. */
export function startBooking(
  state: CustomerSessionState,
  service: CarePackageId | undefined,
  now: Date,
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
  // A day that is no longer offered is replaced by the default day, without a time.
  const draft: BookingDraft = {
    ...draftWithCurrentSchedule(prefillAddressFromBook(state.draft, state.addresses), now),
    ...savedCar,
    service: service ?? state.draft.service,
    contactName: state.draft.contactName || state.profile.name,
    contactPhone: state.draft.contactPhone || state.profile.phone,
    touched: true,
  };
  return {
    // Every entry starts outside Review's edit mode, as the reference's `go()` does.
    state: { ...state, draft, bookingMode: 'standard', reviewEditing: false },
    intent: { kind: 'booking-step', step: BOOKING_FIRST_STEP },
  };
}

/** "أكمل": return to the step the saved draft was left at, never past missing input. */
export function resumeBooking(state: CustomerSessionState, now: Date): SessionTransition {
  if (!state.draft.touched) return { state, intent: null };
  return {
    state: { ...state, bookingMode: 'standard', reviewEditing: false },
    intent: {
      kind: 'booking-step',
      step: resolveBookingEntryStep(state.draft, state.draftStep, now),
    },
  };
}

function draftFromOrder(
  order: CustomerOrderSnapshot,
  now: Date,
  slot: BookingSlot | null,
): BookingDraft {
  // A stored order is read like the reference's cleanDraft(): an unknown size or
  // package falls back to the blank draft's, unknown add-ons are dropped and each
  // add-on is kept once. Review shows the result before anything is confirmed.
  const blank = blankBookingDraft();
  const place = order.confirmation?.place ?? null;
  return {
    vehicleType: isVehicleTypeId(order.vehicleType) ? order.vehicleType : blank.vehicleType,
    // An order keeps its own copy of the car; it is not linked to a saved one.
    carId: null,
    carName: order.carName,
    plate: order.plate,
    color: order.color,
    saveVehicle: true,
    service: isCarePackageId(order.service) ? order.service : blank.service,
    extras: Array.isArray(order.extras) ? [...new Set(order.extras.filter(isCareExtraId))] : [],
    address: order.address,
    addressLabel: order.addressLabel,
    locationNote: order.locationNote,
    // An order confirmed in this session recorded its pin; older orders keep the
    // written address only and the pin starts from the default.
    place: place ? { ...place } : null,
    saveAddress: true,
    scheduleDay: slot?.date ?? defaultScheduleDay(now),
    slot,
    contactName: order.contactName,
    contactPhone: order.contactPhone,
    note: order.note,
    // As the reference's `cleanDraft`: an unknown method is not carried over.
    paymentMethod: isPaymentMethodId(order.paymentMethod) ? order.paymentMethod : null,
    touched: true,
  };
}

/**
 * "نكرر نفس الغسلة؟": copy a past order's choices into the draft and send the
 * customer to review them. The order list is returned untouched: repeating
 * derives a draft only and the customer still has to confirm it themselves.
 */
export function repeatOrder(
  state: CustomerSessionState,
  orderId: string,
  now: Date,
  /**
   * The appointment offered with the copy. The finished order's slot is in the past
   * and is never reused: by default this is the earliest slot offered at `now`, or
   * none. Passing it explicitly is a test seam for the "nothing offered" branch,
   * which the demo catalog never reaches.
   */
  offeredSlot: BookingSlot | null = earliestSlot(now),
): SessionTransition {
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) return { state, intent: null };
  const draft = draftFromOrder(order, now, offeredSlot);
  return {
    state: {
      ...state,
      draft,
      bookingMode: 'repeat',
      showAllTimes: false,
      reviewEditing: false,
      notice: { message: REPEAT_BOOKING_NOTICE, sequence: (state.notice?.sequence ?? 0) + 1 },
    },
    intent: {
      kind: 'booking-step',
      step: resolveBookingEntryStep(draft, BOOKING_REVIEW_STEP, now),
    },
  };
}

/** "متابعة": open tracking for an order that exists; unknown ids go nowhere. */
export function viewOrder(state: CustomerSessionState, orderId: string): SessionTransition {
  const exists = state.orders.some((order) => order.id === orderId);
  return { state, intent: exists ? { kind: 'order-tracking', orderId } : null };
}
