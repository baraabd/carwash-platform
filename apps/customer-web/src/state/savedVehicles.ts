import {
  PLATE_MAX_LENGTH,
  isPlateAcceptable,
  normalizePlateInput,
  type BookingDraft,
  type VehicleTypeId,
} from './bookingDraft.ts';
import { startBooking } from './bookingEntry.ts';
import type { CustomerSessionState, SessionTransition } from './customerSession.ts';

/**
 * Garage: the customer's saved cars and the shared editor that describes one.
 *
 * A saved vehicle is a reusable description of a car. It is never a booking and
 * never an order: choosing one only copies its fields into the unsent draft.
 * Everything here is in-memory session state; in production these records belong
 * to the Vehicle service, which this frontend does not call.
 */

export interface SavedVehicle {
  readonly id: string;
  readonly type: VehicleTypeId;
  /** Always present: the customer's own name for the car or its size name. */
  readonly name: string;
  readonly plate: string;
  readonly color: string;
}

export const GARAGE_CAPACITY = 30;
const NAME_MAX_LENGTH = 60;
const COLOR_MAX_LENGTH = 30;

export const EDITOR_PLATE_MESSAGE =
  'استخدم أرقام اللوحة وحروفها فقط (حتى 20 محرفًا)، أو اتركها فارغة.';
export const VEHICLE_SAVED_NOTICE = 'السيارة ولوحتها محفوظتان على جهازك.';
export const VEHICLE_DELETED_NOTICE = 'تم حذف السيارة المحفوظة.';
export const VEHICLE_CHOSEN_NOTICE = 'تم اختيار السيارة ولوحتها.';
export const DRAFT_VEHICLE_UPDATED_NOTICE = 'تم تحديث السيارة والسعر.';
export const GARAGE_FULL_NOTICE =
  'وصلت إلى حد 30 سيارة في النموذج. سيستمر الحجز دون إضافة سيارة جديدة.';

/** What the editor form holds while it is open, exactly as typed. */
export interface VehicleEditorValues {
  readonly type: VehicleTypeId;
  readonly carName: string;
  readonly plate: string;
  readonly color: string;
  readonly saveVehicle: boolean;
}

/** Editor values after the approved clean-up: trimmed, capped, digits normalised. */
export interface VehicleDescription {
  readonly type: VehicleTypeId;
  readonly carName: string;
  readonly plate: string;
  readonly color: string;
}

const clip = (value: string, max: number) => value.trim().slice(0, max);

/**
 * Submitted plate: trimmed and capped, digits made Latin by the draft's own
 * normaliser, inner whitespace runs collapsed to one space.
 */
export function describeVehicle(values: VehicleEditorValues): VehicleDescription {
  return {
    type: values.type,
    carName: clip(values.carName, NAME_MAX_LENGTH),
    plate: normalizePlateInput(clip(values.plate, PLATE_MAX_LENGTH)).replace(/\s+/g, ' '),
    color: clip(values.color, COLOR_MAX_LENGTH),
  };
}

/** Live preview text for the plate while typing (digits normalised, nothing else). */
export function previewPlate(typed: string): string {
  return normalizePlateInput(typed);
}

export const blankEditorValues: VehicleEditorValues = {
  type: 'sedan',
  carName: '',
  plate: '',
  color: '',
  saveVehicle: true,
};

export function editorValuesForVehicle(vehicle: SavedVehicle): VehicleEditorValues {
  return {
    type: vehicle.type,
    carName: vehicle.name,
    plate: vehicle.plate,
    color: vehicle.color,
    saveVehicle: true,
  };
}

export function editorValuesForDraft(draft: BookingDraft): VehicleEditorValues {
  return {
    type: draft.vehicleType,
    carName: draft.carName,
    plate: draft.plate,
    color: draft.color,
    saveVehicle: draft.saveVehicle,
  };
}

function notify(state: CustomerSessionState, message: string): CustomerSessionState {
  return { ...state, notice: { message, sequence: (state.notice?.sequence ?? 0) + 1 } };
}

export interface VehicleEditorResult {
  readonly state: CustomerSessionState;
  /** Validation message to show in the editor, or null when it was accepted. */
  readonly error: string | null;
}

/**
 * The saved car an edit refers to: the one being edited, otherwise an existing
 * car describing the same vehicle (same plate and size, or — without a plate —
 * same name, size and colour), so saving twice does not duplicate it.
 */
function findExisting(
  vehicles: readonly SavedVehicle[],
  editingId: string | null,
  described: VehicleDescription,
  name: string,
): SavedVehicle | undefined {
  return (
    vehicles.find((vehicle) => vehicle.id === editingId) ??
    vehicles.find((vehicle) =>
      described.plate
        ? vehicle.plate === described.plate && vehicle.type === described.type
        : vehicle.name === name &&
          vehicle.type === described.type &&
          vehicle.color === described.color,
    )
  );
}

/**
 * Garage editor "حفظ السيارة": add a car or update the one being edited.
 * `sizeName` is the display name of the chosen size, used when no name was given.
 */
