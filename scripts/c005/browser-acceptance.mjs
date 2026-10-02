// C005 browser acceptance: renders the React garage, the shared vehicle editor and
// the saved-car choices of the booking vehicle step next to the approved customer
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
} from '../c004/parity-harness.mjs';

const origin = process.env.C005_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C005_EVIDENCE_DIR
  ? resolve(process.env.C005_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c005-'));
mkdirSync(evidence, { recursive: true });

const SCREENS = {
  garage: { reference: '#garage', candidate: '/garage', storage: 'garage', ready: '.save-note' },
  vehicle: {
    reference: '#book/0',
    candidate: '/book/0',
    storage: 'booking',
    ready: '.signature-car',
  },
  home: { reference: '#home', candidate: '/', storage: 'home', ready: '.hero-cta' },
};

// Garage, editor sheet, saved-car chips and the shell regions they show through.
const PARITY_SELECTORS = [
  'body',
  '.app',
  '.app-header',
  '.main',
  '.page-heading',
  '.page-heading .eyebrow',
  '.page-heading h1',
  '.page-heading p',
  '.empty',
  '.empty-icon',
  '.empty-icon .icon',
  '.empty h2',
  '.empty p',
  '.garage-card',
  '.garage-card .row',
  '.garage-card .car-art',
  '.garage-card h3',
  '.garage-card p',
  '.garage-card .plate-mini',
  '.garage-actions',
  '.garage-actions .btn',
  '.garage-actions .icon-btn',
  '.garage-actions .icon-btn .icon',
  '.main > * > .btn.full, .main > .btn.full',
  '.save-note',
  '.save-note .icon',
  '.saved-car-chips',
  '.saved-car-chips .chip',
  '.saved-car-chips .chip .icon',
  '.vehicle-stage',
  '.stage-caption strong',
  '.stage-caption .plate-mini',
  '.signature-car',
  '.signature-car .radio-circle',
  '.plate-input',
  '.car-more',
  '.car-more p',
  '.booking-footer',
  '.bottom-nav',
  '.nav-btn',
  '.nav-btn .nav-icon',
  'dialog.sheet[open]',
  'dialog.sheet[open] .sheet-inner',
  'dialog.sheet[open] .sheet-handle',
  'dialog.sheet[open] .sheet-head',
  'dialog.sheet[open] .sheet-head h2',
  'dialog.sheet[open] .sheet-head .icon-btn',
  'dialog.sheet[open] .sheet-intro',
  'dialog.sheet[open] .chips',
  'dialog.sheet[open] .chip',
  'dialog.sheet[open] .car-grid',
  'dialog.sheet[open] .car-option',
  'dialog.sheet[open] .car-option .choice',
  'dialog.sheet[open] .car-option .car-art',
  'dialog.sheet[open] .car-option strong',
  'dialog.sheet[open] .car-option small',
  'dialog.sheet[open] .plate-preview',
  'dialog.sheet[open] .plate-preview .car-art',
  'dialog.sheet[open] .plate-display',
  'dialog.sheet[open] .plate-display span',
  'dialog.sheet[open] .plate-display small',
  'dialog.sheet[open] .field',
  'dialog.sheet[open] .field-label',
  'dialog.sheet[open] .field-label small',
  'dialog.sheet[open] .input',
  'dialog.sheet[open] .input-note',
  'dialog.sheet[open] .two-fields',
  'dialog.sheet[open] .checkbox-row',
  'dialog.sheet[open] .checkbox-row input',
  'dialog.sheet[open] .error',
  'dialog.sheet[open] .btn',
  'dialog.sheet[open] .btn .icon',
];

const ADD = { role: 'button', name: 'إضافة سيارة' };
const SUBMIT = '#vehicle-form button[type="submit"]';
const sizeCard = (type) => `.car-option:has(input[name="carType"][value="${type}"])`;
const card = (index) => `.garage-card >> nth=${index}`;
const cardButton = (page, index, label) =>
  page.locator(card(index)).getByRole('button', { name: new RegExp(`^${label}`) });
const stepChip = (page, name) =>
  page.locator('.saved-car-chips .chip').filter({ hasText: name }).first();
const sheetChip = (page, name) =>
  page.locator('dialog.sheet[open] .chip').filter({ hasText: name }).first();
const sheetOpen = (page) => page.locator('dialog.sheet[open]').waitFor();
const sheetClosed = (page) => page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });

async function addVehicle(page, { type, plate, name, color }) {
  await page.getByRole(ADD.role, { name: ADD.name }).click();
  await sheetOpen(page);
  if (type) await page.locator(sizeCard(type)).click();
  if (plate !== undefined) await page.locator('#car-plate').fill(plate);
  if (name !== undefined) await page.locator('input[name="carName"]').fill(name);
  if (color !== undefined) await page.locator('input[name="color"]').fill(color);
  await page.locator(SUBMIT).click();
}

/** Session for a scenario in the shape the approved prototype persists. */
function referenceStorage(scenario, screen) {
  const state = initialSessionState(`#/?scenario=${scenario}`);
  const storage = referenceStorageFor(state, { screen, step: 0 });
  storage.cars = state.vehicles.map((vehicle) => ({ ...vehicle }));
  storage.draft.carId = state.draft.carId;
  return storage;
}

async function openPair(context, server, scenario, screenId) {
  const screen = SCREENS[screenId];
  const reference = await openReference(
    context,
    server,
    referenceStorage(scenario, screen.storage),
    screen.reference,
  );
  await reference.page.locator(screen.ready).first().waitFor();
  const candidate = await openCandidate(
    context,
    origin,
    `${screen.candidate}?scenario=${scenario}`,
    screen.ready,
  );
  if (screenId === 'vehicle') await candidate.page.locator('.booking-footer').waitFor();
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
    const sheet = doc.querySelector('dialog.sheet[open]');
    const form = sheet?.querySelector('#vehicle-form');
    // The last notice raised, whether or not it is still on screen: a toast hides
    // itself after four seconds, and the two pages are driven one after the other,
    // so "currently visible" would compare timing rather than behaviour. That a
    // notice is actually shown is asserted separately on the candidate.
    const toast = doc.querySelector('.toast');
    const stagePlate = doc.querySelector('#stage-plate');
    // The route only: the candidate's `?scenario=` query must not be read as a screen.
    const route = globalThis.location.hash.split('?')[0];
    return {
      screen: /garage/.test(route) ? 'garage' : (/book[/]\d+/.exec(route)?.[0] ?? 'other'),
      cards: [...doc.querySelectorAll('.garage-card')].map((node) => ({
        name: text('h3', node),
        lines: [...node.querySelectorAll('p')].map((p) => clean(p.textContent)),
        plate: text('.plate-mini', node),
        markupChildren: node.querySelector('h3').children.length,
        actions: [...node.querySelectorAll('button')].map(
          (button) => button.getAttribute('aria-label') ?? clean(button.textContent),
        ),
      })),
      empty: text('.empty h2'),
      addButton: [...doc.querySelectorAll('.main .btn.full')].map((button) => [
        clean(button.textContent),
        button.classList.contains('outline'),
      ]),
      toast: (toast && clean(toast.textContent)) || null,
      sheet: sheet
        ? {
            title: text('.sheet-head h2', sheet),
            intro: text('.sheet-intro', sheet),
            chips: [...sheet.querySelectorAll('.chip')].map((chip) => clean(chip.textContent)),
            buttons: [...sheet.querySelectorAll('.btn')].map((button) => clean(button.textContent)),
            form: form
              ? {
                  type: form.querySelector('input[name="carType"]:checked')?.value ?? null,
                  selectedCards: [...form.querySelectorAll('.car-option.selected input')].map(
                    (input) => input.value,
                  ),
                  preview: text('#plate-live', form),
                  plate: form.querySelector('#car-plate').value,
                  plateInvalid: form.querySelector('#car-plate').getAttribute('aria-invalid'),
                  name: form.querySelector('input[name="carName"]').value,
                  color: form.querySelector('input[name="color"]').value,
                  save: form.querySelector('input[name="saveVehicle"]')?.checked ?? null,
                  note: [...form.querySelectorAll('p.input-note')].map((p) => clean(p.textContent)),
                  error: text('#vehicle-error', form),
                }
              : null,
          }
        : null,
      step: doc.querySelector('.signature-car')
        ? {
            chips: [...doc.querySelectorAll('.saved-car-chips .chip')].map((chip) => [
              clean(chip.textContent),
              chip.classList.contains('selected'),
            ]),
            type: doc.querySelector('input[name="vehicleType"]:checked')?.value ?? null,
            stageName: text('#stage-name'),
            stagePlate: stagePlate && !stagePlate.hidden ? stagePlate.textContent : null,
            plate: doc.querySelector('#plate')?.value ?? null,
            details: text('.car-more p'),
            save: doc.querySelector('input[name="saveVehicleInline"]')?.checked ?? null,
            footerPrice: text('#footer-price'),
          }
        : null,
    };
  });
}

