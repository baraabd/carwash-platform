import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  blankBookingDraft,
  isContactNameAcceptable,
  isContactPhoneAcceptable,
  resolveBookingEntryStep,
} from '../../apps/customer-web/src/state/bookingDraft.ts';
import {
  repeatOrder,
  resumeBooking,
  startBooking,
} from '../../apps/customer-web/src/state/bookingEntry.ts';
import {
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_PHONE_MAX_LENGTH,
  DEMO_CONTACT,
  DEMO_CONTACT_NOTICE,
  NAME_REQUIRED_MESSAGE,
  PHONE_REQUIRED_MESSAGE,
  TECHNICIAN_NOTE_MAX_LENGTH,
  editContactField,
  fillDemoContact,
  returnToTimeStep,
  submitContactStep,
  validateContact,
} from '../../apps/customer-web/src/state/contactStep.ts';
import { submitScheduleStep } from '../../apps/customer-web/src/state/scheduleStep.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';
import { illustrativeCost } from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import { addressScenarioState } from '../../apps/customer-web/src/fixtures/customerAddressScenarios.ts';
import {
  contactScenarioIds,
  contactScenarioState,
} from '../../apps/customer-web/src/fixtures/customerContactScenarios.ts';
import { garageScenarioState } from '../../apps/customer-web/src/fixtures/customerGarageScenarios.ts';
import { homeScenarioState } from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import { bookingSteps } from '../../apps/customer-web/src/app/routes.ts';
import { bookingFlow } from '../../apps/customer-web/src/features/booking/bookingFlow.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP_SRC = path.join(ROOT, 'apps/customer-web/src');
const reference = readFileSync(
  path.join(ROOT, 'design/reference/approved/washgo-payments-interactive.html'),
  'utf8',
);
const read = (relative) => readFileSync(path.join(APP_SRC, relative), 'utf8');
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx|css)$/.test(entry.name) ? [target] : [];
  });
}

// The rendering contract's fixed instant: 12:00 in Damascus on 2026-09-20.
const NOW = new Date('2026-09-20T09:00:00.000Z');
const ready = () => contactScenarioState('booking-contact-ready');
const prefilled = () => contactScenarioState('booking-contact-prefilled');
const withContact = (changes, base = ready()) => ({
  ...base,
  draft: { ...base.draft, ...changes },
});

test('C011 flow: contact is the fifth of seven steps, between time and payment', () => {
  assert.deepEqual(bookingFlow[4], { id: 'contact', label: 'بياناتك', nextLabel: 'اختيار الدفع' });
  assert.equal(bookingSteps[4].path, '/book/4');
  assert.equal(bookingSteps.length, 7);
  const fromTime = submitScheduleStep(ready(), NOW);
  assert.equal(pathForIntent(fromTime.intent), '/book/4');
  assert.equal(pathForIntent(returnToTimeStep(ready()).intent), '/book/3');
});

test('C011 model: name, number and technician note are the draft fields', () => {
  const draft = blankBookingDraft();
  assert.equal(draft.contactName, '');
  assert.equal(draft.contactPhone, '');
  assert.equal(draft.note, '');
  assert.equal(CONTACT_NAME_MAX_LENGTH, 60);
  assert.equal(CONTACT_PHONE_MAX_LENGTH, 24);
  assert.equal(TECHNICIAN_NOTE_MAX_LENGTH, 300);
  assert.ok(reference.includes("key==='phone'?24:key==='name'?60:key==='plate'?20:300"));
});

test('C011 name rule: two characters after trimming; no identity rules', () => {
  const cases = [
    ['', false],
    ['   ', false],
    ['س', false],
    [' س ', false],
    ['سا', true],
    ['  سا  ', true],
    ['Al', true],
    ['سامر Sam', true],
    ['12', true],
    ['ع'.repeat(60), true],
  ];
  for (const [name, ok] of cases)
    assert.equal(isContactNameAcceptable(name), ok, JSON.stringify(name));
  assert.ok(
    reference.includes("if(str(d.name).length<2)errors.name='أدخل اسمًا من حرفين على الأقل.'"),
  );
});

