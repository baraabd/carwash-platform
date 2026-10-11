import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalVehicleTypes,
  planPublication,
  type CatalogSnapshot,
  type DefinitionDraft,
  type PublicationPlan,
} from '../src/domain';
import { WireViolation, parsePublishRequest } from '../src/application';
import { definitionsFixture, fixtureId, publishBody } from './support/catalog-fixtures';

/* Pure domain rules and the owner-side wire parser. No IO. */

function drafts(): DefinitionDraft[] {
  return parsePublishRequest(publishBody(0, definitionsFixture())).drafts.map((d) => ({ ...d }));
}

function accepted(plan: PublicationPlan) {
  assert.equal(plan.accepted, true, JSON.stringify(plan));
  if (!plan.accepted) throw new Error('unreachable');
  return plan;
}

function snapshotOf(plan: PublicationPlan): CatalogSnapshot {
  const ok = accepted(plan);
  return {
    catalogRevision: ok.catalogRevision,
    publishedAt: new Date('2026-10-11T08:00:00.000Z'),
    items: ok.items,
  };
}

function rejected(plan: PublicationPlan, reason: string, field?: string): void {
  assert.equal(plan.accepted, false);
  if (plan.accepted) return;
  assert.equal(plan.reason, reason);
  if (field) assert.equal(plan.field, field);
}

const first = () =>
  snapshotOf(planPublication({ current: null, expectedCatalogRevision: 0, drafts: drafts() }));

test('domain: the first publication creates revision 1 with every definition at revision 1', () => {
  const plan = accepted(
    planPublication({ current: null, expectedCatalogRevision: 0, drafts: drafts() }),
  );
  assert.equal(plan.catalogRevision, 1);
  assert.deepEqual(
    plan.items.map((d) => d.revision),
    [1, 1, 1],
  );
  assert.deepEqual(plan.changedDefinitionIds, [fixtureId(1), fixtureId(2), fixtureId(3)]);
  // Ordered by sortOrder then id, and vehicle types canonicalised.
  assert.deepEqual(
    plan.items.map((d) => d.sortOrder),
    [0, 1, 2],
  );
  assert.deepEqual(plan.items[0]?.vehicleTypes, ['sedan', 'suv']);
});

test('domain: an expected revision other than the head is a REVISION_CONFLICT', () => {
  rejected(
    planPublication({ current: null, expectedCatalogRevision: 1, drafts: drafts() }),
    'REVISION_CONFLICT',
    '$.expectedCatalogRevision',
  );
  const current = first();
  rejected(
    planPublication({ current, expectedCatalogRevision: 0, drafts: drafts() }),
    'REVISION_CONFLICT',
  );
});

test('domain: only changed definitions advance their content revision', () => {
  const current = first();
  const next = drafts();
  next[1] = { ...next[1]!, durationMinutes: 95 };
  const plan = accepted(planPublication({ current, expectedCatalogRevision: 1, drafts: next }));
  assert.equal(plan.catalogRevision, 2);
  const byId = new Map(plan.items.map((d) => [d.definitionId, d.revision]));
  assert.equal(byId.get(fixtureId(1)), 1);
  assert.equal(byId.get(fixtureId(2)), 2);
  assert.equal(byId.get(fixtureId(3)), 1);
  assert.deepEqual(plan.changedDefinitionIds, [fixtureId(2)]);
  assert.deepEqual(plan.createdDefinitionIds, []);
});

test('domain: an identical publication is NO_CHANGES', () => {
  rejected(
    planPublication({ current: first(), expectedCatalogRevision: 1, drafts: drafts() }),
    'NO_CHANGES',
  );
});

test('domain: a definition cannot silently disappear; retirement is explicit', () => {
  const current = first();
  rejected(
    planPublication({ current, expectedCatalogRevision: 1, drafts: drafts().slice(0, 2) }),
    'DEFINITION_MISSING',
    '$.definitions',
  );
  const retire = drafts();
  retire[2] = { ...retire[2]!, status: 'RETIRED' };
  const plan = accepted(planPublication({ current, expectedCatalogRevision: 1, drafts: retire }));
  const retired = plan.items.find((d) => d.definitionId === fixtureId(3));
  assert.equal(retired?.status, 'RETIRED');
  assert.equal(retired?.revision, 2);
});

test('domain: retirement is final and a new definition cannot start retired', () => {
  const current = first();
  const retire = drafts();
  retire[2] = { ...retire[2]!, status: 'RETIRED' };
  const afterRetire = snapshotOf(
    planPublication({ current, expectedCatalogRevision: 1, drafts: retire }),
  );
  rejected(
    planPublication({ current: afterRetire, expectedCatalogRevision: 2, drafts: drafts() }),
    'DEFINITION_RETIRED',
    '$.definitions[2].status',
  );
  const extra: DefinitionDraft = {
    ...drafts()[2]!,
    definitionId: fixtureId(9),
    code: 'fx-new',
    status: 'RETIRED',
  };
  rejected(
    planPublication({ current, expectedCatalogRevision: 1, drafts: [...drafts(), extra] }),
    'DEFINITION_RETIRED',
  );
});

test('domain: a code is never reused by another definition, even after retirement', () => {
  const current = first();
  const retire = drafts();
  retire[2] = { ...retire[2]!, status: 'RETIRED' };
  const afterRetire = snapshotOf(
    planPublication({ current, expectedCatalogRevision: 1, drafts: retire }),
  );
  const reuse: DefinitionDraft = { ...drafts()[2]!, definitionId: fixtureId(10) };
  rejected(
    planPublication({
      current: afterRetire,
      expectedCatalogRevision: 2,
      drafts: [...retire, reuse],
    }),
    'DUPLICATE_CODE',
    '$.definitions[3].code',
  );
});

