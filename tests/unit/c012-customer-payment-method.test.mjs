import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { illustrativeCost } from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import {
  paymentScenarioIds,
  paymentScenarioState,
} from '../../apps/customer-web/src/fixtures/customerPaymentScenarios.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import { bookingSteps } from '../../apps/customer-web/src/app/routes.ts';
import { bookingFlow } from '../../apps/customer-web/src/features/booking/bookingFlow.ts';
import {
  PAYMENT_METHOD_IDS,
  isPaymentMethodId as isDraftPaymentMethodId,
  resolveBookingEntryStep,
} from '../../apps/customer-web/src/state/bookingDraft.ts';
import { repeatOrder, resumeBooking } from '../../apps/customer-web/src/state/bookingEntry.ts';
import { homeScenarioState } from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import {
  PAYMENT_METHODS,
  PAYMENT_REQUIRED_MESSAGE,
  PAYMENT_STEP_INDEX,
  isPaymentMethodId,
  paymentMethodDefinition,
  returnToContactStep,
  selectPaymentMethod,
  submitPaymentStep,
} from '../../apps/customer-web/src/state/paymentStep.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP = path.join(ROOT, 'apps/customer-web/src');
const reference = readFileSync(
  path.join(ROOT, 'design/reference/approved/washgo-payments-interactive.html'),
  'utf8',
);
const read = (relative) => readFileSync(path.join(APP, relative), 'utf8');
const NOW = new Date('2026-09-20T09:00:00.000Z');

test('C012 flow: payment is step six of seven, between contact and review', () => {
  assert.equal(PAYMENT_STEP_INDEX, 5);
  assert.deepEqual(bookingFlow[5], { id: 'payment', label: 'الدفع', nextLabel: 'مراجعة الحجز' });
  assert.equal(bookingSteps[5].path, '/book/5');
  assert.equal(bookingSteps[6].path, '/book/6');
  assert.equal(
    pathForIntent(returnToContactStep(paymentScenarioState('booking-payment-empty')).intent),
    '/book/4',
  );
});

test('C012 catalog: exactly the approved three methods in source order', () => {
  assert.deepEqual(
    PAYMENT_METHODS.map(({ id, name, short, hint, tone }) => ({ id, name, short, hint, tone })),
    [
      {
        id: 'cash',
        name: 'كاش بعد الغسيل',
        short: 'كاش',
        hint: 'ارتاح الآن. وادفع للفني بعد انتهاء العناية.',
        tone: 'cash',
      },
      {
        id: 'sham',
        name: 'شام كاش',
        short: 'شام كاش',
        hint: 'رمز QR وبيانات تحويل واضحة أمامك.',
        tone: 'sham',
      },
      {
        id: 'syriatel',
        name: 'سيريتل كاش',
        short: 'سيريتل كاش',
        hint: 'ادفع من محفظتك، ثم تابع حالة التحويل.',
        tone: 'syriatel',
      },
    ],
  );
  for (const m of PAYMENT_METHODS) {
    assert.ok(reference.includes(m.name));
    assert.ok(reference.includes(m.hint));
  }
});

test('C012 method ids are closed and definitions are deterministic', () => {
  for (const id of ['cash', 'sham', 'syriatel']) {
    assert.equal(isPaymentMethodId(id), true);
    assert.equal(paymentMethodDefinition(id)?.id, id);
  }
  for (const value of [null, '', '__proto__', 'constructor', 'card', 1])
    assert.equal(isPaymentMethodId(value), false);
  assert.equal(paymentMethodDefinition(null), null);
});

test('C012 fresh payment scenario has no implicit method', () => {
  const state = paymentScenarioState('booking-payment-empty');
  assert.equal(state.draft.paymentMethod, null);
  assert.equal(state.draftStep, 5);
});

test('C012 selecting each method edits only the unsent draft and announces the unchanged total', () => {
  for (const method of PAYMENT_METHODS) {
    const before = paymentScenarioState('booking-payment-empty');
    const total = illustrativeCost(before.draft).total;
    const after = selectPaymentMethod(before, method.id, total);
    assert.equal(after.draft.paymentMethod, method.id);
    assert.equal(after.draft.touched, true);
    assert.equal(after.orders, before.orders);
    assert.equal(after.profile, before.profile);
    assert.equal(after.vehicles, before.vehicles);
    assert.equal(after.addresses, before.addresses);
    assert.equal(illustrativeCost(after.draft).total, total);
    assert.match(after.announcement.message, new RegExp(method.name));
    assert.match(after.announcement.message, new RegExp(String(total)));
  }
});

test('C012 changing methods is reversible and never changes the quote', () => {
  const base = paymentScenarioState('booking-payment-empty');
  const quote = illustrativeCost(base.draft);
  let state = selectPaymentMethod(base, 'sham', quote.total);
  state = selectPaymentMethod(state, 'syriatel', quote.total);
  state = selectPaymentMethod(state, 'cash', quote.total);
  assert.equal(state.draft.paymentMethod, 'cash');
  assert.deepEqual(illustrativeCost(state.draft), quote);
  for (const key of [
    'vehicleType',
    'service',
    'extras',
    'address',
    'locationNote',
    'scheduleDay',
    'slot',
    'contactName',
    'contactPhone',
    'note',
  ]) {
    assert.deepEqual(state.draft[key], base.draft[key], key);
  }
});

