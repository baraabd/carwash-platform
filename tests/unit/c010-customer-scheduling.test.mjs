import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  blankBookingDraft,
  resolveBookingEntryStep,
} from '../../apps/customer-web/src/state/bookingDraft.ts';
import {
  repeatOrder,
  resumeBooking,
  startBooking,
} from '../../apps/customer-web/src/state/bookingEntry.ts';
import {
  chooseSampleLocation,
  submitLocationStep,
} from '../../apps/customer-web/src/state/locationStep.ts';
import {
  TIME_REQUIRED_MESSAGE,
  chooseEarliestSlot,
  draftWithCurrentSchedule,
  hasAvailableSlot,
  highlightedDay,
  returnToLocationStep,
  selectScheduleDay,
  selectScheduleTime,
  submitScheduleStep,
  toggleAllTimes,
} from '../../apps/customer-web/src/state/scheduleStep.ts';
import {
  ARRIVAL_TIMES,
  COLLAPSED_TIME_COUNT,
  EXCLUDED_TIME,
  LEAD_MINUTES,
  SCHEDULE_DAY_COUNT,
  SERVICE_TIME_ZONE,
  availableTimes,
  dateLabel,
  defaultScheduleDay,
  earliestSlot,
  isSlotAvailable,
  scheduleDays,
  serviceNow,
  timeLabel,
  visibleTimes,
} from '../../apps/customer-web/src/state/scheduling.ts';
import { illustrativeCost } from '../../apps/customer-web/src/fixtures/customerCatalogFixture.ts';
import { addressScenarioState } from '../../apps/customer-web/src/fixtures/customerAddressScenarios.ts';
import { garageScenarioState } from '../../apps/customer-web/src/fixtures/customerGarageScenarios.ts';
import { homeScenarioState } from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';
import {
  scheduleScenarioIds,
  scheduleScenarioState,
} from '../../apps/customer-web/src/fixtures/customerScheduleScenarios.ts';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import { bookingSteps } from '../../apps/customer-web/src/app/routes.ts';
import { bookingFlow } from '../../apps/customer-web/src/features/booking/bookingFlow.ts';
import { buildScheduleStepViewModel } from '../../apps/customer-web/src/features/booking/schedule/scheduleViewModel.ts';
import { pathForIntent } from '../../apps/customer-web/src/state/navigationPath.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP_SRC = path.join(ROOT, 'apps/customer-web/src');
const reference = readFileSync(
  path.join(ROOT, 'design/reference/approved/washgo-payments-interactive.html'),
  'utf8',
);
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, 'docs/design/f010-reference-manifest.json'), 'utf8'),
);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx|css)$/.test(entry.name) ? [target] : [];
  });
}
const read = (relative) => readFileSync(path.join(APP_SRC, relative), 'utf8');
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A Damascus wall-clock time on a day, as an instant. Damascus is UTC+3. */
const damascus = (day, hhmm, seconds = '00') => new Date(`${day}T${hhmm}:${seconds}+03:00`);
// The rendering contract's fixed instant: 12:00 in Damascus on 2026-09-20.
const CONTRACT = new Date(manifest.rendering.fixedTime);
const NOON = damascus('2026-09-20', '12:00');
const withDraft = (changes, base = homeScenarioState('home-empty')) => ({
  ...base,
  draft: { ...blankBookingDraft(), ...changes },
});
const located = (changes = {}) =>
  withDraft({ ...chooseSampleLocation(homeScenarioState('home-empty'), 'work').draft, ...changes });

test('C010 catalog: thirteen hourly arrival times, 08:00 to 20:00, exactly as the reference', () => {
  assert.deepEqual(ARRIVAL_TIMES, [
    '08:00',
    '09:00',
    '10:00',
    '11:00',
    '12:00',
    '13:00',
    '14:00',
    '15:00',
    '16:00',
    '17:00',
    '18:00',
    '19:00',
    '20:00',
  ]);
  assert.ok(
    reference.includes(
      "const TIMES=Array.from({length:13},(_,i)=>`${String(i+8).padStart(2,'0')}:00`);",
    ),
  );
  assert.equal(SERVICE_TIME_ZONE, 'Asia/Damascus');
  assert.equal(SCHEDULE_DAY_COUNT, 5);
  assert.equal(LEAD_MINUTES, 45);
  assert.equal(EXCLUDED_TIME, '11:00');
  assert.equal(COLLAPSED_TIME_COUNT, 6);
  assert.ok(reference.includes("Number(time.slice(0,2))*60<=now.minutes+45)&&time!=='11:00'"));
  assert.equal(CONTRACT.getTime(), NOON.getTime(), 'the contract clock is noon in Damascus');
});

