import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { illustrativeCost } from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import { homeScenarioState } from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import { reviewScenarioState } from '../../apps/customer-web/src/fixtures/customerReviewScenarios.ts';
import { confirmationCatalog } from '../../apps/customer-web/src/features/booking/review/confirmationCatalog.ts';
import { buildHomeViewModel } from '../../apps/customer-web/src/features/home/homeViewModel.ts';
import {
  ORDER_CREATED_NOTICE,
  ORDER_FAILED_NOTICE,
  ORDER_HISTORY_LIMIT,
  clearPendingHandoff,
  confirmBooking,
  draftFingerprint,
} from '../../apps/customer-web/src/state/bookingConfirmation.ts';
import { blankBookingDraft } from '../../apps/customer-web/src/state/bookingDraft.ts';
import {
  repeatOrder,
  resumeBooking,
  startBooking,
} from '../../apps/customer-web/src/state/bookingEntry.ts';
import { inProgressOrderCount } from '../../apps/customer-web/src/state/customerSession.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';
import { submitPaymentStep } from '../../apps/customer-web/src/state/paymentStep.ts';
import { leaveReviewEdit, openReviewEdit } from '../../apps/customer-web/src/state/reviewStep.ts';
import { ADDRESS_BOOK_FULL_NOTICE } from '../../apps/customer-web/src/state/savedAddresses.ts';
import { GARAGE_FULL_NOTICE } from '../../apps/customer-web/src/state/savedVehicles.ts';
import { saveDraftAndExit } from '../../apps/customer-web/src/state/vehicleStep.ts';
import {
  ORDER_NOT_FOUND_TITLE,
  buildOrderHandoffView,
  findSessionOrder,
} from '../../apps/customer-web/src/widgets/order-handoff/orderHandoffViewModel.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP = path.join(ROOT, 'apps/customer-web/src');
const reference = readFileSync(
  path.join(ROOT, 'design/reference/approved/washgo-payments-interactive.html'),
  'utf8',
);
const read = (relative) => readFileSync(path.join(APP, relative), 'utf8');
const sourceFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.tsx?$/.test(entry.name) ? [target] : [];
  });
/** The rendering contract's fixed instant: 2026-09-20 12:00 in Damascus. */
const NOW = new Date('2026-09-20T09:00:00.000Z');
/** 2026-09-21 09:15 Damascus: the fixtures' 10:00 appointment is inside the lead time. */
const EXPIRED = new Date('2026-09-21T06:15:00.000Z');

/** The command Review sends for the state it rendered. */
const command = (state, overrides = {}) => ({
  key: state.draftGeneration,
  fingerprint: draftFingerprint(state.draft),
  now: NOW,
  catalog: confirmationCatalog,
  ...overrides,
});
const confirm = (state, overrides) => confirmBooking(state, command(state, overrides));
const withDraft = (state, changes) => ({ ...state, draft: { ...state.draft, ...changes } });
/** The business data a confirmation may change; everything else is presentation. */
const business = (state) =>
  JSON.stringify({
    orders: state.orders,
    vehicles: state.vehicles,
    addresses: state.addresses,
    profile: state.profile,
    draft: state.draft,
    orderSequence: state.orderSequence,
    vehicleSequence: state.vehicleSequence,
    addressSequence: state.addressSequence,
    draftGeneration: state.draftGeneration,
    confirmationReceipts: state.confirmationReceipts,
  });

// --------------------------------------------------------------- creation

