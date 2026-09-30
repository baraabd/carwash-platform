import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareReferenceDebt,
  expectedAccessibilityDebt,
  loadDebtBaseline,
  validateDebtBaseline,
} from '../../scripts/f010/reference-debt.mjs';

function actualFrom(baseline) {
  const groups = new Map();
  for (const item of expectedAccessibilityDebt(baseline)) {
    const key = `${item.app}:${item.width}`;
    const group = groups.get(key) ?? { app: item.app, width: item.width, violations: [] };
    group.violations.push({
      id: item.id,
      impact: item.impact,
      nodes: item.targets.map((target) => ({ target, failureSummary: 'retained separately' })),
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}

test('F010 debt baseline is hash-locked and structurally valid', () => {
  const baseline = loadDebtBaseline();
  assert.equal(validateDebtBaseline(baseline), baseline);
  assert.equal(baseline.accessibility.length, 3);
  assert.equal(baseline.geometry.length, 4);
});

test('F010 exact reference debt fingerprint matches the reviewed inventory', () => {
  const baseline = loadDebtBaseline();
  const result = compareReferenceDebt(baseline, actualFrom(baseline), baseline.geometry);
  assert.equal(result.matches, true);
  assert.equal(result.accessibilityMatches, true);
  assert.equal(result.geometryMatches, true);
});

test('F010 new accessibility debt is blocked', () => {
  const baseline = loadDebtBaseline();
  const actual = actualFrom(baseline);
  actual[0].violations[0].nodes.push({ target: ['.new-regression'] });
  assert.equal(compareReferenceDebt(baseline, actual, baseline.geometry).matches, false);
});

test('F010 removed or changed baseline debt is detectable rather than silently rewritten', () => {
  const baseline = loadDebtBaseline();
  const actual = actualFrom(baseline);
  actual[0].violations[0].nodes.pop();
  assert.equal(compareReferenceDebt(baseline, actual, baseline.geometry).matches, false);
  const geometry = structuredClone(baseline.geometry);
  geometry[0].scrollWidth += 1;
  geometry[0].overflowPixels += 1;
  assert.equal(compareReferenceDebt(baseline, actualFrom(baseline), geometry).matches, false);
});
