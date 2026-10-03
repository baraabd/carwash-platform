import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PLATE_MAX_LENGTH,
  blankBookingDraft,
  isPlateAcceptable,
  normalizePlateInput,
  resolveBookingEntryStep,
} from '../../apps/customer-web/src/state/bookingDraft.ts';
import {
  repeatOrder,
  resumeBooking,
  startBooking,
} from '../../apps/customer-web/src/state/bookingEntry.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';
import {
  CARE_STEP,
  PLATE_INVALID_MESSAGE,
  VEHICLE_STEP,
  changePlate,
  leaveVehicleStep,
  saveDraftAndExit,
  selectVehicleType,
  setSaveVehicle,
  submitVehicleStep,
  visitBookingStep,
} from '../../apps/customer-web/src/state/vehicleStep.ts';
import {
  bookingScenarioIds,
  bookingScenarioState,
  isBookingScenarioId,
} from '../../apps/customer-web/src/fixtures/customerBookingScenarios.ts';
import {
  homeScenarioIds,
  homeScenarioState,
} from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import {
  illustrativeDraftMinutes,
  vehicleTypeIds,
} from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import { bookingFlow } from '../../apps/customer-web/src/features/booking/bookingFlow.ts';
import {
  buildVehicleStepViewModel,
  vehicleSelectionAnnouncement,
} from '../../apps/customer-web/src/features/booking/vehicle/vehicleViewModel.ts';

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
const bookingFiles = sourceFiles(path.join(APP_SRC, 'features/booking'));
const bookingSource = readAll(bookingFiles);
const c004Source = readAll([
  ...bookingFiles,
  path.join(APP_SRC, 'state/vehicleStep.ts'),
  path.join(APP_SRC, 'state/bookingDraft.ts'),
  path.join(APP_SRC, 'fixtures/customerBookingScenarios.ts'),
  path.join(APP_SRC, 'app/BookingExitNotice.tsx'),
]);

const empty = () => homeScenarioState('home-empty');

test('C004 default vehicle step: four sizes in the approved order, sedan selected', () => {
  const view = buildVehicleStepViewModel(empty());
  assert.deepEqual(vehicleTypeIds, ['sedan', 'suv', 'large', 'pickup']);
  assert.deepEqual(
    view.options.map((o) => [o.id, o.name, o.priceLabel, o.art, o.selected]),
    [
      ['sedan', 'سيدان', 'السعر الأساسي', 'sedan', true],
      ['suv', 'كروس أوفر', '+200 ل.س', 'suv', false],
      ['large', 'دفع رباعي', '+350 ل.س', 'suv', false],
      ['pickup', 'بيك أب', '+250 ل.س', 'pickup', false],
    ],
  );
  assert.equal(view.selectedType, 'sedan');
  assert.equal(view.stageName, 'سيدان');
  assert.equal(view.plate, '');
  assert.equal(view.detailsSummary, null);
  assert.equal(view.saveVehicle, true);
  assert.equal(view.footerTotal, 500);
  assert.equal(view.footerMinutes, 35);
});

test('C004 selecting a size edits only the draft and clears the old car details', () => {
  const state = bookingScenarioState('booking-vehicle-prefilled');
  const next = selectVehicleType(state, 'large', 'announcement');
  assert.equal(next.draft.vehicleType, 'large');
  assert.equal(next.draft.carName, '');
  assert.equal(next.draft.color, '');
  assert.equal(next.draft.plate, state.draft.plate, 'the plate is kept');
  assert.equal(next.draft.service, state.draft.service);
  assert.equal(next.draft.touched, true);
  assert.equal(next.orders, state.orders, 'orders are untouched');
  assert.equal(next.profile, state.profile);
  assert.equal(next.draftStep, state.draftStep);
  assert.deepEqual(next.announcement, { message: 'announcement', sequence: 1 });
  assert.equal(state.draft.vehicleType, 'pickup', 'the previous state is not mutated');

  const view = buildVehicleStepViewModel(next);
  assert.deepEqual(
    view.options.filter((o) => o.selected).map((o) => o.id),
    ['large'],
  );
  assert.equal(view.stageName, 'دفع رباعي');
  assert.equal(view.footerTotal, 900 + 350);
  assert.equal(view.footerMinutes, 60 + 20);
});

