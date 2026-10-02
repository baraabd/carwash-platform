import type { BookingDraft, CareExtraId } from './bookingDraft.ts';
import type { CustomerSessionState } from './customerSession.ts';

/**
 * Add-on commands. They edit only the local, unsent draft: ticking an add-on
 * creates no booking, reserves nothing and charges nothing. Whether an add-on is
 * payable is decided by the pricing calculation, never here.
 */

export const EXTRAS_UPDATED_NOTICE = 'تم تحديث الإضافات والسعر.';

function withExtras(state: CustomerSessionState, extras: readonly CareExtraId[]) {
  const draft: BookingDraft = { ...state.draft, extras, touched: true };
  return { ...state, draft };
}

/**
 * Tick or untick one add-on.
 *
 * - An add-on the chosen package already includes cannot be toggled: it is part
 *   of the package, so the draft is left exactly as it is.
 * - Ticking adds the id once; ticking it again never duplicates it.
 * - Unticking removes every occurrence, so a draft that somehow carried the id
 *   twice ends up clean.
 */
export function setExtraSelected(
  state: CustomerSessionState,
  extra: CareExtraId,
  selected: boolean,
  includedExtras: readonly CareExtraId[],
): CustomerSessionState {
  if (includedExtras.includes(extra)) return state;
  const current = state.draft.extras;
  if (selected) {
    return current.includes(extra)
      ? withExtras(state, current)
      : withExtras(state, [...current, extra]);
  }
  return withExtras(
    state,
    current.filter((id) => id !== extra),
  );
}

/** "حفظ الاختيارات": the choices are already in the draft; confirm them to the customer. */
export function confirmExtras(state: CustomerSessionState): CustomerSessionState {
  return {
    ...state,
    notice: { message: EXTRAS_UPDATED_NOTICE, sequence: (state.notice?.sequence ?? 0) + 1 },
  };
}
