import {
  isPlateAcceptable,
  normalizePlateInput,
  type BookingDraft,
  type VehicleTypeId,
} from './bookingDraft.ts';
import type { CustomerSessionState, SessionTransition } from './customerSession.ts';

/**
 * Commands of the first booking step. Every one of them edits only the local,
 * unsent draft. Nothing here saves a vehicle, creates a booking or contacts a
 * service; vehicle persistence belongs to the Vehicle service and the garage sprint.
 */

export const VEHICLE_STEP = 0;
export const CARE_STEP = 1;

export const PLATE_INVALID_MESSAGE = 'اكتب أرقام اللوحة وحروفها فقط، أو اتركها فارغة.';

function announce(state: CustomerSessionState, message: string): CustomerSessionState {
  return {
    ...state,
    announcement: { message, sequence: (state.announcement?.sequence ?? 0) + 1 },
  };
}

function withDraft(state: CustomerSessionState, changes: Partial<BookingDraft>) {
  return { ...state, draft: { ...state.draft, ...changes, touched: true } };
}

/** Records which step the draft is being edited at, so "أكمل" can return to it. */
export function visitBookingStep(state: CustomerSessionState, step: number): CustomerSessionState {
  return state.draftStep === step ? state : { ...state, draftStep: step };
}

/**
 * Picking a size describes a different car, so its optional name and colour are
 * cleared, as in the reference. `announcement` is the text read to assistive tech.
 */
export function selectVehicleType(
  state: CustomerSessionState,
  vehicleType: VehicleTypeId,
  announcement: string,
): CustomerSessionState {
  return announce(
    withDraft(state, { vehicleType, carId: null, carName: '', color: '' }),
    announcement,
  );
}

export function changePlate(state: CustomerSessionState, typed: string): CustomerSessionState {
  return withDraft(state, { plate: normalizePlateInput(typed) });
}

export function setSaveVehicle(state: CustomerSessionState, save: boolean): CustomerSessionState {
  return withDraft(state, { saveVehicle: save });
}

export interface VehicleStepSubmission extends SessionTransition {
  /** Validation message for the plate field, or null when the step may advance. */
  readonly plateError: string | null;
}

/**
 * "اختيار العناية": validate on activation only. An unacceptable plate keeps the
 * customer on this step with the approved message; otherwise the draft moves to
 * the care step. The draft is never submitted.
 */
export function submitVehicleStep(state: CustomerSessionState): VehicleStepSubmission {
  if (!isPlateAcceptable(state.draft.plate)) {
    return {
      state: announce(state, PLATE_INVALID_MESSAGE),
      intent: null,
      plateError: PLATE_INVALID_MESSAGE,
    };
  }
  return {
    state: { ...withDraft(state, {}), draftStep: CARE_STEP },
    intent: { kind: 'booking-step', step: CARE_STEP },
    plateError: null,
  };
}

/** Header back on the first step: leave the journey for Home; the draft is kept. */
export function leaveVehicleStep(state: CustomerSessionState): SessionTransition {
  return { state, intent: { kind: 'home' } };
}

/** "حفظ والخروج": keep the draft so Home can offer to continue it, then go Home. */
export function saveDraftAndExit(state: CustomerSessionState): SessionTransition {
  return { state: { ...withDraft(state, {}), reviewEditing: false }, intent: { kind: 'home' } };
}
