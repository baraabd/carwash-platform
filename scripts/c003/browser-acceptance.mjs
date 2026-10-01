// C003 browser acceptance: renders the React Home next to the approved customer
// HTML in the same browser and compares structure, copy, geometry, computed style
// and pixels, then exercises the Home-owned interactions on both.
//
// The reference is served read-only by the F010 reference server; it is never
// modified. Its localStorage is seeded so it shows the same session as the
// candidate scenario under test.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { ROOT, loadRegistry } from '../f010/reference-registry.mjs';
import { startReferenceServer } from '../f010/reference-server.mjs';
import { comparePngBuffers } from '../f010/pixel-compare.mjs';
import {
  homeScenarioIds,
  homeScenarioState,
} from '../../apps/customer-web/src/fixtures/customerHomeScenarios.ts';

const origin = process.env.C003_ORIGIN ?? 'http://127.0.0.1:4174';
const contract = loadRegistry(ROOT).rendering;
const evidence = process.env.C003_EVIDENCE_DIR
  ? resolve(process.env.C003_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c003-'));
mkdirSync(evidence, { recursive: true });

const REFERENCE_STORAGE_KEY = 'washgo.payments.sy.v6';
const GEOMETRY_TOLERANCE_PX = 0.5;

// Every element Home owns, plus the shell regions Home's state shows through.
const PARITY_SELECTORS = [
  'body',
  '.desktop-note',
  '.desktop-note .label',
  '.desktop-note h2',
  '.desktop-note p',
  '.desktop-chip',
  '.desktop-number',
  '.app',
  '.app-header',
  '.brand',
  '.city',
  '.city .icon',
  '.app-header .icon-btn',
  '.main',
  '.demo-label',
  '.demo-label .dot',
  '.hero',
  '.hero .row',
  '.hero-tag',
  '.hero-tag .icon',
  '.hero-index',
  '.hero-copy',
  '.hero-copy p',
  '.hero-copy h1',
  '.hero-copy h1 span',
  '.hero-art',
  '.hero-art .car-art',
  '.hero-spark',
  '.hero-spark .icon',
  '.hero-bottom',
  '.hero-price',
  '.hero-price strong',
  '.hero-price .currency',
  '.hero-cta',
  '.arrow-circle',
  '.arrow-circle .icon',
  '.benefits',
  '.benefits span',
  '.benefits .icon',
  '.resume',
  '.resume > .icon',
  '.resume strong',
  '.resume p',
  '.resume .text-btn',
  '.resume .text-btn .icon',
  '.quick-return',
  '.quick-return .chapter-icon',
  '.quick-return .chapter-icon .icon',
  '.quick-return small',
  '.quick-return strong',
  '.quick-return p',
  '.quick-return > .icon',
  '.pay-lab-link',
  '.pay-lab-link .icon',
  '.pay-lab-link strong',
  '.pay-lab-link small',
  '.section-title',
  '.section-title small',
  '.section-title h2',
  '.section-title .text-btn',
  '.services-home',
  '.home-package',
  '.package-icon',
  '.package-icon .icon',
  '.home-package h3',
  '.home-package p',
  '.package-price',
  '.package-price > span',
  '.package-price .currency',
  '.package-price > .icon',
  '.result-teaser',
  '.teaser-scenes',
  '.teaser-scenes .art-scene',
  '.teaser-scenes svg',
  '.teaser-mask',
  '.teaser-line',
  '.teaser-tag',
  '.teaser-bottom',
  '.teaser-bottom strong',
  '.teaser-bottom p',
  '.teaser-bottom > .icon',
  '.footer-note',
  '.bottom-nav',
  '.nav-btn',
  '.nav-btn .nav-icon',
  '.nav-btn .icon',
  '.nav-dot',
];

const STYLE_PROPERTIES = [
  'display',
  'position',
  'direction',
  'text-align',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-synthesis-weight',
  'font-synthesis-style',
  'line-height',
  'letter-spacing',
  'color',
  'background-color',
  'background-image',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'box-shadow',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'opacity',
  'transform',
  'stroke-width',
  'fill',
  'stroke',
  'filter',
  'clip-path',
  'overflow-x',
  'overflow-y',
];

/** Session state in the shape the approved prototype persists and reloads. */
function referenceStorageFor(scenarioId) {
  const state = homeScenarioState(scenarioId);
  const draftLike = (source) => ({
    type: source.vehicleType,
    carId: null,
    carName: source.carName,
    plate: source.plate,
    color: source.color,
    saveVehicle: true,
    service: source.service,
    extras: [...source.extras],
    address: source.address,
    addressLabel: source.addressLabel,
    locationNote: source.locationNote,
    place: null,
    saveAddress: true,
    date: source.slot?.date ?? '',
    time: source.slot?.time ?? null,
    name: source.contactName,
    phone: source.contactPhone,
    note: source.note,
    paymentMethod: source.paymentMethod,
  });
  return {
    version: 6,
    screen: 'home',
    step: 0,
    draftStep: state.draftStep,
    motion: 'system',
    editing: false,
    draft: { ...draftLike(state.draft), touched: state.draft.touched },
    cars: [],
    addresses: [],
    orders: state.orders.map((order) => ({
      ...draftLike(order),
      touched: true,
      id: order.id,
      createdAt: '2026-09-18T07:00:00.000Z',
      stage: order.stage,
      rating: 0,
    })),
    profile: { ...state.profile },
    activeOrderId: null,
    filter: 'active',
  };
}

const fixedClock = `(() => {
  const fixed = ${JSON.stringify(contract.fixedTime)};
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return new NativeDate(fixed).getTime(); }
  }
  Object.setPrototypeOf(FixedDate, NativeDate);
  Object.defineProperty(window, 'Date', { value: FixedDate });
})();`;

const screenshotOptions = Object.freeze({
  fullPage: true,
  animations: 'disabled',
  caret: 'hide',
  style: `
    html { scrollbar-width: none !important; }
    *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
    *, *::before, *::after { animation: none !important; transition: none !important; }
  `,
});

async function newContext(browser, width, { reducedMotion = contract.reducedMotion } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: contract.height },
    deviceScaleFactor: contract.deviceScaleFactor,
    locale: contract.locale,
    timezoneId: contract.timezoneId,
    colorScheme: contract.colorScheme,
    reducedMotion,
  });
  await context.addInitScript({ content: fixedClock });
  return context;
}

