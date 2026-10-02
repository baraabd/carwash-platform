// C006 browser acceptance: renders the React care (package) step, the price
// breakdown sheet and Home's package-details sheet next to the approved customer
// HTML in the same browser, compares structure, copy, geometry, computed style and
// pixels, then applies the same interactions to both.
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
  watchPage,
} from '../c004/parity-harness.mjs';

const origin = process.env.C006_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C006_EVIDENCE_DIR
  ? resolve(process.env.C006_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c006-'));
mkdirSync(evidence, { recursive: true });

const SCREENS = {
  care: { reference: '#book/1', candidate: '/book/1', step: 1, ready: '.service-option' },
  vehicle: { reference: '#book/0', candidate: '/book/0', step: 0, ready: '.signature-car' },
};

const PARITY_SELECTORS = [
  'body',
  '.skip',
  '.app',
  '.app-header',
  '.app-header .icon-btn',
  '.header-title',
  '.header-title small',
  '.main',
  '.journey-heading',
  '.journey-number strong',
  '.stepper',
  '.step-segment',
  '.step-segment i',
  '.page-heading',
  '.page-heading h1',
  '.page-heading p',
  '.page-heading .chapter-icon',
  '.page-heading .chapter-icon .icon',
  '.choice-context',
  '.choice-context > .icon',
  '.choice-context > span',
  '.choice-context .text-btn',
  '.service-list',
  '.service-option',
  '.service-option .choice',
  '.service-line',
  '.service-emblem',
  '.service-emblem .icon',
  '.service-kicker',
  '.service-line h3',
  '.service-line p',
  '.service-line p .icon',
  '.service-side',
  '.service-side .radio-circle',
  '.service-side .radio-circle .icon',
  '.service-amount',
  '.service-amount small',
  '.service-features',
  '.service-features span',
  '.service-features .icon',
  '.main .disclosure-row',
  '.main .disclosure-row .soft-icon',
  '.main .disclosure-row .soft-icon .icon',
  '.main .disclosure-row strong',
  '.main .disclosure-row p',
  '.main .disclosure-row .amount',
  '.booking-footer',
  '.footer-assurance',
  '.footer-assurance span',
  '.booking-total',
  '.booking-total small',
  '.booking-total strong',
  '.booking-total .currency',
  '.primary-next',
  '.primary-next > span:first-child',
  '.button-arrow',
  'dialog.sheet[open]',
  'dialog.sheet[open] .sheet-inner',
  'dialog.sheet[open] .sheet-head',
  'dialog.sheet[open] .sheet-head h2',
  'dialog.sheet[open] .sheet-head .icon-btn',
  'dialog.sheet[open] .sheet-intro',
  'dialog.sheet[open] .stack',
  'dialog.sheet[open] .bill',
  'dialog.sheet[open] .bill h3',
  'dialog.sheet[open] .bill .row',
  'dialog.sheet[open] .bill .row strong',
  'dialog.sheet[open] .bill-line',
  'dialog.sheet[open] .bill-line span',
  'dialog.sheet[open] .bill-line strong',
  'dialog.sheet[open] .currency',
  'dialog.sheet[open] .input-note',
  'dialog.sheet[open] .btn',
  'dialog.sheet[open] .btn .icon',
];

const NEXT = '.primary-next';
const TOTAL = '.booking-total';
const packageRadio = (id) => `input[name="service"][value="${id}"]`;
const packageCard = (id) => `.service-option:has(${packageRadio(id)})`;
const sheetOpen = (page) => page.locator('dialog.sheet[open]').waitFor();
const sheetClosed = (page) => page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });
const selectPackage = async (page, id) => {
  await page.locator(packageCard(id)).click();
  await page.locator(`${packageCard(id)}.selected`).waitFor();
};

function referenceStorage(scenario, screen, step) {
  const state = initialSessionState(`#/?scenario=${scenario}`);
  const storage = referenceStorageFor(state, { screen, step });
  storage.cars = state.vehicles.map((vehicle) => ({ ...vehicle }));
  storage.draft.carId = state.draft.carId;
  return storage;
}