test('C012 an unknown method is a no-op', () => {
  const state = paymentScenarioState('booking-payment-empty');
  assert.equal(selectPaymentMethod(state, '__proto__', 900), state);
  assert.equal(selectPaymentMethod(state, 'card', 900), state);
});

test('C012 Next with no method stays on Payment and announces the approved error', () => {
  const state = paymentScenarioState('booking-payment-empty');
  const result = submitPaymentStep(state);
  assert.equal(result.intent, null);
  assert.equal(result.error, PAYMENT_REQUIRED_MESSAGE);
  assert.equal(result.state.draft, state.draft);
  assert.equal(result.state.draftStep, 5);
  assert.equal(result.state.announcement.message, PAYMENT_REQUIRED_MESSAGE);
  assert.ok(reference.includes(PAYMENT_REQUIRED_MESSAGE));
});

test('C012 valid Next reaches Review without creating or normalising anything', () => {
  const state = paymentScenarioState('booking-payment-sham');
  const result = submitPaymentStep(state);
  assert.equal(result.error, null);
  assert.equal(pathForIntent(result.intent), '/book/6');
  assert.equal(result.state.draftStep, 6);
  assert.equal(result.state.draft.paymentMethod, 'sham');
  assert.equal(result.state.orders, state.orders);
  assert.equal(result.state.profile, state.profile);
});

test('C012 entry guard keeps earlier prerequisites ahead of Payment', () => {
  const ready = paymentScenarioState('booking-payment-cash').draft;
  assert.equal(resolveBookingEntryStep(ready, 6, NOW), 6);
  assert.equal(resolveBookingEntryStep({ ...ready, paymentMethod: null }, 6, NOW), 5);
  assert.equal(resolveBookingEntryStep({ ...ready, contactPhone: '12' }, 6, NOW), 4);
  assert.equal(resolveBookingEntryStep({ ...ready, slot: null }, 6, NOW), 3);
  assert.equal(resolveBookingEntryStep({ ...ready, address: '' }, 6, NOW), 2);
  assert.equal(resolveBookingEntryStep(ready, 6, new Date('2026-09-21T07:00:00.000Z')), 3);
});

test('C012 deterministic payment scenarios are allowlisted and synthetic', () => {
  assert.deepEqual(paymentScenarioIds, [
    'booking-payment-empty',
    'booking-payment-cash',
    'booking-payment-sham',
    'booking-payment-syriatel',
  ]);
  for (const id of paymentScenarioIds) {
    const expected = paymentScenarioState(id);
    assert.deepEqual(initialSessionState('#/book/5?scenario=' + id), expected);
    assert.equal(resolveBookingEntryStep(expected.draft, 5, NOW), 5);
  }
  for (const hostile of ['__proto__', 'constructor', 'booking-payment-card']) {
    assert.notDeepEqual(
      initialSessionState('#/book/5?scenario=' + hostile),
      paymentScenarioState('booking-payment-cash'),
    );
  }
});

test('C012 copy: the owned Payment screen matches approved source strings', () => {
  const port = read('features/booking/payment/PaymentStep.tsx') + read('state/paymentStep.ts');
  for (const value of [
    '06 / الدفع على راحتك',
    'كيف تحبّ تدفع؟',
    'ثلاث طرق واضحة. والاختيار دائمًا لك.',
    'إجمالي غسلتك التجريبي',
    'السعر نفسه في كل الخيارات.',
    'لا يُحصَّل أي مبلغ داخل هذا النموذج.',
    'اختر طريقة الدفع',
    'لا دفع مسبق. تؤكد الحجز وتكمل يومك.',
    'بعد مراجعة الحجز، يظهر QR الخاص بهذه المحفظة.',
    'لا نطلب كلمة مرور المحفظة أو رمز التحقق.',
    'إتمام التحويل يكون داخل تطبيق المحفظة فقط.',
    'عن المبلغ والرسوم',
    PAYMENT_REQUIRED_MESSAGE,
  ]) {
    assert.ok(reference.includes(value), 'reference contains ' + value);
    assert.ok(port.includes(value), 'port contains ' + value);
  }
});

// C013 superseded "Review remains deferred": Review is mounted and ported; its
// confirmation stays unavailable (tests/unit/c013-customer-review.test.mjs).
test('C012 architecture: Payment is mounted; Review (C013) follows it', () => {
  const route = read('features/booking/index.tsx');
  assert.match(route, /if \(step === 'payment'\) return <PaymentStep \/>;/);
  assert.match(route, /return <ReviewStep \/>;/);
  const shell = read('app/CustomerShell.tsx');
  assert.ok(shell.includes("'/book/5'"));
  assert.ok(shell.includes("'/book/6'"));
  assert.match(read('features/booking/review/ReviewStep.tsx'), /unavailableReasonId=/);
});

