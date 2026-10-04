// C007 browser acceptance: renders the React add-ons sheet of the care step next
// to the approved customer HTML in the same browser, compares structure, copy,
// geometry, computed style and pixels, then applies the same interactions to both.
//
// Methodology and helpers are those of the C004 acceptance (scripts/c004). The
// reference is served read-only and is never modified.
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

const origin = process.env.C007_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C007_EVIDENCE_DIR
  ? resolve(process.env.C007_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c007-'));
mkdirSync(evidence, { recursive: true });

const PARITY_SELECTORS = [
  'body',
  '.app',
  '.main',
  '.service-option',
  '.service-amount',
  '.main .disclosure-row',
  '.main .disclosure-row .soft-icon',
  '.main .disclosure-row strong',
  '.main .disclosure-row p',
  '.main .disclosure-row .amount',
  '.main .disclosure-row > .icon',
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
  'dialog.sheet[open] .stack',
  'dialog.sheet[open] .addon-option',
  'dialog.sheet[open] .addon-option .choice',
  'dialog.sheet[open] .addon-option .soft-icon',
  'dialog.sheet[open] .addon-option .soft-icon .icon',
  'dialog.sheet[open] .addon-option .grow',
  'dialog.sheet[open] .addon-option strong',
  'dialog.sheet[open] .addon-option small',
  'dialog.sheet[open] .addon-price',
  'dialog.sheet[open] .checkbox-ui',
  'dialog.sheet[open] .checkbox-ui .icon',
  'dialog.sheet[open] .bill-line',
  'dialog.sheet[open] .bill-line span',
  'dialog.sheet[open] .bill-line strong',
  'dialog.sheet[open] .currency',
  'dialog.sheet[open] .btn',
  'dialog.sheet[open] .btn .icon',
];

const NEXT = '.primary-next';
const TOTAL = '.booking-total';
const ROW = '.main .disclosure-row';
const APPLY = { role: 'button', name: 'حفظ الاختيارات' };
const extraBox = (id) => `input[name="extra"][value="${id}"]`;
const extraRow = (id) => `.addon-option:has(${extraBox(id)})`;
const packageRadio = (id) => `input[name="service"][value="${id}"]`;
const packageCard = (id) => `.service-option:has(${packageRadio(id)})`;
const sheetOpen = (page) => page.locator('dialog.sheet[open]').waitFor();
const sheetClosed = (page) => page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });
const openExtras = async (page) => {
  await page.locator(ROW).click();
  await sheetOpen(page);
};
const applyExtras = async (page) => {
  await page.getByRole(APPLY.role, { name: APPLY.name }).click();
  await sheetClosed(page);
};
const toggle = (id) => (page) => page.locator(extraRow(id)).click();
const selectPackage = async (page, id) => {
  await page.locator(packageCard(id)).click();
  await page.locator(`${packageCard(id)}.selected`).waitFor();
};

async function openPair(context, server, scenario) {
  const state = initialSessionState(`#/?scenario=${scenario}`);
  const storage = referenceStorageFor(state, { screen: 'booking', step: 1 });
  storage.cars = state.vehicles.map((vehicle) => ({ ...vehicle }));
  storage.draft.carId = state.draft.carId;
  const reference = await openReference(context, server, storage, '#book/1');
  await reference.page.locator('.service-option').first().waitFor();
  const candidate = await openCandidate(
    context,
    origin,
    `/book/1?scenario=${scenario}`,
    '.service-option',
  );
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
    return {
      step: /book[/]\d+/.exec(route)?.[0] ?? 'other',
      selectedPackage: doc.querySelector('input[name="service"]:checked')?.value ?? null,
      amounts: [...doc.querySelectorAll('.service-amount')].map((node) => clean(node.textContent)),
      extrasRow: doc.querySelector('.main .disclosure-row .amount')
        ? [text('.main .disclosure-row p'), text('.main .disclosure-row .amount')]
        : null,
      footerPrice: text('#footer-price'),
      footerDuration: text('.footer-assurance span:last-child'),
      // The last notice raised, whether or not it is still on screen (see C005).
      toast: (toast && clean(toast.textContent)) || null,
      sheet: sheet
        ? {
            title: text('.sheet-head h2', sheet),
            intro: text('.sheet-intro', sheet),
            options: [...sheet.querySelectorAll('.addon-option')].map((node) => {
              const input = node.querySelector('input');
              const tick = node.querySelector('.checkbox-ui svg');
              return {
                id: input.value,
                type: input.type,
                checked: input.checked,
                disabled: input.disabled,
                state: node.classList.contains('included')
                  ? 'included'
                  : node.classList.contains('selected')
                    ? 'selected'
                    : 'none',
                name: text('strong', node),
                hint: text('small', node),
                price: text('.addon-price', node),
                tickShown: globalThis.getComputedStyle(tick).display !== 'none',
              };
            }),
            total: text('#extras-total', sheet),
            lines: [...sheet.querySelectorAll('.bill .bill-line')].map((line) =>
              [...line.children].map((cell) => clean(cell.textContent)),
            ),
            buttons: [...sheet.querySelectorAll('.btn')].map((button) => clean(button.textContent)),
          }
        : null,
    };
  });
}