test('C010 clock: the service-zone day and minute, seconds dropped', () => {
  assert.deepEqual(serviceNow(NOON), { key: '2026-09-20', minutes: 720 });
  assert.deepEqual(serviceNow(damascus('2026-09-20', '09:14', '59')), {
    key: '2026-09-20',
    minutes: 554,
  });
  // 22:30 UTC is already the next day in Damascus.
  assert.deepEqual(serviceNow(new Date('2026-09-20T22:30:00Z')), {
    key: '2026-09-21',
    minutes: 90,
  });
  assert.throws(
    () => serviceNow(undefined),
    TypeError,
    'a missing instant never reads the real clock',
  );
  assert.throws(() => serviceNow(new Date('nope')), TypeError);
  assert.throws(() => earliestSlot(), TypeError);
});

test('C010 days: five calendar days from the service-zone today, with the approved labels', () => {
  const days = scheduleDays(NOON);
  assert.deepEqual(
    days.map((day) => day.key),
    ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'],
  );
  assert.deepEqual(
    days.map((day) => day.day),
    ['20', '21', '22', '23', '24'],
  );
  assert.equal(days[0].label, 'اليوم');
  assert.equal(days[1].label, 'غدًا');
  const weekday = new Intl.DateTimeFormat('ar', { timeZone: 'Asia/Damascus', weekday: 'long' });
  assert.equal(days[2].label, weekday.format(new Date('2026-09-22T12:00:00+03:00')));
  const month = new Intl.DateTimeFormat('ar', { timeZone: 'Asia/Damascus', month: 'short' });
  assert.equal(days[0].month, month.format(new Date('2026-09-20T12:00:00+03:00')));
});

test('C010 days: month, year and leap-day boundaries, and midnight in the service zone', () => {
  assert.deepEqual(
    scheduleDays(damascus('2026-09-28', '10:00')).map((day) => day.key),
    ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'],
  );
  assert.deepEqual(
    scheduleDays(damascus('2026-12-30', '10:00')).map((day) => day.key),
    ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'],
  );
  assert.deepEqual(
    scheduleDays(damascus('2028-02-27', '10:00')).map((day) => day.key),
    ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02'],
  );
  assert.equal(scheduleDays(damascus('2026-09-20', '23:59'))[0].key, '2026-09-20');
  assert.equal(scheduleDays(damascus('2026-09-21', '00:00'))[0].key, '2026-09-21');
});

test('C010 days: the same answer whatever the host time zone is', () => {
  const script = `
    const s = await import(${JSON.stringify(
      'file:///' + path.join(APP_SRC, 'state/scheduling.ts').replaceAll('\\', '/'),
    )});
    const at = new Date('2026-09-20T21:30:00Z');
    console.log(JSON.stringify([s.scheduleDays(at).map((d) => d.key), s.earliestSlot(at), s.serviceNow(at)]));
  `;
  const run = (tz) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    }).trim();
  const answers = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Damascus'].map(run);
  assert.equal(new Set(answers).size, 1, answers.join('\n'));
  assert.deepEqual(JSON.parse(answers[0])[2], { key: '2026-09-21', minutes: 30 });
});

test('C010 availability: 11:00 is never offered, unknown values never are', () => {
  for (const day of scheduleDays(NOON)) {
    assert.equal(isSlotAvailable(NOON, day.key, '11:00'), false, day.key);
  }
  for (const [day, time] of [
    ['2026-09-21', '07:00'],
    ['2026-09-21', '21:00'],
    ['2026-09-21', '09:30'],
    ['2026-09-21', '9:00'],
    ['2026-09-21', ''],
    ['2026-09-21', null],
    ['2026-09-25', '09:00'],
    ['2026-09-19', '09:00'],
    ['21-09-2026', '09:00'],
    ['', '09:00'],
    [null, '09:00'],
    ['__proto__', 'constructor'],
  ]) {
    assert.equal(isSlotAvailable(NOON, day, time), false, `${day} ${time}`);
  }
  assert.equal(isSlotAvailable(NOON, '2026-09-24', '20:00'), true, 'the fifth day is offered');
  assert.equal(availableTimes(NOON, '2026-09-21').length, 12);
  assert.deepEqual(availableTimes(NOON, 'nope'), []);
});

