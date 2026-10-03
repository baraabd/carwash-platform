// C010 browser acceptance: renders the React time step next to the approved
// customer HTML in the same browser, compares structure, copy, geometry,
// computed style and pixels, then applies the same interactions to both.
//
// Methodology and helpers are those of the C004 acceptance (scripts/c004). The
// reference is served read-only and is never modified.
//
// Ownership declared before any comparison: C010 owns the whole time step
// (`#/book/3`; `#book/3` in the prototype), compared full-page. The contact step
// (`#/book/4`) is still a placeholder and is only checked as a destination.
//
// Two clocks, kept apart:
// - Booking time is `Date`. Most cases use the fixed instant of the rendering
//   contract through the shared harness. Cases about the time of day use ONE
//   settable `Date` shim of this script instead (never both), installed before
//   the application starts and moved identically on both pages.
// - Interaction timing is `performance.now()`, which is never frozen: the
//   prototype's 350 ms Next guard runs on it and is waited out, not bypassed.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startReferenceServer } from '../f010/reference-server.mjs';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import {
  compareSnapshots,
  comparePixels,
  contract,
  newContext,
  openCandidate,
  openReference,
  referenceStorageFor,
  settle,
  snapshot,
} from '../c004/parity-harness.mjs';

const origin = process.env.C010_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C010_EVIDENCE_DIR
  ? resolve(process.env.C010_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c010-'));
mkdirSync(evidence, { recursive: true });

const PARITY_SELECTORS = [
  'body',
  '.app',
  '.app-header',
  '.header-title',
  '.main',
  '.journey-heading',
  '.stepper',
  '.step-segment',
  '.page-heading',
  '.page-heading h1',
  '.page-heading p',
  '.page-heading .chapter-icon',
  '.page-heading .chapter-icon .icon',
  '.choice-context',
  '.choice-context > .icon',
  '.choice-context .grow',
  '.choice-context .text-btn',
  '.earliest',
  '.earliest .chapter-icon',
  '.earliest .chapter-icon .icon',
  '.earliest .grow',
  '.earliest strong',
  '.earliest p',
  '.earliest > .icon',
  '.mini-title',
  '.mini-title small',
  '.dates',
  '.date',
  '.date small',
  '.date strong',
  '.date span',
  '.times',
  '.time',
  '.time .icon',
  '.main .info-note',
  '.center',
  '.center .text-btn',
  '.center .text-btn .icon',
  '.main .error',
  '.selection-summary',
  '.selection-summary .icon',
  '.selection-summary span',
  '.booking-footer',
  '.footer-assurance span',
  '.booking-total',
  '.booking-total strong',
  '.primary-next',
  '.toast',
  'dialog.sheet[open]',
  'dialog.sheet[open] .sheet-inner',
  'dialog.sheet[open] .sheet-head h2',
  'dialog.sheet[open] .bill',
  'dialog.sheet[open] .bill-line',
  'dialog.sheet[open] .btn',
];

const NEXT = '.primary-next';
const EARLIEST = '.earliest';
const TOGGLE = '.center .text-btn';
const CHANGE = '.choice-context .text-btn';
const CARD = '.location-picker';

// The approved prototype's next() ignores a Next that follows an accepted Next
// by less than this (`if(now-lastNextAt<350)return;`), measured on the page's
// own performance clock. It is a double-activation guard, not a failure.
const REFERENCE_NEXT_GUARD_MS = 350;
/** Resolves once a full guard interval has passed on the reference page's clock. */
const pastReferenceNextGuard = async (page) => {
  const from = await page.evaluate(() => globalThis.performance.now());
  await page.waitForFunction(({ start, guard }) => globalThis.performance.now() - start >= guard, {
    start: from,
    guard: REFERENCE_NEXT_GUARD_MS,
  });
};
/** Next on either page; on the reference, only once its guard interval is over. */
const next = async (page, isReference) => {
  if (isReference) await pastReferenceNextGuard(page);
  await page.locator(NEXT).click();
};

const day = (index) => (page) => page.locator('.date').nth(index).click();
const time = (label) => (page) => page.getByRole('button', { name: label, exact: true }).click();
const earliest = (page) => page.locator(EARLIEST).click();
const toggleTimes = (page) => page.locator(TOGGLE).click();
const sheetOpen = (page) => page.locator('dialog.sheet[open]').waitFor();
const sheetClosed = (page) => page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });

// Instants. The rendering contract's fixed time is 12:00 in Damascus on Sunday
// 2026-09-20; the others are chosen around the rules under test.
const AT = {
  morningBeforeBoundary: '2026-09-20T06:14:59.000Z', // 09:14:59 → 10:00 still offered
  morningAtBoundary: '2026-09-20T06:15:00.000Z', // 09:15:00 → 10:00 no longer offered
  noon: '2026-09-20T09:00:00.000Z',
  evening: '2026-09-20T17:30:00.000Z', // 20:30 → nothing left today
  beforeMidnight: '2026-09-20T20:50:00.000Z', // 23:50
  afterMidnight: '2026-09-20T21:10:00.000Z', // 00:10 on the 21st
  nextMorning: '2026-09-21T06:00:00.000Z', // 09:00 on the 21st
  sixDaysLater: '2026-09-26T09:00:00.000Z',
};

/**
 * A context whose `Date` is fixed at `instant` and can be moved with
 * `setNow(page, instant)`. It mirrors the harness's context options and replaces
 * the harness's fixed-clock shim rather than stacking on top of it.
 * `performance.now()` and timers are untouched.
 */
async function newClockContext(browser, width, instant) {
  const context = await browser.newContext({
    viewport: { width, height: contract.height },
    deviceScaleFactor: contract.deviceScaleFactor,
    locale: contract.locale,
    timezoneId: contract.timezoneId,
    colorScheme: contract.colorScheme,
    reducedMotion: contract.reducedMotion,
  });
  await context.addInitScript((initial) => {
    let fixed = initial;
    const NativeDate = Date;
    class SettableDate extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixed]));
      }
      static now() {
        return new NativeDate(fixed).getTime();
      }
    }
    Object.defineProperty(globalThis, 'Date', { value: SettableDate });
    globalThis.__setNow = (value) => {
      fixed = value;
    };
  }, instant);
  return context;
}
const setNow = (instant) => (page) => page.evaluate((value) => globalThis.__setNow(value), instant);

const routes = {
  time: { hash: '#book/3', path: '/book/3', screen: 'booking', step: 3, ready: '.dates' },
  home: { hash: '#home', path: '/', screen: 'home', step: 0, ready: '.hero-cta' },
};

async function openPair(context, server, scenario, where = 'time') {
  const route = routes[where];
  const state = initialSessionState(`#/?scenario=${scenario}`);
  const storage = referenceStorageFor(state, { screen: route.screen, step: route.step });
  storage.cars = state.vehicles.map((vehicle) => ({ ...vehicle }));
  storage.addresses = state.addresses.map((record) => ({ ...record }));
  storage.draft.carId = state.draft.carId;
  storage.draft.place = state.draft.place ? { ...state.draft.place } : null;
  storage.draft.saveAddress = state.draft.saveAddress;
  // The prototype keeps the highlighted day and the time as two draft fields.
  storage.draft.date = state.draft.scheduleDay ?? '';
  storage.draft.time = state.draft.slot?.time ?? null;
  const reference = await openReference(context, server, storage, route.hash);
  await reference.page.locator(route.ready).first().waitFor();
  const candidate = await openCandidate(
    context,
    origin,
    `${route.path}?scenario=${scenario}`,
    route.ready,
  );
  if (where === 'time') await candidate.page.locator('.booking-footer').waitFor();
  return { reference, candidate };
}

