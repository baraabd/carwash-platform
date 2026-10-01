import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ROOT, safeFile } from './reference-registry.mjs';

export const DEBT_BASELINE = 'docs/design/f010-reference-debt-baseline.json';
const EXPECTED_BYTES = 2618;
const EXPECTED_SHA256 = 'fbbc79fc34d3d2fc13eee24a9dfe299d547ad17d6c99266a072a0d114aa9497f';
const CANONICAL_WIDTHS = Object.freeze([320, 390, 430, 768, 1024, 1440]);
const APP_IDS = new Set(['customer', 'technician', 'admin']);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableTargets(targets) {
  return targets
    .map((target) => {
      if (!Array.isArray(target) || target.some((part) => typeof part !== 'string' || !part)) {
        throw new Error('INVALID_F010_DEBT_TARGET');
      }
      return [...target];
    })
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function loadDebtBaseline(root = ROOT) {
  const bytes = readFileSync(safeFile(root, DEBT_BASELINE));
  if (bytes.length !== EXPECTED_BYTES || digest(bytes) !== EXPECTED_SHA256) {
    throw new Error('F010_DEBT_BASELINE_CHANGED');
  }
  const baseline = JSON.parse(bytes.toString('utf8'));
  return validateDebtBaseline(baseline);
}

export function validateDebtBaseline(baseline) {
  if (
    !baseline ||
    baseline.schemaVersion !== 1 ||
    baseline.referenceSet !== 'washgo-three-apps-v1' ||
    baseline.policy?.newOrChangedDebt !== 'blocked' ||
    baseline.policy?.referenceMutation !== 'blocked' ||
    !Array.isArray(baseline.accessibility) ||
    !Array.isArray(baseline.geometry)
  ) {
    throw new Error('INVALID_F010_DEBT_BASELINE');
  }
  for (const item of baseline.accessibility) {
    if (
      !APP_IDS.has(item.app) ||
      !Array.isArray(item.widths) ||
      item.widths.length === 0 ||
      item.widths.some((width) => !CANONICAL_WIDTHS.includes(width)) ||
      new Set(item.widths).size !== item.widths.length ||
      typeof item.id !== 'string' ||
      !['critical', 'serious'].includes(item.impact)
    ) {
      throw new Error('INVALID_F010_ACCESSIBILITY_DEBT');
    }
    stableTargets(item.targets);
  }
  for (const item of baseline.geometry) {
    if (
      !APP_IDS.has(item.app) ||
      !CANONICAL_WIDTHS.includes(item.width) ||
      item.viewportWidth !== item.width ||
      !Number.isSafeInteger(item.scrollWidth) ||
      !Number.isSafeInteger(item.overflowPixels) ||
      item.overflowPixels <= 0 ||
      item.scrollWidth - item.viewportWidth !== item.overflowPixels
    ) {
      throw new Error('INVALID_F010_GEOMETRY_DEBT');
    }
  }
  return baseline;
}

export function expectedAccessibilityDebt(baseline) {
  return baseline.accessibility
    .flatMap((item) =>
      item.widths.map((width) => ({
        app: item.app,
        width,
        id: item.id,
        impact: item.impact,
        targets: stableTargets(item.targets),
      })),
    )
    .sort(compareDebtRecords);
}

export function normalizeAccessibilityDebt(groups) {
  return groups
    .flatMap((group) =>
      group.violations.map((violation) => ({
        app: group.app,
        width: group.width,
        id: violation.id,
        impact: violation.impact,
        targets: stableTargets(violation.nodes.map((node) => node.target)),
      })),
    )
    .sort(compareDebtRecords);
}

function compareDebtRecords(left, right) {
  return (
    left.app.localeCompare(right.app) ||
    left.width - right.width ||
    left.id.localeCompare(right.id) ||
    left.impact.localeCompare(right.impact) ||
    JSON.stringify(left.targets).localeCompare(JSON.stringify(right.targets))
  );
}

function normalizeGeometry(items) {
  return items
    .map((item) => ({
      app: item.app,
      width: item.width,
      viewportWidth: item.viewportWidth,
      scrollWidth: item.scrollWidth,
      overflowPixels: item.overflowPixels,
    }))
    .sort((left, right) => left.app.localeCompare(right.app) || left.width - right.width);
}

export function compareReferenceDebt(baseline, accessibilityBlocking, geometryDebt) {
  const expectedAccessibility = expectedAccessibilityDebt(validateDebtBaseline(baseline));
  const actualAccessibility = normalizeAccessibilityDebt(accessibilityBlocking);
  const expectedGeometry = normalizeGeometry(baseline.geometry);
  const actualGeometry = normalizeGeometry(geometryDebt);
  const accessibilityMatches =
    JSON.stringify(actualAccessibility) === JSON.stringify(expectedAccessibility);
  const geometryMatches = JSON.stringify(actualGeometry) === JSON.stringify(expectedGeometry);
  return {
    matches: accessibilityMatches && geometryMatches,
    accessibilityMatches,
    geometryMatches,
    expectedAccessibility,
    actualAccessibility,
    expectedGeometry,
    actualGeometry,
  };
}