test('C010 availability: today needs a start strictly later than now plus 45 minutes', () => {
  const cases = [
    ['09:14', '59', '10:00', true], // 554 + 45 = 599 < 600
    ['09:15', '00', '10:00', false], // 555 + 45 = 600, not later
    ['09:15', '59', '10:00', false],
    ['09:16', '00', '10:00', false],
    ['11:14', '00', '12:00', true],
    ['11:15', '00', '12:00', false],
    ['19:14', '00', '20:00', true],
    ['19:15', '00', '20:00', false],
  ];
  for (const [hhmm, seconds, time, expected] of cases) {
    const at = damascus('2026-09-20', hhmm, seconds);
    assert.equal(isSlotAvailable(at, '2026-09-20', time), expected, `${hhmm}:${seconds} → ${time}`);
    // Other days are unaffected by the time of day.
    assert.equal(isSlotAvailable(at, '2026-09-21', time), time !== '11:00');
  }
});

test('C010 earliest: by day then time; today, tomorrow after the last time; never null in the catalog', () => {
  assert.deepEqual(earliestSlot(NOON), { date: '2026-09-20', time: '13:00' });
  assert.deepEqual(earliestSlot(damascus('2026-09-20', '07:00')), {
    date: '2026-09-20',
    time: '08:00',
  });
  assert.deepEqual(earliestSlot(damascus('2026-09-20', '09:20')), {
    date: '2026-09-20',
    time: '12:00',
  });
  assert.deepEqual(earliestSlot(damascus('2026-09-20', '19:15')), {
    date: '2026-09-21',
    time: '08:00',
  });
  assert.deepEqual(earliestSlot(damascus('2026-09-20', '23:59')), {
    date: '2026-09-21',
    time: '08:00',
  });
  assert.equal(defaultScheduleDay(NOON), '2026-09-20');
  assert.equal(defaultScheduleDay(damascus('2026-09-20', '20:30')), '2026-09-21');
});

test('C010 labels: the reference formats, with their fallbacks', () => {
  assert.deepEqual(ARRIVAL_TIMES.map(timeLabel), [
    '8:00 ص',
    '9:00 ص',
    '10:00 ص',
    '11:00 ص',
    '12:00 م',
    '1:00 م',
    '2:00 م',
    '3:00 م',
    '4:00 م',
    '5:00 م',
    '6:00 م',
    '7:00 م',
    '8:00 م',
  ]);
  assert.equal(timeLabel(null), 'لم يحدد');
  assert.equal(timeLabel('09:30'), 'لم يحدد');
  assert.equal(dateLabel('not-a-date'), 'اختر موعدًا');
  assert.equal(
    dateLabel('2026-09-21'),
    new Intl.DateTimeFormat('ar', {
      timeZone: 'Asia/Damascus',
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    }).format(new Date('2026-09-21T12:00:00+03:00')),
  );
});

test('C010 visible times: first six, all when expanded or when the choice is beyond six', () => {
  const day = availableTimes(NOON, '2026-09-21');
  assert.deepEqual(visibleTimes(day, null, false), day.slice(0, 6));
  assert.deepEqual(visibleTimes(day, '14:00', false), day.slice(0, 6), 'the sixth stays collapsed');
  assert.deepEqual(visibleTimes(day, '15:00', false), day, 'the seventh forces the full list');
  assert.deepEqual(visibleTimes(day, '20:00', false), day);
  assert.deepEqual(visibleTimes(day, null, true), day);
  assert.deepEqual(
    visibleTimes(day, '11:00', false),
    day.slice(0, 6),
    'an absent time changes nothing',
  );
  assert.ok(reference.includes('showAllTimes||slots.indexOf(d.time)>5?slots:slots.slice(0,6)'));
});

test('C010 model: a highlighted day is not an appointment', () => {
  const draft = blankBookingDraft();
  assert.equal(draft.scheduleDay, null);
  assert.equal(draft.slot, null);
  // With no recorded day the screen highlights the default day for the instant.
  assert.equal(highlightedDay(draft, NOON), '2026-09-20');
  assert.equal(highlightedDay(draft, damascus('2026-09-20', '20:30')), '2026-09-21');
  assert.equal(highlightedDay({ scheduleDay: '2026-09-23' }, NOON), '2026-09-23');
  const state = selectScheduleDay(located(), '2026-09-22', NOON);
  assert.equal(state.draft.scheduleDay, '2026-09-22');
  assert.equal(state.draft.slot, null);
  assert.equal(hasAvailableSlot(state.draft, NOON), false);
  assert.equal(submitScheduleStep(state, NOON).timeError, TIME_REQUIRED_MESSAGE);
});

