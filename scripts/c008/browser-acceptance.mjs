// C008 browser acceptance: renders the React location step, its address sheet and
// the illustrative map next to the approved customer HTML in the same browser,
// compares structure, copy, geometry, computed style and pixels, then applies the
// same interactions to both.
//
// Methodology and helpers are those of the C004 acceptance (scripts/c004). The
// reference is served read-only and is never modified.
//
// Device location is never real here: Playwright supplies a made-up position (or
// none), and two cases replace the browser API with a stub.
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

const origin = process.env.C008_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C008_EVIDENCE_DIR
  ? resolve(process.env.C008_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c008-'));
mkdirSync(evidence, { recursive: true });

const PARITY_SELECTORS = [
  'body',
  '.app',
  '.main',
  '.journey-heading',
  '.stepper',
  '.step-segment',
  '.page-heading',
  '.page-heading h1',
  '.page-heading p',
  '.page-heading .chapter-icon',
  '.location-picker',
  '.signature-map',
  '.signature-map > svg',
  '.map-radius',
  '.mini-map-pin',
  '.mini-map-pin .icon',
  '.map-mini-note',
  '.map-open-icon',
  '.map-open-icon .icon',
  '.location-picker .disclosure-row',
  '.location-picker .soft-icon',
  '.location-picker .soft-icon .icon',
  '.location-picker .grow',
  '.location-picker strong',
  '.address-preview',
  '.location-picker .disclosure-row > .icon',
  '.main .error',
  '.mini-title',
  '.mini-title small',
  '.location-shortcuts',
  '.place-shortcut',
  '.place-shortcut .chapter-icon',
  '.place-shortcut .chapter-icon .icon',
  '.place-shortcut strong',
  '.place-shortcut small',
  '.place-shortcut > .icon',
  '.location-tip',
  '.location-tip .icon',
  '.location-tip span',
  '.selection-summary',
  '.selection-summary .icon',
  '.booking-footer',
  '.footer-assurance span',
  '.booking-total',
  '.booking-total strong',
  '.primary-next',
  '.toast',
  'dialog.sheet[open]',
  'dialog.sheet[open] .sheet-inner',
  'dialog.sheet[open] .sheet-handle',
  'dialog.sheet[open] .sheet-head',
  'dialog.sheet[open] .sheet-head h2',
  'dialog.sheet[open] .sheet-head .icon-btn',
  'dialog.sheet[open] .sheet-intro',
  'dialog.sheet[open] .location-map',
  'dialog.sheet[open] .map-world',
  'dialog.sheet[open] .map-world > svg',
  'dialog.sheet[open] .map-pin',
  'dialog.sheet[open] .map-pin svg',
  'dialog.sheet[open] .map-controls',
  'dialog.sheet[open] .map-controls button',
  'dialog.sheet[open] .map-controls .icon',
  'dialog.sheet[open] .map-location-button',
  'dialog.sheet[open] .map-location-button .icon',
  'dialog.sheet[open] .map-caption',
  'dialog.sheet[open] .map-help',
  'dialog.sheet[open] .map-help .icon',
  'dialog.sheet[open] .map-help span',
  'dialog.sheet[open] form',
  'dialog.sheet[open] .field',
  'dialog.sheet[open] .field-label',
  'dialog.sheet[open] .field-label small',
  'dialog.sheet[open] .input',
  'dialog.sheet[open] .chips',
  'dialog.sheet[open] .chip',
  'dialog.sheet[open] .chip .icon',
  'dialog.sheet[open] .two-fields',
  'dialog.sheet[open] .checkbox-row',
  'dialog.sheet[open] .checkbox-row input',
  'dialog.sheet[open] .error',
  'dialog.sheet[open] .btn',
  'dialog.sheet[open] .btn .icon',
];

const NEXT = '.primary-next';
const CARD = '.location-picker';
const MAP = '#location-map';
const ADDRESS = '#sheet-address';
const LABEL = 'input[name="addressLabel"]';
const NOTE = 'input[name="locationNote"]';
const SAVE = 'input[name="saveAddress"]';
const LOCATE = '.map-location-button';
const SUBMIT = 'اعتماد هذا المكان';
const shortcut = (kind) => `.place-shortcut[data-kind="${kind}"]`;
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
const sheetOpen = (page) => page.locator('dialog.sheet[open]').waitFor();
const sheetClosed = (page) => page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });
const openSheet = async (page) => {
  await page.locator(CARD).click();
  await sheetOpen(page);
  await page.locator(MAP).waitFor();
};
const submitSheet = (page) => page.getByRole('button', { name: SUBMIT }).click();
const acceptSheet = async (page) => {
  await submitSheet(page);
  await sheetClosed(page);
};
const chooseShortcut = (kind) => async (page) => {
  await page.locator(shortcut(kind)).click();
  await page.locator(`${shortcut(kind)}.selected`).waitFor();
};
const sheetSample = (name) => (page) => page.getByRole('button', { name, exact: true }).click();
const fill = (selector, value) => (page) => page.locator(selector).fill(value);
const zoomIn = (page) => page.getByRole('button', { name: 'تكبير الخريطة' }).click();
const zoomOut = (page) => page.getByRole('button', { name: 'تصغير الخريطة' }).click();
const times = (count, step) => async (page) => {
  for (let i = 0; i < count; i += 1) await step(page);
};

