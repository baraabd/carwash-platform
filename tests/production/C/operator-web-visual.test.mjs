/* global document, localStorage, Storage, getComputedStyle, requestAnimationFrame, createImageBitmap, CSSStyleSheet, scrollY, innerWidth, innerHeight -- browser code inside page.evaluate() */
/**
 * P03-C5 visual parity: approved technician reference vs operator-web port.
 *
 * Reference and candidate are rendered in the same Chromium with the F010
 * contract (6 widths, height 900, DPR 1, ar-SY, Asia/Damascus, light,
 * reduced motion, fixed 2026-09-20T09:00:00.000Z, channel threshold 8). The
 * reference state is injected through its own localStorage format; the
 * candidate reads the same scenario from the fixture doubles through the
 * gateway harness. The DECLARED operations (support/operator-declared-
 * differences.mjs) are applied to the reference DOM and their regions are
 * recorded; the remaining difference must be exactly zero.
 *
 * Evidence (PNG + JSON) goes to .acceptance/production-C/operator-web/ (gitignored).
 * Fixture doubles only: this is render parity, not service integration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startReferenceServer } from '../../../scripts/f010/reference-server.mjs';
import { comparePngBuffers } from '../../../scripts/f010/pixel-compare.mjs';
import {
  RENDERING,
  deterministicInit,
  generateJpeg,
  launch,
  newOperatorContext,
  startStack,
} from './support/operator-browser.mjs';
import { DECLARED, applyDeclaredInPage } from './support/operator-declared-differences.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = `${ROOT}.acceptance/production-C/operator-web/visual`;
const KEY = 'washgo-technician-approval-v1';
const WIDTHS = RENDERING.viewports;
const ONLY = process.env.OPERATOR_VISUAL_ONLY ? new RegExp(process.env.OPERATOR_VISUAL_ONLY) : null;

/**
 * F010 capture rules (scripts/f010/browser-acceptance.mjs). They are applied
 * through a constructable stylesheet on BOTH pages because the candidate's
 * production CSP (style-src 'self') correctly refuses an injected <style>.
 */
const CAPTURE_CSS = `
  html { scrollbar-width: none !important; scroll-behavior: auto !important; }
  *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  *, *::before, *::after { animation: none !important; transition: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
`;
const screenshotOptions = (fullPage = true) => ({
  fullPage,
  animations: 'disabled',
  caret: 'hide',
});

async function applyCaptureCss(page) {
  await page.evaluate((css) => {
    if (document.documentElement.dataset.captureCss) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    document.documentElement.dataset.captureCss = '1';
  }, CAPTURE_CSS);
}

// ------------------------------------------------------------- scenario data

const SEED_KEYS = ['WG-2041', 'WG-2042', 'WG-2043'];
const HISTORY_AT = '2026-09-20T05:40:00.000Z';

function refJob(id, over = {}) {
  return {
    id,
    stage: 'assigned',
    checks: [],
    photos: { before: [null, null], after: [null, null] },
    notes: '',
    cash: 'due',
    cashIssue: '',
    issue: '',
    closedAt: null,
    startedAt: null,
    history: [],
    ...over,
  };
}
const refState = (jobs, ready = true) => ({ version: 1, ready, motion: true, feedback: '', jobs });

const local = (data) => ({ kind: 'local', data });

/** Builders get `img` = {before:{data,id}, after:{data,id}} after objects are stored. */
const allAccepted = {
  setup: (c) => SEED_KEYS.forEach((k) => c.seedTask(k, { stage: 'ACCEPTED' })),
  ref: () => refState(SEED_KEYS.map((id) => refJob(id, { stage: 'accepted' }))),
};

