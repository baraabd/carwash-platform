/* global CSSStyleSheet, document, getComputedStyle -- page.evaluate callbacks */
/**
 * Unapproved, test-only colour proposals for the exact observed C/D contrast debt.
 * These rules are never imported by an app or a parity baseline. The original
 * candidate remains the source of every required accessibility assertion.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { comparePngBuffers } from '../../../scripts/f010/pixel-compare.mjs';

export const CONTRAST_PROPOSALS = Object.freeze({
  operator: Object.freeze([
    {
      selectors: [
        '.header-center > small',
        '#main > .heading > div > p',
        '#main > .stepper > .stepper-head > span',
        '#main > .section-title > small',
        '#main .check-button.checked > .grow > small',
        '#main > .center > p.muted',
        '#main .compare-caption > span',
        '#main .compare-caption > .text-btn',
        '#sheet .field-label > .muted',
      ],
      color: '#5f7264',
    },
    { selectors: ['#main > .stepper > .steps > li:not(.current)'], color: '#617153' },
    { selectors: ['#main > .segmented > .segment[aria-pressed="false"]'], color: '#5f6f51' },
  ]),
  admin: Object.freeze([{ selectors: ['#bookings > .page-head > div > p'], color: '#5f6f86' }]),
});

async function inspect(page, changes) {
  return page.evaluate(
    (rules) =>
      rules.flatMap(({ selectors }) =>
        selectors.flatMap((selector) =>
          [...document.querySelectorAll(selector)].map((element, index) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return {
              selector,
              index,
              color: style.color,
              backgroundColor: style.backgroundColor,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
          }),
        ),
      ),
    changes,
  );
}

/** Save a separate preview, then remove its stylesheet even if measurement fails. */
export async function captureContrastProposal({
  page,
  output,
  base,
  surface,
  axe,
  fullPage = true,
}) {
  assert.match(base, /^[a-z0-9-]+$/);
  const changes = CONTRAST_PROPOSALS[surface];
  assert.ok(changes, 'Only the recorded operator/admin contrast proposal is allowed');
  mkdirSync(output, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  const options = { fullPage, animations: 'disabled', caret: 'hide' };
  const before = await inspect(page, changes);
  const original = await page.screenshot(options);
  const originalFile = `${base}-candidate.png`;
  const proposalFile = `${base}-proposal-candidate.png`;
  const diffFile = `${base}-proposal-diff.png`;
  writeFileSync(path.join(output, originalFile), original);
  const css = changes
    .map(({ selectors, color }) => `${selectors.join(',')} { color: ${color}; }`)
    .join('\n');
  const sheet = await page.evaluateHandle((content) => {
    const proposal = new CSSStyleSheet();
    proposal.replaceSync(content);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, proposal];
    return proposal;
  }, css);
  try {
    const after = await inspect(page, changes);
    const proposal = await page.screenshot(options);
    writeFileSync(path.join(output, proposalFile), proposal);
    const violations = await axe(page);
    const difference = await comparePngBuffers(page.context().browser(), original, proposal);
    if (difference.diffBuffer) writeFileSync(path.join(output, diffFile), difference.diffBuffer);
    const geometry = (nodes) =>
      nodes.map(({ selector, index, rect }) => ({ selector, index, rect }));
    return {
      status: 'UNAPPROVED_COLOR_PROPOSAL_ONLY',
      acceptanceEffect: 'none; original candidate violations and parity remain required',
      changes,
      before,
      after,
      geometryUnchanged: JSON.stringify(geometry(before)) === JSON.stringify(geometry(after)),
      proposalViolations: violations,
      sameDimensions: difference.sameDimensions,
      changedPixels: difference.changedPixels,
      files: {
        original: originalFile,
        proposal: proposalFile,
        diff: difference.diffBuffer ? diffFile : null,
      },
    };
  } finally {
    await sheet.evaluate((proposal) => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (candidate) => candidate !== proposal,
      );
    });
    await sheet.dispose();
  }
}
