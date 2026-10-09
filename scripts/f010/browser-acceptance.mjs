import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { APP_IDS, ROOT, loadRegistry, verifyRegisteredReferences } from './reference-registry.mjs';
import { startReferenceServer } from './reference-server.mjs';
import { comparePngBuffers } from './pixel-compare.mjs';
import { compareReferenceDebt, loadDebtBaseline } from './reference-debt.mjs';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const manifest = loadRegistry(ROOT);
const contract = manifest.rendering;
const debtBaseline = loadDebtBaseline(ROOT);
const configuredEvidence = process.env.F010_EVIDENCE_DIR;
const evidence = configuredEvidence
  ? resolve(configuredEvidence)
  : mkdtempSync(resolve(tmpdir(), 'washgo-f010-'));
mkdirSync(evidence, { recursive: true });

const deterministicScreenshot = Object.freeze({
  fullPage: true,
  animations: 'disabled',
  caret: 'hide',
  // Browser scrollbars, finite CSS transitions and backdrop-only filters are
  // browser/transient state, not part of the approved UI contract. Hiding them
  // during capture leaves layout/overflow measurements intact while keeping
  // rasterization deterministic for reference and future candidate captures.
  style: `
    html { scrollbar-width: none !important; scroll-behavior: auto !important; }
    *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
    *, *::before, *::after {
      animation: none !important;
      transition: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  `,
});

