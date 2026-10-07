import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CatalogDefinitionError,
  MAX_SCHEDULE_AHEAD_MS,
  normalizeDefinitions,
  planPublication,
} from '../src/domain';
import { canonicalJson } from '../src/application';
import { definitionsFixture } from './support/catalog-fixtures';

type Mutable = Record<string, unknown> & {
  categories: Record<string, unknown>[];
  packages: Record<string, unknown>[];
  addons: Record<string, unknown>[];
};

function fixture(): Mutable {
  return definitionsFixture() as Mutable;
}

function rejects(input: unknown, code: string): void {
  assert.throws(
    () => normalizeDefinitions(input),
    (error: unknown) => error instanceof CatalogDefinitionError && error.code === code,
  );
}

test('definitions: valid input normalises to a canonical order', () => {
  const result = normalizeDefinitions(fixture());
  assert.deepEqual(
    result.categories.map((c) => c.id),
    ['sedan', 'suv'],
  );
  assert.deepEqual(
    result.packages.map((p) => p.id),
    ['exterior', 'full-care'],
  );
  assert.deepEqual(result.packages[0]?.optionalAddonIds, ['interior-fresh', 'tyre-shine']);
  assert.deepEqual(result.addons[1]?.allowedCategoryIds, ['sedan', 'suv']);
  // Feature order is presentation order and must be preserved.
  assert.deepEqual(result.packages[0]?.featuresAr, ['غسيل الهيكل', 'تنظيف الزجاج']);
});

test('definitions: key and array order never changes the canonical fingerprint input', () => {
  const a = fixture();
  const b = fixture();
  b.packages.reverse();
  b.categories.reverse();
  b.addons.reverse();
  const reordered = Object.fromEntries(Object.entries(b).reverse());
  assert.equal(
    canonicalJson(normalizeDefinitions(a)),
    canonicalJson(normalizeDefinitions(reordered)),
  );
});

test('definitions: unknown and missing fields are rejected, never stripped', () => {
  const extra = fixture();
  (extra.packages[0] as Record<string, unknown>).priceMinor = '500';
  rejects(extra, 'DEFINITIONS_MALFORMED');
  const missing = fixture();
  delete (missing.categories[0] as Record<string, unknown>).sortOrder;
  rejects(missing, 'DEFINITIONS_MALFORMED');
  rejects({ ...fixture(), promotions: [] }, 'DEFINITIONS_MALFORMED');
  rejects(null, 'DEFINITIONS_MALFORMED');
  rejects([], 'DEFINITIONS_MALFORMED');
});

test('definitions: ids, labels, durations and bounds are validated', () => {
  const badId = fixture();
  (badId.categories[0] as Record<string, unknown>).id = 'Sedan';
  rejects(badId, 'DEFINITIONS_MALFORMED');
  const padded = fixture();
  (padded.packages[0] as Record<string, unknown>).labelAr = ' عناية ';
  rejects(padded, 'DEFINITIONS_MALFORMED');
  const control = fixture();
  (control.packages[0] as Record<string, unknown>).labelAr = 'a\u0007b';
  rejects(control, 'DEFINITIONS_MALFORMED');
  const zero = fixture();
  (zero.packages[0] as Record<string, unknown>).durationMinutes = 0;
  rejects(zero, 'DEFINITIONS_MALFORMED');
  const fractional = fixture();
  (fractional.addons[0] as Record<string, unknown>).durationMinutes = 1.5;
  rejects(fractional, 'DEFINITIONS_MALFORMED');
  const huge = fixture();
  (huge.categories[0] as Record<string, unknown>).extraDurationMinutes = 241;
  rejects(huge, 'DEFINITIONS_MALFORMED');
  const stringNumber = fixture();
  (stringNumber.categories[0] as Record<string, unknown>).sortOrder = '1';
  rejects(stringNumber, 'DEFINITIONS_MALFORMED');
});

test('definitions: duplicate ids are rejected per kind and inside relations', () => {
  const dupCategory = fixture();
  dupCategory.categories.push({ ...dupCategory.categories[0] });
  rejects(dupCategory, 'DUPLICATE_ID');
  const dupRef = fixture();
  (dupRef.packages[1] as Record<string, unknown>).optionalAddonIds = ['tyre-shine', 'tyre-shine'];
  rejects(dupRef, 'DUPLICATE_ID');
});

