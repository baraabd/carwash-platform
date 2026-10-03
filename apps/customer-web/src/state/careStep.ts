import type { BookingDraft, CareExtraId, CarePackageId } from './bookingDraft.ts';
import type { CustomerSessionState, SessionTransition } from './customerSession.ts';

/**
 * Commands of the second booking step. Each one edits only the local, unsent
 * draft: choosing a package creates no booking, reserves nothing and charges
 * nothing. Package definitions belong to Catalog and amounts to Pricing.
 */

export const VEHICLE_STEP_INDEX = 0;
export const CARE_STEP_INDEX = 1;
export const LOCATION_STEP_INDEX = 2;

function withDraft(state: CustomerSessionState, changes: Partial<BookingDraft>) {
  return { ...state, draft: { ...state.draft, ...changes, touched: true } };
}

/**
 * Choose a package. Extras the new package already contains are dropped from the
 * draft so they are never listed or charged twice, as in the reference. Nothing
 * else in the draft changes: vehicle, place, time, contact and payment stay.
 */
export function selectCarePackage(
  state: CustomerSessionState,
  service: CarePackageId,
  includedExtras: readonly CareExtraId[],
): CustomerSessionState {
  return withDraft(state, {
    service,
    extras: state.draft.extras.filter((extra) => !includedExtras.includes(extra)),
  });
}

/** "تحديد المكان": the care step has nothing to validate; move the draft on. */
export function submitCareStep(state: CustomerSessionState): SessionTransition {
  return {
    state: { ...withDraft(state, {}), draftStep: LOCATION_STEP_INDEX },
    intent: { kind: 'booking-step', step: LOCATION_STEP_INDEX },
  };
}

/** Header back and "تغيير": return to the vehicle step. The draft is untouched. */
export function returnToVehicleStep(state: CustomerSessionState): SessionTransition {
  return { state, intent: { kind: 'booking-step', step: VEHICLE_STEP_INDEX } };
}
