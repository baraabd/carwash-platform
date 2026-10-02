import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  blankBookingDraft,
  resolveBookingEntryStep,
} from '../../apps/customer-web/src/state/bookingDraft.ts';
import { repeatOrder, resumeBooking } from '../../apps/customer-web/src/state/bookingEntry.ts';
import { submitCareStep } from '../../apps/customer-web/src/state/careStep.ts';
import {
  ADDRESS_TOO_SHORT_MESSAGE,
  GEOLOCATION_DENIED_NOTICE,
  GEOLOCATION_FAILED_NOTICE,
  GEOLOCATION_INSECURE_NOTICE,
  GEOLOCATION_IN_RANGE_NOTICE,
  GEOLOCATION_OUT_OF_RANGE_NOTICE,
  GEOLOCATION_REQUEST_OPTIONS,
  GEOLOCATION_UNSUPPORTED_NOTICE,
  INITIAL_MAP_VIEW,
  LOCATION_REQUIRED_MESSAGE,
  LOCATION_SET_NOTICE,
  MAP_POINT_ADDRESS,
  SAMPLE_CHOSEN_NOTICE,
  addressSheetValuesForDraft,
  applyAddressSheet,
  applyGeolocationOutcome,
  applySampleToSheet,
  boundPinPosition,
  chooseSampleLocation,
  classifyDevicePosition,
  geolocationFailureOutcome,
  isLocationComplete,
  mapPointAt,
  moveSheetPin,
  panMapView,
  pinchMapView,
  returnToCareStep,
  sampleLocation,
  setSheetMapPoint,
  submitLocationStep,
  zoomMapView,
} from '../../apps/customer-web/src/state/locationStep.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';
import { illustrativeCost } from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import { garageScenarioState } from '../../apps/customer-web/src/fixtures/customerGarageScenarios.ts';
import { homeScenarioState } from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import {
  locationScenarioIds,
  locationScenarioState,
} from '../../apps/customer-web/src/fixtures/customerLocationScenarios.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import { bookingSteps } from '../../apps/customer-web/src/app/routes.ts';
import { bookingFlow } from '../../apps/customer-web/src/features/booking/bookingFlow.ts';
import { buildLocationStepViewModel } from '../../apps/customer-web/src/features/booking/location/locationViewModel.ts';
import { buildHomeViewModel } from '../../apps/customer-web/src/features/home/homeViewModel.ts';
import { illustrativeMapMarkup } from '../../apps/customer-web/src/shared/art/mapMarkup.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP_SRC = path.join(ROOT, 'apps/customer-web/src');
const reference = readFileSync(
  path.join(ROOT, 'design/reference/approved/washgo-payments-interactive.html'),
  'utf8',
);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx|css)$/.test(entry.name) ? [target] : [];
  });
}
const read = (relative) => readFileSync(path.join(APP_SRC, relative), 'utf8');
const readAll = (files) => files.map((file) => readFileSync(file, 'utf8')).join('\n');
const locationFiles = sourceFiles(path.join(APP_SRC, 'features/booking/location'));
const c008Files = [
  ...locationFiles,
  path.join(APP_SRC, 'state/locationStep.ts'),
  path.join(APP_SRC, 'fixtures/customerLocationScenarios.ts'),
  path.join(APP_SRC, 'shared/art/IllustrativeMapArt.tsx'),
  path.join(APP_SRC, 'shared/art/mapMarkup.ts'),
];
const c008Source = readAll(c008Files);
const c008Code = readAll(c008Files.filter((file) => !file.endsWith('.css')));
/** Code with comments removed, for checks about what the code does. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const empty = () => homeScenarioState('home-empty');
const withDraft = (changes) => ({ ...empty(), draft: { ...blankBookingDraft(), ...changes } });
const sheetOf = (state) => addressSheetValuesForDraft(state.draft);

test('C008 draft: a new draft has no place and keeps the save-address wish on', () => {
  const draft = blankBookingDraft();
  assert.equal(draft.address, '');
  assert.equal(draft.addressLabel, 'المنزل');
  assert.equal(draft.locationNote, '');
  assert.equal(draft.place, null);
  assert.equal(draft.saveAddress, true);
});

test('C008 flow: location is the third of seven steps, between care and time', () => {
  assert.equal(bookingFlow.length, 7);
  assert.deepEqual(
    bookingFlow.map((step) => step.id),
    ['vehicle', 'care', 'location', 'time', 'contact', 'payment', 'review'],
  );
  assert.deepEqual(bookingFlow[2], { id: 'location', label: 'المكان', nextLabel: 'اختيار الموعد' });
  assert.equal(bookingSteps[2].path, '/book/2');
  assert.equal(bookingSteps.length, 7);
  assert.equal(pathForIntent(submitCareStep(empty()).intent), '/book/2');
});

test('C008 samples: the two demonstration addresses are exactly the reference ones', () => {
  assert.deepEqual(sampleLocation('home'), {
    addressLabel: 'المنزل',
    address: 'دمشق، المزة، شارع تجريبي 12',
    locationNote: '',
    place: { kind: 'home', x: 350, y: 250, label: 'عنوان توضيحي للتجربة' },
    saveAddress: true,
  });
  assert.deepEqual(sampleLocation('work'), {
    addressLabel: 'العمل',
    address: 'دمشق، المالكي، مبنى تجريبي 8',
    locationNote: '',
    place: { kind: 'work', x: 433, y: 196, label: 'عنوان توضيحي للتجربة' },
    saveAddress: true,
  });
  for (const text of [
    'دمشق، المزة، شارع تجريبي 12',
    'دمشق، المالكي، مبنى تجريبي 8',
    'عنوان توضيحي للتجربة',
  ]) {
    assert.ok(reference.includes(text), `reference contains "${text}"`);
  }
});

test('C008 shortcut: choosing a sample fills the draft, clears the note and notifies', () => {
  const before = withDraft({ locationNote: 'ملاحظة قديمة', saveAddress: false });
  const after = chooseSampleLocation(before, 'work');
  assert.equal(after.draft.address, 'دمشق، المالكي، مبنى تجريبي 8');
  assert.equal(after.draft.addressLabel, 'العمل');
  assert.equal(after.draft.locationNote, '');
  assert.equal(after.draft.place.kind, 'work');
  assert.equal(after.draft.saveAddress, true);
  assert.equal(after.draft.touched, true);
  assert.equal(after.notice.message, SAMPLE_CHOSEN_NOTICE);
  assert.equal(before.draft.address, '', 'the previous state is not mutated');
});

test('C008 shortcut: changes only location fields of the draft', () => {
  const before = withDraft({
    vehicleType: 'suv',
    plate: '12 ب',
    service: 'premium',
    extras: ['seats'],
    contactName: 'سامر',
    paymentMethod: 'cash',
  });
  const after = chooseSampleLocation(before, 'home').draft;
  for (const key of ['vehicleType', 'plate', 'service', 'extras', 'contactName', 'paymentMethod']) {
    assert.deepEqual(after[key], before.draft[key], key);
  }
  assert.deepEqual(illustrativeCost(after), illustrativeCost(before.draft), 'price is unchanged');
});

test('C008 sheet: opens with the draft values and a default label', () => {
  assert.deepEqual(sheetOf(empty()), {
    address: '',
    addressLabel: 'المنزل',
    locationNote: '',
    place: null,
    saveAddress: true,
  });
  const state = withDraft({ addressLabel: '', address: 'عنوان' });
  assert.equal(sheetOf(state).addressLabel, 'المنزل');
  const placed = locationScenarioState('booking-location-map-point');
  const values = sheetOf(placed);
  assert.deepEqual(values.place, placed.draft.place);
  assert.notEqual(values.place, placed.draft.place, 'the sheet edits a copy of the place');
  assert.equal(values.saveAddress, false);
});

test('C008 sheet: an address shorter than four characters is refused', () => {
  for (const address of ['', 'abc', '   ab   ', '    ']) {
    const state = empty();
    const result = applyAddressSheet(state, { ...sheetOf(state), address });
    assert.equal(result.error, ADDRESS_TOO_SHORT_MESSAGE, JSON.stringify(address));
    assert.equal(result.state, state, 'a refused sheet leaves the session untouched');
  }
  assert.ok(reference.includes(ADDRESS_TOO_SHORT_MESSAGE));
});

test('C008 sheet: submit trims, caps and applies the values to the draft', () => {
  const state = empty();
  const result = applyAddressSheet(state, {
    address: `  ${'ع'.repeat(200)}  `,
    addressLabel: `  ${'ل'.repeat(60)} `,
    locationNote: ` ${'م'.repeat(200)} `,
    place: null,
    saveAddress: false,
  });
  assert.equal(result.error, null);
  assert.equal(result.state.draft.address, 'ع'.repeat(160));
  assert.equal(result.state.draft.addressLabel, 'ل'.repeat(30));
  assert.equal(result.state.draft.locationNote, 'م'.repeat(160));
  assert.equal(result.state.draft.saveAddress, false);
  assert.equal(result.state.draft.touched, true);
  assert.equal(result.state.notice.message, LOCATION_SET_NOTICE);
});

test('C008 sheet: an empty label falls back and a typed address gets a manual place', () => {
  const state = empty();
  const { draft } = applyAddressSheet(state, {
    ...sheetOf(state),
    address: 'دمشق، عنوان يدوي',
    addressLabel: '   ',
  }).state;
  assert.equal(draft.addressLabel, 'مكان الغسيل');
  assert.deepEqual(draft.place, { kind: 'manual', x: 350, y: 250, label: 'عنوان يدوي' });
});

test('C008 sheet: its values are temporary until submitted', () => {
  const state = locationScenarioState('booking-location-sample-work');
  const snapshot = globalThis.structuredClone(state);
  const typed = { ...sheetOf(state), address: 'عنوان آخر', locationNote: 'ملاحظة' };
  const pinned = setSheetMapPoint(typed, 100, 100).values;
  const sampled = applySampleToSheet(pinned, 'home');
  const located = applyGeolocationOutcome(sampled, 'in-range').values;
  assert.equal(located.place.kind, 'gps');
  assert.deepEqual(state, snapshot, 'editing the sheet never touches the session');
});

test('C008 save-address: the wish is a draft flag and creates no saved-address record', () => {
  const state = garageScenarioState('garage-vehicle-chosen');
  const result = applyAddressSheet(state, {
    ...sheetOf(state),
    address: 'دمشق، عنوان للحفظ',
    saveAddress: true,
  }).state;
  assert.equal(result.draft.saveAddress, true);
  assert.deepEqual(
    Object.keys(result).sort(),
    Object.keys(state).sort(),
    'no address collection is added to the session',
  );
  assert.equal('addresses' in result, false);
  assert.equal(result.vehicles, state.vehicles, 'the garage is untouched');
  assert.equal(result.orders, state.orders, 'no order is created');
});

test('C008 map: a tapped point is bounded, rounded and labelled', () => {
  const values = sheetOf(empty());
  const placed = setSheetMapPoint(values, 228.4, 311.6);
  assert.deepEqual(placed.values.place, {
    kind: 'map',
    x: 228,
    y: 312,
    label: 'نقطة مختارة على الخريطة التوضيحية',
  });
  assert.deepEqual(placed.position, { x: 228.4, y: 311.6 }, 'the pin is drawn unrounded');
  assert.deepEqual(setSheetMapPoint(values, -50, 9999).values.place, {
    kind: 'map',
    x: 20,
    y: 480,
    label: 'نقطة مختارة على الخريطة التوضيحية',
  });
  assert.deepEqual(boundPinPosition(900, -3), { x: 680, y: 20 });
});

test('C008 map: a point fills only an empty or sample address', () => {
  const values = sheetOf(empty());
  assert.equal(setSheetMapPoint(values, 100, 100).values.address, MAP_POINT_ADDRESS);
  const sample = applySampleToSheet(values, 'home');
  assert.equal(setSheetMapPoint(sample, 100, 100).values.address, MAP_POINT_ADDRESS);
  const typed = { ...values, address: 'دمشق، عنوان كتبته بنفسي' };
  assert.equal(setSheetMapPoint(typed, 100, 100).values.address, 'دمشق، عنوان كتبته بنفسي');
  assert.ok(reference.includes(MAP_POINT_ADDRESS));
});

test('C008 map: arrow keys move the pin by fifteen from where it is', () => {
  const values = sheetOf(empty());
  const left = moveSheetPin(values, -15, 0).values;
  assert.deepEqual([left.place.x, left.place.y], [335, 250], 'an unset pin starts at the centre');
  const up = moveSheetPin(left, 0, -15).values;
  assert.deepEqual([up.place.x, up.place.y], [335, 235]);
  let edge = up;
  for (let i = 0; i < 60; i += 1) edge = moveSheetPin(edge, 15, 15).values;
  assert.deepEqual([edge.place.x, edge.place.y], [680, 480], 'the pin stops at the edge');
});

test('C008 map: zoom is bounded for buttons, wheel and pinch', () => {
  let view = INITIAL_MAP_VIEW;
  assert.deepEqual(view, { zoom: 1, panX: 0, panY: 0 });
  for (let i = 0; i < 12; i += 1) view = zoomMapView(view, 0.2);
  assert.equal(view.zoom, 2.2);
  for (let i = 0; i < 20; i += 1) view = zoomMapView(view, -0.2);
  assert.equal(view.zoom, 0.7);
  assert.ok(Math.abs(zoomMapView(INITIAL_MAP_VIEW, 0.1).zoom - 1.1) < 1e-9);
  assert.equal(pinchMapView(INITIAL_MAP_VIEW, 1, 100, 150).zoom, 1.5);
  assert.equal(pinchMapView(INITIAL_MAP_VIEW, 1, 100, 900).zoom, 2.2);
  assert.equal(pinchMapView(INITIAL_MAP_VIEW, 1, 100, 1).zoom, 0.7);
  assert.equal(pinchMapView(INITIAL_MAP_VIEW, 1, 0, 2).zoom, 2, 'a zero start distance is safe');
});

test('C008 map: pan is bounded and taps account for pan and zoom', () => {
  assert.deepEqual(panMapView(INITIAL_MAP_VIEW, 999, -999), { zoom: 1, panX: 250, panY: -190 });
  assert.deepEqual(panMapView(INITIAL_MAP_VIEW, -40, 25), { zoom: 1, panX: -40, panY: 25 });
  assert.deepEqual(mapPointAt(INITIAL_MAP_VIEW, 0, 0), { x: 350, y: 250 });
  assert.deepEqual(mapPointAt({ zoom: 2, panX: 40, panY: -20 }, 100, 60), { x: 380, y: 290 });
});

test('C008 location: a device position is reduced to in or out of the range', () => {
  assert.equal(classifyDevicePosition(24.7136, 46.6753), 'in-range');
  assert.equal(classifyDevicePosition(24.7001, 46.6502), 'in-range');
  assert.equal(classifyDevicePosition(25.29, 46.6753), 'in-range', 'just inside 65 km');
  assert.equal(classifyDevicePosition(25.31, 46.6753), 'out-of-range', 'just outside 65 km');
  assert.equal(classifyDevicePosition(0, 0), 'out-of-range');
  assert.equal(typeof classifyDevicePosition(24.7, 46.6), 'string', 'only a class comes back');
});

test('C008 location: only an in-range answer changes the sheet, and never the address', () => {
  const values = { ...sheetOf(empty()), address: 'دمشق، عنوان كتبته' };
  const inRange = applyGeolocationOutcome(values, 'in-range');
  assert.deepEqual(inRange.values.place, {
    kind: 'gps',
    x: 350,
    y: 250,
    label: 'موقع داخل نطاق دمشق التقريبي، أكمل العنوان',
  });
  assert.equal(inRange.values.address, values.address, 'no address is derived from a position');
  assert.equal(inRange.notice, GEOLOCATION_IN_RANGE_NOTICE);
  const expected = {
    unsupported: GEOLOCATION_UNSUPPORTED_NOTICE,
    insecure: GEOLOCATION_INSECURE_NOTICE,
    denied: GEOLOCATION_DENIED_NOTICE,
    failed: GEOLOCATION_FAILED_NOTICE,
    'out-of-range': GEOLOCATION_OUT_OF_RANGE_NOTICE,
  };
  for (const [outcome, notice] of Object.entries(expected)) {
    const result = applyGeolocationOutcome(values, outcome);
    assert.equal(result.values, values, `${outcome} leaves the sheet as it was`);
    assert.equal(result.notice, notice);
    assert.ok(reference.includes(notice), `reference contains the ${outcome} notice`);
  }
  assert.ok(reference.includes(GEOLOCATION_IN_RANGE_NOTICE));
});

test('C008 location: failure codes map to denied or failed, and the request is coarse', () => {
  assert.equal(geolocationFailureOutcome(1), 'denied');
  assert.equal(geolocationFailureOutcome(2), 'failed');
  assert.equal(geolocationFailureOutcome(3), 'failed');
  assert.deepEqual(GEOLOCATION_REQUEST_OPTIONS, {
    enableHighAccuracy: false,
    timeout: 8000,
    maximumAge: 60000,
  });
});

test('C008 privacy: a place never carries geographic coordinates', () => {
  const places = [
    sampleLocation('home').place,
    sampleLocation('work').place,
    setSheetMapPoint(sheetOf(empty()), 10, 10).values.place,
    applyGeolocationOutcome(sheetOf(empty()), 'in-range').values.place,
    ...locationScenarioIds.map((id) => locationScenarioState(id).draft.place),
  ];
  for (const place of places) {
    assert.deepEqual(Object.keys(place).sort(), ['kind', 'label', 'x', 'y']);
    assert.ok(Number.isInteger(place.x) && place.x >= 20 && place.x <= 680);
    assert.ok(Number.isInteger(place.y) && place.y >= 20 && place.y <= 480);
  }
  assert.deepEqual(
    Object.keys(blankBookingDraft()).filter((key) =>
      /^lat|^lon|^lng|latitude|longitude|coord|geo/i.test(key),
    ),
    [],
  );
});

test('C008 privacy: location is requested from one place, on the customer tap only', () => {
  const allCode = withoutComments(readAll(sourceFiles(APP_SRC).filter((f) => !f.endsWith('.css'))));
  const users = sourceFiles(APP_SRC).filter((file) =>
    /navigator\s*\.\s*geolocation|getCurrentPosition|watchPosition/.test(
      withoutComments(readFileSync(file, 'utf8')),
    ),
  );
  assert.deepEqual(
    users.map((file) => path.relative(APP_SRC, file).replaceAll('\\', '/')),
    ['features/booking/location/deviceLocation.ts'],
  );
  assert.ok(!/watchPosition/.test(allCode), 'the position is never tracked');
  assert.ok(!/permissions\s*\.\s*query/.test(allCode), 'permission state is never probed');

  const device = withoutComments(read('features/booking/location/deviceLocation.ts'));
  assert.equal(device.match(/getCurrentPosition/g).length, 1);
  assert.ok(!/console\.|localStorage|sessionStorage|fetch\(/.test(device));
  // The coordinates go straight into the classifier and nowhere else.
  assert.equal(device.match(/coords/g).length, 2);
  assert.match(
    device,
    /classifyDevicePosition\(position\.coords\.latitude, position\.coords\.longitude\)/,
  );

  const sheet = withoutComments(read('features/booking/location/components/AddressSheet.tsx'));
  assert.equal(sheet.match(/requestDevicePositionClass\(\)/g).length, 1);
  assert.match(sheet, /onLocate=\{\(\) => void locate\(\)\}/, 'called from the button handler');
  assert.ok(!/useEffect\([^)]*locate/.test(sheet), 'never requested from an effect');
  const callers = sourceFiles(APP_SRC).filter((file) =>
    /requestDevicePositionClass\(/.test(withoutComments(readFileSync(file, 'utf8'))),
  );
  assert.equal(callers.length, 2, 'defined once, called once');
});

test('C008 privacy: no map provider, geocoder, network, storage or logging', () => {
  const code = withoutComments(c008Code);
  for (const pattern of [
    /fetch\(/,
    /XMLHttpRequest/,
    /sendBeacon/,
    /WebSocket/,
    /localStorage|sessionStorage|indexedDB|document\.cookie/,
    /console\./,
    /https?:\/\//,
    /leaflet|mapbox|maplibre|google\.maps|openstreetmap|nominatim|tile/i,
    /geocod/i,
  ]) {
    assert.ok(!pattern.test(code), `C008 code must not match ${pattern}`);
  }
  assert.ok(!/url\(\s*['"]?https?:/.test(c008Source), 'no remote asset in the styles');
});

test('C008 step: Next is refused without a usable address', () => {
  for (const address of ['', 'abc', '   a  ']) {
    const state = withDraft({ address });
    const result = submitLocationStep(state);
    assert.equal(result.intent, null);
    assert.equal(result.addressError, LOCATION_REQUIRED_MESSAGE);
    assert.equal(result.state.draft, state.draft, 'the draft is untouched');
    assert.equal(result.state.draftStep, state.draftStep);
    assert.equal(result.state.announcement.message, LOCATION_REQUIRED_MESSAGE);
    assert.equal(isLocationComplete(state.draft), false);
  }
  assert.ok(reference.includes(LOCATION_REQUIRED_MESSAGE));
});

test('C008 step: Next with a place leads to the time step and creates nothing', () => {
  const state = chooseSampleLocation(garageScenarioState('garage-vehicle-chosen'), 'home');
  const result = submitLocationStep(state);
  assert.equal(result.addressError, null);
  assert.deepEqual(result.intent, { kind: 'booking-step', step: 3 });
  assert.equal(pathForIntent(result.intent), '/book/3');
  assert.equal(result.state.draftStep, 3);
  assert.equal(result.state.draft.slot, state.draft.slot, 'no slot is chosen on the way');
  assert.equal(result.state.orders, state.orders);
  assert.equal(result.state.vehicles, state.vehicles);
});

test('C008 step: Back returns to care and leaves the draft alone', () => {
  const state = locationScenarioState('booking-location-manual-note');
  const result = returnToCareStep(state);
  assert.equal(result.state, state);
  assert.equal(pathForIntent(result.intent), '/book/1');
});

test('C008 resume: a draft without an address never enters past the location step', () => {
  const draft = { ...blankBookingDraft(), touched: true };
  for (const step of [3, 4, 5, 6]) assert.equal(resolveBookingEntryStep(draft, step), 2);
  assert.equal(resolveBookingEntryStep({ ...draft, address: 'abc' }, 3), 2);
  assert.equal(resolveBookingEntryStep({ ...draft, address: 'دمشق، عنوان' }, 3), 3);
  const saved = { ...locationScenarioState('booking-location-sample-work'), draftStep: 2 };
  assert.deepEqual(resumeBooking(saved).intent, { kind: 'booking-step', step: 2 });
});

test('C008 repeat: a repeat-derived draft owns its location and never alters the order', () => {
  const state = homeScenarioState('home-repeat-order');
  const snapshot = globalThis.structuredClone(state.orders);
  const repeated = repeatOrder(state, state.orders[0].id).state;
  assert.equal(repeated.draft.address, state.orders[0].address);
  assert.equal(repeated.draft.place, null);
  const edited = chooseSampleLocation(repeated, 'work');
  assert.equal(edited.draft.address, 'دمشق، المالكي، مبنى تجريبي 8');
  assert.deepEqual(edited.orders, snapshot, 'the past order keeps its own address');
});

test('C008 view: the card and shortcuts describe the draft with the approved copy', () => {
  const blank = buildLocationStepViewModel(empty());
  assert.equal(blank.hasAddress, false);
  assert.equal(blank.cardLabel, 'تحديد مكان غسيل السيارة');
  assert.equal(blank.cardTitle, 'حدد مكان السيارة');
  assert.equal(blank.cardPreview, 'اكتب العنوان أو اختر نقطة على الخريطة');
  assert.deepEqual(
    blank.shortcuts.map((item) => [item.kind, item.icon, item.name, item.selected]),
    [
      ['home', 'home', 'المنزل', false],
      ['work', 'work', 'العمل', false],
    ],
  );
  assert.equal(blank.selectedShortcut, null);

  const work = buildLocationStepViewModel(locationScenarioState('booking-location-sample-work'));
  assert.equal(work.cardLabel, 'تعديل مكان غسيل السيارة');
  assert.equal(work.cardTitle, 'العمل');
  assert.equal(work.cardPreview, 'دمشق، المالكي، مبنى تجريبي 8');
  assert.deepEqual(
    work.shortcuts.map((item) => item.selected),
    [false, true],
  );
  assert.equal(work.selectedShortcut, 'work');

  const map = buildLocationStepViewModel(locationScenarioState('booking-location-map-point'));
  assert.equal(map.selectedShortcut, null, 'a map point marks neither shortcut');
  const unlabelled = buildLocationStepViewModel(withDraft({ address: 'عنوان', addressLabel: '' }));
  assert.equal(unlabelled.cardTitle, 'موقع الغسيل');
  const noted = buildLocationStepViewModel(locationScenarioState('booking-location-manual-note'));
  assert.equal(noted.locationNote, 'أمام البوابة الخضراء، اتصل عند الوصول');
});

test('C008 view: the footer uses the one pricing calculation and location never changes it', () => {
  for (const id of locationScenarioIds) {
    const state = locationScenarioState(id);
    const view = buildLocationStepViewModel(state);
    const cost = illustrativeCost(state.draft);
    assert.equal(view.footerTotal, cost.total, id);
    assert.equal(view.footerMinutes, cost.minutes, id);
    const moved = chooseSampleLocation(state, 'home');
    assert.equal(buildLocationStepViewModel(moved).footerTotal, cost.total, id);
  }
  assert.ok(!/illustrativeCost|price|fee/i.test(read('state/locationStep.ts')));
});

test('C008 home: a draft left on the location step is offered for resuming', () => {
  const state = { ...locationScenarioState('booking-location-sample-work'), draftStep: 2 };
  const home = buildHomeViewModel(state);
  assert.ok(JSON.stringify(home).includes('لمعة سريعة'), 'the saved draft card is present');
  assert.equal(pathForIntent(resumeBooking(state).intent), '/book/2');
});

test('C008 scenarios: deterministic, selectable and free of real data', () => {
  assert.deepEqual(locationScenarioIds, [
    'booking-location-sample-work',
    'booking-location-map-point',
    'booking-location-manual-note',
  ]);
  for (const id of locationScenarioIds) {
    assert.deepEqual(initialSessionState(`#/book/2?scenario=${id}`), locationScenarioState(id));
    assert.deepEqual(locationScenarioState(id), locationScenarioState(id));
    assert.notEqual(
      locationScenarioState(id),
      locationScenarioState(id),
      'a fresh object each time',
    );
    const { draft } = locationScenarioState(id);
    assert.ok(isLocationComplete(draft));
    assert.ok(/تجريبي|توضيحي/.test(draft.address), `${id} uses a sample address`);
  }
  for (const hostile of ['__proto__', 'constructor', 'toString', 'booking-location-unknown']) {
    assert.deepEqual(
      initialSessionState(`#/book/2?scenario=${hostile}`),
      homeScenarioState('home-empty'),
    );
  }
  const fixtures = read('fixtures/customerLocationScenarios.ts');
  assert.ok(!/\d{1,3}\.\d{3,}/.test(fixtures), 'no coordinate-like number in the fixtures');
});

test('C008 art: the map is the reference drawing, byte for byte', () => {
  assert.ok(reference.includes(illustrativeMapMarkup));
  assert.ok(
    illustrativeMapMarkup.trim().startsWith('<svg viewBox="0 0 700 500" aria-hidden="true">'),
  );
  assert.ok(illustrativeMapMarkup.trim().endsWith('</svg>'));
  assert.ok(!/<image|href=|url\(/.test(illustrativeMapMarkup), 'the drawing loads nothing');
  const art = read('shared/art/IllustrativeMapArt.tsx');
  assert.match(art, /viewBox="0 0 700 500"/);
  assert.match(art, /aria-hidden="true"/);
});

test('C008 copy: every approved string of the step and the sheet is present', () => {
  const copy = [
    '03 / أنت تختار المكان',
    'أين نأتي لسيارتك؟',
    'في البيت أو العمل. اللمعة تصلك.',
    'خريطة توضيحية',
    'للتجربة السريعة',
    'عناوين توضيحية فقط',
    'عنوان تجريبي',
    'لتسهيل الوصول، أضف الشارع ومكان الوقوف. يمكنك كتابة العنوان دون السماح بتحديد موقعك.',
    'مكان سيارتك، بكل بساطة.',
    'اكتب العنوان مباشرة، أو حرّك الخريطة وانقر لوضع الدبوس.',
    'الخريطة توضيحية وليست للملاحة',
    'خريطة توضيحية. انقر لتحديد الدبوس، واسحب للتحريك. تدعم الأسهم والتكبير.',
    'تكبير الخريطة',
    'تصغير الخريطة',
    'موقعي الحالي',
    'جارٍ تحديد الموقع',
    'خريطة توضيحية · ليست للملاحة',
    'العنوان بالتفصيل',
    'الحي، الشارع، المبنى ومكان السيارة',
    'منزل تجريبي',
    'عمل تجريبي',
    'اسم العنوان',
    'المنزل / العمل',
    'ملاحظة الوصول',
    'أمام البوابة',
    'احفظ العنوان على جهازي للحجز القادم.',
    'اعتماد هذا المكان',
    'تم تحديد مكان الغسيل.',
    'عنوان توضيحي مختار. يمكنك تعديله.',
    'تم اختيار نقطة جديدة على الخريطة التوضيحية.',
  ];
  for (const text of copy) {
    assert.ok(reference.includes(text), `reference contains "${text}"`);
    assert.ok(c008Source.includes(text), `the port contains "${text}"`);
  }
});

test('C008 scope: no saved-address management (C009) and no time step (C010)', () => {
  const code = withoutComments(c008Code);
  for (const pattern of [
    /saved-address/,
    /sheet-saved-address/,
    /savedAddressesSheet/,
    /add-address|edit-address|delete-address/,
    /address-chips/,
    /حفظ العنوان['"<]/,
  ]) {
    assert.ok(!pattern.test(code), `C008 must not implement ${pattern}`);
  }
  const route = read('features/booking/index.tsx');
  assert.match(route, /if \(step === 'location'\) return <LocationStep \/>;/);
  assert.ok(!/step === 'time'/.test(route), 'the time step stays a placeholder');
  const shell = read('app/CustomerShell.tsx');
  assert.ok(!shell.includes("'/book/3'"), 'the shell does not treat the time step as ported');
});

test('C008 safety: customer text is rendered as text', () => {
  for (const file of locationFiles.filter((name) => name.endsWith('.tsx'))) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!source.includes('dangerouslySetInnerHTML'), path.basename(file));
    assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(source), path.basename(file));
  }
  // The only raw markup is the static drawing, which takes no input.
  const art = read('shared/art/IllustrativeMapArt.tsx');
  assert.equal(art.match(/dangerouslySetInnerHTML/g).length, 1);
  assert.ok(!/props|\{\s*\w+\s*\}:\s*\{/.test(withoutComments(art)), 'the drawing has no props');
});

test('C008 architecture: pure state, feature boundaries and semantic controls', () => {
  const state = read('state/locationStep.ts');
  assert.ok(!/from 'react|window\.|document\.|navigator\./.test(withoutComments(state)));
  for (const specifier of state.matchAll(/from '([^']+)'/g)) {
    assert.match(specifier[1], /^\.\/[\w]+\.ts$/, 'state imports are local .ts modules');
  }
  for (const file of locationFiles) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/features\/(?!booking)|\/app\//.test(source), path.basename(file));
  }
  const card = read('features/booking/location/components/LocationCard.tsx');
  assert.match(card, /aria-haspopup="dialog"/);
  assert.match(card, /aria-pressed=\{shortcut\.selected\}/);
  assert.ok(!/role="button"|<div[^>]*onClick/.test(card), 'controls are native buttons');
  const map = read('features/booking/location/components/IllustrativeMap.tsx');
  assert.match(map, /role="group"/);
  assert.match(map, /tabIndex=\{0\}/);
  assert.match(map, /passive: false/);
});