test('C011 phone rule: optional plus and 8-15 digits after the approved clean-up', () => {
  const cases = [
    ['', false],
    ['1234567', false],
    ['12345678', true],
    ['123456789012345', true],
    ['1234567890123456', false],
    ['+12345678', true],
    ['+123456789012345', true],
    ['0900000000', true],
    ['0912 345 678', true],
    ['+963 (11) 000-0000', true],
    ['(0912) 345-678', true],
    ['٠٩١٢٣٤٥٦٧٨', true],
    ['۰۹۱۲۳۴۵۶۷۸', true],
    ['٠٩١٢-٣٤٥-۶۷۸', true],
    ['0912abc678', false],
    ['0912+345678', false],
    ['++963912345678', false],
    ['+', false],
    ['0912.345.678', false],
    ['0912\t345678', true],
  ];
  for (const [phone, ok] of cases) {
    assert.equal(isContactPhoneAcceptable(phone), ok, JSON.stringify(phone));
  }
  assert.ok(
    reference.includes(
      "function phoneOK(value){return /^\\+?\\d{8,15}$/.test(digits(value).replace(/[\\s()-]/g,''));}",
    ),
  );
});

test('C011 typing: values are stored as typed, only capped', () => {
  let state = editContactField(ready(), 'contactName', '  Sam سامر  ');
  assert.equal(state.draft.contactName, '  Sam سامر  ', 'not trimmed while typing');
  state = editContactField(state, 'contactPhone', '٠٩١٢ (345) 678');
  assert.equal(state.draft.contactPhone, '٠٩١٢ (345) 678', 'digits and formatting kept');
  state = editContactField(state, 'contactName', 'ع'.repeat(70));
  assert.equal(state.draft.contactName.length, 60);
  state = editContactField(state, 'contactPhone', '1'.repeat(30));
  assert.equal(state.draft.contactPhone.length, 24, 'the raw value is capped at 24 characters');
  state = editContactField(state, 'note', 'سطر\nسطر\n' + 'م'.repeat(400));
  assert.equal(state.draft.note.length, 300);
  assert.ok(state.draft.note.startsWith('سطر\nسطر\n'), 'newlines are kept');
  assert.equal(state.draft.touched, true);
});

test('C011 typing: only the three contact fields can be edited', () => {
  const state = ready();
  for (const field of [
    'address',
    'locationNote',
    'slot',
    'paymentMethod',
    '__proto__',
    'constructor',
  ]) {
    assert.equal(editContactField(state, field, 'x'), state, field);
  }
});

test('C011 technician note and address access note are independent', () => {
  const base = prefilled();
  const noted = editContactField(base, 'note', 'ملاحظة للفني فقط');
  assert.equal(noted.draft.note, 'ملاحظة للفني فقط');
  assert.equal(noted.draft.locationNote, base.draft.locationNote, 'the access note is untouched');
  assert.equal(base.draft.locationNote, 'أمام البوابة');
});

test('C011 validation: both messages in source order; corrected values pass', () => {
  assert.deepEqual(validateContact(ready().draft), {
    contactName: NAME_REQUIRED_MESSAGE,
    contactPhone: PHONE_REQUIRED_MESSAGE,
  });
  assert.deepEqual(validateContact({ contactName: 'سامر', contactPhone: '123' }), {
    contactName: null,
    contactPhone: PHONE_REQUIRED_MESSAGE,
  });
  assert.deepEqual(validateContact(prefilled().draft), { contactName: null, contactPhone: null });
  for (const text of [NAME_REQUIRED_MESSAGE, PHONE_REQUIRED_MESSAGE])
    assert.ok(reference.includes(text));
});

test('C011 Next: refused with the first invalid field; values are kept as typed', () => {
  const before = ready();
  const both = submitContactStep(before);
  assert.equal(both.intent, null);
  assert.equal(both.firstInvalid, 'contactName');
  assert.equal(both.state.announcement.message, NAME_REQUIRED_MESSAGE);
  assert.equal(both.state.draft, before.draft, 'a refused Next leaves the draft as it was');
  const phoneOnly = submitContactStep(withContact({ contactName: '  ريم ', contactPhone: '12' }));
  assert.equal(phoneOnly.firstInvalid, 'contactPhone');
  assert.equal(phoneOnly.state.draft.contactName, '  ريم ', 'nothing is trimmed on refusal');
  assert.equal(phoneOnly.state.draftStep, 4);
});

test('C011 Next: valid details go to payment without normalising or saving anything', () => {
  const state = withContact({ contactName: '  ريم ', contactPhone: '+963 (11) 000-0000' });
  const result = submitContactStep(state);
  assert.equal(pathForIntent(result.intent), '/book/5');
  assert.equal(result.state.draftStep, 5);
  assert.equal(result.state.draft.contactName, '  ريم ');
  assert.equal(result.state.draft.contactPhone, '+963 (11) 000-0000');
  assert.equal(result.state.profile, state.profile, 'the account profile is not written');
  assert.equal(result.state.orders, state.orders, 'no order is created');
});