test('C010 day selection: clears the time and collapses, also for the same day', () => {
  let state = selectScheduleDay(located(), '2026-09-22', NOON);
  state = toggleAllTimes(state);
  state = selectScheduleTime(state, '18:00', NOON);
  assert.deepEqual(state.draft.slot, { date: '2026-09-22', time: '18:00' });
  assert.equal(state.showAllTimes, true);
  const again = selectScheduleDay(state, '2026-09-22', NOON);
  assert.equal(again.draft.slot, null, 'reselecting the same day clears the time');
  assert.equal(again.showAllTimes, false);
  assert.equal(again.draft.scheduleDay, '2026-09-22');
  assert.equal(
    selectScheduleDay(state, '2026-09-30', NOON),
    state,
    'a day outside the window is ignored',
  );
  assert.equal(selectScheduleDay(state, '__proto__', NOON), state);
});

test('C010 time selection: completes the slot on the highlighted day; invalid times are ignored', () => {
  const base = selectScheduleDay(located(), '2026-09-20', NOON);
  const chosen = selectScheduleTime(base, '13:00', NOON);
  assert.deepEqual(chosen.draft.slot, { date: '2026-09-20', time: '13:00' });
  assert.equal(chosen.draft.touched, true);
  for (const time of ['12:00', '11:00', '09:30', '21:00', '', 'constructor']) {
    assert.equal(selectScheduleTime(base, time, NOON), base, time);
  }
  // With no recorded day the default day (here today) is used and recorded.
  const fresh = selectScheduleTime(located(), '14:00', NOON);
  assert.deepEqual(fresh.draft.slot, { date: '2026-09-20', time: '14:00' });
  assert.equal(fresh.draft.scheduleDay, '2026-09-20');
});

test('C010 earliest action: day and time, collapsed list, notice; manual choice is never overridden', () => {
  const expanded = toggleAllTimes(located());
  const state = chooseEarliestSlot(expanded, NOON);
  assert.deepEqual(state.draft.slot, { date: '2026-09-20', time: '13:00' });
  assert.equal(state.draft.scheduleDay, '2026-09-20');
  assert.equal(state.showAllTimes, false);
  assert.equal(state.notice.message, `الموعد: ${dateLabel('2026-09-20')}، 1:00 م.`);
  const manual = selectScheduleTime(selectScheduleDay(state, '2026-09-23', NOON), '16:00', NOON);
  // Rendering never re-picks the earliest time.
  const view = buildScheduleStepViewModel(manual, NOON);
  assert.equal(view.earliestChosen, false);
  assert.equal(view.times.find((option) => option.selected)?.time, '16:00');
  assert.deepEqual(manual.draft.slot, { date: '2026-09-23', time: '16:00' });
});

test('C010 submission: re-evaluated at the tap; a stale choice is refused, kept, not replaced', () => {
  const at = damascus('2026-09-20', '09:14', '59');
  const chosen = selectScheduleTime(selectScheduleDay(located(), '2026-09-20', at), '10:00', at);
  assert.equal(submitScheduleStep(chosen, at).intent.step, 4);
  const later = damascus('2026-09-20', '09:15');
  const refused = submitScheduleStep(chosen, later);
  assert.equal(refused.intent, null);
  assert.equal(refused.timeError, TIME_REQUIRED_MESSAGE);
  assert.deepEqual(
    refused.state.draft,
    chosen.draft,
    'the stored choice is neither cleared nor replaced',
  );
  assert.equal(refused.state.announcement.message, TIME_REQUIRED_MESSAGE);
  assert.ok(reference.includes(TIME_REQUIRED_MESSAGE));
});