const git = (...args) =>
  execFileSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const deterministicInit = `(() => {
  const fixed = ${JSON.stringify(contract.fixedTime)};
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return new NativeDate(fixed).getTime(); }
  }
  Object.setPrototypeOf(FixedDate, NativeDate);
  Object.defineProperty(window, 'Date', { value: FixedDate });
  let seed = 0x6d2b79f5;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function openReference(browser, server, app, width) {
  const context = await browser.newContext({
    viewport: { width, height: contract.height },
    deviceScaleFactor: contract.deviceScaleFactor,
    locale: contract.locale,
    timezoneId: contract.timezoneId,
    colorScheme: contract.colorScheme,
    reducedMotion: contract.reducedMotion,
  });
  await context.addInitScript({ content: deterministicInit });
  const externalRequests = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1') {
      await route.continue();
      return;
    }
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) {
      await route.continue();
      return;
    }
    externalRequests.push(route.request().url());
    await route.abort();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const response = await page.goto(`${server.origin}/${app}`, { waitUntil: 'load' });
  assert.equal(response?.status(), 200);
  await page.evaluate(async () => {
    if (globalThis.document.fonts) await globalThis.document.fonts.ready;
  });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.waitForTimeout(80);
  return { context, page, externalRequests, pageErrors };
}

async function geometryAndKeyboard(page, expected) {
  const geometry = await page.evaluate(() => ({
    language: globalThis.document.documentElement.lang,
    direction: globalThis.document.documentElement.dir,
    viewportWidth: globalThis.window.innerWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    scrollHeight: globalThis.document.documentElement.scrollHeight,
    focusableCount: [
      ...globalThis.document.querySelectorAll(
        'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => {
      const style = globalThis.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        rect.width > 0 &&
        rect.height > 0
      );
    }).length,
  }));
  assert.equal(geometry.language, expected.language);
  assert.equal(geometry.direction, expected.direction);
  const horizontalOverflow = Math.max(0, geometry.scrollWidth - geometry.viewportWidth);
  assert.ok(geometry.focusableCount > 0, 'Reference must expose keyboard-focusable controls');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const element = globalThis.document.activeElement;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName,
      width: rect.width,
      height: rect.height,
      visible: globalThis.getComputedStyle(element).visibility !== 'hidden',
    };
  });
  assert.ok(focus && !['HTML', 'BODY'].includes(focus.tag) && focus.visible);
  return { ...geometry, horizontalOverflow, firstFocus: focus };
}

async function axeAudit(page) {
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () =>
    globalThis.axe.run(globalThis.document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      resultTypes: ['violations'],
    }),
  );
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      failureSummary: node.failureSummary,
    })),
  }));
  const blocking = violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact),
  );
  return { violations, blocking };
}

const verification = verifyRegisteredReferences({ allowRegistration: true });
assert.equal(verification.ok, true, verification.errors.join('\n'));

const server = await startReferenceServer();
const browser = await chromium.launch({
  headless: true,
  args: ['--font-render-hinting=none'],
});
const summary = {
  schemaVersion: 1,
  accepted: false,
  sourceSha: git('rev-parse', 'HEAD'),
  sourceTree: git('rev-parse', 'HEAD^{tree}'),
  sourceDirty: git('status', '--porcelain') !== '',
  browserVersion: browser.version(),
  referenceSet: manifest.referenceSet,
  rendering: contract,
  captures: [],
  driftProbe: null,
  accessibilityBlocking: [],
  geometryDebt: [],
};

try {
  assert.equal(summary.sourceDirty, false, 'F010 must run on a clean source tree');
  for (const app of APP_IDS) {
    const expected = manifest.references[app];
    for (const width of contract.viewports) {
      const session = await openReference(browser, server, app, width);
      try {
        // The first capture intentionally warms Chromium's full-page raster path.
        // It is discarded; determinism is asserted on two subsequent captures.
        await session.page.screenshot(deterministicScreenshot);
        await session.page.waitForTimeout(25);
        const first = await session.page.screenshot(deterministicScreenshot);
        await session.page.waitForTimeout(25);
        const second = await session.page.screenshot(deterministicScreenshot);
        const deterministic = await comparePngBuffers(
          browser,
          first,
          second,
          contract.channelThreshold,
        );
        assert.equal(deterministic.sameDimensions, true);
        if (deterministic.changedPixels !== 0) {
          writeFileSync(resolve(evidence, `nondeterministic-${app}-${width}-first.png`), first);
          writeFileSync(resolve(evidence, `nondeterministic-${app}-${width}-second.png`), second);
          if (deterministic.diffBuffer) {
            writeFileSync(
              resolve(evidence, `nondeterministic-${app}-${width}-diff.png`),
              deterministic.diffBuffer,
            );
          }
        }
        assert.equal(
          deterministic.changedPixels,
          0,
          `Non-deterministic pixels for ${app} at ${width}`,
        );
        const geometry = await geometryAndKeyboard(session.page, expected);
        const accessibility = await axeAudit(session.page);
        if (geometry.horizontalOverflow > 1) {
          summary.geometryDebt.push({
            app,
            width,
            viewportWidth: geometry.viewportWidth,
            scrollWidth: geometry.scrollWidth,
            overflowPixels: geometry.horizontalOverflow,
          });
        }
        assert.deepEqual(session.externalRequests, [], `External request from ${app}`);
        assert.deepEqual(session.pageErrors, [], `Page error in ${app}`);
        const fileName = `reference-${app}-${width}.png`;
        writeFileSync(resolve(evidence, fileName), first);
        writeFileSync(
          resolve(evidence, `axe-${app}-${width}.json`),
          JSON.stringify(accessibility, null, 2) + '\n',
        );
        if (accessibility.blocking.length > 0) {
          summary.accessibilityBlocking.push({
            app,
            width,
            violations: accessibility.blocking,
          });
        }
        summary.captures.push({
          app,
          width,
          screenshot: fileName,
          sha256: sha256(first),
          pixelDeterminism: {
            changedPixels: deterministic.changedPixels,
            diffRatio: deterministic.diffRatio,
          },
          geometry,
          accessibility: {
            violations: accessibility.violations.length,
            blocking: accessibility.blocking.length,
          },
        });
      } finally {
        await session.context.close();
      }
    }
  }

  const drift = await openReference(browser, server, 'customer', 390);
  try {
    await drift.page.screenshot(deterministicScreenshot);
    const baseline = await drift.page.screenshot(deterministicScreenshot);
    await drift.page.evaluate(() => {
      globalThis.document.documentElement.style.filter = 'hue-rotate(35deg)';
    });
    const changed = await drift.page.screenshot(deterministicScreenshot);
    const comparison = await comparePngBuffers(
      browser,
      baseline,
      changed,
      contract.channelThreshold,
    );
    assert.equal(comparison.sameDimensions, true);
    assert.ok(comparison.changedPixels > 0, 'Intentional visual drift was not detected');
    assert.ok(comparison.diffRatio > contract.allowedDiffRatio);
    if (comparison.diffBuffer) {
      writeFileSync(resolve(evidence, 'intentional-drift-diff.png'), comparison.diffBuffer);
    }
    summary.driftProbe = {
      changedPixels: comparison.changedPixels,
      diffRatio: comparison.diffRatio,
      detected: true,
    };
  } finally {
    await drift.context.close();
  }

  summary.referenceDebt = compareReferenceDebt(
    debtBaseline,
    summary.accessibilityBlocking,
    summary.geometryDebt,
  );
  summary.accepted = summary.referenceDebt.matches;
  writeFileSync(resolve(evidence, 'browser-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  assert.equal(
    summary.referenceDebt.matches,
    true,
    'Approved-reference accessibility/geometry debt changed from the reviewed fingerprint baseline.',
  );
  console.log(
    `F010 browser acceptance: ${summary.captures.length} deterministic captures, drift detector verified, reference debt fingerprint matched.`,
  );
} finally {
  await browser.close();
  await server.close();
}