test('C011 demo fill: the reference sample, a notice, nothing else changes', () => {
  const base = editContactField(prefilled(), 'note', 'ملاحظتي');
  const filled = fillDemoContact(base);
  assert.equal(filled.draft.contactName, 'سامر التجريبي');
  assert.equal(filled.draft.contactPhone, '0900000000');
  assert.deepEqual(DEMO_CONTACT, { contactName: 'سامر التجريبي', contactPhone: '0900000000' });
  assert.equal(filled.notice.message, DEMO_CONTACT_NOTICE);
  for (const key of [
    'note',
    'locationNote',
    'slot',
    'scheduleDay',
    'vehicleType',
    'service',
    'extras',
    'address',
    'paymentMethod',
  ]) {
    assert.deepEqual(filled.draft[key], base.draft[key], key);
  }
  assert.equal(filled.profile, base.profile);
  assert.ok(
    reference.includes("S.draft.name='سامر التجريبي';S.draft.phone='0900000000';errors={}"),
  );
  assert.ok(reference.includes(DEMO_CONTACT_NOTICE));
});

test('C011 prefill: start fills empty contact from the profile, never over typed values', () => {
  const profiled = { ...homeScenarioState('home-returning-customer') };
  const started = startBooking(
    { ...profiled, draft: { ...blankBookingDraft() } },
    undefined,
    NOW,
  ).state;
  assert.equal(started.draft.contactName, 'سامر');
  assert.equal(started.draft.contactPhone, '0900000000');
  const typed = {
    ...profiled,
    draft: { ...blankBookingDraft(), contactName: 'ريم', contactPhone: '0911111111' },
  };
  const kept = startBooking(typed, undefined, NOW).state;
  assert.equal(kept.draft.contactName, 'ريم');
  assert.equal(kept.draft.contactPhone, '0911111111');
  assert.ok(
    reference.includes('if(!d.name)d.name=S.profile.name;if(!d.phone)d.phone=S.profile.phone;'),
  );
});

test('C011 repeat: the draft owns copied contact details; the order is unchanged', () => {
  const state = homeScenarioState('home-repeat-order');
  const orders = globalThis.structuredClone(state.orders);
  const repeated = repeatOrder(state, 'WG-DEMO-DONE', NOW).state;
  assert.equal(repeated.draft.contactName, state.orders[0].contactName);
  const edited = editContactField(repeated, 'contactName', 'اسم جديد');
  assert.deepEqual(edited.orders, orders, 'the past order keeps its own contact');
});

test('C011 guard: earlier steps first, then valid contact details', () => {
  const complete = { ...prefilled().draft, paymentMethod: 'cash' };
  assert.equal(resolveBookingEntryStep(complete, 6, NOW), 6);
  assert.equal(resolveBookingEntryStep({ ...complete, contactName: 'س' }, 6, NOW), 4);
  assert.equal(resolveBookingEntryStep({ ...complete, contactPhone: '12' }, 6, NOW), 4);
  // Valid contact details never bypass a missing address or an expired appointment.
  assert.equal(resolveBookingEntryStep({ ...complete, address: '' }, 6, NOW), 2);
  assert.equal(resolveBookingEntryStep({ ...complete, slot: null }, 6, NOW), 3);
  assert.equal(
    resolveBookingEntryStep(complete, 6, new Date('2026-09-21T07:00:00.000Z')),
    3,
    '10:00 on the 21st is no longer offered at 10:00',
  );
  const resumed = resumeBooking({ ...prefilled(), draftStep: 5 }, NOW);
  assert.equal(resumed.intent.step, 5);
  const blankContact = resumeBooking({ ...ready(), draftStep: 5 }, NOW);
  assert.equal(blankContact.intent.step, 4, 'resume stops at contact while details are missing');
});

test('C011 nothing else changes: price, duration, slot, place, garage, address book', () => {
  const base = {
    ...prefilled(),
    vehicles: garageScenarioState('garage-three-vehicles').vehicles,
    addresses: addressScenarioState('addresses-three').addresses,
  };
  let state = editContactField(base, 'contactName', 'اسم');
  state = editContactField(state, 'contactPhone', '0911111111');
  state = editContactField(state, 'note', 'ملاحظة');
  state = fillDemoContact(state);
  state = submitContactStep(state).state;
  assert.deepEqual(illustrativeCost(state.draft), illustrativeCost(base.draft));
  for (const key of [
    'slot',
    'scheduleDay',
    'address',
    'addressLabel',
    'locationNote',
    'place',
    'vehicleType',
    'service',
    'extras',
    'paymentMethod',
  ]) {
    assert.deepEqual(state.draft[key], base.draft[key], key);
  }
  assert.equal(state.vehicles, base.vehicles);
  assert.equal(state.addresses, base.addresses);
  assert.equal(state.profile, base.profile);
  assert.equal(state.orders, base.orders);
  assert.equal(state.showAllTimes, base.showAllTimes, 'the time step presentation is untouched');
});

