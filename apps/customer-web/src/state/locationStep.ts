import type { BookingDraft, BookingPlace } from './bookingDraft.ts';
import type { CustomerSessionState, SessionTransition } from './customerSession.ts';

/**
 * Commands and rules of the third booking step. Each command edits only the
 * local, unsent draft: choosing a place creates no booking, saves no address and
 * contacts no service. Address ownership and serviceability belong to the
 * Location service.
 *
 * Privacy: a device position is only ever classified by `classifyDevicePosition`
 * into "inside / outside the illustrative range". The coordinates themselves are
 * never returned, stored, shown or logged, and no place carries them — `x`/`y`
 * of a place are positions in the drawing, not on Earth.
 */

export const CARE_STEP_INDEX = 1;
export const LOCATION_STEP_INDEX = 2;
export const TIME_STEP_INDEX = 3;

export const ADDRESS_MIN_LENGTH = 4;
export const ADDRESS_MAX_LENGTH = 160;
export const ADDRESS_LABEL_MAX_LENGTH = 30;
export const LOCATION_NOTE_MAX_LENGTH = 160;

export const LOCATION_REQUIRED_MESSAGE = 'حدد مكان السيارة أو أدخل عنوانًا واضحًا قبل المتابعة.';
export const ADDRESS_TOO_SHORT_MESSAGE = 'أدخل عنوانًا من أربعة أحرف على الأقل.';
export const LOCATION_SET_NOTICE = 'تم تحديد مكان الغسيل.';
export const SAMPLE_CHOSEN_NOTICE = 'عنوان توضيحي مختار. يمكنك تعديله.';
export const MAP_POINT_ANNOUNCEMENT = 'تم اختيار نقطة جديدة على الخريطة التوضيحية.';
export const MAP_POINT_ADDRESS = 'دمشق، موقع مختار على الخريطة التوضيحية';
export const DEFAULT_ADDRESS_LABEL = 'المنزل';
export const FALLBACK_ADDRESS_LABEL = 'مكان الغسيل';
/** Marks the sample addresses; a map point replaces an address that contains it. */
const SAMPLE_MARKER = 'تجريبي';

export const GEOLOCATION_UNSUPPORTED_NOTICE = 'تحديد الموقع غير مدعوم. يمكنك كتابة العنوان يدويًا.';
export const GEOLOCATION_INSECURE_NOTICE = 'قد يحتاج الموقع HTTPS. الإدخال اليدوي متاح دائمًا.';
export const GEOLOCATION_DENIED_NOTICE =
  'لم تسمح بالموقع. يمكنك كتابة العنوان أو اختيار عنوان تجريبي.';
export const GEOLOCATION_FAILED_NOTICE = 'تعذر تحديد الموقع. استخدم الإدخال اليدوي.';
export const GEOLOCATION_OUT_OF_RANGE_NOTICE =
  'موقعك خارج نطاق دمشق التوضيحي. جرّب عنوانًا يدويًا.';
export const GEOLOCATION_IN_RANGE_NOTICE =
  'أنت ضمن نطاق العرض التقريبي. اكتب العنوان؛ الخريطة ليست جغرافية.';

/** What the browser is asked for: a coarse, possibly cached, quickly abandoned fix. */
export const GEOLOCATION_REQUEST_OPTIONS = {
  enableHighAccuracy: false,
  timeout: 8000,
  maximumAge: 60000,
} as const;

// --- The illustrative map ---------------------------------------------------

export const MAP_WIDTH = 700;
export const MAP_HEIGHT = 500;
export const MAP_CENTRE = { x: 350, y: 250 } as const;
const PIN_MARGIN = 20;
export const MAP_ZOOM_MIN = 0.7;
export const MAP_ZOOM_MAX = 2.2;
export const MAP_ZOOM_BUTTON_STEP = 0.2;
export const MAP_ZOOM_WHEEL_STEP = 0.1;
export const MAP_PAN_LIMIT = { x: 250, y: 190 } as const;
export const MAP_KEY_STEP = 15;
/** A pointer that travels further than this is a drag, not a tap. */
export const MAP_DRAG_THRESHOLD = 5;

