import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  extraFixtures,
  illustrativeCost,
  packageFixtures,
  vehicleFixtures,
} from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import {
  isReviewScenarioId,
  reviewScenarioIds,
  reviewScenarioState,
} from '../../apps/customer-web/src/fixtures/customerReviewScenarios.ts';
import { homeScenarioState } from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import { paymentScenarioState } from '../../apps/customer-web/src/fixtures/customerPaymentScenarios.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import { bookingSteps } from '../../apps/customer-web/src/app/routes.ts';
import {
  REVIEW_RETURN_LABEL,
  bookingFlow,
  decisionNextLabel,
} from '../../apps/customer-web/src/features/booking/bookingFlow.ts';
import { buildPriceBreakdown } from '../../apps/customer-web/src/features/booking/priceBreakdown.ts';
import {
  CONFIRMATION_UNAVAILABLE_TEXT,
  REVIEW_EDIT_ACTIONS,
  buildReviewViewModel,
} from '../../apps/customer-web/src/features/booking/review/reviewViewModel.ts';
import {
  blankBookingDraft,
  resolveBookingEntryStep,
} from '../../apps/customer-web/src/state/bookingDraft.ts';
import {
  repeatOrder,
  resumeBooking,
  startBooking,
} from '../../apps/customer-web/src/state/bookingEntry.ts';
import { selectCarePackage, submitCareStep } from '../../apps/customer-web/src/state/careStep.ts';
import {
  editContactField,
  submitContactStep,
} from '../../apps/customer-web/src/state/contactStep.ts';
import { submitLocationStep } from '../../apps/customer-web/src/state/locationStep.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';
import {
  selectPaymentMethod,
  submitPaymentStep,
} from '../../apps/customer-web/src/state/paymentStep.ts';
import {
  REVIEW_EDIT_TARGETS,
  completeReviewEdit,
  endReviewEdit,
  isReviewEditTarget,
  leaveReviewEdit,
  openReviewEdit,
  returnToPaymentStep,
} from '../../apps/customer-web/src/state/reviewStep.ts';
import { dateLabel } from '../../apps/customer-web/src/state/scheduling.ts';
import { submitScheduleStep } from '../../apps/customer-web/src/state/scheduleStep.ts';
import { createScrollLock } from '../../apps/customer-web/src/shared/scrollLock.ts';
import {
  saveDraftAndExit,
  selectVehicleType,
  submitVehicleStep,
} from '../../apps/customer-web/src/state/vehicleStep.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP = path.join(ROOT, 'apps/customer-web/src');
const reference = readFileSync(
  path.join(ROOT, 'design/reference/approved/washgo-payments-interactive.html'),
  'utf8',
);
const read = (relative) => readFileSync(path.join(APP, relative), 'utf8');
/** The rendering contract's fixed instant: 2026-09-20 12:00 in Damascus. */
const NOW = new Date('2026-09-20T09:00:00.000Z');
const editing = (state) => ({ ...state, reviewEditing: true });

// ---------------------------------------------------------------- flow and mount

test('C013 flow: Review is the seventh of seven steps at /book/6, with no new step', () => {
  assert.equal(bookingSteps.length, 7);
  assert.equal(bookingFlow.length, 7);
  assert.deepEqual(bookingSteps[6], {
    index: 6,
    id: 'review',
    label: 'التأكيد',
    path: '/book/6',
  });
  assert.deepEqual(bookingFlow[6], {
    id: 'review',
    label: 'التأكيد',
    nextLabel: 'تأكيد الحجز التجريبي',
  });
  assert.ok(reference.includes("{label:'التأكيد',icon:'check',next:'تأكيد الحجز التجريبي'}"));
});

test('C013 architecture: Review is mounted, guarded, and treated as ported by the shell', () => {
  const route = read('features/booking/index.tsx');
  assert.match(route, /return <ReviewStep \/>;/);
  assert.match(route, /step === 'review'\s*\? resolveBookingEntryStep/);
  assert.ok(!route.includes('ShellPlaceholder'), 'no placeholder is left in the booking route');
  const shell = read('app/CustomerShell.tsx');
  assert.ok(shell.includes("'/book/6'"));
  assert.match(shell, /portedStep === 6\s*\? returnToPaymentStep/);
});