/** Fails the run on any page error, console error or request leaving loopback. */
function watchPage(page, label) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${label} console.error: ${message.text()}`);
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    const local =
      url.hostname === '127.0.0.1' || ['data:', 'blob:', 'about:'].includes(url.protocol);
    if (!local) problems.push(`${label} external request: ${request.url()}`);
    if (request.method() !== 'GET') {
      problems.push(`${label} non-GET request: ${request.method()} ${request.url()}`);
    }
  });
  return problems;
}

async function settle(page) {
  await page.evaluate(async () => {
    if (globalThis.document.fonts) await globalThis.document.fonts.ready;
  });
  await page.waitForTimeout(80);
}

async function openReference(context, server, scenarioId) {
  const page = await context.newPage();
  const problems = watchPage(page, 'reference');
  await page.addInitScript(
    ({ key, value }) => {
      globalThis.localStorage.setItem(key, value);
    },
    { key: REFERENCE_STORAGE_KEY, value: JSON.stringify(referenceStorageFor(scenarioId)) },
  );
  const response = await page.goto(`${server.origin}/customer`, { waitUntil: 'load' });
  assert.equal(response?.status(), 200);
  await settle(page);
  return { page, problems };
}

async function openCandidate(context, scenarioId) {
  const page = await context.newPage();
  const problems = watchPage(page, 'candidate');
  const response = await page.goto(`${origin}/#/?scenario=${scenarioId}`, {
    waitUntil: 'networkidle',
  });
  assert.equal(response?.status(), 200);
  await settle(page);
  return { page, problems };
}

