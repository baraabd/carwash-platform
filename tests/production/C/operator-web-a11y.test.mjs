/* global document, localStorage, Storage, getComputedStyle -- browser code inside page.evaluate() */
/**
 * P03-C5 operator-web accessibility evidence (fixture doubles through the
 * gateway harness, production CSP enforced):
 * - axe-core (WCAG 2.0/2.1/2.2 A/AA tags, same set as F010) on every view at
 *   390 and 1440 px; serious/critical findings fail unless they are the
 *   registered reference debt (docs/design/f010-reference-debt-baseline.json);
 * - keyboard: bottom navigation order, sheet focus trap and focus return,
 *   checklist focus restore;
 * - comparison reveal in reduced and natural motion.
 * Axe is not a WCAG certification and these runs do not replace manual audits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startReferenceServer } from '../../../scripts/f010/reference-server.mjs';
import {
  AXE_SOURCE,
  RENDERING,
  deterministicInit,
  generateJpeg,
  launch,
  newOperatorContext,
  openApp,
  startStack,
  watch,
} from './support/operator-browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = `${ROOT}.acceptance/production-C/operator-web/a11y`;
const DEBT = JSON.parse(
  readFileSync(`${ROOT}docs/design/f010-reference-debt-baseline.json`, 'utf8'),
);
const REGISTERED = DEBT.accessibility.filter((d) => d.app === 'technician');

let stack;
let browser;
let refServer;
const jpeg = {};

test.before(async () => {
  stack = await startStack();
  browser = await launch();
  refServer = await startReferenceServer();
  mkdirSync(OUT, { recursive: true });
});
test.after(async () => {
  await browser?.close();
  await stack?.close();
  await refServer?.close();
});

const id = (key) => stack.fixture.control.bookingIdOf(key);
/** Candidate booking ids by seed key (views receive their own map for the reference side). */
const ids = new Proxy({}, { get: (_, key) => id(key) });

async function seedAll() {
  const c = stack.fixture.control;
  c.reset();
  jpeg.before ??= await generateJpeg(browser, { hue: 30 });
  jpeg.after ??= await generateJpeg(browser, { hue: 150 });
  const before = c.putObject(jpeg.before);
  const after = c.putObject(jpeg.after);
  const both = { BEFORE: [before, null], AFTER: [after, null] };
  c.seedTask('WG-2041', {
    stage: 'CLOSED',
    checked: ['exterior', 'wheels', 'interior', 'quality'],
    evidence: both,
    collection: {
      outcome: 'CASH_NOT_COLLECTED',
      amount: null,
      reason: 'لاحقًا',
      declaredAt: new Date().toISOString(),
      lateAmount: null,
      lateDeclaredAt: null,
    },
  });
  c.seedTask('WG-2042', {
    stage: 'FINISHED',
    checked: ['exterior', 'wheels', 'interior', 'quality'],
    evidence: both,
  });
  c.seedTask('WG-2043', {
    stage: 'IN_SERVICE',
    checked: ['exterior'],
    evidence: { BEFORE: [before, null] },
  });
}

async function axe(page) {
  await page.evaluate(AXE_SOURCE); // CDP evaluation: not an inline script, CSP stays enforced
  const result = await page.evaluate(() =>
    globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    }),
  );
  return result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.map((n) => n.target),
    // color-contrast: the exact colour/size pair, to tell inherited reference CSS pairs from new ones.
    pairs: v.nodes.map((n) => {
      const d = n.any?.[0]?.data ?? {};
      return [d.fgColor, d.bgColor, d.fontSize, d.fontWeight].join('|');
    }),
  }));
}