const ledger = {
  setup: (c, img) => {
    c.seedTask('WG-2041', {
      stage: 'CLOSED',
      checked: ['exterior', 'wheels', 'interior', 'quality'],
      evidence: { BEFORE: [img.before.id, null], AFTER: [img.after.id, null] },
      collection: {
        outcome: 'CASH_COLLECTED',
        amount: { currency: 'SYP', amountMinor: '105000', scale: 2 },
        reason: null,
        declaredAt: HISTORY_AT,
        lateAmount: null,
        lateDeclaredAt: null,
      },
    });
    c.seedTask('WG-2042', {
      stage: 'CLOSED',
      evidence: { BEFORE: [img.before.id, null], AFTER: [img.after.id, null] },
      collection: {
        outcome: 'NOT_CASH',
        amount: null,
        reason: null,
        declaredAt: HISTORY_AT,
        lateAmount: null,
        lateDeclaredAt: null,
      },
    });
    c.seedTask('WG-2043', { stage: 'ACCEPTED' });
  },
  ref: (img) =>
    refState([
      refJob('WG-2041', {
        stage: 'closed',
        cash: 'collected',
        checks: [0, 1, 2, 3],
        photos: { before: [local(img.before.data), null], after: [local(img.after.data), null] },
        closedAt: HISTORY_AT,
      }),
      refJob('WG-2042', {
        stage: 'closed',
        photos: { before: [local(img.before.data), null], after: [local(img.after.data), null] },
        closedAt: HISTORY_AT,
      }),
      refJob('WG-2043', { stage: 'accepted' }),
    ]),
};

/** DEV-01: release control on the accepted dock (reference handler without a visible trigger). */
const DEV01 = {
  id: 'DEV-01',
  kind: 'appendHtml',
  selector: '.task-dock',
  html: '<button class="text-btn" data-action="defer">لا أستطيع تنفيذ هذه المهمة</button>',
  reason:
    'Reference handles defer at the accepted stage but shows the control only when assigned; owner decision required.',
};

/** Reference-only step: apply DEV-01 right after the task opens, before later clicks scroll. */
const declareDev01 = { declare: [DEV01] };

const open = (key) => ({ click: `[data-action="open-job"][data-id="{${key}}"]` });
const click = (selector) => ({ click: selector });
/** Closed jobs are not on «يومي»: open them from the «منتهية» task filter (both sides). */
const openClosed = (key) => [
  click('.nav-item[data-action="tasks"]'),
  click('[data-action="task-filter"][data-value="done"]'),
  open(key),
];

/** One task in a stage, the other two accepted. */
function single(key, stage, refStage, over = {}, refOver = {}) {
  return {
    setup: (c, img) => {
      for (const k of SEED_KEYS) {
        if (k === key) c.seedTask(k, { stage, ...(typeof over === 'function' ? over(img) : over) });
        else c.seedTask(k, { stage: 'ACCEPTED' });
      }
    },
    ref: (img) =>
      refState(
        SEED_KEYS.map((id) =>
          id === key
            ? refJob(id, {
                stage: refStage,
                ...(typeof refOver === 'function' ? refOver(img) : refOver),
              })
            : refJob(id, { stage: 'accepted' }),
        ),
      ),
  };
}

const withBefore = (img) => ({ evidence: { BEFORE: [img.before.id, null], AFTER: [null, null] } });
const refBefore = (img) => ({
  photos: { before: [local(img.before.data), null], after: [null, null] },
});
const withBoth = (img) => ({
  checked: ['exterior', 'wheels', 'interior', 'quality'],
  evidence: { BEFORE: [img.before.id, null], AFTER: [img.after.id, null] },
});
const refBoth = (img) => ({
  checks: [0, 1, 2, 3],
  photos: { before: [local(img.before.data), null], after: [local(img.after.data), null] },
});

