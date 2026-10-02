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
  CARE_STEP_INDEX,
  LOCATION_STEP_INDEX,
  VEHICLE_STEP_INDEX,
  returnToVehicleStep,
  selectCarePackage,
  submitCareStep,
} from '../../apps/customer-web/src/state/careStep.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';
import { chooseSavedVehicle } from '../../apps/customer-web/src/state/savedVehicles.ts';
import {
  selectVehicleType,
  submitVehicleStep,
} from '../../apps/customer-web/src/state/vehicleStep.ts';
import {
  carePackageIds,
  extraFixtures,
  homePackageIds,
  illustrativeCost,
  illustrativeDraftMinutes,
  illustrativeDraftTotal,
  packageFixtures,
  vehicleFixtures,
  vehicleTypeIds,
} from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import {
  careScenarioIds,
  careScenarioState,
  isCareScenarioId,
} from '../../apps/customer-web/src/fixtures/customerCareScenarios.ts';
import { garageScenarioState } from '../../apps/customer-web/src/fixtures/customerGarageScenarios.ts';
import { homeScenarioState } from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import { buildCareStepViewModel } from '../../apps/customer-web/src/features/booking/care/careViewModel.ts';
import { buildPriceBreakdown } from '../../apps/customer-web/src/features/booking/priceBreakdown.ts';
import { bookingFlow } from '../../apps/customer-web/src/features/booking/bookingFlow.ts';
import { buildHomeViewModel } from '../../apps/customer-web/src/features/home/homeViewModel.ts';
import { formatAmount } from '../../apps/customer-web/src/shared/formatAmount.ts';

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
const c006Files = [
  ...careFiles,
  path.join(APP_SRC, 'features/booking/priceBreakdown.ts'),
  path.join(APP_SRC, 'features/booking/BookingFooter.tsx'),
  path.join(APP_SRC, 'features/home/components/HomePackages.tsx'),
  path.join(APP_SRC, 'state/careStep.ts'),
  path.join(APP_SRC, 'fixtures/customerCareScenarios.ts'),
  path.join(APP_SRC, 'fixtures/customerCatalogFixture.ts'),
];
const c006Source = readAll(c006Files);

const empty = () => homeScenarioState('home-empty');
const draft = (changes = {}) => ({ ...blankBookingDraft(), ...changes });

test('C006 catalog: three packages in the approved order with the approved data', () => {
  assert.deepEqual(carePackageIds, ['exterior', 'complete', 'premium']);
  assert.deepEqual(Object.keys(packageFixtures), ['exterior', 'complete', 'premium']);
  assert.deepEqual(
    carePackageIds.map((id) => {
      const p = packageFixtures[id];
      return [id, p.name, p.short, p.price, p.minutes, p.icon, p.kicker, p.features, p.includes];
    }),
    [
      [
        'exterior',
        'لمعة سريعة',
        'غسيل خارجي',
        500,
        35,
        'drop',
        'EVERYDAY CLEAN',
        ['غسيل الهيكل', 'تنظيف الزجاج', 'تجفيف يدوي'],
        [],
      ],
      [
        'complete',
        'نظافة متكاملة',
        'داخلي + خارجي',
        900,
        60,
        'spark',
        'INSIDE & OUT',
        ['غسيل خارجي', 'شفط الأتربة', 'تنظيف المقصورة'],
        [],
      ],
      [
        'premium',
        'عناية استثنائية',
        'عناية بالتفاصيل',
        1500,
        95,
        'shield',
        'SIGNATURE CARE',
        ['تنظيف متكامل', 'عناية بالتفاصيل', 'تلميع الإطارات'],
        ['wheels'],
      ],
    ],
  );
});

test('C006 catalog matches the PACKAGES, V and EXTRAS constants of the approved reference', () => {
  for (const id of carePackageIds) {
    const p = packageFixtures[id];
    const literal = `${id}:{name:'${p.name}',short:'${p.short}',price:${p.price},minutes:${p.minutes},icon:'${p.icon}',features:[${p.features.map((f) => `'${f}'`).join(',')}],includes:[${p.includes.map((e) => `'${e}'`).join(',')}]}`;
    assert.ok(reference.includes(literal), `package ${id} differs from the reference`);
    assert.ok(reference.includes(`'${p.kicker}'`), `kicker ${p.kicker}`);
  }
  for (const id of vehicleTypeIds) {
    const v = vehicleFixtures[id];
    const literal = `${id}:{name:'${v.name}',fee:${v.fee},minutes:${v.minutes},art:'${v.art}'}`;
    assert.ok(reference.includes(literal), `vehicle ${id} differs from the reference`);
  }
  for (const [id, extra] of Object.entries(extraFixtures)) {
    assert.ok(
      new RegExp(
        `${id}:\\{name:'${extra.name}',hint:'[^']+',price:${extra.price},minutes:${extra.minutes},`,
      ).test(reference),
      `extra ${id} differs from the reference`,
    );
  }
});