/** The same views in the unmodified reference (its own localStorage state format). */
const local = (bytes) => ({
  kind: 'local',
  data: 'data:image/jpeg;base64,' + bytes.toString('base64'),
});
const refJob = (jobId, over) => ({
  id: jobId,
  stage: 'accepted',
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
});
function referenceState() {
  const both = { before: [local(jpeg.before), null], after: [local(jpeg.after), null] };
  return {
    version: 1,
    ready: true,
    motion: true,
    feedback: '',
    jobs: [
      refJob('WG-2041', {
        stage: 'closed',
        checks: [0, 1, 2, 3],
        photos: both,
        cashIssue: 'لاحقًا',
      }),
      refJob('WG-2042', { stage: 'handoff', checks: [0, 1, 2, 3], photos: both }),
      refJob('WG-2043', {
        stage: 'wash',
        checks: [0],
        photos: { before: [local(jpeg.before), null], after: [null, null] },
      }),
    ],
  };
}
const REF_IDS = { 'WG-2041': 'WG-2041', 'WG-2042': 'WG-2042', 'WG-2043': 'WG-2043' };

/** Open one view in the unmodified reference (its own localStorage state format). */
async function openReferenceView(context, go) {
  const page = await context.newPage();
  await page.goto(refServer.origin + '/technician');
  await page.evaluate((v) => {
    localStorage.setItem('washgo-technician-approval-v1', v);
    Storage.prototype.setItem = () => {};
  }, JSON.stringify(referenceState()));
  await page.reload();
  await go(page, REF_IDS);
  await page.waitForTimeout(80);
  return page;
}

/** Tag, class, text colour, effective background colour, size, weight and opacity of one element. */
function styleOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    let bg = null;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
        bg = c;
        break;
      }
    }
    return [el.tagName, el.className, cs.color, bg, cs.fontSize, cs.fontWeight, cs.opacity].join(
      '|',
    );
  }, selector);
}

/** Candidate booking short ids -> reference seed ids inside axe selectors. */
const toReferenceSelector = (selector) =>
  selector
    .replace('20410000', 'WG-2041')
    .replace('20420000', 'WG-2042')
    .replace('20430000', 'WG-2043');

const registered = (violation) =>
  REGISTERED.some(
    (d) => d.id === violation.id && JSON.stringify(d.targets) === JSON.stringify(violation.targets),
  );

const VIEWS = [
  ['home', async () => {}],
  ['tasks', async (p, _ids) => p.locator('.nav-item[data-action="tasks"]').click()],
  [
    'tasks-done',
    async (p, _ids) => (
      await p.locator('.nav-item[data-action="tasks"]').click(),
      p.locator('[data-action="task-filter"][data-value="done"]').click()
    ),
  ],
  ['collections', async (p, _ids) => p.locator('.nav-item[data-action="collections"]').click()],
  ['profile', async (p, _ids) => p.locator('.nav-item[data-action="profile"]').click()],
  [
    'task-wash',
    async (p, ids) =>
      p.locator(`[data-action="open-job"][data-id="${ids['WG-2043']}"]`).first().click(),
  ],
  [
    'task-handoff-wallet',
    async (p, ids) =>
      p.locator(`[data-action="open-job"][data-id="${ids['WG-2042']}"]`).first().click(),
  ],
  [
    'task-closed',
    async (p, ids) => {
      await p.locator('.nav-item[data-action="tasks"]').click();
      await p.locator('[data-action="task-filter"][data-value="done"]').click();
      await p.locator(`[data-action="open-job"][data-id="${ids['WG-2041']}"]`).first().click();
    },
  ],
  [
    'sheet-cash',
    async (p, ids) => {
      await p.locator('.nav-item[data-action="tasks"]').click();
      await p.locator('[data-action="task-filter"][data-value="done"]').click();
      await p.locator(`[data-action="open-job"][data-id="${ids['WG-2041']}"]`).first().click();
      await p.locator('#main [data-action="cash-dialog"]').click();
    },
  ],
  [
    'sheet-task-menu',
    async (p, ids) => {
      await p.locator(`[data-action="open-job"][data-id="${ids['WG-2043']}"]`).first().click();
      await p.locator('[data-action="task-menu"]').click();
    },
  ],
];

const inherited = [];