test('C013 review scenarios are allowlisted, valid at the fixed instant, and fresh per call', () => {
  assert.equal(isReviewScenarioId('__proto__'), false);
  assert.equal(isReviewScenarioId('constructor'), false);
  assert.equal(isReviewScenarioId('booking-review-unknown'), false);
  for (const id of reviewScenarioIds) {
    const state = initialSessionState(`#/book/6?scenario=${id}`);
    const expected = id === 'booking-review-expired-slot' ? 3 : 6;
    assert.equal(resolveBookingEntryStep(state.draft, 6, NOW), expected, id);
    assert.equal(state.reviewEditing, false, id);
    const again = reviewScenarioState(id);
    assert.notEqual(again, state);
    assert.notEqual(again.draft, state.draft);
    assert.notEqual(again.draft.extras, state.draft.extras);
    assert.notEqual(again.draft.slot, state.draft.slot);
    assert.notEqual(again.draft.place, state.draft.place);
  }
});

test('C013 direct entry: an empty or incomplete draft is sent to its owning step', () => {
  assert.equal(resolveBookingEntryStep(blankBookingDraft(), 6, NOW), 2);
  assert.equal(resolveBookingEntryStep(homeScenarioState('home-empty').draft, 6, NOW), 2);
  assert.equal(
    resolveBookingEntryStep(paymentScenarioState('booking-payment-empty').draft, 6, NOW),
    5,
  );
  const ready = reviewScenarioState('booking-review-cash').draft;
  assert.equal(resolveBookingEntryStep({ ...ready, plate: '!!' }, 6, NOW), 0);
  assert.equal(resolveBookingEntryStep({ ...ready, address: 'ab' }, 6, NOW), 2);
  assert.equal(resolveBookingEntryStep({ ...ready, slot: null }, 6, NOW), 3);
  assert.equal(resolveBookingEntryStep({ ...ready, contactPhone: '12' }, 6, NOW), 4);
  for (const method of ['card', '__proto__', 'constructor', '', null, 1]) {
    assert.equal(resolveBookingEntryStep({ ...ready, paymentMethod: method }, 6, NOW), 5);
  }
});

test('C013 guard: the ordered checks and the explicit clock, including lead time and midnight', () => {
  const ready = reviewScenarioState('booking-review-sham').draft; // 2026-09-21 10:00
  // 10:00 minus the 45-minute lead time: offered up to 09:14, not from 09:15 (Damascus).
  assert.equal(resolveBookingEntryStep(ready, 6, new Date('2026-09-21T06:14:00.000Z')), 6);
  assert.equal(resolveBookingEntryStep(ready, 6, new Date('2026-09-21T06:15:00.000Z')), 3);
  // The excluded demonstration time is never valid.
  const excluded = { ...ready, slot: { date: '2026-09-21', time: '11:00' } };
  assert.equal(resolveBookingEntryStep(excluded, 6, NOW), 3);
  // Service-zone midnight: a late slot today is valid until Damascus midnight, after
  // which its day is no longer offered at all.
  const tonight = {
    ...ready,
    scheduleDay: '2026-09-20',
    slot: { date: '2026-09-20', time: '20:00' },
  };
  assert.equal(resolveBookingEntryStep(tonight, 6, new Date('2026-09-20T16:14:00.000Z')), 6);
  assert.equal(resolveBookingEntryStep(tonight, 6, new Date('2026-09-20T21:00:00.000Z')), 3);
  // A slot five days out enters the offered window only once that day is offered.
  const far = { ...ready, scheduleDay: '2026-09-25', slot: { date: '2026-09-25', time: '09:00' } };
  assert.equal(resolveBookingEntryStep(far, 6, new Date('2026-09-20T20:59:59.000Z')), 3);
  assert.equal(resolveBookingEntryStep(far, 6, new Date('2026-09-20T21:00:00.000Z')), 6);
  // Priority: an invalid plate is reported before everything else broken.
  const broken = { ...ready, plate: '!!', address: '', slot: null, contactName: '' };
  assert.equal(resolveBookingEntryStep(broken, 6, NOW), 0);
});

// -------------------------------------------------------------- summary content