/** A point inside the map, as fractions of its box, in page coordinates. */
async function mapPoint(page, fx, fy) {
  const box = await page.locator(MAP).boundingBox();
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}
const tapMap = (fx, fy) => async (page) => {
  const point = await mapPoint(page, fx, fy);
  await page.mouse.click(point.x, point.y);
};
const dragMap = (fx, fy, dx, dy) => async (page) => {
  const from = await mapPoint(page, fx, fy);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
};
const mapKey = (key) => async (page) => {
  await page.locator(MAP).focus();
  await page.keyboard.press(key);
};
const ctrlWheel = (deltaY) => async (page) => {
  const point = await mapPoint(page, 0.5, 0.6);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await page.waitForTimeout(60);
};
/** Tap "موقعي الحالي" and wait until the answer has been shown. */
const locate = (notice) => async (page) => {
  await page.locator(LOCATE).click();
  await page.waitForFunction(
    (text) => globalThis.document.querySelector('.toast')?.textContent.includes(text),
    notice,
  );
  await page.locator(`${LOCATE}:not([disabled])`).waitFor();
};

// Made-up device positions. IN_RANGE sits inside the range the reference accepts;
// OUT_OF_RANGE is the Gulf of Guinea. Neither is anyone's location.
const IN_RANGE = { latitude: 24.7001, longitude: 46.6502 };
const OUT_OF_RANGE = { latitude: 0, longitude: 0 };

async function openPair(context, server, scenario) {
  const state = initialSessionState(`#/?scenario=${scenario}`);
  const storage = referenceStorageFor(state, { screen: 'booking', step: 2 });
  storage.cars = state.vehicles.map((vehicle) => ({ ...vehicle }));
  storage.draft.carId = state.draft.carId;
  storage.draft.place = state.draft.place ? { ...state.draft.place } : null;
  storage.draft.saveAddress = state.draft.saveAddress;
  const reference = await openReference(context, server, storage, '#book/2');
  await reference.page.locator(CARD).waitFor();
  const candidate = await openCandidate(context, origin, `/book/2?scenario=${scenario}`, CARD);
  await candidate.page.locator('.booking-footer').waitFor();
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
    const route = globalThis.location.hash.split('?')[0];
    const sheet = doc.querySelector('dialog.sheet[open]');
    const toast = doc.querySelector('.toast');
    const card = doc.querySelector('.location-picker');
    const map = sheet?.querySelector('#location-map');
    return {
      step: /book[/]\d+/.exec(route)?.[0] ?? 'other',
      card: card
        ? {
            label: card.getAttribute('aria-label'),
            title: text('strong', card),
            preview: text('.address-preview', card),
            note: text('.map-mini-note', card),
          }
        : null,
      stepError: text('.main .error'),
      shortcuts: [...doc.querySelectorAll('.place-shortcut')].map((node) => ({
        kind: node.dataset.kind,
        selected: node.classList.contains('selected'),
        text: clean(node.textContent),
      })),
      tip: text('.location-tip'),
      accessNote: text('.selection-summary'),
      footerPrice: text('#footer-price'),
      footerDuration: text('.footer-assurance span:last-child'),
      nextLabel: text('.primary-next'),
      // The last notice raised, whether or not it is still on screen (see C005).
      toast: (toast && clean(toast.textContent)) || null,
      sheet: sheet
        ? {
            title: text('.sheet-head h2', sheet),
            intro: text('.sheet-intro', sheet),
            map: map
              ? {
                  label: map.getAttribute('aria-label'),
                  role: map.getAttribute('role'),
                  tabindex: map.getAttribute('tabindex'),
                  world: map.querySelector('#map-world').style.transform,
                  pin: [
                    map.querySelector('#map-pin').style.left,
                    map.querySelector('#map-pin').style.top,
                  ],
                  caption: text('.map-caption', map),
                  locate: text('.map-location-button', map),
                  locateDisabled: map.querySelector('.map-location-button').disabled,
                  zoomLabels: [...map.querySelectorAll('.map-controls button')].map((button) =>
                    button.getAttribute('aria-label'),
                  ),
                }
              : null,
            pinDescription: text('#pin-description', sheet),
            fields: [...sheet.querySelectorAll('.field')].map((field) => {
              const input = field.querySelector('input');
              return {
                label: text('.field-label', field),
                name: input.name,
                value: input.value,
                maxLength: input.maxLength,
                placeholder: input.placeholder,
              };
            }),
            chips: [...sheet.querySelectorAll('.chip')].map((chip) => clean(chip.textContent)),
            save: sheet.querySelector('input[name="saveAddress"]')
              ? {
                  checked: sheet.querySelector('input[name="saveAddress"]').checked,
                  label: text('.checkbox-row', sheet),
                }
              : null,
            error: text('#address-error', sheet),
            buttons: [...sheet.querySelectorAll('.btn')].map((button) => clean(button.textContent)),
          }
        : null,
    };
  });
}