test('C006 there is one package representation: Home and the care step read the same data', () => {
  const home = buildHomeViewModel(empty());
  const care = buildCareStepViewModel(empty());
  for (const card of home.packages) {
    const option = care.options.find((item) => item.id === card.id);
    assert.equal(card.name, option.name);
    assert.equal(card.price, option.amount, 'same price for the smallest size');
  }
  assert.deepEqual(homePackageIds, ['exterior', 'complete']);
  // No second price table anywhere in the customer app.
  const allSources = readAll(
    sourceFiles(APP_SRC).filter((file) => !file.endsWith('customerCatalogFixture.ts')),
  );
  assert.doesNotMatch(allSources, /price:\s*(?:500|900|1500)\b/);
});

test('C006 default care step: exterior selected, prices for the smallest size', () => {
  const view = buildCareStepViewModel(empty());
  assert.equal(view.selectedPackage, 'exterior');
  assert.equal(view.carLabel, 'سيدان');
  assert.deepEqual(
    view.options.map((o) => [o.id, o.selected, o.amount, o.durationLine]),
    [
      ['exterior', true, 500, '35 دقيقة · غسيل خارجي'],
      ['complete', false, 900, '60 دقيقة · داخلي + خارجي'],
      ['premium', false, 1500, '95 دقيقة · عناية بالتفاصيل'],
    ],
  );
  assert.equal(view.extrasSummary, 'المقاعد، الإطارات أو التعطير · اختياري');
  assert.equal(view.extrasAmount, '');
  assert.equal(view.footerTotal, 500);
  assert.equal(view.footerMinutes, 35);
});

test('C006 prices and durations depend on the vehicle size', () => {
  const expected = {
    sedan: [500, 900, 1500, 35],
    suv: [700, 1100, 1700, 45],
    large: [850, 1250, 1850, 55],
    pickup: [750, 1150, 1750, 50],
  };
  for (const type of vehicleTypeIds) {
    const view = buildCareStepViewModel({ ...empty(), draft: draft({ vehicleType: type }) });
    assert.deepEqual(
      [...view.options.map((option) => option.amount), view.footerMinutes],
      expected[type],
      type,
    );
  }
});

test('C006 pricing is one pure integer calculation', () => {
  assert.deepEqual(illustrativeCost(draft()), {
    base: 500,
    vehicle: 0,
    extraIds: [],
    extras: 0,
    total: 500,
    minutes: 35,
  });
  assert.deepEqual(
    illustrativeCost(
      draft({ vehicleType: 'large', service: 'complete', extras: ['wheels', 'fresh'] }),
    ),
    {
      base: 900,
      vehicle: 350,
      extraIds: ['wheels', 'fresh'],
      extras: 250,
      total: 1500,
      minutes: 95,
    },
  );
  // An extra the package includes is never charged; duplicates count once.
  assert.deepEqual(
    illustrativeCost(draft({ service: 'premium', extras: ['wheels', 'seats', 'seats'] })),
    { base: 1500, vehicle: 0, extraIds: ['seats'], extras: 350, total: 1850, minutes: 115 },
  );
  // Every combination is a whole number and the wrappers agree with the calculation.
  for (const service of carePackageIds) {
    for (const vehicleType of vehicleTypeIds) {
      for (const extras of [[], ['seats'], ['seats', 'wheels', 'fresh']]) {
        const input = { service, vehicleType, extras };
        const cost = illustrativeCost(input);
        assert.ok(Number.isInteger(cost.total) && Number.isInteger(cost.minutes));
        assert.equal(cost.total, cost.base + cost.vehicle + cost.extras);
        assert.equal(illustrativeDraftTotal(input), cost.total);
        assert.equal(illustrativeDraftMinutes(input), cost.minutes);
        assert.deepEqual(illustrativeCost(input), cost, 'deterministic');
      }
    }
  }
  const pricing = readFileSync(path.join(APP_SRC, 'fixtures/customerCatalogFixture.ts'), 'utf8');
  assert.doesNotMatch(pricing, /parseFloat|toFixed|Math\.round|\d\.\d/, 'no fractional arithmetic');
});

