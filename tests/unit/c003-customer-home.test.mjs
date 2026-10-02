import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BOOKING_REVIEW_STEP,
  blankBookingDraft,
  resolveBookingEntryStep,
} from '../../apps/customer-web/src/state/bookingDraft.ts';
import {
  repeatOrder,
  resumeBooking,
  startBooking,
  viewOrder,
} from '../../apps/customer-web/src/state/bookingEntry.ts';
import {
  REPEAT_BOOKING_NOTICE,
  inProgressOrderCount,
} from '../../apps/customer-web/src/state/customerSession.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';
import {
  DEFAULT_HOME_SCENARIO,
  homeScenarioIds,
  homeScenarioState,
  isHomeScenarioId,
} from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import { illustrativeDraftTotal } from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import { buildHomeViewModel } from '../../apps/customer-web/src/features/home/homeViewModel.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import {
  referenceArtDefs,
  referenceCarSymbols,
} from '../../apps/customer-web/src/shared/art/artMarkup.ts';

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

const homeSources = sourceFiles(path.join(APP_SRC, 'features/home'));
const readAll = (files) => files.map((file) => readFileSync(file, 'utf8')).join('\n');
const homeSource = readAll(homeSources);
const c003Source = readAll([
  ...homeSources,
  ...sourceFiles(path.join(APP_SRC, 'state')),
  ...sourceFiles(path.join(APP_SRC, 'shared')),
  path.join(APP_SRC, 'fixtures/customerHomeScenarios.ts'),
  path.join(APP_SRC, 'fixtures/customerCatalogFixture.ts'),
  path.join(APP_SRC, 'app/CityNotice.tsx'),
  path.join(APP_SRC, 'app/initialSession.ts'),
]);

test('C003 default Home shows no resume, follow-up or repeat entry', () => {
  const view = buildHomeViewModel(homeScenarioState('home-empty'));
  assert.equal(view.activeOrder, null);
  assert.equal(view.repeatableOrder, null);
  assert.equal(view.savedDraft, null);
  assert.equal(view.greetingName, null);
  assert.equal(view.heroCarArt, 'sedan');
  assert.equal(view.startingPrice, 500);
  assert.deepEqual(
    view.packages.map((item) => [item.id, item.name, item.summary, item.price, item.featured]),
    [
      ['exterior', 'لمعة سريعة', 'غسيل خارجي · 35 دقيقة', 500, false],
      ['complete', 'نظافة متكاملة', 'داخلي + خارجي · 60 دقيقة', 900, true],
    ],
  );
  assert.equal(inProgressOrderCount(homeScenarioState('home-empty')), 0);
});

test('C003 active order is offered for follow-up with its approved stage label', () => {
  const state = homeScenarioState('home-active-order');
  const view = buildHomeViewModel(state);
  assert.deepEqual(view.activeOrder, { id: 'WG-DEMO-RUNNING', statusLabel: 'في الطريق' });
  assert.equal(view.repeatableOrder, null);
  assert.equal(inProgressOrderCount(state), 1);

  const { intent, state: next } = viewOrder(state, 'WG-DEMO-RUNNING');
  assert.deepEqual(intent, { kind: 'order-tracking', orderId: 'WG-DEMO-RUNNING' });
  assert.equal(pathForIntent(intent), '/order/WG-DEMO-RUNNING');
  assert.equal(next, state, 'following an order changes nothing');
  assert.equal(viewOrder(state, 'WG-UNKNOWN').intent, null);
});

test('C003 only a completed order is repeatable; cancelled and running ones are not', () => {
  const base = homeScenarioState('home-repeat-order');
  const [completed] = base.orders;
  assert.deepEqual(buildHomeViewModel(base).repeatableOrder, {
    id: 'WG-DEMO-DONE',
    carLabel: 'سيارتي التجريبية',
    packageName: 'نظافة متكاملة',
  });
  for (const stage of [-1, 0, 1, 2, 3]) {
    const view = buildHomeViewModel({ ...base, orders: [{ ...completed, stage }] });
    assert.equal(view.repeatableOrder, null, `stage ${stage}`);
  }
  // Without a saved car name the vehicle type name is used, as in the reference.
  const unnamed = buildHomeViewModel({ ...base, orders: [{ ...completed, carName: '' }] });
  assert.equal(unnamed.repeatableOrder.carLabel, 'سيدان');
});

