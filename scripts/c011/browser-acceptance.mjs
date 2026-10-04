// C011 browser acceptance: renders the React contact step next to the approved
// customer HTML in the same browser, compares structure, copy, geometry,
// computed style and pixels, then applies the same interactions to both.
//
// Methodology and helpers are those of the C004 acceptance (scripts/c004). The
// reference is served read-only and is never modified.
//
// Ownership declared before any comparison: C011 owns the whole contact step
// (`#/book/4`; `#book/4` in the prototype), compared full-page. C012 owns the
// Payment screen; C011 checks it only as the destination of a valid Contact Next.
//
// Booking time is the rendering contract's fixed instant (12:00 in Damascus,
// 2026-09-20), under which the fixtures' appointment is offered. Interaction
// timing (`performance.now()`) is never frozen: the prototype's 350 ms Next
// guard is waited out on its own clock.
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
  screenshotOptions,
  settle,
  snapshot,
} from '../c004/parity-harness.mjs';
import {
  demoFilled,
  fillConfirmed,
  focusLanded,
  withFailureEvidence,
} from './contact-input-helpers.mjs';

const origin = process.env.C011_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C011_EVIDENCE_DIR
  ? resolve(process.env.C011_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c011-'));
mkdirSync(evidence, { recursive: true });

const PARITY_SELECTORS = [
  'body',
  '.app',
  '.app-header',
  '.main',
  '.journey-heading',
  '.stepper',
  '.page-heading',
  '.page-heading h1',
  '.page-heading p',
  '.page-heading .chapter-icon',
  '.page-heading .chapter-icon .icon',
  '.main .field',
  '.main .field-label',
  '.main .field-label small',
  '.main .input',
  '.main .error',
  '.main .row.between',
  '.main .input-note',
  '.main .text-btn',
  '.optional-details',
  '.optional-details summary',
  '.optional-details summary .tiny',
  '.optional-details textarea',
  '.main .info-note',
  '.main .info-note .icon',
  '.main .info-note span',
  '.booking-footer',
  '.footer-assurance span',
  '.booking-total',
  '.booking-total strong',
  '.primary-next',
  '.toast',
  'dialog.sheet[open]',
  'dialog.sheet[open] .sheet-head h2',
  'dialog.sheet[open] .bill',
  'dialog.sheet[open] .bill-line',
  'dialog.sheet[open] .btn',
];

const NEXT = '.primary-next';
const NAME = '#name';
const PHONE = '#phone';
const NOTE = '#note';
const DEMO = '.row.between .text-btn';
const SUMMARY = '.optional-details summary';

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
const next = async (page, isReference) => {
  if (isReference) await pastReferenceNextGuard(page);
  await page.locator(NEXT).click();
};

const fill = (selector, value) => (page) => page.locator(selector).fill(value);
/** Real key-by-key typing at the end of the current value. */
const typeInto = (selector, text) => async (page) => {
  await page.locator(selector).click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
};
/** A paste: the whole text arrives as one insertion. */
const paste = (selector, text) => async (page) => {
  await page.locator(selector).click();
  await page.keyboard.insertText(text);
};
const demo = (page) => page.locator(DEMO).click();

const toggleNote = (page) => page.locator(SUMMARY).click();
/**
 * A Next that the page refuses. Both pages move focus to the first invalid field
 * a frame after showing the messages; the next action waits for that focus so it
 * cannot race it (see contact-input-helpers.mjs).
 */
const refusedNext = async (page) => {
  await page.locator(NEXT).click();
  await page.waitForFunction(
    () => {
      const first = globalThis.document.querySelector('.main .error');
      return first !== null && globalThis.document.activeElement?.id === first.id.slice(6);
    },
    undefined,
    { timeout: 5000 },
  );
};
const sheetOpen = (page) => page.locator('dialog.sheet[open]').waitFor();
const sheetClosed = (page) => page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });

const routes = {
  contact: { hash: '#book/4', path: '/book/4', screen: 'booking', step: 4, ready: NAME },
  home: { hash: '#home', path: '/', screen: 'home', step: 0, ready: '.hero-cta' },
};

