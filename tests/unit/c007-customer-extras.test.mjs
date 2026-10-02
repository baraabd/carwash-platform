import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { blankBookingDraft } from '../../apps/customer-web/src/state/bookingDraft.ts';
import {
  repeatOrder,
  resumeBooking,
  startBooking,
} from '../../apps/customer-web/src/state/bookingEntry.ts';
import {
  returnToVehicleStep,
  selectCarePackage,
  submitCareStep,
} from '../../apps/customer-web/src/state/careStep.ts';
import {
  EXTRAS_UPDATED_NOTICE,
  confirmExtras,
  setExtraSelected,
} from '../../apps/customer-web/src/state/extrasStep.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';
import {
  careExtraIds,
  carePackageIds,
  extraFixtures,
  illustrativeCost,
  packageFixtures,
  vehicleTypeIds,
} from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import { careScenarioState } from '../../apps/customer-web/src/fixtures/customerCareScenarios.ts';
import { garageScenarioState } from '../../apps/customer-web/src/fixtures/customerGarageScenarios.ts';
import { homeScenarioState } from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import { buildCareStepViewModel } from '../../apps/customer-web/src/features/booking/care/careViewModel.ts';
import {
  INCLUDED_IN_PACKAGE_LABEL,
  buildExtrasViewModel,
} from '../../apps/customer-web/src/features/booking/care/extrasViewModel.ts';
import { buildPriceBreakdown } from '../../apps/customer-web/src/features/booking/priceBreakdown.ts';
import { bookingFlow } from '../../apps/customer-web/src/features/booking/bookingFlow.ts';
import { buildHomeViewModel } from '../../apps/customer-web/src/features/home/homeViewModel.ts';

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
const careFiles = sourceFiles(path.join(APP_SRC, 'features/booking/care'));
const c007Files = [
  path.join(APP_SRC, 'features/booking/care/components/ExtrasSheet.tsx'),
  path.join(APP_SRC, 'features/booking/care/extrasViewModel.ts'),
  path.join(APP_SRC, 'state/extrasStep.ts'),
];
const c007Source = readAll(c007Files);

const empty = () => homeScenarioState('home-empty');
const withDraft = (changes) => ({ ...empty(), draft: { ...blankBookingDraft(), ...changes } });
const includes = (state) => packageFixtures[state.draft.service].includes;
const tick = (state, extra, selected = true) =>
  setExtraSelected(state, extra, selected, includes(state));

test('C007 catalog: three add-ons in the approved order with the approved data', () => {
  assert.deepEqual(careExtraIds, ['seats', 'wheels', 'fresh']);
  assert.deepEqual(Object.keys(extraFixtures), ['seats', 'wheels', 'fresh']);
  assert.deepEqual(
    careExtraIds.map((id) => {
      const extra = extraFixtures[id];
      return [id, extra.name, extra.hint, extra.price, extra.minutes, extra.icon];
    }),
    [
      ['seats', 'تنظيف المقاعد', 'عناية إضافية بالقماش', 350, 20, 'seat'],
      ['wheels', 'تلميع الإطارات', 'لمسة أخيرة أجمل', 150, 10, 'wheel'],
      ['fresh', 'تعطير المقصورة', 'رائحة خفيفة ومنعشة', 100, 5, 'leaf'],
    ],
  );
});

test('C007 catalog matches the EXTRAS constant of the approved reference literally', () => {
  const literal = `const EXTRAS=Object.freeze({${careExtraIds
    .map((id) => {
      const x = extraFixtures[id];
      return `${id}:{name:'${x.name}',hint:'${x.hint}',price:${x.price},minutes:${x.minutes},icon:'${x.icon}'}`;
    })
    .join(',')}});`;
  assert.ok(reference.includes(literal), 'EXTRAS differs from the reference');
  // The only package that includes an add-on is premium, and it includes wheels.
  assert.deepEqual(
    carePackageIds.map((id) => [id, packageFixtures[id].includes]),
    [
      ['exterior', []],
      ['complete', []],
      ['premium', ['wheels']],
    ],
  );
  assert.ok(reference.includes("includes:['wheels']"));
});