test('C003 repeat derives a draft only and never creates or submits a booking', () => {
  const state = homeScenarioState('home-repeat-order');
  const ordersBefore = globalThis.structuredClone(state.orders);
  const { state: next, intent } = repeatOrder(state, 'WG-DEMO-DONE');

  assert.equal(next.orders, state.orders, 'the order list is the same object');
  assert.deepEqual(next.orders, ordersBefore, 'no order was added, removed or changed');
  assert.equal(inProgressOrderCount(next), 0, 'nothing is in progress after a repeat');

  const [order] = state.orders;
  assert.equal(next.draft.touched, true);
  assert.equal(next.draft.service, order.service);
  assert.equal(next.draft.vehicleType, order.vehicleType);
  assert.equal(next.draft.plate, order.plate);
  assert.equal(next.draft.address, order.address);
  assert.equal(next.draft.paymentMethod, order.paymentMethod);
  assert.notEqual(next.draft.extras, order.extras, 'the draft owns its own extras array');

  assert.deepEqual(next.draft.slot, state.nextAvailableSlot, 'a new slot is offered');
  assert.notDeepEqual(next.draft.slot, order.slot, 'the finished slot is never reused');

  assert.equal(next.bookingMode, 'repeat');
  assert.equal(next.notice.message, REPEAT_BOOKING_NOTICE);
  // The customer lands on review and still has to confirm there themselves.
  assert.deepEqual(intent, { kind: 'booking-step', step: BOOKING_REVIEW_STEP });
  assert.equal(pathForIntent(intent), '/book/6');
});

test('C003 repeat without an offered slot stops at the time step instead of review', () => {
  const state = { ...homeScenarioState('home-repeat-order'), nextAvailableSlot: null };
  const { state: next, intent } = repeatOrder(state, 'WG-DEMO-DONE');
  assert.equal(next.draft.slot, null);
  assert.deepEqual(intent, { kind: 'booking-step', step: 3 });
});

test('C003 repeat of an unknown order is a no-op', () => {
  const state = homeScenarioState('home-repeat-order');
  const result = repeatOrder(state, 'WG-NOT-MINE');
  assert.equal(result.state, state);
  assert.equal(result.intent, null);
});

test('C003 resume returns to the saved step and never skips missing input', () => {
  const state = homeScenarioState('home-saved-draft');
  assert.deepEqual(buildHomeViewModel(state).savedDraft, {
    packageName: 'نظافة متكاملة',
    total: 900,
  });
  assert.deepEqual(resumeBooking(state).intent, { kind: 'booking-step', step: 2 });
  assert.equal(resumeBooking(state).state.orders, state.orders);

  // A draft left at review but missing an address is sent back to the place step.
  assert.deepEqual(resumeBooking({ ...state, draftStep: 6 }).intent, {
    kind: 'booking-step',
    step: 2,
  });
  // No draft, nothing to resume.
  assert.equal(resumeBooking(homeScenarioState('home-empty')).intent, null);
});

test('C003 booking entry guard mirrors the approved step requirements', () => {
  const complete = {
    ...blankBookingDraft(),
    plate: '123456',
    address: 'المزة، دمشق',
    slot: { date: '2026-09-21', time: '10:00' },
    contactName: 'سامر',
    contactPhone: '0900000000',
    paymentMethod: 'cash',
  };
  assert.equal(resolveBookingEntryStep(complete, 6), 6);
  assert.equal(resolveBookingEntryStep({ ...complete, plate: 'x' }, 6), 0);
  assert.equal(resolveBookingEntryStep({ ...complete, plate: '' }, 6), 6, 'plate is optional');
  assert.equal(resolveBookingEntryStep({ ...complete, address: 'ab' }, 6), 2);
  assert.equal(resolveBookingEntryStep({ ...complete, slot: null }, 6), 3);
  assert.equal(resolveBookingEntryStep({ ...complete, contactPhone: '12' }, 6), 4);
  assert.equal(resolveBookingEntryStep({ ...complete, contactName: 'س' }, 6), 4);
  assert.equal(resolveBookingEntryStep({ ...complete, paymentMethod: null }, 6), 5);
  // Out-of-range and non-numeric requests are clamped, never trusted.
  assert.equal(resolveBookingEntryStep(complete, 99), 6);
  assert.equal(resolveBookingEntryStep(complete, -4), 0);
  assert.equal(resolveBookingEntryStep(complete, Number.NaN), 0);
  assert.equal(resolveBookingEntryStep(complete, 2.9), 2);
});

test('C003 primary CTA starts a draft at step one without touching orders', () => {
  const state = homeScenarioState('home-returning-customer');
  const { state: next, intent } = startBooking(state, 'exterior');
  assert.deepEqual(intent, { kind: 'booking-step', step: 0 });
  assert.equal(next.draft.service, 'exterior');
  assert.equal(next.draft.touched, true);
  assert.equal(next.draft.contactName, 'سامر', 'contact is prefilled from the profile');
  assert.equal(next.bookingMode, 'standard');
  assert.equal(next.orders, state.orders);
  // Starting without a package keeps the draft's current choice.
  assert.equal(startBooking(state).state.draft.service, 'premium');
});

test('C003 returning-customer Home combines greeting, follow-up, repeat and resume', () => {
  const state = homeScenarioState('home-returning-customer');
  const view = buildHomeViewModel(state);
  assert.equal(view.greetingName, 'سامر');
  assert.equal(view.heroCarArt, 'suv');
  assert.equal(view.activeOrder.id, 'WG-DEMO-RUNNING');
  assert.equal(view.repeatableOrder.id, 'WG-DEMO-DONE');
  // premium 1500 + crossover 200 + seats 350; illustrative, not a quote.
  assert.deepEqual(view.savedDraft, { packageName: 'عناية استثنائية', total: 2050 });
  assert.equal(inProgressOrderCount(state), 1);
});

