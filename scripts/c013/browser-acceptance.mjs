// C013 browser acceptance: the booking Review screen and its six «تعديل» loops,
// compared with the read-only approved prototype under the F010 rendering contract.
//
// DECLARED DIFFERENCES (fixed before any comparison runs; see
// docs/customer/C013_BOOKING_REVIEW.md and, since C014 enabled confirmation,
// docs/customer/C014_BOOKING_CONFIRMATION.md). They apply to the Review screen only:
//
//   1. The second line of `.review-note`: the reference says the confirm button
//      creates a request on the device; the candidate states that confirmation
//      creates an order for this session only (DISCLOSURE below).
//   2. Wallet methods only (C014): no QR is shown in this build, so the reference's
//      QR promises are replaced — the note's first line, the payment line's detail
//      and the footer label «تأكيد الحجز وعرض QR» (WALLET_TEXT, FOOTER_TEXT).
//
// C013's disabled-button difference ended with C014: the action is enabled and
// its computed style must equal the reference's again.
//
// For a Review state the DOM comparison is strict except for exactly these
// replacements; the disclosure must be present. Pixels are recorded twice:
//   - FULL SCREEN, unmasked: recorded with its changed-pixel count, never claimed
//     as zero difference;
//   - OWNED AREA: the same full-page capture with `.review-note`, `.primary-next`
//     and, for a wallet, the payment receipt line masked on BOTH pages, compared
//     with the unchanged strict F010 thresholds.
// Every other state (each step opened for editing, the journey) is compared
// strictly and in full with the shared harness.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startReferenceServer } from '../f010/reference-server.mjs';
import { comparePngBuffers } from '../f010/pixel-compare.mjs';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import {
  comparePixels,
  compareSnapshots,
  contract,
  newContext,
  openCandidate,
  openReference,
  referenceStorageFor,
  screenshotOptions,
  settle,
  snapshot,
  watchPage,
} from '../c004/parity-harness.mjs';
import { captureStable } from '../c004/stable-capture.mjs';
import { withFailureEvidence } from '../c011/contact-input-helpers.mjs';

const origin = process.env.C013_ORIGIN ?? 'http://127.0.0.1:4174';
const evidence = process.env.C013_EVIDENCE_DIR
  ? resolve(process.env.C013_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-c013-'));
mkdirSync(evidence, { recursive: true });

const REFERENCE_SENTENCE = 'زر التأكيد ينشئ طلبًا على جهازك، وليس فاتورة أو حجزًا فعليًا.';
const DISCLOSURE = 'ينشئ التأكيد طلبًا تجريبيًا لهذه الجلسة فقط، بلا حجز أو دفع.';
/** [reference, candidate] for a wallet method (C014). */
const WALLET_TEXT = [
  [
    'يظهر QR بعد التأكيد. الدفع لا يُعتمد دون مطابقة.',
    'لا يظهر QR في هذا النموذج. لا يُحصَّل أي مبلغ.',
  ],
  ['QR بعد المراجعة · التحقق قبل بدء الخدمة', 'المحفظة غير مفعّلة بعد · لا تحويل الآن'],
];
const FOOTER_TEXT = ['تأكيد الحجز وعرض QR', 'تأكيد الحجز التجريبي'];
const OWNED_AREA_MASK = ['.review-note', '.primary-next'];
/**
 * The payment receipt line (the receipt's sixth child), masked for a wallet only.
 * First declared as the detail `<p>` alone; run review-sham@320 then showed one
 * owned pixel at (252, 757) one column right of that box (x 89–252 on both pages,
 * identical geometry): ink of the replaced reference text's first glyph overhanging
 * its own box. The whole line is masked instead; its icon and method name stay
 * strictly compared in the DOM snapshot.
 */
const WALLET_DETAIL_MASK = '.receipt > :nth-child(6)';
const isWalletReview = (mainText) => mainText.includes(WALLET_TEXT[1][0]);
const RETURN_LABEL = 'العودة إلى المراجعة';
const EDIT_LABELS = [
  'تعديل السيارة',
  'تعديل العناية والإضافات',
  'تعديل الموقع',
  'تعديل الموعد',
  'تعديل بيانات التواصل',
  'تعديل طريقة الدفع',
];
/** A selector each step shows once it is ready, on both pages. */
const STEP_READY = [
  '.signature-car',
  '.service-option',
  '.location-picker',
  '.dates',
  '#name',
  '#paymentMethod',
  '.receipt',
];
const NEXT = '.primary-next';
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
  '.receipt',
  '.receipt-top',
  '.receipt-top .car-art',
  '.receipt-top h3',
  '.receipt-top p',
  '.receipt-top .plate-mini',
  '.receipt-top small',
  '.receipt-line',
  '.receipt-line > .icon',
  '.receipt-line strong',
  '.receipt-line p',
  '.edit',
  '.bill',
  '.bill h3',
  '.bill-line',
  '.bill-line.total strong',
  '.review-note',
  '.booking-footer',
  '.footer-assurance span',
  '.booking-total',
  '.booking-total small',
  '.booking-total strong',
  '.primary-next',
  '.primary-next .button-arrow',
  'dialog.sheet[open]',
  'dialog.sheet[open] .bill-line',
];
/** Earlier steps opened for editing: the same selectors the earlier sprints compare. */
const STEP_SELECTORS = [
  'body',
  '.app',
  '.app-header',
  '.main',
  '.journey-heading',
  '.stepper',
  '.page-heading',
  '.page-heading h1',
  '.booking-footer',
  '.booking-total',
  '.primary-next',
  '.primary-next > span:first-child',
  '.main .error',
];

