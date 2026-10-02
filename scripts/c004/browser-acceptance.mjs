// C004 browser acceptance: renders the React vehicle step next to the approved
// customer HTML in the same browser and compares structure, copy, geometry,
// computed style and pixels, then exercises the step's interactions on both.
//
// The reference is served read-only by the F010 reference server and is never
// modified. Its storage is seeded with the same session as the candidate scenario.
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
} from './parity-harness.mjs';

const origin = process.env.C004_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C004_EVIDENCE_DIR
  ? resolve(process.env.C004_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c004-'));
mkdirSync(evidence, { recursive: true });

const VEHICLE_READY = '[data-booking-step="vehicle"] .signature-car';

// Everything the vehicle step owns, plus the shell regions it shows through.
const PARITY_SELECTORS = [
  'body',
  '.skip',
  '.desktop-note',
  '.desktop-chip',
  '.desktop-number',
  '.app',
  '.app-header',
  '.app-header .icon-btn',
  '.app-header .icon-btn .icon',
  '.header-title',
  '.header-title small',
  '.main',
  '.journey-heading',
  '.journey-heading > span',
  '.journey-number strong',
  '.stepper',
  '.step-segment',
  '.step-segment i',
  '.page-heading',
  '.page-heading .eyebrow',
  '.page-heading h1',
  '.page-heading p',
  '.page-heading .chapter-icon',
  '.page-heading .chapter-icon .icon',
  '.vehicle-stage',
  '.stage-top',
  '.stage-top .icon',
  '.stage-orbit',
  '.vehicle-stage > .car-art',
  '.stage-caption',
  '.stage-caption strong',
  '.stage-caption small',
  '.stage-caption .plate-mini',
  '.signature-car-grid',
  '.signature-car',
  '.signature-car .choice',
  '.signature-car .radio-circle',
  '.signature-car .radio-circle .icon',
  '.signature-car > .car-art',
  '.signature-car .car-label',
  '.signature-car strong',
  '.signature-car small',
  '.plate-field',
  '.field-label',
  '.field-label small',
  '.input-icon-wrap',
  '.input-icon-wrap > .icon',
  '.plate-input',
  '.plate-field .input-note',
  '.plate-field .error',
  '.car-more',
  '.car-more .soft-icon',
  '.car-more .soft-icon .icon',
  '.car-more strong',
  '.car-more p',
  '.car-more > .icon',
  '.save-car-check',
  '.save-car-check input',
  '.booking-footer',
  '.footer-assurance',
  '.footer-assurance span',
  '.footer-assurance .icon',
  '.booking-footer .row',
  '.booking-total',
  '.booking-total small',
  '.booking-total small .icon',
  '.booking-total strong',
  '.booking-total .currency',
  '.primary-next',
  '.primary-next > span:first-child',
  '.button-arrow',
  '.button-arrow .icon',
];

const NEXT = '.primary-next';
const PLATE = '#plate';
const typeRadio = (type) => `input[name="vehicleType"][value="${type}"]`;
const typeCard = (type) => `.signature-car:has(${typeRadio(type)})`;

/** Screens compared visually. `prepare` runs the same steps on both pages. */
const visualStates = [
  { id: 'vehicle-default', scenario: 'home-empty' },
  { id: 'vehicle-prefilled', scenario: 'booking-vehicle-prefilled' },
  { id: 'vehicle-returning-customer', scenario: 'home-returning-customer' },
  {
    id: 'vehicle-large-selected',
    scenario: 'home-empty',
    prepare: async (page) => {
      await page.locator(typeCard('large')).click();
      await page.locator(`${typeCard('large')}.selected`).waitFor();
    },
  },
  {
    id: 'vehicle-invalid-plate',
    scenario: 'booking-vehicle-invalid-plate',
    prepare: async (page) => {
      await page.locator(NEXT).click();
      await page.locator('#error-plate').waitFor();
    },
  },
];

async function openPair(context, server, scenario) {
  const state = initialSessionState(`#/?scenario=${scenario}`);
  const reference = await openReference(
    context,
    server,
    referenceStorageFor(state, { screen: 'booking', step: 0 }),
    '#book/0',
  );
  await reference.page.locator('.signature-car').first().waitFor();
  const candidate = await openCandidate(
    context,
    origin,
    `/book/0?scenario=${scenario}`,
    VEHICLE_READY,
  );
  await candidate.page.locator('.booking-footer').waitFor();
  return { reference, candidate };
}

/** What a customer can observe of the step, read the same way on both pages. */
function observe(page) {
  return page.evaluate(() => {
    const doc = globalThis.document;
    const text = (selector) => doc.querySelector(selector)?.textContent?.trim() ?? null;
    const plate = doc.querySelector('#plate');
    const stagePlate = doc.querySelector('#stage-plate');
    // On a fresh load the reference parks focus on the heading while the candidate
    // leaves it at the document start so the skip link stays the first stop (a
    // deliberate C002/C003 shell decision). Both are "no control focused".
    const active = doc.activeElement;
    const resting = !active || active === doc.body || active.matches('.main h1');
    return {
      selected: doc.querySelector('input[name="vehicleType"]:checked')?.value ?? null,
      selectedCards: [...doc.querySelectorAll('.signature-car.selected input')].map((i) => i.value),
      stageName: text('#stage-name'),
      stagePlate: stagePlate && !stagePlate.hidden ? stagePlate.textContent : null,
      plateValue: plate?.value ?? null,
      plateInvalid: plate?.getAttribute('aria-invalid') ?? null,
      plateDescribedBy: plate?.getAttribute('aria-describedby') ?? null,
      error: text('#error-plate'),
      errorRole: doc.querySelector('#error-plate')?.getAttribute('role') ?? null,
      details: text('.car-more p'),
      saveVehicle: doc.querySelector('input[name="saveVehicleInline"]')?.checked ?? null,
      footerPrice: text('#footer-price'),
      footerAssurance: text('.footer-assurance'),
      nextLabel: text('.primary-next > span:first-child'),
      focused: resting ? 'none' : active.id || active.getAttribute('name') || active.tagName,
    };
  });
}

const bookingStep = (url) => /#\/?book\/(\d+)/.exec(url)?.[1] ?? null;
const isHome = (url) => /#\/?(?:home)?(?:\?.*)?$/.test(url) && !/book|order/.test(url);

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
          await settle(reference.page);
          await settle(candidate.page);
        }
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
          `${label}: observable step state`,
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
      name: 'each size can be selected and updates stage, card and footer',
      scenario: 'home-empty',
      steps: ['suv', 'large', 'pickup', 'sedan'].map((type) => async (page) => {
        await page.locator(typeCard(type)).click();
        await page.locator(`${typeCard(type)}.selected`).waitFor();
      }),
    },
    {
      name: 'changing size clears the optional name and colour, keeps the plate',
      scenario: 'booking-vehicle-prefilled',
      steps: [
        async (page) => {
          await page.locator(typeCard('sedan')).click();
          await page.locator(`${typeCard('sedan')}.selected`).waitFor();
        },
      ],
    },
    {
      name: 'Latin plate is shown live on the stage',
      scenario: 'home-empty',
      steps: [async (page) => page.locator(PLATE).fill('1234 ABC')],
    },
    {
      name: 'Arabic-Indic digits are stored and shown as Latin digits',
      scenario: 'home-empty',
      steps: [async (page) => page.locator(PLATE).fill('١٢٣٤ أ ب ج')],
    },
    {
      name: 'Eastern Arabic-Indic digits are stored and shown as Latin digits',
      scenario: 'home-empty',
      steps: [async (page) => page.locator(PLATE).fill('۵۶۷۸ ب')],
    },
    {
      name: 'a plate without a digit is refused on Next and announced',
      scenario: 'home-empty',
      steps: [
        async (page) => page.locator(PLATE).fill('أ ب ج'),
        async (page) => {
          await page.locator(NEXT).click();
          await page.locator('#error-plate').waitFor();
        },
      ],
    },
    {
      name: 'spaces alone are not an empty plate',
      scenario: 'home-empty',
      steps: [
        async (page) => page.locator(PLATE).fill('   '),
        async (page) => {
          await page.locator(NEXT).click();
          await page.locator('#error-plate').waitFor();
        },
      ],
    },
    {
      name: 'typing after an error clears it',
      scenario: 'booking-vehicle-invalid-plate',
      steps: [
        async (page) => {
          await page.locator(NEXT).click();
          await page.locator('#error-plate').waitFor();
        },
        async (page) => {
          await page.locator(PLATE).fill('ب ج د 7');
          await page.locator('#error-plate').waitFor({ state: 'detached' });
        },
      ],
    },
    {
      name: 'the save-for-next-time preference toggles',
      scenario: 'home-empty',
      steps: [async (page) => page.locator('input[name="saveVehicleInline"]').click()],
    },
    {
      name: 'arrow keys move the selection inside the radio group',
      scenario: 'home-empty',
      steps: [
        async (page) => page.locator(typeRadio('sedan')).focus(),
        async (page) => page.keyboard.press('ArrowDown'),
        async (page) => page.keyboard.press('ArrowDown'),
        async (page) => page.keyboard.press('ArrowUp'),
        async (page) => page.keyboard.press('ArrowLeft'),
        async (page) => page.keyboard.press('ArrowRight'),
      ],
    },
  ];
  for (const interaction of interactionCases) {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, interaction.scenario);
      for (const [index, step] of interaction.steps.entries()) {
        await step(reference.page);
        await step(candidate.page);
        await reference.page.waitForTimeout(60);
        await candidate.page.waitForTimeout(60);
        assert.deepEqual(
          await observe(candidate.page),
          await observe(reference.page),
          `${interaction.name}: after step ${index + 1}`,
        );
      }
      assert.equal(bookingStep(candidate.page.url()), '0', `${interaction.name}: stays on step 0`);
      assert.deepEqual(candidate.problems, [], `${interaction.name}: candidate page problems`);
      summary.interactions.push({ name: interaction.name, steps: interaction.steps.length });
    } finally {
      await context.close();
    }
  }

  // 3. Navigation parity: Next, Enter, Back and Exit lead where the reference leads.
  const navigationCases = [
    {
      name: 'Next with an empty plate advances to the care step',
      scenario: 'home-empty',
      act: (page) => page.locator(NEXT).click(),
      expect: (url) => bookingStep(url) === '1',
    },
    {
      name: 'Next with a valid plate advances to the care step',
      scenario: 'booking-vehicle-prefilled',
      act: (page) => page.locator(NEXT).click(),
      expect: (url) => bookingStep(url) === '1',
    },
    {
      name: 'Enter in the plate field advances like Next',
      scenario: 'home-empty',
      act: async (page) => {
        await page.locator(PLATE).fill('4821 ب ج');
        await page.locator(PLATE).press('Enter');
      },
      expect: (url) => bookingStep(url) === '1',
    },
    {
      name: 'Next with an invalid plate stays on the vehicle step',
      scenario: 'booking-vehicle-invalid-plate',
      act: async (page) => {
        await page.locator(NEXT).click();
        await page.locator('#error-plate').waitFor();
      },
      expect: (url) => bookingStep(url) === '0',
    },
    {
      name: 'header Back leaves the journey for Home',
      scenario: 'home-empty',
      act: (page) => page.getByRole('button', { name: 'الخطوة السابقة' }).click(),
      expect: isHome,
    },
    {
      name: 'Exit sheet "save and exit" returns Home',
      scenario: 'home-empty',
      act: async (page) => {
        await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
        await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      },
      expect: isHome,
    },
  ];
  for (const navigation of navigationCases) {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, navigation.scenario);
      await navigation.act(reference.page);
      await navigation.act(candidate.page);
      await reference.page.waitForTimeout(150);
      await candidate.page.waitForTimeout(150);
      assert.equal(navigation.expect(reference.page.url()), true, `${navigation.name}: reference`);
      assert.equal(
        navigation.expect(candidate.page.url()),
        true,
        `${navigation.name}: candidate went to ${candidate.page.url()}`,
      );
      assert.deepEqual(candidate.problems, [], `${navigation.name}: candidate page problems`);
      summary.interactions.push({ name: navigation.name });
    } finally {
      await context.close();
    }
  }

  // 4. The draft survives the round trip and nothing leaves the page.
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, 'home-empty');
      const { page, problems, requests } = candidate;
      const requestsBefore = requests.length;
      for (const target of [reference.page, page]) {
        await target.locator(typeCard('pickup')).click();
        await target.locator(`${typeCard('pickup')}.selected`).waitFor();
        await target.locator(PLATE).fill('٩٨٧٦ د');
        await target.locator(NEXT).click();
      }
      await page.locator('[data-booking-step="care"]').waitFor();
      assert.match(page.url(), /#\/book\/1$/);
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.tagName),
        'H1',
        'care heading receives focus on entry',
      );

      // Browser Back returns to the vehicle step with the draft intact.
      await page.goBack();
      await page.locator(VEHICLE_READY).first().waitFor();
      await reference.page.goBack();
      await reference.page.locator('.signature-car').first().waitFor();
      assert.deepEqual(await observe(page), await observe(reference.page));
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.tagName),
        'H1',
        'vehicle heading receives focus after in-app navigation',
      );
      assert.equal((await observe(page)).stagePlate, '9876 د');
      assert.equal((await observe(page)).selected, 'pickup');

      // Leaving for Home offers to continue the draft; resuming returns to the care step.
      await page.goForward();
      await page.locator('[data-booking-step="care"]').waitFor();
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      await page.locator('[data-home-entry="saved-draft"]').waitFor();
      assert.equal(await page.locator('.nav-dot').count(), 0, 'no order was created');
      assert.equal(await page.locator('[data-home-entry="active-order"]').count(), 0);
      await page.locator('[data-home-entry="saved-draft"] .text-btn').click();
      await page.locator('[data-booking-step="care"]').waitFor();
      assert.match(page.url(), /#\/book\/1$/);

      assert.equal(requests.length, requestsBefore, 'the vehicle step must not send any request');
      assert.deepEqual(
        await page.evaluate(() => ({
          local: globalThis.localStorage.length,
          session: globalThis.sessionStorage.length,
          cookies: globalThis.document.cookie,
        })),
        { local: 0, session: 0, cookies: '' },
        'the vehicle step must not write browser storage',
      );
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'draft round trip without requests or storage' });
    } finally {
      await context.close();
    }
  }

  // 5. Exit sheet: same sheet as the reference, modal, Escape and focus restoration.
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, 'home-empty');
      const { page, problems } = candidate;
      const openExit = (target) =>
        target.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await openExit(reference.page);
      await openExit(page);
      await reference.page.waitForTimeout(350);
      await page.waitForTimeout(350);
      const sheetState = (target) =>
        target.evaluate(() => {
          const sheet = globalThis.document.querySelector('dialog.sheet');
          const rect = sheet.getBoundingClientRect();
          const buttons = [...sheet.querySelectorAll('.btn')].map((button) => {
            const style = globalThis.getComputedStyle(button);
            const box = button.getBoundingClientRect();
            return [
              button.textContent.trim(),
              style.backgroundColor,
              style.color,
              style.fontSize,
              Math.round(box.y * 2) / 2,
              box.height,
            ];
          });
          return {
            open: sheet.open,
            modal: sheet.matches(':modal'),
            text: sheet.innerText.replace(/\s+/g, ' ').trim(),
            rect: [rect.x, rect.y, rect.width, rect.height].map((v) => Math.round(v * 2) / 2),
            buttons,
          };
        });
      assert.deepEqual(await sheetState(page), await sheetState(reference.page), 'exit sheet');
      await page.keyboard.press('Escape');
      await page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.getAttribute('aria-label')),
        'حفظ المسودة والخروج',
        'focus returns to the exit control',
      );
      await openExit(page);
      await page.getByRole('button', { name: 'متابعة الحجز' }).click();
      await page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });
      assert.equal(bookingStep(page.url()), '0', '"continue booking" stays on the step');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'exit sheet parity and focus restoration' });
    } finally {
      await context.close();
    }
  }

  // 6. Keyboard: order, visible focus, semantics, error announcement.
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openPair(context, server, 'booking-vehicle-prefilled');
      const { page, problems } = candidate;
      const stops = [];
      for (let i = 0; i < 9; i += 1) {
        await page.keyboard.press('Tab');
        stops.push(
          await page.evaluate(() => {
            const element = globalThis.document.activeElement;
            const ring = element.matches('input[type="radio"]')
              ? element.closest('.signature-car')
              : element;
            const style = globalThis.getComputedStyle(ring);
            const label =
              element.getAttribute('aria-label') ||
              element.id ||
              element.innerText.replace(/\s+/g, ' ').trim();
            return {
              tag: element.tagName,
              type: element.getAttribute('type'),
              name: element.getAttribute('name') || label,
              focusVisible: element.matches(':focus-visible'),
              outlined: style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) >= 2,
            };
          }),
        );
      }
      assert.deepEqual(
        stops.map((stop) => stop.name),
        [
          'انتقل إلى المحتوى',
          'الخطوة السابقة',
          'حفظ المسودة والخروج',
          'vehicleType',
          'plate',
          'اسم السيارة ولونها هايلكس أبيض',
          'saveVehicleInline',
          'تفاصيل السعر الحالي 1150 ليرة سورية',
          'اختيار العناية',
        ],
        'logical focus order with one stop for the radio group',
      );
      // No trap: one more Tab leaves the page for the browser's own UI.
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement === globalThis.document.body),
        true,
        'focus can leave the page after the last control',
      );
      for (const stop of stops) {
        assert.ok(['A', 'BUTTON', 'INPUT'].includes(stop.tag), `non-semantic stop: ${stop.tag}`);
        assert.equal(stop.focusVisible, true, `${stop.name}: focus not visible`);
        assert.equal(stop.outlined, true, `${stop.name}: no visible focus ring`);
      }

      const semantics = await page.evaluate(() => {
        const doc = globalThis.document;
        const group = doc.querySelector('[role="radiogroup"]');
        const plate = doc.querySelector('#plate');
        return {
          groupLabel: group?.getAttribute('aria-label'),
          radios: [...group.querySelectorAll('input[type="radio"]')].map((radio) => [
            radio.value,
            radio.checked,
            radio.labels?.[0]?.innerText.replace(/\s+/g, ' ').trim(),
          ]),
          plateLabelled: Boolean(plate.labels?.length),
          plateDescribedBy: plate.getAttribute('aria-describedby'),
          plateHelp: doc.getElementById('plate-help')?.textContent.trim(),
          stepper: doc.querySelector('.stepper')?.getAttribute('aria-label'),
          currentStep: doc.querySelector('[aria-current="step"]')?.textContent.trim(),
          clickOnly: doc.querySelectorAll('.main [role="button"], .main div[onclick]').length,
          headings: [...doc.querySelectorAll('.main h1')].length,
        };
      });
      assert.deepEqual(semantics, {
        groupLabel: 'اختر حجم السيارة',
        radios: [
          ['sedan', false, 'سيدان السعر الأساسي'],
          ['suv', false, 'كروس أوفر +200 ل.س'],
          ['large', false, 'دفع رباعي +350 ل.س'],
          ['pickup', true, 'بيك أب +250 ل.س'],
        ],
        plateLabelled: true,
        plateDescribedBy: 'plate-help',
        plateHelp: 'تساعد الفني على تمييز سيارتك. استخدم لوحة تجريبية.',
        stepper: 'الخطوة 1 من 7',
        currentStep: 'السيارة',
        clickOnly: 0,
        headings: 1,
      });

      // Keyboard-only failure path: Space selects, Enter submits, the error is announced.
      await page.locator(typeRadio('pickup')).focus();
      await page.keyboard.press('ArrowUp');
      assert.equal((await observe(page)).selected, 'large');
      await page.locator(PLATE).fill('بدون رقم');
      await page.locator(PLATE).press('Enter');
      await page.locator('#error-plate').waitFor();
      const failed = await observe(page);
      assert.equal(failed.focused, 'plate', 'focus moves to the invalid field');
      assert.equal(failed.plateInvalid, 'true');
      assert.equal(failed.plateDescribedBy, 'plate-help error-plate');
      assert.equal(failed.errorRole, 'alert');
      assert.equal(
        await page.locator('.sr-only[aria-live="polite"]').innerText(),
        failed.error,
        'the error is also sent to the polite live region',
      );
      assert.equal(bookingStep(page.url()), '0');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'keyboard order, focus, semantics, error announcement' });
    } finally {
      await context.close();
    }
  }

  // 7. Refresh and deep link keep the step; an unknown scenario falls back to the default.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/0?scenario=booking-vehicle-prefilled',
        VEHICLE_READY,
      );
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator(VEHICLE_READY).first().waitFor();
      assert.equal((await observe(page)).stagePlate, '4821 ب ج');
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.classList.contains('skip')),
        true,
        'skip link is the first stop after a fresh load',
      );
      await page.goto(`${origin}/#/book/0?scenario=does-not-exist`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator(VEHICLE_READY).first().waitFor();
      const fallback = await observe(page);
      assert.equal(fallback.selected, 'sedan');
      assert.equal(fallback.stagePlate, null);
      assert.equal(
        await page.locator('[data-customer-fixture="booking-vehicle-default"]').count(),
        1,
      );
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'refresh, deep link and scenario fallback' });
    } finally {
      await context.close();
    }
  }

  // 8. Motion: selection feedback runs with motion allowed and not under reduced motion.
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await newContext(browser, 390, { reducedMotion });
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/0?scenario=home-empty',
        VEHICLE_READY,
      );
      await page.locator('.booking-footer').waitFor();
      await page.locator(typeCard('suv')).click();
      await page.locator(`${typeCard('suv')}.selected`).waitFor();
      const running = await page.evaluate(
        () =>
          globalThis.document
            .getAnimations()
            .filter((animation) => animation.constructor.name === 'Animation').length,
      );
      assert.equal(
        running > 0,
        reducedMotion !== 'reduce',
        `selection feedback with ${reducedMotion}: ${running} script animations`,
      );
      assert.equal((await observe(page)).selected, 'suv', 'the selection applies either way');
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
  summary.interactions.push({ name: 'selection motion and reduced motion' });

  // 9. On-screen keyboard: on a short viewport the action bar leaves the field visible.
  {
    const context = await newContext(browser, 390, { height: 480 });
    try {
      const { reference, candidate } = await openPair(context, server, 'home-empty');
      const footerPosition = (target) =>
        target.evaluate(() => ({
          keyboardEntry: globalThis.document.documentElement.classList.contains('keyboard-entry'),
          position: globalThis.getComputedStyle(
            globalThis.document.querySelector('.booking-footer'),
          ).position,
        }));
      assert.deepEqual(await footerPosition(candidate.page), await footerPosition(reference.page));
      await reference.page.locator(PLATE).focus();
      await candidate.page.locator(PLATE).focus();
      const focused = await footerPosition(candidate.page);
      assert.deepEqual(focused, await footerPosition(reference.page));
      assert.deepEqual(focused, { keyboardEntry: true, position: 'static' });
      await reference.page.locator(PLATE).blur();
      await candidate.page.locator(PLATE).blur();
      assert.deepEqual(await footerPosition(candidate.page), {
        keyboardEntry: false,
        position: 'fixed',
      });
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'short-viewport keyboard entry' });
    } finally {
      await context.close();
    }
  }

  writeFileSync(resolve(evidence, 'c004-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `C004 browser acceptance passed: ${summary.visual.length} visual comparisons, ` +
      `${summary.interactions.length} interaction checks. Evidence: ${evidence}`,
  );
} catch (error) {
  writeFileSync(resolve(evidence, 'c004-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`C004 evidence directory: ${evidence}`);
  throw error;
} finally {
  await server.close();
  await browser.close();
}