test('C003 illustrative total does not double-count an extra the package includes', () => {
  const draft = { service: 'premium', vehicleType: 'sedan', extras: ['wheels', 'wheels', 'fresh'] };
  assert.equal(illustrativeDraftTotal(draft), 1600);
});

test('C003 scenarios are deterministic and selected only by a known id', () => {
  assert.deepEqual(homeScenarioIds, [
    'home-empty',
    'home-active-order',
    'home-repeat-order',
    'home-saved-draft',
    'home-returning-customer',
  ]);
  assert.equal(DEFAULT_HOME_SCENARIO, 'home-empty');
  for (const id of homeScenarioIds) {
    assert.deepEqual(homeScenarioState(id), homeScenarioState(id), id);
    assert.notEqual(homeScenarioState(id), homeScenarioState(id), `${id}: fresh object per call`);
  }
  assert.equal(isHomeScenarioId('home-saved-draft'), true);
  for (const bad of [null, undefined, '', 'constructor', '__proto__', 'toString', 'home-nope']) {
    assert.equal(isHomeScenarioId(bad), false, String(bad));
  }
  assert.deepEqual(
    initialSessionState('#/?scenario=home-active-order'),
    homeScenarioState('home-active-order'),
  );
  for (const hash of ['', '#/', '#/?scenario=__proto__', '#/?scenario=<script>', '#/?other=1']) {
    assert.deepEqual(initialSessionState(hash), homeScenarioState('home-empty'), hash);
  }
});

test('C003 Home carries the approved Arabic copy verbatim', () => {
  for (const copy of [
    'تجربة تفاعلية · لا حجز أو دفع فعلي',
    'غسيل متنقل',
    'على وقتك. عند بابك.',
    'WASHGO / SIGNATURE',
    'عناية أكثر. مجهود أقل.',
    'خذ راحتك.',
    'وقتك لك.',
    'واللمعة علينا.',
    'غسلتك تبدأ من',
    'احجز غسلتك',
    'السعر من البداية',
    'الموعد باختيارك',
    'بدون إنشاء حساب',
    'غسلتك قيد المتابعة',
    'متابعة',
    'عنايتك المفضّلة، محفوظة',
    'نكرر نفس الغسلة؟',
    'حجزك محفوظ، نكمّله؟',
    'أكمل',
    'جرّب الدفع بطريقتك.',
    'كاش · شام كاش · سيريتل كاش — تجربة مباشرة',
    'العناية تبدأ هنا',
    'لكل يوم، غسلته.',
    'تفاصيل الباقات',
    'فرق تشوفه. وراحة تحسّها.',
    'معاينة قبل وبعد',
    'جرّب المقارنة التفاعلية قبل وبعد',
    'رسوم توضيحية',
    'من قبل… إلى واو.',
    'مقارنة تفاعلية، من أول نظرة لآخر لمعة.',
    'دمشق والعملة والمواعيد هنا لإيضاح التجربة فقط.',
    'لا تتصل هذه النسخة بأي مزوّد خدمة.',
  ]) {
    assert.ok(reference.includes(copy), `not in the approved reference: ${copy}`);
    assert.ok(homeSource.includes(copy), `missing from the Home feature: ${copy}`);
  }
  for (const copy of [
    REPEAT_BOOKING_NOTICE,
    'دمشق · مدينة النموذج',
    'متابعة التجربة',
    'إغلاق النافذة',
    'مرة ثانية، بكل سهولة.',
    'تصميم للهاتف · تجربة محلية',
  ]) {
    assert.ok(reference.includes(copy), `not in the approved reference: ${copy}`);
  }
});

test('C003 artwork is byte-identical to the approved reference', () => {
  assert.equal(referenceArtDefs.length, 7);
  assert.equal(referenceCarSymbols.length, 3);
  for (const fragment of [...referenceArtDefs, ...referenceCarSymbols]) {
    assert.ok(reference.includes(fragment), fragment.slice(0, 60));
  }
});

test('C003 keeps Home deterministic: no storage, network, clock or randomness', () => {
  assert.doesNotMatch(
    c003Source,
    /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|axios|WebSocket|sendBeacon|Math\.random|Date\.now|new Date\(/,
  );
});

test('C003 Home entries are semantic controls, not click-only containers', () => {
  assert.doesNotMatch(homeSource, /<(?:div|span|section|p)\b[^>]*\bonClick=/);
  assert.doesNotMatch(homeSource, /role="button"/);
  const handlers = [...homeSource.matchAll(/<(\w+)\b[^>]*\bonClick=/g)].map((match) => match[1]);
  assert.ok(handlers.length >= 5);
  assert.deepEqual([...new Set(handlers)], ['button']);
});

test('C003 Home stays inside its feature boundary', () => {
  for (const file of homeSources.filter((name) => /\.tsx?$/.test(name))) {
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/from '([^']+)'/g)) {
      assert.doesNotMatch(specifier, /\/app\//, `${file} imports the app layer`);
      assert.doesNotMatch(
        specifier,
        /features\/(?!home)/,
        `${file} imports another feature: ${specifier}`,
      );
    }
  }
});