/** Screens compared visually. `prepare` runs the same steps on both pages. */
const visualStates = [
  { id: 'location-empty', scenario: 'home-empty' },
  { id: 'location-sample-work', scenario: 'booking-location-sample-work' },
  { id: 'location-map-point', scenario: 'booking-location-map-point' },
  { id: 'location-long-address-and-note', scenario: 'booking-location-manual-note' },
  {
    id: 'location-validation-error',
    scenario: 'home-empty',
    prepare: async (page) => {
      await page.locator(NEXT).click();
      await page.locator('.main .error').waitFor();
      // The message is scrolled to; wait for the same resting position on both.
      await page.waitForTimeout(500);
    },
  },
  { id: 'sheet-empty', scenario: 'home-empty', prepare: openSheet },
  { id: 'sheet-map-point', scenario: 'booking-location-map-point', prepare: openSheet },
  {
    id: 'sheet-long-address-and-note',
    scenario: 'booking-location-manual-note',
    prepare: openSheet,
  },
  {
    id: 'sheet-address-error',
    scenario: 'home-empty',
    prepare: async (page) => {
      await openSheet(page);
      await submitSheet(page);
      await page.waitForFunction(
        () => globalThis.document.querySelector('#address-error')?.textContent !== '',
      );
      // Drop the text caret's field focus ring difference out of the capture.
      await page.waitForTimeout(100);
    },
  },
  {
    id: 'sheet-map-zoomed-panned-tapped',
    scenario: 'booking-location-sample-work',
    prepare: async (page) => {
      await openSheet(page);
      await zoomIn(page);
      await zoomIn(page);
      await dragMap(0.5, 0.6, 46, -22)(page);
      await tapMap(0.36, 0.7)(page);
    },
  },
];