export function saveGarageVehicle(
  state: CustomerSessionState,
  editingId: string | null,
  values: VehicleEditorValues,
  sizeName: string,
): VehicleEditorResult {
  const described = describeVehicle(values);
  if (!isPlateAcceptable(described.plate)) return { state, error: EDITOR_PLATE_MESSAGE };

  const name = described.carName || sizeName;
  const fields = { type: described.type, name, plate: described.plate, color: described.color };
  const existing = findExisting(state.vehicles, editingId, described, name);

  if (existing) {
    const vehicles = state.vehicles.map((vehicle) =>
      vehicle.id === existing.id ? { ...vehicle, ...fields } : vehicle,
    );
    return { state: notify({ ...state, vehicles }, VEHICLE_SAVED_NOTICE), error: null };
  }
  if (state.vehicles.length >= GARAGE_CAPACITY) {
    // Nothing was stored, so the customer is told that rather than "saved".
    return { state: notify(state, GARAGE_FULL_NOTICE), error: null };
  }
  const sequence = state.vehicleSequence + 1;
  const vehicles = [...state.vehicles, { id: `CAR-${sequence}`, ...fields }];
  return {
    state: notify({ ...state, vehicles, vehicleSequence: sequence }, VEHICLE_SAVED_NOTICE),
    error: null,
  };
}

export type SaveVehicleOutcome = 'added' | 'updated' | 'capacity';

export interface SaveVehicleResult {
  readonly vehicles: readonly SavedVehicle[];
  readonly vehicleSequence: number;
  readonly outcome: SaveVehicleOutcome;
  /** The saved car's id, or null when nothing was stored (the garage is full). */
  readonly carId: string | null;
}

/**
 * The reference's saveCar(data), without any notice, for booking confirmation:
 * the car the draft links to (`carId`), otherwise one describing the same vehicle,
 * is updated; otherwise a car is added unless the garage already holds 30. A full
 * garage is not a failed booking: nothing is stored and the outcome says so.
 * `sizeName` is the size's display name, used when the car has no name. Pure: the
 * input arrays are never mutated.
 */
export function saveVehicleRecord(
  vehicles: readonly SavedVehicle[],
  vehicleSequence: number,
  data: VehicleDescription & { readonly carId: string | null },
  sizeName: string,
): SaveVehicleResult {
  const described: VehicleDescription = {
    type: data.type,
    carName: clip(data.carName, NAME_MAX_LENGTH),
    plate: clip(data.plate, PLATE_MAX_LENGTH),
    color: clip(data.color, COLOR_MAX_LENGTH),
  };
  const name = described.carName || sizeName;
  const fields = { type: described.type, name, plate: described.plate, color: described.color };
  const existing = findExisting(vehicles, data.carId, described, name);
  if (existing) {
    return {
      vehicles: vehicles.map((vehicle) =>
        vehicle.id === existing.id ? { ...vehicle, ...fields } : vehicle,
      ),
      vehicleSequence,
      outcome: 'updated',
      carId: existing.id,
    };
  }
  if (vehicles.length >= GARAGE_CAPACITY) {
    return { vehicles, vehicleSequence, outcome: 'capacity', carId: null };
  }
  const sequence = vehicleSequence + 1;
  const id = `CAR-${sequence}`;
  return {
    vehicles: [...vehicles, { id, ...fields }],
    vehicleSequence: sequence,
    outcome: 'added',
    carId: id,
  };
}

/**
 * Booking editor "استخدام هذه السيارة": describe the car in the unsent draft.
 * The garage is not changed here; `carId` keeps the link to a chosen saved car.
 */
export function applyEditorToDraft(
  state: CustomerSessionState,
  carId: string | null,
  values: VehicleEditorValues,
): VehicleEditorResult {
  const described = describeVehicle(values);
  if (!isPlateAcceptable(described.plate)) return { state, error: EDITOR_PLATE_MESSAGE };
  const draft: BookingDraft = {
    ...state.draft,
    vehicleType: described.type,
    carName: described.carName,
    plate: described.plate,
    color: described.color,
    carId,
    saveVehicle: values.saveVehicle,
    touched: true,
  };
  return { state: notify({ ...state, draft }, DRAFT_VEHICLE_UPDATED_NOTICE), error: null };
}

function draftWithVehicle(draft: BookingDraft, vehicle: SavedVehicle): BookingDraft {
  return {
    ...draft,
    vehicleType: vehicle.type,
    carId: vehicle.id,
    carName: vehicle.name,
    plate: vehicle.plate,
    color: vehicle.color,
  };
}

/** Saved-car chip: copy the car into the draft. Nothing is booked or submitted. */
export function chooseSavedVehicle(
  state: CustomerSessionState,
  vehicleId: string,
): CustomerSessionState {
  const vehicle = state.vehicles.find((candidate) => candidate.id === vehicleId);
  if (!vehicle) return state;
  const draft = { ...draftWithVehicle(state.draft, vehicle), saveVehicle: true, touched: true };
  return notify({ ...state, draft }, VEHICLE_CHOSEN_NOTICE);
}

/** Garage "احجز لهذه السيارة": start the booking journey with this car in the draft. */
export function bookSavedVehicle(
  state: CustomerSessionState,
  vehicleId: string,
  now: Date,
): SessionTransition {
  const vehicle = state.vehicles.find((candidate) => candidate.id === vehicleId);
  if (!vehicle) return { state, intent: null };
  return startBooking({ ...state, draft: draftWithVehicle(state.draft, vehicle) }, undefined, now);
}

/**
 * Remove a saved car. Past orders keep their own copy of the details; a draft
 * that pointed at the car keeps its fields but loses the link.
 */
export function deleteSavedVehicle(
  state: CustomerSessionState,
  vehicleId: string,
): CustomerSessionState {
  if (!state.vehicles.some((vehicle) => vehicle.id === vehicleId)) return state;
  const draft = state.draft.carId === vehicleId ? { ...state.draft, carId: null } : state.draft;
  const vehicles = state.vehicles.filter((vehicle) => vehicle.id !== vehicleId);
  return notify({ ...state, vehicles, draft }, VEHICLE_DELETED_NOTICE);
}