test('C010 submission: overnight rollover and leaving the five-day window', () => {
  const tomorrowMorning = selectScheduleTime(
    selectScheduleDay(located(), '2026-09-21', damascus('2026-09-20', '23:50')),
    '08:00',
    damascus('2026-09-20', '23:50'),
  );
  assert.equal(submitScheduleStep(tomorrowMorning, damascus('2026-09-21', '00:10')).intent.step, 4);
  assert.equal(submitScheduleStep(tomorrowMorning, damascus('2026-09-21', '07:15')).intent, null);
  const farDay = selectScheduleTime(
    selectScheduleDay(located(), '2026-09-22', NOON),
    '09:00',
    NOON,
  );
  assert.equal(submitScheduleStep(farDay, damascus('2026-09-26', '12:00')).intent, null);
  const stale = buildScheduleStepViewModel(farDay, damascus('2026-09-26', '12:00'));
  assert.ok(
    stale.days.every((day) => !day.selected),
    'a day outside the window highlights nothing',
  );
  assert.equal(stale.dayExhausted, true);
  assert.equal(stale.summary, `${dateLabel('2026-09-22')} · 9:00 ص`, 'the choice stays visible');
});

test('C010 Next leads to contact; Back and «تغيير» to location; the draft is untouched', () => {
  const ready = chooseEarliestSlot(located(), NOON);
  const next = submitScheduleStep(ready, NOON);
  assert.equal(pathForIntent(next.intent), '/book/4');
  assert.equal(next.state.draftStep, 4);
  const back = returnToLocationStep(ready);
  assert.equal(back.state, ready);
  assert.equal(pathForIntent(back.intent), '/book/2');
  assert.equal(bookingFlow[3].nextLabel, 'بيانات التواصل');
  assert.equal(bookingSteps[3].path, '/book/3');
  assert.equal(bookingSteps.length, 7);
  assert.equal(pathForIntent(submitLocationStep(located()).intent), '/book/3');
});

test('C010 entry guard: earlier steps first, then a complete offered appointment', () => {
  const complete = {
    ...located().draft,
    scheduleDay: '2026-09-21',
    slot: { date: '2026-09-21', time: '09:00' },
    contactName: 'سامر',
    contactPhone: '0900000000',
    paymentMethod: 'cash',
  };
  assert.equal(resolveBookingEntryStep(complete, 6, NOON), 6);
  assert.equal(resolveBookingEntryStep({ ...complete, address: '' }, 6, NOON), 2, 'location first');
  assert.equal(resolveBookingEntryStep({ ...complete, slot: null }, 6, NOON), 3);
  assert.equal(
    resolveBookingEntryStep({ ...complete, slot: { date: '2026-09-21', time: '11:00' } }, 6, NOON),
    3,
  );
  assert.equal(resolveBookingEntryStep({ ...complete, slot: { date: '2026-09-21' } }, 6, NOON), 3);
  assert.equal(resolveBookingEntryStep(complete, 6, damascus('2026-09-21', '08:30')), 3, 'expired');
  assert.equal(resolveBookingEntryStep(complete, 3, damascus('2026-09-30', '08:30')), 3);
  assert.throws(
    () => resolveBookingEntryStep(complete, 6),
    TypeError,
    'the guard needs an instant',
  );
});

test('C010 start: a day outside the window is reset without a time; an offered one is kept', () => {
  const stale = withDraft({
    scheduleDay: '2026-09-01',
    slot: { date: '2026-09-01', time: '09:00' },
  });
  const started = startBooking(stale, undefined, NOON).state;
  assert.equal(started.draft.scheduleDay, '2026-09-20');
  assert.equal(started.draft.slot, null);
  const kept = withDraft({
    scheduleDay: '2026-09-22',
    slot: { date: '2026-09-22', time: '09:00' },
  });
  assert.deepEqual(startBooking(kept, undefined, NOON).state.draft.slot, kept.draft.slot);
  assert.equal(
    draftWithCurrentSchedule(blankBookingDraft(), damascus('2026-09-20', '20:30')).scheduleDay,
    '2026-09-21',
  );
  assert.ok(
    reference.includes(
      'if(!dates().some(x=>x.key===d.date)){d.date=earliest()?.date||dates()[0].key;d.time=null;}',
    ),
  );
});

test('C010 resume: returns to the recorded step only while its appointment is offered', () => {
  const at4 = { ...chooseEarliestSlot(located(), NOON), draftStep: 4 };
  assert.deepEqual(resumeBooking(at4, NOON).intent, { kind: 'booking-step', step: 4 });
  assert.deepEqual(resumeBooking(at4, damascus('2026-09-20', '12:30')).intent, {
    kind: 'booking-step',
    step: 3,
  });
  const dayOnly = { ...selectScheduleDay(located(), '2026-09-23', NOON), draftStep: 3 };
  const resumed = resumeBooking(dayOnly, NOON);
  assert.equal(resumed.intent.step, 3);
  assert.equal(resumed.state.draft.scheduleDay, '2026-09-23', 'the chosen day is kept');
});

