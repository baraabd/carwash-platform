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
  ADDRESS_TOO_SHORT_MESSAGE,
  addressSheetValuesForDraft,
  applyAddressSheet,
  applyGeolocationOutcome,
  setSheetMapPoint,
  submitLocationStep,
} from '../../apps/customer-web/src/state/locationStep.ts';
import {
  ADDRESS_BOOK_CAPACITY,
  ADDRESS_BOOK_FULL_NOTICE,
  ADDRESS_DELETED_NOTICE,
  ADDRESS_SAVED_NOTICE,
  applySavedAddressToSheet,
  blankAddressEditorValues,
  chooseSavedAddress,
  deleteSavedAddress,
  editorValuesForAddress,
  prefillAddressFromBook,
  saveAddressRecord,
  submitAccountAddress,
} from '../../apps/customer-web/src/state/savedAddresses.ts';
import { saveDraftAndExit } from '../../apps/customer-web/src/state/vehicleStep.ts';
import { illustrativeCost } from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import {
  addressScenarioIds,
  addressScenarioState,
} from '../../apps/customer-web/src/fixtures/customerAddressScenarios.ts';
import { garageScenarioState } from '../../apps/customer-web/src/fixtures/customerGarageScenarios.ts';
import { homeScenarioState } from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import { bookingSteps } from '../../apps/customer-web/src/app/routes.ts';
import {
  buildAccountViewModel,
  buildAddressBookItems,
} from '../../apps/customer-web/src/features/account/accountViewModel.ts';
import { bookingFlow } from '../../apps/customer-web/src/features/booking/bookingFlow.ts';
import { buildLocationStepViewModel } from '../../apps/customer-web/src/features/booking/location/locationViewModel.ts';

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
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const accountFiles = sourceFiles(path.join(APP_SRC, 'features/account'));
const editorFiles = sourceFiles(path.join(APP_SRC, 'widgets/address-editor'));
const c009Files = [
  ...accountFiles,
  ...editorFiles,
  path.join(APP_SRC, 'state/savedAddresses.ts'),
  path.join(APP_SRC, 'fixtures/customerAddressScenarios.ts'),
];
const c009Code = withoutComments(readAll(c009Files.filter((file) => !file.endsWith('.css'))));
const clone = (value) => globalThis.structuredClone(value);

const empty = () => homeScenarioState('home-empty');
const one = () => addressScenarioState('addresses-one');
const three = () => addressScenarioState('addresses-three');
const full = () => addressScenarioState('addresses-full');
const typed = (address, more = {}) => ({ ...blankAddressEditorValues(), address, ...more });
const ids = (state) => state.addresses.map((record) => record.id);
const labels = (state) => state.addresses.map((record) => record.label);

test('C009 model: the session holds an address book and a deterministic id sequence', () => {
  const state = empty();
  assert.deepEqual(state.addresses, []);
  assert.equal(state.addressSequence, 0);
  assert.deepEqual(Object.keys(one().addresses[0]).sort(), [
    'address',
    'id',
    'label',
    'locationNote',
    'place',
  ]);
  assert.equal(ADDRESS_BOOK_CAPACITY, 20);
  assert.ok(reference.includes('S.addresses.length>=20'));
});

test('C009 scenarios: empty, one, three and full books; selectable and synthetic', () => {
  assert.deepEqual(addressScenarioIds, [
    'addresses-one',
    'addresses-three',
    'addresses-full',
    'addresses-draft-from-book',
  ]);
  assert.equal(one().addresses.length, 1);
  assert.equal(three().addresses.length, 3);
  assert.equal(full().addresses.length, 20);
  for (const id of addressScenarioIds) {
    const state = addressScenarioState(id);
    assert.deepEqual(initialSessionState(`#/account?scenario=${id}`), state);
    assert.notEqual(addressScenarioState(id), state, 'a fresh object each time');
    assert.equal(new Set(ids(state)).size, state.addresses.length, 'ids are unique');
    assert.equal(state.addressSequence, state.addresses.length);
    for (const record of state.addresses) {
      assert.ok(/تجريبي|توضيحي/.test(record.address), `${record.id} is a sample address`);
      if (record.place) {
        assert.deepEqual(Object.keys(record.place).sort(), ['kind', 'label', 'x', 'y']);
        assert.ok(Number.isInteger(record.place.x) && Number.isInteger(record.place.y));
      }
    }
  }
  for (const hostile of ['__proto__', 'constructor', 'toString', 'addresses-unknown']) {
    assert.deepEqual(initialSessionState(`#/account?scenario=${hostile}`), empty());
  }
  assert.ok(!/\d{1,3}\.\d{3,}/.test(read('fixtures/customerAddressScenarios.ts')));
});

