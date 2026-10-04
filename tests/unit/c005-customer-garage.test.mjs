import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { blankBookingDraft } from '../../apps/customer-web/src/state/bookingDraft.ts';
import { resumeBooking, startBooking } from '../../apps/customer-web/src/state/bookingEntry.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';
import {
  DRAFT_VEHICLE_UPDATED_NOTICE,
  EDITOR_PLATE_MESSAGE,
  GARAGE_CAPACITY,
  GARAGE_FULL_NOTICE,
  VEHICLE_CHOSEN_NOTICE,
  VEHICLE_DELETED_NOTICE,
  VEHICLE_SAVED_NOTICE,
  applyEditorToDraft,
  blankEditorValues,
  bookSavedVehicle,
  chooseSavedVehicle,
  deleteSavedVehicle,
  describeVehicle,
  editorValuesForDraft,
  editorValuesForVehicle,
  previewPlate,
  saveGarageVehicle,
} from '../../apps/customer-web/src/state/savedVehicles.ts';
import {
  changePlate,
  selectVehicleType,
  submitVehicleStep,
} from '../../apps/customer-web/src/state/vehicleStep.ts';
import {
  garageScenarioIds,
  garageScenarioState,
  isGarageScenarioId,
} from '../../apps/customer-web/src/fixtures/customerGarageScenarios.ts';
import { homeScenarioState } from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import { buildGarageViewModel } from '../../apps/customer-web/src/features/garage/garageViewModel.ts';
import { buildVehicleStepViewModel } from '../../apps/customer-web/src/features/booking/vehicle/vehicleViewModel.ts';
import {
  PLATE_PREVIEW_PLACEHOLDER,
  editorSizeOptions,
  platePreviewText,
  savedVehicleChoices,
} from '../../apps/customer-web/src/widgets/vehicle-editor/vehicleEditorModel.ts';

// The rendering contract's fixed instant (12:00 in Damascus, 2026-09-20). Booking-entry
// commands judge the appointment at an explicit instant since C010.
const NOW = new Date('2026-09-20T09:00:00.000Z');
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
const readAll = (files) => files.map((file) => readFileSync(file, 'utf8')).join('\n');
const garageFiles = sourceFiles(path.join(APP_SRC, 'features/garage'));
const widgetFiles = sourceFiles(path.join(APP_SRC, 'widgets'));
const c005Source = readAll([
  ...garageFiles,
  ...widgetFiles,
  path.join(APP_SRC, 'state/savedVehicles.ts'),
  path.join(APP_SRC, 'fixtures/customerGarageScenarios.ts'),
  path.join(APP_SRC, 'features/booking/vehicle/components/VehicleDetails.tsx'),
]);

const empty = () => homeScenarioState('home-empty');
const one = () => garageScenarioState('garage-one-vehicle');
const three = () => garageScenarioState('garage-three-vehicles');
const values = (changes = {}) => ({ ...blankEditorValues, ...changes });

test('C005 empty garage: no cards, the empty state is shown', () => {
  const view = buildGarageViewModel(empty());
  assert.equal(view.empty, true);
  assert.deepEqual(view.cards, []);
  assert.deepEqual(empty().vehicles, []);
  assert.equal(empty().vehicleSequence, 0);
});

test('C005 populated garage: one card per saved car, in saved order', () => {
  const view = buildGarageViewModel(three());
  assert.equal(view.empty, false);
  assert.deepEqual(view.cards, [
    {
      id: 'CAR-1',
      name: 'سيارة العائلة',
      description: 'كروس أوفر · أبيض',
      plate: '4821 ب ج',
      art: 'suv',
    },
    { id: 'CAR-2', name: 'بيك أب', description: 'بيك أب', plate: null, art: 'pickup' },
    {
      id: 'CAR-3',
      name: '<b>كامري</b> & "تجربة"',
      description: 'سيدان · رمادي',
      plate: '7 ABC',
      art: 'sedan',
    },
  ]);
});