const summary = {
  evidence,
  origin,
  source: { head: process.env.GITHUB_SHA ?? process.env.C013_SOURCE_SHA ?? 'local' },
  declaredDifferences: {
    reviewNoteSecondLine: { reference: REFERENCE_SENTENCE, candidate: DISCLOSURE },
    walletText: WALLET_TEXT,
    walletFooterLabel: FOOTER_TEXT,
    ownedAreaMask: OWNED_AREA_MASK,
    walletOwnedAreaMask: WALLET_DETAIL_MASK,
  },
  reviewVisual: [],
  strictVisual: [],
  interactions: [],
};
const save = () =>
  writeFileSync(resolve(evidence, 'c013-summary.json'), JSON.stringify(summary, null, 2) + '\n');

// ------------------------------------------------------------------ page helpers

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
const route = (page) => new URL(page.url()).hash.replace('#/', '#').split('?')[0];
async function atStep(page, step) {
  await page.waitForFunction(
    (wanted) => globalThis.location.hash.replace('#/', '#').split('?')[0] === wanted,
    '#book/' + step,
  );
  await page.locator(STEP_READY[step]).first().waitFor();
}
const edit = (step) => async (page) => {
  await page.getByRole('button', { name: EDIT_LABELS[step], exact: true }).click();
  await atStep(page, step);
};
const headerBack = (page) => page.getByRole('button', { name: 'الخطوة السابقة' }).click();
const choose = (selector) => async (page) => {
  await page.locator(selector).click();
};

/** Writes the technician note, opening its optional section first when it is closed. */
const writeNote = (value) => async (page) => {
  if (!(await page.locator('.optional-details').evaluate((node) => node.open))) {
    await page.locator('.optional-details summary').click();
    await page.locator('.optional-details[open] #note').waitFor();
  }
  await page.locator('#note').fill(value);
};