test('C009 add: a valid address is appended with the next id and confirmed', () => {
  const before = one();
  const result = submitAccountAddress(
    before,
    typed('  دمشق، عنوان جديد  ', { addressLabel: ' العمل ', locationNote: ' الباب الخلفي ' }),
    null,
  );
  assert.equal(result.error, null);
  assert.equal(result.outcome, 'added');
  assert.deepEqual(ids(result.state), ['ADR-1', 'ADR-2']);
  assert.deepEqual(result.state.addresses[1], {
    id: 'ADR-2',
    label: 'العمل',
    address: 'دمشق، عنوان جديد',
    locationNote: 'الباب الخلفي',
    place: { kind: 'manual', x: 350, y: 250, label: 'عنوان يدوي' },
  });
  assert.equal(result.state.addressSequence, 2);
  assert.equal(result.state.notice.message, ADDRESS_SAVED_NOTICE);
  assert.equal(before.addresses.length, 1, 'the previous state is not mutated');
  assert.ok(reference.includes(ADDRESS_SAVED_NOTICE));
});

test('C009 add: ids never reuse a deleted record number', () => {
  let state = three();
  state = deleteSavedAddress(state, 'ADR-3');
  state = submitAccountAddress(state, typed('دمشق، عنوان بعد الحذف'), null).state;
  assert.deepEqual(ids(state), ['ADR-1', 'ADR-2', 'ADR-4']);
});

test('C009 validation: a short address is refused and nothing changes', () => {
  for (const address of ['', 'abc', '   ab   ']) {
    const state = one();
    const result = submitAccountAddress(state, typed(address), null);
    assert.equal(result.error, ADDRESS_TOO_SHORT_MESSAGE);
    assert.equal(result.outcome, null);
    assert.equal(result.state, state, 'the session is untouched');
  }
});

test('C009 bounds and fallbacks: form label fallback and helper label fallback differ', () => {
  const saved = submitAccountAddress(
    empty(),
    typed('ع'.repeat(200), { addressLabel: '   ', locationNote: 'م'.repeat(200) }),
    null,
  ).state.addresses[0];
  assert.equal(saved.address, 'ع'.repeat(160));
  assert.equal(saved.locationNote, 'م'.repeat(160));
  assert.equal(saved.label, 'مكان الغسيل', 'the form turns an empty label into its fallback');
  const long = submitAccountAddress(
    empty(),
    typed('عنوان واضح', { addressLabel: 'ل'.repeat(60) }),
    null,
  );
  assert.equal(long.state.addresses[0].label, 'ل'.repeat(30));

  // The save helper itself (used later by booking confirmation) has its own fallback.
  const direct = saveAddressRecord(
    empty(),
    { address: 'عنوان واضح', addressLabel: '', locationNote: '', place: null },
    null,
  );
  assert.equal(direct.state.addresses[0].label, 'عنوان محفوظ');
  assert.equal(direct.state.addresses[0].place, null);
  assert.ok(reference.includes("||'عنوان محفوظ'") && reference.includes("||'مكان الغسيل'"));
});

test('C009 edit: the record keeps its id and position; label, note and place change', () => {
  const before = three();
  const values = {
    ...editorValuesForAddress(before.addresses[1]),
    addressLabel: 'المكتب',
    locationNote: '',
  };
  const moved = setSheetMapPoint(values, 100, 120).values;
  const result = submitAccountAddress(before, { ...moved, address: 'دمشق، عنوان معدّل' }, 'ADR-2');
  assert.equal(result.outcome, 'updated');
  assert.deepEqual(ids(result.state), ['ADR-1', 'ADR-2', 'ADR-3']);
  assert.deepEqual(result.state.addresses[1], {
    id: 'ADR-2',
    label: 'المكتب',
    address: 'دمشق، عنوان معدّل',
    locationNote: '',
    place: { kind: 'map', x: 100, y: 120, label: 'نقطة مختارة على الخريطة التوضيحية' },
  });
  assert.equal(result.state.addresses[0], before.addresses[0], 'other records are untouched');
  assert.equal(result.state.addressSequence, 3, 'an update consumes no id');
});