test('C005 garage scenarios are deterministic sample data and allowlisted', () => {
  assert.deepEqual(garageScenarioIds, [
    'garage-one-vehicle',
    'garage-three-vehicles',
    'garage-vehicle-chosen',
  ]);
  for (const id of garageScenarioIds) {
    assert.deepEqual(garageScenarioState(id), garageScenarioState(id));
    assert.notEqual(garageScenarioState(id), garageScenarioState(id), 'fresh object per call');
    assert.deepEqual(initialSessionState(`#/garage?scenario=${id}`), garageScenarioState(id));
    assert.deepEqual(garageScenarioState(id).orders, [], 'a garage scenario holds no order');
  }
  for (const bad of [
    null,
    undefined,
    '',
    '__proto__',
    'constructor',
    'toString',
    'home-empty',
    '<x>',
  ]) {
    assert.equal(isGarageScenarioId(bad), false, String(bad));
  }
  assert.deepEqual(initialSessionState('#/garage?scenario=__proto__'), empty());
  assert.deepEqual(initialSessionState('#/garage'), empty());
});

test('C005 editor values are cleaned exactly as the reference cleans them', () => {
  assert.deepEqual(
    describeVehicle(
      values({ type: 'suv', carName: '  كامري  ', plate: '  ١٢٣٤    أ  ب  ', color: ' أبيض ' }),
    ),
    { type: 'suv', carName: 'كامري', plate: '1234 أ ب', color: 'أبيض' },
  );
  // Eastern Arabic-Indic digits, tabs and newlines.
  assert.equal(describeVehicle(values({ plate: '۵۶۷۸\t\nب' })).plate, '5678 ب');
  // Length caps: plate 20, name 60, colour 30.
  const long = describeVehicle(
    values({ plate: '1'.repeat(40), carName: 'ا'.repeat(90), color: 'ب'.repeat(50) }),
  );
  assert.equal(long.plate.length, 20);
  assert.equal(long.carName.length, 60);
  assert.equal(long.color.length, 30);
  // Deterministic and idempotent.
  const once = describeVehicle(values({ plate: ' ١٢  ٣ ' }));
  assert.deepEqual(describeVehicle(values({ plate: once.plate })), { ...once });
});

test('C005 plate preview normalises digits and falls back to the sample plate', () => {
  assert.equal(previewPlate('١٢٣ أ'), '123 أ');
  assert.equal(platePreviewText('۹۸ ب'), '98 ب');
  assert.equal(platePreviewText(''), PLATE_PREVIEW_PLACEHOLDER);
  assert.equal(PLATE_PREVIEW_PLACEHOLDER, '1234 أ ب ج');
});

test('C005 editor offers the four sizes in the approved order', () => {
  assert.deepEqual(
    editorSizeOptions.map((option) => [option.id, option.name, option.priceLabel, option.art]),
    [
      ['sedan', 'سيدان', 'السعر الأساسي', 'sedan'],
      ['suv', 'كروس أوفر', '+200 ل.س', 'suv'],
      ['large', 'دفع رباعي', '+350 ل.س', 'suv'],
      ['pickup', 'بيك أب', '+250 ل.س', 'pickup'],
    ],
  );
});

test('C005 add: a new car is appended with a deterministic id and a notice', () => {
  const state = empty();
  const { state: next, error } = saveGarageVehicle(
    state,
    null,
    values({ type: 'suv', carName: 'سيارة العائلة', plate: '٤٨٢١ ب ج', color: 'أبيض' }),
    'كروس أوفر',
  );
  assert.equal(error, null);
  assert.deepEqual(next.vehicles, [
    { id: 'CAR-1', type: 'suv', name: 'سيارة العائلة', plate: '4821 ب ج', color: 'أبيض' },
  ]);
  assert.equal(next.vehicleSequence, 1);
  assert.equal(next.notice.message, VEHICLE_SAVED_NOTICE);
  assert.deepEqual(state.vehicles, [], 'the previous state is not mutated');

  const second = saveGarageVehicle(next, null, values({ type: 'pickup' }), 'بيك أب').state;
  assert.deepEqual(
    second.vehicles.map((vehicle) => [vehicle.id, vehicle.name]),
    [
      ['CAR-1', 'سيارة العائلة'],
      ['CAR-2', 'بيك أب'],
    ],
    'an unnamed car takes its size name',
  );
});

