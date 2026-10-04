import type { BookingDraft, BookingPlace } from './bookingDraft.ts';
import type { CustomerSessionState } from './customerSession.ts';
import {
  ADDRESS_LABEL_MAX_LENGTH,
  ADDRESS_MAX_LENGTH,
  ADDRESS_MIN_LENGTH,
  ADDRESS_TOO_SHORT_MESSAGE,
  DEFAULT_ADDRESS_LABEL,
  FALLBACK_ADDRESS_LABEL,
  LOCATION_NOTE_MAX_LENGTH,
  type AddressSheetValues,
} from './locationStep.ts';

/**
 * Address book: the customer's saved addresses and the commands that change it.
 *
 * A saved address is a reusable description of a place. It is never a booking
 * and never an order: choosing one only copies its fields into the unsent draft
 * or into the open editor. Everything here is in-memory session state — it lasts
 * until the page is reloaded and is stored nowhere. In production these records
 * belong to the Customer/Location services, which this frontend does not call.
 *
 * Three things are kept apart and never share a nested object:
 * the saved records, the booking draft, and the editor's temporary values.
 */

export interface SavedAddress {
  readonly id: string;
  readonly label: string;
  readonly address: string;
  readonly locationNote: string;
  /** A position in the illustrative drawing, never geographic coordinates. */
  readonly place: BookingPlace | null;
}

export const ADDRESS_BOOK_CAPACITY = 20;
/** Label a record gets when it is saved without one (the reference's saveAddress). */
export const SAVED_ADDRESS_FALLBACK_LABEL = 'عنوان محفوظ';

export const ADDRESS_SAVED_NOTICE = 'تم حفظ العنوان.';
export const ADDRESS_DELETED_NOTICE = 'تم حذف العنوان.';
export const ADDRESS_BOOK_FULL_NOTICE = 'وصلت إلى حد 20 عنوانًا محفوظًا.';

const clip = (value: string, max: number) => value.trim().slice(0, max);
const clonePlace = (place: BookingPlace | null): BookingPlace | null =>
  place ? { ...place } : null;

function notify(state: CustomerSessionState, message: string): CustomerSessionState {
  return { ...state, notice: { message, sequence: (state.notice?.sequence ?? 0) + 1 } };
}

// --- Editor values ----------------------------------------------------------

/** "إضافة عنوان": the account editor starts empty, as in the reference. */
export function blankAddressEditorValues(): AddressSheetValues {
  return {
    address: '',
    addressLabel: DEFAULT_ADDRESS_LABEL,
    locationNote: '',
    place: null,
    saveAddress: true,
  };
}

/** Editing a saved address works on a copy; the record changes only on save. */
export function editorValuesForAddress(record: SavedAddress): AddressSheetValues {
  return {
    address: record.address,
    addressLabel: record.label,
    locationNote: record.locationNote,
    place: clonePlace(record.place),
    saveAddress: true,
  };
}

/**
 * A saved-address chip inside the open booking editor: fill the temporary values.
 * The draft is untouched until the editor is submitted, and the save preference
 * keeps whatever the customer chose.
 */
export function applySavedAddressToSheet(
  values: AddressSheetValues,
  record: SavedAddress,
): AddressSheetValues {
  return {
    ...values,
    address: record.address,
    addressLabel: record.label,
    locationNote: record.locationNote,
    place: clonePlace(record.place),
  };
}

// --- The save rule ----------------------------------------------------------

/** What is written into a record: the reference's saveAddress() payload. */
export interface AddressToSave {
  readonly address: string;
  readonly addressLabel: string;
  readonly locationNote: string;
  readonly place: BookingPlace | null;
}

export type SaveAddressOutcome = 'added' | 'updated' | 'capacity' | 'missing';

export interface SaveAddressResult {
  readonly state: CustomerSessionState;
  readonly outcome: SaveAddressOutcome;
}

/**
 * The reference's saveAddress(data, id), without any notice:
 *
 * - the record with the requested id is updated, whatever its address becomes;
 * - otherwise a record with the same (trimmed, capped) address is updated;
 * - otherwise a new record is appended, unless the book already holds 20.
 *
 * A requested id that no longer exists changes nothing (`missing`): a stale
 * editor never edits another record and never adds one as a side effect.
 * Records keep their id and their position; nothing is merged or removed.
 *
 * Booking confirmation (a later sprint) calls this with the draft when
 * `draft.saveAddress` is on. Nothing in this sprint calls it for a draft.
 */