test('C009 cancel: editing a copy and discarding it leaves the record as it was', () => {
  const state = three();
  const snapshot = clone(state);
  const values = editorValuesForAddress(state.addresses[1]);
  const changed = setSheetMapPoint({ ...values, address: 'x', addressLabel: 'y' }, 10, 10).values;
  assert.equal(changed.place.x, 20);
  assert.deepEqual(state, snapshot);
  assert.notEqual(values.place, state.addresses[1].place, 'the editor holds a copy of the place');
});

test('C009 duplicate: adding an existing address updates that record instead of inserting', () => {
  const before = three();
  const result = submitAccountAddress(
    before,
    typed('  دمشق، المزة، شارع تجريبي 12 ', { addressLabel: 'منزل محدّث' }),
    null,
  );
  assert.equal(result.outcome, 'updated');
  assert.deepEqual(ids(result.state), ['ADR-1', 'ADR-2', 'ADR-3']);
  assert.equal(result.state.addresses[0].label, 'منزل محدّث');
  assert.equal(result.state.addressSequence, 3);
});

test('C009 collision: editing one record to another address is ID-first and merges nothing', () => {
  const before = three();
  const values = {
    ...editorValuesForAddress(before.addresses[1]),
    address: before.addresses[0].address,
  };
  const result = submitAccountAddress(before, values, 'ADR-2');
  assert.equal(result.outcome, 'updated');
  assert.deepEqual(ids(result.state), ['ADR-1', 'ADR-2', 'ADR-3'], 'no record is removed');
  assert.equal(result.state.addresses[1].address, before.addresses[0].address);
  assert.equal(result.state.addresses[0], before.addresses[0], 'the other record is untouched');
  assert.ok(
    reference.includes(
      'S.addresses.find(x=>x.id===id)||S.addresses.find(x=>x.address===str(data.address))',
    ),
  );
});

test('C009 capacity: the 21st address is refused, state is unchanged, no success notice', () => {
  const before = full();
  const result = submitAccountAddress(before, typed('دمشق، العنوان الحادي والعشرون'), null);
  assert.equal(result.error, null);
  assert.equal(result.outcome, 'capacity');
  assert.equal(result.state.addresses, before.addresses);
  assert.equal(result.state.addressSequence, 20);
  assert.equal(result.state.notice.message, ADDRESS_BOOK_FULL_NOTICE);
  assert.notEqual(result.state.notice.message, ADDRESS_SAVED_NOTICE);
  assert.ok(reference.includes(ADDRESS_BOOK_FULL_NOTICE));
  assert.deepEqual(saveAddressRecord(before, typed('عنوان آخر جديد'), null), {
    state: before,
    outcome: 'capacity',
  });
});

test('C009 capacity: updating and duplicate-matching still work in a full book', () => {
  const before = full();
  const edited = submitAccountAddress(
    before,
    typed('دمشق، شارع معدّل', { addressLabel: 'خمسة' }),
    'ADR-5',
  );
  assert.equal(edited.outcome, 'updated');
  assert.equal(edited.state.addresses.length, 20);
  assert.equal(edited.state.addresses[4].label, 'خمسة');
  const duplicate = submitAccountAddress(before, typed('دمشق، شارع توضيحي 7'), null);
  assert.equal(duplicate.outcome, 'updated');
  assert.equal(duplicate.state.addresses[6].id, 'ADR-7');
});

test('C009 unknown ids: a stale target edits, deletes and selects nothing', () => {
  const state = three();
  const stale = submitAccountAddress(state, typed('دمشق، عنوان من محرّر قديم'), 'ADR-99');
  assert.equal(stale.outcome, 'missing');
  assert.equal(stale.state, state, 'no record is edited or added');
  assert.equal(deleteSavedAddress(state, 'ADR-99'), state);
  assert.equal(chooseSavedAddress(state, 'ADR-99'), state);
  for (const hostile of ['__proto__', 'constructor', '', '0']) {
    assert.equal(deleteSavedAddress(state, hostile), state);
    assert.equal(chooseSavedAddress(state, hostile), state);
  }
});