const SCENARIOS = [
  {
    name: 'home-offers-c3',
    setup: () => {},
    ref: () => refState(SEED_KEYS.map((id) => refJob(id))),
    extra: [
      {
        id: 'D10',
        kind: 'removeAll',
        selector: '.job-card .job-vehicle, .job-card .job-service, .job-card .job-footer',
        reason: 'C3: Booking refuses the technician view while the offer is not accepted.',
      },
    ],
  },
  {
    name: 'home-offers-cr-requested',
    expose: true,
    setup: () => {},
    ref: () => refState(SEED_KEYS.map((id) => refJob(id))),
  },
  { name: 'home-accepted', ...allAccepted },
  {
    name: 'home-active',
    ...single(
      'WG-2041',
      'IN_SERVICE',
      'wash',
      (img) => ({ checked: ['exterior', 'wheels'], ...withBefore(img) }),
      (img) => ({ checks: [0, 1], ...refBefore(img) }),
    ),
  },
  {
    name: 'home-break',
    setup: (c) => {
      allAccepted.setup(c);
      c.setAvailability('ON_BREAK');
    },
    ref: () =>
      refState(
        SEED_KEYS.map((id) => refJob(id, { stage: 'accepted' })),
        false,
      ),
  },
  { name: 'sheet-notifications', ...allAccepted, steps: [click('[data-action="notifications"]')] },
  { name: 'tasks-active', ...ledger, steps: [click('.nav-item[data-action="tasks"]')] },
  {
    name: 'tasks-done',
    ...ledger,
    steps: [
      click('.nav-item[data-action="tasks"]'),
      click('[data-action="task-filter"][data-value="done"]'),
    ],
  },
  {
    name: 'tasks-follow',
    ...ledger,
    steps: [
      click('.nav-item[data-action="tasks"]'),
      click('[data-action="task-filter"][data-value="follow"]'),
    ],
  },
  {
    name: 'tasks-follow-empty',
    ...allAccepted,
    steps: [
      click('.nav-item[data-action="tasks"]'),
      click('[data-action="task-filter"][data-value="follow"]'),
    ],
  },
  { name: 'collections-all', ...ledger, steps: [click('.nav-item[data-action="collections"]')] },
  {
    name: 'collections-cash',
    ...ledger,
    steps: [
      click('.nav-item[data-action="collections"]'),
      click('[data-action="collection-filter"][data-value="cash"]'),
    ],
  },
  {
    name: 'collections-follow',
    ...ledger,
    steps: [
      click('.nav-item[data-action="collections"]'),
      click('[data-action="collection-filter"][data-value="follow"]'),
    ],
  },
  {
    name: 'collections-empty',
    ...allAccepted,
    steps: [click('.nav-item[data-action="collections"]')],
  },
  { name: 'profile', ...allAccepted, steps: [click('.nav-item[data-action="profile"]')] },
  {
    name: 'task-assigned-c3',
    setup: () => {},
    ref: () => refState(SEED_KEYS.map((id) => refJob(id))),
    steps: [open('WG-2041')],
    // Everything below the heading (and the header area line) is a declared data-gap band.
    mask: ['.header-center small'],
    maskBelow: '#main .heading',
  },
  {
    name: 'task-assigned-cr-requested',
    expose: true,
    setup: () => {},
    ref: () => refState(SEED_KEYS.map((id) => refJob(id))),
    steps: [open('WG-2041')],
  },
  { name: 'task-accepted', ...allAccepted, steps: [open('WG-2041'), declareDev01] },
  { name: 'task-route', ...single('WG-2041', 'EN_ROUTE', 'route'), steps: [open('WG-2041')] },
  {
    name: 'task-before-empty',
    ...single('WG-2041', 'ARRIVED', 'before'),
    steps: [open('WG-2041')],
  },
  {
    name: 'task-before-photo',
    ...single('WG-2041', 'ARRIVED', 'before', withBefore, refBefore),
    steps: [open('WG-2041')],
  },
  {
    name: 'task-wash-partial',
    ...single(
      'WG-2041',
      'IN_SERVICE',
      'wash',
      (img) => ({ checked: ['exterior', 'wheels'], ...withBefore(img) }),
      (img) => ({ checks: [0, 1], ...refBefore(img) }),
    ),
    steps: [open('WG-2041')],
  },
  {
    name: 'task-after-photos',
    ...single('WG-2041', 'DOCUMENTING', 'after', withBoth, refBoth),
    steps: [open('WG-2041')],
  },
  {
    name: 'task-handoff-cash',
    ...single('WG-2041', 'FINISHED', 'handoff', withBoth, refBoth),
    steps: [open('WG-2041')],
  },
  {
    name: 'task-handoff-sham',
    ...single('WG-2042', 'FINISHED', 'handoff', withBoth, refBoth),
    steps: [open('WG-2042')],
  },
  { name: 'task-closed-collected', ...ledger, steps: openClosed('WG-2041') },
  { name: 'task-closed-sham', ...ledger, steps: openClosed('WG-2042') },
  {
    name: 'task-closed-uncollected',
    ...single(
      'WG-2041',
      'CLOSED',
      'closed',
      (img) => ({
        ...withBoth(img),
        collection: {
          outcome: 'CASH_NOT_COLLECTED',
          amount: null,
          reason: 'لم يكن المبلغ جاهزًا',
          declaredAt: HISTORY_AT,
          lateAmount: null,
          lateDeclaredAt: null,
        },
      }),
      (img) => ({ ...refBoth(img), cashIssue: 'لم يكن المبلغ جاهزًا', closedAt: HISTORY_AT }),
    ),
    steps: openClosed('WG-2041'),
  },
  {
    name: 'task-released',
    ...single('WG-2041', 'RELEASED', 'closed', {}, { issue: 'deferred', closedAt: HISTORY_AT }),
    steps: openClosed('WG-2041'),
    extra: [
      {
        id: 'D10',
        kind: 'text',
        from: 'المزة · ',
        to: '',
        reason: 'After release Booking refuses the view: no area in the header.',
      },
      {
        id: 'D10',
        kind: 'emptyText',
        selector: '.dock-hint > span:last-child',
        reason: 'After release Booking refuses the view: no order value.',
      },
    ],
  },
  {
    name: 'sheet-task-menu',
    ...allAccepted,
    steps: [open('WG-2041'), declareDev01, click('[data-action="task-menu"]')],
  },
  {
    name: 'sheet-contact',
    ...allAccepted,
    steps: [open('WG-2041'), declareDev01, click('#main [data-action="contact"]')],
  },
  {
    name: 'sheet-message-preview',
    ...allAccepted,
    steps: [
      open('WG-2041'),
      declareDev01,
      click('#main [data-action="contact"]'),
      click('[data-action="message-preview"]'),
    ],
  },
  {
    name: 'sheet-breakdown',
    ...allAccepted,
    steps: [open('WG-2041'), declareDev01, click('#main [data-action="breakdown"]')],
  },
  {
    name: 'sheet-history',
    setup: (c) => {
      c.seedTask('WG-2041', {
        stage: 'EN_ROUTE',
        history: [
          { at: HISTORY_AT, action: 'accepted' },
          { at: '2026-09-20T05:52:00.000Z', action: 'departed' },
        ],
      });
      c.seedTask('WG-2042', { stage: 'ACCEPTED' });
      c.seedTask('WG-2043', { stage: 'ACCEPTED' });
    },
    ref: () =>
      refState([
        refJob('WG-2041', {
          stage: 'route',
          history: [
            { text: 'استلام المهمة', at: HISTORY_AT },
            { text: 'بدء التوجّه · محاكاة', at: '2026-09-20T05:52:00.000Z' },
          ],
        }),
        refJob('WG-2042', { stage: 'accepted' }),
        refJob('WG-2043', { stage: 'accepted' }),
      ]),
    steps: [
      open('WG-2041'),
      click('[data-action="task-menu"]'),
      click('.sheet-body [data-action="history"]'),
    ],
  },
  {
    name: 'sheet-arrival',
    ...single('WG-2041', 'EN_ROUTE', 'route'),
    steps: [open('WG-2041'), click('[data-action="primary"]')],
  },
  {
    name: 'sheet-photo-options',
    ...single('WG-2041', 'ARRIVED', 'before'),
    steps: [open('WG-2041'), click('[data-action="photo-options"][data-index="0"]')],
  },
  {
    name: 'sheet-photo-options-filled',
    ...single('WG-2041', 'ARRIVED', 'before', withBefore, refBefore),
    steps: [open('WG-2041'), click('[data-action="photo-options"][data-index="0"]')],
  },
  {
    name: 'sheet-before-view',
    ...single(
      'WG-2041',
      'IN_SERVICE',
      'wash',
      (img) => ({ ...withBefore(img), conditionNote: 'خدش موجود مسبقًا على الباب' }),
      (img) => ({ ...refBefore(img), notes: 'خدش موجود مسبقًا على الباب' }),
    ),
    steps: [open('WG-2041'), click('[data-action="before-view"]')],
  },
  {
    name: 'sheet-finish',
    ...single('WG-2041', 'DOCUMENTING', 'after', withBoth, refBoth),
    steps: [open('WG-2041'), click('[data-action="primary"]')],
  },
  {
    name: 'sheet-cash',
    ...single('WG-2041', 'FINISHED', 'handoff', withBoth, refBoth),
    steps: [open('WG-2041'), click('[data-action="cash-dialog"]')],
  },
  {
    name: 'sheet-cash-issue',
    ...single('WG-2041', 'FINISHED', 'handoff', withBoth, refBoth),
    steps: [open('WG-2041'), click('[data-action="cash-issue"]')],
  },
  {
    name: 'sheet-result',
    ...single('WG-2041', 'FINISHED', 'handoff', withBoth, refBoth),
    steps: [open('WG-2041'), click('[data-action="result-preview"]')],
  },
  {
    name: 'sheet-handoff-confirm',
    ...single('WG-2042', 'FINISHED', 'handoff', withBoth, refBoth),
    steps: [open('WG-2042'), click('[data-action="primary"]')],
  },
  {
    name: 'sheet-payment-followup',
    ...single('WG-2042', 'FINISHED', 'handoff', withBoth, refBoth),
    steps: [open('WG-2042'), click('[data-action="payment-followup"]')],
  },
  {
    name: 'sheet-defer',
    expose: true,
    setup: () => {},
    ref: () => refState(SEED_KEYS.map((id) => refJob(id))),
    steps: [open('WG-2041'), click('[data-action="defer"]')],
  },
  {
    name: 'sheet-help',
    ...allAccepted,
    steps: [
      open('WG-2041'),
      declareDev01,
      click('[data-action="task-menu"]'),
      click('[data-action="help"]'),
    ],
  },
];

