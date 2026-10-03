import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startReferenceServer } from '../f010/reference-server.mjs';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import {
  comparePixels,
  compareSnapshots,
  contract,
  newContext,
  openCandidate,
  openReference,
  referenceStorageFor,
  settle,
  snapshot,
} from '../c004/parity-harness.mjs';

const origin = process.env.C012_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C012_EVIDENCE_DIR
  ? resolve(process.env.C012_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c012-'));
mkdirSync(evidence, { recursive: true });
const NEXT = '.primary-next',
  CHOICES = '#paymentMethod';
const method = (id) => `input[name="paymentMethod"][value="${id}"]`;
const SELECTORS = [
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
  '.pay-hero',
  '.pay-hero small',
  '.pay-hero strong',
  '.pay-hero p',
  '.pay-hero-art',
  '.pay-choices',
  '.pay-option',
  '.pay-option-row',
  '.pay-logo',
  '.pay-option-text strong',
  '.pay-option-text p',
  '.pay-tick',
  '.pay-selected-note',
  '.main .error',
  '.pay-safe',
  '.pay-how',
  '.pay-how summary',
  '.pay-proof-note',
  '.booking-footer',
  '.footer-assurance span',
  '.booking-total',
  '.booking-total strong',
  '.primary-next',
  'dialog.sheet[open]',
];
const GUARD = 350;
async function guard(page) {
  const start = await page.evaluate(() => performance.now());
  await page.waitForFunction(({ start, guard }) => performance.now() - start >= guard, {
    start,
    guard: GUARD,
  });
}
async function next(page, ref) {
  if (ref) await guard(page);
  await page.locator(NEXT).click();
}
const choose = (id) => (page) => page.locator(method(id)).check();
const openFees = (page) => page.locator('.pay-how summary').click();

async function openPair(context, server, scenario) {
  const state = initialSessionState('#/book/5?scenario=' + scenario);
  const storage = referenceStorageFor(state, { screen: 'booking', step: 5 });
  storage.cars = state.vehicles.map((v) => ({ ...v }));
  storage.addresses = state.addresses.map((a) => ({ ...a }));
  storage.draft.carId = state.draft.carId;
  storage.draft.place = state.draft.place ? { ...state.draft.place } : null;
  storage.draft.saveAddress = state.draft.saveAddress;
  storage.draft.date = state.draft.scheduleDay ?? '';
  storage.draft.time = state.draft.slot?.time ?? null;
  const reference = await openReference(context, server, storage, '#book/5');
  await reference.page.locator(CHOICES).waitFor();
  const candidate = await openCandidate(context, origin, '/book/5?scenario=' + scenario, CHOICES);
  await candidate.page.locator('.booking-footer').waitFor();
  return { reference, candidate };
}
function observe(page) {
  return page.evaluate(() => {
    const d = document,
      clean = (v) => (v ?? '').replace(/\s+/g, ' ').trim(),
      text = (s) => clean(d.querySelector(s)?.textContent);
    const checked = d.querySelector('input[name="paymentMethod"]:checked'),
      active = d.activeElement;
    return {
      route: location.hash.replace('#/', '#').split('?')[0],
      heading: text('.main h1'),
      total: text('.pay-hero strong'),
      selected: checked?.value ?? null,
      selectedNote: text('.pay-selected-note') || null,
      error: text('#error-paymentMethod') || null,
      feesOpen: d.querySelector('.pay-how')?.open ?? null,
      footerPrice: text('#footer-price'),
      footerDuration: text('.footer-assurance span:last-child'),
      nextLabel: text('.primary-next'),
      focused: active?.matches('#paymentMethod,input[name="paymentMethod"],.pay-how summary')
        ? active.id || active.getAttribute('value') || active.tagName
        : null,
    };
  });
}
const visuals = [
  { id: 'payment-empty', scenario: 'booking-payment-empty' },
  { id: 'payment-cash', scenario: 'booking-payment-cash' },
  { id: 'payment-sham', scenario: 'booking-payment-sham' },
  { id: 'payment-syriatel', scenario: 'booking-payment-syriatel' },
  {
    id: 'payment-error',
    scenario: 'booking-payment-empty',
    prepare: async (page, ref) => {
      await next(page, ref);
      await page.locator('#error-paymentMethod').waitFor();
      await page.waitForFunction(() => document.activeElement?.id === 'paymentMethod');
    },
  },
  {
    id: 'payment-fees-open',
    scenario: 'booking-payment-sham',
    prepare: async (page) => {
      await openFees(page);
      await page.locator('.pay-how[open]').waitFor();
    },
  },
];
const shorts = [
  { ...visuals[0], id: 'short-payment-empty' },
  { ...visuals[2], id: 'short-payment-sham' },
];
const summary = { evidence, visual: [], interactions: [] };
async function compareVisual(browser, server, v, width, height) {
  const label = v.id + '@' + width,
    context = await newContext(browser, width, height ? { height } : {});
  try {
    const { reference, candidate } = await openPair(context, server, v.scenario);
    if (v.prepare) {
      await v.prepare(reference.page, true);
      await v.prepare(candidate.page, false);
    }
    await settle(reference.page);
    await settle(candidate.page);
    const a = await snapshot(reference.page, SELECTORS),
      b = await snapshot(candidate.page, SELECTORS);
    assert.equal(b.lang, 'ar');
    assert.equal(b.dir, 'rtl');
    assert.ok(b.scrollWidth - b.innerWidth <= 0, label + ': overflow');
    compareSnapshots(a, b, SELECTORS, label);
    assert.deepEqual(
      await observe(candidate.page),
      await observe(reference.page),
      label + ': state',
    );
    const pixels = await comparePixels(browser, reference.page, candidate.page, evidence, label);
    summary.visual.push({ state: v.id, width, height: height ?? contract.height, ...pixels });
    assert.deepEqual(reference.problems, []);
    assert.deepEqual(candidate.problems, []);
  } finally {
    await context.close();
  }
}
async function steps(reference, candidate, name, list) {
  for (const [i, run] of list.entries()) {
    await run(reference.page, true);
    await run(candidate.page, false);
    await settle(reference.page);
    await settle(candidate.page);
    assert.deepEqual(
      await observe(candidate.page),
      await observe(reference.page),
      name + ': ' + (i + 1),
    );
  }
  summary.interactions.push({ name });
}
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] }),
  server = await startReferenceServer();