test('C009 delete: removes exactly that record, keeps order, confirms; last one empties', () => {
  const before = three();
  const after = deleteSavedAddress(before, 'ADR-2');
  assert.deepEqual(ids(after), ['ADR-1', 'ADR-3']);
  assert.equal(after.notice.message, ADDRESS_DELETED_NOTICE);
  assert.equal(before.addresses.length, 3);
  const emptied = deleteSavedAddress(one(), 'ADR-1');
  assert.deepEqual(emptied.addresses, []);
  assert.deepEqual(buildAddressBookItems(emptied), []);
  assert.ok(reference.includes(ADDRESS_DELETED_NOTICE));
});

test('C009 independence: account edits and deletes never rewrite a draft or an order', () => {
  const base = addressScenarioState('addresses-draft-from-book');
  const withOrder = { ...base, orders: homeScenarioState('home-repeat-order').orders };
  const draft = clone(withOrder.draft);
  const orders = clone(withOrder.orders);
  const values = { ...editorValuesForAddress(withOrder.addresses[1]), address: 'دمشق، عنوان آخر' };
  const edited = submitAccountAddress(withOrder, values, 'ADR-2').state;
  const deleted = deleteSavedAddress(edited, 'ADR-2');
  for (const state of [edited, deleted]) {
    assert.deepEqual(state.draft, draft, 'the draft keeps the address it copied');
    assert.deepEqual(state.orders, orders, 'past orders keep their own address');
  }
});

test('C009 independence: record, draft and editor never share a place object', () => {
  const state = three();
  const record = state.addresses[1];
  const chosen = chooseSavedAddress(state, 'ADR-2');
  assert.deepEqual(chosen.draft.place, record.place);
  assert.notEqual(chosen.draft.place, record.place);
  const sheet = applySavedAddressToSheet(addressSheetValuesForDraft(state.draft), record);
  assert.notEqual(sheet.place, record.place);
  const saved = submitAccountAddress(empty(), { ...sheet }, null).state.addresses[0];
  assert.deepEqual(saved.place, sheet.place);
  assert.notEqual(saved.place, sheet.place);
});

test('C009 step chip: copies the address into the draft and nothing else happens', () => {
  const before = {
    ...three(),
    draft: {
      ...blankBookingDraft(),
      vehicleType: 'suv',
      service: 'premium',
      extras: ['seats'],
      saveAddress: false,
    },
  };
  const after = chooseSavedAddress(before, 'ADR-2');
  const record = before.addresses[1];
  assert.equal(after.draft.address, record.address);
  assert.equal(after.draft.addressLabel, record.label);
  assert.equal(after.draft.locationNote, record.locationNote);
  assert.equal(after.draft.touched, true);
  assert.equal(after.draft.saveAddress, false, 'the save preference is left as it was');
  assert.equal(after.addresses, before.addresses, 'no record is saved');
  assert.equal(after.orders, before.orders, 'no order is created');
  assert.equal(after.vehicles, before.vehicles);
  assert.equal(after.draftStep, before.draftStep, 'the step does not advance');
  assert.equal(after.notice, before.notice, 'no notice, as in the reference');
  for (const key of ['vehicleType', 'service', 'extras', 'plate', 'slot', 'paymentMethod']) {
    assert.deepEqual(after.draft[key], before.draft[key], key);
  }
  assert.deepEqual(illustrativeCost(after.draft), illustrativeCost(before.draft));
  assert.equal(chooseSavedAddress(before, 'ADR-3').draft.place, null, 'a record without a pin');
});

test('C009 step chips: selection compares address text, not a stored id', () => {
  assert.deepEqual(buildLocationStepViewModel(empty()).savedChoices, []);
  const view = buildLocationStepViewModel(addressScenarioState('addresses-draft-from-book'));
  assert.deepEqual(
    view.savedChoices.map((choice) => [choice.id, choice.selected]),
    [
      ['ADR-1', false],
      ['ADR-2', true],
      ['ADR-3', false],
    ],
  );
  // Typing the same address by hand marks the chip too; changing it unmarks it.
  const state = three();
  const typedSame = { ...state, draft: { ...state.draft, address: state.addresses[0].address } };
  assert.equal(buildLocationStepViewModel(typedSame).savedChoices[0].selected, true);
  assert.ok(!('addressId' in blankBookingDraft()), 'the draft stores no selected-address id');
  assert.ok(reference.includes("d.address===a.address?'selected':''"));
});

