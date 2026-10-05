import {
  blankBookingDraft,
  confirmedContactName,
  confirmedContactPhone,
  confirmedPlate,
  isCareExtraId,
  isCarePackageId,
  isPaymentMethodId,
  isVehicleTypeId,
  resolveBookingEntryStep,
  type BookingDraft,
  type VehicleTypeId,
} from './bookingDraft.ts';
import { validateContact } from './contactStep.ts';
import type {
  ConfirmationReceipt,
  CustomerOrderSnapshot,
  CustomerSessionState,
  OrderHandoffIntent,
  SessionTransition,
} from './customerSession.ts';
import { LOCATION_REQUIRED_MESSAGE } from './locationStep.ts';
import { PAYMENT_REQUIRED_MESSAGE } from './paymentStep.ts';
import {
  ADDRESS_BOOK_FULL_NOTICE,
  saveAddressRecord,
  type SaveAddressOutcome,
} from './savedAddresses.ts';
import { GARAGE_FULL_NOTICE, saveVehicleRecord, type SaveVehicleOutcome } from './savedVehicles.ts';
import { TIME_REQUIRED_MESSAGE } from './scheduleStep.ts';
import { PLATE_INVALID_MESSAGE } from './vehicleStep.ts';

/**
 * C014: explicit confirmation of a DEMO booking on Review (the reference's
 * confirmOrder()). One pure transition prepares everything — revalidation at the
 * action's instant, the order snapshot, the optional garage/address-book saves,
 * the profile, the reset draft — and the provider applies it once. The order
 * exists in this page's memory only: it is not a booking with any service, not a
 * reservation of a technician or a time, and not a payment.
 *
 * The transition reads no clock and generates no random value: the instant is
 * passed in, ids come from session counters. Evaluating it twice with the same
 * input gives the same result and has no side effect.
 */

export const REVIEW_STEP_INDEX = 6;
/** The reference keeps the newest 80 orders; older ones leave the session list. */
export const ORDER_HISTORY_LIMIT = 80;
/** Accepted confirmations remembered for replay detection. */
export const RECEIPT_HISTORY_LIMIT = 10;
export const ORDER_ID_PREFIX = 'WG-SESSION-';

/**
 * C014's notice, not a quote: the reference's own session-only wording
 * («تم إنشاء الطلب لهذه الجلسة.») followed by what did not happen.
 */
export const ORDER_CREATED_NOTICE = 'تم إنشاء الطلب لهذه الجلسة. لا حجز فعلي ولا دفع.';
/** C014's notice when preparing the order failed: nothing was created or saved. */
export const ORDER_FAILED_NOTICE = 'تعذّر إنشاء الطلب. لم يتغيّر شيء في حجزك.';

/**
 * Catalog facts the transition needs, injected by the caller so the state layer
 * keeps not importing fixtures: the single illustrative quote and size names.
 */
export interface ConfirmationCatalog {
  readonly quote: (draft: BookingDraft) => { readonly total: number; readonly minutes: number };
  readonly sizeName: (type: VehicleTypeId) => string;
}

export interface ConfirmationCommand {
  /** The draft generation the customer reviewed (`state.draftGeneration` at render). */
  readonly key: number;
  /** `draftFingerprint` of the draft the customer reviewed. */
  readonly fingerprint: string;
  /** The instant of the customer's action, read once at the event. */
  readonly now: Date;
  readonly catalog: ConfirmationCatalog;
}

export type ConfirmationOutcome =
  | {
      readonly kind: 'created';
      readonly orderId: string;
      readonly saves: {
        readonly vehicle: SaveVehicleOutcome | 'off';
        readonly address: SaveAddressOutcome | 'off';
      };
    }
  /** This command was already accepted: the recorded order, nothing new happened. */
  | { readonly kind: 'replay'; readonly orderId: string }
  /** The key was accepted for a different payload: refused, nothing overwritten. */
  | { readonly kind: 'conflict' }
  /** The command is for a draft that is no longer the current one, or has changed. */
  | { readonly kind: 'stale' }
  /** A prerequisite does not hold at the action's instant: back to its step. */
  | { readonly kind: 'refused'; readonly step: number; readonly message: string | null }
  /** Preparing the order failed unexpectedly; the session is unchanged. */
  | { readonly kind: 'failed'; readonly reason: string };

export interface ConfirmationResult extends SessionTransition {
  readonly outcome: ConfirmationOutcome;
}

/**
 * A stable fingerprint of every draft value a confirmation would record or act
 * on. `touched` is bookkeeping and is left out.
 */