const save = () =>
  writeFileSync(resolve(evidence, 'c012-summary.json'), JSON.stringify(summary, null, 2) + '\n');
try {
  for (const v of visuals)
    for (const width of contract.viewports) await compareVisual(browser, server, v, width);
  for (const v of shorts) await compareVisual(browser, server, v, 390, 560);
  save();
  for (const item of [
    {
      name: 'switch all approved methods',
      scenario: 'booking-payment-empty',
      list: [choose('cash'), choose('sham'), choose('syriatel'), choose('cash')],
    },
    {
      name: 'validation clears after a choice',
      scenario: 'booking-payment-empty',
      list: [
        async (p, r) => {
          await next(p, r);
          await p.locator('#error-paymentMethod').waitFor();
        },
        choose('sham'),
      ],
    },
    {
      name: 'amount and fees disclosure toggles',
      scenario: 'booking-payment-syriatel',
      list: [openFees, openFees, openFees],
    },
  ]) {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, item.scenario);
      await steps(reference, candidate, item.name, item.list);
      assert.deepEqual(reference.problems, []);
      assert.deepEqual(candidate.problems, []);
    } finally {
      await context.close();
    }
  }
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, 'booking-payment-cash');
      await next(reference.page, true);
      await next(candidate.page, false);
      await reference.page.waitForURL(/#book[/]6$/);
      await candidate.page.waitForURL(/#\/book\/6$/);
      summary.interactions.push({ name: 'valid Next reaches Review without confirmation' });
    } finally {
      await context.close();
    }
  }
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openPair(context, server, 'booking-payment-sham');
      await candidate.page.getByRole('button', { name: 'الخطوة السابقة' }).click();
      await candidate.page.waitForURL(/#\/book\/4$/);
      await candidate.page.goForward();
      await candidate.page.waitForURL(/#\/book\/5/);
      assert.equal(await candidate.page.locator(method('sham')).isChecked(), true);
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'Back/Forward preserves choice' });
    } finally {
      await context.close();
    }
  }
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openPair(context, server, 'booking-payment-empty');
      await candidate.page.locator(method('cash')).focus();
      await candidate.page.keyboard.press('ArrowDown');
      assert.ok(
        ['sham', 'syriatel'].includes(
          await candidate.page.locator('input[name="paymentMethod"]:checked').inputValue(),
        ),
      );
      assert.equal(await candidate.page.locator('.pay-option:has(input:focus-visible)').count(), 1);
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'native radio keyboard selection' });
    } finally {
      await context.close();
    }
  }
  {
    const context = await newContext(browser, 390);
    try {
      const { candidate } = await openPair(context, server, 'booking-payment-empty');
      const quote = await candidate.page.locator('.pay-hero strong').innerText();
      for (const id of ['cash', 'sham', 'syriatel']) {
        await candidate.page.locator(method(id)).check();
        assert.equal(await candidate.page.locator('.pay-hero strong').innerText(), quote);
      }
      const state = await candidate.page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
        cookies: document.cookie,
        qr: document.querySelectorAll('.qr-button,img[src^="data:image"]').length,
      }));
      assert.deepEqual(state, { local: 0, session: 0, cookies: '', qr: 0 });
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'no storage, QR or payment request' });
    } finally {
      await context.close();
    }
  }
  save();
  console.log(
    'C012 browser acceptance passed: ' +
      summary.visual.length +
      ' visual comparisons, ' +
      summary.interactions.length +
      ' interaction checks. Evidence: ' +
      evidence,
  );
} finally {
  save();
  await server.close();
  await browser.close();
}
