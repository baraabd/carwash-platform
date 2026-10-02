// C009 browser acceptance: renders the React account screen, the saved-addresses
// sheet, the shared address editor and the saved-address chips of the location
// step next to the approved customer HTML in the same browser, compares
// structure, copy, geometry, computed style and pixels, then applies the same
// interactions to both.
//
// Methodology and helpers are those of the C004 acceptance (scripts/c004). The
// reference is served read-only and is never modified.
//
// Ownership declared before any comparison: C009 owns the whole account screen's
// presentation (compared full-page), the saved-addresses sheet and the chips.
// The account rows other than «عناويني» and «سياراتي» are rendered as approved
// but are inert here (deferred), so they are compared visually and never driven.
//
// Device location is never real here: the browser API is replaced by a stub.
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

const origin = process.env.C009_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C009_EVIDENCE_DIR
  ? resolve(process.env.C009_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c009-'));
mkdirSync(evidence, { recursive: true });

const PARITY_SELECTORS = [
  'body',
  '.app',
  '.main',
  '.page-heading',
  '.page-heading .eyebrow',
  '.page-heading h1',
  '.page-heading p',
  '.profile-hero',
  '.profile-avatar',
  '.profile-avatar .icon',
  '.profile-hero h2',
  '.profile-hero p',
  '.profile-hero .icon-btn',
  '.settings-group',
  '.settings-row',
  '.settings-row > .icon',
  '.settings-row strong',
  '.settings-row small',
  '.main .info-note',
  '.main .info-note .icon',
  '.version',
  '.bottom-nav',
  '.nav-btn',
  '.address-chips',
  '.address-chips .chip',
  '.address-chips .chip .icon',
  '.location-picker',
  '.signature-map',
  '.location-picker .disclosure-row',
  '.location-picker strong',
  '.address-preview',
  '.main .error',
  '.mini-title',
  '.place-shortcut',
  '.location-tip',
  '.selection-summary',
  '.booking-footer',
  '.booking-total',
  '.primary-next',
  '.toast',
  'dialog.sheet[open]',
  'dialog.sheet[open] .sheet-inner',
  'dialog.sheet[open] .sheet-handle',
  'dialog.sheet[open] .sheet-head',
  'dialog.sheet[open] .sheet-head h2',
  'dialog.sheet[open] .sheet-head .icon-btn',
  'dialog.sheet[open] .sheet-intro',
  'dialog.sheet[open] .saved-item',
  'dialog.sheet[open] .saved-item .soft-icon',
  'dialog.sheet[open] .saved-item .soft-icon .icon',
  'dialog.sheet[open] .saved-item .grow',
  'dialog.sheet[open] .saved-item strong',
  'dialog.sheet[open] .saved-item p',
  'dialog.sheet[open] .saved-item .icon-btn',
  'dialog.sheet[open] .saved-item .icon-btn .icon',
  'dialog.sheet[open] .location-map',
  'dialog.sheet[open] .map-world',
  'dialog.sheet[open] .map-pin',
  'dialog.sheet[open] .map-controls button',
  'dialog.sheet[open] .map-location-button',
  'dialog.sheet[open] .map-caption',
  'dialog.sheet[open] .map-help',
  'dialog.sheet[open] .map-help span',
  'dialog.sheet[open] form',
  'dialog.sheet[open] .field',
  'dialog.sheet[open] .field-label',
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
const SAVE_PREFERENCE = 'input[name="saveAddress"]';
const LOCATE = '.map-location-button';
const ADDRESSES_ROW = '.settings-row:has-text("عناويني")';
const LIST_TITLE = 'عناويني المحفوظة';

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

const sheetTitle = (page, title) =>
  page.locator('dialog.sheet[open] .sheet-head h2', { hasText: title }).waitFor();
const sheetOpen = (page) => page.locator('dialog.sheet[open]').waitFor();
const sheetClosed = (page) => page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });
const button = (page, name) => page.getByRole('button', { name, exact: true });
const fill = (selector, value) => (page) => page.locator(selector).fill(value);