test('definitions: every reference must resolve inside the same revision', () => {
  const unknownCategory = fixture();
  (unknownCategory.packages[0] as Record<string, unknown>).allowedCategoryIds = ['sedan', 'bus'];
  rejects(unknownCategory, 'UNKNOWN_REFERENCE');
  const unknownAddon = fixture();
  (unknownAddon.packages[1] as Record<string, unknown>).optionalAddonIds = ['wax'];
  rejects(unknownAddon, 'UNKNOWN_REFERENCE');
  const unknownAddonCategory = fixture();
  (unknownAddonCategory.addons[0] as Record<string, unknown>).allowedCategoryIds = ['bus'];
  rejects(unknownAddonCategory, 'UNKNOWN_REFERENCE');
});

test('definitions: compatibility rules', () => {
  const both = fixture();
  (both.packages[0] as Record<string, unknown>).optionalAddonIds = ['tyre-shine'];
  rejects(both, 'ADDON_BOTH_INCLUDED_AND_OPTIONAL');
  // interior-fresh is sedan-only, so it cannot be INCLUDED in a sedan+suv package.
  const mismatch = fixture();
  (mismatch.packages[0] as Record<string, unknown>).includedAddonIds = [
    'interior-fresh',
    'tyre-shine',
  ];
  rejects(mismatch, 'INCLUDED_ADDON_CATEGORY_MISMATCH');
  const emptyCategories = fixture();
  (emptyCategories.packages[0] as Record<string, unknown>).allowedCategoryIds = [];
  rejects(emptyCategories, 'EMPTY_CATEGORY_SET');
  rejects({ categories: fixture().categories, packages: [], addons: [] }, 'NO_PACKAGES');
});

const T0 = new Date('2026-10-07T10:00:00.000Z');

test('revision plan: first revision expects 0 and may start now', () => {
  assert.deepEqual(
    planPublication({ head: null, expectedRevision: 0, effectiveFrom: null, now: T0 }),
    {
      accepted: true,
      revision: 1,
      effectiveFrom: T0,
    },
  );
});

test('revision plan: stale expected revision is a conflict', () => {
  const head = { revision: 3, effectiveFrom: T0 };
  const later = new Date(T0.getTime() + 60_000);
  assert.deepEqual(
    planPublication({ head, expectedRevision: 2, effectiveFrom: null, now: later }),
    {
      accepted: false,
      reason: 'REVISION_CONFLICT',
    },
  );
  assert.deepEqual(
    planPublication({ head: null, expectedRevision: 1, effectiveFrom: null, now: T0 }),
    {
      accepted: false,
      reason: 'REVISION_CONFLICT',
    },
  );
});

test('revision plan: effective windows are never retroactive or overlapping', () => {
  const head = { revision: 1, effectiveFrom: new Date(T0.getTime() + 3_600_000) };
  assert.equal(
    planPublication({
      head: null,
      expectedRevision: 0,
      effectiveFrom: new Date(T0.getTime() - 1),
      now: T0,
    }).accepted,
    false,
  );
  // A scheduled future head means "now" would precede it: rejected, not reordered.
  assert.deepEqual(planPublication({ head, expectedRevision: 1, effectiveFrom: null, now: T0 }), {
    accepted: false,
    reason: 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS',
  });
  assert.deepEqual(
    planPublication({ head, expectedRevision: 1, effectiveFrom: head.effectiveFrom, now: T0 }),
    { accepted: false, reason: 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS' },
  );
  const next = new Date(head.effectiveFrom.getTime() + 1);
  assert.deepEqual(planPublication({ head, expectedRevision: 1, effectiveFrom: next, now: T0 }), {
    accepted: true,
    revision: 2,
    effectiveFrom: next,
  });
  assert.deepEqual(
    planPublication({
      head: null,
      expectedRevision: 0,
      effectiveFrom: new Date(T0.getTime() + MAX_SCHEDULE_AHEAD_MS + 1),
      now: T0,
    }),
    { accepted: false, reason: 'EFFECTIVE_FROM_TOO_FAR' },
  );
});