test('C014 cash, sham and syriatel each create one unpaid session order', () => {
  for (const [scenario, method, status, kind, route] of [
    ['booking-review-cash', 'cash', 'cash_due', 'order-tracking', '/order/WG-SESSION-1'],
    ['booking-review-sham', 'sham', 'awaiting_transfer', 'order-payment', '/pay/WG-SESSION-1'],
    [
      'booking-review-syriatel',
      'syriatel',
      'awaiting_transfer',
      'order-payment',
      '/pay/WG-SESSION-1',
    ],
  ]) {
    const state = reviewScenarioState(scenario);
    const quote = illustrativeCost(state.draft);
    const result = confirm(state);
    assert.equal(result.outcome.kind, 'created', scenario);
    assert.equal(result.outcome.orderId, 'WG-SESSION-1');
    assert.deepEqual(result.intent, { kind, orderId: 'WG-SESSION-1' });
    assert.equal(pathForIntent(result.intent), route);
    assert.deepEqual(result.state.pendingHandoff, result.intent);
    assert.equal(result.state.orders.length, state.orders.length + 1);
    const order = result.state.orders[0];
    assert.equal(order.id, 'WG-SESSION-1');
    assert.equal(order.stage, 0);
    assert.equal(order.paymentMethod, method);
    assert.deepEqual(order.confirmation.payment, {
      method,
      status,
      amount: quote.total,
      currency: 'SYP',
      submittedAt: null,
      verifiedAt: null,
    });
    assert.equal(order.confirmation.total, quote.total);
    assert.equal(order.confirmation.minutes, quote.minutes);
    assert.equal(order.confirmation.createdAt, NOW.toISOString());
    assert.equal(result.state.orderSequence, 1);
    assert.equal(result.state.draftGeneration, state.draftGeneration + 1);
    assert.equal(result.state.notice.message, ORDER_CREATED_NOTICE);
    assert.equal(result.state.announcement.message, ORDER_CREATED_NOTICE);
    assert.equal(inProgressOrderCount(result.state), inProgressOrderCount(state) + 1);
  }
  assert.ok(reference.includes("status:method==='cash'?'cash_due':'awaiting_transfer'"));
  assert.ok(reference.includes("go(d.paymentMethod==='cash'?'tracking':'payment',0,true)"));
  assert.ok(reference.includes("'تم إنشاء الطلب لهذه الجلسة. التخزين المحلي غير متاح.'"));
});

test('C014 confirmation normalises plate, number and name; editing never did', () => {
  const state = withDraft(reviewScenarioState('booking-review-cash'), {
    plate: '4567   دمشق',
    contactName: '  ريم التجريبية  ',
    contactPhone: '٠٩٠٠ (٠٠٠) ٠٠٠',
  });
  assert.equal(state.draft.contactPhone, '٠٩٠٠ (٠٠٠) ٠٠٠', 'the draft keeps what was typed');
  const { state: next } = confirm(state);
  const order = next.orders[0];
  assert.equal(order.plate, '4567 دمشق');
  assert.equal(order.contactPhone, '0900000000', 'Latin digits, leading zero kept');
  assert.equal(order.contactName, 'ريم التجريبية');
  assert.deepEqual(next.profile, { name: 'ريم التجريبية', phone: '0900000000' });
  const plus = confirm(reviewScenarioState('booking-review-cash')).state.orders[0];
  assert.equal(plus.contactPhone, '+963110000000', 'a leading + is kept, no country rule added');
  assert.ok(
    reference.includes("d.phone=digits(d.phone).replace(/[\\s()-]/g,'');d.name=str(d.name,60)"),
  );
});

test('C014 the order is a snapshot: cloned, independent and never recomputed', () => {
  const state = reviewScenarioState('booking-review-full');
  const before = JSON.stringify(state);
  const { state: next } = confirm(state);
  assert.equal(JSON.stringify(state), before, 'the input session is not mutated');
  const order = next.orders[0];
  assert.notEqual(order.extras, state.draft.extras);
  assert.notEqual(order.slot, state.draft.slot);
  assert.notEqual(order.confirmation.place, state.draft.place);
  assert.deepEqual(order.confirmation.place, state.draft.place);
  assert.notEqual(next.profile, state.profile);
  // A later draft never changes what was recorded.
  const later = withDraft(next, { service: 'exterior', vehicleType: 'sedan', extras: [] });
  assert.equal(later.orders[0].confirmation.total, illustrativeCost(state.draft).total);
  // Displayed add-ons are recorded as chosen; the quote charges each once.
  const dirty = withDraft(reviewScenarioState('booking-review-full'), {
    extras: ['seats', 'wheels', 'seats'],
  });
  const recorded = confirm(dirty).state.orders[0];
  assert.deepEqual(recorded.extras, ['seats', 'wheels', 'seats']);
  assert.equal(recorded.confirmation.total, illustrativeCost(dirty.draft).total);
});