test('C013 summary: source order, labels and values of a standard cash review', () => {
  const state = reviewScenarioState('booking-review-cash');
  const view = buildReviewViewModel(state.draft, state.bookingMode);
  assert.equal(view.eyebrow, '07 / كل شيء واضح');
  assert.equal(view.title, 'غسلتك، مثل ما تحب.');
  assert.equal(view.description, 'كل اختياراتك أمامك. يمكنك تعديل أي تفصيلة.');
  assert.deepEqual(view.vehicle, {
    art: 'suv',
    packageName: 'نظافة متكاملة',
    carLine: 'كروس أوفر',
    plate: null,
  });
  assert.deepEqual(view.care, { packageName: 'نظافة متكاملة', extras: 'بدون إضافات' });
  assert.deepEqual(view.place, {
    label: 'المنزل',
    address: state.draft.address,
    accessNote: 'أمام البوابة',
  });
  assert.deepEqual(view.time, {
    when: `${dateLabel('2026-09-21')} · 10:00 ص`,
    detail: `بتوقيت دمشق · ${illustrativeCost(state.draft).minutes} دقيقة تقريبًا`,
  });
  // The number is shown exactly as typed; Review does not normalise it.
  assert.deepEqual(view.contact, { name: 'ريم التجريبية', phone: '+963 (11) 000-0000' });
  assert.deepEqual(view.payment, {
    icon: 'banknote',
    name: 'كاش بعد الغسيل',
    detail: 'كاش بعد إتمام الغسيل',
  });
  assert.equal(view.technicianNote, 'السيارة بجانب المدخل الخلفي');
  assert.equal(view.paymentNote, 'كاش بعد الغسيل. لا دفع مسبق.');
  assert.equal(view.confirmLabel, 'تأكيد الحجز التجريبي');
});

test('C013 summary: wallet methods use the source wording; the repeat mode its heading', () => {
  for (const id of ['booking-review-sham', 'booking-review-syriatel']) {
    const state = reviewScenarioState(id);
    const view = buildReviewViewModel(state.draft, state.bookingMode);
    assert.equal(view.payment.detail, 'QR بعد المراجعة · التحقق قبل بدء الخدمة');
    assert.equal(view.paymentNote, 'يظهر QR بعد التأكيد. الدفع لا يُعتمد دون مطابقة.');
    assert.equal(view.confirmLabel, 'تأكيد الحجز وعرض QR');
  }
  assert.equal(
    buildReviewViewModel(reviewScenarioState('booking-review-sham').draft, 'standard').payment.icon,
    'wallet',
  );
  assert.equal(
    buildReviewViewModel(reviewScenarioState('booking-review-syriatel').draft, 'standard').payment
      .icon,
    'signal-pay',
  );
  const repeat = reviewScenarioState('booking-review-repeat');
  const view = buildReviewViewModel(repeat.draft, repeat.bookingMode);
  assert.equal(view.title, 'نفس العناية، بموعد جديد.');
  assert.equal(view.description, 'حفظنا سيارتك وخدمتك وعنوانك. راجع الموعد الجديد قبل التأكيد.');
  for (const text of [
    "'07 / كل شيء واضح'",
    "'نفس العناية، بموعد جديد.':'غسلتك، مثل ما تحب.'",
    "'حفظنا سيارتك وخدمتك وعنوانك. راجع الموعد الجديد قبل التأكيد.':'كل اختياراتك أمامك. يمكنك تعديل أي تفصيلة.'",
    "'كاش بعد الغسيل. لا دفع مسبق.':'يظهر QR بعد التأكيد. الدفع لا يُعتمد دون مطابقة.'",
    "'كاش بعد إتمام الغسيل':m?'QR بعد المراجعة · التحقق قبل بدء الخدمة':'لم تحدد بعد'",
    "'تأكيد الحجز التجريبي':'تأكيد الحجز وعرض QR'",
  ]) {
    assert.ok(reference.includes(text), 'reference source: ' + text);
  }
});