export function draftFingerprint(draft: BookingDraft): string {
  return JSON.stringify([
    draft.vehicleType,
    draft.carId,
    draft.carName,
    draft.plate,
    draft.color,
    draft.saveVehicle,
    draft.service,
    Array.isArray(draft.extras) ? [...draft.extras] : String(draft.extras),
    draft.address,
    draft.addressLabel,
    draft.locationNote,
    draft.place ? [draft.place.kind, draft.place.x, draft.place.y, draft.place.label] : null,
    draft.saveAddress,
    draft.scheduleDay,
    draft.slot ? [draft.slot.date, draft.slot.time] : null,
    draft.contactName,
    draft.contactPhone,
    draft.note,
    draft.paymentMethod,
  ]);
}

/** The approved message of the step a refused confirmation returns to. */
function refusalMessage(draft: BookingDraft, step: number): string | null {
  if (step === 0) return PLATE_INVALID_MESSAGE;
  if (step === 2) return LOCATION_REQUIRED_MESSAGE;
  if (step === 3) return TIME_REQUIRED_MESSAGE;
  if (step === 4) {
    const errors = validateContact(draft);
    return errors.contactName ?? errors.contactPhone;
  }
  if (step === 5) return PAYMENT_REQUIRED_MESSAGE;
  return null;
}

function nextOrderId(orders: readonly CustomerOrderSnapshot[], sequence: number) {
  let next = sequence;
  let id: string;
  do {
    next += 1;
    id = `${ORDER_ID_PREFIX}${next}`;
  } while (orders.some((order) => order.id === id));
  return { id, sequence: next };
}

function withMessage(state: CustomerSessionState, message: string): CustomerSessionState {
  return {
    ...state,
    notice: { message, sequence: (state.notice?.sequence ?? 0) + 1 },
    announcement: { message, sequence: (state.announcement?.sequence ?? 0) + 1 },
  };
}