async function openPair(context, server, scenario, screenId) {
  const screen = SCREENS[screenId];
  const reference = await openReference(
    context,
    server,
    referenceStorage(scenario, 'booking', screen.step),
    screen.reference,
  );
  await reference.page.locator(screen.ready).first().waitFor();
  const candidate = await openCandidate(
    context,
    origin,
    `${screen.candidate}?scenario=${scenario}`,
    screen.ready,
  );
  await candidate.page.locator('.booking-footer').waitFor();
  return { reference, candidate };
}

/**
 * Home pair. Unlike the booking pages the reference keeps its normal storage
 * here, exactly as in the C003 acceptance, so its Home has no session-only note.
 */
async function openHomePair(context, server, scenario) {
  const page = await context.newPage();
  const watch = watchPage(page, 'reference');
  await page.addInitScript(
    ({ value }) => globalThis.localStorage.setItem('washgo.payments.sy.v6', value),
    { value: JSON.stringify(referenceStorage(scenario, 'home', 0)) },
  );
  const response = await page.goto(`${server.origin}/customer`, { waitUntil: 'load' });
  assert.equal(response?.status(), 200);
  await settle(page);
  await page.locator('.hero-cta').waitFor();
  const candidate = await openCandidate(context, origin, `/?scenario=${scenario}`, '.hero-cta');
  return { reference: { page, ...watch }, candidate };
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
    return {
      step: /book[/]\d+/.exec(route)?.[0] ?? 'other',
      title: doc.title,
      heading: text('.main h1'),
      context: text('.choice-context'),
      packages: [...doc.querySelectorAll('.service-option')].map((node) => ({
        id: node.querySelector('input').value,
        checked: node.querySelector('input').checked,
        selected: node.classList.contains('selected'),
        tick: node.querySelectorAll('.radio-circle svg').length,
        kicker: text('.service-kicker', node),
        name: text('h3', node),
        duration: text('.service-line p', node),
        amount: text('.service-amount', node),
        features: [...node.querySelectorAll('.service-features span')].map((span) =>
          clean(span.textContent),
        ),
      })),
      extras: doc.querySelector('.main .disclosure-row .amount')
        ? [text('.main .disclosure-row p'), text('.main .disclosure-row .amount')]
        : null,
      vehicleType: doc.querySelector('input[name="vehicleType"]:checked')?.value ?? null,
      footerPrice: text('#footer-price'),
      footerDuration: text('.footer-assurance span:last-child'),
      nextLabel: text('.primary-next > span:first-child'),
      sheet: sheet
        ? {
            title: text('.sheet-head h2', sheet),
            intro: text('.sheet-intro', sheet),
            billTitle: text('.bill > h3', sheet),
            lines: [...sheet.querySelectorAll('.bill-line')].map((line) =>
              [...line.children].map((cell) => clean(cell.textContent)),
            ),
            packages: [...sheet.querySelectorAll('.stack .bill')].map((item) => [
              text('h3', item),
              text('.row strong', item),
              text('.input-note', item),
              text('.btn', item),
            ]),
            note: [...sheet.querySelectorAll(':scope .sheet-inner > .input-note')].map((p) =>
              clean(p.textContent),
            ),
            buttons: [...sheet.querySelectorAll('.btn')].map((b) => clean(b.textContent)),
          }
        : null,
    };
  });
}