/** What a customer can observe, read the same way on both pages. */
function observe(page) {
  return page.evaluate(() => {
    const doc = globalThis.document;
    const clean = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
    const text = (selector, root = doc) => {
      const node = root.querySelector(selector);
      return node ? clean(node.textContent) : null;
    };
    const route = globalThis.location.hash.replace('#/', '#').split('?')[0];
    const sheet = doc.querySelector('dialog.sheet[open]');
    const toast = doc.querySelector('.toast');
    const earliestButton = doc.querySelector('.earliest');
    const summary = doc.querySelector('.selection-summary');
    return {
      route: route === '#' || route === '' ? '#home' : route,
      heading: text('.main h1'),
      context: text('.choice-context .grow'),
      earliest: earliestButton
        ? {
            title: text('strong', earliestButton),
            text: text('p', earliestButton),
            pressed: earliestButton.getAttribute('aria-pressed'),
          }
        : null,
      miniTitles: [...doc.querySelectorAll('.mini-title')].map((node) => clean(node.textContent)),
      days: [...doc.querySelectorAll('.date')].map((node) => ({
        label: text('small', node),
        day: text('strong', node),
        month: text('span', node),
        name: node.getAttribute('aria-label'),
        selected: node.classList.contains('selected'),
        pressed: node.getAttribute('aria-pressed'),
      })),
      times: [...doc.querySelectorAll('.time')].map((node) => ({
        text: clean(node.textContent),
        selected: node.classList.contains('selected'),
        pressed: node.getAttribute('aria-pressed'),
        ticked: node.querySelector('svg') !== null,
      })),
      exhausted: text('.main p.info-note'),
      toggle: text('.center .text-btn'),
      stepError: text('.main .error'),
      summary: summary
        ? { text: clean(summary.textContent), chosen: summary.classList.contains('has-value') }
        : null,
      card: text('.location-picker .address-preview'),
      footerPrice: text('#footer-price'),
      footerDuration: text('.footer-assurance span:last-child'),
      nextLabel: text('.primary-next'),
      // The last notice raised, whether or not it is still on screen (see C005).
      toast: (toast && clean(toast.textContent)) || null,
      sheet: sheet
        ? {
            title: text('.sheet-head h2', sheet),
            lines: [...sheet.querySelectorAll('.bill-line')].map((line) => clean(line.textContent)),
          }
        : null,
    };
  });
}

// Lets the four-second notice leave so a capture does not depend on how long the
// other page took. The notice text itself is compared through `observe`.
const noticeGone = (page) => page.waitForTimeout(4400);