test('C005 ids are never reused after a delete', () => {
  const afterDelete = deleteSavedVehicle(three(), 'CAR-3');
  const added = saveGarageVehicle(afterDelete, null, values({ plate: '9 ك' }), 'سيدان').state;
  assert.deepEqual(
    added.vehicles.map((vehicle) => vehicle.id),
    ['CAR-1', 'CAR-2', 'CAR-4'],
  );
});

test('C005 edit: the saved car is updated in place and keeps its id and position', () => {
  const state = three();
  const { state: next, error } = saveGarageVehicle(
    state,
    'CAR-2',
    values({ type: 'large', carName: 'شاحنة العمل', plate: '٣٣٣ ك', color: 'أزرق' }),
    'دفع رباعي',
  );
  assert.equal(error, null);
  assert.equal(next.vehicles.length, 3);
  assert.deepEqual(next.vehicles[1], {
    id: 'CAR-2',
    type: 'large',
    name: 'شاحنة العمل',
    plate: '333 ك',
    color: 'أزرق',
  });
  assert.equal(next.vehicles[0], state.vehicles[0], 'other cars are untouched');
  assert.equal(next.vehicleSequence, 3);
  assert.deepEqual(editorValuesForVehicle(state.vehicles[0]), {
    type: 'suv',
    carName: 'سيارة العائلة',
    plate: '4821 ب ج',
    color: 'أبيض',
    saveVehicle: true,
  });
});

test('C005 saving the same car again updates it instead of duplicating it', () => {
  // Same plate and size.
  const byPlate = saveGarageVehicle(
    one(),
    null,
    values({ type: 'suv', plate: '4821 ب ج', carName: 'اسم جديد' }),
    'كروس أوفر',
  ).state;
  assert.equal(byPlate.vehicles.length, 1);
  assert.equal(byPlate.vehicles[0].name, 'اسم جديد');
  assert.equal(byPlate.vehicles[0].color, '');
  // No plate: same name, size and colour.
  const noPlate = saveGarageVehicle(three(), null, values({ type: 'pickup' }), 'بيك أب').state;
  assert.equal(noPlate.vehicles.length, 3);
  // Same plate on another size is a different car.
  const otherSize = saveGarageVehicle(
    one(),
    null,
    values({ type: 'sedan', plate: '4821 ب ج' }),
    'سيدان',
  ).state;
  assert.equal(otherSize.vehicles.length, 2);
});

test('C005 an unacceptable plate is refused and nothing is saved', () => {
  for (const plate of ['أ ب ج', 'ABC', '1', '12#4', '<b>12</b>', '12‏34']) {
    const state = one();
    const result = saveGarageVehicle(state, null, values({ plate }), 'سيدان');
    assert.equal(result.error, EDITOR_PLATE_MESSAGE, plate);
    assert.equal(result.state, state, 'state is returned untouched');
    const draftResult = applyEditorToDraft(state, null, values({ plate }));
    assert.equal(draftResult.error, EDITOR_PLATE_MESSAGE, plate);
    assert.equal(draftResult.state, state);
  }
  // Spaces alone are trimmed away by the editor, so they mean "no plate" here.
  assert.equal(saveGarageVehicle(empty(), null, values({ plate: '   ' }), 'سيدان').error, null);
});