const summary = { evidence, visual: [], interactions: [] };
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const server = await startReferenceServer();
try {
  // 1. Visual parity: every state at every contract viewport.
  for (const visual of visualStates) {
    for (const width of contract.viewports) {
      const label = `${visual.id}@${width}`;
      const context = await newContext(browser, width);
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

        const pixels = await comparePixels(
          browser,
          reference.page,
          candidate.page,
          evidence,
          label,
        );
        summary.visual.push({ state: visual.id, width, ...pixels });

        assert.deepEqual(reference.problems, [], `${label}: reference page problems`);
        assert.deepEqual(candidate.problems, [], `${label}: candidate page problems`);
      } finally {
        await context.close();
      }
    }
  }

  // 2. Interaction parity: the same input on both pages, the same observable result.
  const interactionCases = [
    {
      name: 'the sample shortcuts fill the draft and mark the chosen one',
      scenario: 'home-empty',
      steps: [chooseShortcut('home'), chooseShortcut('work'), chooseShortcut('home')],
    },
    {
      name: 'a typed address with label, note and save preference is applied on submit',
      scenario: 'home-empty',
      steps: [
        openSheet,
        fill(ADDRESS, '  دمشق، شارع توضيحي 7، قرب الحديقة  '),
        fill(LABEL, 'بيت الأهل'),
        fill(NOTE, 'الموقف الخلفي'),
        (page) => page.locator(SAVE).uncheck(),
        acceptSheet,
        openSheet,
      ],
    },
    {
      name: 'the sheet refuses an address shorter than four characters',
      scenario: 'home-empty',
      steps: [
        openSheet,
        submitSheet,
        fill(ADDRESS, 'abc'),
        submitSheet,
        fill(ADDRESS, '   ab   '),
        submitSheet,
        fill(ADDRESS, 'abcd'),
        acceptSheet,
      ],
    },
    {
      name: 'an empty label falls back and the limits of the fields hold',
      scenario: 'home-empty',
      steps: [
        openSheet,
        fill(ADDRESS, 'ع'.repeat(200)),
        fill(LABEL, ''),
        fill(NOTE, 'م'.repeat(200)),
        acceptSheet,
        openSheet,
        fill(LABEL, 'ل'.repeat(60)),
        acceptSheet,
      ],
    },
    {
      name: 'tapping the map places the pin and fills only an empty or sample address',
      scenario: 'home-empty',
      steps: [
        openSheet,
        tapMap(0.3, 0.35),
        tapMap(0.8, 0.8),
        fill(ADDRESS, 'دمشق، عنوان كتبته بنفسي'),
        tapMap(0.55, 0.5),
        sheetSample('منزل تجريبي'),
        tapMap(0.2, 0.75),
        acceptSheet,
        openSheet,
      ],
    },
    {
      name: 'dragging pans within bounds and a later tap accounts for the pan',
      scenario: 'home-empty',
      steps: [
        openSheet,
        dragMap(0.5, 0.6, 60, 30),
        tapMap(0.5, 0.6),
        dragMap(0.5, 0.6, -90, -40),
        dragMap(0.5, 0.6, 3, 2),
        times(6, dragMap(0.4, 0.6, 120, 60)),
        tapMap(0.25, 0.85),
        times(8, dragMap(0.6, 0.5, -120, -60)),
        tapMap(0.9, 0.9),
      ],
    },
    {
      name: 'the zoom buttons stop at their limits and taps follow the zoom',
      scenario: 'booking-location-map-point',
      steps: [
        openSheet,
        zoomIn,
        tapMap(0.4, 0.4),
        times(8, zoomIn),
        tapMap(0.7, 0.7),
        times(12, zoomOut),
        tapMap(0.1, 0.9),
        zoomIn,
      ],
    },
    {
      name: 'the keyboard moves the pin and zooms',
      scenario: 'home-empty',
      steps: [
        openSheet,
        mapKey('ArrowLeft'),
        mapKey('ArrowUp'),
        mapKey('ArrowUp'),
        mapKey('ArrowRight'),
        mapKey('ArrowDown'),
        mapKey('+'),
        mapKey('Equal'),
        mapKey('Minus'),
        times(30, mapKey('ArrowRight')),
        times(22, mapKey('ArrowDown')),
        mapKey('a'),
      ],
    },
    {
      name: 'Ctrl+wheel zooms the map and a plain wheel does not',
      scenario: 'home-empty',
      steps: [
        openSheet,
        ctrlWheel(-120),
        ctrlWheel(-120),
        ctrlWheel(120),
        async (page) => {
          const point = await mapPoint(page, 0.5, 0.6);
          await page.mouse.move(point.x, point.y);
          await page.mouse.wheel(0, -120);
          await page.waitForTimeout(60);
        },
      ],
    },
    {
      name: 'the sample chips of the sheet refill it and reset the map',
      scenario: 'booking-location-manual-note',
      steps: [
        openSheet,
        zoomIn,
        dragMap(0.5, 0.6, 40, 20),
        sheetSample('عمل تجريبي'),
        (page) => page.locator(SAVE).uncheck(),
        sheetSample('منزل تجريبي'),
        acceptSheet,
      ],
    },
    {
      name: 'closing the sheet without submitting discards its values',
      scenario: 'booking-location-sample-work',
      steps: [
        openSheet,
        fill(ADDRESS, 'عنوان لن يُعتمد'),
        fill(NOTE, 'ملاحظة لن تُعتمد'),
        tapMap(0.2, 0.3),
        async (page) => {
          await page.keyboard.press('Escape');
          await sheetClosed(page);
        },
        openSheet,
        async (page) => {
          await page.getByRole('button', { name: 'إغلاق النافذة' }).click();
          await sheetClosed(page);
        },
      ],
    },
    {
      name: 'Next is refused without a place, then allowed after one is chosen',
      scenario: 'home-empty',
      steps: [
        (page) => page.locator(NEXT).click(),
        (page) => page.locator(NEXT).click(),
        chooseShortcut('work'),
        {
          // The time step is not ported yet (C010): only the destination is compared.
          only: ['step', 'toast'],
          run: async (page) => {
            await page.locator(NEXT).click();
            await page.waitForURL(/#[/]?book[/]3$/);
          },
        },
      ],
    },
    {
      name: 'a place applied from the sheet clears the step message',
      scenario: 'home-empty',
      steps: [
        (page) => page.locator(NEXT).click(),
        openSheet,
        fill(ADDRESS, 'دمشق، عنوان واضح'),
        acceptSheet,
      ],
    },
  ];
  for (const interaction of interactionCases) {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, interaction.scenario);
      for (const [index, step] of interaction.steps.entries()) {
        const run = typeof step === 'function' ? step : step.run;
        const compared = (state) =>
          step.only ? Object.fromEntries(step.only.map((key) => [key, state[key]])) : state;
        await run(reference.page);
        await run(candidate.page);
        await reference.page.waitForTimeout(80);
        await candidate.page.waitForTimeout(80);
        assert.deepEqual(
          compared(await observe(candidate.page)),
          compared(await observe(reference.page)),
          `${interaction.name}: after step ${index + 1}`,
        );
      }
      assert.deepEqual(candidate.problems, [], `${interaction.name}: candidate page problems`);
      summary.interactions.push({ name: interaction.name, steps: interaction.steps.length });
    } finally {
      await context.close();
    }
  }

  // 3. Device location, with made-up positions supplied by Playwright. The same
  //    taps on both pages give the same answer.
  const locationCases = [
    {
      name: 'device location inside the illustrative range',
      position: IN_RANGE,
      notice: 'أنت ضمن نطاق العرض التقريبي',
      steps: [fill(ADDRESS, 'دمشق، عنوان أكمله بنفسي'), acceptSheet, openSheet],
    },
    {
      name: 'device location outside the illustrative range',
      position: OUT_OF_RANGE,
      notice: 'موقعك خارج نطاق دمشق التوضيحي',
      steps: [],
    },
    {
      name: 'device location permission denied',
      position: null,
      notice: 'لم تسمح بالموقع',
      steps: [fill(ADDRESS, 'دمشق، عنوان يدوي بعد الرفض'), acceptSheet],
    },
  ];
  for (const locationCase of locationCases) {
    const context = await newContext(browser, 390);
    try {
      if (locationCase.position) {
        await context.grantPermissions(['geolocation']);
        await context.setGeolocation(locationCase.position);
      }
      const { reference, candidate } = await openPair(context, server, 'home-empty');
      const steps = [openSheet, locate(locationCase.notice), ...locationCase.steps];
      for (const [index, step] of steps.entries()) {
        await step(reference.page);
        await step(candidate.page);
        await reference.page.waitForTimeout(80);
        await candidate.page.waitForTimeout(80);
        assert.deepEqual(
          await observe(candidate.page),
          await observe(reference.page),
          `${locationCase.name}: after step ${index + 1}`,
        );
      }
      assert.deepEqual(candidate.problems, [], `${locationCase.name}: candidate page problems`);
      summary.interactions.push({ name: locationCase.name, steps: steps.length });
    } finally {
      await context.close();
    }
  }

  // 4. Location failures the browser cannot be made to produce: the API is
  //    replaced by a stub on both pages.
  const stubCases = [
    {
      name: 'device location unavailable',
      notice: 'تعذر تحديد الموقع',
      stub: () => {
        globalThis.Geolocation.prototype.getCurrentPosition = (_ok, fail) =>
          globalThis.setTimeout(() => fail({ code: 2, message: 'stub' }), 20);
      },
    },
    {
      name: 'device location timed out',
      notice: 'تعذر تحديد الموقع',
      stub: () => {
        globalThis.Geolocation.prototype.getCurrentPosition = (_ok, fail) =>
          globalThis.setTimeout(() => fail({ code: 3, message: 'stub' }), 20);
      },
    },
    {
      name: 'device location not supported',
      notice: 'تحديد الموقع غير مدعوم',
      stub: () => {
        Object.defineProperty(globalThis.Navigator.prototype, 'geolocation', {
          get: () => undefined,
          configurable: true,
        });
      },
    },
  ];
  for (const stubCase of stubCases) {
    const context = await newContext(browser, 390);
    try {
      await context.addInitScript(stubCase.stub);
      const { reference, candidate } = await openPair(context, server, 'home-empty');
      const steps = [
        openSheet,
        fill(ADDRESS, 'دمشق، عنوان كتبته قبل المحاولة'),
        async (page) => {
          await page.locator(LOCATE).click();
          await page.waitForFunction(
            (text) => globalThis.document.querySelector('.toast')?.textContent.includes(text),
            stubCase.notice,
          );
        },
        acceptSheet,
      ];
      for (const [index, step] of steps.entries()) {
        await step(reference.page);
        await step(candidate.page);
        await reference.page.waitForTimeout(80);
        await candidate.page.waitForTimeout(80);
        assert.deepEqual(
          await observe(candidate.page),
          await observe(reference.page),
          `${stubCase.name}: after step ${index + 1}`,
        );
      }
      assert.equal(
        (await observe(candidate.page)).card.preview,
        'دمشق، عنوان كتبته قبل المحاولة',
        `${stubCase.name}: manual entry still works`,
      );
      assert.deepEqual(candidate.problems, [], `${stubCase.name}: candidate page problems`);
      summary.interactions.push({ name: stubCase.name, steps: steps.length });
    } finally {
      await context.close();
    }
  }

  // 5. Pinch zoom with two real touch points (candidate and reference).
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, 'home-empty');
      const pinch = async (page) => {
        await openSheet(page);
        const a = await mapPoint(page, 0.4, 0.6);
        const b = await mapPoint(page, 0.6, 0.6);
        const cdp = await context.newCDPSession(page);
        const touch = (type, points) =>
          cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: points.map((point, id) => ({ x: point.x, y: point.y, id })),
          });
        await touch('touchStart', [a]);
        await touch('touchStart', [a, b]);
        await touch('touchMove', [
          { x: a.x - 20, y: a.y },
          { x: b.x + 20, y: b.y },
        ]);
        await touch('touchMove', [
          { x: a.x - 39, y: a.y },
          { x: b.x + 39, y: b.y },
        ]);
        await touch('touchEnd', []);
        await page.waitForTimeout(80);
        await cdp.detach();
      };
      await pinch(reference.page);
      await pinch(candidate.page);
      const candidateState = await observe(candidate.page);
      assert.deepEqual(candidateState, await observe(reference.page), 'pinch zoom');
      const zoom = Number(/scale\(([\d.]+)\)/.exec(candidateState.sheet.map.world)?.[1]);
      assert.ok(zoom > 1.5 && zoom <= 2.2, `the pinch zoomed in within bounds (got ${zoom})`);
      assert.deepEqual(candidateState.sheet.map.pin, ['350px', '250px'], 'a pinch places no pin');
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'pinch zoom with two touch points' });
    } finally {
      await context.close();
    }
  }

  // 6. Privacy: the location API is touched only by the customer's tap, and the
  //    position never reaches the page, the URL, storage or the network.
  {
    const context = await newContext(browser, 390);
    try {
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation(IN_RANGE);
      await context.addInitScript(() => {
        const calls = [];
        globalThis.__locationCalls = calls;
        const prototype = globalThis.Geolocation.prototype;
        const get = prototype.getCurrentPosition;
        const watch = prototype.watchPosition;
        prototype.getCurrentPosition = function getCurrentPosition(...args) {
          calls.push('getCurrentPosition');
          return get.apply(this, args);
        };
        prototype.watchPosition = function watchPosition(...args) {
          calls.push('watchPosition');
          return watch.apply(this, args);
        };
        const query = globalThis.Permissions.prototype.query;
        globalThis.Permissions.prototype.query = function permissionsQuery(...args) {
          calls.push('permissions.query');
          return query.apply(this, args);
        };
      });
      const { page, problems, requests } = await openCandidate(
        context,
        origin,
        '/book/2?scenario=home-empty',
        CARD,
      );
      await page.locator('.booking-footer').waitFor();
      const calls = () => page.evaluate(() => [...globalThis.__locationCalls]);
      assert.deepEqual(await calls(), [], 'no location access on page load');

      await chooseShortcut('home')(page);
      await openSheet(page);
      await tapMap(0.3, 0.4)(page);
      await mapKey('ArrowLeft')(page);
      await zoomIn(page);
      await fill(ADDRESS, 'دمشق، عنوان يدوي')(page);
      assert.deepEqual(await calls(), [], 'no location access from the sheet, map or typing');

      const requestsBefore = requests.length;
      await locate('أنت ضمن نطاق العرض التقريبي')(page);
      assert.deepEqual(await calls(), ['getCurrentPosition'], 'one request, from the tap');
      // The answer marks the pin "approximately here" at the centre of the drawing
      // and leaves the typed address alone. (The reference leaves the drawn pin
      // where it was until the sheet is redrawn; the port moves it at once.)
      const located = (await observe(page)).sheet;
      assert.deepEqual(located.map.pin, ['350px', '250px']);
      assert.equal(located.pinDescription, 'موقع داخل نطاق دمشق التقريبي، أكمل العنوان');
      assert.equal(located.fields[0].value, 'دمشق، عنوان يدوي');
      await acceptSheet(page);
      await page.locator(NEXT).click();
      await page.locator('[data-booking-step="time"]').waitFor();
      await page.goBack();
      await page.locator(CARD).waitFor();
      await openSheet(page);
      assert.deepEqual(await calls(), ['getCurrentPosition'], 'reopening asks for nothing');

      const exposure = await page.evaluate(() => ({
        html: globalThis.document.documentElement.outerHTML,
        url: globalThis.location.href,
        title: globalThis.document.title,
        local: JSON.stringify({ ...globalThis.localStorage }),
        session: JSON.stringify({ ...globalThis.sessionStorage }),
        cookies: globalThis.document.cookie,
        history: JSON.stringify(globalThis.history.state),
      }));
      for (const [where, value] of Object.entries(exposure)) {
        for (const secret of [String(IN_RANGE.latitude), String(IN_RANGE.longitude)]) {
          assert.ok(!value.includes(secret), `the device position leaked into ${where}`);
        }
        assert.ok(!/latitude|longitude|coords/i.test(value), `coordinates named in ${where}`);
      }
      assert.deepEqual(
        { local: exposure.local, session: exposure.session, cookies: exposure.cookies },
        { local: '{}', session: '{}', cookies: '' },
        'the location step writes no browser storage',
      );
      assert.equal(requests.length, requestsBefore, 'locating sends no request');
      assert.ok(
        requests.every((request) => new URL(request.split(' ')[1]).hostname === '127.0.0.1'),
        'no map tiles, geocoder or any other external request',
      );
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'location is opt-in and the position is never exposed' });
    } finally {
      await context.close();
    }
  }

  // 7. A location answer that arrives after the sheet was closed changes nothing.
  {
    const context = await newContext(browser, 390);
    try {
      await context.addInitScript(() => {
        globalThis.Geolocation.prototype.getCurrentPosition = (ok) =>
          globalThis.setTimeout(
            () => ok({ coords: { latitude: 24.7001, longitude: 46.6502 } }),
            600,
          );
      });
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/2?scenario=booking-location-sample-work',
        CARD,
      );
      await page.locator('.booking-footer').waitFor();
      await openSheet(page);
      await page.locator(LOCATE).click();
      const pending = await observe(page);
      assert.equal(pending.sheet.map.locate, 'جارٍ تحديد الموقع');
      assert.equal(pending.sheet.map.locateDisabled, true);
      await page.keyboard.press('Escape');
      await sheetClosed(page);
      await page.waitForTimeout(900);
      const after = await observe(page);
      assert.equal(after.toast, null, 'a late answer raises no notice');
      assert.equal(after.card.preview, 'دمشق، المالكي، مبنى تجريبي 8');
      await openSheet(page);
      assert.equal((await observe(page)).sheet.pinDescription, 'عنوان توضيحي للتجربة');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'a late location answer is ignored' });
    } finally {
      await context.close();
    }
  }

  // 8. The journey around the step: Back, Next, history, resume, deep link —
  //    with no order, no saved address and nothing leaving the page.
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, 'garage-vehicle-chosen');
      const { page, problems, requests } = candidate;
      const requestsBefore = requests.length;

      // Header Back returns to the care step on both; Next comes back here.
      for (const target of [reference.page, page]) {
        await target.getByRole('button', { name: 'الخطوة السابقة' }).click();
        await target.locator('.service-option').first().waitFor();
        await target.locator(NEXT).click();
        await target.locator(CARD).waitFor();
      }
      assert.match(page.url(), /#\/book\/2$/);
      assert.deepEqual(await observe(page), await observe(reference.page));

      // A place chosen here survives going back and forward.
      for (const target of [reference.page, page]) {
        await openSheet(target);
        await fill(ADDRESS, 'دمشق، عنوان الرحلة التجريبي')(target);
        await fill(NOTE, 'عند المدخل')(target);
        await tapMap(0.7, 0.4)(target);
        await acceptSheet(target);
      }
      const chosen = await observe(page);
      assert.deepEqual(chosen, await observe(reference.page));
      await page.goBack();
      await page.locator('.service-option').first().waitFor();
      await page.goForward();
      await page.locator(CARD).waitFor();
      assert.deepEqual((await observe(page)).card, chosen.card);

      // Next leads to the time step (ported by C010). The reference
      // already accepted one Next in this journey (care → location), so its
      // double-activation guard has to be over before the second one counts.
      await pastReferenceNextGuard(reference.page);
      await reference.page.locator(NEXT).click();
      // The approved prototype writes its routes without the slash: `#book/3`.
      await reference.page.waitForURL(/#book[/]3$/);
      await page.locator(NEXT).click();
      await page.locator('[data-booking-step="time"]').waitFor();
      assert.match(page.url(), /#\/book\/3$/);
      // Until C010 the time step was a placeholder; it is now the real screen, with
      // the booking footer and the place chosen here as its context.
      await page.locator('.dates').waitFor();
      assert.equal(await page.locator('.c002-deferred-footer').count(), 0);
      assert.equal(await page.locator('.booking-footer').count(), 1);
      assert.equal(
        (await page.locator('.choice-context .grow').innerText()).trim(),
        chosen.card.title,
        'the time step shows the place chosen here',
      );
      await page.goBack();
      await page.locator(CARD).waitFor();
      assert.deepEqual((await observe(page)).card, chosen.card);

      // Save and exit: Home offers the draft; resume returns to this step.
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      const savedDraft = page.locator('[data-home-entry="saved-draft"]');
      await savedDraft.waitFor();
      assert.equal(await page.locator('.nav-dot').count(), 0, 'no order was created');
      assert.equal(await page.locator('[data-home-entry="active-order"]').count(), 0);
      await savedDraft.locator('.text-btn').click();
      await page.locator(CARD).waitFor();
      assert.match(page.url(), /#\/book\/2$/, 'resume returns to the location step');
      assert.deepEqual((await observe(page)).card, chosen.card);
      assert.equal((await observe(page)).accessNote, 'عند المدخل');

      // The garage is untouched, and no saved-address feature appeared.
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      await page.locator('[data-home-entry="saved-draft"]').waitFor();
      await page.getByRole('link', { name: 'سياراتي' }).click();
      await page.locator('.garage-card').first().waitFor();
      assert.equal(await page.locator('.garage-card').count(), 3);

      assert.equal(requests.length, requestsBefore, 'the location step must not send any request');
      assert.deepEqual(
        await page.evaluate(() => ({
          local: globalThis.localStorage.length,
          session: globalThis.sessionStorage.length,
          cookies: globalThis.document.cookie,
        })),
        { local: 0, session: 0, cookies: '' },
        'the location step must not write browser storage',
      );
      assert.deepEqual(problems, []);
      summary.interactions.push({
        name: 'Back, Next, history, resume; no request, storage, order or saved address',
      });
    } finally {
      await context.close();
    }
  }

  // 9. Entry guard, refresh, deep link and unknown scenario.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/2?scenario=booking-location-map-point',
        CARD,
      );
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator(CARD).waitFor();
      assert.deepEqual((await observe(page)).card, {
        label: 'تعديل مكان غسيل السيارة',
        title: 'مكان الغسيل',
        preview: 'دمشق، موقع مختار على الخريطة التوضيحية',
        note: 'خريطة توضيحية',
      });
      await openSheet(page);
      const sheet = (await observe(page)).sheet;
      assert.deepEqual(sheet.map.pin, ['228px', '312px']);
      assert.equal(sheet.save.checked, false);
      await page.keyboard.press('Escape');
      await sheetClosed(page);

      await page.goto(`${origin}/#/book/2?scenario=__proto__`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator(CARD).waitFor();
      assert.equal((await observe(page)).card.title, 'حدد مكان السيارة');

      // An empty address book shows no saved-address chips (populated: see C009).
      assert.equal(await page.locator('.address-chips').count(), 0);
      await openSheet(page);
      assert.deepEqual((await observe(page)).sheet.chips, ['منزل تجريبي', 'عمل تجريبي']);
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'refresh, deep link and scenario fallback' });
    } finally {
      await context.close();
    }
  }

  // 10. Keyboard, semantics, modality, focus and text-only rendering.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/2?scenario=home-empty',
        CARD,
      );
      await page.locator('.booking-footer').waitFor();
      const card = page.locator(CARD);
      assert.equal(await card.evaluate((node) => node.tagName), 'BUTTON');
      assert.equal(await card.getAttribute('aria-haspopup'), 'dialog');
      assert.equal(await card.getAttribute('aria-label'), 'تحديد مكان غسيل السيارة');
      assert.deepEqual(
        await page
          .locator('.place-shortcut')
          .evaluateAll((nodes) =>
            nodes.map((node) => [node.tagName, node.getAttribute('aria-pressed')]),
          ),
        [
          ['BUTTON', 'false'],
          ['BUTTON', 'false'],
        ],
      );

      // A refused Next announces the message and moves focus to it.
      await page.locator(NEXT).click();
      const message = page.locator('#error-address');
      await message.waitFor();
      assert.equal(await message.getAttribute('role'), 'alert');
      await page.waitForFunction(() => globalThis.document.activeElement?.id === 'error-address');

      // Keyboard: Enter opens the sheet from the card; the shortcut reports pressed.
      await page.locator(shortcut('work')).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator(shortcut('work')).getAttribute('aria-pressed'), 'true');
      assert.equal(await message.count(), 0, 'choosing a place clears the message');
      await card.focus();
      await page.keyboard.press('Enter');
      await sheetOpen(page);

      const dialog = await page.evaluate(() => {
        const doc = globalThis.document;
        const sheet = doc.querySelector('dialog.sheet[open]');
        const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id);
        return {
          modal: sheet.matches(':modal'),
          title: doc.getElementById(sheet.getAttribute('aria-labelledby'))?.textContent,
          duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
          unlabelled: [...sheet.querySelectorAll('input')]
            .filter((input) => !input.labels?.length)
            .map((input) => input.name),
          clickOnly: sheet.querySelectorAll('[role="button"], div[onclick]').length,
          errorRole: sheet.querySelector('#address-error').getAttribute('role'),
        };
      });
      assert.deepEqual(dialog, {
        modal: true,
        title: 'مكان سيارتك، بكل بساطة.',
        duplicateIds: [],
        unlabelled: [],
        clickOnly: 0,
        errorRole: 'alert',
      });

      // Tab stays inside the sheet; every stop shows a focus ring.
      const stops = new Set();
      for (let i = 0; i < 16; i += 1) {
        await page.keyboard.press('Tab');
        const where = await page.evaluate(() => {
          const element = globalThis.document.activeElement;
          if (!element || element === globalThis.document.body) return 'browser';
          if (!element.closest('dialog.sheet[open]')) return `outside:${element.className}`;
          const style = globalThis.getComputedStyle(element);
          const ringed = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
          const name =
            element.id === 'location-map'
              ? 'map'
              : element.getAttribute('aria-label') ||
                element.name ||
                element.innerText.replace(/\s+/g, ' ').trim();
          return `sheet:${name}:${ringed ? 'ringed' : 'NO-RING'}`;
        });
        assert.ok(!where.startsWith('outside:'), `focus escaped the sheet to ${where}`);
        if (where.startsWith('sheet:')) stops.add(where);
      }
      assert.deepEqual(
        [...stops].sort(),
        [
          'sheet:address:ringed',
          'sheet:addressLabel:ringed',
          'sheet:locationNote:ringed',
          'sheet:map:ringed',
          'sheet:saveAddress:ringed',
          'sheet:إغلاق النافذة:ringed',
          'sheet:اعتماد هذا المكان:ringed',
          'sheet:تصغير الخريطة:ringed',
          'sheet:تكبير الخريطة:ringed',
          'sheet:عمل تجريبي:ringed',
          'sheet:منزل تجريبي:ringed',
          'sheet:موقعي الحالي:ringed',
        ],
        'every control of the sheet is reachable by keyboard',
      );

      // Arrow keys on a zoom button do not move the pin.
      await page.getByRole('button', { name: 'تكبير الخريطة' }).focus();
      await page.keyboard.press('ArrowLeft');
      assert.equal((await observe(page)).sheet.pinDescription, 'عنوان توضيحي للتجربة');

      // A map point is announced politely.
      await mapKey('ArrowUp')(page);
      assert.equal(
        await page.locator('.sr-only[aria-live="polite"]').innerText(),
        'تم اختيار نقطة جديدة على الخريطة التوضيحية.',
      );

      // An address that is too short: message shown, focus on the field, sheet stays.
      await fill(ADDRESS, 'ab')(page);
      await page.locator(ADDRESS).press('Enter');
      assert.equal((await observe(page)).sheet.error, 'أدخل عنوانًا من أربعة أحرف على الأقل.');
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.id),
        'sheet-address',
      );

      // Markup typed by the customer is shown as text and never becomes elements.
      const hostile = '<img src=x onerror="globalThis.__xss=1"><script>globalThis.__xss=1</script>';
      await fill(ADDRESS, hostile)(page);
      await fill(LABEL, '<b>بيت</b>')(page);
      await fill(NOTE, hostile)(page);
      await page.locator(ADDRESS).press('Enter');
      await sheetClosed(page);
      const shown = await observe(page);
      assert.equal(shown.card.title, '<b>بيت</b>');
      assert.equal(shown.card.preview, hostile);
      assert.equal(shown.accessNote, hostile);
      assert.deepEqual(
        await page.evaluate(() => ({
          injected: globalThis.document.querySelectorAll('.main img, .main script, .main b').length,
          ran: globalThis.__xss ?? null,
        })),
        { injected: 0, ran: null },
      );

      // After submit, focus returns to the card and scrolling is unlocked.
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.matches('.location-picker')),
        true,
        'focus returns to the card',
      );
      await page.waitForFunction(() => globalThis.document.body.style.overflow === '');
      assert.equal(await card.getAttribute('aria-label'), 'تعديل مكان غسيل السيارة');
      await page.locator('.toast.show').waitFor();
      assert.equal(await page.locator('.toast.show').getAttribute('role'), 'status');
      assert.deepEqual(problems, []);
      summary.interactions.push({
        name: 'keyboard, semantics, modality, focus and text-only content',
      });
    } finally {
      await context.close();
    }
  }

  // 11. Touch targets and layout at the narrowest and widest contract widths.
  for (const width of [320, 1440]) {
    const context = await newContext(browser, width);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/2?scenario=booking-location-manual-note',
        CARD,
      );
      await page.locator('.booking-footer').waitFor();
      await openSheet(page);
      const sizes = await page.evaluate(() =>
        [
          ...globalThis.document.querySelectorAll(
            'dialog.sheet[open] button, .location-picker, .place-shortcut, .primary-next',
          ),
        ].map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            name: node.getAttribute('aria-label') || node.innerText.replace(/\s+/g, ' ').trim(),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }),
      );
      for (const size of sizes) {
        assert.ok(
          size.width >= 44 && size.height >= 44,
          `${width}px: "${size.name}" is ${size.width}×${size.height}`,
        );
      }
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth -
            globalThis.document.documentElement.clientWidth,
        ),
        0,
        `${width}px: no horizontal overflow with the sheet open`,
      );
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
  summary.interactions.push({ name: 'touch targets at 320 and 1440' });

  // 12. Reduced motion: the step and the sheet work identically without animation.
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await newContext(browser, 390, { reducedMotion });
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/2?scenario=home-empty',
        CARD,
      );
      await page.locator('.booking-footer').waitFor();
      await chooseShortcut('work')(page);
      await openSheet(page);
      const sheetAnimation = await page.evaluate(
        () =>
          globalThis.getComputedStyle(globalThis.document.querySelector('dialog.sheet[open]'))
            .animationName,
      );
      assert.equal(
        sheetAnimation,
        reducedMotion === 'reduce' ? 'none' : 'sheetIn',
        `sheet entrance with ${reducedMotion}`,
      );
      await tapMap(0.3, 0.4)(page);
      await acceptSheet(page);
      assert.equal((await observe(page)).card.preview, 'دمشق، موقع مختار على الخريطة التوضيحية');
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
  summary.interactions.push({ name: 'reduced motion' });

  writeFileSync(resolve(evidence, 'c008-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `C008 browser acceptance passed: ${summary.visual.length} visual comparisons, ` +
      `${summary.interactions.length} interaction checks. Evidence: ${evidence}`,
  );
} catch (error) {
  writeFileSync(resolve(evidence, 'c008-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`C008 evidence directory: ${evidence}`);
  throw error;
} finally {
  await server.close();
  await browser.close();
}