/** The state a customer can observe; compared between the two pages after each action. */
function observe(page) {
  return page.evaluate(() => {
    const d = globalThis.document,
      clean = (v) => (v ?? '').replace(/\s+/g, ' ').trim(),
      text = (s) => clean(d.querySelector(s)?.textContent),
      all = (s) => [...d.querySelectorAll(s)].map((e) => clean(e.textContent));
    const active = d.activeElement;
    return {
      // The prototype's Home is `#home`; the candidate's is `#/`.
      route: globalThis.location.hash.replace('#/', '#').split('?')[0].replace(/^#$/, '#home'),
      header: text('.header-title'),
      heading: text('.main h1'),
      eyebrow: text('.main .eyebrow'),
      receipt: all('.receipt-top .grow, .receipt-line .grow'),
      bill: all('.main .bill-line'),
      footerCaption: text('.booking-total small'),
      footerPrice: text('#footer-price'),
      footerDuration: text('.footer-assurance span:last-child'),
      nextLabel: text('.primary-next > span:first-child'),
      errors: all('.main .error'),
      focused: active?.matches('.main h1')
        ? 'h1'
        : active?.matches('.edit')
          ? active.getAttribute('aria-label')
          : active?.matches('input,textarea')
            ? active.id || active.getAttribute('value')
            : active === d.body
              ? 'body'
              : (active?.className ?? null),
      scrolledToTop: globalThis.scrollY === 0,
    };
  });
}

/**
 * On the first page load the prototype focuses the heading; the candidate leaves
 * focus alone so the skip link stays the first keyboard stop (an inherited C002
 * decision, not a C013 one). Focus is compared after every in-app action instead.
 */
const withoutLoadFocus = ({ focused: _focused, ...rest }) => rest;

/**
 * The reference's observable state as the candidate is declared to show it: the
 * wallet payment line and the wallet label replaced (C014 declared differences 2).
 * Nothing else is rewritten.
 */
function asDeclared(observation) {
  const [detailFrom, detailTo] = WALLET_TEXT[1];
  return {
    ...observation,
    receipt: observation.receipt.map((line) => line.replace(detailFrom, detailTo)),
    nextLabel: observation.nextLabel === FOOTER_TEXT[0] ? FOOTER_TEXT[1] : observation.nextLabel,
  };
}

/** Opens both pages on one scenario at a booking step (or Home when step is null). */
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

/**
 * Runs an action on the reference, then the candidate, and compares what each shows.
 * Focus is compared after a change of screen (C013's route-entry focus). After a
 * choice inside an earlier step it is that step's own behaviour, owned and tested by
 * its sprint, so `{ focus: false }` leaves it out there.
 */
async function both(pair, action, label, { focus = true } = {}) {
  await action(pair.reference.page, true);
  await action(pair.candidate.page, false);
  await settle(pair.reference.page);
  await settle(pair.candidate.page);
  const pick = focus ? (state) => state : withoutLoadFocus;
  assert.deepEqual(
    pick(await observe(pair.candidate.page)),
    pick(asDeclared(await observe(pair.reference.page))),
    label + ': observable state',
  );
}
const IN_STEP = { focus: false };

function assertClean(pair, label) {
  assert.deepEqual(pair.reference.problems, [], label + ': reference problems');
  assert.deepEqual(pair.candidate.problems, [], label + ': candidate problems');
}

// ------------------------------------------------------------- Review comparison

/**
 * Strict DOM comparison of a Review state that allows exactly the declared
 * differences, and requires them: a candidate that matched the reference here
 * would be showing the unsupported confirmation claim.
 */
async function compareReviewDom(reference, candidate, label, selectors = SELECTORS) {
  const a = await snapshot(reference, selectors);
  const b = await snapshot(candidate, selectors);
  assert.ok(a.mainText.includes(REFERENCE_SENTENCE), label + ': reference sentence present');
  const wallet = isWalletReview(a.mainText);
  let expectedMain = a.mainText.replace(REFERENCE_SENTENCE, DISCLOSURE);
  let expectedFooter = a.footerText;
  if (wallet) {
    for (const [from, to] of WALLET_TEXT) {
      assert.ok(expectedMain.includes(from), label + ': reference wallet text present');
      expectedMain = expectedMain.replace(from, to);
    }
    assert.ok(expectedFooter.includes(FOOTER_TEXT[0]), label + ': reference wallet label');
    expectedFooter = expectedFooter.replace(FOOTER_TEXT[0], FOOTER_TEXT[1]);
  }
  assert.equal(b.mainText, expectedMain, label + ': main text differs only as declared');
  assert.equal(b.footerText, expectedFooter, label + ': footer text differs only as declared');
  const normalised = globalThis.structuredClone(b);
  normalised.mainText = a.mainText;
  normalised.footerText = a.footerText;
  assert.equal(b.elements['.primary-next'].length, 1, label + ': one footer action');
  compareSnapshots(a, normalised, selectors, label);
  assert.equal(b.lang, 'ar');
  assert.equal(b.dir, 'rtl');
  assert.ok(b.scrollWidth - b.innerWidth <= 0, label + ': horizontal overflow');
}

async function stableCapture(browser, page, options, label) {
  const unchanged = async (previous, next) => {
    const compared = await comparePngBuffers(browser, previous, next, contract.channelThreshold);
    return compared.sameDimensions && compared.changedPixels === 0;
  };
  return captureStable(() => page.screenshot(options), { unchanged }).catch((error) => {
    throw new Error(`${label}: ${error.message}`);
  });
}

/** Full-screen record plus the strict owned-area comparison (declared regions masked). */
async function compareReviewPixels(browser, reference, candidate, label) {
  const wallet = isWalletReview(
    await reference.evaluate(() =>
      (globalThis.document.querySelector('.main')?.innerText ?? '').replace(/\s+/g, ' '),
    ),
  );
  const full = [
    await stableCapture(browser, reference, screenshotOptions, label + ' reference'),
    await stableCapture(browser, candidate, screenshotOptions, label + ' candidate'),
  ];
  const fullCompared = await comparePngBuffers(
    browser,
    full[0].image,
    full[1].image,
    contract.channelThreshold,
  );
  writeFileSync(resolve(evidence, `${label}.full.reference.png`), full[0].image);
  writeFileSync(resolve(evidence, `${label}.full.candidate.png`), full[1].image);
  if (fullCompared.diffBuffer) {
    writeFileSync(resolve(evidence, `${label}.full.diff.png`), fullCompared.diffBuffer);
  }
  assert.equal(fullCompared.sameDimensions, true, label + ': full-screen dimensions differ');
  assert.ok(fullCompared.changedPixels > 0, label + ': the declared difference is visible');

  const masked = (page) => ({
    ...screenshotOptions,
    mask: [...OWNED_AREA_MASK, ...(wallet ? [WALLET_DETAIL_MASK] : [])].map((selector) =>
      page.locator(selector),
    ),
    maskColor: '#ff00ff',
  });
  const owned = [
    await stableCapture(browser, reference, masked(reference), label + ' reference (masked)'),
    await stableCapture(browser, candidate, masked(candidate), label + ' candidate (masked)'),
  ];
  const ownedCompared = await comparePngBuffers(
    browser,
    owned[0].image,
    owned[1].image,
    contract.channelThreshold,
  );
  writeFileSync(resolve(evidence, `${label}.owned.reference.png`), owned[0].image);
  writeFileSync(resolve(evidence, `${label}.owned.candidate.png`), owned[1].image);
  if (ownedCompared.diffBuffer) {
    writeFileSync(resolve(evidence, `${label}.owned.diff.png`), ownedCompared.diffBuffer);
  }
  assert.equal(ownedCompared.sameDimensions, true, label + ': owned-area dimensions differ');
  assert.ok(
    ownedCompared.diffRatio <= contract.allowedDiffRatio,
    `${label}: ${ownedCompared.changedPixels} owned-area pixels differ from the approved reference`,
  );
  return {
    fullScreen: { changedPixels: fullCompared.changedPixels, diffRatio: fullCompared.diffRatio },
    ownedArea: { changedPixels: ownedCompared.changedPixels, diffRatio: ownedCompared.diffRatio },
    captures: {
      reference: [full[0].captures, owned[0].captures],
      candidate: [full[1].captures, owned[1].captures],
    },
  };
}

/**
 * Brings both pages to a capturable state. A notice toast is timed (4 s on both
 * pages) and the two pages are captured one after the other, so a toast raised by
 * the last choice could be captured on one and not the other; visual comparisons
 * wait until neither shows one.
 */
async function quiesce(pair) {
  for (const page of [pair.reference.page, pair.candidate.page]) {
    // The pointer that pressed Next stays over the footer action; whether Chromium
    // re-applies :hover to the newly rendered button is timing-dependent, so it is
    // moved off every control before a capture.
    await page.mouse.move(0, 0);
    // With motion allowed, leaving :hover starts a short colour transition.
    await page.waitForFunction(
      () => globalThis.document.getAnimations().every((item) => item.playState !== 'running'),
      null,
      { timeout: 5_000 },
    );
    await page.waitForFunction(() => !globalThis.document.querySelector('.toast.show'), null, {
      timeout: 15_000,
    });
  }
}

/**
 * Scrolling is unlocked again. Closing a dialog removes `open` at once, but its
 * `close` event (which releases a sheet's lock) is a later task, so this waits for
 * the release, bounded: a lock that is never released still fails.
 */
async function pageUnlocked(page) {
  await page.waitForFunction(() => globalThis.document.body.style.overflow === '', null, {
    timeout: 5_000,
  });
}

async function compareReview(browser, pair, label, record) {
  await quiesce(pair);
  await settle(pair.reference.page);
  await settle(pair.candidate.page);
  await withFailureEvidence(
    async () => {
      await compareReviewDom(pair.reference.page, pair.candidate.page, label);
      const pixels = await compareReviewPixels(
        browser,
        pair.reference.page,
        pair.candidate.page,
        label,
      );
      summary.reviewVisual.push({ state: label, ...record, ...pixels });
      save();
    },
    () => keepFailure(pair, label),
  );
}

async function keepFailure(pair, label) {
  for (const [side, page] of [
    ['reference', pair.reference.page],
    ['candidate', pair.candidate.page],
  ]) {
    writeFileSync(
      resolve(evidence, `${label}.failure.${side}.png`),
      await page.screenshot({ fullPage: true }),
    );
    writeFileSync(
      resolve(evidence, `${label}.failure.${side}.json`),
      JSON.stringify(await observe(page), null, 2),
    );
  }
}

// ------------------------------------------------------------------------ run

const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const server = await startReferenceServer();
try {
  // 1. Review at the six widths and a short viewport, every method and content shape.
  const reviewStates = [
    'booking-review-cash',
    'booking-review-sham',
    'booking-review-syriatel',
    'booking-review-minimal',
    'booking-review-full',
    'booking-review-long',
  ];
  const sizes = [
    ...contract.viewports.map((width) => ({ width })),
    { width: 390, height: 560 },
    { width: 320, height: 560 },
  ];
  for (const scenario of reviewStates) {
    for (const { width, height } of sizes) {
      const label = `${scenario.replace('booking-', '')}@${width}${height ? 'x' + height : ''}`;
      const context = await newContext(browser, width, height ? { height } : {});
      try {
        const pair = await openPair(context, server, scenario, 6);
        assert.deepEqual(
          withoutLoadFocus(await observe(pair.candidate.page)),
          withoutLoadFocus(asDeclared(await observe(pair.reference.page))),
          label,
        );
        await compareReview(browser, pair, label, {
          scenario,
          width,
          height: height ?? contract.height,
        });
        assertClean(pair, label);
      } finally {
        await context.close();
      }
    }
  }

  // 1b. Negative regressions: the Review comparison is not lenient. The declared
  //     difference is required (the reference compared with itself fails, so a
  //     candidate repeating the unsupported claim would fail), and any other change of
  //     text, or of geometry, still fails.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'booking-review-cash', 6);
      await quiesce(pair);
      await assert.rejects(
        compareReviewDom(pair.reference.page, pair.reference.page, 'negative: claim kept'),
        /reference sentence present|differs only by the declared disclosure|AssertionError/,
      );
      await pair.candidate.page.evaluate(() => {
        globalThis.document.querySelector('.receipt-line strong').textContent += ' ×';
      });
      await assert.rejects(
        compareReviewDom(pair.reference.page, pair.candidate.page, 'negative: text'),
        /differs only by the declared disclosure/,
      );
      await pair.candidate.page.evaluate(() => {
        const strong = globalThis.document.querySelector('.receipt-line strong');
        strong.textContent = strong.textContent.replace(' ×', '');
        globalThis.document.querySelector('.receipt-top').style.paddingTop = '17px';
      });
      await assert.rejects(
        compareReviewDom(pair.reference.page, pair.candidate.page, 'negative: geometry'),
        /drift against the approved reference/,
      );
      summary.interactions.push({ name: 'negative: claim, text and geometry drift all fail' });
    } finally {
      await context.close();
    }
  }

  // 2. The price sheet on Review: the same bill as the inline one and the prototype's.
  for (const width of [320, 390]) {
    const label = `review-price-sheet@${width}`;
    const context = await newContext(browser, width);
    try {
      const pair = await openPair(context, server, 'booking-review-full', 6);
      await both(
        pair,
        async (page) => {
          await page.locator('.booking-total').click();
          await page.locator('dialog.sheet[open]').waitFor();
        },
        label,
      );
      const sheets = [];
      for (const page of [pair.reference.page, pair.candidate.page]) {
        sheets.push(
          (await page.locator('dialog.sheet[open]').innerText()).replace(/\s+/g, ' ').trim(),
        );
      }
      assert.equal(sheets[1], sheets[0], label + ': sheet text');
      const inline = (await pair.candidate.page.locator('.main .bill').innerText()).replace(
        /\s+/g,
        ' ',
      );
      assert.ok(sheets[1].includes(inline.trim()), label + ': sheet bill equals the inline bill');
      await compareReview(browser, pair, label, { scenario: 'booking-review-full', width });
      for (const page of [pair.reference.page, pair.candidate.page]) {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !globalThis.document.querySelector('dialog.sheet[open]'));
      }
      assert.equal(
        await pair.candidate.page.evaluate(() =>
          globalThis.document.activeElement?.matches('.booking-total'),
        ),
        true,
        label + ': focus returns to the price button',
      );
      await pageUnlocked(pair.candidate.page);
      assertClean(pair, label);
      summary.interactions.push({ name: 'price sheet on Review: ' + width });
    } finally {
      await context.close();
    }
  }
  save();

  // 3. Each step opened for editing: compared strictly and in full, then a valid
  //    Next returns straight to Review, where the edited summary is compared.
  const loops = [
    { step: 0, change: choose('label.signature-car:has(input[value="pickup"])') },
    { step: 1, change: choose('label.service-option:has(input[value="complete"])') },
    { step: 2, change: choose('.place-shortcut[data-kind="work"]') },
    { step: 3, change: choose('button.time[data-time="13:00"]') },
    {
      step: 4,
      change: writeNote('ملاحظة معدلة من المراجعة'),
    },
    { step: 5, change: choose('[data-pay-option="sham"]') },
  ];
  for (const loop of loops) {
    const label = `edit-${loop.step}`;
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'booking-review-full', 6);
      await both(pair, edit(loop.step), label + ' opened');
      for (const page of [pair.reference.page, pair.candidate.page]) {
        assert.equal(
          (await page.locator('.primary-next > span:first-child').innerText()).trim(),
          RETURN_LABEL,
          label + ': the step offers the return to Review',
        );
      }
      await quiesce(pair);
      const opened = await withFailureEvidence(
        () => comparePixels(browser, pair.reference.page, pair.candidate.page, evidence, label),
        () => keepFailure(pair, label),
      );
      const a = await snapshot(pair.reference.page, STEP_SELECTORS);
      const b = await snapshot(pair.candidate.page, STEP_SELECTORS);
      compareSnapshots(a, b, STEP_SELECTORS, label);
      summary.strictVisual.push({ state: label + ' opened', width: 390, ...opened });
      await both(pair, loop.change, label + ' changed', IN_STEP);
      await both(
        pair,
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 6);
        },
        label + ' returned',
      );
      await compareReview(browser, pair, label + '-returned@390', {
        scenario: 'booking-review-full',
        edited: loop.step,
        width: 390,
      });
      assertClean(pair, label);
      summary.interactions.push({ name: `edit loop ${loop.step}: change and return to Review` });
    } finally {
      await context.close();
    }
  }
  save();

  // 4. Header Back while editing keeps the live change and returns to Review;
  //    ordinary header Back on Review goes to Payment and Next comes back.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'booking-review-cash', 6);
      await both(pair, edit(4), 'header back: open contact');
      await both(pair, writeNote('تغيير مباشر'), 'header back: type', IN_STEP);
      await both(
        pair,
        async (page) => {
          await headerBack(page);
          await atStep(page, 6);
        },
        'header back: edit returns to Review',
      );
      assert.ok(
        (await observe(pair.candidate.page)).receipt.some((line) => line.includes('تغيير مباشر')),
        'the live change is kept',
      );
      await both(
        pair,
        async (page) => {
          await headerBack(page);
          await atStep(page, 5);
        },
        'header back: Review to Payment',
      );
      await both(
        pair,
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 6);
        },
        'header back: Payment Next to Review',
      );
      assertClean(pair, 'header back');
      summary.interactions.push({ name: 'header Back in edit mode and from Review' });
    } finally {
      await context.close();
    }
  }

  // 5. An invalid edit is refused on its step and edit mode stays until it is valid.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'booking-review-sham', 6);
      await both(pair, edit(4), 'refusal: open contact');
      await both(pair, (page) => page.locator('#name').fill('x'), 'refusal: invalid name', IN_STEP);
      await both(
        pair,
        async (page, isReference) => {
          await next(page, isReference);
          await page.locator('#error-name').waitFor();
          await page.waitForFunction(() => globalThis.document.activeElement?.id === 'name');
        },
        'refusal: Next refused',
      );
      const refused = await observe(pair.candidate.page);
      assert.equal(refused.route, '#book/4');
      assert.equal(refused.nextLabel, RETURN_LABEL, 'edit mode stays after a refusal');
      await both(pair, (page) => page.locator('#name').fill('اسم صحيح'), 'refusal: fixed', IN_STEP);
      await both(
        pair,
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 6);
        },
        'refusal: valid Next returns to Review',
      );
      assertClean(pair, 'refusal');
      summary.interactions.push({ name: 'invalid edit refused, then returned when valid' });
    } finally {
      await context.close();
    }
  }

  // 6. Edit intent survives Time's «تغيير» to Location (an in-flow PUSH).
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'booking-review-cash', 6);
      await both(pair, edit(3), 'in-flow: open time');
      await both(
        pair,
        async (page) => {
          await page.getByRole('button', { name: 'تغيير', exact: true }).click();
          await atStep(page, 2);
        },
        'in-flow: change location',
      );
      assert.equal((await observe(pair.candidate.page)).nextLabel, RETURN_LABEL);
      await both(
        pair,
        choose('.place-shortcut[data-kind="work"]'),
        'in-flow: choose work',
        IN_STEP,
      );
      await both(
        pair,
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 6);
        },
        'in-flow: Location Next returns to Review',
      );
      assertClean(pair, 'in-flow');
      summary.interactions.push({ name: 'edit intent survives Time → Location' });
    } finally {
      await context.close();
    }
  }

  // 7. Genuine browser history ends edit mode, as the prototype's fromRoute().
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'booking-review-full', 6);
      await both(pair, edit(0), 'history: open vehicle');
      await both(
        pair,
        async (page) => {
          await page.goBack();
          await atStep(page, 6);
        },
        'history: Back to Review',
      );
      await both(
        pair,
        async (page) => {
          await page.goForward();
          await atStep(page, 0);
        },
        'history: Forward to Vehicle',
      );
      assert.equal(
        (await observe(pair.candidate.page)).nextLabel,
        'اختيار العناية',
        'edit mode does not survive history',
      );
      await both(
        pair,
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 1);
        },
        'history: ordinary Next continues in order',
      );
      assertClean(pair, 'history');
      summary.interactions.push({ name: 'browser Back/Forward end edit mode' });
    } finally {
      await context.close();
    }
  }

  // 8. Save and exit from an edit, then «أكمل»: the draft resumes outside edit mode.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'booking-review-full', 6);
      await both(pair, edit(1), 'exit: open care');
      await both(
        pair,
        async (page) => {
          await page.getByRole('button', { name: 'حفظ المسودة والخروج' }).click();
          await page.locator('dialog.sheet[open]').waitFor();
          await page.getByRole('button', { name: 'حفظ والخروج' }).click();
          await page.locator('.hero-cta').waitFor();
          await page.waitForFunction(() => !globalThis.document.querySelector('dialog[open]'));
        },
        'exit: save and exit',
      );
      await pageUnlocked(pair.candidate.page);
      assert.equal(await pair.candidate.page.locator('.nav-dot').count(), 0, 'no order created');
      await both(
        pair,
        async (page) => {
          await page.locator('.resume .text-btn').last().click();
          await atStep(page, 1);
        },
        'exit: resume',
      );
      assert.equal((await observe(pair.candidate.page)).nextLabel, 'تحديد المكان');
      assertClean(pair, 'exit');
      summary.interactions.push({ name: 'save and exit from an edit, then resume' });
    } finally {
      await context.close();
    }
  }

  // 9. Repeat booking: Home «نكرر نفس الغسلة؟» → Review with the repeat heading.
  for (const width of [320, 390]) {
    const label = `repeat-review@${width}`;
    const context = await newContext(browser, width);
    try {
      const pair = await openPair(context, server, 'home-repeat-order', null);
      await both(
        pair,
        async (page) => {
          await page.locator('.quick-return').click();
          await atStep(page, 6);
          // The repeat notice is a timed toast; compare once it has gone.
          await page.waitForFunction(
            () => !globalThis.document.querySelector('.toast.show'),
            null,
            {
              timeout: 15_000,
            },
          );
        },
        label,
      );
      assert.equal((await observe(pair.candidate.page)).heading, 'نفس العناية، بموعد جديد.');
      await compareReview(browser, pair, label, { scenario: 'home-repeat-order', width });
      await both(pair, edit(1), label + ' edit care');
      await both(
        pair,
        choose('label.service-option:has(input[value="premium"])'),
        label + ' premium',
        IN_STEP,
      );
      await both(
        pair,
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 6);
        },
        label + ' returned',
      );
      assert.equal((await observe(pair.candidate.page)).heading, 'نفس العناية، بموعد جديد.');
      assertClean(pair, label);
      summary.interactions.push({
        name: 'repeat Review and an edit keep the repeat mode: ' + width,
      });
    } finally {
      await context.close();
    }
  }
  save();

  // 10. The public journey: Home through all six decisions into Review.
  {
    const context = await newContext(browser, 390);
    try {
      const pair = await openPair(context, server, 'home-empty', null);
      // Choices inside a step (not changes of screen): the place, the earliest time,
      // the demo contact and the payment method.
      const inStep = new Set([3, 5, 7, 9]);
      const steps = [
        async (page) => {
          await page.locator('.hero-cta').click();
          await atStep(page, 0);
        },
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 1);
        },
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 2);
        },
        choose('.place-shortcut[data-kind="work"]'),
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 3);
        },
        choose('.earliest'),
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 4);
        },
        async (page) => {
          await page.locator('.row.between .text-btn').click();
          await page.waitForFunction(() => globalThis.document.querySelector('#phone')?.value);
        },
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 5);
        },
        choose('[data-pay-option="syriatel"]'),
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 6);
        },
      ];
      for (const [index, step] of steps.entries()) {
        await both(pair, step, 'journey ' + (index + 1), inStep.has(index) ? IN_STEP : {});
      }
      await compareReview(browser, pair, 'journey-review@390', { scenario: 'home-empty' });
      for (const step of [0, 1, 2, 3, 4, 5]) {
        await both(pair, edit(step), 'journey edit ' + step);
        await both(
          pair,
          async (page, isReference) => {
            await next(page, isReference);
            await atStep(page, 6);
          },
          'journey edit ' + step + ' returned',
        );
      }
      // C014 owns what the final action does (scripts/c014/browser-acceptance.mjs);
      // C013's "the unavailable action does nothing" check was superseded there.
      assertClean(pair, 'journey');
      summary.interactions.push({
        name: 'public journey Home → six decisions → Review → six edits',
      });
    } finally {
      await context.close();
    }
  }
  save();

  // 11. Candidate-only checks that have no reference counterpart.
  // 11a. The confirm action (C014) is described by the disclosure; the six edit
  //      controls work from the keyboard with visible focus. Activating it is C014's.
  {
    const context = await newContext(browser, 390);
    try {
      const { page, problems, requests } = await openCandidate(
        context,
        origin,
        '/book/6?scenario=booking-review-syriatel',
        '.receipt',
      );
      const confirm = await page.locator(NEXT).evaluate((node) => ({
        disabled: node.disabled,
        describedBy: node.getAttribute('aria-describedby'),
        reason: globalThis.document.getElementById(node.getAttribute('aria-describedby'))
          ?.textContent,
        label: node.textContent.trim(),
      }));
      assert.deepEqual(confirm, {
        disabled: false,
        describedBy: 'review-confirmation-disclosure',
        reason: DISCLOSURE,
        label: 'تأكيد الحجز التجريبي',
      });
      assert.equal(await page.locator('#main h1').count(), 1);
      for (const [step, name] of EDIT_LABELS.entries()) {
        await page.locator('#main h1').focus();
        let reached = false;
        for (let tabs = 0; tabs < 20 && !reached; tabs += 1) {
          await page.keyboard.press('Tab');
          reached = await page.evaluate(
            (wanted) => globalThis.document.activeElement?.getAttribute('aria-label') === wanted,
            name,
          );
        }
        assert.ok(reached, name + ' is reachable with Tab');
        assert.equal(
          await page.evaluate(() => globalThis.document.activeElement?.matches(':focus-visible')),
          true,
          name + ' shows keyboard focus',
        );
        await page.keyboard.press('Enter');
        await atStep(page, step);
        assert.equal(
          await page.evaluate(() => globalThis.document.activeElement?.matches('#main h1')),
          true,
          'route entry focuses the heading',
        );
        await headerBack(page);
        await atStep(page, 6);
      }
      assert.deepEqual(
        await page.evaluate(() => ({
          local: globalThis.localStorage.length,
          session: globalThis.sessionStorage.length,
          cookies: globalThis.document.cookie,
          media: globalThis.document.querySelectorAll('img[src^="data:"],canvas,.qr-button').length,
        })),
        { local: 0, session: 0, cookies: '', media: 0 },
      );
      assert.ok(
        requests.every((request) => request.startsWith('GET ' + origin)),
        'only the loopback page load',
      );
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'keyboard: six edits, described confirmation, storage' });
    } finally {
      await context.close();
    }
  }

  // 11b. Shared Sheet regression: leaving Review by browser Back with the price sheet
  //      open must leave the destination scrollable (red on bd72661).
  {
    const context = await newContext(browser, 390, { height: 560 });
    try {
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/5?scenario=booking-payment-cash',
        '#paymentMethod',
      );
      await page.locator(NEXT).click();
      await atStep(page, 6);
      await page.locator('.booking-total').click();
      await page.locator('dialog.sheet[open]').waitFor();
      assert.equal(await page.evaluate(() => globalThis.document.body.style.overflow), 'hidden');
      await page.goBack();
      await atStep(page, 5);
      await page.mouse.move(195, 300);
      await page.mouse.wheel(0, 400);
      await page.waitForFunction(() => globalThis.scrollY > 0);
      assert.equal(await page.evaluate(() => globalThis.document.body.style.overflow), '');
      // Replacement: closing one sheet and opening another in the same task keeps the
      // new one locked; Escape then unlocks.
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.goForward();
      await atStep(page, 6);
      await page.locator('.booking-total').click();
      await page.locator('dialog.sheet[open]').waitFor();
      await page.evaluate(() => {
        globalThis.document.querySelector('dialog.sheet[open] .btn.full').click();
        globalThis.document.querySelector('[aria-label="حفظ المسودة والخروج"]').click();
      });
      await page.waitForFunction(
        () =>
          globalThis.document.querySelectorAll('dialog.sheet[open]').length === 1 &&
          globalThis.document.querySelector('dialog.sheet[open] h2')?.textContent ===
            'نكمل الغسلة لاحقًا؟',
      );
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => globalThis.document.body.style.overflow), 'hidden');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !globalThis.document.querySelector('dialog[open]'));
      await pageUnlocked(page);
      // Rapid reopen: the sheet is reopened after it closed but before its close event
      // arrives. The stale event must neither close the new sheet nor unlock it (on
      // ac4fec6 it closed it again: two close events, sheet closed, scroll unlocked).
      await page.locator('.booking-total').click();
      await page.locator('dialog.sheet[open]').waitFor();
      const trace = await page.evaluate(async () => {
        const log = [];
        const dialog = globalThis.document.querySelector('dialog.sheet[open]');
        dialog.addEventListener('close', () => log.push('close open=' + dialog.open));
        const observer = new globalThis.MutationObserver(() => {
          if (dialog.open) return;
          observer.disconnect();
          log.push('closed, reopening');
          globalThis.document.querySelector('.booking-total').click();
        });
        observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
        dialog.querySelector('.btn.full').click();
        await new Promise((done) => globalThis.setTimeout(done, 500));
        const overflow = globalThis.document.body.style.overflow;
        log.push('final open=' + dialog.open + ' overflow=' + overflow);
        return log;
      });
      assert.equal(trace[0], 'closed, reopening', JSON.stringify(trace));
      assert.equal(trace.at(-1), 'final open=true overflow=hidden', JSON.stringify(trace));
      assert.equal(
        trace.filter((line) => line.startsWith('close ')).length,
        1,
        JSON.stringify(trace),
      );
      // A platform close of that sheet (backdrop) still reaches its owner and unlocks.
      await page.mouse.click(195, 5);
      await page.waitForFunction(() => !globalThis.document.querySelector('dialog[open]'));
      await pageUnlocked(page);
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.matches('.booking-total')),
        true,
        'focus returns to the opener',
      );
      // The × control; the sheet then opens and closes again normally.
      await page.locator('.booking-total').click();
      await page.locator('dialog.sheet[open]').waitFor();
      await page.getByRole('button', { name: 'إغلاق النافذة' }).click();
      await page.waitForFunction(() => !globalThis.document.querySelector('dialog[open]'));
      await pageUnlocked(page);
      await page.locator('.booking-total').click();
      await page.locator('dialog.sheet[open]').waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !globalThis.document.querySelector('dialog[open]'));
      await pageUnlocked(page);
      assert.deepEqual(problems, []);
      summary.interactions.push({
        name: 'sheet lifecycle: unmount, replacement, Escape, rapid reopen, backdrop, close button',
      });
    } finally {
      await context.close();
    }
  }

  // 11c. Time passes while Review is open: an expired appointment is never confirmed
  //      or rendered as valid; editing it goes to Time, a new time returns to Review.
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
        globalThis.__c013SetNow = (iso) => {
          fixed = iso;
        };
      }, contract.fixedTime);
      const { page, problems } = await openCandidate(
        context,
        origin,
        '/book/6?scenario=booking-review-cash',
        '.receipt',
      );
      // 09:14 Damascus: 10:00 tomorrow is still offered (boundary - 1 minute).
      await page.evaluate(() => globalThis.__c013SetNow('2026-09-21T06:14:00.000Z'));
      await edit(4)(page);
      await headerBack(page);
      await atStep(page, 6);
      // 09:15: inside the 45-minute lead time. Opening any later edit goes to Time.
      await page.evaluate(() => globalThis.__c013SetNow('2026-09-21T06:15:00.000Z'));
      await page.getByRole('button', { name: EDIT_LABELS[4], exact: true }).click();
      await atStep(page, 3);
      assert.equal((await observe(page)).nextLabel, RETURN_LABEL);
      await page.locator('.earliest').click();
      await next(page, false);
      await atStep(page, 6);
      assert.ok((await observe(page)).receipt.some((line) => line.includes('12:00 م')));
      // Expired again while Review is open: header Back targets Payment, whose own
      // entry guard (at this instant) sends the customer to Time instead.
      await page.evaluate(() => globalThis.__c013SetNow('2026-09-21T09:00:00.000Z'));
      await headerBack(page);
      await atStep(page, 3);
      assert.equal(await page.locator('#paymentMethod').count(), 0);
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: 'expiry on Review: lead-time boundary and guard' });
    } finally {
      await context.close();
    }
  }

  // 11d. Direct links and reloads are guarded in the established order.
  for (const [path, destination] of [
    ['/book/6?scenario=home-empty', 2],
    ['/book/6?scenario=booking-vehicle-invalid-plate', 0],
    ['/book/6?scenario=booking-time-ready', 3],
    ['/book/6?scenario=booking-contact-ready', 4],
    ['/book/6?scenario=booking-payment-empty', 5],
    ['/book/6?scenario=booking-review-expired-slot', 3],
    ['/book/6?scenario=__proto__', 2],
  ]) {
    const context = await newContext(browser, 390);
    try {
      const page = await context.newPage();
      const { problems } = watchPage(page, 'candidate');
      await page.goto(`${origin}/#${path}`, { waitUntil: 'networkidle' });
      await atStep(page, destination);
      assert.equal(await page.locator('.receipt').count(), 0, path + ': never an invalid summary');
      // The corrected link replaced the requested one; a reload starts a new in-memory
      // session there (nothing was persisted) and is guarded again.
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.main h1').waitFor();
      assert.notEqual(route(page), '#book/6', path + ': reload');
      assert.equal(await page.locator('.receipt').count(), 0, path + ': reload');
      assert.deepEqual(problems, []);
      summary.interactions.push({ name: `direct entry ${path} → step ${destination}` });
    } finally {
      await context.close();
    }
  }

  // 11e. Motion allowed: the same Review once animations have finished.
  {
    const context = await newContext(browser, 390, { reducedMotion: 'no-preference' });
    try {
      const pair = await openPair(context, server, 'booking-review-sham', 6);
      await both(pair, edit(5), 'motion: open payment');
      await both(pair, choose('[data-pay-option="cash"]'), 'motion: choose cash', IN_STEP);
      await both(
        pair,
        async (page, isReference) => {
          await next(page, isReference);
          await atStep(page, 6);
          await page.waitForTimeout(450);
        },
        'motion: returned',
      );
      await quiesce(pair);
      await compareReviewDom(pair.reference.page, pair.candidate.page, 'motion-review@390');
      assertClean(pair, 'motion');
      summary.interactions.push({ name: 'edit loop with motion allowed' });
    } finally {
      await context.close();
    }
  }

  save();
  console.log(
    `C013 browser acceptance passed: ${summary.reviewVisual.length} Review comparisons ` +
      `(full screen recorded, owned area strict), ${summary.strictVisual.length} strict ` +
      `full-screen comparisons, ${summary.interactions.length} interaction checks. ` +
      `Evidence: ${evidence}`,
  );
} finally {
  save();
  await server.close();
  await browser.close();
}