test('C004 size announcement states the size and the illustrative total', () => {
  assert.equal(vehicleSelectionAnnouncement(empty(), 'suv'), 'كروس أوفر، الإجمالي 700 ليرة سورية.');
  assert.equal(
    vehicleSelectionAnnouncement(homeScenarioState('home-returning-customer'), 'sedan'),
    'سيدان، الإجمالي 1850 ليرة سورية.',
  );
});

test('C004 plate normalisation: Latin digits and letters are kept as typed', () => {
  assert.equal(normalizePlateInput('1234 ABC'), '1234 ABC');
  assert.equal(normalizePlateInput('4821 ب ج'), '4821 ب ج');
  assert.equal(normalizePlateInput('12-34'), '12-34');
  assert.equal(normalizePlateInput(''), '');
});

test('C004 plate normalisation: Arabic-Indic digits become Latin digits', () => {
  assert.equal(normalizePlateInput('١٢٣٤ أ ب ج'), '1234 أ ب ج');
  assert.equal(normalizePlateInput('٠١٢٣٤٥٦٧٨٩'), '0123456789');
});

test('C004 plate normalisation: Eastern Arabic-Indic digits become Latin digits', () => {
  assert.equal(normalizePlateInput('۵۶۷۸ ب'), '5678 ب');
  assert.equal(normalizePlateInput('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(normalizePlateInput('١٢ ۳۴ 56'), '12 34 56', 'mixed digit systems');
});

test('C004 plate normalisation keeps whitespace and caps the length', () => {
  assert.equal(normalizePlateInput('  12  أ  '), '  12  أ  ', 'spaces are not trimmed');
  assert.equal(PLATE_MAX_LENGTH, 20);
  assert.equal(normalizePlateInput('1'.repeat(40)).length, 20);
  assert.equal(normalizePlateInput(`${'١'.repeat(25)}`), '1'.repeat(20));
});

test('C004 plate normalisation is deterministic and locale-independent', () => {
  const samples = ['١٢٣٤ أ ب ج', '۵۶۷۸', '1234 ABC', '  7 ', ''];
  for (const sample of samples) {
    const once = normalizePlateInput(sample);
    assert.equal(normalizePlateInput(sample), once);
    assert.equal(normalizePlateInput(once), once, 'idempotent');
  }
  assert.doesNotMatch(
    readFileSync(path.join(APP_SRC, 'state/bookingDraft.ts'), 'utf8'),
    /toLocale|Intl\.|navigator\.|localeCompare/,
  );
});

test('C004 plate validation mirrors the approved rule', () => {
  for (const valid of [
    '',
    '1234',
    '1234 ABC',
    '4821 ب ج',
    '12-34',
    'A1',
    '١٢٣٤ أ ب',
    '۵۶ ب',
    '7 ',
  ]) {
    assert.equal(isPlateAcceptable(valid), true, `should accept "${valid}"`);
  }
  for (const invalid of [
    'أ ب ج', // no digit
    'ABC', // no digit
    '1', // too short
    '   ', // spaces are not "left blank"
    ' ', // single space
    '12#4', // symbol
    '12_34', // underscore
    '<b>12</b>', // markup
    '1'.repeat(21), // too long
    '12‏34', // invisible direction mark
  ]) {
    assert.equal(isPlateAcceptable(invalid), false, `should refuse "${invalid}"`);
  }
});

test('C004 typing a plate stores the normalised value and marks the draft as started', () => {
  const state = empty();
  const next = changePlate(state, '١٢٣٤ أ ب ج');
  assert.equal(next.draft.plate, '1234 أ ب ج');
  assert.equal(next.draft.touched, true);
  assert.equal(next.orders, state.orders);
  assert.equal(buildVehicleStepViewModel(next).plate, '1234 أ ب ج');
  assert.equal(changePlate(next, '').draft.plate, '');
});

test('C004 Next validates on activation only and refuses an unacceptable plate', () => {
  const state = changePlate(empty(), 'أ ب ج');
  // Typing alone never produces an error state.
  assert.equal(state.announcement, null);

  const refused = submitVehicleStep(state);
  assert.equal(refused.intent, null);
  assert.equal(refused.plateError, PLATE_INVALID_MESSAGE);
  assert.equal(refused.state.draft, state.draft, 'the draft is unchanged');
  assert.equal(refused.state.draftStep, VEHICLE_STEP);
  assert.equal(refused.state.announcement.message, PLATE_INVALID_MESSAGE);
  // A second refusal re-announces the same message.
  assert.equal(submitVehicleStep(refused.state).state.announcement.sequence, 2);

  assert.equal(submitVehicleStep(changePlate(empty(), '   ')).plateError, PLATE_INVALID_MESSAGE);
  assert.equal(
    submitVehicleStep(bookingScenarioState('booking-vehicle-invalid-plate')).intent,
    null,
  );
});

test('C004 Next with an empty or valid plate goes to the care step and creates nothing', () => {
  for (const state of [empty(), bookingScenarioState('booking-vehicle-prefilled')]) {
    const ordersBefore = globalThis.structuredClone(state.orders);
    const result = submitVehicleStep(state);
    assert.equal(result.plateError, null);
    assert.deepEqual(result.intent, { kind: 'booking-step', step: CARE_STEP });
    assert.equal(pathForIntent(result.intent), '/book/1');
    assert.equal(result.state.draftStep, CARE_STEP);
    assert.equal(result.state.draft.touched, true);
    assert.equal(result.state.draft.plate, state.draft.plate);
    assert.equal(result.state.orders, state.orders, 'the order list is the same object');
    assert.deepEqual(result.state.orders, ordersBefore, 'no booking was created');
    assert.equal(result.state.bookingMode, state.bookingMode);
  }
});

test('C004 save preference, back and exit only touch the draft', () => {
  const state = empty();
  assert.equal(setSaveVehicle(state, false).draft.saveVehicle, false);
  assert.equal(setSaveVehicle(state, false).draft.touched, true);

  const back = leaveVehicleStep(state);
  assert.equal(back.state, state, 'header back changes nothing');
  assert.deepEqual(back.intent, { kind: 'home' });
  assert.equal(pathForIntent(back.intent), '/');

  const exit = saveDraftAndExit(state);
  assert.deepEqual(exit.intent, { kind: 'home' });
  assert.equal(exit.state.draft.touched, true, 'Home will offer to continue the draft');
  assert.equal(exit.state.orders, state.orders);
});

test('C004 visiting a step records it for resume without marking the draft', () => {
  const state = empty();
  assert.equal(visitBookingStep(state, 0), state, 'no change, same object');
  const moved = visitBookingStep(state, 3);
  assert.equal(moved.draftStep, 3);
  assert.equal(moved.draft, state.draft);
  assert.equal(moved.draft.touched, false);
});

test('C004 prefilled draft shows its car, plate, details and preference', () => {
  const view = buildVehicleStepViewModel(bookingScenarioState('booking-vehicle-prefilled'));
  assert.equal(view.selectedType, 'pickup');
  assert.equal(view.stageArt, 'pickup');
  assert.equal(view.stageName, 'هايلكس');
  assert.equal(view.plate, '4821 ب ج');
  assert.equal(view.detailsSummary, 'هايلكس أبيض');
  assert.equal(view.saveVehicle, false);
  assert.equal(view.footerTotal, 900 + 250);
  assert.equal(view.footerMinutes, 60 + 15);
});

test('C004 a repeat-derived draft is prefilled when it is routed through step 0', () => {
  const state = homeScenarioState('home-repeat-order');
  const { state: repeated } = repeatOrder(state, 'WG-DEMO-DONE', NOW);
  const view = buildVehicleStepViewModel(repeated);
  assert.equal(view.selectedType, 'sedan');
  assert.equal(view.stageName, 'سيارتي التجريبية');
  assert.equal(view.plate, '123456');
  assert.equal(view.saveVehicle, true);
  // Editing the car afterwards still creates nothing and keeps the order list.
  const edited = selectVehicleType(repeated, 'suv', 'a');
  assert.equal(edited.orders, state.orders);
  assert.equal(edited.bookingMode, 'repeat');
});

test('C004 keeps the C003 entry contracts unchanged', () => {
  // CTA and package cards → step 0.
  assert.deepEqual(startBooking(empty(), undefined, NOW).intent, { kind: 'booking-step', step: 0 });
  assert.deepEqual(startBooking(empty(), 'complete', NOW).intent, {
    kind: 'booking-step',
    step: 0,
  });
  assert.equal(startBooking(empty(), 'complete', NOW).state.draft.service, 'complete');
  // Saved draft → its resolved step.
  assert.deepEqual(resumeBooking(homeScenarioState('home-saved-draft'), NOW).intent, {
    kind: 'booking-step',
    step: 2,
  });
  // Repeat → review.
  assert.deepEqual(
    repeatOrder(homeScenarioState('home-repeat-order'), 'WG-DEMO-DONE', NOW).intent,
    {
      kind: 'booking-step',
      step: 6,
    },
  );
  // After the vehicle step, resume returns to the care step.
  const advanced = submitVehicleStep(startBooking(empty(), undefined, NOW).state).state;
  assert.deepEqual(resumeBooking(advanced, NOW).intent, { kind: 'booking-step', step: 1 });
  // An unacceptable stored plate still sends every later entry back to step 0.
  assert.equal(resolveBookingEntryStep({ ...blankBookingDraft(), plate: 'ب ج د' }, 6, NOW), 0);
  assert.equal(resolveBookingEntryStep({ ...blankBookingDraft(), plate: '   ' }, 6, NOW), 0);
  assert.deepEqual(homeScenarioIds.length, 5, 'Home scenarios are untouched');
});

test('C004 footer duration is illustrative and never double-counts an included extra', () => {
  assert.equal(
    illustrativeDraftMinutes({ service: 'premium', vehicleType: 'sedan', extras: ['wheels'] }),
    95,
  );
  assert.equal(
    illustrativeDraftMinutes({
      service: 'premium',
      vehicleType: 'suv',
      extras: ['seats', 'seats', 'fresh'],
    }),
    95 + 10 + 20 + 5,
  );
});

test('C004 booking scenarios are deterministic and allowlisted', () => {
  assert.deepEqual(bookingScenarioIds, [
    'booking-vehicle-prefilled',
    'booking-vehicle-invalid-plate',
  ]);
  for (const id of bookingScenarioIds) {
    assert.deepEqual(bookingScenarioState(id), bookingScenarioState(id));
    assert.notEqual(bookingScenarioState(id), bookingScenarioState(id), 'fresh object per call');
    assert.deepEqual(initialSessionState(`#/book/0?scenario=${id}`), bookingScenarioState(id));
    assert.deepEqual(bookingScenarioState(id).orders, [], 'no order exists in a booking scenario');
  }
  for (const bad of [null, undefined, '', '__proto__', 'constructor', 'home-empty', '<x>']) {
    assert.equal(isBookingScenarioId(bad), false, String(bad));
  }
  assert.deepEqual(initialSessionState('#/book/0?scenario=__proto__'), empty());
  assert.deepEqual(initialSessionState('#/book/0'), empty());
});

test('C004 booking flow matches the route table and the approved FLOW', () => {
  const routes = readFileSync(path.join(APP_SRC, 'app/routes.ts'), 'utf8');
  assert.equal(bookingFlow.length, 7);
  bookingFlow.forEach((step, index) => {
    assert.match(
      routes,
      new RegExp(
        `index: ${index}, id: '${step.id}', label: '${step.label}', path: '/book/${index}'`,
      ),
    );
    assert.ok(
      reference.includes(`{label:'${step.label}',icon:`) &&
        reference.includes(`next:'${step.nextLabel}'}`),
      `${step.label} / ${step.nextLabel} not in the approved FLOW`,
    );
  });
});

test('C004 vehicle step carries the approved Arabic copy verbatim', () => {
  for (const copy of [
    '01 / سيارتك أولًا',
    'أي سيارة ندلّل اليوم؟',
    'اختر الحجم. تفاصيلها نضيفها مرة واحدة.',
    'YOUR CAR / YOUR CARE',
    'الحجم يحدد وقت العناية وسعرها',
    'اختر حجم السيارة',
    'لوحة السيارة',
    'اختيارية في النموذج',
    'مثال: 1234 أ ب ج',
    'تساعد الفني على تمييز سيارتك. استخدم لوحة تجريبية.',
    'اسم السيارة ولونها',
    'تفاصيل اختيارية · لا حاجة لإعادتها لاحقًا',
    'احفظ السيارة على جهازي للحجز القادم.',
    'محفوظ لهذه الجلسة',
    'دقيقة تقديرية',
    'السعر الحالي',
    'تفاصيل السعر الحالي',
    'السعر الأساسي',
  ]) {
    assert.ok(reference.includes(copy), `not in the approved reference: ${copy}`);
    assert.ok(
      c004Source.includes(copy) ||
        readAll([path.join(APP_SRC, 'fixtures/customerCatalogFixture.ts')]).includes(copy) ||
        readAll([path.join(APP_SRC, 'features/booking/vehicle/vehicleViewModel.ts')]).includes(
          copy,
        ),
      `missing from C004 sources: ${copy}`,
    );
  }
  for (const copy of [
    PLATE_INVALID_MESSAGE,
    'نكمل الغسلة لاحقًا؟',
    'التخزين غير متاح. المسودة تبقى لهذه الجلسة فقط.',
    'حفظ والخروج',
    'متابعة الحجز',
    'الخطوة السابقة',
    'حفظ المسودة والخروج',
  ]) {
    assert.ok(reference.includes(copy), `not in the approved reference: ${copy}`);
  }
});

test('C004 stays in memory: no storage, network, clock, randomness or booking call', () => {
  assert.doesNotMatch(
    c004Source,
    /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|axios|WebSocket|sendBeacon|Math\.random|Date\.now|new Date\(/,
  );
});

test('C004 vehicle step uses semantic controls and keeps validation out of components', () => {
  assert.doesNotMatch(bookingSource, /<(?:div|span|section|p|label)\b[^>]*\bonClick=/);
  assert.doesNotMatch(bookingSource, /role="button"/);
  assert.match(bookingSource, /type="radio"/);
  assert.match(bookingSource, /role="radiogroup"/);
  assert.match(bookingSource, /role="alert"/);
  // Plate rules live in the state module only; components never test the value themselves.
  const components = readAll(bookingFiles.filter((file) => file.endsWith('.tsx')));
  assert.doesNotMatch(components, /\.test\(|RegExp|isPlateAcceptable|normalizePlateInput/);
});

test('C004 booking feature stays inside its boundary', () => {
  for (const file of bookingFiles.filter((name) => /\.tsx?$/.test(name))) {
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/from '([^']+)'/g)) {
      assert.doesNotMatch(specifier, /\/app\//, `${file} imports the app layer`);
      assert.doesNotMatch(
        specifier,
        /features\/(?!booking)/,
        `${file} imports another feature: ${specifier}`,
      );
    }
  }
});