/** Screens compared visually. `prepare` runs the same steps on both pages. */
const visualStates = [
  { id: 'extras-none-selected', scenario: 'home-empty', prepare: openExtras },
  { id: 'extras-two-selected', scenario: 'booking-care-with-extras', prepare: openExtras },
  {
    id: 'extras-package-includes-one',
    scenario: 'home-returning-customer',
    prepare: openExtras,
  },
  {
    id: 'extras-all-selected',
    scenario: 'booking-vehicle-prefilled',
    prepare: async (page) => {
      await openExtras(page);
      for (const id of ['seats', 'wheels', 'fresh']) {
        await page.locator(extraRow(id)).click();
        await page.locator(`${extraRow(id)}.selected`).waitFor();
      }
    },
  },
  {
    id: 'care-after-extras-saved',
    scenario: 'home-empty',
    prepare: async (page) => {
      await openExtras(page);
      await page.locator(extraRow('seats')).click();
      await page.locator(extraRow('fresh')).click();
      await applyExtras(page);
      // Let the four-second confirmation notice leave, so the capture does not
      // depend on how long the other page took.
      await page.waitForTimeout(4400);
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
        await visual.prepare(reference.page);
        await visual.prepare(candidate.page);
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
      name: 'each add-on can be ticked and unticked; total and duration follow live',
      scenario: 'home-empty',
      steps: [
        openExtras,
        toggle('seats'),
        toggle('wheels'),
        toggle('fresh'),
        toggle('wheels'),
        toggle('seats'),
        toggle('fresh'),
      ],
    },
    {
      name: 'saving the choices updates the row, the total and confirms with a notice',
      scenario: 'booking-vehicle-prefilled',
      steps: [openExtras, toggle('seats'), toggle('fresh'), applyExtras],
    },
    {
      name: 'an add-on the package includes is ticked, disabled and not charged',
      scenario: 'home-returning-customer',
      steps: [
        openExtras,
        // Clicking the included row changes nothing on either page.
        (page) => page.locator(extraRow('wheels')).click({ force: true }),
        toggle('seats'),
        toggle('fresh'),
        applyExtras,
      ],
    },
    {
      name: 'switching to a package that includes a chosen add-on, and back',
      scenario: 'booking-care-with-extras',
      steps: [
        (page) => selectPackage(page, 'premium'),
        openExtras,
        applyExtras,
        (page) => selectPackage(page, 'complete'),
        openExtras,
        toggle('wheels'),
        applyExtras,
      ],
    },
    {
      name: 'the price breakdown lists chosen add-ons and drops removed ones',
      scenario: 'home-empty',
      steps: [
        openExtras,
        toggle('seats'),
        toggle('wheels'),
        applyExtras,
        async (page) => {
          await page.locator(TOTAL).click();
          await sheetOpen(page);
        },
        async (page) => {
          await page.getByRole('button', { name: 'متابعة الحجز' }).click();
          await sheetClosed(page);
        },
        openExtras,
        toggle('seats'),
        applyExtras,
        async (page) => {
          await page.locator(TOTAL).click();
          await sheetOpen(page);
        },
      ],
    },
    {
      name: 'the keyboard ticks an add-on with Space',
      scenario: 'home-empty',
      steps: [
        openExtras,
        (page) => page.locator(extraBox('seats')).focus(),
        (page) => page.keyboard.press('Space'),
        (page) => page.keyboard.press('Tab'),
        (page) => page.keyboard.press('Space'),
        (page) => page.keyboard.press('Space'),
      ],
    },
    {
      name: 'reopening the sheet shows the saved choices',
      scenario: 'home-empty',
      steps: [openExtras, toggle('fresh'), applyExtras, openExtras],
    },
  ];
  for (const interaction of interactionCases) {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, interaction.scenario);
      for (const [index, step] of interaction.steps.entries()) {
        await step(reference.page);
        await step(candidate.page);
        await reference.page.waitForTimeout(80);
        await candidate.page.waitForTimeout(80);
        assert.deepEqual(
          await observe(candidate.page),
          await observe(reference.page),
          `${interaction.name}: after step ${index + 1}`,
        );
      }
      assert.deepEqual(candidate.problems, [], `${interaction.name}: candidate page problems`);
      summary.interactions.push({ name: interaction.name, steps: interaction.steps.length });
    } finally {
      await context.close();
    }
  }

  // 3. Choices take effect as they are ticked, so closing without "save" keeps them.
  //    (The reference leaves the row behind the sheet stale until its next redraw;
  //    the port refreshes it on close, so the row is not part of this comparison.)
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, 'home-empty');
      for (const target of [reference.page, candidate.page]) {
        await openExtras(target);
        await target.locator(extraRow('seats')).click();
        await target.keyboard.press('Escape');
        await sheetClosed(target);
        await openExtras(target);
      }
      const withoutRow = ({ extrasRow, ...rest }) => ({ rowSeen: extrasRow !== null, ...rest });
      assert.deepEqual(
        withoutRow(await observe(candidate.page)),
        withoutRow(await observe(reference.page)),
      );
      await candidate.page.keyboard.press('Escape');
      await sheetClosed(candidate.page);
      assert.deepEqual((await observe(candidate.page)).extrasRow, ['تنظيف المقاعد', '+350 ل.س']);
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'closing without saving keeps the ticked add-ons' });
    } finally {
      await context.close();
    }
  }

  // 4. The journey around the sheet: Next, Back, history, resume — and nothing leaves the page.
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, 'garage-vehicle-chosen');
      const { page, problems, requests } = candidate;
      const requestsBefore = requests.length;
      for (const target of [reference.page, page]) {
        await openExtras(target);
        await target.locator(extraRow('seats')).click();
        await target.locator(extraRow('wheels')).click();
        await applyExtras(target);
      }
      assert.match(page.url(), /#\/book\/1/, 'the add-ons sheet never leaves the care step');
      assert.deepEqual(await observe(page), await observe(reference.page));

      // Next leads to the location step on both; the add-ons stay in the draft.
      await reference.page.locator(NEXT).click();
      await page.locator(NEXT).click();
      await page.locator('[data-booking-step="location"]').waitFor();
      await reference.page.waitForURL(/#book[/]2$/);
      assert.match(page.url(), /#\/book\/2$/);

      // Browser Back returns to the care step with the same add-ons; header Back to the vehicle step.
      await page.goBack();
      await page.locator('.service-option').first().waitFor();
      await reference.page.goBack();
      await reference.page.locator('.service-option').first().waitFor();
      assert.deepEqual(await observe(page), await observe(reference.page));
      await page.goForward();
      await page.locator('[data-booking-step="location"]').waitFor();
      await page.goBack();
      await page.locator('.service-option').first().waitFor();
      for (const target of [reference.page, page]) {
        await target.getByRole('button', { name: 'الخطوة السابقة' }).click();
        await target.locator('.signature-car').first().waitFor();
      }
      assert.match(page.url(), /#\/book\/0$/);
      await page.locator('.booking-footer').waitFor();
      assert.equal(
        await page.locator('#footer-price').innerText(),
        await reference.page.locator('#footer-price').innerText(),
        'the vehicle step total still includes the add-ons',
      );

      // Save and exit: Home offers the draft with the add-ons in its total; resume returns here.
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      const savedDraft = page.locator('[data-home-entry="saved-draft"]');
      await savedDraft.waitFor();
      assert.equal(
        (await savedDraft.locator('p').innerText()).replace(/\s+/g, ' ').trim(),
        'لمعة سريعة · 1,200 ل.س',
      );
      assert.equal(await page.locator('.nav-dot').count(), 0, 'no order was created');
      assert.equal(await page.locator('[data-home-entry="active-order"]').count(), 0);
      await savedDraft.locator('.text-btn').click();
      await page.locator('.signature-car').first().waitFor();
      await page.locator(NEXT).click();
      await page.locator('.service-option').first().waitFor();
      assert.deepEqual((await observe(page)).extrasRow, [
        'تنظيف المقاعد، تلميع الإطارات',
        '+500 ل.س',
      ]);

      // The garage is untouched by choosing add-ons.
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      await page.locator('[data-home-entry="saved-draft"]').waitFor();
      await page.getByRole('link', { name: 'سياراتي' }).click();
      await page.locator('.garage-card').first().waitFor();
      assert.equal(await page.locator('.garage-card').count(), 3);

      assert.equal(requests.length, requestsBefore, 'add-ons must not send any request');
      assert.deepEqual(
        await page.evaluate(() => ({
          local: globalThis.localStorage.length,
          session: globalThis.sessionStorage.length,
          cookies: globalThis.document.cookie,
        })),
        { local: 0, session: 0, cookies: '' },
        'add-ons must not write browser storage',
      );
      assert.deepEqual(problems, []);
      summary.interactions.push({
        name: 'Next, Back, history, resume; no request, storage or order',
      });
    } finally {
      await context.close();
    }
  }

  // 5. Keyboard, semantics, modality and focus.
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openPair(context, server, 'home-returning-customer');
      const { page, problems } = candidate;
      const row = page.locator(ROW);
      assert.equal(await row.getAttribute('aria-haspopup'), 'dialog');
      assert.equal(await row.getAttribute('aria-disabled'), null, 'the row is a real control');
      assert.equal(await row.evaluate((node) => node.tagName), 'BUTTON');

      await row.focus();
      await page.keyboard.press('Enter');
      await sheetOpen(page);
      const dialog = await page.evaluate(() => {
        const sheet = globalThis.document.querySelector('dialog.sheet[open]');
        const ids = [...globalThis.document.querySelectorAll('[id]')].map((node) => node.id);
        return {
          modal: sheet.matches(':modal'),
          title: globalThis.document.getElementById(sheet.getAttribute('aria-labelledby'))
            ?.textContent,
          duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
          boxes: [...sheet.querySelectorAll('input[name="extra"]')].map((input) => ({
            id: input.value,
            type: input.type,
            checked: input.checked,
            disabled: input.disabled,
            // Accessible name: the label's text, which carries name, hint and price.
            label: input.labels[0].innerText.replace(/\s+/g, ' ').trim(),
          })),
          clickOnly: sheet.querySelectorAll('[role="button"], [role="checkbox"], div[onclick]')
            .length,
        };
      });
      assert.deepEqual(dialog, {
        modal: true,
        title: 'لمسات إضافية، على ذوقك.',
        duplicateIds: [],
        boxes: [
          {
            id: 'seats',
            type: 'checkbox',
            checked: true,
            disabled: false,
            label: 'تنظيف المقاعد عناية إضافية بالقماش +350',
          },
          {
            id: 'wheels',
            type: 'checkbox',
            checked: true,
            disabled: true,
            label: 'تلميع الإطارات لمسة أخيرة أجمل ضمن الباقة',
          },
          {
            id: 'fresh',
            type: 'checkbox',
            checked: false,
            disabled: false,
            label: 'تعطير المقصورة رائحة خفيفة ومنعشة +100',
          },
        ],
        clickOnly: 0,
      });

      // Tab stays inside the sheet, skips the disabled add-on and shows a focus ring.
      const stops = new Set();
      for (let i = 0; i < 10; i += 1) {
        await page.keyboard.press('Tab');
        const where = await page.evaluate(() => {
          const element = globalThis.document.activeElement;
          if (!element || element === globalThis.document.body) return 'browser';
          if (!element.closest('dialog.sheet[open]')) return `outside:${element.className}`;
          const ring = element.matches('input[type="checkbox"]')
            ? element.closest('.addon-option')
            : element;
          const style = globalThis.getComputedStyle(ring);
          const ringed = style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) >= 2;
          const name =
            element.getAttribute('aria-label') ||
            element.value ||
            element.innerText.replace(/\s+/g, ' ').trim();
          return `sheet:${name}:${ringed ? 'ringed' : 'NO-RING'}`;
        });
        assert.ok(!where.startsWith('outside:'), `focus escaped the sheet to ${where}`);
        if (where.startsWith('sheet:')) stops.add(where);
      }
      assert.deepEqual(
        [...stops].sort(),
        [
          'sheet:fresh:ringed',
          'sheet:seats:ringed',
          'sheet:إغلاق النافذة:ringed',
          'sheet:حفظ الاختيارات:ringed',
        ],
        'every enabled control is reachable; the included add-on is not a stop',
      );

      // Space on a focused add-on toggles it and the polite total follows.
      await page.locator(extraBox('fresh')).focus();
      await page.keyboard.press('Space');
      assert.equal((await observe(page)).sheet.total, '2,150 ل.س');
      assert.equal(await page.locator('#footer-price').getAttribute('aria-live'), 'polite');

      // Escape closes; focus returns to the row; scrolling is unlocked.
      await page.keyboard.press('Escape');
      await sheetClosed(page);
      assert.equal(
        await page.evaluate(() =>
          globalThis.document.activeElement?.matches('.main .disclosure-row'),
        ),
        true,
        'focus returns to the add-ons row',
      );
      await page.waitForFunction(() => globalThis.document.body.style.overflow === '');

      // "Save" closes, returns focus to the row and confirms with a polite status notice.
      await page.keyboard.press('Enter');
      await sheetOpen(page);
      await page.getByRole(APPLY.role, { name: APPLY.name }).click();
      await sheetClosed(page);
      await page.locator('.toast.show').waitFor();
      assert.equal(await page.locator('.toast.show').getAttribute('role'), 'status');
      assert.equal(await page.locator('.toast.show').innerText(), 'تم تحديث الإضافات والسعر.');
      assert.equal(
        await page.evaluate(() =>
          globalThis.document.activeElement?.matches('.main .disclosure-row'),
        ),
        true,
      );
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'keyboard, semantics, sheet modality and focus' });
    } finally {
      await context.close();
    }
  }

  // 6. Refresh, deep link and unknown scenario.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/1?scenario=booking-care-with-extras',
        '.service-option',
      );
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.service-option').first().waitFor();
      await openExtras(page);
      assert.deepEqual(
        (await observe(page)).sheet.options.map((option) => [option.id, option.state]),
        [
          ['seats', 'none'],
          ['wheels', 'selected'],
          ['fresh', 'selected'],
        ],
      );
      await page.goto(`${origin}/#/book/1?scenario=constructor`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.service-option').first().waitFor();
      await openExtras(page);
      assert.ok((await observe(page)).sheet.options.every((option) => option.state === 'none'));
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'refresh, deep link and scenario fallback' });
    } finally {
      await context.close();
    }
  }

  // 7. Reduced motion: the sheet and the toggles work identically without animation.
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await newContext(browser, 390, { reducedMotion });
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/1?scenario=home-empty',
        '.service-option',
      );
      await page.locator('.booking-footer').waitFor();
      await openExtras(page);
      await page.locator(extraRow('wheels')).click();
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
      assert.equal((await observe(page)).sheet.total, '650 ل.س');
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
  summary.interactions.push({ name: 'reduced motion' });

  writeFileSync(resolve(evidence, 'c007-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `C007 browser acceptance passed: ${summary.visual.length} visual comparisons, ` +
      `${summary.interactions.length} interaction checks. Evidence: ${evidence}`,
  );
} catch (error) {
  writeFileSync(resolve(evidence, 'c007-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`C007 evidence directory: ${evidence}`);
  throw error;
} finally {
  await server.close();
  await browser.close();
}