function bound(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface MapView {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export const INITIAL_MAP_VIEW: MapView = { zoom: 1, panX: 0, panY: 0 };

export function zoomMapView(view: MapView, delta: number): MapView {
  return { ...view, zoom: bound(view.zoom + delta, MAP_ZOOM_MIN, MAP_ZOOM_MAX) };
}

/** Pinch: the zoom at the start of the gesture scaled by how far the fingers moved. */
export function pinchMapView(
  view: MapView,
  startZoom: number,
  startDistance: number,
  distance: number,
): MapView {
  return {
    ...view,
    zoom: bound((startZoom * distance) / Math.max(1, startDistance), MAP_ZOOM_MIN, MAP_ZOOM_MAX),
  };
}

export function panMapView(view: MapView, panX: number, panY: number): MapView {
  return {
    ...view,
    panX: bound(panX, -MAP_PAN_LIMIT.x, MAP_PAN_LIMIT.x),
    panY: bound(panY, -MAP_PAN_LIMIT.y, MAP_PAN_LIMIT.y),
  };
}

/** The drawing position under a tap, given the tap's offset from the map's centre. */
export function mapPointAt(
  view: MapView,
  offsetFromCentreX: number,
  offsetFromCentreY: number,
): { readonly x: number; readonly y: number } {
  return {
    x: (offsetFromCentreX - view.panX) / view.zoom + MAP_CENTRE.x,
    y: (offsetFromCentreY - view.panY) / view.zoom + MAP_CENTRE.y,
  };
}

/** Keeps a pin inside the drawing. Returns the unrounded position it is drawn at. */
export function boundPinPosition(x: number, y: number): { readonly x: number; readonly y: number } {
  return {
    x: bound(x, PIN_MARGIN, MAP_WIDTH - PIN_MARGIN),
    y: bound(y, PIN_MARGIN, MAP_HEIGHT - PIN_MARGIN),
  };
}

// --- Sample places ----------------------------------------------------------

export type SamplePlaceKind = 'home' | 'work';

interface LocationFields {
  readonly address: string;
  readonly addressLabel: string;
  readonly locationNote: string;
  readonly place: BookingPlace | null;
  readonly saveAddress: boolean;
}

/** The two demonstration addresses of the reference. Not real places. */
export function sampleLocation(kind: SamplePlaceKind): LocationFields {
  const home = kind === 'home';
  return {
    addressLabel: home ? 'المنزل' : 'العمل',
    address: home ? 'دمشق، المزة، شارع تجريبي 12' : 'دمشق، المالكي، مبنى تجريبي 8',
    locationNote: '',
    place: {
      kind,
      x: home ? 350 : 433,
      y: home ? 250 : 196,
      label: 'عنوان توضيحي للتجربة',
    },
    saveAddress: true,
  };
}

// --- The address sheet's temporary values -----------------------------------

/**
 * What the address sheet is editing. These are temporary: the draft changes only
 * when the sheet is submitted, so closing it discards them.
 */
export type AddressSheetValues = LocationFields;

export function addressSheetValuesForDraft(draft: BookingDraft): AddressSheetValues {
  return {
    address: draft.address,
    addressLabel: draft.addressLabel || DEFAULT_ADDRESS_LABEL,
    locationNote: draft.locationNote,
    place: draft.place ? { ...draft.place } : null,
    saveAddress: draft.saveAddress,
  };
}

export function applySampleToSheet(
  values: AddressSheetValues,
  kind: SamplePlaceKind,
): AddressSheetValues {
  return { ...values, ...sampleLocation(kind) };
}

/**
 * Put the pin on a point of the drawing. An empty or sample address is replaced
 * by the generic "chosen on the map" address; an address the customer wrote is
 * kept. No address is derived from the point: nothing is geocoded.
 */
export function setSheetMapPoint(values: AddressSheetValues, x: number, y: number) {
  const position = boundPinPosition(x, y);
  const replaceAddress = !values.address || values.address.includes(SAMPLE_MARKER);
  const next: AddressSheetValues = {
    ...values,
    place: {
      kind: 'map',
      x: Math.round(position.x),
      y: Math.round(position.y),
      label: 'نقطة مختارة على الخريطة التوضيحية',
    },
    address: replaceAddress ? MAP_POINT_ADDRESS : values.address,
  };
  return { values: next, position };
}

/** Arrow keys: move the pin by one step from where it is (the centre if unset). */
export function moveSheetPin(values: AddressSheetValues, dx: number, dy: number) {
  const from = values.place ?? MAP_CENTRE;
  return setSheetMapPoint(values, from.x + dx, from.y + dy);
}

// --- Device location --------------------------------------------------------

/**
 * Centre and radius of the range the reference accepts a device position in.
 *
 * NOTE (owner decision pending): the approved reference labels this range
 * "دمشق" but its numbers (24.7136, 46.6753) are the coordinates of Riyadh. They
 * are ported unchanged because the reference is frozen; whether the range should
 * move is a product decision, recorded in docs/customer/C008_LOCATION_MAP.md.
 */
const ILLUSTRATIVE_RANGE = {
  latitude: 24.7136,
  longitude: 46.6753,
  kmPerLatitudeDegree: 111,
  kmPerLongitudeDegree: 101,
  radiusKm: 65,
} as const;

export type DevicePositionClass = 'in-range' | 'out-of-range';

/**
 * Reduces a device position to one bit. This is the only function that sees the
 * coordinates; callers pass them straight in and keep nothing.
 */
export function classifyDevicePosition(latitude: number, longitude: number): DevicePositionClass {
  const distance = Math.hypot(
    (latitude - ILLUSTRATIVE_RANGE.latitude) * ILLUSTRATIVE_RANGE.kmPerLatitudeDegree,
    (longitude - ILLUSTRATIVE_RANGE.longitude) * ILLUSTRATIVE_RANGE.kmPerLongitudeDegree,
  );
  return distance > ILLUSTRATIVE_RANGE.radiusKm ? 'out-of-range' : 'in-range';
}

export type GeolocationOutcome =
  'unsupported' | 'insecure' | 'denied' | 'failed' | DevicePositionClass;

const geolocationNotices: Readonly<Record<GeolocationOutcome, string>> = {
  unsupported: GEOLOCATION_UNSUPPORTED_NOTICE,
  insecure: GEOLOCATION_INSECURE_NOTICE,
  denied: GEOLOCATION_DENIED_NOTICE,
  failed: GEOLOCATION_FAILED_NOTICE,
  'out-of-range': GEOLOCATION_OUT_OF_RANGE_NOTICE,
  'in-range': GEOLOCATION_IN_RANGE_NOTICE,
};

/** PERMISSION_DENIED of the Geolocation API. */
const GEOLOCATION_PERMISSION_DENIED = 1;

export function geolocationFailureOutcome(errorCode: number): GeolocationOutcome {
  return errorCode === GEOLOCATION_PERMISSION_DENIED ? 'denied' : 'failed';
}

/**
 * What a "موقعي الحالي" attempt changes. Only an in-range answer touches the
 * sheet, and only by marking the pin as "approximately here" at the centre of
 * the drawing: the address stays for the customer to write. Every other outcome
 * leaves the values exactly as they were, so manual entry always remains.
 */
export function applyGeolocationOutcome(values: AddressSheetValues, outcome: GeolocationOutcome) {
  const notice = geolocationNotices[outcome];
  if (outcome !== 'in-range') return { values, notice };
  const next: AddressSheetValues = {
    ...values,
    place: {
      kind: 'gps',
      x: MAP_CENTRE.x,
      y: MAP_CENTRE.y,
      label: 'موقع داخل نطاق دمشق التقريبي، أكمل العنوان',
    },
  };
  return { values: next, notice };
}

// --- Session commands -------------------------------------------------------

function withDraft(state: CustomerSessionState, changes: Partial<BookingDraft>) {
  return { ...state, draft: { ...state.draft, ...changes, touched: true } };
}

/** Shows a short notice. Used for the location outcomes, which change no data. */
export function notify(state: CustomerSessionState, message: string): CustomerSessionState {
  return { ...state, notice: { message, sequence: (state.notice?.sequence ?? 0) + 1 } };
}

export function announce(state: CustomerSessionState, message: string): CustomerSessionState {
  return {
    ...state,
    announcement: { message, sequence: (state.announcement?.sequence ?? 0) + 1 },
  };
}

function clean(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

/** "المنزل" / "العمل" shortcut on the step: fill the draft with a sample address. */
export function chooseSampleLocation(
  state: CustomerSessionState,
  kind: SamplePlaceKind,
): CustomerSessionState {
  return notify(withDraft(state, sampleLocation(kind)), SAMPLE_CHOSEN_NOTICE);
}

export interface AddressSheetSubmission {
  readonly state: CustomerSessionState;
  /** Message for the sheet's address field, or null when the place was accepted. */
  readonly error: string | null;
}

/**
 * "اعتماد هذا المكان": validate, then copy the sheet's values into the draft.
 * `saveAddress` is stored as the customer's wish only — no address record is
 * created here or anywhere in this sprint.
 */
export function applyAddressSheet(
  state: CustomerSessionState,
  values: AddressSheetValues,
): AddressSheetSubmission {
  const address = clean(values.address, ADDRESS_MAX_LENGTH);
  if (address.length < ADDRESS_MIN_LENGTH) return { state, error: ADDRESS_TOO_SHORT_MESSAGE };
  const draft = withDraft(state, {
    address,
    addressLabel: clean(values.addressLabel, ADDRESS_LABEL_MAX_LENGTH) || FALLBACK_ADDRESS_LABEL,
    locationNote: clean(values.locationNote, LOCATION_NOTE_MAX_LENGTH),
    place: values.place ?? { kind: 'manual', ...MAP_CENTRE, label: 'عنوان يدوي' },
    saveAddress: values.saveAddress,
  });
  return { state: notify(draft, LOCATION_SET_NOTICE), error: null };
}

export function isLocationComplete(draft: Pick<BookingDraft, 'address'>): boolean {
  return draft.address.trim().length >= ADDRESS_MIN_LENGTH;
}

export interface LocationStepSubmission extends SessionTransition {
  /** Validation message for the place, or null when the step may advance. */
  readonly addressError: string | null;
}

/**
 * "اختيار الموعد": validate on activation only. Without a usable address the
 * customer stays on this step with the approved message; otherwise the draft
 * moves to the time step. The draft is never submitted.
 */
export function submitLocationStep(state: CustomerSessionState): LocationStepSubmission {
  if (!isLocationComplete(state.draft)) {
    return {
      state: announce(state, LOCATION_REQUIRED_MESSAGE),
      intent: null,
      addressError: LOCATION_REQUIRED_MESSAGE,
    };
  }
  return {
    state: { ...withDraft(state, {}), draftStep: TIME_STEP_INDEX },
    intent: { kind: 'booking-step', step: TIME_STEP_INDEX },
    addressError: null,
  };
}

/** Header back: return to the care step. The draft is untouched. */
export function returnToCareStep(state: CustomerSessionState): SessionTransition {
  return { state, intent: { kind: 'booking-step', step: CARE_STEP_INDEX } };
}