const openBook = async (page) => {
  await page.locator(ADDRESSES_ROW).click();
  await sheetTitle(page, LIST_TITLE);
};
const openAdd = async (page) => {
  await button(page, 'إضافة عنوان').click();
  await page.locator(MAP).waitFor();
};
const openEdit = (label) => async (page) => {
  await button(page, `تعديل ${label}`).click();
  await page.locator(MAP).waitFor();
};
const askDelete = (label) => async (page) => {
  await button(page, `حذف ${label}`).click();
  await sheetTitle(page, 'حذف هذا العنوان؟');
};
const backToList = async (page) => {
  await button(page, 'رجوع').click();
  await sheetTitle(page, LIST_TITLE);
};
const confirmDelete = async (page) => {
  await button(page, 'حذف العنوان').click();
  await sheetTitle(page, LIST_TITLE);
};
const submitEditor = (page) => page.locator('#address-form button[type="submit"]').click();
const saveEditor = async (page) => {
  await submitEditor(page);
  await sheetTitle(page, LIST_TITLE);
};
const escape = async (page) => {
  await page.keyboard.press('Escape');
  await sheetClosed(page);
};
const openBookingEditor = async (page) => {
  await page.locator(CARD).click();
  await sheetOpen(page);
  await page.locator(MAP).waitFor();
};
const applyBookingEditor = async (page) => {
  await submitEditor(page);
  await sheetClosed(page);
};
const stepChip = (label) => (page) =>
  page.locator('.address-chips .chip', { hasText: label }).click();
const sheetChip = (label) => (page) =>
  page.locator('dialog.sheet[open] .chip', { hasText: label }).first().click();
async function mapPoint(page, fx, fy) {
  const box = await page.locator(MAP).boundingBox();
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}
const tapMap = (fx, fy) => async (page) => {
  const point = await mapPoint(page, fx, fy);
  await page.mouse.click(point.x, point.y);
};
const zoomIn = (page) => button(page, 'تكبير الخريطة').click();

const routes = {
  account: {
    hash: '#account',
    path: '/account',
    screen: 'account',
    step: 0,
    ready: '.settings-row',
  },
  location: { hash: '#book/2', path: '/book/2', screen: 'booking', step: 2, ready: CARD },
  home: { hash: '#home', path: '/', screen: 'home', step: 0, ready: '.hero-cta' },
};

async function openPair(context, server, scenario, where) {
  const route = routes[where];
  const state = initialSessionState(`#/?scenario=${scenario}`);
  const storage = referenceStorageFor(state, { screen: route.screen, step: route.step });
  storage.cars = state.vehicles.map((vehicle) => ({ ...vehicle }));
  storage.addresses = state.addresses.map((record) => ({
    ...record,
    place: record.place ? { ...record.place } : null,
  }));
  storage.draft.carId = state.draft.carId;
  storage.draft.place = state.draft.place ? { ...state.draft.place } : null;
  storage.draft.saveAddress = state.draft.saveAddress;
  const reference = await openReference(context, server, storage, route.hash);
  await reference.page.locator(route.ready).first().waitFor();
  const candidate = await openCandidate(
    context,
    origin,
    `${route.path}?scenario=${scenario}`,
    route.ready,
  );
  if (where === 'location') await candidate.page.locator('.booking-footer').waitFor();
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
    const card = doc.querySelector('.location-picker');
    const map = sheet?.querySelector('#location-map');
    return {
      route: route === '#' || route === '' ? '#home' : route,
      heading: text('.main h1'),
      profile: doc.querySelector('.profile-hero')
        ? [text('.profile-hero h2'), text('.profile-hero p')]
        : null,
      rows: [...doc.querySelectorAll('.settings-row')].map((row) => [
        text('strong', row),
        text('small', row),
        row.classList.contains('danger'),
      ]),
      stepChips: [...doc.querySelectorAll('.address-chips .chip')].map((chip) => [
        clean(chip.textContent),
        chip.classList.contains('selected'),
      ]),
      card: card
        ? {
            label: card.getAttribute('aria-label'),
            title: text('strong', card),
            preview: text('.address-preview', card),
          }
        : null,
      stepError: text('.main .error'),
      accessNote: text('.selection-summary'),
      footerPrice: text('#footer-price'),
      // The last notice raised, whether or not it is still on screen (see C005).
      toast: (toast && clean(toast.textContent)) || null,
      sheet: sheet
        ? {
            title: text('.sheet-head h2', sheet),
            intro: text('.sheet-intro', sheet),
            items: [...sheet.querySelectorAll('.saved-item')].map((item) => ({
              label: text('strong', item),
              address: text('p', item),
              actions: [...item.querySelectorAll('button')].map((control) =>
                control.getAttribute('aria-label'),
              ),
            })),
            map: map
              ? {
                  world: map.querySelector('#map-world').style.transform,
                  pin: [
                    map.querySelector('#map-pin').style.left,
                    map.querySelector('#map-pin').style.top,
                  ],
                }
              : null,
            pinDescription: text('#pin-description', sheet),
            fields: [...sheet.querySelectorAll('.field input')].map((input) => [
              input.name,
              input.value,
            ]),
            chips: [...sheet.querySelectorAll('.chip')].map((chip) => clean(chip.textContent)),
            savePreference: sheet.querySelector('input[name="saveAddress"]')?.checked ?? null,
            error: text('#address-error', sheet),
            buttons: [...sheet.querySelectorAll('.btn')].map((control) =>
              clean(control.textContent),
            ),
          }
        : null,
    };
  });
}