async function openPair(context, server, scenario, where = 'contact') {
  const route = routes[where];
  const state = initialSessionState(`#/?scenario=${scenario}`);
  const storage = referenceStorageFor(state, { screen: route.screen, step: route.step });
  storage.cars = state.vehicles.map((vehicle) => ({ ...vehicle }));
  storage.addresses = state.addresses.map((record) => ({ ...record }));
  storage.draft.carId = state.draft.carId;
  storage.draft.place = state.draft.place ? { ...state.draft.place } : null;
  storage.draft.saveAddress = state.draft.saveAddress;
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
  if (where === 'contact') await candidate.page.locator('.booking-footer').waitFor();
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
    const toast = doc.querySelector('.toast');
    const sheet = doc.querySelector('dialog.sheet[open]');
    const input = (selector) => {
      const node = doc.querySelector(selector);
      return node
        ? {
            value: node.value,
            invalid: node.getAttribute('aria-invalid'),
            describedBy: node.getAttribute('aria-describedby'),
            type: node.type,
            inputMode: node.getAttribute('inputmode'),
            maxLength: node.maxLength,
            placeholder: node.placeholder,
          }
        : null;
    };
    const active = doc.activeElement;
    return {
      route: route === '#' || route === '' ? '#home' : route,
      heading: text('.main h1'),
      labels: [...doc.querySelectorAll('.main .field-label')].map((node) =>
        clean(node.textContent),
      ),
      name: input('#name'),
      phone: input('#phone'),
      note: input('#note'),
      noteOpen: doc.querySelector('.optional-details')?.open ?? null,
      errors: [...doc.querySelectorAll('.main .error')].map((node) => [
        node.id,
        clean(node.textContent),
      ]),
      // Which form control has focus. Two documented differences are left out here
      // and asserted on the port separately: route-entry focus on the heading (on a
      // first load the port keeps the skip link first, C003), and the demo button,
      // which keeps focus in the port where the prototype's redraw drops it.
      // Earlier steps' controls are covered by their own sprints' acceptance.
      focused: active?.matches('#name, #phone, #note, .optional-details summary')
        ? active.id || active.className
        : null,
      hint: text('.main .input-note'),
      info: text('.main .info-note'),
      footerPrice: text('#footer-price'),
      footerDuration: text('.footer-assurance span:last-child'),
      nextLabel: text('.primary-next'),
      // The last notice raised, whether or not it is still on screen (see C005).
      toast: (toast && clean(toast.textContent)) || null,
      sheet: sheet ? text('.sheet-head h2', sheet) : null,
    };
  });
}

const noticeGone = (page) => page.waitForTimeout(4400);

