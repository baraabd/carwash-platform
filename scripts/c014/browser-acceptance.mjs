// C014 browser acceptance: explicit demo confirmation on Review, one session order,
// and the handoff on the existing /order/:id and /pay/:id routes.
//
// DECLARED DIFFERENCES (fixed before any comparison runs; see
// docs/customer/C014_BOOKING_CONFIRMATION.md):
//
//   1. Ids: the reference's uid() is time+random (`WG-<base36>-<3>`); the candidate's
//      is a session sequence (`WG-SESSION-<n>`). Shapes and referential use are
//      compared, never the values.
//   2. The success notice: the reference (storage refused, its session-only state)
//      says «تم إنشاء الطلب لهذه الجلسة. التخزين المحلي غير متاح.»; the candidate
//      says «تم إنشاء الطلب لهذه الجلسة. لا حجز فعلي ولا دفع.», plus a visible
//      capacity warning when a save was skipped.
//   3. After confirmation the reference renders its full tracking (cash) or
//      checkout/QR (wallet) screen; the candidate renders the C014 handoff only.
//      Those screens are NOT compared; the handoff is recorded candidate-only.
//   4. Review copy and the wallet label are compared by scripts/c013 (declared there).
//
// Compared with the reference: the destination kind, the order count and active-
// order banner on Home, the reset draft (no resume card), the greeting from the
// confirmed profile, and the garage / address-book effects of the save preferences.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startReferenceServer } from '../f010/reference-server.mjs';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import {
  contract,
  newContext,
  openCandidate,
  openReference,
  referenceStorageFor,
  screenshotOptions,
  settle,
  watchPage,
} from '../c004/parity-harness.mjs';
import { withFailureEvidence } from '../c011/contact-input-helpers.mjs';