test('C009 editor chip: fills the temporary values only and keeps the save preference', () => {
  const state = three();
  const snapshot = clone(state);
  const open = { ...addressSheetValuesForDraft(state.draft), saveAddress: false };
  const filled = applySavedAddressToSheet(open, state.addresses[1]);
  assert.equal(filled.address, state.addresses[1].address);
  assert.equal(filled.addressLabel, 'مكتب الشركة');
  assert.equal(filled.locationNote, state.addresses[1].locationNote);
  assert.deepEqual(filled.place, state.addresses[1].place);
  assert.equal(filled.saveAddress, false);
  assert.deepEqual(state, snapshot, 'the draft and the book are untouched until Apply');
  const applied = applyAddressSheet(state, filled).state;
  assert.equal(applied.draft.address, state.addresses[1].address);
  assert.equal(applied.addresses, state.addresses);
});

test('C009 save preference: Apply, Next, Exit and Resume never save an address', () => {
  let state = one();
  state = applyAddressSheet(state, {
    ...addressSheetValuesForDraft(state.draft),
    address: 'دمشق، عنوان الحجز فقط',
    saveAddress: true,
  }).state;
  assert.equal(state.draft.saveAddress, true);
  const book = state.addresses;
  const steps = [
    submitLocationStep(state).state,
    saveDraftAndExit(state).state,
    resumeBooking(state).state,
    startBooking(state).state,
  ];
  for (const next of steps) assert.equal(next.addresses, book);
  const callers = sourceFiles(APP_SRC).filter((file) =>
    /saveAddressRecord\(/.test(withoutComments(readFileSync(file, 'utf8'))),
  );
  assert.deepEqual(
    callers.map((file) => path.relative(APP_SRC, file).replaceAll('\\', '/')),
    ['state/savedAddresses.ts'],
    'the save rule is called only by the account command; confirmation is a later sprint',
  );
});

test('C009 prefill: starting a booking uses the first saved address only for an empty draft', () => {
  const started = startBooking(three()).state;
  assert.equal(started.draft.address, 'دمشق، المزة، شارع تجريبي 12');
  assert.equal(started.draft.addressLabel, 'المنزل');
  assert.notEqual(started.draft.place, three().addresses[0].place);
  assert.deepEqual(started.draft.place, three().addresses[0].place);
  assert.equal(started.addresses.length, 3, 'prefill saves nothing');

  const written = addressScenarioState('addresses-draft-from-book');
  assert.equal(startBooking(written).state.draft.address, written.draft.address);
  assert.equal(prefillAddressFromBook(written.draft, written.addresses), written.draft);
  assert.equal(startBooking(empty()).state.draft.address, '', 'an empty book prefills nothing');

  // Resume and repeat never prefill.
  const resumable = { ...three(), draft: { ...blankBookingDraft(), touched: true } };
  assert.equal(resumeBooking(resumable).state.draft.address, '');
  const repeat = { ...homeScenarioState('home-repeat-order'), addresses: three().addresses };
  const repeated = repeatOrder(repeat, repeat.orders[0].id).state;
  assert.equal(repeated.draft.address, repeat.orders[0].address);
  assert.ok(reference.includes('if(!d.address&&S.addresses.length)'));
});

test('C009 prefill: is a start command, not something a view or a route visit does', () => {
  const users = sourceFiles(APP_SRC).filter((file) =>
    /prefillAddressFromBook\(/.test(withoutComments(readFileSync(file, 'utf8'))),
  );
  assert.deepEqual(users.map((file) => path.relative(APP_SRC, file).replaceAll('\\', '/')).sort(), [
    'state/bookingEntry.ts',
    'state/savedAddresses.ts',
  ]);
});

test('C009 garage, packages and pricing are untouched by address-book commands', () => {
  const before = {
    ...garageScenarioState('garage-vehicle-chosen'),
    addresses: three().addresses,
    addressSequence: 3,
  };
  const cost = illustrativeCost(before.draft);
  let state = submitAccountAddress(before, typed('دمشق، عنوان إضافي'), null).state;
  state = deleteSavedAddress(state, 'ADR-1');
  state = chooseSavedAddress(state, 'ADR-2');
  assert.equal(state.vehicles, before.vehicles);
  assert.equal(state.vehicleSequence, before.vehicleSequence);
  assert.equal(state.draft.carId, before.draft.carId);
  assert.deepEqual(illustrativeCost(state.draft), cost);
});

test('C009 account view: counts, approved copy and which rows are live', () => {
  const view = buildAccountViewModel(three());
  assert.equal(view.displayName, 'أهلاً بك في WashGo');
  assert.equal(view.initial, '');
  assert.deepEqual(
    view.primaryRows.map((row) => [row.id, row.title, row.hint, row.action]),
    [
      ['profile', 'بياناتي', 'الاسم ورقم التواصل', 'deferred'],
      ['addresses', 'عناويني', '3 عناوين محفوظة', 'addresses'],
      ['garage-tab', 'سياراتي', '0 سيارات محفوظة', 'garage'],
    ],
  );
  assert.deepEqual(
    view.secondaryRows.map((row) => row.action),
    Array(7).fill('deferred'),
    'payment, motion, help, privacy, export and reset are not implemented here',
  );
  assert.deepEqual(
    view.secondaryRows.filter((row) => row.danger).map((row) => row.id),
    ['reset-prompt'],
  );
  for (const row of [...view.primaryRows, ...view.secondaryRows]) {
    assert.ok(reference.includes(row.title), row.title);
  }
  const named = buildAccountViewModel(homeScenarioState('home-returning-customer'));
  assert.equal(named.initial, 'س');
  assert.equal(named.phone, '0900000000');
  assert.deepEqual(
    buildAddressBookItems(three()).map((item) => item.id),
    ['ADR-1', 'ADR-2', 'ADR-3'],
    'the list keeps the book order',
  );
});

test('C009 account host: deferred controls are marked and bound to nothing', () => {
  const route = withoutComments(read('features/account/AccountRoute.tsx'));
  assert.match(route, /'aria-disabled': true, 'data-deferred': 'account'/);
  assert.match(route, /if \(row\.action === 'addresses'\) setBook\(\{ kind: 'list' \}\)/);
  assert.match(route, /if \(row\.action === 'garage'\) navigate\('\/garage'\)/);
  // No export, reset or storage behaviour was added to complete the surrounding page.
  assert.ok(!/localStorage|sessionStorage|Blob|createObjectURL|\.download\b/.test(route));
  assert.equal(bookingSteps.length, 7);
  assert.equal(bookingFlow.length, 7);
  assert.ok(!/path:\s*'[^']*address/.test(read('app/router.tsx')), 'no address-book route');
});

test('C009 copy: every approved string of the address book is present', () => {
  const source = readAll(c009Files);
  for (const text of [
    'عناويني المحفوظة',
    'احفظ المكان مرة واحدة ليظهر في الحجز القادم.',
    'إضافة عنوان',
    'حذف هذا العنوان؟',
    'لن يتغير عنوان أي حجز سابق.',
    'حذف العنوان',
    'رجوع',
    'حفظ العنوان',
    'تم حفظ العنوان.',
    'تم حذف العنوان.',
    'وصلت إلى حد 20 عنوانًا محفوظًا.',
    'التفاصيل الصغيرة تصنع الفرق',
    'ملف محلي بسيط، دون كلمة مرور.',
    'بيانات تجريبية على جهازك',
    'WashGo Signature · Payments Edition 06',
  ]) {
    assert.ok(reference.includes(text), `reference contains "${text}"`);
    assert.ok(source.includes(text), `the port contains "${text}"`);
  }
});

test('C009 shared editor: one implementation, in the widgets layer, importing no feature', () => {
  assert.deepEqual(editorFiles.map((file) => path.basename(file)).sort(), [
    'AddressEditor.tsx',
    'IllustrativeMap.tsx',
    'address-editor.css',
    'deviceLocation.ts',
  ]);
  for (const file of editorFiles) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/features\/|\/app\//.test(source), `${path.basename(file)} imports no feature/app`);
  }
  const all = sourceFiles(APP_SRC);
  const forms = all.filter((file) => /id="address-form"/.test(readFileSync(file, 'utf8')));
  assert.equal(forms.length, 1, 'the address form exists once');
  const maps = all.filter((file) => /id="location-map"/.test(readFileSync(file, 'utf8')));
  assert.equal(maps.length, 1, 'the map exists once');
  assert.ok(
    !all.some((file) =>
      file.replaceAll('\\', '/').includes('booking/location/components/AddressSheet'),
    ),
  );
  for (const user of [
    'features/account/components/AddressBookSheet.tsx',
    'features/booking/location/LocationStep.tsx',
  ]) {
    assert.match(read(user), /widgets\/address-editor\/AddressEditor/);
  }
});