export function saveAddressRecord(
  state: CustomerSessionState,
  data: AddressToSave,
  id: string | null,
): SaveAddressResult {
  const fields = {
    label: clip(data.addressLabel, ADDRESS_LABEL_MAX_LENGTH) || SAVED_ADDRESS_FALLBACK_LABEL,
    address: clip(data.address, ADDRESS_MAX_LENGTH),
    locationNote: clip(data.locationNote, LOCATION_NOTE_MAX_LENGTH),
    place: clonePlace(data.place),
  };
  if (id !== null && !state.addresses.some((record) => record.id === id)) {
    return { state, outcome: 'missing' };
  }
  const existing =
    state.addresses.find((record) => record.id === id) ??
    state.addresses.find((record) => record.address === fields.address);
  if (existing) {
    const addresses = state.addresses.map((record) =>
      record.id === existing.id ? { id: record.id, ...fields } : record,
    );
    return { state: { ...state, addresses }, outcome: 'updated' };
  }
  if (state.addresses.length >= ADDRESS_BOOK_CAPACITY) return { state, outcome: 'capacity' };
  const sequence = state.addressSequence + 1;
  return {
    state: {
      ...state,
      addresses: [...state.addresses, { id: `ADR-${sequence}`, ...fields }],
      addressSequence: sequence,
    },
    outcome: 'added',
  };
}

// --- Account commands -------------------------------------------------------

export interface AddressEditorSubmission {
  readonly state: CustomerSessionState;
  /** Message for the address field, or null when the form itself was valid. */
  readonly error: string | null;
  /** What happened to the address book; null when the form was refused. */
  readonly outcome: SaveAddressOutcome | null;
}

/**
 * Account editor "حفظ العنوان". The form rules are those of the booking editor:
 * trimmed, at least four characters, an empty label becomes «مكان الغسيل».
 *
 * The success notice is raised only when a record was really added or updated.
 * A full book raises the capacity notice instead (the reference shows "saved"
 * over it although nothing was stored; see docs/customer/C009_SAVED_ADDRESSES.md).
 */
export function submitAccountAddress(
  state: CustomerSessionState,
  values: AddressSheetValues,
  editingId: string | null,
): AddressEditorSubmission {
  const address = clip(values.address, ADDRESS_MAX_LENGTH);
  if (address.length < ADDRESS_MIN_LENGTH) {
    return { state, error: ADDRESS_TOO_SHORT_MESSAGE, outcome: null };
  }
  const saved = saveAddressRecord(
    state,
    {
      address,
      addressLabel: clip(values.addressLabel, ADDRESS_LABEL_MAX_LENGTH) || FALLBACK_ADDRESS_LABEL,
      locationNote: values.locationNote,
      place: values.place ?? { kind: 'manual', x: 350, y: 250, label: 'عنوان يدوي' },
    },
    editingId,
  );
  if (saved.outcome === 'capacity') {
    return { state: notify(state, ADDRESS_BOOK_FULL_NOTICE), error: null, outcome: 'capacity' };
  }
  if (saved.outcome === 'missing') return { state, error: null, outcome: 'missing' };
  return { state: notify(saved.state, ADDRESS_SAVED_NOTICE), error: null, outcome: saved.outcome };
}

/**
 * Remove a saved address. Past orders and the current draft keep their own copy
 * of the address; an unknown id changes nothing and raises no notice.
 */
export function deleteSavedAddress(
  state: CustomerSessionState,
  addressId: string,
): CustomerSessionState {
  if (!state.addresses.some((record) => record.id === addressId)) return state;
  const addresses = state.addresses.filter((record) => record.id !== addressId);
  return notify({ ...state, addresses }, ADDRESS_DELETED_NOTICE);
}

// --- Booking commands -------------------------------------------------------

function draftWithAddress(draft: BookingDraft, record: SavedAddress): BookingDraft {
  return {
    ...draft,
    address: record.address,
    addressLabel: record.label,
    locationNote: record.locationNote,
    place: clonePlace(record.place),
  };
}

/**
 * Saved-address chip on the location step: copy the address into the draft.
 * Nothing is saved, booked or submitted, the step does not advance, and the
 * save preference is left as it was. An unknown id changes nothing.
 */
export function chooseSavedAddress(
  state: CustomerSessionState,
  addressId: string,
): CustomerSessionState {
  const record = state.addresses.find((candidate) => candidate.id === addressId);
  if (!record) return state;
  return { ...state, draft: { ...draftWithAddress(state.draft, record), touched: true } };
}

/**
 * Starting a booking whose draft has no address yet begins with the first saved
 * one, as in the reference. An address already written, resumed or repeated is
 * never replaced.
 */
export function prefillAddressFromBook(
  draft: BookingDraft,
  addresses: readonly SavedAddress[],
): BookingDraft {
  const first = addresses[0];
  return !draft.address && first ? draftWithAddress(draft, first) : draft;
}