const origin = process.env.C014_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C014_EVIDENCE_DIR
  ? resolve(process.env.C014_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c014-'));
mkdirSync(evidence, { recursive: true });

const REFERENCE_NOTICE = 'تم إنشاء الطلب لهذه الجلسة. التخزين المحلي غير متاح.';
const CANDIDATE_NOTICE = 'تم إنشاء الطلب لهذه الجلسة. لا حجز فعلي ولا دفع.';
const REFERENCE_ID = /^WG-[0-9A-Z]+-[0-9A-Z]{1,3}$/;
const CANDIDATE_ID = /^WG-SESSION-\d+$/;
const NEXT = '.primary-next';
const STEP_READY = [
  '.signature-car',
  '.service-option',
  '.location-picker',
  '.dates',
  '#name',
  '#paymentMethod',
  '.receipt',
];

const summary = {
  evidence,
  origin,
  source: { head: process.env.GITHUB_SHA ?? process.env.C014_SOURCE_SHA ?? 'local' },
  declaredDifferences: {
    ids: { reference: String(REFERENCE_ID), candidate: String(CANDIDATE_ID) },
    notice: { reference: REFERENCE_NOTICE, candidate: CANDIDATE_NOTICE },
    destinationScreens: 'reference tracking/checkout not compared; candidate handoff only',
  },
  transitions: [],
  handoffVisual: [],
  interactions: [],
};
const save = () =>
  writeFileSync(resolve(evidence, 'c014-summary.json'), JSON.stringify(summary, null, 2) + '\n');

// ------------------------------------------------------------------ helpers

const GUARD = 350;
/** The prototype ignores a Next within 350 ms of the previous accepted one. */
async function guard(page) {
  const start = await page.evaluate(() => globalThis.performance.now());
  await page.waitForFunction(({ start, guard }) => globalThis.performance.now() - start >= guard, {
    start,
    guard: GUARD,
  });
}
async function next(page, isReference) {
  if (isReference) await guard(page);
  await page.locator(NEXT).click();
}
const hashOf = (page) => page.evaluate(() => globalThis.location.hash);
/** `#order/<id>` or `#/order/<id>` → { kind, id }; anything else → { kind: route }. */
function destination(hash) {
  const match = /^#\/?(order|pay)\/([^?]+)$/.exec(hash);
  return match
    ? { kind: match[1], id: decodeURIComponent(match[2]) }
    : { kind: hash.replace('#/', '#') };
}
async function atStep(page, step) {
  await page.waitForFunction(
    (wanted) => globalThis.location.hash.replace('#/', '#').split('?')[0] === wanted,
    '#book/' + step,
  );
  await page.locator(STEP_READY[step]).first().waitFor();
}
/** Waits for the route to leave Review for an order destination. */
async function confirmed(page) {
  await page.waitForFunction(() => /^#\/?(order|pay)\//.test(globalThis.location.hash));
  return destination(await hashOf(page));
}
/** In-app hash navigation (keeps the in-memory session; no reload). */
async function goHash(page, hash, ready) {
  await page.evaluate((target) => {
    globalThis.location.hash = target;
  }, hash);
  await page.locator(ready).first().waitFor();
  await settle(page);
}
const goHome = (page, isReference) => goHash(page, isReference ? '#home' : '#/', '.hero-cta');

/** What Home shows about orders and the draft; the same markup in both apps. */
const homeState = (page) =>
  page.evaluate(() => {
    const d = globalThis.document,
      clean = (v) => (v ?? '').replace(/\s+/g, ' ').trim();
    return {
      resume: [...d.querySelectorAll('.resume .grow')].map((n) => clean(n.textContent)),
      repeat: d.querySelectorAll('.quick-return').length,
      dot: clean(d.querySelector('.nav-dot')?.textContent) || null,
      greeting: clean(d.querySelector('.hero-copy p')?.textContent),
    };
  });
const garageState = (page) =>
  page.evaluate(() =>
    [...globalThis.document.querySelectorAll('.garage-card h3')].map((n) => n.textContent.trim()),
  );
const toastText = (page) =>
  page.evaluate(() => (globalThis.document.querySelector('.toast')?.textContent ?? '').trim());
const sideEffects = (page) =>
  page.evaluate(() => ({
    session: globalThis.sessionStorage.length,
    local: globalThis.localStorage.length,
    cookies: globalThis.document.cookie,
    media: globalThis.document.querySelectorAll('img[src^="data:"],canvas,.qr-button').length,
  }));

async function openPair(context, server, scenario, step) {
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
  storage.draft.saveVehicle = state.draft.saveVehicle;
  storage.draft.date = state.draft.scheduleDay ?? '';
  storage.draft.time = state.draft.slot?.time ?? null;
  const hash = step === null ? '#home' : '#book/' + step;
  const path = (step === null ? '/' : '/book/' + step) + '?scenario=' + scenario;
  const ready = step === null ? '.hero-cta' : STEP_READY[step];
  const reference = await openReference(context, server, storage, hash);
  await reference.page.locator(ready).first().waitFor();
  const candidate = await openCandidate(context, origin, path, ready);
  return { reference, candidate };
}

function assertClean(pair, label) {
  assert.deepEqual(pair.reference.problems, [], label + ': reference problems');
  assert.deepEqual(pair.candidate.problems, [], label + ': candidate problems');
}

async function keepFailure(pages, label) {
  for (const [side, page] of pages) {
    writeFileSync(
      resolve(evidence, `${label}.failure.${side}.png`),
      await page.screenshot({ fullPage: true }),
    );
  }
}

// ------------------------------------------------------------------------ run

const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const server = await startReferenceServer();
try {
  // 1. Confirmation transitions against the reference, up to the owned boundary.
  for (const [scenario, kind] of [
    ['booking-review-cash', 'order'],
    ['booking-review-sham', 'pay'],
    ['booking-review-syriatel', 'pay'],
    ['booking-review-full', 'order'],
    ['booking-review-collections-full', 'order'],
  ]) {
    const label = 'transition ' + scenario;
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, scenario, 6);
      await withFailureEvidence(
        async () => {
          const loaded = pair.candidate.requests.length;
          await next(pair.reference.page, true);
          await next(pair.candidate.page, false);
          const ref = await confirmed(pair.reference.page);
          const cand = await confirmed(pair.candidate.page);
          assert.equal(ref.kind, kind, label + ': reference destination');
          assert.equal(cand.kind, ref.kind, label + ': same destination kind');
          assert.match(ref.id, REFERENCE_ID);
          assert.match(cand.id, CANDIDATE_ID);
          await pair.candidate.page.locator('.order-handoff').waitFor();
          assert.equal(
            await pair.candidate.page.locator('.order-handoff').getAttribute('data-order-state'),
            'session-confirmed',
          );
          assert.ok(
            (await pair.candidate.page.locator('.order-reference').innerText()).includes(cand.id),
            label + ': the handoff shows the created order',
          );
          assert.equal(await toastText(pair.reference.page), REFERENCE_NOTICE);
          const notice = await toastText(pair.candidate.page);
          assert.ok(notice.startsWith(CANDIDATE_NOTICE), label + ': candidate notice');
          if (scenario === 'booking-review-collections-full') {
            assert.ok(notice.includes('وصلت إلى حد 30 سيارة'), 'garage capacity is told');
            assert.ok(notice.includes('وصلت إلى حد 20 عنوانًا'), 'address capacity is told');
          } else {
            assert.equal(notice, CANDIDATE_NOTICE);
          }
          // Browser Back leaves the replaced Review entry behind: no resubmission.
          // Home: one stage-0 order, no draft to continue, greeting from the profile.
          await goHome(pair.reference.page, true);
          await goHome(pair.candidate.page, false);
          const homes = [
            await homeState(pair.reference.page),
            await homeState(pair.candidate.page),
          ];
          assert.deepEqual(homes[1], homes[0], label + ': Home after confirmation');
          assert.equal(homes[1].dot, '1');
          assert.equal(homes[1].resume.length, 1, 'the active order only; the draft was reset');
          // Save preferences: the same garage on both.
          await goHash(pair.reference.page, '#garage', '.main h1');
          await goHash(pair.candidate.page, '#/garage', '.main h1');
          assert.deepEqual(
            await garageState(pair.candidate.page),
            await garageState(pair.reference.page),
            label + ': garage',
          );
          // The address book count as Account shows it.
          await goHash(pair.reference.page, '#account', '.main h1');
          await goHash(pair.candidate.page, '#/account', '.main h1');
          const addresses = (page) =>
            page.evaluate(
              () => /(\d+) عناوين محفوظة/.exec(globalThis.document.body.innerText)?.[1] ?? null,
            );
          assert.equal(
            await addresses(pair.candidate.page),
            await addresses(pair.reference.page),
            label + ': address book',
          );
          assert.deepEqual(pair.candidate.requests.slice(loaded), [], label + ': no request');
          assert.deepEqual(await sideEffects(pair.candidate.page), {
            session: 0,
            local: 0,
            cookies: '',
            media: 0,
          });
          assertClean(pair, label);
          summary.transitions.push({
            scenario,
            kind,
            reference: ref.id,
            candidate: cand.id,
            home: homes[1],
          });
        },
        () =>
          keepFailure(
            [
              ['reference', pair.reference.page],
              ['candidate', pair.candidate.page],
            ],
            label,
          ),
      );
    } finally {
      await context.close();
    }
  }
  save();

  // 2. The public journey on both: Home → seven decisions → confirm (cash).
  {
    const label = 'public journey';
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'home-empty', null);
      for (const [page, isReference] of [
        [pair.reference.page, true],
        [pair.candidate.page, false],
      ]) {
        await page.locator('.hero-cta').click();
        await atStep(page, 0);
        await next(page, isReference);
        await atStep(page, 1);
        await next(page, isReference);
        await atStep(page, 2);
        await page.locator('.place-shortcut[data-kind="work"]').click();
        await next(page, isReference);
        await atStep(page, 3);
        await page.locator('.earliest').click();
        await next(page, isReference);
        await atStep(page, 4);
        await page.locator('.row.between .text-btn').click();
        await page.waitForFunction(() => globalThis.document.querySelector('#phone')?.value);
        await next(page, isReference);
        await atStep(page, 5);
        await page.locator('[data-pay-option="cash"]').click();
        await next(page, isReference);
        await atStep(page, 6);
        await next(page, isReference);
      }
      const ref = await confirmed(pair.reference.page);
      const cand = await confirmed(pair.candidate.page);
      assert.equal(cand.kind, ref.kind);
      await goHome(pair.reference.page, true);
      await goHome(pair.candidate.page, false);
      assert.deepEqual(
        await homeState(pair.candidate.page),
        await homeState(pair.reference.page),
        label,
      );
      assertClean(pair, label);
      summary.interactions.push({ name: 'public journey Home → seven decisions → confirm' });
    } finally {
      await context.close();
    }
  }
  save();

  // 3. Candidate-only: every method from the public journey, with an edit first.
  for (const method of ['cash', 'sham', 'syriatel']) {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/6?scenario=booking-review-full',
        '.receipt',
      );
      await page.getByRole('button', { name: 'تعديل طريقة الدفع', exact: true }).click();
      await atStep(page, 5);
      await page.locator(`[data-pay-option="${method}"]`).click();
      await next(page, false);
      await atStep(page, 6);
      await page.getByRole('button', { name: 'تعديل العناية والإضافات', exact: true }).click();
      await atStep(page, 1);
      await page.locator('label.service-option:has(input[value="complete"])').click();
      await next(page, false);
      await atStep(page, 6);
      const total = (await page.locator('#footer-price').innerText()).trim();
      await next(page, false);
      const where = await confirmed(page);
      assert.equal(where.kind, method === 'cash' ? 'order' : 'pay');
      await page.locator('.order-handoff').waitFor();
      assert.equal(
        (await page.locator('.order-amount').innerText()).trim(),
        total,
        'the recorded amount is the reviewed total',
      );
      assert.ok((await page.locator('.receipt').innerText()).includes('نظافة متكاملة'));
      const status = await page.locator('.order-status strong').first().innerText();
      assert.equal(status.trim(), method === 'cash' ? 'كاش بعد الغسيل' : 'بانتظار التحويل');
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.matches('#main h1')),
        true,
        'route entry focuses the handoff heading',
      );
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: `edits then confirm: ${method}` });
    } finally {
      await context.close();
    }
  }

  // 4. Replay: rapid double activation by mouse and by keyboard create one order.
  for (const how of ['dblclick', 'keyboard']) {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/6?scenario=booking-review-cash',
        '.receipt',
      );
      if (how === 'dblclick') {
        await page.locator(NEXT).dblclick();
      } else {
        await page.locator(NEXT).focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
      }
      const where = await confirmed(page);
      assert.equal(where.id, 'WG-SESSION-1');
      await goHome(page, false);
      assert.equal((await homeState(page)).dot, '1', how + ': one order');
      // A new, identical booking later is a second order, by intent.
      await page.locator('.hero-cta').click();
      await atStep(page, 0);
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'replay protection: ' + how });
    } finally {
      await context.close();
    }
  }

  // 5. History: Back never resubmits; Forward shows the same order; reload and an
  //    unknown id show the explicit fallback (the session is in memory only).
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/5?scenario=booking-payment-cash',
        '#paymentMethod',
      );
      await next(page, false);
      await atStep(page, 6);
      await next(page, false);
      const where = await confirmed(page);
      await page.locator('.order-handoff').waitFor();
      await page.goBack();
      // Review was replaced: Back goes to Payment, whose guard sees the reset draft.
      await page.waitForFunction(() => /^#\/book\/2/.test(globalThis.location.hash));
      await page.locator('.location-picker').waitFor();
      await page.goForward();
      await page.waitForFunction((id) => globalThis.location.hash === '#/order/' + id, where.id);
      await page.locator('.order-handoff[data-order-state="session-confirmed"]').waitFor();
      await goHome(page, false);
      assert.equal((await homeState(page)).dot, '1', 'history created no second order');
      await page.goto(`${origin}/#/order/${where.id}`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.order-handoff[data-order-state="not-found"]').waitFor();
      await page.goto(`${origin}/#/pay/WG-NOPE`, { waitUntil: 'networkidle' });
      await page.locator('.order-handoff[data-order-state="not-found"]').waitFor();
      await page.getByRole('button', { name: 'العودة إلى الرئيسية' }).click();
      await page.locator('.hero-cta').waitFor();
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'history, reload and unknown id' });
    } finally {
      await context.close();
    }
  }

  // 6. An appointment that expired while Review was open: refused to Time, no order.
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: contract.height },
      deviceScaleFactor: contract.deviceScaleFactor,
      locale: contract.locale,
      timezoneId: contract.timezoneId,
      reducedMotion: contract.reducedMotion,
    });
    try {
      await context.addInitScript((initial) => {
        const NativeDate = globalThis.Date;
        let fixed = initial;
        class TestDate extends NativeDate {
          constructor(...args) {
            super(...(args.length ? args : [fixed]));
          }
          static now() {
            return new NativeDate(fixed).getTime();
          }
        }
        globalThis.Date = TestDate;
        // Test-only seam of this browser context; it does not exist in the app.
        globalThis.__c014SetNow = (iso) => {
          fixed = iso;
        };
      }, contract.fixedTime);
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/6?scenario=booking-review-cash',
        '.receipt',
      );
      await page.evaluate(() => globalThis.__c014SetNow('2026-09-21T06:15:00.000Z'));
      await next(page, false);
      await atStep(page, 3);
      assert.equal(await toastText(page), 'اختر موعدًا متاحًا، أو استخدم أقرب موعد.');
      await page.locator('.earliest').click();
      await next(page, false);
      await atStep(page, 4);
      await goHome(page, false);
      assert.equal((await homeState(page)).dot, null, 'no order from a refusal');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'expired appointment refused to Time' });
    } finally {
      await context.close();
    }
  }

  // 7. The price sheet closes (and unlocks) before confirming; the handoff scrolls.
  {
    const context = await newContext(browser, 390, { height: 560 });
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/6?scenario=booking-review-full',
        '.receipt',
      );
      await page.locator('.booking-total').click();
      await page.locator('dialog.sheet[open]').waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => globalThis.document.body.style.overflow === '');
      await next(page, false);
      await confirmed(page);
      await page.locator('.order-handoff').waitFor();
      await page.mouse.move(195, 300);
      await page.mouse.wheel(0, 400);
      await page.waitForFunction(() => globalThis.scrollY > 0);
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'price sheet closed, then confirm; handoff scrolls' });
    } finally {
      await context.close();
    }
  }
  save();

  // 8. Handoff screens: candidate-only full-page records at every width (no
  //    reference counterpart; not a parity claim), no horizontal overflow.
  const sizes = [
    ...contract.viewports.map((width) => ({ width })),
    { width: 390, height: 560 },
    { width: 320, height: 560 },
  ];
  for (const scenario of ['booking-review-cash', 'booking-review-syriatel']) {
    for (const { width, height } of sizes) {
      const label = `handoff-${scenario.replace('booking-review-', '')}@${width}${height ? 'x' + height : ''}`;
      const context = await newContext(browser, width, height ? { height } : {});
      try {
        const { page, problems } = await openCandidate(
          context,
          origin,
          '/book/6?scenario=' + scenario,
          '.receipt',
        );
        await next(page, false);
        await confirmed(page);
        await page.locator('.order-handoff').waitFor();
        await page.waitForFunction(() => !globalThis.document.querySelector('.toast.show'), null, {
          timeout: 15_000,
        });
        await settle(page);
        const overflow = await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
        );
        assert.ok(overflow <= 0, `${label}: horizontal overflow ${overflow}px`);
        writeFileSync(
          resolve(evidence, `${label}.candidate.png`),
          await page.screenshot(screenshotOptions),
        );
        assert.deepEqual(problems, []);
        summary.handoffVisual.push({ state: label, width, height: height ?? contract.height });
      } finally {
        await context.close();
      }
    }
  }

  // 9. The C002 shell contract on the handoff routes: an unknown id keeps its route
  //    and fixture markers, and a reload does not change the route.
  {
    const context = await newContext(browser, 390);
    try {
      const page = await context.newPage();
      const { problems } = watchPage(page, 'candidate');
      for (const [route, fixture] of [
        ['/order/demo-order', 'tracking-default'],
        ['/pay/demo-order', 'payment-default'],
      ]) {
        await page.goto(`${origin}/#${route}`, { waitUntil: 'networkidle' });
        await page.locator('.order-handoff').waitFor();
        assert.equal(
          await page.locator('[data-customer-route]').getAttribute('data-customer-fixture'),
          fixture,
        );
        assert.equal(
          await page.locator('.app-header button[disabled]').count(),
          1,
          'the header action without behaviour is unavailable',
        );
      }
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'handoff route fallback keeps the shell contract' });
    } finally {
      await context.close();
    }
  }

  save();
  console.log(
    `C014 browser acceptance passed: ${summary.transitions.length} reference transitions, ` +
      `${summary.handoffVisual.length} candidate handoff records, ` +
      `${summary.interactions.length} interaction checks. Evidence: ${evidence}`,
  );
} finally {
  save();
  await server.close();
  await browser.close();
}