test('C009 shared editor: context decides chips, preference and action label', () => {
  const editor = read('widgets/address-editor/AddressEditor.tsx');
  assert.match(editor, /booking && savedAddresses\.length > 0/);
  assert.match(editor, /\{booking \? \(\s*<label className="checkbox-row">/);
  assert.match(editor, /\{booking \? 'اعتماد هذا المكان' : 'حفظ العنوان'\}/);
  assert.ok(reference.includes("sheetContext==='booking'?'اعتماد هذا المكان':'حفظ العنوان'"));
  const blank = blankAddressEditorValues();
  assert.deepEqual(blank, {
    address: '',
    addressLabel: 'المنزل',
    locationNote: '',
    place: null,
    saveAddress: true,
  });
  assert.notEqual(blankAddressEditorValues(), blank);
});

test('C009 editor sessions: a late location answer cannot reach another editor', () => {
  const editor = withoutComments(read('widgets/address-editor/AddressEditor.tsx'));
  // The answer is dropped when the editor that asked is no longer mounted …
  assert.match(
    editor,
    /const outcome = await requestDevicePositionClass\(\);\s*if \(!mounted\.current\) return;/,
  );
  // … and each opening of the account editor is a new mount.
  const sheet = read('features/account/components/AddressBookSheet.tsx');
  assert.match(sheet, /<AddressEditorForm\s+key=\{view\.session\}/);
  const route = read('features/account/AccountRoute.tsx');
  assert.match(route, /const session = editorSessions \+ 1;/);
  // An in-range answer never carries coordinates into the values.
  const located = applyGeolocationOutcome(editorValuesForAddress(three().addresses[1]), 'in-range');
  assert.deepEqual(Object.keys(located.values.place).sort(), ['kind', 'label', 'x', 'y']);
  assert.equal(located.values.address, three().addresses[1].address);
});

test('C009 privacy and persistence: session memory only, no network, storage or logging', () => {
  for (const pattern of [
    /fetch\(/,
    /XMLHttpRequest/,
    /sendBeacon/,
    /WebSocket/,
    /localStorage|sessionStorage|indexedDB|document\.cookie/,
    /console\./,
    /https?:\/\//,
    /Date\.now|Math\.random|crypto\./,
    /geocod/i,
  ]) {
    assert.ok(!pattern.test(c009Code), `C009 code must not match ${pattern}`);
  }
  const state = withoutComments(read('state/savedAddresses.ts'));
  assert.ok(!/from 'react|window\.|document\.|navigator\./.test(state), 'pure state module');
  assert.ok(!/latitude|longitude|coords/i.test(state));
  for (const specifier of read('state/savedAddresses.ts').matchAll(/from '([^']+)'/g)) {
    assert.match(specifier[1], /^\.\/[\w]+\.ts$/);
  }
});

test('C009 safety: customer text is rendered as text', () => {
  for (const file of [...accountFiles, ...editorFiles].filter((name) => name.endsWith('.tsx'))) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/.test(source),
      path.basename(file),
    );
  }
  const hostile = '<img src=x onerror="globalThis.__xss=1">';
  const saved = submitAccountAddress(
    empty(),
    typed(hostile, { addressLabel: '<b>x</b>' }),
    null,
  ).state;
  assert.equal(saved.addresses[0].address, hostile, 'stored verbatim, shown as text');
  assert.deepEqual(labels(saved), ['<b>x</b>']);
});

test('C009 incident repairs are preserved', () => {
  const c008 = readFileSync(path.join(ROOT, 'scripts/c008/browser-acceptance.mjs'), 'utf8');
  const c009 = readFileSync(path.join(ROOT, 'scripts/c009/browser-acceptance.mjs'), 'utf8');
  for (const script of [c008, c009]) {
    assert.match(script, /REFERENCE_NEXT_GUARD_MS = 350/);
    assert.match(script, /waitForURL\(\/#book\[\/\]3\$\/\)/, 'the prototype route has no slash');
    assert.match(script, /\/#\\\/book\\\/3\$\//, 'the React route has the slash');
  }
  assert.ok(!/from '\.\.\/c008\/browser-acceptance/.test(c009), 'no acceptance runner is imported');
  assert.ok(reference.includes('if(now-lastNextAt<350)return;'));
});