test('C013 summary: optional values absent use the approved fallbacks, never errors', () => {
  const state = reviewScenarioState('booking-review-minimal');
  const view = buildReviewViewModel(state.draft, 'standard');
  assert.equal(view.vehicle.carLine, 'سيدان');
  assert.equal(view.vehicle.plate, null);
  assert.equal(view.care.extras, 'بدون إضافات');
  assert.equal(view.place.accessNote, null);
  assert.equal(view.technicianNote, null);
  const unlabeled = buildReviewViewModel({ ...state.draft, addressLabel: '' }, 'standard');
  assert.equal(unlabeled.place.label, 'المكان');
  // A name of spaces only is no name, as the reference's trimmed carName().
  assert.equal(
    buildReviewViewModel({ ...state.draft, carName: '   ' }, 'standard').vehicle.carLine,
    'سيدان',
  );
  for (const text of ['بدون لوحة في هذا النموذج', "'بدون إضافات'", "d.addressLabel||'المكان'"]) {
    assert.ok(reference.includes(text), text);
  }
});

test('C013 summary: present optional values, clean add-ons and the separate notes', () => {
  const state = reviewScenarioState('booking-review-full');
  const view = buildReviewViewModel(state.draft, 'standard');
  assert.equal(view.vehicle.carLine, 'سيارة العائلة · رمادي');
  assert.equal(view.vehicle.plate, '4567 دمشق');
  assert.equal(view.care.extras, 'تنظيف المقاعد، تعطير المقصورة');
  // A draft carrying a duplicate and an add-on the package includes (premium includes
  // wheels) lists each chargeable add-on once, as the reference's cleaned draft would.
  const dirty = { ...state.draft, extras: ['seats', 'wheels', 'seats', 'fresh'] };
  assert.equal(
    buildReviewViewModel(dirty, 'standard').care.extras,
    'تنظيف المقاعد، تعطير المقصورة',
  );
  assert.equal(view.place.accessNote, 'أمام البوابة');
  assert.equal(view.technicianNote, 'السيارة بجانب المدخل الخلفي');
  assert.notEqual(view.place.accessNote, view.technicianNote, 'locationNote and note stay apart');
});

test('C013 summary: long and markup-like values are kept verbatim as text', () => {
  const state = reviewScenarioState('booking-review-long');
  const view = buildReviewViewModel(state.draft, 'standard');
  assert.equal(view.vehicle.carLine, `${state.draft.carName} · أخضر زيتوني <b>غامق</b>`);
  assert.equal(view.place.accessNote, 'المدخل الجانبي <script>alert(1)</script> & "اختبار"');
  assert.equal(view.contact.phone, '٠٩٠٠ ٠٠٠ ٠٠٠');
  assert.equal(view.technicianNote, state.draft.note);
  for (const file of [
    'features/booking/review/ReviewStep.tsx',
    'features/booking/review/reviewViewModel.ts',
    'features/booking/PriceBill.tsx',
  ]) {
    assert.ok(!/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/.test(read(file)), file);
  }
});

// ------------------------------------------------------------ one bill, one source

test('C013 bill: Review, footer and price sheet use one calculation of the current draft', () => {
  for (const id of reviewScenarioIds) {
    const { draft } = reviewScenarioState(id);
    const view = buildReviewViewModel(draft, 'standard');
    const cost = illustrativeCost(draft);
    assert.deepEqual(view.breakdown, buildPriceBreakdown(draft), id);
    assert.equal(view.total, cost.total, id);
    assert.equal(view.breakdown.total, cost.total, id);
    assert.equal(view.minutes, cost.minutes, id);
    const ids = view.breakdown.lines.map((line) => line.id);
    assert.equal(new Set(ids).size, ids.length, id + ': line identities are unique');
  }
  const footer = read('features/booking/BookingFooter.tsx');
  const step = read('features/booking/review/ReviewStep.tsx');
  assert.match(footer, /<PriceBill breakdown=\{breakdown\} \/>/);
  assert.match(step, /<PriceBill breakdown=\{view\.breakdown\} \/>/);
  assert.match(step, /breakdown=\{view\.breakdown\}/);
  assert.match(read('features/booking/PriceBill.tsx'), /key=\{line\.id\}/);
  assert.ok(!/function PriceBill/.test(footer), 'the footer has no private copy of the bill');
});