// ------------------------------------------------------------------ helpers

async function settle(page) {
  await page.waitForFunction(
    () => [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    null,
    { timeout: 10_000 },
  );
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
  });
  await page.waitForTimeout(60);
}

/**
 * Run the click steps. On the reference (`regions` given) the DECLARED operations
 * are applied before every click as well, so that the reference layout at click time
 * (and therefore Playwright's scroll-into-view) equals the candidate's. The operations
 * are idempotent; their regions are recorded.
 */
async function runSteps(page, steps, ids, regions = null) {
  const declare = async (ops) => {
    regions.push(...(await page.evaluate(applyDeclaredInPage, ops)));
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  };
  for (const step of steps ?? []) {
    if (step.declare) {
      if (regions) await declare(step.declare);
      continue;
    }
    if (regions) await declare(DECLARED);
    const selector = step.click.replace(/\{(WG-\d{4})\}/g, (_, key) => ids[key]);
    await page.locator(selector).first().click();
    await page.waitForTimeout(40);
  }
}

async function capture(page, fullPage) {
  await applyCaptureCss(page);
  await page.screenshot(screenshotOptions(fullPage));
  return page.screenshot(screenshotOptions(fullPage));
}

async function maskRects(page, selectors) {
  return page.evaluate((list) => {
    const rects = [];
    for (const selector of list) {
      for (const el of document.querySelectorAll(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height)
          rects.push({ x: r.x, y: r.y, width: r.width, height: r.height, selector });
      }
    }
    return rects;
  }, selectors);
}