/** Screens compared visually. `prepare` runs the same steps on both pages. */
const visualStates = [
  { id: 'garage-empty', scenario: 'home-empty', screen: 'garage' },
  { id: 'garage-one-vehicle', scenario: 'garage-one-vehicle', screen: 'garage' },
  { id: 'garage-three-vehicles', scenario: 'garage-three-vehicles', screen: 'garage' },
  { id: 'vehicle-step-saved-cars', scenario: 'garage-three-vehicles', screen: 'vehicle' },
  { id: 'vehicle-step-saved-car-chosen', scenario: 'garage-vehicle-chosen', screen: 'vehicle' },
  {
    id: 'garage-editor-add',
    scenario: 'garage-one-vehicle',
    screen: 'garage',
    prepare: async (page) => {
      await page.getByRole(ADD.role, { name: ADD.name }).click();
      await sheetOpen(page);
    },
  },
  {
    id: 'garage-editor-edit',
    scenario: 'garage-three-vehicles',
    screen: 'garage',
    prepare: async (page) => {
      await cardButton(page, 0, 'تعديل').click();
      await sheetOpen(page);
    },
  },
  {
    id: 'garage-editor-invalid-plate',
    scenario: 'home-empty',
    screen: 'garage',
    prepare: async (page) => {
      await page.getByRole(ADD.role, { name: ADD.name }).click();
      await sheetOpen(page);
      await page.locator('#car-plate').fill('بدون رقم');
      await page.locator(SUBMIT).click();
      await page.locator('#vehicle-error:not(:empty)').waitFor();
    },
  },
  {
    id: 'garage-delete-prompt',
    scenario: 'garage-three-vehicles',
    screen: 'garage',
    prepare: async (page) => {
      await cardButton(page, 2, 'حذف').click();
      await sheetOpen(page);
    },
  },
  {
    id: 'vehicle-step-editor',
    scenario: 'garage-vehicle-chosen',
    screen: 'vehicle',
    prepare: async (page) => {
      await page.locator('.car-more').click();
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
        const { reference, candidate } = await openPair(
          context,
          server,
          visual.scenario,
          visual.screen,
        );
        if (visual.prepare) {
          await visual.prepare(reference.page);
          await visual.prepare(candidate.page);
          // Let the sheet's entrance finish on both before measuring.
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
      name: 'add a car to an empty garage',
      scenario: 'home-empty',
      screen: 'garage',
      steps: [
        (page) =>
          addVehicle(page, {
            type: 'suv',
            plate: '4821 ب ج',
            name: 'سيارة العائلة',
            color: 'أبيض',
          }),
        (page) => sheetClosed(page),
      ],
    },
    {
      name: 'a car without a name takes its size name; digits and spaces are normalised',
      scenario: 'home-empty',
      screen: 'garage',
      steps: [
        (page) => addVehicle(page, { type: 'pickup', plate: '  ١٢٣٤    أ  ب  ' }),
        (page) => sheetClosed(page),
        (page) => addVehicle(page, { type: 'large', plate: '۵۶۷۸' }),
        (page) => sheetClosed(page),
        (page) => addVehicle(page, {}),
        (page) => sheetClosed(page),
      ],
    },
    {
      name: 'the editor previews the size and the plate while typing',
      scenario: 'home-empty',
      screen: 'garage',
      steps: [
        async (page) => {
          await page.getByRole(ADD.role, { name: ADD.name }).click();
          await sheetOpen(page);
        },
        (page) => page.locator(sizeCard('pickup')).click(),
        (page) => page.locator('#car-plate').fill('٩٨٧٦ د'),
        (page) => page.locator('#car-plate').fill(''),
        (page) => page.locator(sizeCard('large')).click(),
        (page) => page.locator('input[name="carName"]').fill('  لاند كروزر  '),
        (page) => page.locator('input[name="color"]').fill('أسود'),
        async (page) => {
          await page.locator(SUBMIT).click();
          await sheetClosed(page);
        },
      ],
    },
    {
      name: 'an unacceptable plate is refused in the editor and can be corrected',
      scenario: 'garage-one-vehicle',
      screen: 'garage',
      steps: [
        async (page) => {
          await page.getByRole(ADD.role, { name: ADD.name }).click();
          await sheetOpen(page);
          await page.locator('#car-plate').fill('أ ب ج');
          await page.locator(SUBMIT).click();
          await page.locator('#vehicle-error:not(:empty)').waitFor();
        },
        async (page) => {
          await page.locator('#car-plate').fill('12#4');
          await page.locator(SUBMIT).click();
        },
        async (page) => {
          await page.locator('#car-plate').fill('12 أ');
          await page.locator(SUBMIT).click();
          await sheetClosed(page);
        },
      ],
    },
    {
      name: 'saving the same car again updates it instead of duplicating it',
      scenario: 'garage-one-vehicle',
      screen: 'garage',
      steps: [
        (page) => addVehicle(page, { type: 'suv', plate: '4821 ب ج', name: 'اسم جديد', color: '' }),
        (page) => sheetClosed(page),
      ],
    },
    {
      name: 'edit a saved car',
      scenario: 'garage-three-vehicles',
      screen: 'garage',
      steps: [
        async (page) => {
          await cardButton(page, 1, 'تعديل').click();
          await sheetOpen(page);
        },
        async (page) => {
          await page.locator(sizeCard('large')).click();
          await page.locator('#car-plate').fill('٣٣٣ ك');
          await page.locator('input[name="carName"]').fill('شاحنة العمل');
          await page.locator('input[name="color"]').fill('أزرق');
        },
        async (page) => {
          await page.locator(SUBMIT).click();
          await sheetClosed(page);
        },
      ],
    },
    {
      name: 'closing the editor without saving changes nothing',
      scenario: 'garage-three-vehicles',
      screen: 'garage',
      steps: [
        async (page) => {
          await cardButton(page, 0, 'تعديل').click();
          await sheetOpen(page);
          await page.locator('input[name="carName"]').fill('لن يُحفظ');
        },
        async (page) => {
          await page.getByRole('button', { name: 'إغلاق النافذة' }).click();
          await sheetClosed(page);
        },
      ],
    },
    {
      name: 'delete asks first; "back" keeps the car, confirming removes it',
      scenario: 'garage-three-vehicles',
      screen: 'garage',
      steps: [
        async (page) => {
          await cardButton(page, 0, 'حذف').click();
          await sheetOpen(page);
        },
        async (page) => {
          await page.getByRole('button', { name: 'رجوع' }).click();
          await sheetClosed(page);
        },
        async (page) => {
          await cardButton(page, 0, 'حذف').click();
          await sheetOpen(page);
          await page.getByRole('button', { name: 'حذف السيارة' }).click();
          await sheetClosed(page);
        },
      ],
    },
    {
      name: 'deleting the last car returns to the empty garage',
      scenario: 'garage-one-vehicle',
      screen: 'garage',
      steps: [
        async (page) => {
          await cardButton(page, 0, 'حذف').click();
          await sheetOpen(page);
          await page.getByRole('button', { name: 'حذف السيارة' }).click();
          await sheetClosed(page);
        },
      ],
    },
    {
      name: '"book for this car" starts the journey with that car in the draft',
      scenario: 'garage-three-vehicles',
      screen: 'garage',
      steps: [
        async (page) => {
          await cardButton(page, 2, 'احجز لهذه السيارة').click();
          await page.locator('.signature-car').first().waitFor();
        },
      ],
    },
    {
      name: 'a saved-car chip fills the draft; picking a size by hand releases it',
      scenario: 'garage-three-vehicles',
      screen: 'vehicle',
      steps: [
        (page) => stepChip(page, 'سيارة العائلة').click(),
        (page) => stepChip(page, 'بيك أب').click(),
        async (page) => {
          await page.locator('.signature-car:has(input[value="large"])').click();
          await page.locator('.signature-car.selected:has(input[value="large"])').waitFor();
        },
        (page) => page.locator('#plate').fill('۴۴۴ م'),
      ],
    },
    {
      name: 'the "other" chip opens a blank editor whose result goes to the draft only',
      scenario: 'garage-vehicle-chosen',
      screen: 'vehicle',
      steps: [
        async (page) => {
          await stepChip(page, 'أخرى').click();
          await sheetOpen(page);
        },
        async (page) => {
          await page.locator(sizeCard('pickup')).click();
          await page.locator('#car-plate').fill('٢٢٢ ط');
          await page.locator('input[name="carName"]').fill('ضيف');
          await page.locator('input[name="saveVehicle"]').click();
        },
        async (page) => {
          await page.locator(SUBMIT).click();
          await sheetClosed(page);
        },
      ],
    },
    {
      name: 'the details row edits the draft car; a refused plate keeps the sheet open',
      scenario: 'garage-vehicle-chosen',
      screen: 'vehicle',
      steps: [
        async (page) => {
          await page.locator('.car-more').click();
          await sheetOpen(page);
        },
        async (page) => {
          await page.locator('#car-plate').fill('بلا أرقام');
          await page.locator(SUBMIT).click();
          await page.locator('#vehicle-error:not(:empty)').waitFor();
        },
        async (page) => {
          await page.locator('#car-plate').fill('4821 ب ج');
          await page.locator('input[name="color"]').fill('فضي');
          await page.locator(SUBMIT).click();
          await sheetClosed(page);
        },
      ],
    },
    {
      name: 'saved cars and "new car" inside the booking editor',
      scenario: 'garage-three-vehicles',
      screen: 'vehicle',
      steps: [
        async (page) => {
          await page.locator('.car-more').click();
          await sheetOpen(page);
        },
        async (page) => {
          await sheetChip(page, 'سيارة العائلة').click();
          await sheetClosed(page);
        },
        async (page) => {
          await page.locator('.car-more').click();
          await sheetOpen(page);
        },
        (page) => sheetChip(page, 'سيارة جديدة').click(),
      ],
    },
    {
      name: 'manual selection still works with an empty garage',
      scenario: 'home-empty',
      screen: 'vehicle',
      steps: [
        async (page) => {
          await page.locator('.signature-car:has(input[value="suv"])').click();
          await page.locator('.signature-car.selected:has(input[value="suv"])').waitFor();
        },
        (page) => page.locator('#plate').fill('١٢٣ أ'),
        async (page) => {
          await page.locator('.car-more').click();
          await sheetOpen(page);
        },
        async (page) => {
          await page.locator('input[name="carName"]').fill('كورولا');
          await page.locator('input[name="color"]').fill('أحمر');
          await page.locator(SUBMIT).click();
          await sheetClosed(page);
        },
      ],
    },
    {
      name: 'Home CTA starts the journey with the first saved car',
      scenario: 'garage-three-vehicles',
      screen: 'home',
      steps: [
        async (page) => {
          await page.locator('.hero-cta').click();
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
        interaction.screen,
      );
      if (interaction.screen === 'home') {
        // The Home hero is C003's; only the destination state is compared here.
        await candidate.page.locator('.hero-cta').waitFor();
      }
      for (const [index, step] of interaction.steps.entries()) {
        await step(reference.page);
        await step(candidate.page);
        await reference.page.waitForTimeout(80);
        await candidate.page.waitForTimeout(80);
        if (interaction.screen === 'vehicle' || interaction.name.includes('journey')) {
          await candidate.page.locator('.booking-footer').waitFor();
        }
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

  // 3. Nothing leaves the page and nothing becomes a booking.
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openPair(context, server, 'garage-one-vehicle', 'garage');
      const { page, problems, requests } = candidate;
      const requestsBefore = requests.length;
      await addVehicle(page, { type: 'sedan', plate: '900 س', name: 'الثانية' });
      await sheetClosed(page);
      await cardButton(page, 0, 'تعديل').click();
      await sheetOpen(page);
      await page.locator('input[name="color"]').fill('ذهبي');
      await page.locator(SUBMIT).click();
      await sheetClosed(page);
      await cardButton(page, 1, 'احجز لهذه السيارة').click();
      await page.locator('.booking-footer').waitFor();
      await page.locator('.primary-next').click();
      await page.locator('[data-booking-step="care"]').waitFor();
      // Leave the journey: Home offers the draft, the bookings tab shows no order.
      await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
      await page.getByRole('button', { name: 'حفظ والخروج' }).click();
      await page.locator('[data-home-entry="saved-draft"]').waitFor();
      assert.equal(await page.locator('.nav-dot').count(), 0, 'no order was created');
      assert.equal(await page.locator('[data-home-entry="active-order"]').count(), 0);
      assert.equal(await page.locator('[data-home-entry="repeat-order"]').count(), 0);
      // The garage still holds exactly the two cars; booking did not consume or copy one.
      await page.getByRole('link', { name: 'سياراتي' }).click();
      await page.locator('.garage-card').first().waitFor();
      assert.deepEqual(
        (await observe(page)).cards.map((item) => item.name),
        ['سيارة العائلة', 'الثانية'],
      );
      assert.equal(requests.length, requestsBefore, 'the garage must not send any request');
      assert.deepEqual(
        await page.evaluate(() => ({
          local: globalThis.localStorage.length,
          session: globalThis.sessionStorage.length,
          cookies: globalThis.document.cookie,
        })),
        { local: 0, session: 0, cookies: '' },
        'the garage must not write browser storage',
      );
      // Nothing was persisted: the URL no longer names a scenario after in-app
      // navigation, so a reload starts from the default session — an empty garage.
      assert.doesNotMatch(page.url(), /scenario=/);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.empty').waitFor();
      assert.equal((await observe(page)).cards.length, 0);
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'no request, no storage, no order, not persisted' });
    } finally {
      await context.close();
    }
  }

  // 4. Markup-like and hostile values are shown as text and never executed.
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(
        context,
        server,
        'garage-three-vehicles',
        'garage',
      );
      const { page, problems } = candidate;
      const hostile = '<img src=x onerror=window.__c005_xss=1>';
      for (const target of [reference.page, page]) {
        await addVehicle(target, { type: 'sedan', plate: '55 ه', name: hostile, color: '"><i>x' });
        await sheetClosed(target);
      }
      // The save is confirmed to the customer with a visible, polite status notice.
      await page.locator('.toast.show').waitFor();
      assert.equal(await page.locator('.toast.show').getAttribute('role'), 'status');
      assert.equal(await page.locator('.toast.show').getAttribute('aria-live'), 'polite');
      const seen = await observe(page);
      assert.deepEqual(seen, await observe(reference.page), 'hostile values render alike');
      assert.equal(seen.cards[2].name, '<b>كامري</b> & "تجربة"');
      assert.equal(seen.cards[3].name, hostile);
      assert.ok(
        seen.cards.every((item) => item.markupChildren === 0),
        'names are text nodes',
      );
      assert.equal(
        await page.locator('.garage-card img, .garage-card i, .garage-card b').count(),
        0,
      );
      assert.equal(await page.evaluate(() => globalThis.__c005_xss), undefined);
      // The same name flows into the delete prompt, the chips and the stage as text.
      await cardButton(page, 3, 'حذف').click();
      await sheetOpen(page);
      assert.equal(await page.locator('dialog.sheet[open] img').count(), 0);
      assert.ok((await observe(page)).sheet.intro.includes(hostile));
      await page.keyboard.press('Escape');
      await sheetClosed(page);
      await cardButton(page, 3, 'احجز لهذه السيارة').click();
      await page.locator('.booking-footer').waitFor();
      assert.equal((await observe(page)).step.stageName, hostile);
      assert.equal(await page.locator('.main img').count(), 0);
      assert.equal(await page.evaluate(() => globalThis.__c005_xss), undefined);
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'markup-like values render as text' });
    } finally {
      await context.close();
    }
  }

  // 5. Keyboard, modality and focus restoration.
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openPair(context, server, 'garage-one-vehicle', 'garage');
      const { page, problems } = candidate;
      const focusName = () =>
        page.evaluate(() => {
          const element = globalThis.document.activeElement;
          if (!element || element === globalThis.document.body) return 'browser';
          return (
            element.getAttribute('aria-label') ||
            element.getAttribute('name') ||
            element.id ||
            element.innerText.replace(/\s+/g, ' ').trim()
          );
        });
      const stops = [];
      for (let i = 0; i < 11; i += 1) {
        await page.keyboard.press('Tab');
        stops.push(await focusName());
        assert.equal(
          await page.evaluate(() => globalThis.document.activeElement.matches(':focus-visible')),
          true,
          `${stops.at(-1)}: focus not visible`,
        );
      }
      assert.deepEqual(stops, [
        'انتقل إلى المحتوى',
        'WashGo الرئيسية',
        'دمشق',
        'حسابي',
        'احجز لهذه السيارة',
        'تعديل سيارة العائلة',
        'حذف سيارة العائلة',
        'إضافة سيارة',
        'الرئيسية',
        'حجوزاتي',
        'سياراتي',
      ]);
      assert.equal(
        await page.locator('.nav-btn[aria-current="page"]').innerText(),
        'سياراتي',
        'bottom navigation marks the garage',
      );

      // Open the editor from the keyboard; it is a modal dialog with a labelled form.
      await page.getByRole(ADD.role, { name: ADD.name }).focus();
      await page.keyboard.press('Enter');
      await sheetOpen(page);
      const dialog = await page.evaluate(() => {
        const sheet = globalThis.document.querySelector('dialog.sheet[open]');
        const labelled = (selector) => Boolean(sheet.querySelector(selector)?.labels?.length);
        return {
          modal: sheet.matches(':modal'),
          title: globalThis.document.getElementById(sheet.getAttribute('aria-labelledby'))
            ?.textContent,
          titleIds: globalThis.document.querySelectorAll('#sheet-title').length,
          group: sheet.querySelector('[role="radiogroup"]')?.getAttribute('aria-label'),
          radios: [...sheet.querySelectorAll('input[name="carType"]')].map((radio) => [
            radio.value,
            radio.checked,
            radio.labels[0].innerText.replace(/\s+/g, ' ').trim(),
          ]),
          labelled: ['#car-plate', 'input[name="carName"]', 'input[name="color"]'].map(labelled),
          clickOnly: sheet.querySelectorAll('[role="button"], div[onclick]').length,
        };
      });
      assert.deepEqual(dialog, {
        modal: true,
        title: 'أي سيارة نعتني بها؟',
        titleIds: 1,
        group: 'حجم السيارة',
        radios: [
          ['sedan', true, 'سيدان السعر الأساسي'],
          ['suv', false, 'كروس أوفر +200 ل.س'],
          ['large', false, 'دفع رباعي +350 ل.س'],
          ['pickup', false, 'بيك أب +250 ل.س'],
        ],
        labelled: [true, true, true],
        clickOnly: 0,
      });

      // Tab never reaches the page behind the sheet; every control is reachable.
      const inSheet = new Set();
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Tab');
        const where = await page.evaluate(() => {
          const element = globalThis.document.activeElement;
          if (!element || element === globalThis.document.body) return 'browser';
          return element.closest('dialog.sheet[open]')
            ? `sheet:${element.getAttribute('aria-label') || element.getAttribute('name') || element.type}`
            : `outside:${element.className}`;
        });
        assert.ok(!where.startsWith('outside:'), `focus escaped the editor to ${where}`);
        if (where.startsWith('sheet:')) inSheet.add(where);
      }
      assert.deepEqual([...inSheet].sort(), [
        'sheet:carName',
        'sheet:carType',
        'sheet:color',
        'sheet:plate',
        'sheet:submit',
        'sheet:إغلاق النافذة',
      ]);

      // Arrow keys change the size; Enter in a field submits; a refused plate is announced.
      await page.locator('input[name="carType"][value="sedan"]').focus();
      await page.keyboard.press('ArrowDown');
      assert.equal((await observe(page)).sheet.form.type, 'suv');
      await page.locator('#car-plate').fill('بلا');
      await page.locator('#car-plate').press('Enter');
      await page.locator('#vehicle-error:not(:empty)').waitFor();
      const refused = await page.evaluate(() => {
        const input = globalThis.document.querySelector('#car-plate');
        const error = globalThis.document.querySelector('#vehicle-error');
        return {
          focused: globalThis.document.activeElement === input,
          invalid: input.getAttribute('aria-invalid'),
          describedBy: input.getAttribute('aria-describedby'),
          role: error.getAttribute('role'),
        };
      });
      assert.deepEqual(refused, {
        focused: true,
        invalid: 'true',
        describedBy: 'plate-help vehicle-error',
        role: 'alert',
      });

      // Escape closes without saving and returns focus to the control that opened it.
      await page.keyboard.press('Escape');
      await sheetClosed(page);
      assert.equal(await focusName(), 'إضافة سيارة');
      assert.equal((await observe(page)).cards.length, 1, 'nothing was saved');
      // Scrolling is unlocked by the dialog's `close` event, which is dispatched as
      // a task after the dialog has closed, so wait for it instead of sampling once.
      await page.waitForFunction(() => globalThis.document.body.style.overflow === '');

      // Edit and delete return focus to their own buttons.
      await cardButton(page, 0, 'تعديل').focus();
      await page.keyboard.press('Enter');
      await sheetOpen(page);
      await page.keyboard.press('Escape');
      await sheetClosed(page);
      assert.equal(await focusName(), 'تعديل سيارة العائلة');
      await cardButton(page, 0, 'حذف').focus();
      await page.keyboard.press('Enter');
      await sheetOpen(page);
      await page.keyboard.press('Escape');
      await sheetClosed(page);
      assert.equal(await focusName(), 'حذف سيارة العائلة');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'keyboard, modal semantics and focus restoration' });
    } finally {
      await context.close();
    }
  }

  // 6. Saved-car chips: programmatic state and keyboard use on the vehicle step.
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openPair(context, server, 'garage-three-vehicles', 'vehicle');
      const { page, problems } = candidate;
      const chipState = () =>
        page.evaluate(() => {
          const group = globalThis.document.querySelector('.saved-car-chips');
          return {
            role: group.getAttribute('role'),
            label: group.getAttribute('aria-label'),
            chips: [...group.querySelectorAll('button')].map((chip) => [
              chip.textContent.trim(),
              chip.getAttribute('aria-pressed'),
            ]),
          };
        });
      assert.deepEqual(await chipState(), {
        role: 'group',
        label: 'سيارات محفوظة',
        chips: [
          ['سيارة العائلة', 'false'],
          ['بيك أب', 'false'],
          ['<b>كامري</b> & "تجربة"', 'false'],
          ['أخرى', null],
        ],
      });
      await stepChip(page, 'بيك أب').focus();
      await page.keyboard.press('Space');
      assert.deepEqual(
        (await chipState()).chips.map((chip) => chip[1]),
        ['false', 'true', 'false', null],
      );
      assert.equal((await observe(page)).step.type, 'pickup');
      assert.equal(/#\/book\/0/.test(page.url()), true, 'choosing a car does not leave the step');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'saved-car chips: pressed state and keyboard' });
    } finally {
      await context.close();
    }
  }

  // 7. Refresh, deep link and unknown scenario.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/garage?scenario=garage-three-vehicles',
        '.save-note',
      );
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.garage-card').first().waitFor();
      assert.equal((await observe(page)).cards.length, 3);
      assert.equal(await page.locator('[data-customer-fixture="garage-default"]').count(), 1);
      await page.goto(`${origin}/#/garage?scenario=__proto__`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.empty').waitFor();
      assert.equal((await observe(page)).empty, 'مكان خاص لسيارتك.');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'refresh, deep link and scenario fallback' });
    } finally {
      await context.close();
    }
  }

  writeFileSync(resolve(evidence, 'c005-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `C005 browser acceptance passed: ${summary.visual.length} visual comparisons, ` +
      `${summary.interactions.length} interaction checks. Evidence: ${evidence}`,
  );
} catch (error) {
  writeFileSync(resolve(evidence, 'c005-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`C005 evidence directory: ${evidence}`);
  throw error;
} finally {
  await server.close();
  await browser.close();
}