test('C013 bill: an included or repeated add-on is charged once or not at all', () => {
  const full = reviewScenarioState('booking-review-full').draft;
  const draft = { ...full, extras: ['seats', 'wheels', 'seats', 'fresh'] };
  const lines = buildPriceBreakdown(draft).lines;
  assert.deepEqual(
    lines.map((line) => line.id),
    ['package', 'vehicle', 'extra:seats', 'extra:fresh', 'visit'],
  );
  assert.equal(
    illustrativeCost(draft).total,
    packageFixtures.premium.price +
      vehicleFixtures.large.fee +
      extraFixtures.seats.price +
      extraFixtures.fresh.price,
  );
});

test('C013 price: a payment choice never changes it; vehicle and care change it by the rules', () => {
  const state = reviewScenarioState('booking-review-cash');
  const total = buildReviewViewModel(state.draft, 'standard').total;
  for (const method of ['sham', 'syriatel', 'cash']) {
    const next = selectPaymentMethod(state, method, total);
    const view = buildReviewViewModel(next.draft, 'standard');
    assert.equal(view.total, total);
    assert.equal(view.minutes, illustrativeCost(state.draft).minutes);
  }
  const larger = selectVehicleType(state, 'large', '');
  assert.equal(
    buildReviewViewModel(larger.draft, 'standard').total,
    illustrativeCost(larger.draft).total,
  );
  assert.notEqual(buildReviewViewModel(larger.draft, 'standard').total, total);
  const premium = selectCarePackage(state, 'premium', packageFixtures.premium.includes);
  assert.equal(
    buildReviewViewModel(premium.draft, 'standard').total,
    illustrativeCost(premium.draft).total,
  );
});

test('C013 Review renders the current draft, not a memoised or stored snapshot', () => {
  const state = reviewScenarioState('booking-review-cash');
  const changed = editContactField(state, 'contactName', 'اسم جديد');
  assert.equal(buildReviewViewModel(changed.draft, 'standard').contact.name, 'اسم جديد');
  const step = read('features/booking/review/ReviewStep.tsx');
  assert.match(step, /const view = buildReviewViewModel\(state\.draft, state\.bookingMode\);/);
  assert.ok(!/useMemo|useState|useRef/.test(step), 'no snapshot of the summary is kept');
});

// ----------------------------------------------------------------- edit journeys