/** Screens compared visually. `prepare` runs the same steps on both pages. */
const visualStates = [
  { id: 'account-empty-book', scenario: 'home-empty', where: 'account' },
  { id: 'account-three-addresses', scenario: 'addresses-three', where: 'account' },
  { id: 'book-list-empty', scenario: 'home-empty', where: 'account', prepare: openBook },
  { id: 'book-list-three', scenario: 'addresses-three', where: 'account', prepare: openBook },
  { id: 'book-list-full', scenario: 'addresses-full', where: 'account', prepare: openBook },
  {
    id: 'book-add-form',
    scenario: 'addresses-one',
    where: 'account',
    prepare: async (page) => {
      await openBook(page);
      await openAdd(page);
    },
  },
  {
    id: 'book-edit-form-long-text',
    scenario: 'addresses-three',
    where: 'account',
    prepare: async (page) => {
      await openBook(page);
      await openEdit('مكتب الشركة')(page);
    },
  },
  {
    id: 'book-form-invalid',
    scenario: 'home-empty',
    where: 'account',
    prepare: async (page) => {
      await openBook(page);
      await openAdd(page);
      await submitEditor(page);
      await page.waitForFunction(
        () => globalThis.document.querySelector('#address-error')?.textContent !== '',
      );
      // The focused field is scrolled to shortly after; wait for it to rest.
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'book-delete-confirm',
    scenario: 'addresses-three',
    where: 'account',
    prepare: async (page) => {
      await openBook(page);
      await askDelete('المنزل')(page);
    },
  },
  { id: 'location-chips', scenario: 'addresses-three', where: 'location' },
  { id: 'location-chip-selected', scenario: 'addresses-draft-from-book', where: 'location' },
  {
    id: 'booking-editor-chips',
    scenario: 'addresses-three',
    where: 'location',
    prepare: openBookingEditor,
  },
  {
    id: 'booking-editor-chip-chosen',
    scenario: 'addresses-three',
    where: 'location',
    prepare: async (page) => {
      await openBookingEditor(page);
      await sheetChip('مكتب الشركة')(page);
    },
  },
];
// The populated list and the editor again on a short viewport.
const shortStates = [
  { id: 'short-book-list-three', scenario: 'addresses-three', where: 'account', prepare: openBook },
  { ...visualStates[6], id: 'short-book-edit-form' },
];
const SHORT_HEIGHT = 560;

async function compareVisual(browser, server, visual, width, height, summary) {
  const label = `${visual.id}@${width}`;
  const context = await newContext(browser, width, height ? { height } : {});
  try {
    const { reference, candidate } = await openPair(context, server, visual.scenario, visual.where);
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
    const compared = (state) => {
      if (!step.without) return state;
      const rest = { ...state };
      for (const key of step.without) delete rest[key];
      return rest;
    };
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

const summary = { evidence, visual: [], interactions: [] };
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const server = await startReferenceServer();
const save = () =>
  writeFileSync(resolve(evidence, 'c009-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
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

  // 2. Interaction parity: the same input on both pages, the same observable result.
  const interactionCases = [
    {
      name: 'account: add, edit, cancel, delete prompt, back, confirmed delete',
      scenario: 'home-empty',
      where: 'account',
      steps: [
        openBook,
        openAdd,
        fill(ADDRESS, '  دمشق، شارع توضيحي 7، قرب الحديقة  '),
        fill(LABEL, 'بيت الأهل'),
        fill(NOTE, 'الموقف الخلفي'),
        tapMap(0.3, 0.4),
        saveEditor,
        openAdd,
        fill(ADDRESS, 'دمشق، عنوان العمل التوضيحي'),
        fill(LABEL, ''),
        saveEditor,
        openEdit('بيت الأهل'),
        fill(LABEL, 'بيت العائلة'),
        fill(ADDRESS, 'نص لن يُحفظ'),
        // Escape closes the whole sheet and discards the edit.
        escape,
        openBook,
        openEdit('بيت الأهل'),
        fill(LABEL, 'بيت العائلة'),
        saveEditor,
        askDelete('بيت العائلة'),
        backToList,
        askDelete('بيت العائلة'),
        confirmDelete,
        askDelete('مكان الغسيل'),
        confirmDelete,
        escape,
      ],
    },
    {
      name: 'account: a short address is refused and the editor stays open',
      scenario: 'addresses-one',
      where: 'account',
      steps: [
        openBook,
        openAdd,
        submitEditor,
        fill(ADDRESS, '   ab   '),
        submitEditor,
        fill(ADDRESS, 'abcd'),
        saveEditor,
      ],
    },
    {
      name: 'account: adding an address that already exists updates that record',
      scenario: 'addresses-three',
      where: 'account',
      steps: [
        openBook,
        openAdd,
        fill(ADDRESS, '  دمشق، المزة، شارع تجريبي 12 '),
        fill(LABEL, 'منزل محدّث'),
        fill(NOTE, 'ملاحظة جديدة'),
        saveEditor,
        openEdit('منزل محدّث'),
      ],
    },
    {
      name: 'account: editing one record to another record address keeps both',
      scenario: 'addresses-three',
      where: 'account',
      steps: [
        openBook,
        openEdit('مكتب الشركة'),
        fill(ADDRESS, 'دمشق، المزة، شارع تجريبي 12'),
        saveEditor,
        escape,
      ],
    },
    {
      name: 'account: the sample chips and the map work in the account editor',
      scenario: 'addresses-one',
      where: 'account',
      steps: [
        openBook,
        openAdd,
        zoomIn,
        sheetChip('عمل تجريبي'),
        tapMap(0.7, 0.7),
        saveEditor,
        openEdit('العمل'),
      ],
    },
    {
      name: 'account: a record can still be updated when the book is full',
      scenario: 'addresses-full',
      where: 'account',
      steps: [
        openBook,
        openEdit('عنوان 5'),
        fill(LABEL, 'عنوان خمسة'),
        fill(ADDRESS, 'دمشق، شارع توضيحي معدّل'),
        saveEditor,
      ],
    },
    {
      name: 'location: a saved-address chip fills the draft and marks itself',
      scenario: 'addresses-three',
      where: 'location',
      steps: [
        (page) => page.locator(NEXT).click(),
        stepChip('مكتب الشركة'),
        stepChip('المنزل'),
        stepChip('<b>بيت</b>'),
        openBookingEditor,
      ],
    },
    {
      name: 'booking editor: a saved-address chip fills the editor only until applied',
      scenario: 'addresses-three',
      where: 'location',
      steps: [
        openBookingEditor,
        zoomIn,
        sheetChip('مكتب الشركة'),
        escape,
        openBookingEditor,
        fill(NOTE, 'ملاحظة مكتوبة'),
        sheetChip('المنزل'),
        sheetChip('<b>بيت</b>'),
        tapMap(0.2, 0.3),
        applyBookingEditor,
        openBookingEditor,
      ],
    },
    {
      name: 'booking editor: applying a typed address leaves the address book alone',
      scenario: 'addresses-one',
      where: 'location',
      steps: [
        openBookingEditor,
        fill(ADDRESS, 'دمشق، عنوان جديد لم يُحفظ'),
        fill(LABEL, 'جديد'),
        applyBookingEditor,
        openBookingEditor,
      ],
    },
  ];
  for (const interaction of interactionCases) {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, interaction.scenario, interaction.where);
      await compareSteps(pair.reference, pair.candidate, interaction.name, interaction.steps);
      assert.deepEqual(pair.candidate.problems, [], `${interaction.name}: candidate problems`);
      summary.interactions.push({ name: interaction.name, steps: interaction.steps.length });
    } finally {
      await context.close();
    }
  }

  // 3. Capacity. The reference refuses the 21st address but then shows its
  //    "saved" notice over the capacity notice. The port shows only the capacity
  //    outcome, because nothing was stored. Everything except that notice matches.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'addresses-full', 'account');
      await compareSteps(pair.reference, pair.candidate, 'capacity', [
        openBook,
        openAdd,
        fill(ADDRESS, 'دمشق، العنوان الحادي والعشرون'),
        { run: saveEditor, without: ['toast'] },
      ]);
      const candidateState = await observe(pair.candidate.page);
      assert.equal(candidateState.sheet.items.length, 20, 'no 21st record');
      assert.equal(candidateState.rows[1][1], '20 عناوين محفوظة');
      assert.equal(candidateState.toast, 'وصلت إلى حد 20 عنوانًا محفوظًا.');
      assert.equal((await observe(pair.reference.page)).toast, 'تم حفظ العنوان.');
      assert.deepEqual(pair.candidate.problems, []);
      summary.interactions.push({ name: 'capacity: the 21st address is refused and said so' });
    } finally {
      await context.close();
    }
  }

  // 4. Public entry and prefill: account → add → Home → start a booking → the
  //    location step starts with the first saved address, on both pages.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'home-empty', 'account');
      const next = async (page, isReference) => {
        if (isReference) await pastReferenceNextGuard(page);
        await page.locator(NEXT).click();
      };
      await compareSteps(pair.reference, pair.candidate, 'prefill', [
        openBook,
        openAdd,
        fill(ADDRESS, 'دمشق، عنوان محفوظ من الحساب'),
        fill(LABEL, 'بيتي'),
        fill(NOTE, 'عند المدخل'),
        tapMap(0.7, 0.4),
        saveEditor,
        escape,
        async (page) => {
          await page.locator('.nav-btn', { hasText: 'الرئيسية' }).click();
          await page.locator('.hero-cta').waitFor();
        },
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
        openBookingEditor,
        escape,
        // Care ↔ Location: header Back and Next again keep the address.
        async (page) => {
          await button(page, 'الخطوة السابقة').click();
          await page.locator('.service-option').first().waitFor();
        },
        async (page, isReference) => {
          await next(page, isReference);
          await page.locator(CARD).waitFor();
        },
      ]);
      assert.equal(
        (await observe(pair.candidate.page)).card.preview,
        'دمشق، عنوان محفوظ من الحساب',
      );

      // Next reaches the time step: `#book/3` in the prototype, `#/book/3` in the port.
      await pastReferenceNextGuard(pair.reference.page);
      await pair.reference.page.locator(NEXT).click();
      await pair.reference.page.waitForURL(/#book[/]3$/);
      await pair.candidate.page.locator(NEXT).click();
      await pair.candidate.page.locator('[data-booking-step="time"]').waitFor();
      assert.match(pair.candidate.page.url(), /#\/book\/3$/);
      assert.equal(
        await pair.candidate.page.locator('.c002-deferred-footer').count(),
        1,
        'the time step is still its placeholder',
      );
      assert.deepEqual(pair.candidate.problems, []);
      summary.interactions.push({ name: 'public entry, booking prefill, Care ↔ Location, Next' });
    } finally {
      await context.close();
    }
  }

  // 5. Prefill never replaces an address the draft already has.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'addresses-draft-from-book', 'home');
      await compareSteps(pair.reference, pair.candidate, 'prefill keeps the draft', [
        async (page) => {
          await page.locator('.hero-cta').click();
          await page.locator('.signature-car').first().waitFor();
        },
      ]);
      const { page } = pair.candidate;
      await page.goto(`${origin}/#/book/2`);
      await page.locator(CARD).waitFor();
      assert.equal((await observe(page)).card.title, 'مكتب الشركة', 'the draft address was kept');
      summary.interactions.push({ name: 'prefill keeps an existing draft address' });
    } finally {
      await context.close();
    }
  }

  // 6. Session semantics on the candidate: independence, navigation, refresh,
  //    and nothing leaving the page. No location API call during account CRUD.
  {
    const context = await newContext(browser, 390);
    try {
      await context.addInitScript(() => {
        const calls = [];
        globalThis.__locationCalls = calls;
        const prototype = globalThis.Geolocation.prototype;
        const get = prototype.getCurrentPosition;
        prototype.getCurrentPosition = function getCurrentPosition(...args) {
          calls.push('getCurrentPosition');
          return get.apply(this, args);
        };
        prototype.watchPosition = function watchPosition() {
          calls.push('watchPosition');
          return 0;
        };
      });
      const { page, problems, requests } = await openCandidate(
        context,
        origin,
        '/book/2?scenario=addresses-draft-from-book',
        CARD,
      );
      await page.locator('.booking-footer').waitFor();
      const requestsBefore = requests.length;
      const draftCard = (await observe(page)).card;
      assert.deepEqual(
        (await observe(page)).stepChips,
        [
          ['المنزل', false],
          ['مكتب الشركة', true],
          ['<b>بيت</b> & "تجربة"', false],
        ],
        'the chip whose address equals the draft address is marked',
      );

      // Leave the journey, edit and then delete the record the draft was copied from.
      await button(page, 'حفظ المسودة والخروج').click();
      await button(page, 'حفظ والخروج').click();
      await page.locator('[data-home-entry="saved-draft"]').waitFor();
      await page.locator('.nav-btn', { hasText: 'حسابي' }).click();
      await page.locator('.settings-row').first().waitFor();
      assert.equal((await observe(page)).rows[1][1], '3 عناوين محفوظة');
      await openBook(page);
      await openEdit('مكتب الشركة')(page);
      await fill(ADDRESS, 'دمشق، عنوان المكتب بعد التعديل')(page);
      await fill(LABEL, 'المكتب الجديد')(page);
      await saveEditor(page);
      await askDelete('المنزل')(page);
      await confirmDelete(page);
      assert.deepEqual(
        (await observe(page)).sheet.items.map((item) => item.label),
        ['المكتب الجديد', '<b>بيت</b> & "تجربة"'],
      );
      await escape(page);
      assert.equal((await observe(page)).rows[1][1], '2 عناوين محفوظة');

      // The draft kept its own copy; resuming returns to the location step.
      await page.locator('.nav-btn', { hasText: 'الرئيسية' }).click();
      await page.locator('[data-home-entry="saved-draft"] .text-btn').click();
      await page.locator(CARD).waitFor();
      assert.match(page.url(), /#\/book\/2$/);
      const resumed = await observe(page);
      assert.deepEqual(resumed.card, draftCard, 'an account edit does not rewrite the draft');
      assert.deepEqual(resumed.stepChips, [
        ['المكتب الجديد', false],
        ['<b>بيت</b> & "تجربة"', false],
      ]);

      // A saved-address chip in the editor keeps the customer's save preference.
      // (The reference redraws the tick from the value the sheet opened with, so
      // an untick made before the chip is lost there; the port keeps it.)
      await openBookingEditor(page);
      await page.locator(SAVE_PREFERENCE).check();
      await sheetChip('المكتب الجديد')(page);
      assert.equal((await observe(page)).sheet.savePreference, true);
      await page.locator(SAVE_PREFERENCE).uncheck();
      await sheetChip('<b>بيت</b>')(page);
      assert.equal((await observe(page)).sheet.savePreference, false, 'the untick is kept');
      await escape(page);
      assert.deepEqual((await observe(page)).card, draftCard, 'a discarded editor changes nothing');

      // Applying a booking address with the save preference on saves nothing.
      await openBookingEditor(page);
      await fill(ADDRESS, 'دمشق، عنوان الحجز فقط')(page);
      await page.locator(SAVE_PREFERENCE).check();
      await applyBookingEditor(page);
      assert.equal((await observe(page)).stepChips.length, 2, 'Apply does not save an address');
      await page.locator(NEXT).click();
      await page.locator('[data-booking-step="time"]').waitFor();
      await page.goBack();
      await page.locator(CARD).waitFor();
      assert.equal((await observe(page)).stepChips.length, 2, 'Next does not save an address');
      assert.equal((await observe(page)).card.preview, 'دمشق، عنوان الحجز فقط');

      // Text that looks like markup stays text everywhere it is shown.
      assert.deepEqual(
        await page.evaluate(() => ({
          injected: globalThis.document.querySelectorAll('.main b, .main img, dialog b, dialog img')
            .length,
        })),
        { injected: 0 },
      );

      assert.equal(await page.locator('.nav-dot').count(), 0, 'no order was created');
      assert.deepEqual(await page.evaluate(() => globalThis.__locationCalls), []);
      assert.equal(requests.length, requestsBefore, 'the address book sends no request');
      assert.deepEqual(
        await page.evaluate(() => ({
          local: globalThis.localStorage.length,
          session: globalThis.sessionStorage.length,
          cookies: globalThis.document.cookie,
        })),
        { local: 0, session: 0, cookies: '' },
        'the address book writes no browser storage',
      );

      // A reload starts again from the fixture: the session's saves are gone.
      await page.goto(`${origin}/#/account?scenario=addresses-draft-from-book`);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.settings-row').first().waitFor();
      assert.equal((await observe(page)).rows[1][1], '3 عناوين محفوظة');
      await page.goto(`${origin}/#/account?scenario=__proto__`);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.settings-row').first().waitFor();
      assert.equal((await observe(page)).rows[1][1], '0 عناوين محفوظة');
      assert.deepEqual(problems, []);
      summary.interactions.push({
        name: 'session only: independent copies, no early save, no request, storage or order',
      });
    } finally {
      await context.close();
    }
  }

  // 7. A location answer belongs to the editor that asked. One that arrives after
  //    the editor was replaced or closed changes nothing and raises no notice.
  {
    const context = await newContext(browser, 390);
    try {
      await context.addInitScript(() => {
        globalThis.Geolocation.prototype.getCurrentPosition = (ok) =>
          globalThis.setTimeout(
            () => ok({ coords: { latitude: 24.7001, longitude: 46.6502 } }),
            700,
          );
      });
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/account?scenario=addresses-three',
        '.settings-row',
      );
      await openBook(page);
      await openEdit('المنزل')(page);
      await page.locator(LOCATE).click();
      assert.equal(await page.locator(LOCATE).isDisabled(), true);
      // Leave that editor for another record before the answer arrives.
      await page.keyboard.press('Escape');
      await sheetClosed(page);
      await openBook(page);
      await openEdit('مكتب الشركة')(page);
      await page.waitForTimeout(1000);
      const later = await observe(page);
      assert.equal(later.toast, null, 'a stale answer raises no notice');
      assert.equal(later.sheet.pinDescription, 'نقطة مختارة على الخريطة التوضيحية');
      assert.deepEqual(later.sheet.map.pin, ['228px', '312px']);
      assert.equal(await page.locator(LOCATE).isDisabled(), false);

      // An answer for the editor that is still open is applied to it.
      await page.locator(LOCATE).click();
      await page.waitForFunction(() =>
        globalThis.document.querySelector('.toast')?.textContent.includes('ضمن نطاق'),
      );
      assert.equal(
        (await observe(page)).sheet.pinDescription,
        'موقع داخل نطاق دمشق التقريبي، أكمل العنوان',
      );
      const html = await page.evaluate(() => globalThis.document.documentElement.outerHTML);
      assert.ok(!html.includes('24.7001') && !html.includes('46.6502'), 'no coordinates shown');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'location answers stay with their editor session' });
    } finally {
      await context.close();
    }
  }

  // 8. Keyboard, semantics, modality and focus across list → edit → list → delete.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/account?scenario=addresses-three',
        '.settings-row',
      );
      const row = page.locator(ADDRESSES_ROW);
      assert.equal(await row.evaluate((node) => node.tagName), 'BUTTON');
      assert.equal(await row.getAttribute('aria-haspopup'), 'dialog');
      assert.equal(await row.getAttribute('aria-disabled'), null);

      // Deferred controls say so and do nothing.
      const deferred = page.locator('[data-deferred="account"]');
      assert.equal(await deferred.count(), 9);
      assert.deepEqual(
        await deferred.evaluateAll((nodes) => [
          ...new Set(nodes.map((node) => node.getAttribute('aria-disabled'))),
        ]),
        ['true'],
      );
      // A customer can still point at, tap and focus a deferred control (it is
      // marked unavailable, not removed). Real pointer input at its centre and
      // Enter/Space on it must do nothing, and must leave it marked unavailable.
      const before = await observe(page);
      for (const title of ['بياناتي', 'إعادة ضبط التجربة']) {
        const control = page.locator('.settings-row', { hasText: title });
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await control.focus();
        assert.equal(
          await control.evaluate((node) => node === globalThis.document.activeElement),
          true,
          `${title}: reachable by keyboard`,
        );
        await page.keyboard.press('Enter');
        await page.keyboard.press('Space');
        assert.equal(await control.getAttribute('aria-disabled'), 'true');
      }
      assert.equal(await page.locator('dialog.sheet[open]').count(), 0);
      assert.match(page.url(), /#\/account/);
      assert.deepEqual(await observe(page), before, 'a deferred control changes nothing');

      const inSheet = () =>
        page.evaluate(() => {
          const doc = globalThis.document;
          const sheet = doc.querySelector('dialog.sheet[open]');
          const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id);
          return {
            modal: sheet.matches(':modal'),
            title: doc.getElementById(sheet.getAttribute('aria-labelledby'))?.textContent,
            focusInside: sheet.contains(doc.activeElement),
            duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
            unlabelled: [...sheet.querySelectorAll('input')]
              .filter((input) => !input.labels?.length)
              .map((input) => input.name),
            clickOnly: sheet.querySelectorAll('[role="button"], div[onclick]').length,
          };
        });
      const sound = (title) => ({
        modal: true,
        title,
        focusInside: true,
        duplicateIds: [],
        unlabelled: [],
        clickOnly: 0,
      });

      await row.focus();
      await page.keyboard.press('Enter');
      await sheetTitle(page, LIST_TITLE);
      assert.deepEqual(await inSheet(), sound(LIST_TITLE));

      await openEdit('المنزل')(page);
      assert.deepEqual(await inSheet(), sound('مكان سيارتك، بكل بساطة.'));
      assert.equal(await page.locator(SAVE_PREFERENCE).count(), 0, 'no save preference here');
      assert.equal(
        await page.locator('#address-form button[type="submit"]').innerText(),
        'حفظ العنوان',
      );

      // A refused save keeps the editor and focuses the field.
      await fill(ADDRESS, 'ab')(page);
      await page.locator(ADDRESS).press('Enter');
      await page.waitForFunction(() => globalThis.document.activeElement?.id === 'sheet-address');
      assert.equal((await observe(page)).sheet.error, 'أدخل عنوانًا من أربعة أحرف على الأقل.');

      // Tab stays inside the sheet and every stop shows a focus ring.
      for (let i = 0; i < 14; i += 1) {
        await page.keyboard.press('Tab');
        const where = await page.evaluate(() => {
          const element = globalThis.document.activeElement;
          if (!element || element === globalThis.document.body) return 'browser';
          if (!element.closest('dialog.sheet[open]')) return `outside:${element.className}`;
          const style = globalThis.getComputedStyle(element);
          return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2
            ? 'ringed'
            : `NO-RING:${element.className || element.name}`;
        });
        assert.ok(where === 'ringed' || where === 'browser', `focus stop: ${where}`);
      }

      await fill(ADDRESS, 'دمشق، المزة، شارع تجريبي 12')(page);
      await page.locator(ADDRESS).press('Enter');
      await sheetTitle(page, LIST_TITLE);
      assert.deepEqual(await inSheet(), sound(LIST_TITLE), 'focus stays in the sheet after a save');

      await askDelete('المنزل')(page);
      assert.deepEqual(await inSheet(), sound('حذف هذا العنوان؟'));
      await confirmDelete(page);
      assert.deepEqual(
        await inSheet(),
        sound(LIST_TITLE),
        'after the focused control is removed with its record, focus stays in the sheet',
      );
      await page.locator('.toast.show').waitFor();
      assert.equal(await page.locator('.toast.show').getAttribute('role'), 'status');

      // Escape closes; focus returns to the row; scrolling is unlocked.
      await escape(page);
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.dataset.accountRow),
        'addresses',
        'focus returns to the row that opened the sheet',
      );
      await page.waitForFunction(() => globalThis.document.body.style.overflow === '');

      // Reopening right after closing: the old close must not take focus back.
      await page.keyboard.press('Enter');
      await sheetTitle(page, LIST_TITLE);
      await page.waitForTimeout(150);
      assert.deepEqual(await inSheet(), sound(LIST_TITLE));
      await escape(page);

      // «سياراتي» uses the existing garage navigation.
      await page.locator('.settings-row', { hasText: 'سياراتي' }).click();
      await page.locator('[data-customer-route="garage"]').waitFor();
      await page.goBack();
      await page.locator('.settings-row').first().waitFor();
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'keyboard, semantics, modality and focus' });
    } finally {
      await context.close();
    }
  }

  // 9. Touch targets, and reduced motion.
  for (const width of [320, 1440]) {
    const context = await newContext(browser, width);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/account?scenario=addresses-three',
        '.settings-row',
      );
      await openBook(page);
      const sizes = await page.evaluate(() =>
        [...globalThis.document.querySelectorAll('dialog.sheet[open] button, .settings-row')].map(
          (node) => {
            const rect = node.getBoundingClientRect();
            return [
              node.getAttribute('aria-label') || node.innerText.trim(),
              rect.width,
              rect.height,
            ];
          },
        ),
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
        '/account?scenario=addresses-one',
        '.settings-row',
      );
      await openBook(page);
      const animation = await page.evaluate(
        () =>
          globalThis.getComputedStyle(globalThis.document.querySelector('dialog.sheet[open]'))
            .animationName,
      );
      assert.equal(animation, reducedMotion === 'reduce' ? 'none' : 'sheetIn');
      await askDelete('المنزل')(page);
      await confirmDelete(page);
      assert.equal((await observe(page)).sheet.items.length, 0);
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
  summary.interactions.push({ name: 'touch targets at 320 and 1440; reduced motion' });

  save();
  console.log(
    `C009 browser acceptance passed: ${summary.visual.length} visual comparisons, ` +
      `${summary.interactions.length} interaction checks. Evidence: ${evidence}`,
  );
} catch (error) {
  save();
  console.error(`C009 evidence directory: ${evidence}`);
  throw error;
} finally {
  await server.close();
  await browser.close();
}