test('C005 the garage holds at most 30 cars and says so instead of claiming a save', () => {
  let state = empty();
  for (let index = 0; index < GARAGE_CAPACITY; index += 1) {
    state = saveGarageVehicle(state, null, values({ plate: `${index + 10} أ` }), 'سيدان').state;
  }
  assert.equal(state.vehicles.length, 30);
  const full = saveGarageVehicle(state, null, values({ plate: '999 ي' }), 'سيدان');
  assert.equal(full.error, null);
  assert.equal(full.state.vehicles.length, 30);
  assert.equal(full.state.notice.message, GARAGE_FULL_NOTICE);
  // Editing an existing car still works when the garage is full.
  const edited = saveGarageVehicle(
    state,
    'CAR-1',
    values({ plate: '10 أ', color: 'أحمر' }),
    'سيدان',
  );
  assert.equal(edited.state.vehicles[0].color, 'أحمر');
  assert.equal(edited.state.notice.message, VEHICLE_SAVED_NOTICE);
});

test('C005 delete removes the car, keeps orders and unlinks a draft that used it', () => {
  const state = garageScenarioState('garage-vehicle-chosen');
  const next = deleteSavedVehicle(state, 'CAR-1');
  assert.deepEqual(
    next.vehicles.map((vehicle) => vehicle.id),
    ['CAR-2', 'CAR-3'],
  );
  assert.equal(next.notice.message, VEHICLE_DELETED_NOTICE);
  assert.equal(next.draft.carId, null, 'the draft no longer points at the deleted car');
  assert.equal(next.draft.plate, state.draft.plate, 'but keeps the details it already had');
  assert.equal(next.orders, state.orders);
  assert.equal(deleteSavedVehicle(state, 'CAR-404'), state, 'unknown id is a no-op');
  // Deleting the last car returns to the empty garage.
  assert.equal(buildGarageViewModel(deleteSavedVehicle(one(), 'CAR-1')).empty, true);
});

test('C005 choosing a saved car updates only the draft', () => {
  const state = three();
  const next = chooseSavedVehicle(state, 'CAR-1');
  assert.deepEqual(
    {
      vehicleType: next.draft.vehicleType,
      carId: next.draft.carId,
      carName: next.draft.carName,
      plate: next.draft.plate,
      color: next.draft.color,
      saveVehicle: next.draft.saveVehicle,
      touched: next.draft.touched,
    },
    {
      vehicleType: 'suv',
      carId: 'CAR-1',
      carName: 'سيارة العائلة',
      plate: '4821 ب ج',
      color: 'أبيض',
      saveVehicle: true,
      touched: true,
    },
  );
  assert.equal(next.notice.message, VEHICLE_CHOSEN_NOTICE);
  assert.equal(next.vehicles, state.vehicles, 'the garage is the same object');
  assert.equal(next.orders, state.orders, 'no order was created');
  assert.equal(next.draft.service, state.draft.service);
  assert.equal(next.draftStep, state.draftStep);
  assert.equal(chooseSavedVehicle(state, 'CAR-404'), state, 'unknown id is a no-op');

  const view = buildVehicleStepViewModel(next);
  assert.deepEqual(
    view.savedChoices.map((choice) => [choice.id, choice.selected]),
    [
      ['CAR-1', true],
      ['CAR-2', false],
      ['CAR-3', false],
    ],
  );
  assert.equal(view.stageName, 'سيارة العائلة');
  assert.equal(view.selectedType, 'suv');
  assert.deepEqual(savedVehicleChoices(next.vehicles, next.draft.carId)[0], {
    id: 'CAR-1',
    name: 'سيارة العائلة',
    selected: true,
  });
});

test('C005 picking a size by hand releases the saved car; the garage is unchanged', () => {
  const chosen = chooseSavedVehicle(three(), 'CAR-1');
  const manual = selectVehicleType(chosen, 'large', 'a');
  assert.equal(manual.draft.carId, null);
  assert.equal(manual.draft.carName, '');
  assert.equal(manual.draft.plate, '4821 ب ج', 'the plate stays, as in C004');
  assert.equal(manual.vehicles, chosen.vehicles);
  assert.ok(buildVehicleStepViewModel(manual).savedChoices.every((choice) => !choice.selected));
});