test('C012 safety: no payment execution, QR generation, storage, network or order creation', () => {
  const owned = [
    read('state/paymentStep.ts'),
    read('features/booking/payment/PaymentStep.tsx'),
    read('fixtures/customerPaymentScenarios.ts'),
  ].join('\n');
  for (const pattern of [
    /fetch\(/,
    /XMLHttpRequest/,
    /sendBeacon/,
    /WebSocket/,
    /localStorage|sessionStorage|indexedDB|document\.cookie/,
    /createPayment|PaymentIntent|payment intent/i,
    /payProof|receipt|merchant|refund/i,
    /data:image|<img|QRCode|qr-button|PAY_DEMO_QR|qrMarkup\(/i,
    /dangerouslySetInnerHTML|innerHTML/,
  ])
    assert.ok(!pattern.test(owned), 'C012 owned code must not match ' + pattern);
  assert.ok(!/new Date\(\)|Date\.now\(/.test(owned), 'C012 adds no wall-clock read');
});

// Hostile runtime values: the type union does not protect values from links or old drafts.
const HOSTILE_METHODS = [
  'card',
  '',
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  1,
  {},
  undefined,
];

test('C012 one closed method rule is shared by the catalog, selector, guard and lookup', () => {
  assert.deepEqual(
    PAYMENT_METHODS.map((method) => method.id),
    PAYMENT_METHOD_IDS,
  );
  assert.equal(isPaymentMethodId, isDraftPaymentMethodId, 'payment step reuses the draft rule');
  for (const value of HOSTILE_METHODS) {
    assert.equal(isPaymentMethodId(value), false, String(value));
    assert.equal(paymentMethodDefinition(value), null, 'no definition for ' + String(value));
  }
});

test('C012 an unknown or prototype method cannot pass Payment or enter Review', () => {
  const ready = paymentScenarioState('booking-payment-cash');
  for (const value of HOSTILE_METHODS) {
    const draft = { ...ready.draft, paymentMethod: value };
    assert.equal(resolveBookingEntryStep(draft, 6, NOW), 5, 'guard rejects ' + String(value));
    const state = { ...ready, draft };
    const result = submitPaymentStep(state);
    assert.equal(result.intent, null, 'Next refuses ' + String(value));
    assert.equal(result.error, PAYMENT_REQUIRED_MESSAGE);
    assert.equal(selectPaymentMethod(state, value, 900), state, 'select ignores ' + String(value));
  }
});

test('C012 guard priority: earlier prerequisites win, a valid method cannot bypass them', () => {
  const ready = paymentScenarioState('booking-payment-syriatel').draft;
  const EXPIRED = new Date('2026-09-21T07:00:00.000Z');
  // Every prerequisite broken at once: the vehicle plate is reported first.
  const broken = {
    ...ready,
    plate: '!!',
    address: '',
    slot: null,
    contactName: '',
    contactPhone: '1',
    paymentMethod: null,
  };
  assert.equal(resolveBookingEntryStep(broken, 6, NOW), 0);
  assert.equal(resolveBookingEntryStep({ ...broken, plate: '' }, 6, NOW), 2);
  assert.equal(
    resolveBookingEntryStep({ ...broken, plate: '', address: ready.address }, 6, NOW),
    3,
  );
  assert.equal(
    resolveBookingEntryStep({ ...ready, contactName: '', paymentMethod: null }, 6, NOW),
    4,
  );
  // The same complete draft is valid at the fixed instant and refused once its slot has passed.
  assert.equal(resolveBookingEntryStep(ready, 5, NOW), 5);
  assert.equal(resolveBookingEntryStep(ready, 6, NOW), 6);
  assert.equal(resolveBookingEntryStep(ready, 5, EXPIRED), 3);
  assert.equal(resolveBookingEntryStep(ready, 6, EXPIRED), 3);
});

test('C012 resume returns to Payment with the chosen method; repeat never carries an unknown one', () => {
  const left = { ...paymentScenarioState('booking-payment-sham'), draftStep: 5 };
  const resumed = resumeBooking(left, NOW);
  assert.equal(pathForIntent(resumed.intent), '/book/5');
  assert.equal(resumed.state.draft.paymentMethod, 'sham');
  assert.equal(resumed.state.draft, left.draft, 'resume does not rewrite the draft');

  const home = homeScenarioState('home-repeat-order');
  const order = home.orders[0];
  const valid = repeatOrder(home, order.id, NOW);
  assert.equal(valid.state.draft.paymentMethod, order.paymentMethod);
  assert.equal(valid.state.orders, home.orders, 'repeating creates no order');
  const hostile = { ...home, orders: [{ ...order, paymentMethod: '__proto__' }] };
  const repeated = repeatOrder(hostile, order.id, NOW);
  assert.equal(repeated.state.draft.paymentMethod, null);
  assert.equal(pathForIntent(repeated.intent), '/book/5', 'the customer chooses again');
});