test('C006 arithmetic lives in the catalog module, not in components', () => {
  const components = readAll(
    [...careFiles, path.join(APP_SRC, 'features/booking/BookingFooter.tsx')].filter((file) =>
      file.endsWith('.tsx'),
    ),
  );
  assert.doesNotMatch(components, /\.price\b|\.fee\b|\.reduce\(|illustrativeCost/);
  const viewModels = readAll([
    path.join(APP_SRC, 'features/booking/priceBreakdown.ts'),
    path.join(APP_SRC, 'features/booking/care/careViewModel.ts'),
  ]);
  assert.doesNotMatch(viewModels, /\.reduce\(/, 'view models never sum extras themselves');
});

test('C006 amounts are formatted as the reference formats them', () => {
  assert.equal(formatAmount(500), '500');
  assert.equal(formatAmount(1500), '1,500');
  assert.equal(formatAmount(1850), '1,850');
});

test('C006 selecting a package changes only the draft and creates nothing', () => {
  const state = garageScenarioState('garage-vehicle-chosen');
  const next = selectCarePackage(state, 'complete', packageFixtures.complete.includes);
  assert.equal(next.draft.service, 'complete');
  assert.equal(next.draft.touched, true);
  for (const key of [
    'vehicleType',
    'carId',
    'carName',
    'plate',
    'color',
    'address',
    'slot',
    'paymentMethod',
  ]) {
    assert.deepEqual(next.draft[key], state.draft[key], `${key} is kept`);
  }
  assert.equal(next.orders, state.orders, 'no order was created');
  assert.equal(next.vehicles, state.vehicles, 'the garage is untouched');
  assert.equal(next.draftStep, state.draftStep);
  assert.equal(next.notice, state.notice);
  assert.equal(state.draft.service, 'exterior', 'the previous state is not mutated');
});

test('C006 changing package is deterministic and reversible', () => {
  let state = empty();
  for (const id of ['premium', 'complete', 'exterior', 'premium', 'exterior']) {
    state = selectCarePackage(state, id, packageFixtures[id].includes);
    const view = buildCareStepViewModel(state);
    assert.deepEqual(
      view.options.filter((option) => option.selected).map((option) => option.id),
      [id],
    );
    assert.equal(view.footerTotal, packageFixtures[id].price);
  }
  assert.deepEqual(state.draft, { ...blankBookingDraft(), touched: true });
});

test('C006 a package that includes an add-on drops it; other add-ons stay', () => {
  const state = careScenarioState('booking-care-with-extras');
  assert.deepEqual(state.draft.extras, ['wheels', 'fresh']);
  const premium = selectCarePackage(state, 'premium', packageFixtures.premium.includes);
  assert.deepEqual(premium.draft.extras, ['fresh']);
  assert.equal(illustrativeCost(premium.draft).total, 1500 + 350 + 100);
  // Going back does not silently re-add what was dropped.
  const back = selectCarePackage(premium, 'complete', packageFixtures.complete.includes);
  assert.deepEqual(back.draft.extras, ['fresh']);
});

// C006 shipped the add-ons row inactive (`data-deferred-to="C007"`) and asserted
// that here. C007 delivered the add-ons sheet, so the deferral assertions were
// retired with it; what C006 owns — showing and pricing the add-ons a draft
// already carries — is still checked.
test('C006 care step shows and prices the extras a draft already carries', () => {
  const view = buildCareStepViewModel(careScenarioState('booking-care-with-extras'));
  assert.equal(view.extrasSummary, 'تلميع الإطارات، تعطير المقصورة');
  assert.equal(view.extrasAmount, '+250 ل.س');
  assert.equal(view.footerTotal, 1500);
  assert.equal(view.footerMinutes, 60 + 20 + 10 + 5);
});

test('C006 price breakdown view model lists package, size, extras, visit and total', () => {
  assert.deepEqual(buildPriceBreakdown(draft()), {
    lines: [
      { label: 'لمعة سريعة', value: '500 ل.س' },
      { label: 'حجم السيارة · سيدان', value: 'ضمن السعر' },
      { label: 'الوصول إلى الموقع', value: 'ضمن سعر التجربة' },
    ],
    total: 500,
  });
  assert.deepEqual(
    buildPriceBreakdown(
      draft({ vehicleType: 'large', service: 'premium', extras: ['wheels', 'seats'] }),
    ),
    {
      lines: [
        { label: 'عناية استثنائية', value: '1,500 ل.س' },
        { label: 'حجم السيارة · دفع رباعي', value: '+350 ل.س' },
        { label: 'تنظيف المقاعد', value: '+350 ل.س' },
        { label: 'الوصول إلى الموقع', value: 'ضمن سعر التجربة' },
      ],
      total: 2200,
    },
  );
  // The total shown is the calculation's total, never a second sum.
  const input = draft({ vehicleType: 'pickup', service: 'complete', extras: ['fresh'] });
  assert.equal(buildPriceBreakdown(input).total, illustrativeCost(input).total);
});

test('C006 Home package details view model lists all three packages for the smallest size', () => {
  assert.deepEqual(buildHomeViewModel(empty()).packageDetails, [
    {
      id: 'exterior',
      name: 'لمعة سريعة',
      price: 500,
      featuresLine: 'غسيل الهيكل · تنظيف الزجاج · تجفيف يدوي',
      durationLine: '35 دقيقة تقديرية',
    },
    {
      id: 'complete',
      name: 'نظافة متكاملة',
      price: 900,
      featuresLine: 'غسيل خارجي · شفط الأتربة · تنظيف المقصورة',
      durationLine: '60 دقيقة تقديرية',
    },
    {
      id: 'premium',
      name: 'عناية استثنائية',
      price: 1500,
      featuresLine: 'تنظيف متكامل · عناية بالتفاصيل · تلميع الإطارات',
      durationLine: '95 دقيقة تقديرية',
    },
  ]);
  // Details are the same whatever the draft's vehicle is: the sheet says "for a sedan".
  const suv = { ...empty(), draft: draft({ vehicleType: 'suv' }) };
  assert.deepEqual(
    buildHomeViewModel(suv).packageDetails,
    buildHomeViewModel(empty()).packageDetails,
  );
});

test('C006 Home package entry is unchanged: preselect the package, enter at the vehicle step', () => {
  for (const id of carePackageIds) {
    const { state, intent } = startBooking(empty(), id);
    assert.deepEqual(intent, { kind: 'booking-step', step: VEHICLE_STEP_INDEX }, id);
    assert.equal(pathForIntent(intent), '/book/0');
    assert.equal(state.draft.service, id);
    assert.deepEqual(state.orders, [], 'entering from Home creates no order');
    // Passing through the vehicle step keeps the preselected package.
    const atCare = submitVehicleStep(state).state;
    assert.equal(buildCareStepViewModel(atCare).selectedPackage, id);
  }
  // The primary CTA keeps whatever the draft already has.
  assert.equal(startBooking(empty()).state.draft.service, 'exterior');
});

test('C006 works however the draft reached the care step', () => {
  // Saved garage vehicle.
  const saved = submitVehicleStep(
    chooseSavedVehicle(garageScenarioState('garage-three-vehicles'), 'CAR-1'),
  );
  assert.deepEqual(saved.intent, { kind: 'booking-step', step: CARE_STEP_INDEX });
  const savedView = buildCareStepViewModel(saved.state);
  assert.equal(savedView.carLabel, 'سيارة العائلة');
  assert.deepEqual(
    savedView.options.map((option) => option.amount),
    [700, 1100, 1700],
  );
  // Manually selected size.
  const manual = submitVehicleStep(selectVehicleType(empty(), 'pickup', 'a')).state;
  assert.equal(buildCareStepViewModel(manual).carLabel, 'بيك أب');
  // Repeat-derived draft.
  const repeated = repeatOrder(homeScenarioState('home-repeat-order'), 'WG-DEMO-DONE').state;
  const repeatedView = buildCareStepViewModel(repeated);
  assert.equal(repeatedView.selectedPackage, 'complete');
  assert.equal(repeatedView.carLabel, 'سيارتي التجريبية');
  // Returning customer resumes at the care step.
  const returning = homeScenarioState('home-returning-customer');
  assert.deepEqual(resumeBooking(returning).intent, { kind: 'booking-step', step: 1 });
  assert.equal(buildCareStepViewModel(returning).selectedPackage, 'premium');
});

test('C006 Next goes to the location step, Back to the vehicle step, nothing is created', () => {
  const state = selectCarePackage(empty(), 'complete', []);
  const next = submitCareStep(state);
  assert.deepEqual(next.intent, { kind: 'booking-step', step: LOCATION_STEP_INDEX });
  assert.equal(pathForIntent(next.intent), '/book/2');
  assert.equal(next.state.draftStep, 2);
  assert.equal(next.state.draft.service, 'complete');
  assert.equal(next.state.orders, state.orders);
  assert.deepEqual(resumeBooking(next.state).intent, { kind: 'booking-step', step: 2 });

  const back = returnToVehicleStep(state);
  assert.equal(back.state, state, 'going back changes nothing');
  assert.deepEqual(back.intent, { kind: 'booking-step', step: 0 });
  assert.equal(pathForIntent(back.intent), '/book/0');
  assert.deepEqual([VEHICLE_STEP_INDEX, CARE_STEP_INDEX, LOCATION_STEP_INDEX], [0, 1, 2]);
  assert.deepEqual(
    bookingFlow.slice(0, 3).map((step) => [step.id, step.nextLabel]),
    [
      ['vehicle', 'اختيار العناية'],
      ['care', 'تحديد المكان'],
      ['location', 'اختيار الموعد'],
    ],
  );
});

test('C006 care scenarios are deterministic and allowlisted', () => {
  assert.deepEqual(careScenarioIds, ['booking-care-with-extras']);
  for (const id of careScenarioIds) {
    assert.deepEqual(careScenarioState(id), careScenarioState(id));
    assert.notEqual(careScenarioState(id), careScenarioState(id), 'fresh object per call');
    assert.deepEqual(initialSessionState(`#/book/1?scenario=${id}`), careScenarioState(id));
    assert.deepEqual(careScenarioState(id).orders, []);
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
    assert.equal(isCareScenarioId(bad), false, String(bad));
  }
  assert.deepEqual(initialSessionState('#/book/1?scenario=__proto__'), empty());
});

test('C006 care step, bill and package details carry the approved Arabic copy verbatim', () => {
  for (const copy of [
    '02 / عناية على ذوقك',
    'كيف تحبّ لمعتها؟',
    'ثلاث باقات واضحة. اختر ما تحتاجه فقط.',
    'الأسعار تشمل حجم سيارتك',
    'تغيير',
    'باقة الغسيل',
    'لمسة إضافية؟',
    'المقاعد، الإطارات أو التعطير · اختياري',
    'السعر، بكل وضوح.',
    'السعر، بدون مفاجآت.',
    'حجم السيارة · ',
    'ضمن السعر',
    'الوصول إلى الموقع',
    'ضمن سعر التجربة',
    'الإجمالي',
    'أسعار توضيحية. لا تحصيل أو رسوم فعلية.',
    'متابعة الحجز',
    'لكل سيارة، عناية مناسبة.',
    'أرقام توضيحية للسيارة السيدان. يظهر فرق الحجم والإضافات قبل التأكيد.',
    'اختيار هذه الباقة',
    'دقيقة تقديرية',
  ]) {
    assert.ok(reference.includes(copy), `not in the approved reference: ${copy}`);
    const inSources =
      c006Source.includes(copy) ||
      readFileSync(path.join(APP_SRC, 'features/home/homeViewModel.ts'), 'utf8').includes(copy);
    assert.ok(inSources, `missing from C006 sources: ${copy}`);
  }
});

test('C006 stays in memory: no storage, network, clock, randomness or payment call', () => {
  assert.doesNotMatch(
    c006Source,
    /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|axios|WebSocket|sendBeacon|Math\.random|Date\.now|new Date\(|crypto\./,
  );
});

test('C006 controls are semantic and the booking feature keeps its boundary', () => {
  const components = readAll(careFiles.filter((file) => file.endsWith('.tsx')));
  assert.doesNotMatch(components, /<(?:div|span|section|p|label)\b[^>]*\bonClick=/);
  assert.doesNotMatch(components, /role="button"|dangerouslySetInnerHTML/);
  assert.match(components, /role="radiogroup"/);
  assert.match(components, /type="radio"/);
  for (const file of careFiles.filter((name) => /\.tsx?$/.test(name))) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
      assert.doesNotMatch(specifier, /\/app\//, `${file} imports the app layer`);
      assert.doesNotMatch(specifier, /features\/(?!booking)/, `${file} imports another feature`);
    }
  }
});