/** Geometry, computed style and own text of every element matching the selectors. */
function snapshot(page) {
  return page.evaluate(
    ({ selectors, properties }) => {
      const doc = globalThis.document;
      const result = {};
      for (const selector of selectors) {
        result[selector] = [...doc.querySelectorAll(selector)].map((element) => {
          const rect = element.getBoundingClientRect();
          const style = globalThis.getComputedStyle(element);
          return {
            rect: {
              x: rect.x + globalThis.scrollX,
              y: rect.y + globalThis.scrollY,
              width: rect.width,
              height: rect.height,
            },
            style: Object.fromEntries(
              properties.map((name) => [name, style.getPropertyValue(name)]),
            ),
          };
        });
      }
      const text = (root) => (root?.innerText ?? '').replace(/\s+/g, ' ').trim();
      return {
        elements: result,
        mainText: text(doc.querySelector('.main')),
        headerText: text(doc.querySelector('.app-header')),
        navText: text(doc.querySelector('.bottom-nav')),
        scrollWidth: doc.documentElement.scrollWidth,
        scrollHeight: doc.documentElement.scrollHeight,
        innerWidth: globalThis.innerWidth,
        lang: doc.documentElement.lang,
        dir: doc.documentElement.dir,
        title: doc.title,
      };
    },
    { selectors: PARITY_SELECTORS, properties: STYLE_PROPERTIES },
  );
}

// The production CSS minifier rewrites a zero gradient position (`0%`) as the
// unitless `0`, which Chromium serialises as `0px`. Zero is the same offset in
// either unit, so only that spelling is normalised; the pixel comparison below
// still proves the gradient renders identically.
function canonicalStyle(property, value) {
  return property === 'background-image' ? value.replace(/(?<![\d.])0(?:px|%)/g, '0') : value;
}

function compareSnapshots(reference, candidate, label) {
  const drift = [];
  for (const selector of PARITY_SELECTORS) {
    const expected = reference.elements[selector];
    const actual = candidate.elements[selector];
    if (expected.length !== actual.length) {
      drift.push(`${selector}: count ${actual.length} vs reference ${expected.length}`);
      continue;
    }
    expected.forEach((expectedElement, index) => {
      for (const side of ['x', 'y', 'width', 'height']) {
        const delta = Math.abs(actual[index].rect[side] - expectedElement.rect[side]);
        if (delta > GEOMETRY_TOLERANCE_PX) {
          drift.push(
            `${selector}[${index}] ${side}: ${actual[index].rect[side]} vs reference ${expectedElement.rect[side]}`,
          );
        }
      }
      for (const property of STYLE_PROPERTIES) {
        if (
          canonicalStyle(property, actual[index].style[property]) !==
          canonicalStyle(property, expectedElement.style[property])
        ) {
          drift.push(
            `${selector}[${index}] ${property}: "${actual[index].style[property]}" vs reference "${expectedElement.style[property]}"`,
          );
        }
      }
    });
  }
  for (const key of ['mainText', 'headerText', 'navText', 'scrollHeight', 'lang', 'dir', 'title']) {
    if (reference[key] !== candidate[key]) {
      drift.push(`${key}: "${candidate[key]}" vs reference "${reference[key]}"`);
    }
  }
  assert.deepEqual(drift, [], `${label}: drift against the approved reference`);
}