/** Screens compared visually. `prepare` runs the same steps on both pages. */
const visualStates = [
  { id: 'care-default', scenario: 'home-empty', screen: 'care' },
  { id: 'care-prefilled-draft', scenario: 'booking-vehicle-prefilled', screen: 'care' },
  { id: 'care-returning-customer', scenario: 'home-returning-customer', screen: 'care' },
  { id: 'care-saved-vehicle', scenario: 'garage-vehicle-chosen', screen: 'care' },
  { id: 'care-with-extras', scenario: 'booking-care-with-extras', screen: 'care' },
  {
    id: 'care-premium-selected',
    scenario: 'home-empty',
    screen: 'care',
    prepare: (page) => selectPackage(page, 'premium'),
  },
  {
    id: 'care-price-breakdown',
    scenario: 'booking-care-with-extras',
    screen: 'care',
    prepare: async (page) => {
      await page.locator(TOTAL).click();
      await sheetOpen(page);
    },
  },
  {
    id: 'vehicle-price-breakdown',
    scenario: 'home-empty',
    screen: 'vehicle',
    prepare: async (page) => {
      await page.locator(TOTAL).click();
      await sheetOpen(page);
    },
  },
  {
    id: 'home-package-details',
    scenario: 'home-empty',
    screen: 'home',
    prepare: async (page) => {
      await page.locator('.section-title .text-btn').click();
      await sheetOpen(page);
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
        const { reference, candidate } =
          visual.screen === 'home'
            ? await openHomePair(context, server, visual.scenario)
            : await openPair(context, server, visual.scenario, visual.screen);
        if (visual.prepare) {
          await visual.prepare(reference.page);
          await visual.prepare(candidate.page);
          await reference.page.waitForTimeout(320);
          await candidate.page.waitForTimeout(320);
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
      name: 'every package can be selected; total and duration follow',
      scenario: 'home-empty',
      steps: ['complete', 'premium', 'exterior'].map((id) => (page) => selectPackage(page, id)),
    },
    {
      name: 'prices and durations depend on the vehicle size',
      scenario: 'booking-vehicle-prefilled',
      steps: ['exterior', 'premium'].map((id) => (page) => selectPackage(page, id)),
    },
    {
      name: 'a package that includes an add-on drops it from the draft',
      scenario: 'booking-care-with-extras',
      steps: [(page) => selectPackage(page, 'premium'), (page) => selectPackage(page, 'exterior')],
    },
    {
      name: 'arrow keys move the selection inside the radio group',
      scenario: 'home-empty',
      steps: [
        (page) => page.locator(packageRadio('exterior')).focus(),
        (page) => page.keyboard.press('ArrowDown'),
        (page) => page.keyboard.press('ArrowDown'),
        (page) => page.keyboard.press('ArrowUp'),
        (page) => page.keyboard.press('ArrowLeft'),
        (page) => page.keyboard.press('ArrowRight'),
      ],
    },
    {
      name: 'the price breakdown lists package, size, extras and total, and follows changes',
      scenario: 'booking-care-with-extras',
      steps: [
        async (page) => {
          await page.locator(TOTAL).click();
          await sheetOpen(page);
        },
        async (page) => {
          await page.getByRole('button', { name: 'متابعة الحجز' }).click();
          await sheetClosed(page);
        },
        (page) => selectPackage(page, 'premium'),
        async (page) => {
          await page.locator(TOTAL).click();
          await sheetOpen(page);
        },
      ],
    },
    {
      name: 'the price breakdown on the vehicle step follows the chosen size',
      scenario: 'home-empty',
      screen: 'vehicle',
      steps: [
        async (page) => {
          await page.locator('.signature-car:has(input[value="large"])').click();
          await page.locator('.signature-car.selected:has(input[value="large"])').waitFor();
        },
        async (page) => {
          await page.locator(TOTAL).click();
          await sheetOpen(page);
        },
      ],
    },
    {
      name: '"change" returns to the vehicle step and the new size reprices the packages',
      scenario: 'home-empty',
      steps: [
        async (page) => {
          await page.locator('.choice-context .text-btn').click();
          await page.locator('.signature-car').first().waitFor();
        },
        async (page) => {
          await page.locator('.signature-car:has(input[value="pickup"])').click();
          await page.locator('.signature-car.selected:has(input[value="pickup"])').waitFor();
        },
        async (page) => {
          await page.locator(NEXT).click();
          await page.locator('.service-option').first().waitFor();
        },
      ],
    },
    {
      name: 'header back returns to the vehicle step',
      scenario: 'booking-vehicle-prefilled',
      steps: [
        async (page) => {
          await page.getByRole('button', { name: 'الخطوة السابقة' }).click();
          await page.locator('.signature-car').first().waitFor();
        },
      ],
    },
  ];
  for (const interaction of interactionCases) {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(
        context,
        server,
        interaction.scenario,
        interaction.screen ?? 'care',
      );
      for (const [index, step] of interaction.steps.entries()) {
        await step(reference.page);
        await step(candidate.page);
        await reference.page.waitForTimeout(80);
        await candidate.page.waitForTimeout(80);
        await candidate.page.locator('.booking-footer').waitFor();
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

  // 3. Next leads to the location step on both; the care step validates nothing.
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, 'home-empty', 'care');
      await reference.page.locator(NEXT).click();
      await candidate.page.locator(NEXT).click();
      await candidate.page.locator('[data-booking-step="location"]').waitFor();
      await reference.page.waitForURL(/#book[/]2$/);
      assert.match(candidate.page.url(), /#\/book\/2$/);
      assert.equal(
        await candidate.page.evaluate(() => globalThis.document.activeElement?.tagName),
        'H1',
        'location heading receives focus on entry',
      );
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'Next leads to the location step' });
    } finally {
      await context.close();
    }
  }

  // 4. Home entries: package card, package-details sheet, resume — compared at the care step.
  const homeEntries = [
    {
      name: 'Home package card preselects the package',
      scenario: 'home-empty',
      enter: (page) => page.locator('.home-package.featured').click(),
    },
    {
      name: 'Home package-details sheet preselects the chosen package',
      scenario: 'home-empty',
      enter: async (page) => {
        await page.locator('.section-title .text-btn').click();
        await sheetOpen(page);
        await page.locator('dialog.sheet[open] .stack .bill').nth(2).locator('.btn').click();
      },
    },
    {
      name: 'Home primary CTA keeps the default package',
      scenario: 'home-empty',
      enter: (page) => page.locator('.hero-cta').click(),
    },
  ];
  for (const entry of homeEntries) {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openHomePair(context, server, entry.scenario);
      for (const target of [reference.page, candidate.page]) {
        await entry.enter(target);
        // Both land on the vehicle step first: the approved flow never skips it.
        await target.locator('.signature-car').first().waitFor();
      }
      assert.match(candidate.page.url(), /#\/book\/0$/);
      assert.match(reference.page.url(), /#book[/]0$/);
      for (const target of [reference.page, candidate.page]) {
        await target.locator(NEXT).click();
        await target.locator('.service-option').first().waitFor();
      }
      await candidate.page.locator('.booking-footer').waitFor();
      const seen = await observe(candidate.page);
      const expected = await observe(reference.page);
      assert.deepEqual(seen.packages, expected.packages, `${entry.name}: packages`);
      assert.equal(seen.footerPrice, expected.footerPrice, `${entry.name}: total`);
      assert.equal(seen.footerDuration, expected.footerDuration, `${entry.name}: duration`);
      assert.deepEqual(candidate.problems, [], `${entry.name}: candidate page problems`);
      summary.interactions.push({
        name: entry.name,
        selected: seen.packages.find((item) => item.checked)?.id,
      });
    } finally {
      await context.close();
    }
  }

  // 5. Resume returns to the care step with the draft intact; nothing leaves the page.
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openPair(context, server, 'garage-vehicle-chosen', 'care');
      const { page, problems, requests } = candidate;
      const requestsBefore = requests.length;
      await selectPackage(page, 'premium');
      await page.locator(TOTAL).click();
      await sheetOpen(page);
      await page.keyboard.press('Escape');
      await sheetClosed(page);

      // Leave: Home offers to continue, with the package and the total.
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      const savedDraft = page.locator('[data-home-entry="saved-draft"]');
      await savedDraft.waitFor();
      assert.equal(
        (await savedDraft.locator('p').innerText()).replace(/\s+/g, ' ').trim(),
        'عناية استثنائية · 1,700 ل.س',
      );
      assert.equal(await page.locator('.nav-dot').count(), 0, 'no order was created');
      assert.equal(await page.locator('[data-home-entry="active-order"]').count(), 0);
      await savedDraft.locator('.text-btn').click();
      await page.locator('.service-option').first().waitFor();
      assert.match(page.url(), /#\/book\/1$/, 'resume returns to the care step');
      const resumed = await observe(page);
      assert.equal(resumed.packages.find((item) => item.checked).id, 'premium');
      assert.equal(resumed.context.startsWith('سيارة العائلة'), true, 'saved car is kept');

      // Browser Back/Forward keep the step and the selection.
      await page.locator(NEXT).click();
      await page.locator('[data-booking-step="location"]').waitFor();
      await page.goBack();
      await page.locator('.service-option').first().waitFor();
      assert.equal((await observe(page)).packages.find((item) => item.checked).id, 'premium');
      await page.goBack();
      await page.locator('[data-home-entry="saved-draft"]').waitFor();
      await page.goForward();
      await page.locator('.service-option').first().waitFor();

      // The garage is untouched by choosing a package.
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      await page.locator('[data-home-entry="saved-draft"]').waitFor();
      await page.getByRole('link', { name: 'سياراتي' }).click();
      await page.locator('.garage-card').first().waitFor();
      assert.equal(await page.locator('.garage-card').count(), 3);

      assert.equal(requests.length, requestsBefore, 'the care step must not send any request');
      assert.deepEqual(
        await page.evaluate(() => ({
          local: globalThis.localStorage.length,
          session: globalThis.sessionStorage.length,
          cookies: globalThis.document.cookie,
        })),
        { local: 0, session: 0, cookies: '' },
        'the care step must not write browser storage',
      );
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'resume, history, no request, no storage, no order' });
    } finally {
      await context.close();
    }
  }

  // 6. Keyboard, semantics and sheets.
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openPair(context, server, 'booking-care-with-extras', 'care');
      const { page, problems } = candidate;
      const focusName = () =>
        page.evaluate(() => {
          const element = globalThis.document.activeElement;
          if (!element || element === globalThis.document.body) return 'browser';
          return (
            element.getAttribute('aria-label') ||
            element.getAttribute('name') ||
            element.innerText.replace(/\s+/g, ' ').trim()
          );
        });
      const stops = [];
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Tab');
        stops.push(await focusName());
        const ringed = await page.evaluate(() => {
          const element = globalThis.document.activeElement;
          const ring = element.matches('input[type="radio"]')
            ? element.closest('.service-option')
            : element;
          const style = globalThis.getComputedStyle(ring);
          return (
            element.matches(':focus-visible') &&
            style.outlineStyle === 'solid' &&
            parseFloat(style.outlineWidth) >= 2
          );
        });
        assert.equal(ringed, true, `${stops.at(-1)}: no visible focus ring`);
      }
      assert.deepEqual(stops, [
        'انتقل إلى المحتوى',
        'الخطوة السابقة',
        'حفظ المسودة والخروج',
        'تغيير',
        'service',
        'لمسة إضافية؟ تلميع الإطارات، تعطير المقصورة +250 ل.س',
        'تفاصيل السعر الحالي 1500 ليرة سورية',
        'تحديد المكان',
      ]);
      await page.keyboard.press('Tab');
      assert.equal(await focusName(), 'browser', 'focus can leave the page: no trap');

      const semantics = await page.evaluate(() => {
        const doc = globalThis.document;
        const group = doc.querySelector('.main [role="radiogroup"]');
        return {
          groupLabel: group.getAttribute('aria-label'),
          radios: [...group.querySelectorAll('input[type="radio"]')].map((radio) => [
            radio.value,
            radio.checked,
            Boolean(radio.labels?.length),
          ]),
          stepper: doc.querySelector('.stepper').getAttribute('aria-label'),
          currentStep: doc.querySelector('[aria-current="step"]').textContent.trim(),
          doneSteps: doc.querySelectorAll('.step-segment.done').length,
          headings: doc.querySelectorAll('.main h1').length,
          clickOnly: doc.querySelectorAll('.main [role="button"], .main div[onclick]').length,
          extrasDeferred: doc
            .querySelector('.main .disclosure-row')
            .getAttribute('data-deferred-to'),
          totalPopup: doc.querySelector('.booking-total').getAttribute('aria-haspopup'),
          priceLive: doc.querySelector('#footer-price').getAttribute('aria-live'),
        };
      });
      assert.deepEqual(semantics, {
        groupLabel: 'باقة الغسيل',
        radios: [
          ['exterior', false, true],
          ['complete', true, true],
          ['premium', false, true],
        ],
        stepper: 'الخطوة 2 من 7',
        currentStep: 'العناية',
        doneSteps: 1,
        headings: 1,
        clickOnly: 0,
        extrasDeferred: 'C007',
        totalPopup: 'dialog',
        priceLive: 'polite',
      });

      // Price breakdown from the keyboard: modal, contained, Escape, focus returns.
      await page.locator(TOTAL).focus();
      await page.keyboard.press('Enter');
      await sheetOpen(page);
      const dialog = await page.evaluate(() => {
        const sheet = globalThis.document.querySelector('dialog.sheet[open]');
        return {
          modal: sheet.matches(':modal'),
          title: globalThis.document.getElementById(sheet.getAttribute('aria-labelledby'))
            ?.textContent,
          titleIds: globalThis.document.querySelectorAll('#sheet-title').length,
        };
      });
      assert.deepEqual(dialog, { modal: true, title: 'السعر، بكل وضوح.', titleIds: 1 });
      const inSheet = new Set();
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press('Tab');
        const where = await page.evaluate(() => {
          const element = globalThis.document.activeElement;
          if (!element || element === globalThis.document.body) return 'browser';
          return element.closest('dialog.sheet[open]')
            ? `sheet:${element.getAttribute('aria-label') || element.innerText.trim()}`
            : `outside:${element.className}`;
        });
        assert.ok(!where.startsWith('outside:'), `focus escaped the sheet to ${where}`);
        if (where.startsWith('sheet:')) inSheet.add(where);
      }
      assert.deepEqual([...inSheet].sort(), ['sheet:إغلاق النافذة', 'sheet:متابعة الحجز']);
      await page.keyboard.press('Escape');
      await sheetClosed(page);
      assert.equal(await focusName(), 'تفاصيل السعر الحالي 1500 ليرة سورية');
      await page.waitForFunction(() => globalThis.document.body.style.overflow === '');
      assert.match(page.url(), /#\/book\/1/, 'the sheet never leaves the step');

      // Space selects a package from the keyboard; selecting never advances.
      await page.locator(packageRadio('exterior')).focus();
      await page.keyboard.press('Space');
      assert.equal((await observe(page)).packages.find((item) => item.checked).id, 'exterior');
      assert.match(page.url(), /#\/book\/1/, 'selecting a package does not move on');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'keyboard order, semantics, sheet modality and focus' });
    } finally {
      await context.close();
    }
  }

  // 7. Home package-details sheet from the keyboard.
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openHomePair(context, server, 'home-empty');
      const { page, problems } = candidate;
      const opener = page.locator('.section-title .text-btn');
      await opener.focus();
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
        await page.evaluate(() => globalThis.document.activeElement?.innerText.trim()),
        'تفاصيل الباقات',
        'focus returns to the control that opened the sheet',
      );
      assert.match(page.url(), /#\/\?scenario=home-empty$/, 'closing the sheet starts nothing');
      assert.equal(await page.locator('[data-home-entry]').count(), 0, 'no draft was started');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'Home package details: keyboard, Escape, focus' });
    } finally {
      await context.close();
    }
  }

  // 8. Refresh, deep link, unknown scenario and the plate guard.
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
      assert.equal((await observe(page)).packages.find((item) => item.checked).id, 'complete');
      assert.equal(await page.locator('[data-customer-fixture="booking-care-default"]').count(), 1);
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.classList.contains('skip')),
        true,
        'skip link is the first stop after a fresh load',
      );
      await page.goto(`${origin}/#/book/1?scenario=__proto__`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.service-option').first().waitFor();
      assert.equal((await observe(page)).packages.find((item) => item.checked).id, 'exterior');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'refresh, deep link and scenario fallback' });
    } finally {
      await context.close();
    }
  }

  // 9. Motion: selection feedback runs with motion allowed and not under reduced motion.
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
      await selectPackage(page, 'complete');
      const running = await page.evaluate(
        () =>
          globalThis.document
            .getAnimations()
            .filter((animation) => animation.constructor.name === 'Animation').length,
      );
      assert.equal(running > 0, reducedMotion !== 'reduce', `feedback with ${reducedMotion}`);
      assert.equal((await observe(page)).packages.find((item) => item.checked).id, 'complete');
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
  summary.interactions.push({ name: 'selection motion and reduced motion' });

  writeFileSync(resolve(evidence, 'c006-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `C006 browser acceptance passed: ${summary.visual.length} visual comparisons, ` +
      `${summary.interactions.length} interaction checks. Evidence: ${evidence}`,
  );
} catch (error) {
  writeFileSync(resolve(evidence, 'c006-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`C006 evidence directory: ${evidence}`);
  throw error;
} finally {
  await server.close();
  await browser.close();
}
