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
  const start = await page.evaluate(() => globalThis.performance.now());
  await page.waitForFunction(({ start, guard }) => globalThis.performance.now() - start >= guard, {
    start,
    guard: GUARD,
  });
}
async function next(page, ref) {
  if (ref) await guard(page);
  await page.locator(NEXT).click();
}
/** The customer's action: tap the option card; the native radio inside it becomes checked. */
const choose = (id) => async (page) => {
  await page.locator('[data-pay-option="' + id + '"]').click();
  await page.waitForFunction(
    (value) =>
      globalThis.document.querySelector('input[name="paymentMethod"]:checked')?.value === value,
    id,
  );
};
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
/** Opens both pages at a booking step (or Home when step is null) with one scenario state. */
async function openAt(context, server, scenario, step, readyRef, readyCandidate) {
  const state = initialSessionState('#/?scenario=' + scenario);
  const storage = referenceStorageFor(
    state,
    step === null ? { screen: 'home', step: 0 } : { screen: 'booking', step },
  );
  storage.cars = state.vehicles.map((v) => ({ ...v }));
  storage.addresses = state.addresses.map((a) => ({ ...a }));
  storage.draft.carId = state.draft.carId;
  storage.draft.place = state.draft.place ? { ...state.draft.place } : null;
  storage.draft.saveAddress = state.draft.saveAddress;
  storage.draft.date = state.draft.scheduleDay ?? '';
  storage.draft.time = state.draft.slot?.time ?? null;
  const hash = step === null ? '#home' : '#book/' + step;
  const path = (step === null ? '/' : '/book/' + step) + '?scenario=' + scenario;
  const reference = await openReference(context, server, storage, hash);
  await reference.page.locator(readyRef).first().waitFor();
  const candidate = await openCandidate(context, origin, path, readyCandidate);
  return { reference, candidate };
}
const route = (page) => new URL(page.url()).hash.replace('#/', '#').split('?')[0];
const contactValues = (page) =>
  page.evaluate(() => ({
    name: globalThis.document.querySelector('#name')?.value ?? null,
    phone: globalThis.document.querySelector('#phone')?.value ?? null,
    note: globalThis.document.querySelector('#note')?.value ?? null,
  }));
/** Session-visible side effects a payment choice must never cause. */
const sideEffects = (page) =>
  page.evaluate(() => ({
    local: globalThis.localStorage.length,
    session: globalThis.sessionStorage.length,
    cookies: globalThis.document.cookie,
    qr: globalThis.document.querySelectorAll('.qr-button,img[src^="data:image"],canvas').length,
  }));