test('C010 repeat: a fresh earliest offer, or the time step when nothing is offered; orders untouched', () => {
  const state = homeScenarioState('home-repeat-order');
  const orders = globalThis.structuredClone(state.orders);
  const result = repeatOrder(state, 'WG-DEMO-DONE', NOON);
  assert.deepEqual(result.state.draft.slot, { date: '2026-09-20', time: '13:00' });
  assert.equal(result.state.draft.scheduleDay, '2026-09-20');
  assert.notDeepEqual(result.state.draft.slot, state.orders[0].slot);
  assert.equal(result.intent.step, 6);
  assert.deepEqual(result.state.orders, orders, 'the past order keeps its own slot');
  const evening = repeatOrder(state, 'WG-DEMO-DONE', damascus('2026-09-20', '20:30'));
  assert.deepEqual(evening.state.draft.slot, { date: '2026-09-21', time: '08:00' });
  const nothing = repeatOrder(state, 'WG-DEMO-DONE', NOON, null);
  assert.equal(nothing.state.draft.slot, null);
  assert.equal(nothing.state.draft.scheduleDay, '2026-09-20');
  assert.equal(nothing.intent.step, 3, 'no offer stops at the time step');
  assert.ok(!('nextAvailableSlot' in state), 'no second, fixed source of offers remains');
});

test('C010 nothing else changes: price, duration, place, car, address book, garage', () => {
  const before = {
    ...garageScenarioState('garage-vehicle-chosen'),
    ...addressScenarioState('addresses-three'),
    vehicles: garageScenarioState('garage-vehicle-chosen').vehicles,
  };
  const start = { ...before, draft: { ...before.draft, ...located().draft, extras: ['seats'] } };
  let state = selectScheduleDay(start, '2026-09-23', NOON);
  state = selectScheduleTime(state, '16:00', NOON);
  state = chooseEarliestSlot(state, NOON);
  state = toggleAllTimes(state);
  state = submitScheduleStep(state, NOON).state;
  for (const key of [
    'vehicleType',
    'carId',
    'service',
    'extras',
    'address',
    'addressLabel',
    'locationNote',
    'place',
    'contactName',
    'contactPhone',
    'note',
    'paymentMethod',
  ]) {
    assert.deepEqual(state.draft[key], start.draft[key], key);
  }
  assert.equal(state.addresses, start.addresses);
  assert.equal(state.vehicles, start.vehicles);
  assert.equal(state.orders, start.orders);
  assert.deepEqual(illustrativeCost(state.draft), illustrativeCost(start.draft));
});

test('C010 view: the screen at an instant, with approved copy', () => {
  const ready = buildScheduleStepViewModel(located(), NOON);
  assert.equal(ready.locationLabel, 'العمل');
  assert.equal(ready.earliestText, `${dateLabel('2026-09-20')} · 1:00 م`);
  assert.equal(ready.earliestChosen, false);
  assert.deepEqual(
    ready.days.map((day) => day.selected),
    [true, false, false, false, false],
  );
  assert.deepEqual(
    ready.times.map((option) => option.time),
    ['13:00', '14:00', '15:00', '16:00', '17:00', '18:00'],
  );
  assert.equal(ready.canToggleTimes, true);
  assert.equal(ready.summary, null);
  assert.equal(
    ready.careDuration,
    `مدة العناية ${illustrativeCost(located().draft).minutes} دقيقة`,
  );
  const evening = buildScheduleStepViewModel(
    selectScheduleDay(located(), '2026-09-20', damascus('2026-09-20', '20:30')),
    damascus('2026-09-20', '20:30'),
  );
  assert.equal(evening.dayExhausted, true);
  assert.deepEqual(evening.times, []);
  assert.equal(evening.canToggleTimes, false);
  assert.equal(buildScheduleStepViewModel(withDraft({}), NOON).locationLabel, 'المنزل');
  assert.equal(
    buildScheduleStepViewModel(withDraft({ addressLabel: '' }), NOON).locationLabel,
    'موقع الغسيل',
  );
  for (const text of [
    '04 / وقتك له الأولوية',
    'متى يناسبك نجي؟',
    'اختر وقت الوصول. المواعيد هنا للتجربة فقط.',
    'أقرب موعد متاح',
    'لا يوجد موعد متاح',
    'أو اختر يومًا يناسبك',
    'توقيت دمشق',
    'وقت الوصول',
    'عرض كل الأوقات',
    'عرض أوقات أقل',
    'لا يوجد وقت متبقٍ لهذا اليوم. اختر يومًا آخر أو أقرب موعد.',
    'اختر الوقت، ثم نكمل بيانات التواصل.',
  ]) {
    assert.ok(reference.includes(text), `reference contains "${text}"`);
    const port =
      read('features/booking/schedule/ScheduleStep.tsx') +
      read('features/booking/schedule/scheduleViewModel.ts');
    assert.ok(port.includes(text), `the port contains "${text}"`);
  }
});