test('C007 there is one add-on catalog and one pricing calculation', () => {
  const others = readAll(
    sourceFiles(APP_SRC).filter((file) => !file.endsWith('customerCatalogFixture.ts')),
  );
  assert.doesNotMatch(others, /price:\s*(?:350|150|100)\b/, 'no second add-on price table');
  assert.doesNotMatch(c007Source, /\.reduce\(|\.price\s*[+*-]|\+\s*\w+\.price/, 'no sums here');
  const components = readAll(careFiles.filter((file) => file.endsWith('.tsx')));
  assert.doesNotMatch(components, /illustrativeCost|\.reduce\(|\.fee\b/);
});

test('C007 nothing is ticked for a new draft', () => {
  const view = buildExtrasViewModel(blankBookingDraft());
  assert.deepEqual(
    view.options.map((o) => [o.id, o.included, o.checked, o.priceLabel]),
    [
      ['seats', false, false, '+350'],
      ['wheels', false, false, '+150'],
      ['fresh', false, false, '+100'],
    ],
  );
  assert.equal(view.total, 500);
});

test('C007 ticking and unticking an add-on edits only the draft', () => {
  const state = garageScenarioState('garage-vehicle-chosen');
  const ticked = tick(state, 'seats');
  assert.deepEqual(ticked.draft.extras, ['seats']);
  assert.equal(ticked.draft.touched, true);
  for (const key of [
    'service',
    'vehicleType',
    'carId',
    'carName',
    'plate',
    'address',
    'slot',
    'paymentMethod',
  ]) {
    assert.deepEqual(ticked.draft[key], state.draft[key], `${key} is kept`);
  }
  assert.equal(ticked.orders, state.orders, 'no order was created');
  assert.equal(ticked.vehicles, state.vehicles, 'the garage is untouched');
  assert.equal(ticked.draftStep, state.draftStep);
  assert.equal(ticked.notice, state.notice, 'ticking raises no notice');
  assert.deepEqual(state.draft.extras, [], 'the previous state is not mutated');

  const unticked = tick(ticked, 'seats', false);
  assert.deepEqual(unticked.draft.extras, []);
  assert.equal(unticked.orders, state.orders);
});

test('C007 several add-ons keep the order they were ticked in', () => {
  let state = empty();
  for (const id of ['fresh', 'seats', 'wheels']) state = tick(state, id);
  assert.deepEqual(state.draft.extras, ['fresh', 'seats', 'wheels']);
  assert.equal(illustrativeCost(state.draft).total, 500 + 100 + 350 + 150);
  assert.equal(illustrativeCost(state.draft).minutes, 35 + 5 + 20 + 10);
  state = tick(state, 'seats', false);
  assert.deepEqual(state.draft.extras, ['fresh', 'wheels']);
  // The sheet always lists them in catalog order, whatever the tick order.
  assert.deepEqual(
    buildExtrasViewModel(state.draft).options.map((o) => [o.id, o.checked]),
    [
      ['seats', false],
      ['wheels', true],
      ['fresh', true],
    ],
  );
});

test('C007 a duplicate add-on id is never stored twice and never charged twice', () => {
  const once = tick(empty(), 'seats');
  const twice = tick(once, 'seats');
  assert.deepEqual(twice.draft.extras, ['seats'], 'ticking again does not duplicate');

  // A draft that somehow carries duplicates is still priced once per add-on …
  const dirty = withDraft({ extras: ['seats', 'seats', 'fresh', 'seats'] });
  assert.deepEqual(illustrativeCost(dirty.draft).extraIds, ['seats', 'fresh']);
  assert.equal(illustrativeCost(dirty.draft).total, 500 + 350 + 100);
  assert.equal(illustrativeCost(dirty.draft).minutes, 35 + 20 + 5);
  assert.equal(
    buildPriceBreakdown(dirty.draft).lines.filter((line) => line.label === 'تنظيف المقاعد').length,
    1,
    'one bill line per add-on',
  );
  // … and unticking removes every occurrence.
  assert.deepEqual(tick(dirty, 'seats', false).draft.extras, ['fresh']);
});

test('C007 an add-on the package includes is shown ticked, disabled and never charged', () => {
  const draft = { ...blankBookingDraft(), service: 'premium' };
  const view = buildExtrasViewModel(draft);
  assert.deepEqual(
    view.options.map((o) => [o.id, o.included, o.checked, o.priceLabel]),
    [
      ['seats', false, false, '+350'],
      ['wheels', true, true, INCLUDED_IN_PACKAGE_LABEL],
      ['fresh', false, false, '+100'],
    ],
  );
  assert.equal(INCLUDED_IN_PACKAGE_LABEL, 'ضمن الباقة');
  assert.equal(view.total, 1500, 'the included add-on adds nothing');
  assert.equal(illustrativeCost(draft).minutes, 95, 'and no extra minutes');
  assert.deepEqual(
    buildPriceBreakdown(draft).lines.map((line) => line.label),
    ['عناية استثنائية', 'حجم السيارة · سيدان', 'الوصول إلى الموقع'],
  );
});

test('C007 an included add-on cannot be toggled', () => {
  const state = withDraft({ service: 'premium', extras: ['seats'] });
  assert.equal(tick(state, 'wheels'), state, 'ticking an included add-on is a no-op');
  assert.equal(tick(state, 'wheels', false), state, 'so is unticking it');
  assert.deepEqual(tick(state, 'fresh').draft.extras, ['seats', 'fresh'], 'others still toggle');
});

test('C007 pricing excludes an included add-on even when the draft still lists it', () => {
  // The UI never produces this draft, but the calculation must not trust the UI.
  const inconsistent = {
    ...blankBookingDraft(),
    service: 'premium',
    extras: ['wheels', 'wheels', 'seats'],
  };
  const cost = illustrativeCost(inconsistent);
  assert.deepEqual(cost.extraIds, ['seats']);
  assert.equal(cost.extras, 350);
  assert.equal(cost.total, 1500 + 350);
  assert.equal(cost.minutes, 95 + 20);
  assert.deepEqual(
    buildPriceBreakdown(inconsistent).lines.map((line) => [line.label, line.value]),
    [
      ['عناية استثنائية', '1,500 ل.س'],
      ['حجم السيارة · سيدان', 'ضمن السعر'],
      ['تنظيف المقاعد', '+350 ل.س'],
      ['الوصول إلى الموقع', 'ضمن سعر التجربة'],
    ],
  );
  const view = buildExtrasViewModel(inconsistent);
  assert.equal(view.options.find((o) => o.id === 'wheels').priceLabel, 'ضمن الباقة');
});

test('C007 switching to a package that includes a chosen add-on removes it from the draft', () => {
  const state = tick(tick(withDraft({ service: 'complete' }), 'wheels'), 'fresh');
  assert.equal(illustrativeCost(state.draft).total, 900 + 150 + 100);

  const premium = selectCarePackage(state, 'premium', packageFixtures.premium.includes);
  assert.deepEqual(premium.draft.extras, ['fresh'], 'wheels left the draft');
  assert.equal(illustrativeCost(premium.draft).total, 1500 + 100);
  const sheet = buildExtrasViewModel(premium.draft);
  assert.deepEqual(
    sheet.options.map((o) => [o.id, o.included, o.checked]),
    [
      ['seats', false, false],
      ['wheels', true, true],
      ['fresh', false, true],
    ],
  );
});

test('C007 switching back does not restore the removed add-on; it can be ticked again', () => {
  const state = tick(withDraft({ service: 'complete' }), 'wheels');
  const premium = selectCarePackage(state, 'premium', packageFixtures.premium.includes);
  const back = selectCarePackage(premium, 'complete', packageFixtures.complete.includes);
  assert.deepEqual(back.draft.extras, [], 'not silently re-added');
  assert.equal(illustrativeCost(back.draft).total, 900);
  assert.equal(
    buildExtrasViewModel(back.draft).options.find((o) => o.id === 'wheels').checked,
    false,
  );
  const again = tick(back, 'wheels');
  assert.deepEqual(again.draft.extras, ['wheels']);
  assert.equal(illustrativeCost(again.draft).total, 1050);
});

test('C007 totals and durations for every package, size and add-on combination', () => {
  const subsets = [
    [],
    ['seats'],
    ['wheels'],
    ['fresh'],
    ['seats', 'wheels'],
    ['seats', 'wheels', 'fresh'],
  ];
  for (const service of carePackageIds) {
    for (const vehicleType of vehicleTypeIds) {
      for (const extras of subsets) {
        const draft = { ...blankBookingDraft(), service, vehicleType, extras };
        const payable = extras.filter((id) => !packageFixtures[service].includes.includes(id));
        const cost = illustrativeCost(draft);
        const expectedExtras = payable.reduce((sum, id) => sum + extraFixtures[id].price, 0);
        assert.equal(cost.extras, expectedExtras, `${service}/${vehicleType}/${extras}`);
        assert.equal(cost.total, cost.base + cost.vehicle + expectedExtras);
        assert.ok(Number.isInteger(cost.total) && Number.isInteger(cost.minutes));
        // The sheet total, the footer total and the bill total are the same number.
        assert.equal(buildExtrasViewModel(draft).total, cost.total);
        assert.equal(buildPriceBreakdown(draft).total, cost.total);
        assert.equal(buildCareStepViewModel({ ...empty(), draft }).footerTotal, cost.total);
        assert.equal(buildCareStepViewModel({ ...empty(), draft }).footerMinutes, cost.minutes);
        assert.deepEqual(illustrativeCost(draft), cost, 'deterministic');
      }
    }
  }
});

test('C007 price breakdown gains and loses lines with the add-ons, without duplicates', () => {
  let state = withDraft({ vehicleType: 'suv' });
  const lines = () =>
    buildPriceBreakdown(state.draft).lines.map((line) => [line.label, line.value]);
  assert.deepEqual(lines(), [
    ['لمعة سريعة', '500 ل.س'],
    ['حجم السيارة · كروس أوفر', '+200 ل.س'],
    ['الوصول إلى الموقع', 'ضمن سعر التجربة'],
  ]);
  state = tick(tick(state, 'seats'), 'fresh');
  assert.deepEqual(lines(), [
    ['لمعة سريعة', '500 ل.س'],
    ['حجم السيارة · كروس أوفر', '+200 ل.س'],
    ['تنظيف المقاعد', '+350 ل.س'],
    ['تعطير المقصورة', '+100 ل.س'],
    ['الوصول إلى الموقع', 'ضمن سعر التجربة'],
  ]);
  assert.equal(buildPriceBreakdown(state.draft).total, 1150);
  state = tick(state, 'seats', false);
  assert.deepEqual(
    lines().map((line) => line[0]),
    ['لمعة سريعة', 'حجم السيارة · كروس أوفر', 'تعطير المقصورة', 'الوصول إلى الموقع'],
  );
  assert.equal(buildPriceBreakdown(state.draft).total, 800);
});

test('C007 the care row summarises the chosen add-ons and their amount', () => {
  let state = empty();
  assert.equal(
    buildCareStepViewModel(state).extrasSummary,
    'المقاعد، الإطارات أو التعطير · اختياري',
  );
  assert.equal(buildCareStepViewModel(state).extrasAmount, '');
  state = tick(tick(state, 'wheels'), 'seats');
  assert.equal(buildCareStepViewModel(state).extrasSummary, 'تلميع الإطارات، تنظيف المقاعد');
  assert.equal(buildCareStepViewModel(state).extrasAmount, '+500 ل.س');
});

test('C007 saving the choices only confirms them; it changes no draft data', () => {
  const state = tick(empty(), 'fresh');
  const confirmed = confirmExtras(state);
  assert.equal(confirmed.draft, state.draft, 'the draft is the same object');
  assert.equal(confirmed.orders, state.orders);
  assert.deepEqual(confirmed.notice, { message: EXTRAS_UPDATED_NOTICE, sequence: 1 });
  assert.equal(confirmExtras(confirmed).notice.sequence, 2, 'a repeated notice is re-raised');
});

test('C007 add-ons are a sheet of the care step: no route was added or renumbered', () => {
  assert.deepEqual(
    bookingFlow.map((step) => step.id),
    ['vehicle', 'care', 'location', 'time', 'contact', 'payment', 'review'],
  );
  const routes = readFileSync(path.join(APP_SRC, 'app/routes.ts'), 'utf8');
  assert.doesNotMatch(routes, /extras|addon/i);
  // The reference opens it with showSheet from the care view, not from FLOW.
  assert.ok(
    reference.includes(
      "function extrasSheet(){const d=S.draft;showSheet('لمسات إضافية، على ذوقك.'",
    ),
  );
  assert.doesNotMatch(
    reference.slice(reference.indexOf('const FLOW='), reference.indexOf('const STEPS=')),
    /إضاف/,
  );
});

test('C007 Next and Back of the care step are unchanged and carry the add-ons', () => {
  const state = tick(tick(empty(), 'seats'), 'fresh');
  const next = submitCareStep(state);
  assert.deepEqual(next.intent, { kind: 'booking-step', step: 2 });
  assert.equal(pathForIntent(next.intent), '/book/2');
  assert.deepEqual(next.state.draft.extras, ['seats', 'fresh']);
  assert.equal(next.state.orders, state.orders);
  const back = returnToVehicleStep(state);
  assert.equal(back.state, state);
  assert.deepEqual(back.intent, { kind: 'booking-step', step: 0 });
});

test('C007 resume keeps the add-ons and Home shows a total that includes them', () => {
  const advanced = submitCareStep(tick(startBooking(empty(), 'complete').state, 'seats')).state;
  assert.deepEqual(resumeBooking(advanced).intent, { kind: 'booking-step', step: 2 });
  assert.deepEqual(resumeBooking(advanced).state.draft.extras, ['seats']);
  assert.deepEqual(buildHomeViewModel(advanced).savedDraft, {
    packageName: 'نظافة متكاملة',
    total: 900 + 350,
  });
  // The returning-customer fixture already carries an add-on.
  const returning = homeScenarioState('home-returning-customer');
  assert.deepEqual(returning.draft.extras, ['seats']);
  assert.equal(buildExtrasViewModel(returning.draft).total, 1500 + 200 + 350);
});

test('C007 a repeat-derived draft copies the order add-ons into its own array', () => {
  const base = homeScenarioState('home-repeat-order');
  const order = { ...base.orders[0], service: 'premium', extras: ['wheels', 'seats'] };
  const state = { ...base, orders: [order] };
  const { state: repeated, intent } = repeatOrder(state, order.id);
  assert.deepEqual(repeated.draft.extras, ['wheels', 'seats']);
  assert.notEqual(repeated.draft.extras, order.extras, 'the draft owns its array');
  assert.deepEqual(intent, { kind: 'booking-step', step: 6 });
  // The copied, package-included add-on is not charged; the order itself is untouched.
  assert.equal(illustrativeCost(repeated.draft).total, 1500 + 350);
  const edited = tick(repeated, 'fresh');
  assert.deepEqual(edited.orders[0].extras, ['wheels', 'seats']);
  assert.equal(edited.orders, state.orders, 'editing add-ons never alters a past order');
});

test('C007 Home package entry and C006 pricing are unchanged', () => {
  for (const id of carePackageIds) {
    const { state, intent } = startBooking(empty(), id);
    assert.deepEqual(intent, { kind: 'booking-step', step: 0 });
    assert.deepEqual(state.draft.extras, [], 'entering from Home preselects no add-on');
  }
  assert.deepEqual(
    carePackageIds.map((id) => packageFixtures[id].price),
    [500, 900, 1500],
  );
  assert.deepEqual(illustrativeCost(careScenarioState('booking-care-with-extras').draft), {
    base: 900,
    vehicle: 350,
    extraIds: ['wheels', 'fresh'],
    extras: 250,
    total: 1500,
    minutes: 95,
  });
});

test('C007 scenario ids stay allowlisted; add-ons add no URL-controlled input', () => {
  for (const bad of ['__proto__', 'constructor', 'toString', '<x>', 'extras', 'seats']) {
    assert.deepEqual(initialSessionState(`#/book/1?scenario=${bad}`), empty(), bad);
  }
  assert.deepEqual(
    initialSessionState('#/book/1?scenario=booking-care-with-extras'),
    careScenarioState('booking-care-with-extras'),
  );
  assert.doesNotMatch(c007Source, /location\.|URLSearchParams|searchParams/);
});

test('C007 add-ons sheet carries the approved Arabic copy verbatim', () => {
  for (const copy of [
    'لمسات إضافية، على ذوقك.',
    'لا إضافات محددة مسبقًا. يمكنك المتابعة دون أي إضافة.',
    'ضمن الباقة',
    'الإجمالي مع اختياراتك',
    'حفظ الاختيارات',
    EXTRAS_UPDATED_NOTICE,
    'لمسة إضافية؟',
  ]) {
    assert.ok(reference.includes(copy), `not in the approved reference: ${copy}`);
    assert.ok(
      c007Source.includes(copy) || readAll(careFiles).includes(copy),
      `missing from C007 sources: ${copy}`,
    );
  }
});

test('C007 stays in memory: no storage, network, clock, randomness or payment call', () => {
  assert.doesNotMatch(
    c007Source,
    /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|axios|WebSocket|sendBeacon|Math\.random|Date\.now|new Date\(|crypto\./,
  );
});

test('C007 add-ons are native checkboxes; no misleading disabled state; boundaries hold', () => {
  const sheet = readFileSync(c007Files[0], 'utf8');
  assert.match(sheet, /type="checkbox"/);
  assert.match(sheet, /disabled=\{option\.included\}/, 'only an included add-on is disabled');
  assert.doesNotMatch(sheet, /dangerouslySetInnerHTML|role="checkbox"|role="button"/);
  assert.doesNotMatch(sheet, /<(?:div|span|section|p|label)\b[^>]*\bonClick=/);
  const care = readAll(careFiles.filter((file) => file.endsWith('.tsx')));
  assert.doesNotMatch(
    care,
    /aria-disabled|data-deferred-to/,
    'nothing on the care step is deferred',
  );
  for (const file of careFiles.filter((name) => /\.tsx?$/.test(name))) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
      assert.doesNotMatch(specifier, /\/app\//, `${file} imports the app layer`);
      assert.doesNotMatch(specifier, /features\/(?!booking)/, `${file} imports another feature`);
    }
  }
});