test('C005 booking editor writes to the draft only and never to the garage', () => {
  const state = garageScenarioState('garage-vehicle-chosen');
  assert.deepEqual(editorValuesForDraft(state.draft), {
    type: 'suv',
    carName: 'سيارة العائلة',
    plate: '4821 ب ج',
    color: 'أبيض',
    saveVehicle: true,
  });
  const { state: next, error } = applyEditorToDraft(
    state,
    state.draft.carId,
    values({
      type: 'suv',
      carName: 'سيارة العائلة',
      plate: '4821 ب ج',
      color: 'فضي',
      saveVehicle: false,
    }),
  );
  assert.equal(error, null);
  assert.equal(next.draft.color, 'فضي');
  assert.equal(next.draft.carId, 'CAR-1', 'the link to the saved car is kept');
  assert.equal(next.draft.saveVehicle, false);
  assert.equal(next.notice.message, DRAFT_VEHICLE_UPDATED_NOTICE);
  assert.equal(next.vehicles, state.vehicles, 'the saved car itself is not edited');
  assert.equal(next.vehicles[0].color, 'أبيض');
  assert.equal(next.orders, state.orders);

  // "Other" car: a blank editor result has no link to any saved car.
  const other = applyEditorToDraft(
    state,
    null,
    values({ type: 'pickup', plate: '٢٢٢ ط', carName: 'ضيف' }),
  );
  assert.equal(other.state.draft.carId, null);
  assert.equal(other.state.draft.plate, '222 ط');
  assert.equal(other.state.vehicles.length, 3, 'nothing was added to the garage');
});

test('C005 "book for this car" starts the journey with that car and creates no booking', () => {
  const state = three();
  const { state: next, intent } = bookSavedVehicle(state, 'CAR-3', NOW);
  assert.deepEqual(intent, { kind: 'booking-step', step: 0 });
  assert.equal(pathForIntent(intent), '/book/0');
  assert.equal(next.draft.carId, 'CAR-3');
  assert.equal(next.draft.carName, '<b>كامري</b> & "تجربة"');
  assert.equal(next.draft.plate, '7 ABC');
  assert.equal(next.draft.touched, true);
  assert.deepEqual(next.orders, [], 'a saved car never becomes an order');
  assert.equal(next.vehicles, state.vehicles);
  assert.deepEqual(bookSavedVehicle(state, 'CAR-404', NOW), { state, intent: null });
});

test('C005 starting a booking prefills the first saved car only when the draft describes none', () => {
  const started = startBooking(three(), undefined, NOW).state;
  assert.equal(started.draft.carId, 'CAR-1');
  assert.equal(started.draft.plate, '4821 ب ج');
  assert.equal(started.draft.vehicleType, 'suv');
  // A plate the customer already typed is never replaced.
  const typed = startBooking(changePlate(three(), '55 ه'), undefined, NOW).state;
  assert.equal(typed.draft.carId, null);
  assert.equal(typed.draft.plate, '55 ه');
  // An already chosen car is kept.
  const chosen = startBooking(chooseSavedVehicle(three(), 'CAR-2'), undefined, NOW).state;
  assert.equal(chosen.draft.carId, 'CAR-2');
  // Empty garage: C003/C004 behaviour is unchanged.
  const none = startBooking(empty(), undefined, NOW).state;
  // Since C010 starting also records the day the time step opens on.
  assert.deepEqual(none.draft, {
    ...blankBookingDraft(),
    scheduleDay: '2026-09-20',
    touched: true,
  });
});

test('C005 manual C004 flow still works with and without saved cars', () => {
  for (const state of [empty(), three()]) {
    const typed = changePlate(selectVehicleType(state, 'pickup', 'a'), '١٢٣ أ');
    assert.equal(typed.draft.vehicleType, 'pickup');
    assert.equal(typed.draft.plate, '123 أ');
    assert.equal(typed.draft.carId, null);
    const result = submitVehicleStep(typed);
    assert.deepEqual(result.intent, { kind: 'booking-step', step: 1 });
    assert.equal(result.state.vehicles, state.vehicles, 'advancing does not save a car');
    assert.equal(result.state.orders, state.orders);
    assert.deepEqual(resumeBooking(result.state, NOW).intent, { kind: 'booking-step', step: 1 });
  }
  assert.deepEqual(buildVehicleStepViewModel(empty()).savedChoices, []);
});

