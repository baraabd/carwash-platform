/* global CSSStyleSheet, document, getComputedStyle -- page.evaluate callbacks */
/**
 * Independent, exact colour specifications for PR #147's accessibility repair.
 * Original reference bytes and raw captures never change. A derived comparison
 * can apply only these colour declarations; no mask or tolerance is added.
 */
import assert from 'node:assert/strict';

export const CONTRAST_CORRECTIONS = Object.freeze({
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
      from: 'rgb(101, 120, 106)',
      color: '#5f7264',
      expected: 'rgb(95, 114, 100)',
    },
    {
      selectors: ['#main > .stepper > .steps > li:not(.current)'],
      from: 'rgb(133, 146, 118)',
      color: '#617153',
      expected: 'rgb(97, 113, 83)',
    },
    {
      selectors: ['#main > .segmented > .segment[aria-pressed="false"]'],
      from: 'rgb(112, 128, 98)',
      color: '#5f6f51',
      expected: 'rgb(95, 111, 81)',
    },
  ]),
  admin: Object.freeze([
    {
      selectors: ['#bookings > .page-head > div > p'],
      from: 'rgb(100, 116, 139)',
      color: '#5f6f86',
      expected: 'rgb(95, 111, 134)',
    },
  ]),
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
              opacity: style.opacity,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
          }),
        ),
      ),
    changes,
  );
}

/** Record the actual candidate colours without changing its DOM or styles. */
export async function inspectContrastCorrection(page, surface) {
  const changes = CONTRAST_CORRECTIONS[surface];
  assert.ok(changes, 'Only the recorded operator/admin corrections are allowed');
  const nodes = await inspect(page, changes);
  for (const node of nodes) {
    const rule = changes.find((change) => change.selectors.includes(node.selector));
    assert.equal(node.color, rule.expected, `Candidate colour: ${node.selector}`);
  }
  return { scope: 'PR #147 colour-only accessibility repair', changes, nodes };
}

/**
 * Apply only the independently specified corrections to a derived reference.
 * Before/after styles prove that every matched element preserves geometry,
 * background, typography and opacity. Candidate styles are only inspected.
 */
export async function declareContrastCorrections(reference, candidate, surface) {
  const changes = CONTRAST_CORRECTIONS[surface];
  assert.ok(changes);
  const before = await inspect(reference, changes);
  for (const node of before) {
    const rule = changes.find((change) => change.selectors.includes(node.selector));
    assert.equal(node.color, rule.from, `Unexpected original colour: ${node.selector}`);
  }
  const css = changes
    .map(({ selectors, color }) => `${selectors.join(',')} { color: ${color}; }`)
    .join('\n');
  await reference.evaluate((content) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(content);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, css);
  const after = await inspect(reference, changes);
  const withoutColour = (nodes) => nodes.map(({ color: _color, ...rest }) => rest);
  assert.deepEqual(
    withoutColour(after),
    withoutColour(before),
    'Colour repair cannot change layout or typography',
  );
  await inspectContrastCorrection(candidate, surface);
  await inspectContrastCorrection(reference, surface);
  return { id: 'A11Y-147', before, after, geometryUnchanged: true };
}