/** Screens compared visually. `prepare` runs the same steps on both pages. */
const visualStates = [
  { id: 'time-initial', scenario: 'booking-time-ready' },
  { id: 'time-day-chosen-no-time', scenario: 'booking-time-day-chosen' },
  { id: 'time-slot-chosen-long-label', scenario: 'booking-time-slot-chosen' },
  { id: 'time-slot-beyond-six', scenario: 'booking-time-late-slot' },
  {
    id: 'time-earliest-selected',
    scenario: 'booking-time-ready',
    prepare: async (page) => {
      await earliest(page);
      await page.locator('.earliest[aria-pressed="true"]').waitFor();
      await noticeGone(page);
    },
  },
  {
    id: 'time-all-times-shown',
    scenario: 'booking-time-day-chosen',
    prepare: async (page) => {
      await toggleTimes(page);
      await page.locator('.time').nth(11).waitFor();
    },
  },
  {
    id: 'time-validation-error',
    scenario: 'booking-time-ready',
    prepare: async (page) => {
      await page.locator(NEXT).click();
      await page.locator('.main .error').waitFor();
      // The message is scrolled to; wait for the same resting position on both.
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'time-price-details',
    scenario: 'booking-time-slot-chosen',
    prepare: async (page) => {
      await page.locator('.booking-total').click();
      await sheetOpen(page);
    },
  },
  {
    id: 'time-today-exhausted',
    scenario: 'booking-time-ready',
    clock: AT.evening,
    prepare: async (page) => {
      await day(0)(page);
      await page.locator('.main p.info-note').waitFor();
    },
  },
];
const shortStates = [
  { ...visualStates[0], id: 'short-time-initial' },
  { ...visualStates[5], id: 'short-time-all-times' },
];
const SHORT_HEIGHT = 560;

async function compareVisual(browser, server, visual, width, height, summary) {
  const label = `${visual.id}@${width}`;
  const context = visual.clock
    ? await newClockContext(browser, width, visual.clock)
    : await newContext(browser, width, height ? { height } : {});
  try {
    const { reference, candidate } = await openPair(context, server, visual.scenario);
    if (visual.prepare) {
      await visual.prepare(reference.page);
      await visual.prepare(candidate.page);
    }
    await reference.page.waitForTimeout(320);
    await candidate.page.waitForTimeout(320);
    await settle(reference.page);
    await settle(candidate.page);

    const referenceSnapshot = await snapshot(reference.page, PARITY_SELECTORS);
    const candidateSnapshot = await snapshot(candidate.page, PARITY_SELECTORS);
    assert.equal(candidateSnapshot.lang, 'ar', `${label}: lang`);
    assert.equal(candidateSnapshot.dir, 'rtl', `${label}: dir`);
    const overflow = candidateSnapshot.scrollWidth - candidateSnapshot.innerWidth;
    assert.ok(overflow <= 0, `${label}: horizontal overflow ${overflow}px`);
    compareSnapshots(referenceSnapshot, candidateSnapshot, PARITY_SELECTORS, label);
    assert.deepEqual(
      await observe(candidate.page),
      await observe(reference.page),
      `${label}: observable state`,
    );
    const pixels = await comparePixels(browser, reference.page, candidate.page, evidence, label);
    summary.visual.push({ state: visual.id, width, height: height ?? contract.height, ...pixels });
    assert.deepEqual(reference.problems, [], `${label}: reference page problems`);
    assert.deepEqual(candidate.problems, [], `${label}: candidate page problems`);
  } finally {
    await context.close();
  }
}

/** Runs the same steps on both pages and compares what can be observed after each. */
async function compareSteps(reference, candidate, name, steps) {
  for (const [index, step] of steps.entries()) {
    const run = typeof step === 'function' ? step : step.run;
    const compared = (state) =>
      step.only ? Object.fromEntries(step.only.map((key) => [key, state[key]])) : state;
    await run(reference.page, true);
    await run(candidate.page, false);
    await reference.page.waitForTimeout(80);
    await candidate.page.waitForTimeout(80);
    assert.deepEqual(
      compared(await observe(candidate.page)),
      compared(await observe(reference.page)),
      `${name}: after step ${index + 1}`,
    );
  }
}

// The contact step is not ported (C011): only the destination is compared.
const toContact = {
  only: ['route'],
  run: async (page, isReference) => {
    await next(page, isReference);
    await page.waitForURL(isReference ? /#book[/]4$/ : /#\/book\/4$/);
  },
};
const changeLocation = async (page) => {
  await page.locator(CHANGE).click();
  await page.locator(CARD).waitFor();
};
const nextToTime = async (page, isReference) => {
  await next(page, isReference);
  await page.locator('.dates').waitFor();
};
const headerBack = (ready) => async (page) => {
  await page.getByRole('button', { name: 'الخطوة السابقة', exact: true }).click();
  await page.locator(ready).first().waitFor();
};

const summary = { evidence, visual: [], interactions: [] };
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const server = await startReferenceServer();
const save = () =>
  writeFileSync(resolve(evidence, 'c010-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
try {
  // 1. Visual parity: every state at every contract viewport, then a short viewport.
  for (const visual of visualStates) {
    for (const width of contract.viewports) {
      await compareVisual(browser, server, visual, width, undefined, summary);
    }
  }
  for (const visual of shortStates) {
    await compareVisual(browser, server, visual, 390, SHORT_HEIGHT, summary);
  }
  save();

  // 2. Interaction parity under the contract clock (12:00 in Damascus).
  const interactionCases = [
    {
      name: 'a day is highlighted without a time; tapping it again clears the time',
      scenario: 'booking-time-ready',
      steps: [
        day(2),
        time('9:00 ص'),
        day(2),
        day(4),
        day(0),
        time('1:00 م'),
        day(1),
        time('8:00 ص'),
        time('12:00 م'),
      ],
    },
    {
      name: 'six times first; expanding, a later choice and collapsing',
      scenario: 'booking-time-day-chosen',
      steps: [
        toggleTimes,
        toggleTimes,
        toggleTimes,
        time('6:00 م'),
        // Collapsing keeps the whole list: the chosen time is beyond the sixth.
        toggleTimes,
        time('9:00 ص'),
        toggleTimes,
        toggleTimes,
        // Another day collapses the list and clears the time.
        day(3),
      ],
    },
    {
      name: 'the earliest appointment, then a manual choice, then the earliest again',
      scenario: 'booking-time-late-slot',
      steps: [earliest, time('3:00 م'), day(1), time('10:00 ص'), earliest, earliest],
    },
    {
      name: 'Next is refused without a time, then allowed after one is chosen',
      scenario: 'booking-time-ready',
      steps: [
        (page) => page.locator(NEXT).click(),
        (page) => page.locator(NEXT).click(),
        day(1),
        (page) => page.locator(NEXT).click(),
        time('2:00 م'),
        toContact,
      ],
    },
    {
      name: 'changing the location keeps the appointment, the price and the day',
      scenario: 'booking-time-slot-chosen',
      steps: [
        changeLocation,
        async (page) => {
          await page.locator('.place-shortcut[data-kind="home"]').click();
          await page.locator('.place-shortcut[data-kind="home"].selected').waitFor();
        },
        nextToTime,
        headerBack(CARD),
        nextToTime,
        async (page) => {
          await page.locator('.booking-total').click();
          await sheetOpen(page);
        },
        async (page) => {
          await page.getByRole('button', { name: 'متابعة الحجز' }).click();
          await sheetClosed(page);
        },
      ],
    },
  ];
  for (const interaction of interactionCases) {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, interaction.scenario);
      await compareSteps(pair.reference, pair.candidate, interaction.name, interaction.steps);
      assert.deepEqual(pair.candidate.problems, [], `${interaction.name}: candidate problems`);
      summary.interactions.push({ name: interaction.name, steps: interaction.steps.length });
    } finally {
      await context.close();
    }
  }

  // 3. Time-of-day rules, with the same instants supplied to both pages.
  const clockCases = [
    {
      name: 'lead time: 10:00 is offered at 09:14:59 and not at 09:15:00',
      at: AT.morningBeforeBoundary,
      steps: [
        day(0),
        time('10:00 ص'),
        setNow(AT.morningAtBoundary),
        // Still drawn from the earlier instant; the tap is judged now.
        day(0),
        earliest,
      ],
    },
    {
      name: 'a chosen time that stops being offered is refused at Next and not replaced',
      at: AT.morningBeforeBoundary,
      steps: [
        day(0),
        time('10:00 ص'),
        setNow(AT.morningAtBoundary),
        (page) => page.locator(NEXT).click(),
        (page) => page.locator(NEXT).click(),
        earliest,
        toContact,
      ],
    },
    {
      name: 'nothing left today: the default day is tomorrow and today says so',
      at: AT.evening,
      steps: [day(0), earliest, day(0), (page) => page.locator(NEXT).click(), day(1)],
    },
    {
      name: 'overnight: tomorrow 08:00 chosen before midnight is still valid after it',
      at: AT.beforeMidnight,
      steps: [time('8:00 ص'), setNow(AT.afterMidnight), toContact],
    },
    {
      name: 'overnight: a time chosen yesterday that has now passed is refused',
      at: AT.noon,
      steps: [
        day(1),
        time('9:00 ص'),
        setNow(AT.nextMorning),
        (page) => page.locator(NEXT).click(),
        day(0),
        time('10:00 ص'),
        toContact,
      ],
    },
    {
      name: 'a day that left the five-day window is refused and shows no times',
      at: AT.noon,
      steps: [
        day(2),
        time('9:00 ص'),
        setNow(AT.sixDaysLater),
        (page) => page.locator(NEXT).click(),
        day(0),
        earliest,
      ],
    },
  ];
  for (const clockCase of clockCases) {
    const context = await newClockContext(browser, 390, clockCase.at);
    try {
      const pair = await openPair(context, server, 'booking-time-ready');
      await compareSteps(pair.reference, pair.candidate, clockCase.name, [
        (page) => page.locator('.dates').waitFor(),
        ...clockCase.steps,
      ]);
      assert.deepEqual(pair.candidate.problems, [], `${clockCase.name}: candidate problems`);
      summary.interactions.push({ name: clockCase.name, steps: clockCase.steps.length });
    } finally {
      await context.close();
    }
  }
  save();

  // 4. The public journey from Home on both pages: start → vehicle → care →
  //    location → time → contact, then back to the time step.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'addresses-one', 'home');
      await compareSteps(pair.reference, pair.candidate, 'journey from Home', [
        async (page) => {
          await page.locator('.hero-cta').click();
          await page.locator('.signature-car').first().waitFor();
        },
        async (page, isReference) => {
          await next(page, isReference);
          await page.locator('.service-option').first().waitFor();
        },
        async (page, isReference) => {
          await next(page, isReference);
          await page.locator(CARD).waitFor();
        },
        nextToTime,
        time('2:00 م'),
        toContact,
        {
          run: async (page) => {
            await page.goBack();
            await page.locator('.dates').waitFor();
          },
        },
        headerBack(CARD),
        nextToTime,
      ]);
      const state = await observe(pair.candidate.page);
      assert.equal(state.summary.chosen, true, 'the appointment survived the round trip');
      assert.equal(state.context, 'المنزل', 'the prefilled saved address is the context');
      assert.deepEqual(pair.candidate.problems, []);
      summary.interactions.push({ name: 'public journey from Home through the time step' });
    } finally {
      await context.close();
    }
  }

  // 5. Repeat: a past order becomes a new draft with the earliest offered time,
  //    not the order's old one. Both pages, then the time step itself.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'home-repeat-order', 'home');
      for (const [target, isReference] of [
        [pair.reference.page, true],
        [pair.candidate.page, false],
      ]) {
        await target.locator('.quick-return').click();
        await target.waitForURL(isReference ? /#book[/]6$/ : /#\/book\/6$/);
        // Open the time step of the same session through its own route.
        await target.evaluate(
          (hash) => {
            globalThis.location.hash = hash;
          },
          isReference ? '#book/3' : '#/book/3',
        );
        await target.locator('.dates').waitFor();
      }
      const candidateState = await observe(pair.candidate.page);
      assert.deepEqual(candidateState, await observe(pair.reference.page), 'repeat: time step');
      assert.equal(
        candidateState.earliest.pressed,
        'true',
        'the repeat offer is the earliest slot',
      );
      assert.equal(candidateState.times.filter((option) => option.selected)[0].text, '1:00 م');
      assert.deepEqual(pair.candidate.problems, []);
      summary.interactions.push({ name: 'repeat offers the earliest time under the same clock' });
    } finally {
      await context.close();
    }
  }

  // 6. Session semantics on the candidate: resume, history, refresh, and nothing
  //    leaving the page or growing.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems, requests } = await openCandidate(
        context,
        origin,
        '/book/3?scenario=addresses-draft-from-book',
        '.dates',
      );
      await page.locator('.booking-footer').waitFor();
      const requestsBefore = requests.length;
      assert.equal((await observe(page)).context, 'مكتب الشركة');

      // A day without a time is incomplete: exit, resume → back on the time step.
      await day(2)(page);
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      await page.locator('[data-home-entry="saved-draft"] .text-btn').click();
      await page.locator('.dates').waitFor();
      assert.match(page.url(), /#\/book\/3$/, 'resume returns to the time step');
      let state = await observe(page);
      assert.deepEqual(
        state.days.map((item) => item.selected),
        [false, false, true, false, false],
        'the highlighted day was kept',
      );
      assert.equal(state.summary.chosen, false);

      // With a time, Next reaches the contact placeholder; Back keeps the choice.
      await toggleTimes(page);
      await time('4:00 م')(page);
      await page.locator(NEXT).click();
      await page.locator('[data-booking-step="contact"]').waitFor();
      assert.match(page.url(), /#\/book\/4$/);
      // Until C011 the contact step was a placeholder; it is now the real screen.
      await page.locator('#name').waitFor();
      assert.equal(await page.locator('.c002-deferred-footer').count(), 0);
      assert.equal(await page.locator('.booking-footer').count(), 1);
      await page.goBack();
      await page.locator('.dates').waitFor();
      state = await observe(page);
      assert.equal(state.times.find((option) => option.selected)?.text, '4:00 م');
      // The expanded list is kept across steps, as the prototype's showAllTimes is.
      assert.equal(state.toggle, 'عرض أوقات أقل');
      assert.equal(state.times.length, 12);

      // A deep link past the time step with no valid time is not honoured by resume.
      await page.goForward();
      await page.locator('[data-booking-step="contact"]').waitFor();
      await page.goBack();
      await page.locator('.dates').waitFor();

      // Changing the place does not touch the appointment, price or address book.
      const priceBefore = state.footerPrice;
      await page.locator(CHANGE).click();
      await page.locator(CARD).waitFor();
      assert.equal(await page.locator('.address-chips .chip').count(), 3);
      await page.locator(NEXT).click();
      await page.locator('.dates').waitFor();
      state = await observe(page);
      assert.equal(state.times.find((option) => option.selected)?.text, '4:00 م');
      assert.equal(state.footerPrice, priceBefore);

      assert.equal(await page.locator('.nav-dot').count(), 0, 'no order was created');
      assert.equal(requests.length, requestsBefore, 'the time step sends no request');
      assert.deepEqual(
        await page.evaluate(() => ({
          local: globalThis.localStorage.length,
          session: globalThis.sessionStorage.length,
          cookies: globalThis.document.cookie,
        })),
        { local: 0, session: 0, cookies: '' },
        'the time step writes no browser storage',
      );

      // A reload starts again from the fixture; an unknown scenario falls back.
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.dates').waitFor();
      assert.equal((await observe(page)).summary.chosen, false, 'the session choice is gone');
      await page.goto(`${origin}/#/book/3?scenario=__proto__`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.dates').waitFor();
      assert.equal((await observe(page)).summary.chosen, false, 'the empty default session');
      assert.deepEqual(problems, []);
      summary.interactions.push({
        name: 'resume, history, change of place; no request, storage or order',
      });
    } finally {
      await context.close();
    }
  }

  // 7. Keyboard, semantics, focus and live regions.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/3?scenario=booking-time-ready',
        '.dates',
      );
      await page.locator('.booking-footer').waitFor();
      const semantics = await page.evaluate(() => {
        const doc = globalThis.document;
        const controls = [...doc.querySelectorAll('.earliest, .date, .time, .center .text-btn')];
        const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id);
        return {
          native: controls.every((node) => node.tagName === 'BUTTON' && node.type === 'button'),
          pressed: controls
            .filter((node) => !node.matches('.text-btn'))
            .every((node) => ['true', 'false'].includes(node.getAttribute('aria-pressed'))),
          groups: [...doc.querySelectorAll('.dates, .times')].map((node) => [
            node.getAttribute('role'),
            node.getAttribute('aria-label'),
          ]),
          expanded: doc.querySelector('.center .text-btn').getAttribute('aria-expanded'),
          summaryLive: doc.querySelector('.selection-summary').getAttribute('aria-live'),
          clickOnly: doc.querySelectorAll('.main [role="button"], .main div[onclick]').length,
          duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        };
      });
      assert.deepEqual(semantics, {
        native: true,
        pressed: true,
        groups: [
          ['group', 'اختر اليوم'],
          ['group', 'الأوقات المتاحة'],
        ],
        expanded: 'false',
        summaryLive: 'polite',
        clickOnly: 0,
        duplicateIds: [],
      });

      // Tab order follows the screen and every stop shows a focus ring.
      await page.locator(CHANGE).focus();
      const order = [];
      for (let i = 0; i < 13; i += 1) {
        await page.keyboard.press('Tab');
        order.push(
          await page.evaluate(() => {
            const element = globalThis.document.activeElement;
            const style = globalThis.getComputedStyle(element);
            const ringed = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
            const kind = element.matches('.earliest')
              ? 'earliest'
              : element.matches('.date')
                ? 'day'
                : element.matches('.time')
                  ? 'time'
                  : element.matches('.center .text-btn')
                    ? 'toggle'
                    : element.className;
            return `${kind}:${ringed ? 'ringed' : 'NO-RING'}`;
          }),
        );
      }
      assert.deepEqual(order, [
        'earliest:ringed',
        ...Array(5).fill('day:ringed'),
        ...Array(6).fill('time:ringed'),
        'toggle:ringed',
      ]);

      // Enter and Space choose; focus stays on the chosen control.
      await page.locator('.date').nth(3).focus();
      await page.keyboard.press('Enter');
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.getAttribute('aria-pressed')),
        'true',
        'the chosen day keeps focus and reports pressed',
      );
      await page.locator('.time').nth(2).focus();
      await page.keyboard.press('Space');
      const focused = await page.evaluate(() => {
        const element = globalThis.document.activeElement;
        return [element?.classList.contains('time'), element?.getAttribute('aria-pressed')];
      });
      assert.deepEqual(focused, [true, 'true'], 'the chosen time keeps focus');
      assert.match(page.url(), /#\/book\/3/, 'choosing a time does not navigate');
      await page.locator(TOGGLE).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator(TOGGLE).getAttribute('aria-expanded'), 'true');
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.matches('.center .text-btn')),
        true,
        'the expand control keeps focus',
      );

      // A refused Next announces the message and moves focus to it.
      await day(4)(page);
      await page.locator(NEXT).click();
      const message = page.locator('#error-time');
      await message.waitFor();
      assert.equal(await message.getAttribute('role'), 'alert');
      await page.waitForFunction(() => globalThis.document.activeElement?.id === 'error-time');
      await time('9:00 ص')(page);
      assert.equal(await message.count(), 0, 'choosing a time clears the message');

      // The price sheet is the existing native dialog; focus returns to its opener.
      await page.locator('.booking-total').focus();
      await page.keyboard.press('Enter');
      await sheetOpen(page);
      assert.equal(
        await page.evaluate(() =>
          globalThis.document.querySelector('dialog.sheet[open]').matches(':modal'),
        ),
        true,
      );
      await page.keyboard.press('Escape');
      await sheetClosed(page);
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.matches('.booking-total')),
        true,
        'focus returns to the total',
      );
      await page.locator('.toast').waitFor({ state: 'attached' });
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'keyboard, semantics, focus and live regions' });
    } finally {
      await context.close();
    }
  }

  // 8. Touch targets, and reduced motion.
  for (const width of [320, 1440]) {
    const context = await newContext(browser, width);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/3?scenario=booking-time-day-chosen',
        '.dates',
      );
      await page.locator('.booking-footer').waitFor();
      const sizes = await page.evaluate(() =>
        [
          ...globalThis.document.querySelectorAll(
            '.earliest, .date, .time, .center .text-btn, .primary-next',
          ),
        ].map((node) => {
          const rect = node.getBoundingClientRect();
          return [node.className, Math.round(rect.width), Math.round(rect.height)];
        }),
      );
      for (const [name, w, h] of sizes) {
        assert.ok(w >= 44 && h >= 44, `${width}px: "${name}" is ${w}×${h}`);
      }
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await newContext(browser, 390, { reducedMotion });
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/3?scenario=booking-time-ready',
        '.dates',
      );
      await page.locator('.booking-footer').waitFor();
      await earliest(page);
      const running = await page.evaluate(
        () => globalThis.document.querySelector('.earliest').getAnimations().length,
      );
      assert.equal(running > 0, reducedMotion !== 'reduce', `feedback with ${reducedMotion}`);
      assert.equal((await observe(page)).earliest.pressed, 'true');
      await page.locator(NEXT).click();
      await page.locator('[data-booking-step="contact"]').waitFor();
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
  summary.interactions.push({ name: 'touch targets at 320 and 1440; reduced motion' });

  save();
  console.log(
    `C010 browser acceptance passed: ${summary.visual.length} visual comparisons, ` +
      `${summary.interactions.length} interaction checks. Evidence: ${evidence}`,
  );
} catch (error) {
  save();
  console.error(`C010 evidence directory: ${evidence}`);
  throw error;
} finally {
  await server.close();
  await browser.close();
}