test('C014 the same input gives the same result: no clock, random or hidden counter', () => {
  const state = reviewScenarioState('booking-review-sham');
  assert.deepEqual(confirm(state), confirm(state));
  for (const file of ['state/bookingConfirmation.ts', 'widgets/order-handoff/OrderHandoff.tsx']) {
    const source = read(file);
    assert.ok(!/Date\.now\(|new Date\(|Math\.random|crypto\./.test(source), file);
  }
});

// ------------------------------------------------------------- refusals

test('C014 refusals return to the owning step in the guard order and change nothing', () => {
  const ready = reviewScenarioState('booking-review-cash');
  const cases = [
    [{ plate: '!!' }, NOW, 0, 'اكتب أرقام اللوحة وحروفها فقط، أو اتركها فارغة.'],
    [{ address: 'ab' }, NOW, 2, 'حدد مكان السيارة أو أدخل عنوانًا واضحًا قبل المتابعة.'],
    [{}, EXPIRED, 3, 'اختر موعدًا متاحًا، أو استخدم أقرب موعد.'],
    [{ contactName: 'x' }, NOW, 4, 'أدخل اسمًا من حرفين على الأقل.'],
    [{ contactPhone: '12' }, NOW, 4, 'أدخل رقمًا تجريبيًا من 8 إلى 15 رقمًا.'],
    [{ paymentMethod: null }, NOW, 5, 'اختر كيف ستدفع قبل متابعة الحجز.'],
    [{ paymentMethod: '__proto__' }, NOW, 5, 'اختر كيف ستدفع قبل متابعة الحجز.'],
    [{ paymentMethod: 'card' }, NOW, 5, 'اختر كيف ستدفع قبل متابعة الحجز.'],
    [{ vehicleType: 'tank' }, NOW, 0, null],
    [{ vehicleType: '__proto__' }, NOW, 0, null],
    [{ service: 'constructor' }, NOW, 1, null],
    [{ extras: 'seats' }, NOW, 1, null],
    [{ extras: null }, NOW, 1, null],
    [{ extras: 7 }, NOW, 1, null],
    // Earlier prerequisites win: a bad plate is reported before an expired slot.
    [
      { plate: '!!', paymentMethod: null },
      EXPIRED,
      0,
      'اكتب أرقام اللوحة وحروفها فقط، أو اتركها فارغة.',
    ],
  ];
  for (const [changes, now, step, message] of cases) {
    const state = { ...withDraft(ready, changes), reviewEditing: true };
    const result = confirm(state, { now });
    const label = JSON.stringify(changes);
    assert.deepEqual(result.outcome, { kind: 'refused', step, message }, label);
    assert.deepEqual(result.intent, { kind: 'booking-step', step }, label);
    assert.equal(result.state.reviewEditing, false, label);
    assert.equal(result.state.draft, state.draft, label + ': input kept as typed');
    assert.equal(result.state.orders, state.orders, label);
    assert.equal(result.state.vehicles, state.vehicles, label);
    assert.equal(result.state.addresses, state.addresses, label);
    assert.equal(result.state.profile, state.profile, label);
    assert.equal(result.state.orderSequence, state.orderSequence, label);
    assert.equal(result.state.draftGeneration, state.draftGeneration, label);
    assert.deepEqual(result.state.confirmationReceipts, [], label + ': no receipt consumed');
    assert.equal(result.state.pendingHandoff, null, label);
    if (message) assert.equal(result.state.notice.message, message, label);
  }
});

test('C014 an unexpected failure commits nothing and never reports success', () => {
  const state = reviewScenarioState('booking-review-full');
  const failing = [
    {
      ...confirmationCatalog,
      quote: () => {
        throw new Error('QUOTE_DOWN');
      },
    },
    { ...confirmationCatalog, quote: () => ({ total: Number.NaN, minutes: 60 }) },
    { ...confirmationCatalog, quote: () => ({ total: 900, minutes: Infinity }) },
    {
      ...confirmationCatalog,
      sizeName: () => {
        throw new Error('SIZE_DOWN');
      },
    },
  ];
  for (const catalog of failing) {
    const result = confirm(state, { catalog });
    assert.equal(result.outcome.kind, 'failed');
    assert.equal(result.intent, null);
    assert.equal(business(result.state), business(state), 'no half-saved session');
    assert.equal(result.state.notice.message, ORDER_FAILED_NOTICE);
    assert.notEqual(result.state.notice.message, ORDER_CREATED_NOTICE);
  }
});

// ------------------------------------------------------- replay protection

test('C014 two activations before a render create one order; the replay is a no-op', () => {
  const state = reviewScenarioState('booking-review-cash');
  const reviewed = command(state);
  const first = confirmBooking(state, reviewed);
  // The second activation carries the same reviewed key and fingerprint, but the
  // provider evaluates it against the latest state, which the first one produced.
  const second = confirmBooking(first.state, reviewed);
  assert.deepEqual(second.outcome, { kind: 'replay', orderId: first.outcome.orderId });
  assert.equal(second.intent, null);
  assert.equal(second.state, first.state, 'no profile, garage, address or id change');
  // Still a replay after the appointment's time boundary: never re-created or refused.
  const later = confirmBooking(first.state, { ...reviewed, now: EXPIRED });
  assert.equal(later.outcome.kind, 'replay');
  assert.equal(later.state, first.state);
});

test('C014 the same key with a different payload is refused; a changed draft is stale', () => {
  const state = reviewScenarioState('booking-review-cash');
  const first = confirm(state);
  const changed = {
    ...command(state),
    fingerprint: draftFingerprint({ ...state.draft, note: 'x' }),
  };
  assert.deepEqual(confirmBooking(first.state, changed).outcome, { kind: 'conflict' });
  assert.equal(confirmBooking(first.state, changed).state, first.state);
  // A command for a draft that changed after it was reviewed needs a fresh intent.
  const edited = withDraft(state, { note: 'ملاحظة جديدة' });
  assert.deepEqual(confirmBooking(edited, command(state)).outcome, { kind: 'stale' });
  assert.equal(confirmBooking(edited, command(state)).state, edited);
  // A command for another generation is stale too.
  assert.deepEqual(confirm(state, { key: state.draftGeneration + 5 }).outcome, { kind: 'stale' });
  // touched is bookkeeping: it does not change the fingerprint.
  assert.equal(
    draftFingerprint({ ...state.draft, touched: false }),
    draftFingerprint({ ...state.draft, touched: true }),
  );
});

test('C014 a refusal consumes nothing: the corrected draft confirms afresh', () => {
  const state = reviewScenarioState('booking-review-cash');
  const refused = confirm(state, { now: EXPIRED });
  assert.equal(refused.outcome.kind, 'refused');
  const corrected = withDraft(refused.state, {
    scheduleDay: '2026-09-21',
    slot: { date: '2026-09-21', time: '13:00' },
  });
  const created = confirm(corrected, { now: EXPIRED });
  assert.equal(created.outcome.kind, 'created');
  assert.equal(created.state.orders[0].slot.time, '13:00');
});

test('C014 a later identical draft is a new booking, not a duplicate', () => {
  const state = reviewScenarioState('booking-review-cash');
  const first = confirm(state).state;
  // The customer deliberately enters the same choices again in the fresh draft.
  const again = { ...first, draft: { ...state.draft } };
  const second = confirm(again);
  assert.equal(second.outcome.kind, 'created');
  assert.deepEqual(
    second.state.orders.map((order) => order.id),
    ['WG-SESSION-2', 'WG-SESSION-1'],
  );
  assert.equal(second.state.orders[1], first.orders[0], 'the earlier order is unchanged');
});

test('C014 ids are unique against seeded orders; the history keeps the newest 80', () => {
  const state = reviewScenarioState('booking-review-cash');
  const seeded = {
    ...state,
    orders: [
      { ...homeScenarioState('home-repeat-order').orders[0], id: 'WG-SESSION-1' },
      { ...homeScenarioState('home-repeat-order').orders[0], id: 'WG-SESSION-2' },
    ],
  };
  assert.equal(confirm(seeded).outcome.orderId, 'WG-SESSION-3');
  const old = homeScenarioState('home-repeat-order').orders[0];
  const full = {
    ...state,
    orders: Array.from({ length: ORDER_HISTORY_LIMIT }, (_, index) => ({
      ...old,
      id: `WG-OLD-${index}`,
    })),
  };
  const next = confirm(full).state;
  assert.equal(next.orders.length, ORDER_HISTORY_LIMIT);
  assert.equal(next.orders[0].id, 'WG-SESSION-1');
  assert.equal(next.orders.at(-1).id, `WG-OLD-${ORDER_HISTORY_LIMIT - 2}`);
  assert.equal(next.orders[1], full.orders[0], 'kept records are the same objects');
  assert.ok(reference.includes('if(S.orders.length>80)S.orders.length=80'));
});

// -------------------------------------------------------- optional saves

test('C014 save preferences off: garage and address book untouched', () => {
  const state = withDraft(reviewScenarioState('booking-review-full'), {
    saveVehicle: false,
    saveAddress: false,
  });
  const result = confirm(state);
  assert.deepEqual(result.outcome.saves, { vehicle: 'off', address: 'off' });
  assert.equal(result.state.vehicles, state.vehicles);
  assert.equal(result.state.addresses, state.addresses);
  assert.equal(result.state.orders[0].confirmation.carId, null);
});

test('C014 save preferences on: added, then updated by the same description', () => {
  const state = reviewScenarioState('booking-review-full');
  const first = confirm(state);
  assert.deepEqual(first.outcome.saves, { vehicle: 'added', address: 'added' });
  assert.deepEqual(first.state.vehicles, [
    { id: 'CAR-1', type: 'large', name: 'سيارة العائلة', plate: '4567 دمشق', color: 'رمادي' },
  ]);
  assert.equal(first.state.orders[0].confirmation.carId, 'CAR-1');
  assert.equal(first.state.addresses.length, 1);
  assert.equal(first.state.addresses[0].id, 'ADR-1');
  assert.notEqual(first.state.addresses[0].place, state.draft.place);
  // The same car (plate and size) and address again: updated, never duplicated.
  const again = { ...first.state, draft: { ...state.draft, color: 'أسود' } };
  const second = confirm(again);
  assert.deepEqual(second.outcome.saves, { vehicle: 'updated', address: 'updated' });
  assert.equal(second.state.vehicles.length, 1);
  assert.equal(second.state.vehicles[0].color, 'أسود');
  assert.equal(second.state.addresses.length, 1);
  // An earlier order keeps its own copy of the car.
  assert.equal(second.state.orders[1].color, 'رمادي');
});

test('C014 a full garage or address book is skipped visibly, not reported as saved', () => {
  const state = reviewScenarioState('booking-review-full');
  const full = {
    ...state,
    vehicles: Array.from({ length: 30 }, (_, index) => ({
      id: `CAR-${index + 1}`,
      type: 'sedan',
      name: `سيارة ${index}`,
      plate: `${1000 + index}`,
      color: '',
    })),
    vehicleSequence: 30,
    addresses: Array.from({ length: 20 }, (_, index) => ({
      id: `ADR-${index + 1}`,
      label: 'عنوان',
      address: `عنوان تجريبي رقم ${index}`,
      locationNote: '',
      place: null,
    })),
    addressSequence: 20,
  };
  const result = confirm(full);
  assert.equal(result.outcome.kind, 'created', 'a full collection is not a failed booking');
  assert.deepEqual(result.outcome.saves, { vehicle: 'capacity', address: 'capacity' });
  assert.equal(result.state.vehicles, full.vehicles);
  assert.equal(result.state.addresses, full.addresses);
  assert.equal(
    result.state.notice.message,
    [ORDER_CREATED_NOTICE, GARAGE_FULL_NOTICE, ADDRESS_BOOK_FULL_NOTICE].join(' '),
  );
  assert.ok(!/على جهازك|محفوظ على/.test(result.state.notice.message), 'no device claim');
});

// --------------------------------------------- reset, home and handoff

test('C014 the accepted draft is reset with the confirmed contact only', () => {
  const state = { ...reviewScenarioState('booking-review-sham'), bookingMode: 'repeat' };
  const { state: next } = confirm(state);
  assert.deepEqual(next.draft, {
    ...blankBookingDraft(),
    contactName: 'ريم التجريبية',
    contactPhone: '+963110000000',
  });
  assert.equal(next.draft.touched, false);
  assert.equal(next.draft.slot, null);
  assert.equal(next.draft.paymentMethod, null);
  assert.equal(next.draftStep, 0);
  assert.equal(next.bookingMode, 'standard');
  assert.equal(next.reviewEditing, false);
  const home = buildHomeViewModel(next);
  assert.deepEqual(home.activeOrder?.id, 'WG-SESSION-1');
  assert.equal(home.savedDraft, null, 'nothing to continue: the draft was consumed');
  // Starting again prefills the confirmed contact, as the reference's blank()+name.
  const started = startBooking(next, undefined, NOW).state;
  assert.equal(started.draft.contactName, 'ريم التجريبية');
  assert.equal(clearPendingHandoff(next).pendingHandoff, null);
  assert.equal(clearPendingHandoff(state), state);
});

test('C014 the handoff resolves the session order; unknown ids get the fallback', () => {
  const { state } = confirm(reviewScenarioState('booking-review-syriatel'));
  const order = findSessionOrder(state.orders, 'WG-SESSION-1');
  const view = buildOrderHandoffView(order, 'payment');
  assert.equal(view.orderId, 'WG-SESSION-1');
  assert.equal(view.confirmed.total, order.confirmation.total);
  assert.equal(view.confirmed.payment.label, 'بانتظار التحويل');
  assert.equal(view.confirmed.walletDeferred, true);
  assert.equal(view.receipt.contact.phone, '+963110000000');
  for (const id of [undefined, '', 'WG-SESSION-9', '__proto__', 'constructor']) {
    assert.equal(findSessionOrder(state.orders, id), null, String(id));
  }
  assert.equal(ORDER_NOT_FOUND_TITLE, 'لم نجد هذا الطلب في هذه الجلسة.');
  // An older demo order has no recorded total or payment: none is invented.
  const historical = homeScenarioState('home-active-order').orders[0];
  assert.equal(buildOrderHandoffView(historical, 'tracking').confirmed, null);
  assert.equal(
    pathForIntent({ kind: 'order-payment', orderId: 'a/b c' }),
    '/pay/a%2Fb%20c',
    'ids are encoded',
  );
});

test('C014 repeat of a confirmed order is a new draft; the order stays as it was', () => {
  const created = confirm(reviewScenarioState('booking-review-full')).state;
  const order = created.orders[0];
  const before = JSON.stringify(order);
  const completed = { ...created, orders: [{ ...order, stage: 4 }] };
  const repeated = repeatOrder(completed, order.id, NOW);
  assert.equal(repeated.state.draft.service, order.service);
  assert.deepEqual(repeated.state.draft.place, order.confirmation.place);
  assert.notEqual(repeated.state.draft.place, order.confirmation.place);
  assert.equal(repeated.state.draft.paymentMethod, order.paymentMethod);
  const again = confirm(repeated.state);
  assert.equal(again.outcome.kind, 'created');
  assert.equal(again.state.orders[0].id, 'WG-SESSION-2');
  assert.equal(JSON.stringify(order), before, 'the old order is never rewritten');
});

test('C014 repeat entry sanitises a malformed stored order (scoped audit)', () => {
  const home = homeScenarioState('home-repeat-order');
  const hostile = {
    ...home,
    orders: [
      {
        ...home.orders[0],
        vehicleType: 'tank',
        service: '__proto__',
        extras: ['seats', 'seats', 'polish', 'constructor'],
      },
    ],
  };
  const repeated = repeatOrder(hostile, hostile.orders[0].id, NOW).state.draft;
  assert.equal(repeated.vehicleType, 'sedan');
  assert.equal(repeated.service, 'exterior');
  assert.deepEqual(repeated.extras, ['seats']);
  // A normal order is copied as before.
  const normal = repeatOrder(home, home.orders[0].id, NOW).state.draft;
  assert.equal(normal.service, home.orders[0].service);
  assert.ok(reference.includes('if(Object.hasOwn(PACKAGES,raw.service))d.service=raw.service'));
});

// ------------------------------------------------ nothing else creates

test('C014 only the explicit Review action confirms; no step, route or mount does', () => {
  const state = reviewScenarioState('booking-review-cash');
  for (const next of [
    submitPaymentStep(state).state,
    openReviewEdit(state, 2, NOW).state,
    leaveReviewEdit(state, NOW).state,
    saveDraftAndExit(state).state,
    resumeBooking(state, NOW).state,
    startBooking(state, undefined, NOW).state,
  ]) {
    assert.equal(next.orders, state.orders);
    assert.equal(next.vehicles, state.vehicles);
    assert.equal(next.addresses, state.addresses);
    assert.equal(next.orderSequence, state.orderSequence);
  }
  const callers = sourceFiles(APP)
    .filter((file) => /confirmBooking\(/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(APP, file).replaceAll('\\', '/'));
  assert.deepEqual(callers.sort(), [
    'features/booking/review/ReviewStep.tsx',
    'state/bookingConfirmation.ts',
  ]);
  const step = read('features/booking/review/ReviewStep.tsx');
  // Called from the click handler only: never in render, an effect or a state updater.
  assert.match(
    step,
    /const confirm = \(\) => \{\n\s+const now = currentInstant\(\);\n\s+const result = run\(/,
  );
  assert.ok(!/useEffect\([^)]*confirm/.test(step));
  const provider = read('state/CustomerSessionProvider.tsx');
  assert.match(provider, /const result = command\(stateRef\.current\);/);
  assert.ok(!/setState\(\(/.test(provider), 'no replayable updater function');
});

test('C014 privacy and persistence: session memory only, no network, QR or paid state', () => {
  const owned = [
    read('state/bookingConfirmation.ts'),
    read('widgets/order-handoff/OrderHandoff.tsx'),
    read('widgets/order-handoff/orderHandoffViewModel.ts'),
    read('features/booking/review/confirmationCatalog.ts'),
  ].join('\n');
  for (const pattern of [
    /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/,
    /localStorage|sessionStorage|indexedDB|document\.cookie/,
    /data:image|<img|QRCode|qrMarkup|canvas/i,
    /paid_demo|cash_collected_demo|awaiting_review|verifiedAt: (?!null)/,
    /console\.(log|info)/,
    /dangerouslySetInnerHTML|innerHTML/,
  ]) {
    assert.ok(!pattern.test(owned), 'C014 owned code must not match ' + pattern);
  }
});