test('C005 garage and editor carry the approved Arabic copy verbatim', () => {
  for (const copy of [
    'أضفها مرة. واحجز براحتك.',
    'سياراتي.',
    'نوع السيارة ولوحتها وتفاصيلها، جاهزة للغسلة القادمة.',
    'مكان خاص لسيارتك.',
    'أضف النوع واللوحة واللون مرة واحدة.',
    'اللوحة اختيارية، وتساعد في تمييز السيارة.',
    'اللوحة غير مضافة',
    'احجز لهذه السيارة',
    'إضافة سيارة',
    'الحفظ محلي، وليس حسابًا سحابيًا.',
    'حذف السيارة المحفوظة؟',
    'من سياراتك. تفاصيل الحجوزات السابقة تبقى كما كانت.',
    'حذف السيارة',
    'رجوع',
    'أي سيارة نعتني بها؟',
    'اختر الحجم، وأضف اللوحة ليسهل التعرّف على السيارة. لا نطلب صورة وثيقة.',
    'سيارة جديدة',
    'حجم السيارة',
    'معاينة لوحة · ليست وثيقة',
    'اختياري في النموذج',
    'أدخل الأرقام والحروف كما تظهر. تجنّب استخدام بيانات حساسة في التجربة.',
    'اسم أو موديل السيارة',
    'مثال: كامري',
    'مثال: أبيض',
    'احفظ السيارة ولوحتها على هذا الجهاز للحجز القادم.',
    'سيُحفظ التعديل على هذا الجهاز. الحجوزات السابقة لا تتغيّر.',
    'استخدام هذه السيارة',
    'حفظ السيارة',
    'سيارات محفوظة',
    'أخرى',
    EDITOR_PLATE_MESSAGE,
    VEHICLE_SAVED_NOTICE,
    VEHICLE_DELETED_NOTICE,
    VEHICLE_CHOSEN_NOTICE,
    DRAFT_VEHICLE_UPDATED_NOTICE,
    GARAGE_FULL_NOTICE,
  ]) {
    assert.ok(reference.includes(copy), `not in the approved reference: ${copy}`);
    assert.ok(c005Source.includes(copy), `missing from C005 sources: ${copy}`);
  }
});

test('C005 stays in memory: no storage, network, clock, randomness', () => {
  assert.doesNotMatch(
    c005Source,
    /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|axios|WebSocket|sendBeacon|Math\.random|Date\.now|new Date\(|crypto\./,
  );
});

test('C005 names and plates are rendered as text; controls are semantic', () => {
  const components = readAll(
    [...garageFiles, ...widgetFiles].filter((file) => file.endsWith('.tsx')),
  );
  assert.doesNotMatch(components, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(components, /<(?:div|span|section|p|article|label)\b[^>]*\bonClick=/);
  assert.doesNotMatch(components, /role="button"/);
  // Plate rules live in the state module; components never test the value themselves.
  assert.doesNotMatch(components, /\.test\(|RegExp|isPlateAcceptable|normalizePlateInput/);
});

test('C005 garage and widget stay inside their boundaries', () => {
  for (const file of garageFiles.filter((name) => /\.tsx?$/.test(name))) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
      assert.doesNotMatch(specifier, /\/app\//, `${file} imports the app layer`);
      assert.doesNotMatch(specifier, /features\/(?!garage)/, `${file} imports another feature`);
    }
  }
  // The shared editor must not depend on any feature or on the app layer.
  for (const file of widgetFiles.filter((name) => /\.tsx?$/.test(name))) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
      assert.doesNotMatch(specifier, /\/(?:app|features)\//, `${file} -> ${specifier}`);
    }
  }
});