/** Screens compared visually. `prepare` runs the same steps on both pages. */
const visualStates = [
  { id: 'contact-blank', scenario: 'booking-contact-ready' },
  { id: 'contact-prefilled', scenario: 'booking-contact-prefilled' },
  {
    id: 'contact-demo-filled',
    scenario: 'booking-contact-ready',
    prepare: async (page) => {
      await demo(page);
      await demoFilled(page);
      await noticeGone(page);
    },
  },
  {
    id: 'contact-note-open',
    scenario: 'booking-contact-prefilled',
    prepare: async (page) => {
      await toggleNote(page);
      await page.locator('.optional-details[open]').waitFor();
    },
  },
  {
    id: 'contact-long-values-note-open',
    scenario: 'booking-contact-long',
    prepare: async (page) => {
      await toggleNote(page);
      await page.locator('.optional-details[open]').waitFor();
    },
  },
  {
    id: 'contact-both-errors',
    scenario: 'booking-contact-ready',
    prepare: async (page) => {
      await refusedNext(page);
      await page.locator('#error-phone').waitFor();
      // The first field is scrolled to; wait for the same resting position on both.
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'contact-phone-error',
    scenario: 'booking-contact-ready',
    prepare: async (page) => {
      await fillConfirmed(NAME, 'سامر', { errorShown: false })(page);
      await fillConfirmed(PHONE, '12345', { errorShown: false })(page);
      await refusedNext(page);
      await page.locator('#error-phone').waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'contact-errors-corrected',
    scenario: 'booking-contact-ready',
    prepare: async (page) => {
      await refusedNext(page);
      await page.locator('#error-phone').waitFor();
      // The refusal moves focus to the first invalid field in a later frame; let it
      // land before typing so it cannot move focus away during the fills.
      await focusLanded(page, 'name');
      await fillConfirmed(NAME, 'سامر', { errorShown: false })(page);
      await fillConfirmed(PHONE, '0912 345 678', { errorShown: false })(page);
      await page.locator(NEXT).focus();
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'contact-price-details',
    scenario: 'booking-contact-prefilled',
    prepare: async (page) => {
      await page.locator('.booking-total').click();
      await sheetOpen(page);
    },
  },
];
const shortStates = [
  { ...visualStates[0], id: 'short-contact-blank' },
  { ...visualStates[5], id: 'short-contact-both-errors' },
];
const SHORT_HEIGHT = 560;

/** Screenshots and observed state of both pages, for a failure before the pixel stage. */
async function writeFailureEvidence(label, referencePage, candidatePage) {
  for (const [side, page] of [
    ['reference', referencePage],
    ['candidate', candidatePage],
  ]) {
    writeFileSync(
      resolve(evidence, `${label}.${side}.failure.png`),
      await page.screenshot(screenshotOptions),
    );
    writeFileSync(
      resolve(evidence, `${label}.${side}.failure.json`),
      `${JSON.stringify(await observe(page), null, 2)}\n`,
    );
  }
}

async function compareVisual(browser, server, visual, width, height, summary) {
  const label = `${visual.id}@${width}`;
  const context = await newContext(browser, width, height ? { height } : {});
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
    await withFailureEvidence(
      async () => {
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
      },
      () => writeFailureEvidence(label, reference.page, candidate.page),
      (message) => console.error(`${label}: ${message}`),
    );
    const pixels = await comparePixels(browser, reference.page, candidate.page, evidence, label);
    summary.visual.push({ state: visual.id, width, height: height ?? contract.height, ...pixels });
    assert.deepEqual(reference.problems, [], `${label}: reference page problems`);
    assert.deepEqual(candidate.problems, [], `${label}: candidate page problems`);
  } finally {
    await context.close();
  }
}

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

// C012 owns Payment: this earlier suite compares only the destination route.
const toPayment = {
  only: ['route'],
  run: async (page, isReference) => {
    await next(page, isReference);
    await page.waitForURL(isReference ? /#book[/]5$/ : /#\/book\/5$/);
  },
};

const summary = { evidence, visual: [], interactions: [] };
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const server = await startReferenceServer();
const save = () =>
  writeFileSync(resolve(evidence, 'c011-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
try {
  // 1. Visual parity.
  for (const visual of visualStates) {
    for (const width of contract.viewports) {
      await compareVisual(browser, server, visual, width, undefined, summary);
    }
  }
  for (const visual of shortStates) {
    await compareVisual(browser, server, visual, 390, SHORT_HEIGHT, summary);
  }
  save();

  // 2. Interaction parity.
  const interactionCases = [
    {
      name: 'typing keeps the values as typed and Next validates them',
      scenario: 'booking-contact-ready',
      steps: [
        typeInto(NAME, 'س'),
        refusedNext,
        typeInto(NAME, 'ا'),
        refusedNext,
        typeInto(PHONE, '0912 345'),
        refusedNext,
        typeInto(PHONE, ' 678'),
        toPayment,
      ],
    },
    {
      name: 'editing a field clears only its own message, before any new check',
      scenario: 'booking-contact-ready',
      steps: [
        refusedNext,
        typeInto(PHONE, '1'),
        typeInto(NAME, 'م'),
        refusedNext,
        fill(NAME, '   '),
        fill(PHONE, '+963 (11) 000-0000'),
        refusedNext,
        fill(NAME, ' ع '),
        refusedNext,
        fill(NAME, 'علي'),
        toPayment,
      ],
    },
    {
      name: 'phone rule: digit families, separators, plus and boundaries',
      scenario: 'booking-contact-prefilled',
      steps: [fill(PHONE, '1234567'), refusedNext, fill(PHONE, '12345678'), toPayment],
    },
    {
      name: 'phone rule: Arabic-Indic and Eastern Arabic-Indic digits are accepted',
      scenario: 'booking-contact-prefilled',
      steps: [fill(PHONE, '٠٩١٢-٣٤٥-۶۷۸'), toPayment],
    },
    {
      name: 'phone rule: letters, an inner plus and more than fifteen digits are refused',
      scenario: 'booking-contact-prefilled',
      steps: [
        fill(PHONE, '0912abc678'),
        refusedNext,
        fill(PHONE, '0912+345678'),
        refusedNext,
        fill(PHONE, '++963912345678'),
        refusedNext,
        fill(PHONE, '1234567890123456'),
        refusedNext,
        fill(PHONE, '+123456789012345'),
        toPayment,
      ],
    },
    {
      name: 'the demo fill sets name and number, keeps the note and closes the disclosure',
      scenario: 'booking-contact-ready',
      steps: [
        refusedNext,
        toggleNote,
        fill(NOTE, 'سطر أول\nسطر ثانٍ'),
        demo,
        toggleNote,
        toggleNote,
        toPayment,
      ],
    },
    {
      name: 'a refused Next closes an open note disclosure without losing its text',
      scenario: 'booking-contact-prefilled',
      steps: [toggleNote, fill(NAME, 'س'), refusedNext, toggleNote],
    },
    {
      name: 'paste, limits and the note are kept as typed',
      scenario: 'booking-contact-ready',
      steps: [
        paste(NAME, 'Sam سامر ' + 'ع'.repeat(70)),
        paste(PHONE, '0912 345 678 999 888 777 666 555'),
        toggleNote,
        paste(NOTE, 'م'.repeat(320)),
        refusedNext,
      ],
    },
    {
      name: 'Back returns to the time step with the appointment; Next comes back',
      scenario: 'booking-contact-prefilled',
      steps: [
        fill(NAME, 'اسم معدّل'),
        async (page) => {
          await page.getByRole('button', { name: 'الخطوة السابقة', exact: true }).click();
          await page.locator('.dates').waitFor();
        },
        async (page, isReference) => {
          await next(page, isReference);
          await page.locator(NAME).waitFor();
        },
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
  save();

  // 3. The public journey from Home to the contact step and on to payment.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'home-empty', 'home');
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
          await page.locator('.location-picker').waitFor();
        },
        async (page) => {
          await page.locator('.place-shortcut[data-kind="work"]').click();
          await page.locator('.place-shortcut[data-kind="work"].selected').waitFor();
        },
        async (page, isReference) => {
          await next(page, isReference);
          await page.locator('.dates').waitFor();
        },
        (page) => page.locator('.earliest').click(),
        async (page, isReference) => {
          await next(page, isReference);
          await page.locator(NAME).waitFor();
        },
        // The prototype accepted a Next a moment ago; a refused Next must come after
        // its guard interval or the prototype would ignore it rather than validate.
        (page, isReference) => next(page, isReference),
        demo,
        toPayment,
      ]);
      assert.deepEqual(pair.candidate.problems, []);
      summary.interactions.push({ name: 'public journey from Home through the contact step' });
    } finally {
      await context.close();
    }
  }

  // 4. Session semantics on the candidate.
  // Direct links and browser history must not bypass the prerequisite screens.
  for (const [scenario, destination, ready] of [
    ['home-empty', 2, '.location-picker'],
    ['booking-vehicle-invalid-plate', 0, '.signature-car'],
    ['booking-time-ready', 3, '.dates'],
    ['booking-time-day-chosen', 3, '.dates'],
    ['booking-contact-prefilled', 4, NAME],
  ]) {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        `/book/4?scenario=${scenario}`,
        ready,
      );
      assert.equal(new URL(page.url()).hash.split('?')[0], `#/book/${destination}`);
      assert.equal(await page.locator(NAME).count(), destination === 4 ? 1 : 0);
      // A replaced invalid entry must stay corrected on reload and forward.
      if (destination !== 4) {
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator(ready).first().waitFor();
        assert.equal(new URL(page.url()).hash, `#/book/${destination}`);
        await page.goto(`${origin}/#/`, { waitUntil: 'networkidle' });
        await page.goBack();
        await page.goForward();
        await page.goBack();
        await page.locator(ready).first().waitFor();
        assert.equal(new URL(page.url()).hash, `#/book/${destination}`);
      }
      assert.deepEqual(problems, []);
      summary.interactions.push({
        name: `direct Contact entry: ${scenario} reaches ${destination}`,
      });
    } finally {
      await context.close();
    }
  }
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: contract.height },
      locale: contract.locale,
      timezoneId: contract.timezoneId,
      reducedMotion: contract.reducedMotion,
    });
    try {
      await context.addInitScript(() => {
        const NativeDate = globalThis.Date;
        const expired = '2026-09-30T09:00:00.000Z';
        class FixedDate extends NativeDate {
          constructor(...args) {
            super(...(args.length ? args : [expired]));
          }
          static now() {
            return new NativeDate(expired).getTime();
          }
        }
        globalThis.Date = FixedDate;
      });
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/4?scenario=booking-contact-prefilled',
        '.dates',
      );
      // The bookmarked draft's appointment is no longer offered at this instant.
      assert.equal(new URL(page.url()).hash, '#/book/3');
      assert.equal(await page.locator(NAME).count(), 0);
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'expired Contact bookmark returns to scheduling' });
    } finally {
      await context.close();
    }
  }
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems, requests } = await openCandidate(
        context,
        origin,
        '/book/4?scenario=booking-contact-prefilled',
        NAME,
      );
      await page.locator('.booking-footer').waitFor();
      const requestsBefore = requests.length;
      const priceBefore = (await observe(page)).footerPrice;

      // The technician note and the address access note stay independent.
      await toggleNote(page);
      await fill(NOTE, 'ملاحظة جديدة للفني')(page);
      await page.getByRole('button', { name: 'الخطوة السابقة', exact: true }).click();
      await page.locator('.dates').waitFor();
      await page.locator('.choice-context .text-btn').click();
      await page.locator('.location-picker').waitFor();
      assert.equal(
        (await page.locator('.selection-summary').innerText()).trim(),
        'أمام البوابة',
        'the access note is untouched by the technician note',
      );
      await page.locator(NEXT).click();
      await page.locator('.dates').waitFor();
      await page.locator(NEXT).click();
      await page.locator(NAME).waitFor();
      let state = await observe(page);
      assert.equal(state.note.value, 'ملاحظة جديدة للفني');
      assert.equal(state.footerPrice, priceBefore, 'contact details do not change the price');

      // Exit and resume return to the contact step with the values as typed.
      await fill(NAME, '  ريم  ')(page);
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      await page.locator('[data-home-entry="saved-draft"] .text-btn').click();
      await page.locator(NAME).waitFor();
      assert.match(page.url(), /#\/book\/4$/);
      state = await observe(page);
      assert.equal(state.name.value, '  ريم  ', 'the name is kept as typed');
      assert.equal(state.phone.value, '+963 (11) 000-0000', 'the number keeps its formatting');

      // Valid Next reaches the real C012 Payment screen; Back keeps everything.
      await page.locator(NEXT).click();
      await page.locator('[data-booking-step="payment"]').waitFor();
      await page.locator('.booking-payment-step').waitFor();
      assert.match(page.url(), /#\/book\/5$/);
      assert.equal(
        await page.locator('.c002-deferred-footer').count(),
        0,
        'payment owns its footer',
      );
      assert.equal(
        await page.locator('.booking-footer').count(),
        1,
        'payment renders the booking footer',
      );
      await page.goBack();
      await page.locator(NAME).waitFor();
      assert.equal((await observe(page)).name.value, '  ريم  ');

      // Markup typed by the customer stays text.
      await fill(NAME, '<img src=x onerror="globalThis.__xss=1">')(page);
      assert.deepEqual(
        await page.evaluate(() => ({
          injected: globalThis.document.querySelectorAll('.main img').length,
          ran: globalThis.__xss ?? null,
        })),
        { injected: 0, ran: null },
      );

      // Nothing leaves the page or is stored; no order or profile appears.
      assert.equal(await page.locator('.nav-dot').count(), 0, 'no order was created');
      assert.equal(requests.length, requestsBefore, 'the contact step sends no request');
      assert.deepEqual(
        await page.evaluate(() => ({
          local: globalThis.localStorage.length,
          session: globalThis.sessionStorage.length,
          cookies: globalThis.document.cookie,
          url: globalThis.location.href.includes('ريم') || globalThis.location.href.includes('963'),
        })),
        { local: 0, session: 0, cookies: '', url: false },
        'no storage, no contact data in the URL',
      );
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      await page.locator('.nav-btn', { hasText: 'حسابي' }).click();
      await page.locator('.profile-hero').waitFor();
      assert.equal(
        (await page.locator('.profile-hero h2').innerText()).trim(),
        'أهلاً بك في WashGo',
        'the account profile is not written by the contact step',
      );

      // A reload starts again from the fixture.
      await page.goto(`${origin}/#/book/4?scenario=booking-contact-prefilled`);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator(NAME).waitFor();
      assert.equal((await observe(page)).name.value, 'ريم التجريبية');
      assert.deepEqual(problems, []);
      summary.interactions.push({
        name: 'notes kept apart, exit/resume, history; no request, storage, order or profile write',
      });
    } finally {
      await context.close();
    }
  }

  // 5. Semantics, keyboard and focus.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/4?scenario=booking-contact-ready',
        NAME,
      );
      await page.locator('.booking-footer').waitFor();
      const semantics = await page.evaluate(() => {
        const doc = globalThis.document;
        const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id);
        const named = (selector) => {
          const node = doc.querySelector(selector);
          return node.labels?.[0]?.textContent.replace(/\s+/g, ' ').trim() ?? null;
        };
        return {
          name: named('#name'),
          phone: named('#phone'),
          note: named('#note'),
          phoneType: doc.querySelector('#phone').type,
          phoneMode: doc.querySelector('#phone').getAttribute('inputmode'),
          phoneDirection: globalThis.getComputedStyle(doc.querySelector('#phone')).direction,
          disclosure: doc.querySelector('.optional-details').tagName,
          duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        };
      });
      assert.deepEqual(semantics, {
        name: 'الاسممطلوب',
        phone: 'رقم التواصلمطلوب',
        note: 'ملاحظة للفني',
        phoneType: 'tel',
        phoneMode: 'tel',
        phoneDirection: 'ltr',
        disclosure: 'DETAILS',
        duplicateIds: [],
      });

      // The demo fill keeps focus on its button (the prototype's redraw drops it).
      await page.locator(DEMO).focus();
      await page.keyboard.press('Enter');
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.matches('.row .text-btn')),
        true,
      );
      await fill(NAME, '')(page);
      await fill(PHONE, '')(page);

      // A refused Next marks both fields, links the messages and focuses the first.
      await page.locator(NEXT).click();
      await page.waitForFunction(() => globalThis.document.activeElement?.id === 'name');
      let state = await observe(page);
      assert.deepEqual(
        [state.name.invalid, state.name.describedBy, state.phone.invalid, state.phone.describedBy],
        ['true', 'error-name', 'true', 'error-phone'],
      );
      assert.equal(await page.locator('#error-name').getAttribute('role'), 'alert');
      // A valid name with an invalid number focuses the number.
      await fill(NAME, 'سامر')(page);
      await page.locator(NEXT).click();
      await page.waitForFunction(() => globalThis.document.activeElement?.id === 'phone');

      // Tab order and focus rings; the disclosure opens with the keyboard.
      await page.locator(NAME).focus();
      const order = [];
      for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press('Tab');
        order.push(
          await page.evaluate(() => {
            const element = globalThis.document.activeElement;
            const style = globalThis.getComputedStyle(element);
            const ringed = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
            const kind = element.id || (element.matches('.text-btn') ? 'demo' : element.tagName);
            return `${kind.toLowerCase()}:${ringed ? 'ringed' : 'NO-RING'}`;
          }),
        );
      }
      assert.deepEqual(order, ['phone:ringed', 'demo:ringed', 'summary:ringed']);
      await page.locator(SUMMARY).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.optional-details').evaluate((node) => node.open), true);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => globalThis.document.activeElement?.id), 'note');
      await page.keyboard.type('سطر\nسطر');
      state = await observe(page);
      assert.equal(state.note.value, 'سطر\nسطر', 'Enter in the note adds a line, not a submit');
      assert.match(page.url(), /#\/book\/4/);
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'semantics, keyboard and focus' });
    } finally {
      await context.close();
    }
  }

  // 6. Touch targets and reduced motion.
  for (const width of [320, 1440]) {
    const context = await newContext(browser, width);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/4?scenario=booking-contact-ready',
        NAME,
      );
      await page.locator('.booking-footer').waitFor();
      const sizes = await page.evaluate(() =>
        [
          ...globalThis.document.querySelectorAll(
            '.main .input, .main .text-btn, .optional-details summary, .primary-next',
          ),
        ].map((node) => {
          const rect = node.getBoundingClientRect();
          return [
            node.id || node.className || node.tagName,
            Math.round(rect.width),
            Math.round(rect.height),
          ];
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
        '/book/4?scenario=booking-contact-ready',
        NAME,
      );
      await page.locator('.booking-footer').waitFor();
      await demo(page);
      await page.locator(NEXT).click();
      await page.locator('[data-booking-step="payment"]').waitFor();
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
  summary.interactions.push({ name: 'touch targets at 320 and 1440; reduced motion' });

  save();
  console.log(
    `C011 browser acceptance passed: ${summary.visual.length} visual comparisons, ` +
      `${summary.interactions.length} interaction checks. Evidence: ${evidence}`,
  );
} catch (error) {
  save();
  console.error(`C011 evidence directory: ${evidence}`);
  throw error;
} finally {
  await server.close();
  await browser.close();
}