async function paintMask(browser, png, rects) {
  const page = await browser.newPage({ viewport: { width: 16, height: 16 } });
  try {
    const base64 = await page.evaluate(
      async ({ data, rects }) => {
        const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        ctx.fillStyle = '#ff00ff';
        for (const r of rects)
          ctx.fillRect(
            Math.floor(r.x),
            Math.floor(r.y),
            Math.ceil(r.width) + 1,
            Math.ceil(r.height) + 1,
          );
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { data: png.toString('base64'), rects },
    );
    return Buffer.from(base64, 'base64');
  } finally {
    await page.close();
  }
}

test(
  'operator-web visual parity against the approved technician reference',
  { timeout: 120 * 60_000 },
  async () => {
    mkdirSync(OUT, { recursive: true });
    const css = [
      '01-reference-base.css',
      '02-reference-sheets-motion.css',
      '03-reference-compact.css',
    ]
      .map((f) => readFileSync(`${ROOT}apps/operator-web/src/styles/${f}`, 'utf8'))
      .join('');
    const html = readFileSync(
      `${ROOT}design/reference/approved/washgo-technician-interactive.html`,
      'utf8',
    );
    assert.equal(
      css,
      html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>')),
      'Port CSS must equal the reference <style> block byte for byte',
    );

    const stack = await startStack({ fixedClock: true });
    const refServer = await startReferenceServer();
    const browser = await launch();
    const summary = {
      schemaVersion: 1,
      label:
        'P03-C5 operator-web reference vs candidate (fixture doubles; not service integration)',
      sourceSha: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      sourceDirty:
        execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !==
        '',
      browserVersion: browser.version(),
      rendering: RENDERING,
      declared: DECLARED.map(({ id, kind, reason }) => ({ id, kind, reason })),
      captures: [],
    };
    const failures = [];
    try {
      const img = {
        before: { bytes: await generateJpeg(browser, { hue: 40 }) },
        after: { bytes: await generateJpeg(browser, { hue: 120 }) },
      };
      for (const which of ['before', 'after'])
        img[which].data = `data:image/jpeg;base64,${img[which].bytes.toString('base64')}`;
      const ids = Object.fromEntries(
        SEED_KEYS.map((k) => [k, stack.fixture.control.bookingIdOf(k)]),
      );
      const refIds = Object.fromEntries(SEED_KEYS.map((k) => [k, k]));
      const contexts = new Map();
      for (const width of WIDTHS) {
        const ref = await (async () => {
          const context = await browser.newContext({
            viewport: { width, height: RENDERING.height },
            deviceScaleFactor: RENDERING.deviceScaleFactor,
            locale: RENDERING.locale,
            timezoneId: RENDERING.timezoneId,
            colorScheme: RENDERING.colorScheme,
            reducedMotion: RENDERING.reducedMotion,
          });
          await context.addInitScript({ content: deterministicInit() });
          return { context };
        })();
        const candContext = await newOperatorContext(browser, stack.gateway.origin, {
          width,
          deterministic: true,
        });
        contexts.set(width, { ref, cand: { context: candContext } });
      }

      /** A fresh page per capture; a navigation that hangs is retried once on a new page (no pixel tolerance changes). */
      async function freshPage(context, url) {
        for (let attempt = 0; ; attempt += 1) {
          const page = await context.newPage();
          try {
            await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
            return page;
          } catch (error) {
            await page.close().catch(() => {});
            if (attempt >= 1) throw error;
          }
        }
      }

      async function captureWidth(scenario, refStateValue, width) {
        const { ref, cand } = contexts.get(width);
        if (process.env.OPERATOR_VISUAL_DEBUG) console.log('capture', scenario.name, width);
        // The reference re-persists its state on visibilitychange; the outgoing document's
        // setItem is neutralised after injecting so the reload reads the injected state.
        const refPage = await freshPage(ref.context, `${refServer.origin}/technician`);
        const candPage = await freshPage(cand.context, `${stack.gateway.origin}/`);
        try {
          await refPage.evaluate(
            ([key, value]) => {
              localStorage.setItem(key, value);
              Storage.prototype.setItem = () => {};
            },
            [KEY, JSON.stringify(refStateValue)],
          );
          await refPage.reload({ waitUntil: 'load' });
          await refPage.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
          // Declared additions that change layout are applied inside the step list (reference only).
          const preRegions = [];
          await runSteps(refPage, scenario.steps, refIds, preRegions);
          await settle(refPage);
          await candPage.evaluate(() => localStorage.clear());
          await candPage.reload({ waitUntil: 'load' });
          await candPage.waitForFunction(
            () =>
              document.querySelector('#main')?.children.length > 0 &&
              document.querySelector('#storage-warning')?.hidden === true,
            null,
            { timeout: 15_000 },
          );
          await runSteps(candPage, scenario.steps, ids);
          await settle(candPage);

          if (process.env.OPERATOR_VISUAL_DEBUG)
            console.log(
              'scroll',
              scenario.name,
              width,
              await refPage.evaluate(() => [
                scrollY,
                document.documentElement.scrollHeight,
                getComputedStyle(document.documentElement).getPropertyValue('--dock'),
              ]),
              await candPage.evaluate(() => [
                scrollY,
                document.documentElement.scrollHeight,
                getComputedStyle(document.documentElement).getPropertyValue('--dock'),
              ]),
            );
          const fullPage = !scenario.mask;
          const raw = await capture(refPage, fullPage);
          const final = await refPage.evaluate(applyDeclaredInPage, [
            ...DECLARED,
            ...(scenario.extra ?? []),
          ]);
          const seen = new Set();
          const regions = [...preRegions, ...final].filter((r) => {
            const key = JSON.stringify(r);
            return seen.has(key) ? false : (seen.add(key), true);
          });
          await settle(refPage);
          let reference = await capture(refPage, fullPage);
          let candidate = await capture(candPage, fullPage);
          const rawResult = await comparePngBuffers(
            browser,
            raw,
            candidate,
            RENDERING.channelThreshold,
          );
          let maskedRects = [];
          if (scenario.mask) {
            maskedRects = [
              ...(await maskRects(refPage, scenario.mask)),
              ...(await maskRects(candPage, scenario.mask)),
            ];
            for (const page of [refPage, candPage]) {
              maskedRects.push(
                await page.evaluate((selector) => {
                  const r = document.querySelector(selector).getBoundingClientRect();
                  return {
                    x: 0,
                    y: r.bottom,
                    width: innerWidth,
                    height: innerHeight - r.bottom,
                    selector: `below ${selector}`,
                  };
                }, scenario.maskBelow),
              );
            }
            reference = await paintMask(browser, reference, maskedRects);
            candidate = await paintMask(browser, candidate, maskedRects);
          }
          const result = await comparePngBuffers(
            browser,
            reference,
            candidate,
            RENDERING.channelThreshold,
          );
          const base = `${scenario.name}-${width}`;
          writeFileSync(`${OUT}/${base}-reference-raw.png`, raw);
          writeFileSync(`${OUT}/${base}-reference-declared.png`, reference);
          writeFileSync(`${OUT}/${base}-candidate.png`, candidate);
          if (result.diffBuffer) writeFileSync(`${OUT}/${base}-diff.png`, result.diffBuffer);
          const entry = {
            scenario: scenario.name,
            width,
            fixtureMode: scenario.expose
              ? 'CR-requested offer booking visibility (non-default)'
              : 'C3 as specified',
            capture: fullPage ? 'fullPage' : 'viewport (masked)',
            sameDimensions: result.sameDimensions,
            size:
              `${result.width}x${result.height}` +
              (result.sameDimensions ? '' : ` vs ${result.actualWidth}x${result.actualHeight}`),
            changedPixels: result.changedPixels,
            diffRatio: result.diffRatio,
            rawDiffRatio: rawResult.diffRatio,
            declaredRegions: regions.filter((r) => !r.hidden),
            declaredIds: [...new Set(regions.map((r) => r.id))],
            maskedRegions: maskedRects,
          };
          summary.captures.push(entry);
          if (!result.sameDimensions || result.changedPixels !== 0)
            failures.push(`${base}: ${entry.size} changed=${result.changedPixels}`);
        } finally {
          await refPage.close();
          await candPage.close();
        }
      }

      for (const scenario of SCENARIOS) {
        if (ONLY && !ONLY.test(scenario.name)) continue;
        const control = stack.fixture.control;
        control.reset();
        control.setExposeOfferBooking(!!scenario.expose);
        img.before.id = control.putObject(img.before.bytes);
        img.after.id = control.putObject(img.after.bytes);
        scenario.setup(control, img);
        const refStateValue = scenario.ref(img);
        // Widths run in pairs; the fixture state is only read while capturing.
        for (let i = 0; i < WIDTHS.length; i += 2) {
          await Promise.all(
            WIDTHS.slice(i, i + 2).map((width) => captureWidth(scenario, refStateValue, width)),
          );
        }
      }
      summary.captures.sort(
        (x, y) =>
          SCENARIOS.findIndex((s) => s.name === x.scenario) -
            SCENARIOS.findIndex((s) => s.name === y.scenario) || x.width - y.width,
      );
    } finally {
      summary.accepted = failures.length === 0;
      summary.failures = failures;
      writeFileSync(`${OUT}/visual-summary.json`, JSON.stringify(summary, null, 2) + '\n');
      await browser.close();
      await refServer.close();
      await stack.close();
    }
    assert.deepEqual(failures, [], `Undeclared visual differences:\n${failures.join('\n')}`);
  },
);