export function confirmBooking(
  state: CustomerSessionState,
  command: ConfirmationCommand,
): ConfirmationResult {
  const unchanged = (outcome: ConfirmationOutcome): ConfirmationResult => ({
    state,
    intent: null,
    outcome,
  });

  const accepted = state.confirmationReceipts.find((receipt) => receipt.key === command.key);
  if (accepted) {
    return unchanged(
      accepted.fingerprint === command.fingerprint
        ? { kind: 'replay', orderId: accepted.orderId }
        : { kind: 'conflict' },
    );
  }
  const draft = state.draft;
  if (command.key !== state.draftGeneration || draftFingerprint(draft) !== command.fingerprint) {
    return unchanged({ kind: 'stale' });
  }

  try {
    // Shape and catalog guards before any lookup: an unknown size, package or
    // collection is never confirmed under a fallback.
    const shapeStep = !isVehicleTypeId(draft.vehicleType)
      ? 0
      : !isCarePackageId(draft.service) || !Array.isArray(draft.extras)
        ? 1
        : REVIEW_STEP_INDEX;
    const step =
      shapeStep < REVIEW_STEP_INDEX
        ? shapeStep
        : resolveBookingEntryStep(draft, REVIEW_STEP_INDEX, command.now);
    if (step < REVIEW_STEP_INDEX || !isPaymentMethodId(draft.paymentMethod)) {
      const target = step < REVIEW_STEP_INDEX ? step : 5;
      // A catalog/shape refusal is not one of the step's own validation errors.
      const message = shapeStep < REVIEW_STEP_INDEX ? null : refusalMessage(draft, target);
      const refusedState = {
        ...(message ? withMessage(state, message) : state),
        reviewEditing: false,
        draftStep: target,
      };
      return {
        state: refusedState,
        intent: { kind: 'booking-step', step: target },
        outcome: { kind: 'refused', step: target, message },
      };
    }
    const method = draft.paymentMethod;

    const quote = command.catalog.quote(draft);
    if (
      !Number.isFinite(quote.total) ||
      quote.total < 0 ||
      !Number.isFinite(quote.minutes) ||
      quote.minutes <= 0
    ) {
      throw new Error('INVALID_QUOTE');
    }

    const contactName = confirmedContactName(draft.contactName);
    const contactPhone = confirmedContactPhone(draft.contactPhone);
    const plate = confirmedPlate(draft.plate);

    let vehicles = state.vehicles;
    let vehicleSequence = state.vehicleSequence;
    let carId = draft.carId;
    let vehicleOutcome: SaveVehicleOutcome | 'off' = 'off';
    if (draft.saveVehicle) {
      const saved = saveVehicleRecord(
        vehicles,
        vehicleSequence,
        {
          carId: draft.carId,
          type: draft.vehicleType,
          carName: draft.carName,
          plate,
          color: draft.color,
        },
        command.catalog.sizeName(draft.vehicleType),
      );
      vehicles = saved.vehicles;
      vehicleSequence = saved.vehicleSequence;
      vehicleOutcome = saved.outcome;
      carId = saved.carId ?? carId;
    }

    let addresses = state.addresses;
    let addressSequence = state.addressSequence;
    let addressOutcome: SaveAddressOutcome | 'off' = 'off';
    if (draft.saveAddress) {
      const saved = saveAddressRecord(
        { ...state, addresses, addressSequence },
        {
          address: draft.address,
          addressLabel: draft.addressLabel,
          locationNote: draft.locationNote,
          place: draft.place,
        },
        null,
      );
      addresses = saved.state.addresses;
      addressSequence = saved.state.addressSequence;
      addressOutcome = saved.outcome;
    }

    const { id, sequence: orderSequence } = nextOrderId(state.orders, state.orderSequence);
    const slot = draft.slot!;
    const order: CustomerOrderSnapshot = {
      id,
      stage: 0,
      vehicleType: draft.vehicleType,
      carName: draft.carName.trim().slice(0, 60),
      plate,
      color: draft.color.trim().slice(0, 30),
      service: draft.service,
      // The displayed choices, in order; the quote alone decides what is charged.
      extras: draft.extras.filter(isCareExtraId),
      address: draft.address.trim(),
      addressLabel: draft.addressLabel.trim(),
      locationNote: draft.locationNote.trim(),
      slot: { date: slot.date, time: slot.time },
      contactName,
      contactPhone,
      note: draft.note.trim().slice(0, 300),
      paymentMethod: method,
      confirmation: {
        createdAt: command.now.toISOString(),
        total: quote.total,
        minutes: quote.minutes,
        carId,
        place: draft.place ? { ...draft.place } : null,
        payment: {
          method,
          status: method === 'cash' ? 'cash_due' : 'awaiting_transfer',
          amount: quote.total,
          currency: 'SYP',
          submittedAt: null,
          verifiedAt: null,
        },
      },
    };

    const warnings = [
      vehicleOutcome === 'capacity' ? GARAGE_FULL_NOTICE : null,
      addressOutcome === 'capacity' ? ADDRESS_BOOK_FULL_NOTICE : null,
    ].filter((warning): warning is string => warning !== null);
    const receipt: ConfirmationReceipt = {
      key: command.key,
      fingerprint: command.fingerprint,
      orderId: id,
    };
    const destination: OrderHandoffIntent =
      method === 'cash'
        ? { kind: 'order-tracking', orderId: id }
        : { kind: 'order-payment', orderId: id };

    const next: CustomerSessionState = withMessage(
      {
        ...state,
        profile: { name: contactName, phone: contactPhone },
        orders: [order, ...state.orders].slice(0, ORDER_HISTORY_LIMIT),
        orderSequence,
        vehicles,
        vehicleSequence,
        addresses,
        addressSequence,
        // A fresh draft keeps only the confirmed contact details, as the reference.
        draft: { ...blankBookingDraft(), contactName, contactPhone },
        draftStep: 0,
        draftGeneration: state.draftGeneration + 1,
        confirmationReceipts: [receipt, ...state.confirmationReceipts].slice(
          0,
          RECEIPT_HISTORY_LIMIT,
        ),
        bookingMode: 'standard',
        showAllTimes: false,
        reviewEditing: false,
        pendingHandoff: destination,
      },
      [ORDER_CREATED_NOTICE, ...warnings].join(' '),
    );
    return {
      state: next,
      intent: destination,
      outcome: {
        kind: 'created',
        orderId: id,
        saves: { vehicle: vehicleOutcome, address: addressOutcome },
      },
    };
  } catch (error) {
    // Nothing is committed: no order, id, profile, garage, address book or draft
    // change. Only the customer is told, never with a success message.
    return {
      state: withMessage(state, ORDER_FAILED_NOTICE),
      intent: null,
      outcome: { kind: 'failed', reason: error instanceof Error ? error.message : 'UNKNOWN' },
    };
  }
}

/** The handoff has been followed (the route left Review): forget it. */
export function clearPendingHandoff(state: CustomerSessionState): CustomerSessionState {
  return state.pendingHandoff ? { ...state, pendingHandoff: null } : state;
}