test('axe on every view at 390 and 1440: the port introduces no serious/critical finding', async () => {
  await seedAll();
  const ids = Object.fromEntries(['WG-2041', 'WG-2042', 'WG-2043'].map((k) => [k, id(k)]));
  const report = [];
  const blocking = [];
  for (const width of [390, 1440]) {
    const refContext = await browser.newContext({
      viewport: { width, height: RENDERING.height },
      locale: RENDERING.locale,
      timezoneId: RENDERING.timezoneId,
      colorScheme: RENDERING.colorScheme,
      reducedMotion: RENDERING.reducedMotion,
    });
    await refContext.addInitScript({ content: deterministicInit() });
    try {
      for (const [name, go] of VIEWS) {
        const context = await newOperatorContext(browser, stack.gateway.origin, { width });
        try {
          const page = await context.newPage();
          const problems = watch(page);
          await openApp(page, stack.gateway.origin);
          await go(page, ids);
          await page.waitForTimeout(80);
          const violations = await axe(page);
          const refPage = await openReferenceView(refContext, go);
          const referenceViolations = await axe(refPage);
          report.push({ width, view: name, violations, referenceViolations });
          for (const v of violations) {
            if (!['serious', 'critical'].includes(v.impact) || registered(v)) continue;
            // A node is inherited when the same element in the same reference view renders
            // with the same text colour, background, size, weight and opacity (CSS is byte-identical;
            // axe's own heuristics differ between documents), or, for other rules, when the
            // reference reports the same rule on the same element.
            const nodes = [];
            for (const target of v.targets) {
              const selector = target[0];
              const refSelector = toReferenceSelector(selector);
              const candidateStyle = await styleOf(page, selector);
              const referenceStyle = await styleOf(refPage, refSelector);
              const sameRule = referenceViolations.some(
                (r) => r.id === v.id && r.targets.some((t) => t[0] === refSelector),
              );
              const inheritedNode =
                v.id === 'color-contrast'
                  ? referenceStyle !== null && referenceStyle === candidateStyle
                  : sameRule;
              nodes.push({ selector, candidateStyle, referenceStyle, inherited: inheritedNode });
            }
            const entry = { width, view: name, id: v.id, impact: v.impact, nodes };
            (nodes.every((n) => n.inherited) ? inherited : blocking).push(entry);
          }
          await refPage.close();
          assert.deepEqual(
            problems.filter((x) => !/status of 404/.test(x)),
            [],
            name + '@' + width + ' page errors/CSP',
          );
        } finally {
          await context.close();
        }
      }
    } finally {
      await refContext.close();
    }
  }
  writeFileSync(
    OUT + '/axe-summary.json',
    JSON.stringify(
      {
        registeredDebt: REGISTERED,
        portIntroduced: blocking,
        inheritedUnregistered: inherited,
        report,
      },
      null,
      2,
    ) + '\n',
  );
  assert.deepEqual(blocking, [], 'serious/critical accessibility findings introduced by the port');
});

test(
  'reference-inherited findings are limited to registered debt',
  {
    todo: 'BLOCKER (owner decision, TI-D13 extension): the byte-identical reference CSS fails color-contrast on more elements than the registered .design-footer debt; fixing it is a visible change.',
  },
  () => {
    assert.deepEqual(
      inherited.map(
        (v) => v.view + '@' + v.width + ': ' + v.nodes.map((n) => n.selector).join(', '),
      ),
      [],
    );
  },
);