const summary = { evidence, visual: [], interactions: [] };
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const server = await startReferenceServer();
try {
  // 1. Visual parity: every scenario at every contract viewport.
  for (const scenarioId of homeScenarioIds) {
    for (const width of contract.viewports) {
      const label = `${scenarioId}@${width}`;
      const context = await newContext(browser, width);
      try {
        const reference = await openReference(context, server, scenarioId);
        const candidate = await openCandidate(context, scenarioId);
        const referenceSnapshot = await snapshot(reference.page);
        const candidateSnapshot = await snapshot(candidate.page);

        assert.equal(candidateSnapshot.lang, 'ar', `${label}: lang`);
        assert.equal(candidateSnapshot.dir, 'rtl', `${label}: dir`);
        const overflow = candidateSnapshot.scrollWidth - candidateSnapshot.innerWidth;
        assert.ok(overflow <= 0, `${label}: horizontal overflow ${overflow}px`);
        compareSnapshots(referenceSnapshot, candidateSnapshot, label);

        const referencePng = await reference.page.screenshot(screenshotOptions);
        const candidatePng = await candidate.page.screenshot(screenshotOptions);
        const pixels = await comparePngBuffers(
          browser,
          referencePng,
          candidatePng,
          contract.channelThreshold,
        );
        writeFileSync(resolve(evidence, `${label}.reference.png`), referencePng);
        writeFileSync(resolve(evidence, `${label}.candidate.png`), candidatePng);
        if (pixels.diffBuffer)
          writeFileSync(resolve(evidence, `${label}.diff.png`), pixels.diffBuffer);
        summary.visual.push({
          scenario: scenarioId,
          width,
          sameDimensions: pixels.sameDimensions,
          changedPixels: pixels.changedPixels,
          diffRatio: pixels.diffRatio,
        });
        assert.equal(pixels.sameDimensions, true, `${label}: screenshot dimensions differ`);
        assert.ok(
          pixels.diffRatio <= contract.allowedDiffRatio,
          `${label}: ${pixels.changedPixels} pixels differ from the approved reference`,
        );

        assert.deepEqual(reference.problems, [], `${label}: reference page problems`);
        assert.deepEqual(candidate.problems, [], `${label}: candidate page problems`);
      } finally {
        await context.close();
      }
    }
  }

  // 2. Interaction parity: the same click must lead to the same place in both.
  const bookingStep = (url) => /#\/?book\/(\d+)$/.exec(url)?.[1] ?? null;
  const trackedOrder = (url) => /#\/?order\/([^/]+)$/.exec(url)?.[1] ?? null;
  const interactions = [
    {
      name: 'primary CTA starts at step one',
      scenario: 'home-empty',
      selector: '.hero-cta',
      read: bookingStep,
      expected: '0',
    },
    {
      name: 'package card starts at step one',
      scenario: 'home-empty',
      selector: '.home-package.featured',
      read: bookingStep,
      expected: '0',
    },
    {
      name: 'resume returns to the saved step',
      scenario: 'home-saved-draft',
      selector: '.resume .text-btn',
      read: bookingStep,
      expected: '2',
    },
    {
      name: 'follow opens the running order',
      scenario: 'home-active-order',
      selector: '.resume .text-btn',
      read: trackedOrder,
      expected: 'WG-DEMO-RUNNING',
    },
    {
      name: 'repeat goes to review',
      scenario: 'home-repeat-order',
      selector: '.quick-return',
      read: bookingStep,
      expected: '6',
    },
  ];
  for (const interaction of interactions) {
    const context = await newContext(browser, 390);
    try {
      const reference = await openReference(context, server, interaction.scenario);
      const candidate = await openCandidate(context, interaction.scenario);
      await reference.page.locator(interaction.selector).first().click();
      await candidate.page.locator(interaction.selector).first().click();
      await reference.page.waitForTimeout(120);
      await candidate.page.waitForTimeout(120);
      const referenceResult = interaction.read(reference.page.url());
      const candidateResult = interaction.read(candidate.page.url());
      assert.equal(referenceResult, interaction.expected, `${interaction.name}: reference`);
      assert.equal(candidateResult, referenceResult, `${interaction.name}: candidate vs reference`);
      assert.deepEqual(candidate.problems, [], `${interaction.name}: candidate page problems`);
      summary.interactions.push({ name: interaction.name, destination: candidateResult });
    } finally {
      await context.close();
    }
  }

  // 3. Repeat derives a draft only: no booking is created or submitted.
  {
    const context = await newContext(browser, 390);
    try {
      const reference = await openReference(context, server, 'home-repeat-order');
      const { page, problems } = await openCandidate(context, 'home-repeat-order');
      const requests = [];
      page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
      await reference.page.locator('.quick-return').click();
      await page.locator('.quick-return').click();
      await page.waitForTimeout(150);
      assert.match(page.url(), /#\/book\/6$/);
      assert.deepEqual(requests, [], 'repeat must not send any request');
      assert.equal(await page.locator('.nav-dot').count(), 0, 'repeat must not add an order');
      assert.equal(
        await page.locator('.toast.show').innerText(),
        await reference.page.locator('.toast.show').innerText(),
        'repeat notice copy',
      );
      assert.equal(
        (await page.locator('.header-title').innerText()).split('\n')[0],
        (await reference.page.locator('.header-title').innerText()).split('\n')[0],
        'repeat booking header',
      );
      // Back on Home the finished order is still the only one, now with a draft to continue.
      await page.getByRole('button', { name: 'العودة' }).click();
      await page.waitForTimeout(120);
      assert.match(page.url(), /#\/\?scenario=home-repeat-order$/);
      assert.equal(await page.locator('.quick-return').count(), 1);
      assert.equal(await page.locator('[data-home-entry="saved-draft"]').count(), 1);
      assert.equal(await page.locator('[data-home-entry="active-order"]').count(), 0);
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'repeat creates a draft only', requests: requests.length });
    } finally {
      await context.close();
    }
  }

  // 4. Empty Home shows none of the conditional entries.
  {
    const context = await newContext(browser, 390);
    try {
      const { page } = await openCandidate(context, 'home-empty');
      assert.equal(await page.locator('[data-home-entry]').count(), 0);
      assert.equal(await page.locator('.nav-dot').count(), 0);
      assert.equal(await page.locator('.nav-btn.active').innerText(), 'الرئيسية');
      assert.equal(await page.locator('.nav-btn[aria-current="page"]').count(), 1);
      // An unknown scenario id falls back to the same empty default.
      await page.goto(`${origin}/#/?scenario=does-not-exist`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.locator('[data-home-entry]').count(), 0);
      assert.equal(await page.locator('[data-customer-fixture="home-default"]').count(), 1);
    } finally {
      await context.close();
    }
  }

  // 5. City notice: modal sheet, focus trap, Escape, focus restoration.
  for (const width of [390, 1024]) {
    const context = await newContext(browser, width);
    try {
      const reference = await openReference(context, server, 'home-empty');
      const { page, problems } = await openCandidate(context, 'home-empty');
      await reference.page.locator('.city').click();
      await page.locator('.city').click();
      await reference.page.waitForTimeout(350);
      await page.waitForTimeout(350);
      const sheetState = (target) =>
        target.evaluate(() => {
          const sheet = globalThis.document.querySelector('dialog.sheet');
          const rect = sheet.getBoundingClientRect();
          const style = globalThis.getComputedStyle(sheet);
          return {
            open: sheet.open,
            modal: sheet.matches(':modal'),
            text: sheet.innerText.replace(/\s+/g, ' ').trim(),
            rect: [rect.x, rect.y, rect.width, rect.height].map(
              (value) => Math.round(value * 2) / 2,
            ),
            radius: style.borderTopLeftRadius,
            padding: globalThis.getComputedStyle(sheet.firstElementChild).padding,
            labelledBy: sheet.getAttribute('aria-labelledby'),
          };
        });
      assert.deepEqual(
        await sheetState(page),
        await sheetState(reference.page),
        `city sheet@${width}`,
      );
      // A native modal dialog makes the page behind it inert. Tab may pass through the
      // browser's own UI (reported as <body>) while cycling, but must never land on
      // page content outside the sheet.
      const stopsInSheet = new Set();
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Tab');
        const stop = await page.evaluate(() => {
          const element = globalThis.document.activeElement;
          if (!element || element === globalThis.document.body) return 'browser';
          return element.closest('dialog.sheet')
            ? `sheet:${element.getAttribute('aria-label') ?? element.innerText.trim()}`
            : `outside:${element.className}`;
        });
        assert.ok(!stop.startsWith('outside:'), `focus escaped the open sheet to ${stop}`);
        if (stop.startsWith('sheet:')) stopsInSheet.add(stop);
      }
      assert.deepEqual(
        [...stopsInSheet].sort(),
        ['sheet:إغلاق النافذة', 'sheet:متابعة التجربة'],
        'both sheet controls are reachable by keyboard',
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      assert.equal(await page.locator('dialog.sheet[open]').count(), 0);
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.classList.contains('city')),
        true,
        'focus returns to the city control',
      );
      assert.equal(await page.evaluate(() => globalThis.document.body.style.overflow), '');
      // The sheet's own action closes it too.
      await page.locator('.city').click();
      await page.getByRole('button', { name: 'متابعة التجربة' }).click();
      await page.waitForTimeout(80);
      assert.equal(await page.locator('dialog.sheet[open]').count(), 0);
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }

  // 6. Keyboard: order, visible focus, activation, no trap.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(context, 'home-returning-customer');
      const stops = [];
      for (let i = 0; i < 16; i += 1) {
        await page.keyboard.press('Tab');
        stops.push(
          await page.evaluate(() => {
            const element = globalThis.document.activeElement;
            const style = globalThis.getComputedStyle(element);
            return {
              tag: element.tagName,
              name: (element.getAttribute('aria-label') ?? element.innerText)
                .replace(/\s+/g, ' ')
                .trim(),
              outline: `${style.outlineStyle} ${style.outlineWidth}`,
              focusVisible: element.matches(':focus-visible'),
            };
          }),
        );
      }
      assert.deepEqual(
        stops.map((stop) => stop.name),
        [
          'انتقل إلى المحتوى',
          'WashGo الرئيسية',
          'دمشق',
          'حسابي',
          'احجز غسلتك',
          'متابعة',
          'عنايتك المفضّلة، محفوظة نكرر نفس الغسلة؟ سيارتي التجريبية · نظافة متكاملة',
          'أكمل',
          'جرّب الدفع بطريقتك. كاش · شام كاش · سيريتل كاش — تجربة مباشرة',
          'تفاصيل الباقات',
          'لمعة سريعة غسيل خارجي · 35 دقيقة 500 ل.س',
          'نظافة متكاملة داخلي + خارجي · 60 دقيقة 900 ل.س',
          'جرّب المقارنة التفاعلية قبل وبعد',
          'الرئيسية',
          'حجوزاتي 1',
          'سياراتي',
        ],
        'logical focus order',
      );
      for (const stop of stops) {
        assert.ok(['A', 'BUTTON'].includes(stop.tag), `non-semantic focus stop: ${stop.tag}`);
        assert.equal(stop.focusVisible, true, `${stop.name}: focus not visible`);
        assert.equal(stop.outline, 'solid 3px', `${stop.name}: focus outline`);
      }
      // No click-only containers: every element with a pointer handler is a button or link.
      assert.equal(await page.locator('.main [role="button"], .main div[onclick]').count(), 0);
      // Keyboard activation of the repeat entry behaves like a click.
      await page.locator('.quick-return').focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
      assert.match(page.url(), /#\/book\/6$/);
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }

  // 7. History: back, forward, refresh and in-app focus announcement.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(context, 'home-saved-draft');
      await page.locator('.resume .text-btn').click();
      assert.match(page.url(), /#\/book\/2$/);
      await page.goBack();
      assert.match(page.url(), /#\/\?scenario=home-saved-draft$/);
      assert.equal(await page.locator('[data-home-entry="saved-draft"]').count(), 1);
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.tagName),
        'H1',
        'Home heading receives focus after in-app navigation',
      );
      await page.goForward();
      assert.match(page.url(), /#\/book\/2$/);
      await page.goBack();
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.locator('[data-home-entry="saved-draft"]').count(), 1);
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.classList.contains('skip')),
        true,
        'skip link is the first stop after a fresh load',
      );
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }

  // 8. Motion: the press ripple exists with motion allowed and is absent when reduced.
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await newContext(browser, 390, { reducedMotion });
    try {
      const { page, problems } = await openCandidate(context, 'home-empty');
      const box = await page.locator('.hero-cta').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const waves = await page.locator('.hero-cta .tap-wave').count();
      await page.mouse.up();
      assert.equal(waves, reducedMotion === 'reduce' ? 0 : 1, `tap wave with ${reducedMotion}`);
      await page.waitForTimeout(120);
      assert.match(page.url(), /#\/book\/0$/, 'the CTA still works');
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }

  writeFileSync(resolve(evidence, 'c003-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `C003 browser acceptance passed: ${summary.visual.length} visual comparisons, ` +
      `${summary.interactions.length} interaction checks. Evidence: ${evidence}`,
  );
} catch (error) {
  writeFileSync(resolve(evidence, 'c003-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`C003 evidence directory: ${evidence}`);
  throw error;
} finally {
  await server.close();
  await browser.close();
}