test('C013 edit targets: integers 0–5 only; hostile values open nothing', () => {
  assert.deepEqual(REVIEW_EDIT_TARGETS, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(
    REVIEW_EDIT_ACTIONS.map((action) => action.step),
    REVIEW_EDIT_TARGETS,
  );
  const state = reviewScenarioState('booking-review-cash');
  for (const value of [
    6,
    -1,
    1.5,
    NaN,
    Infinity,
    '1',
    '0',
    '',
    null,
    undefined,
    {},
    [],
    '__proto__',
    'constructor',
    true,
  ]) {
    assert.equal(isReviewEditTarget(value), false, String(value));
    const result = openReviewEdit(state, value, NOW);
    assert.equal(result.intent, null, String(value));
    assert.equal(result.state, state, String(value));
  }
});

test('C013 edit: each «تعديل» opens its step in edit mode with the source labels', () => {
  const labels = [
    'تعديل السيارة',
    'تعديل العناية والإضافات',
    'تعديل الموقع',
    'تعديل الموعد',
    'تعديل بيانات التواصل',
    'تعديل طريقة الدفع',
  ];
  assert.deepEqual(
    REVIEW_EDIT_ACTIONS.map((action) => action.label),
    labels,
  );
  const state = reviewScenarioState('booking-review-sham');
  for (const step of REVIEW_EDIT_TARGETS) {
    assert.ok(reference.includes(`data-step="${step}" aria-label="${labels[step]}"`));
    const result = openReviewEdit(state, step, NOW);
    assert.deepEqual(result.intent, { kind: 'booking-step', step });
    assert.equal(result.state.reviewEditing, true);
    assert.equal(result.state.draft, state.draft, 'opening an edit changes no choice');
    assert.equal(decisionNextLabel(step, true), REVIEW_RETURN_LABEL);
    assert.equal(decisionNextLabel(step, false), bookingFlow[step].nextLabel);
  }
  assert.ok(reference.includes("S.editing?'العودة إلى المراجعة'"));
});

test('C013 edit: opening an edit after the appointment expired goes to Time in one step', () => {
  const state = reviewScenarioState('booking-review-cash');
  const later = new Date('2026-09-21T07:00:00.000Z');
  for (const step of [3, 4, 5]) {
    assert.deepEqual(openReviewEdit(state, step, later).intent, { kind: 'booking-step', step: 3 });
  }
  assert.deepEqual(openReviewEdit(state, 1, later).intent, { kind: 'booking-step', step: 1 });
});

/** Each step's real submission, as the step component runs it while editing. */
const submissions = [
  ['vehicle', (s) => submitVehicleStep(s)],
  ['care', (s) => submitCareStep(s)],
  ['location', (s) => submitLocationStep(s)],
  ['time', (s, now) => submitScheduleStep(s, now)],
  ['contact', (s) => submitContactStep(s)],
  ['payment', (s) => submitPaymentStep(s)],
];

test('C013 edit: a valid Next returns straight to Review and leaves edit mode', () => {
  const state = editing(reviewScenarioState('booking-review-syriatel'));
  for (const [name, submit] of submissions) {
    const result = completeReviewEdit(submit(state, NOW), NOW);
    assert.deepEqual(result.intent, { kind: 'booking-step', step: 6 }, name);
    assert.equal(pathForIntent(result.intent), '/book/6');
    assert.equal(result.state.reviewEditing, false, name);
    assert.equal(result.state.draftStep, 6, name);
  }
});

test('C013 edit: an invalid Next is refused on its step and edit mode stays', () => {
  const ready = editing(reviewScenarioState('booking-review-cash'));
  const later = new Date('2026-09-21T07:00:00.000Z');
  const refusals = [
    ['vehicle', submitVehicleStep({ ...ready, draft: { ...ready.draft, plate: '!!' } })],
    ['location', submitLocationStep({ ...ready, draft: { ...ready.draft, address: '' } })],
    ['time', submitScheduleStep(ready, later)],
    ['contact', submitContactStep({ ...ready, draft: { ...ready.draft, contactName: 'x' } })],
    ['payment', submitPaymentStep({ ...ready, draft: { ...ready.draft, paymentMethod: null } })],
  ];
  for (const [name, refused] of refusals) {
    const result = completeReviewEdit(refused, NOW);
    assert.equal(result, refused, name + ': unchanged');
    assert.equal(result.intent, null, name);
    assert.equal(result.state.reviewEditing, true, name);
  }
});

test('C013 edit: a valid edit with another prerequisite broken goes to that step instead', () => {
  const ready = editing(reviewScenarioState('booking-review-cash'));
  const later = new Date('2026-09-21T07:00:00.000Z');
  const result = completeReviewEdit(submitVehicleStep(ready), later);
  assert.deepEqual(result.intent, { kind: 'booking-step', step: 3 });
  assert.equal(result.state.reviewEditing, false);
});

test('C013 ordinary sequential navigation is unchanged outside edit mode', () => {
  const state = reviewScenarioState('booking-review-cash');
  submissions.forEach(([name, submit], index) => {
    const submitted = submit(state, NOW);
    assert.equal(completeReviewEdit(submitted, NOW), submitted, name + ': same object');
    assert.deepEqual(submitted.intent, { kind: 'booking-step', step: index + 1 }, name);
  });
});

test('C013 header Back: an edit returns to Review keeping live changes; Review goes to Payment', () => {
  const state = editing(reviewScenarioState('booking-review-cash'));
  const changed = editContactField(state, 'note', 'ملاحظة معدلة');
  const back = leaveReviewEdit(changed, NOW);
  assert.deepEqual(back.intent, { kind: 'booking-step', step: 6 });
  assert.equal(back.state.reviewEditing, false);
  assert.equal(back.state.draft.note, 'ملاحظة معدلة', 'the reference keeps live edits');
  // Deliberate safety difference: an edit that broke a prerequisite is guarded.
  const broken = editContactField(state, 'contactName', 'x');
  assert.deepEqual(leaveReviewEdit(broken, NOW).intent, { kind: 'booking-step', step: 4 });
  assert.deepEqual(returnToPaymentStep(state).intent, { kind: 'booking-step', step: 5 });
  assert.equal(returnToPaymentStep(state).state, state);
  assert.ok(reference.includes('if(S.editing){S.editing=false;S.step=REVIEW;'));
});

test('C013 edit mode ends at start, resume, repeat, exit and history', () => {
  const state = editing(reviewScenarioState('booking-review-cash'));
  assert.equal(startBooking(state, undefined, NOW).state.reviewEditing, false);
  assert.equal(resumeBooking(state, NOW).state.reviewEditing, false);
  assert.equal(saveDraftAndExit(state).state.reviewEditing, false);
  const home = { ...homeScenarioState('home-repeat-order'), reviewEditing: true };
  assert.equal(repeatOrder(home, home.orders[0].id, NOW).state.reviewEditing, false);
  assert.equal(endReviewEdit(state).reviewEditing, false);
  const plain = reviewScenarioState('booking-review-cash');
  assert.equal(endReviewEdit(plain), plain, 'nothing changes outside edit mode');
  const shell = read('app/CustomerShell.tsx');
  assert.match(shell, /navigationType === 'POP' \|\| !booking/);
  assert.match(shell, /useLayoutEffect/);
});

test('C013 every decision step returns to Review through the one transition', () => {
  for (const file of [
    'features/booking/vehicle/VehicleStep.tsx',
    'features/booking/care/CareStep.tsx',
    'features/booking/location/LocationStep.tsx',
    'features/booking/schedule/ScheduleStep.tsx',
    'features/booking/contact/ContactStep.tsx',
    'features/booking/payment/PaymentStep.tsx',
  ]) {
    const source = read(file);
    assert.match(
      source,
      /completeReviewEdit\(submit\w+Step\(current(?:, tapped)?\), (?:currentInstant\(\)|tapped)\)/,
      file,
    );
    assert.match(source, /nextLabel=\{decisionNextLabel\(\w+, state\.reviewEditing\)\}/, file);
  }
});

// ----------------------------------------------- repeat, invariants, confirmation

test('C013 repeat: the old order is untouched and its payment is not carried as paid', () => {
  const home = homeScenarioState('home-repeat-order');
  const order = home.orders[0];
  const before = JSON.stringify(home.orders);
  const repeated = repeatOrder(home, order.id, NOW);
  assert.equal(pathForIntent(repeated.intent), '/book/6');
  assert.equal(repeated.state.bookingMode, 'repeat');
  assert.notEqual(repeated.state.draft.extras, order.extras, 'no shared add-on list');
  assert.notEqual(repeated.state.draft.slot, order.slot, 'never the finished slot');
  const view = buildReviewViewModel(repeated.state.draft, repeated.state.bookingMode);
  assert.equal(view.title, 'نفس العناية، بموعد جديد.');
  assert.equal(view.paymentNote, 'كاش بعد الغسيل. لا دفع مسبق.', 'a method, not a payment');
  const edited = completeReviewEdit(
    submitCareStep(editing(selectCarePackage(repeated.state, 'premium', ['wheels']))),
    NOW,
  );
  assert.equal(edited.state.bookingMode, 'repeat', 'edited choices stay in the repeat draft');
  assert.equal(edited.state.draft.service, 'premium');
  assert.equal(JSON.stringify(edited.state.orders), before);
  assert.equal(edited.state.orders, home.orders);
});

test('C013 review commands never touch orders, garage, address book or profile', () => {
  const state = editing(reviewScenarioState('booking-review-full'));
  const results = [
    openReviewEdit(state, 2, NOW).state,
    leaveReviewEdit(state, NOW).state,
    returnToPaymentStep(state).state,
    endReviewEdit(state),
    ...submissions.map(([, submit]) => completeReviewEdit(submit(state, NOW), NOW).state),
  ];
  for (const next of results) {
    assert.equal(next.orders, state.orders);
    assert.equal(next.vehicles, state.vehicles);
    assert.equal(next.addresses, state.addresses);
    assert.equal(next.profile, state.profile);
    assert.equal(next.vehicleSequence, state.vehicleSequence);
    assert.equal(next.addressSequence, state.addressSequence);
    assert.equal(next.draft.saveVehicle, state.draft.saveVehicle, 'a preference stays one');
    assert.equal(next.draft.saveAddress, state.draft.saveAddress);
  }
});

test('C013 confirmation stays unavailable: no order, payment, storage or network', () => {
  const step = read('features/booking/review/ReviewStep.tsx');
  assert.match(step, /unavailableReasonId=\{CONFIRMATION_REASON_ID\}/);
  assert.match(
    step,
    /<span id=\{CONFIRMATION_REASON_ID\}>\{CONFIRMATION_UNAVAILABLE_TEXT\}<\/span>/,
  );
  assert.ok(!/onNext=/.test(step), 'Review passes no Next handler');
  assert.equal(
    CONFIRMATION_UNAVAILABLE_TEXT,
    'مسودة تجريبية لهذه الجلسة فقط. تأكيد الحجز غير متاح بعد.',
  );
  assert.ok(!reference.includes(CONFIRMATION_UNAVAILABLE_TEXT), 'a C013 disclosure, not a quote');
  const footer = read('features/booking/BookingFooter.tsx');
  assert.match(
    footer,
    /type="button"\s+disabled\s+aria-describedby=\{unavailableReasonId\}/,
    'native disabled with a described reason',
  );
  const owned = [
    step,
    read('features/booking/review/reviewViewModel.ts'),
    read('state/reviewStep.ts'),
    read('fixtures/customerReviewScenarios.ts'),
  ].join('\n');
  for (const pattern of [
    /confirmOrder|createPayment|saveCar|saveAddress|uid\(/,
    /orders\s*[:=]\s*\[|unshift\(|\.push\(/,
    /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/,
    /localStorage|sessionStorage|indexedDB|document\.cookie/,
    /data:image|<img|QRCode|qrMarkup|canvas/i,
    /new Date\(\)|Date\.now\(/,
    /على جهازك|محفوظ على/,
  ]) {
    assert.ok(!pattern.test(owned), 'C013 owned code must not match ' + pattern);
  }
});

test('C013 accessibility: one H1, native edit buttons with descriptive names, LTR phone', () => {
  const step = read('features/booking/review/ReviewStep.tsx');
  assert.equal(step.match(/<h1\b/g)?.length, 1);
  assert.match(step, /<h1 tabIndex=\{-1\}>/);
  assert.match(step, /className="edit"\s+type="button"\s+aria-label=\{action\.label\}/);
  assert.match(step, /<p className="ltr">\{view\.contact\.phone\}<\/p>/);
  assert.match(step, /<span className="plate-mini" dir="auto">/);
  assert.ok(!/role="button"|<div[^>]*onClick/.test(step), 'native buttons only');
});

// The shared Sheet holds one scroll lock per open sheet (shared/scrollLock.ts). A
// production build does not replay effects, so StrictMode's mount → cleanup → mount
// sequence is exercised here directly on the lock the Sheet uses.
test('C013 shared Sheet lock: close, Escape, unmount, replacement and StrictMode replay', () => {
  const style = { overflow: 'auto' };
  const lock = createScrollLock(() => style);
  const price = {};
  const exit = {};
  // StrictMode: effect (lock), simulated cleanup (release), effect again (lock).
  lock.lock(price);
  lock.release(price);
  assert.equal(style.overflow, 'auto');
  lock.lock(price);
  assert.equal(style.overflow, 'hidden', 'the replayed effect locks again');
  // Normal close or Escape: the close event and the effect cleanup both release.
  lock.release(price);
  lock.release(price);
  assert.equal(style.overflow, 'auto', 'the previous overflow comes back once');
  // Replacement: a late close of the old sheet never unlocks the new one.
  lock.lock(price);
  lock.lock(exit);
  lock.release(price);
  assert.equal(style.overflow, 'hidden');
  // Unmount while open: the cleanup releases the last lock.
  lock.release(exit);
  assert.equal(style.overflow, 'auto');
  // A release without a lock changes nothing.
  style.overflow = 'clip';
  lock.release({});
  assert.equal(style.overflow, 'clip');

  const sheet = read('shared/Sheet.tsx');
  assert.ok(sheet.includes('return () => pageScroll.release(lockOwner);'), 'released on cleanup');
  assert.match(sheet, /const handleClose = \(\) => \{\n\s+pageScroll\.release\(lockOwner\);/);
  assert.ok(!sheet.includes('document.body.style.overflow ='), 'no direct, blanket unlock');
});