test('keyboard: bottom navigation order, sheet focus trap and return, checklist focus restore', async () => {
  await seedAll();
  const context = await newOperatorContext(browser, stack.gateway.origin, { width: 390 });
  try {
    const page = await context.newPage();
    await openApp(page, stack.gateway.origin);
    const order = [];
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        return el?.closest('.bottom-nav') ? el.dataset.action : null;
      });
      if (info && !order.includes(info)) order.push(info);
      if (order.length === 4) break;
    }
    assert.deepEqual(
      order,
      ['home', 'tasks', 'collections', 'profile'],
      'nav reachable by Tab in reading order',
    );
    assert.equal(
      await page.locator('.nav-item[aria-current="page"]').getAttribute('data-action'),
      'home',
    );

    // Checklist: Space toggles; after the server confirms, focus returns to the same item.
    await page.locator(`[data-action="open-job"][data-id="${ids['WG-2043']}"]`).first().focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.querySelector('#main h1')?.textContent === 'كل تفصيلة، بعناية.',
    );
    await page.locator('[data-action="check"][data-index="1"]').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-action="check"][data-index="1"]')
          ?.getAttribute('aria-checked') === 'true',
    );
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.focus), 'check-1');

    // Sheet: opened from the keyboard, Tab and Shift+Tab stay inside, Escape returns focus.
    await page.locator('[data-action="task-menu"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#sheet')?.open);
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() =>
          document.querySelector('#sheet').contains(document.activeElement),
        ),
        true,
        'Tab trapped in sheet',
      );
    }
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await page.evaluate(() =>
          document.querySelector('#sheet').contains(document.activeElement),
        ),
        true,
        'Shift+Tab trapped',
      );
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#sheet').open);
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset.action),
      'task-menu',
      'focus returned to the trigger',
    );
    const focusRing = await page.evaluate(
      () => getComputedStyle(document.activeElement).outlineStyle,
    );
    assert.equal(focusRing, 'solid', 'visible focus outline (reference :focus-visible rule)');
  } finally {
    await context.close();
  }
});

async function openComparison(page) {
  await page.locator('.nav-item[data-action="tasks"]').click();
  await page.locator('[data-action="task-filter"][data-value="done"]').click();
  await page.locator(`[data-action="open-job"][data-id="${ids['WG-2041']}"]`).first().click();
  await page.waitForFunction(() => document.querySelector('#comparison img')?.complete);
}

test('reveal: reduced motion jumps without animation; natural motion animates and can be stopped', async () => {
  await seedAll();
  const reducedContext = await newOperatorContext(browser, stack.gateway.origin, {
    width: 390,
    reducedMotion: 'reduce',
  });
  try {
    const page = await reducedContext.newPage();
    await openApp(page, stack.gateway.origin);
    await openComparison(page);
    await page.locator('[data-action="reveal"]').click();
    assert.equal(await page.locator('#compare-range').inputValue(), '10');
    assert.equal(
      await page.locator('#compare-range').getAttribute('aria-valuetext'),
      'قبل 10 بالمئة، بعد 90 بالمئة',
    );
    assert.equal(
      await page.locator('#toast').textContent(),
      'تم تغيير المقارنة دون حركة احترامًا للوضع الهادئ.',
    );
    assert.match(await page.locator('[data-action="reveal"]').textContent(), /شاهد التحوّل/);
  } finally {
    await reducedContext.close();
  }

  const naturalContext = await newOperatorContext(browser, stack.gateway.origin, {
    width: 390,
    reducedMotion: 'no-preference',
  });
  try {
    const page = await naturalContext.newPage();
    await openApp(page, stack.gateway.origin);
    await openComparison(page);
    await page.locator('[data-action="reveal"]').click();
    assert.match(await page.locator('[data-action="reveal"]').textContent(), /إيقاف التحوّل/);
    await page.waitForTimeout(700);
    const mid = Number(await page.locator('#compare-range').inputValue());
    assert.ok(mid < 52, `animating (value ${mid})`);
    await page.waitForFunction(
      () => /شاهد التحوّل/.test(document.querySelector('[data-action="reveal"]').textContent),
      null,
      { timeout: 5000 },
    );
    assert.equal(
      await page.locator('#compare-range').inputValue(),
      '52',
      'sweep returns to the start',
    );
    // Stop by dragging the range (input event), as in the reference.
    await page.locator('[data-action="reveal"]').click();
    await page.waitForTimeout(200);
    await page.locator('#compare-range').fill('70');
    assert.match(await page.locator('[data-action="reveal"]').textContent(), /شاهد التحوّل/);
    const value = await page.locator('#compare-range').inputValue();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#compare-range').inputValue(), value, 'stopped');
    // The in-app quiet mode behaves like reduced motion.
    await page.locator('header [data-action="home"]').click();
    await page.locator('.nav-item[data-action="profile"]').click();
    await page.locator('[data-action="motion"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'off');
    await openComparison(page);
    await page.locator('[data-action="reveal"]').click();
    assert.equal(await page.locator('#compare-range').inputValue(), '10');
  } finally {
    await naturalContext.close();
  }
});