test('C011 scenarios: synthetic, deterministic, allowlisted', () => {
  assert.deepEqual(contactScenarioIds, [
    'booking-contact-ready',
    'booking-contact-prefilled',
    'booking-contact-long',
  ]);
  for (const id of contactScenarioIds) {
    assert.deepEqual(initialSessionState(`#/book/4?scenario=${id}`), contactScenarioState(id));
    const { draft } = contactScenarioState(id);
    assert.ok(draft.contactName.length <= 60 && draft.note.length <= 300, id);
    assert.equal(resolveBookingEntryStep(draft, 4, NOW), 4, `${id} reaches the contact step`);
  }
  for (const hostile of ['__proto__', 'constructor', 'booking-contact-unknown']) {
    assert.deepEqual(
      initialSessionState(`#/book/4?scenario=${hostile}`),
      homeScenarioState('home-empty'),
    );
  }
});

test('C011 copy: approved strings of the step are present', () => {
  const port = read('features/booking/contact/ContactStep.tsx') + read('state/contactStep.ts');
  for (const text of [
    '05 / نتعرّف عليك',
    'بأي اسم نستقبلك؟',
    'بيانات بسيطة، دون كلمة مرور أو إنشاء حساب.',
    'مثال: سامر',
    'رقم التواصل',
    '09XX XXX XXX',
    'استخدم بيانات تجريبية، لا تُرسل رسالة تحقق.',
    'ملء تجريبي',
    'ملاحظة للفني',
    'اختياري',
    'مثال: السيارة بجانب المدخل الخلفي',
    'يُحفظ الحجز في هذا المتصفح فقط. لا تدخل أرقام بطاقات أو بيانات حساسة.',
  ]) {
    assert.ok(reference.includes(text), `reference contains "${text}"`);
    assert.ok(port.includes(text), `the port contains "${text}"`);
  }
});

test('C011 architecture: one rule source, pure state, no verification, storage or network', () => {
  const draftSource = withoutComments(read('state/bookingDraft.ts'));
  assert.equal(draftSource.match(/\^\\\+\?\\d\{8,15\}\$/g).length, 1, 'one phone regex');
  const contact = withoutComments(read('state/contactStep.ts'));
  assert.ok(/isContactNameAcceptable/.test(contact) && /isContactPhoneAcceptable/.test(contact));
  assert.ok(
    !/\\d\{8,15\}/.test(contact),
    'the step reuses the draft rule instead of its own regex',
  );
  assert.ok(!/from 'react|window\.|document\.|navigator\./.test(contact));
  for (const specifier of read('state/contactStep.ts').matchAll(/from '([^']+)'/g)) {
    assert.match(specifier[1], /^\.\/[\w]+\.ts$/);
  }
  const owned = withoutComments(
    [
      read('state/contactStep.ts'),
      read('features/booking/contact/ContactStep.tsx'),
      read('fixtures/customerContactScenarios.ts'),
    ].join('\n'),
  );
  for (const pattern of [
    /fetch\(/,
    /XMLHttpRequest/,
    /sendBeacon/,
    /WebSocket/,
    /localStorage|sessionStorage|indexedDB|document\.cookie/,
    /console\./,
    /https?:\/\//,
    /tel:|sms:|mailto:|whatsapp/i,
    /verif(y|ied)\s*[:=(]/i,
    /new Date|Date\.now/,
  ]) {
    assert.ok(!pattern.test(owned), `C011 code must not match ${pattern}`);
  }
  const component = read('features/booking/contact/ContactStep.tsx');
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(component));
  assert.match(component, /type=\{tel \? 'tel' : 'text'\}/);
  assert.match(component, /inputMode=\{tel \? 'tel' : undefined\}/);
  assert.ok(!/type="number"/.test(component), 'never a number input for a phone');
  assert.match(component, /<details className="optional-details"/);
  const route = read('features/booking/index.tsx');
  assert.match(route, /if \(step === 'contact'\) return <ContactStep \/>;/);
  assert.ok(!/step === 'payment'/.test(route), 'payment (C012) is not ported');
  const clockReaders = sourceFiles(APP_SRC).filter((file) =>
    /new Date\(\)|Date\.now\(/.test(readFileSync(file, 'utf8')),
  );
  assert.equal(clockReaders.length, 1, 'C011 adds no clock read');
});