test('C010 scenarios: deterministic, declared against the contract clock, allowlisted', () => {
  assert.deepEqual(scheduleScenarioIds, [
    'booking-time-ready',
    'booking-time-day-chosen',
    'booking-time-slot-chosen',
    'booking-time-late-slot',
  ]);
  for (const id of scheduleScenarioIds) {
    const state = scheduleScenarioState(id);
    assert.deepEqual(initialSessionState(`#/book/3?scenario=${id}`), state);
    assert.ok(state.draft.address.length >= 4, `${id} has a place`);
    if (state.draft.slot) {
      assert.equal(
        state.draft.slot.date,
        state.draft.scheduleDay,
        `${id}: slot on the highlighted day`,
      );
      assert.equal(isSlotAvailable(CONTRACT, state.draft.slot.date, state.draft.slot.time), true);
    }
  }
  const late = buildScheduleStepViewModel(
    scheduleScenarioState('booking-time-late-slot'),
    CONTRACT,
  );
  assert.equal(late.times.length, 12, 'a choice beyond six shows the whole list');
  for (const hostile of ['__proto__', 'constructor', 'booking-time-unknown']) {
    assert.deepEqual(
      initialSessionState(`#/book/3?scenario=${hostile}`),
      homeScenarioState('home-empty'),
    );
  }
});

test('C010 architecture: one clock reader, pure rules, no reservation, storage or network', () => {
  const clockReaders = sourceFiles(APP_SRC).filter((file) =>
    /new Date\(\)|Date\.now\(/.test(readFileSync(file, 'utf8')),
  );
  assert.deepEqual(
    clockReaders.map((file) => path.relative(APP_SRC, file).replaceAll('\\', '/')),
    ['shared/clock.ts'],
  );
  for (const file of [
    'state/scheduling.ts',
    'state/scheduleStep.ts',
    'features/booking/schedule/scheduleViewModel.ts',
  ]) {
    const code = withoutComments(read(file));
    assert.ok(!/from 'react|window\.|document\.|navigator\./.test(code), `${file} is pure`);
    for (const specifier of read(file).matchAll(/from '([^']+)'/g)) {
      assert.match(specifier[1], /\.ts$/, `${file} imports .ts modules`);
    }
  }
  const owned = withoutComments(
    [
      'state/scheduling.ts',
      'state/scheduleStep.ts',
      'features/booking/schedule/ScheduleStep.tsx',
      'features/booking/schedule/scheduleViewModel.ts',
      'fixtures/customerScheduleScenarios.ts',
    ]
      .map(read)
      .join('\n'),
  );
  for (const pattern of [
    /fetch\(/,
    /XMLHttpRequest/,
    /sendBeacon/,
    /WebSocket/,
    /localStorage|sessionStorage|indexedDB|document\.cookie/,
    /console\./,
    /https?:\/\//,
    /setInterval|setTimeout/,
    /reserve\(|reservation/i,
    /Math\.random/,
  ]) {
    assert.ok(!pattern.test(owned), `C010 code must not match ${pattern}`);
  }
  const component = read('features/booking/schedule/ScheduleStep.tsx');
  assert.ok(
    !/isSlotAvailable|ARRIVAL_TIMES|LEAD_MINUTES/.test(component),
    'no availability math in JSX',
  );
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(component));
  assert.ok(!/role="button"|<div[^>]*onClick/.test(component), 'native buttons only');
  const route = read('features/booking/index.tsx');
  assert.match(route, /if \(step === 'time'\) return <ScheduleStep \/>;/);
  assert.ok(!/step === 'contact'/.test(route), 'contact (C011) is not ported');
});