function observe(page) {
  return page.evaluate(() => {
    const d = globalThis.document,
      clean = (v) => (v ?? '').replace(/\s+/g, ' ').trim(),
      text = (s) => clean(d.querySelector(s)?.textContent);
    const checked = d.querySelector('input[name="paymentMethod"]:checked'),
      active = d.activeElement;
    return {
      route: globalThis.location.hash.replace('#/', '#').split('?')[0],
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
      await page.waitForFunction(() => globalThis.document.activeElement?.id === 'paymentMethod');
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
  // Header Back is an in-app action: it pushes Contact (it is not history.back()),
  // so it is followed by Contact Next, never by a browser Forward.
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, 'booking-payment-sham');
      const contact = [];
      for (const [page, isReference] of [
        [reference.page, true],
        [candidate.page, false],
      ]) {
        await page.getByRole('button', { name: 'الخطوة السابقة' }).click();
        await page.locator('#name').waitFor();
        assert.equal(route(page), '#book/4');
        contact.push(await contactValues(page));
        await next(page, isReference);
        await page.locator(CHOICES).waitFor();
      }
      assert.deepEqual(contact[1], contact[0], 'Contact values after header Back');
      assert.notEqual(contact[1].name, '', 'the prefilled name is intact');
      assert.deepEqual(await observe(candidate.page), await observe(reference.page));
      assert.equal(await candidate.page.locator(method('sham')).isChecked(), true);
      assert.deepEqual(reference.problems, []);
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({
        name: 'header Back to Contact, then Contact Next keeps the choice',
      });
    } finally {
      await context.close();
    }
  }
  // Genuine browser history: Contact Next pushes Payment; Back and Forward move
  // between the two entries without losing the contact values or the choice.
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openAt(
        context,
        server,
        'booking-contact-prefilled',
        4,
        '#name',
        '#name',
      );
      const contact = [];
      for (const [page, isReference] of [
        [reference.page, true],
        [candidate.page, false],
      ]) {
        contact.push(await contactValues(page));
        await next(page, isReference);
        await page.locator(CHOICES).waitFor();
        await choose('syriatel')(page);
        await page.goBack();
        await page.locator('#name').waitFor();
        assert.equal(route(page), '#book/4');
        assert.deepEqual(await contactValues(page), contact.at(-1), 'browser Back keeps Contact');
        await page.goForward();
        await page.locator(CHOICES).waitFor();
        assert.equal(route(page), '#book/5');
      }
      assert.deepEqual(contact[1], contact[0]);
      assert.deepEqual(await observe(candidate.page), await observe(reference.page));
      assert.equal(await candidate.page.locator(method('syriatel')).isChecked(), true);
      assert.deepEqual(reference.problems, []);
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'browser Back/Forward between Contact and Payment' });
    } finally {
      await context.close();
    }
  }
  // The public journey: Home through every implemented step into Payment and on.
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openAt(
        context,
        server,
        'home-empty',
        null,
        '.hero-cta',
        '.hero-cta',
      );
      for (const [page, isReference] of [
        [reference.page, true],
        [candidate.page, false],
      ]) {
        await page.locator('.hero-cta').click();
        await page.locator('.signature-car').first().waitFor();
        await next(page, isReference);
        await page.locator('.service-option').first().waitFor();
        await next(page, isReference);
        await page.locator('.location-picker').waitFor();
        await page.locator('.place-shortcut[data-kind="work"]').click();
        await page.locator('.place-shortcut[data-kind="work"].selected').waitFor();
        await next(page, isReference);
        await page.locator('.dates').waitFor();
        await page.locator('.earliest').click();
        await next(page, isReference);
        await page.locator('#name').waitFor();
        await page.locator('.row.between .text-btn').click();
        await page.waitForFunction(() => globalThis.document.querySelector('#phone')?.value !== '');
        await next(page, isReference);
        await page.locator(CHOICES).waitFor();
      }
      assert.deepEqual(await observe(candidate.page), await observe(reference.page), 'journey');
      assert.equal(await candidate.page.locator('input[name="paymentMethod"]:checked').count(), 0);
      for (const [page, isReference] of [
        [reference.page, true],
        [candidate.page, false],
      ]) {
        await next(page, isReference);
        await page.locator('#error-paymentMethod').waitFor();
        await choose('cash')(page);
        await next(page, isReference);
        await page.waitForURL(isReference ? /#book[/]6$/ : /#[/]book[/]6$/);
      }
      assert.deepEqual(await sideEffects(candidate.page), {
        local: 0,
        session: 0,
        cookies: '',
        qr: 0,
      });
      assert.deepEqual(reference.problems, []);
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'public journey from Home through Payment to Review' });
    } finally {
      await context.close();
    }
  }
  // Price details from the Payment footer: the same content as the prototype's sheet.
  {
    const context = await newContext(browser, 390);
    try {
      const { reference, candidate } = await openPair(context, server, 'booking-payment-sham');
      const sheetText = [];
      for (const page of [reference.page, candidate.page]) {
        await page.locator('.booking-total').click();
        await page.locator('dialog.sheet[open]').waitFor();
        sheetText.push(
          (await page.locator('dialog.sheet[open]').innerText()).replace(/\s+/g, ' ').trim(),
        );
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !globalThis.document.querySelector('dialog.sheet[open]'));
      }
      assert.equal(sheetText[1], sheetText[0], 'price details');
      assert.deepEqual(await observe(candidate.page), await observe(reference.page));
      assert.deepEqual(reference.problems, []);
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'price details sheet opens and closes on Payment' });
    } finally {
      await context.close();
    }
  }
  // Direct links and reloads cannot skip a missing prerequisite (fixed clock). A
  // corrected entry replaces the link, so a reload starts a new in-memory session
  // at that route and is guarded again (the session is never persisted).
  for (const [path, destination, ready, reloaded, reloadReady] of [
    ['/book/5?scenario=home-empty', 2, '.location-picker', 2, '.location-picker'],
    ['/book/5?scenario=booking-vehicle-invalid-plate', 0, '.signature-car', 0, '.signature-car'],
    ['/book/5?scenario=booking-time-ready', 3, '.dates', 3, '.dates'],
    ['/book/5?scenario=booking-contact-prefilled', 5, CHOICES, 5, CHOICES],
    ['/book/6?scenario=booking-payment-empty', 5, CHOICES, 2, '.location-picker'],
  ]) {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(context, origin, path, ready);
      assert.equal(new URL(page.url()).hash.split('?')[0], '#/book/' + destination, path);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator(reloadReady).first().waitFor();
      assert.equal(new URL(page.url()).hash.split('?')[0], '#/book/' + reloaded, path + ' reload');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'direct entry ' + path + ' reaches step ' + destination });
    } finally {
      await context.close();
    }
  }
  // A later clock: the fixture's appointment is no longer offered, so a chosen
  // method never carries it forward into Payment or Review.
  for (const path of [
    '/book/5?scenario=booking-payment-cash',
    '/book/6?scenario=booking-payment-cash',
  ]) {
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
      const { page, problems } = await openCandidate(context, origin, path, '.dates');
      assert.equal(new URL(page.url()).hash, '#/book/3', path);
      assert.equal(await page.locator(CHOICES).count(), 0);
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'expired appointment: ' + path + ' returns to Time' });
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
      // The radio group is one Tab stop; the next stop is the fees disclosure, which
      // Enter toggles natively.
      await candidate.page.keyboard.press('Tab');
      assert.equal(
        await candidate.page.evaluate(() =>
          globalThis.document.activeElement?.matches('.pay-how summary'),
        ),
        true,
      );
      await candidate.page.keyboard.press('Enter');
      assert.equal(await candidate.page.locator('.pay-how').evaluate((node) => node.open), true);
      await candidate.page.keyboard.press('Enter');
      assert.equal(await candidate.page.locator('.pay-how').evaluate((node) => node.open), false);
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
      const footer = await candidate.page.locator('#footer-price').innerText();
      // The initial loopback asset requests are the page load; a choice adds none.
      const loaded = candidate.requests.length;
      for (const id of ['cash', 'sham', 'syriatel']) {
        await choose(id)(candidate.page);
        assert.equal(await candidate.page.locator('.pay-hero strong').innerText(), quote);
        assert.equal(await candidate.page.locator('#footer-price').innerText(), footer);
      }
      await candidate.page.waitForTimeout(250);
      assert.deepEqual(candidate.requests.slice(loaded), [], 'no request after the page load');
      assert.deepEqual(await sideEffects(candidate.page), {
        local: 0,
        session: 0,
        cookies: '',
        qr: 0,
      });
      assert.deepEqual(candidate.problems, []);
      summary.interactions.push({ name: 'no storage, QR or payment request' });
    } finally {
      await context.close();
    }
  }
  {
    const context = await newContext(browser, 390, { reducedMotion: 'no-preference' });
    try {
      const { reference, candidate } = await openPair(context, server, 'booking-payment-empty');
      await steps(reference, candidate, 'selection with motion allowed', [
        choose('sham'),
        (page) => page.waitForTimeout(450),
      ]);
      assert.deepEqual(reference.problems, []);
      assert.deepEqual(candidate.problems, []);
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