test('domain: kind and code of an existing definition are immutable', () => {
  const current = first();
  const kind = drafts();
  kind[2] = { ...kind[2]!, kind: 'PACKAGE' };
  rejected(
    planPublication({ current, expectedCatalogRevision: 1, drafts: kind }),
    'DEFINITION_IDENTITY_CHANGED',
    '$.definitions[2].kind',
  );
  const code = drafts();
  code[0] = { ...code[0]!, code: 'fx-renamed' };
  rejected(
    planPublication({ current, expectedCatalogRevision: 1, drafts: code }),
    'DEFINITION_IDENTITY_CHANGED',
    '$.definitions[0].code',
  );
});

test('domain: vehicle types are canonicalised so order never counts as a change', () => {
  assert.deepEqual(canonicalVehicleTypes(['pickup', 'sedan', 'large']), [
    'sedan',
    'large',
    'pickup',
  ]);
  const current = first();
  const reordered = definitionsFixture().map((d) => ({
    ...d,
    vehicleTypes: [...d.vehicleTypes].reverse(),
  }));
  const reparsed = parsePublishRequest(publishBody(1, reordered)).drafts;
  rejected(
    planPublication({ current, expectedCatalogRevision: 1, drafts: reparsed }),
    'NO_CHANGES',
  );
});

function violation(body: unknown, code: string, path: string): void {
  assert.throws(
    () => parsePublishRequest(body),
    (error: unknown) =>
      error instanceof WireViolation && error.code === code && error.path === path,
  );
}

test('wire: the publish request is closed and every field is bounded like catalog.v1', () => {
  const base = () => publishBody(0, definitionsFixture());
  violation({ ...base(), extra: 1 }, 'UNEXPECTED_FIELD', '$.extra');
  violation({ definitions: [], reasonCode: 'X_Y' }, 'MISSING_FIELD', '$.expectedCatalogRevision');
  violation(publishBody(0, []), 'EMPTY_LIST', '$.definitions');
  violation(publishBody(-1, definitionsFixture()), 'INVALID_INTEGER', '$.expectedCatalogRevision');
  violation(publishBody(0, definitionsFixture(), 'lowercase'), 'INVALID_FORMAT', '$.reasonCode');
  const d = definitionsFixture();
  violation(
    publishBody(0, [{ ...d[0]!, durationMinutes: 4 }]),
    'INVALID_INTEGER',
    '$.definitions[0].durationMinutes',
  );
  violation(
    publishBody(0, [{ ...d[0]!, durationMinutes: 12.5 }]),
    'INVALID_INTEGER',
    '$.definitions[0].durationMinutes',
  );
  violation(
    publishBody(0, [{ ...d[0]!, vehicleTypes: [] }]),
    'EMPTY_LIST',
    '$.definitions[0].vehicleTypes',
  );
  violation(
    publishBody(0, [{ ...d[0]!, vehicleTypes: ['sedan', 'sedan'] }]),
    'DUPLICATE_ITEM',
    '$.definitions[0].vehicleTypes',
  );
  violation(
    publishBody(0, [{ ...d[0]!, vehicleTypes: ['truck'] }]),
    'INVALID_ENUM',
    '$.definitions[0].vehicleTypes[0]',
  );
  violation(
    publishBody(0, [{ ...d[0]!, code: 'Bad Code' }]),
    'INVALID_FORMAT',
    '$.definitions[0].code',
  );
  violation(
    publishBody(0, [{ ...d[0]!, name: { ar: 'a\u0007b', en: null } }]),
    'INVALID_CHARACTERS',
    '$.definitions[0].name.ar',
  );
  violation(
    publishBody(0, [{ ...d[0]!, name: { ar: 'x'.repeat(81), en: null } }]),
    'INVALID_LENGTH',
    '$.definitions[0].name.ar',
  );
  violation(
    publishBody(0, [{ ...d[0]!, definitionId: 'not-a-uuid' }]),
    'INVALID_UUID',
    '$.definitions[0].definitionId',
  );
  violation(
    publishBody(0, [d[0]!, { ...d[1]!, code: d[0]!.code }]),
    'DUPLICATE_CODE',
    '$.definitions',
  );
  violation(
    publishBody(0, [d[0]!, { ...d[1]!, definitionId: d[0]!.definitionId }]),
    'DUPLICATE_DEFINITION',
    '$.definitions',
  );
  violation(
    publishBody(
      0,
      Array.from({ length: 201 }, () => d[0]!),
    ),
    'TOO_MANY_ITEMS',
    '$.definitions',
  );
});

test('wire: text is NFC-normalised and measured in code points; UUIDs are lowercased', () => {
  const d = definitionsFixture()[0]!;
  const decomposed = 'é'; // é as e + combining acute
  const parsed = parsePublishRequest(
    publishBody(0, [
      {
        ...d,
        definitionId: d.definitionId.toUpperCase(),
        name: { ar: '😀'.repeat(80), en: decomposed },
      },
    ]),
  ).drafts[0]!;
  assert.equal(parsed.definitionId, d.definitionId);
  assert.equal(parsed.name.en, 'é');
  assert.equal([...parsed.name.ar].length, 80);
});
