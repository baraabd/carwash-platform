import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { CONFIGURATION_PUBLISHED_V1 } from '@carwash/event-contracts';
import {
  ConfigurationContractViolation,
  ConfigurationV1RuleError,
  assertApprovable,
  assertDraftBase,
  assertNoOpenDraft,
  assertNoSecrets,
  assertPublishable,
  assertWithdrawable,
  canonicalJson,
  contentHashMaterial,
  diffContent,
  idempotencyMaterial,
  parseCreateDraftRequestV1,
  parseDraftTransitionRequestV1,
  parseIdempotencyKey,
  parseMarketId,
  type BookingPolicyV1,
  type DraftFacts,
} from '../src/domain/configuration-v1';
import {
  ConfigurationV1Commands,
  ConfigurationV1Queries,
  configurationPublishedEvent,
} from '../src/application';
import type { ConfigurationV1Store, PublishedRecord } from '../src/ports';

const POLICY: BookingPolicyV1 = {
  holdTtlSeconds: 600,
  quoteTtlSeconds: 900,
  minLeadMinutes: 30,
  horizonDays: 14,
  slotStepMinutes: 30,
  cancellationCutoffMinutes: 120,
};
const AUTHOR = randomUUID();
const OTHER = randomUUID();

function violation(fn: () => unknown, code: string, path?: string): void {
  assert.throws(
    fn,
    (e: unknown) =>
      e instanceof ConfigurationContractViolation &&
      e.code === code &&
      (path === undefined || e.path === path),
  );
}

function rule(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof ConfigurationV1RuleError && e.code === code);
}

test('configuration.v1 wire: namespaces and contents are closed, ranges enforced', () => {
  const ok = parseCreateDraftRequestV1('booking.policy.v1', {
    expectedVersion: null,
    content: POLICY,
  });
  assert.equal(ok.expectedVersion, null);
  assert.deepEqual(ok.content, { namespace: 'booking.policy.v1', content: POLICY });
  violation(
    () =>
      parseCreateDraftRequestV1('booking.policy.v2', { expectedVersion: null, content: POLICY }),
    'INVALID_ENUM',
    '$.namespace',
  );
  violation(
    () =>
      parseCreateDraftRequestV1('booking.policy.v1', {
        expectedVersion: null,
        content: { ...POLICY, maxLatenessMinutes: 20 },
      }),
    'UNEXPECTED_FIELD',
    '$.content.maxLatenessMinutes',
  );
  violation(
    () =>
      parseCreateDraftRequestV1('booking.policy.v1', {
        expectedVersion: null,
        content: { ...POLICY, holdTtlSeconds: 59 },
      }),
    'INVALID_INTEGER',
    '$.content.holdTtlSeconds',
  );
  violation(
    () =>
      parseCreateDraftRequestV1('booking.policy.v1', {
        expectedVersion: null,
        content: { ...POLICY, slotStepMinutes: 45 },
      }),
    'INVALID_ENUM',
    '$.content.slotStepMinutes',
  );
  violation(
    () => parseCreateDraftRequestV1('booking.policy.v1', { expectedVersion: 0, content: POLICY }),
    'INVALID_INTEGER',
    '$.expectedVersion',
  );
  violation(
    () => parseCreateDraftRequestV1('booking.policy.v1', { content: POLICY }),
    'MISSING_FIELD',
    '$.expectedVersion',
  );
  const presentation = parseCreateDraftRequestV1('market.presentation.v1', {
    expectedVersion: 3,
    content: { currency: 'SYP', defaultLocale: 'ar', timezone: 'Asia/Damascus' },
  });
  assert.equal(presentation.expectedVersion, 3);
  violation(
    () =>
      parseCreateDraftRequestV1('market.presentation.v1', {
        expectedVersion: 1,
        content: { currency: 'EUR', defaultLocale: 'ar', timezone: 'Asia/Damascus' },
      }),
    'INVALID_ENUM',
    '$.content.currency',
  );
  assert.equal(parseMarketId('sy', 'p'), 'sy');
  assert.equal(parseMarketId('sy-damas', 'p'), 'sy-damas');
  violation(() => parseMarketId('SY', 'p'), 'INVALID_FORMAT');
  violation(() => parseMarketId('sy-damascus12', 'p'), 'INVALID_LENGTH');
  assert.deepEqual(parseDraftTransitionRequestV1({ expectedRevision: 2 }), { expectedRevision: 2 });
  violation(
    () => parseDraftTransitionRequestV1({ expectedRevision: 2, note: 'x' }),
    'UNEXPECTED_FIELD',
  );
});

test('configuration.v1 idempotency key: required and shaped like the published protocol', () => {
  rule(() => parseIdempotencyKey(undefined), 'IDEMPOTENCY_KEY_REQUIRED');
  rule(() => parseIdempotencyKey('short'), 'IDEMPOTENCY_KEY_INVALID');
  rule(() => parseIdempotencyKey('has space in it 12345'), 'IDEMPOTENCY_KEY_INVALID');
  assert.equal(parseIdempotencyKey('settings-0001-abcdef'), 'settings-0001-abcdef');
});

test('configuration.v1 hashes: canonical content is key-order independent', () => {
  const a = contentHashMaterial({ namespace: 'booking.policy.v1', content: POLICY });
  const reordered = Object.fromEntries(Object.entries(POLICY).reverse());
  assert.equal(canonicalJson(reordered), a);
  assert.equal(
    a,
    '{"cancellationCutoffMinutes":120,"holdTtlSeconds":600,"horizonDays":14,"minLeadMinutes":30,"quoteTtlSeconds":900,"slotStepMinutes":30}',
  );
  const fp = (body: unknown, actor = AUTHOR) =>
    idempotencyMaterial({ operation: 'createDraft', actor, target: 'sy/booking.policy.v1', body });
  assert.equal(fp({ a: 1, b: 2 }), fp({ b: 2, a: 1 }));
  assert.notEqual(fp({ a: 1 }), fp({ a: 2 }));
  assert.notEqual(fp({ a: 1 }), fp({ a: 1 }, OTHER), 'the actor is part of the fingerprint');
});

test('configuration.v1 state machine: four eyes, approval before publish, revisions', () => {
  const draft: DraftFacts = {
    status: 'DRAFT',
    revision: 1,
    authorSubject: AUTHOR,
    baseVersion: null,
  };
  rule(() => assertApprovable(draft, AUTHOR, 1), 'SELF_APPROVAL_FORBIDDEN');
  rule(() => assertApprovable(draft, AUTHOR.toUpperCase(), 1), 'SELF_APPROVAL_FORBIDDEN');
  rule(() => assertApprovable(draft, OTHER, 2), 'REVISION_CONFLICT');
  assert.doesNotThrow(() => assertApprovable(draft, OTHER, 1));
  rule(() => assertPublishable(draft, 1, 0), 'DRAFT_NOT_APPROVED');
  const approved: DraftFacts = { ...draft, status: 'APPROVED', revision: 2 };
  rule(() => assertApprovable(approved, OTHER, 2), 'DRAFT_ALREADY_APPROVED');
  assert.equal(assertPublishable(approved, 2, 0), 1, 'first publish is version 1');
  rule(() => assertPublishable(approved, 2, 1), 'DRAFT_BASE_STALE');
  assert.equal(assertPublishable({ ...approved, baseVersion: 4 }, 2, 4), 5);
  const published: DraftFacts = { ...approved, status: 'PUBLISHED', revision: 3 };
  rule(() => assertPublishable(published, 3, 1), 'DRAFT_CLOSED');
  rule(() => assertWithdrawable(published, 3), 'DRAFT_CLOSED');
  assert.doesNotThrow(() => assertWithdrawable(approved, 2));
  rule(() => assertDraftBase(null, 1), 'VERSION_CONFLICT');
  rule(() => assertDraftBase(1, 2), 'VERSION_CONFLICT');
  assert.doesNotThrow(() => assertDraftBase(null, 0));
  assert.doesNotThrow(() => assertDraftBase(2, 2));
  rule(() => assertNoOpenDraft(true), 'DRAFT_ALREADY_OPEN');
});

test('configuration.v1 secrets: a secret-like field is refused (P01-D3 guard semantics)', () => {
  rule(() => assertNoSecrets({ content: { ...POLICY, apiKey: 1 } }), 'SECRET_NOT_CONFIGURATION');
  assert.doesNotThrow(() => assertNoSecrets({ content: POLICY }));
});

test('configuration.v1 diff: field-level changes, both sides', () => {
  assert.deepEqual(diffContent(POLICY, { ...POLICY, holdTtlSeconds: 900, horizonDays: 7 }), [
    { field: 'holdTtlSeconds', from: 600, to: 900 },
    { field: 'horizonDays', from: 14, to: 7 },
  ]);
  assert.deepEqual(diffContent(POLICY, { ...POLICY }), []);
});

test('configuration.v1 event: the outbox payload parses with the published event contract', () => {
  const published: PublishedRecord = {
    scope: { marketId: 'sy', namespace: 'booking.policy.v1' },
    version: 3,
    draftId: randomUUID(),
    content: { namespace: 'booking.policy.v1', content: POLICY },
    contentHash: 'a'.repeat(64),
    effectiveAt: new Date('2026-10-11T08:00:00.000Z'),
    publishedBy: OTHER,
    publishedAt: new Date('2026-10-11T08:00:00.000Z'),
  };
  const scopeId = randomUUID();
  const row = configurationPublishedEvent(
    {
      eventId: randomUUID(),
      occurredAt: published.publishedAt,
      correlationId: randomUUID(),
      traceParent: 'not-a-traceparent',
      actorSubject: OTHER,
    },
    scopeId,
    published,
  );
  assert.equal(row.exchange, 'configuration.events');
  assert.equal(row.routingKey, 'configuration.configuration-published.v1');
  assert.equal(row.traceParent, null, 'an invalid traceparent is dropped, not forwarded');
  const parsed = CONFIGURATION_PUBLISHED_V1.parse(JSON.parse(row.payload));
  assert.deepEqual(parsed.aggregate, { type: 'configuration-scope', id: scopeId, version: 3 });
  assert.deepEqual(parsed.data, {
    marketId: 'sy',
    namespace: 'booking.policy.v1',
    contentHash: 'a'.repeat(64),
    effectiveAt: '2026-10-11T08:00:00.000Z',
  });
  assert.equal(row.payload.includes('600'), false, 'content values never travel in the event');
});

function unusedStore(overrides: Partial<ConfigurationV1Store>): ConfigurationV1Store {
  const fail = () => Promise.reject(new Error('NOT_EXPECTED'));
  return {
    createDraft: fail,
    approve: fail,
    publish: fail,
    withdraw: fail,
    current: fail,
    overview: fail,
    versions: fail,
    version: fail,
    history: fail,
    draft: fail,
    ...overrides,
  };
}

test('configuration.v1 application: no invented default, key checked before the store', async () => {
  const queries = new ConfigurationV1Queries(unusedStore({ current: () => Promise.resolve(null) }));
  await assert.rejects(
    () => queries.current('sy', 'booking.policy.v1'),
    (e: unknown) => e instanceof ConfigurationV1RuleError && e.code === 'POLICY_UNAVAILABLE',
  );
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const commands = new ConfigurationV1Commands(
    unusedStore({}),
    { now: () => new Date('2026-10-11T08:00:00.000Z') },
    sha,
    randomUUID,
  );
  const meta = {
    actor: { subject: AUTHOR, correlationId: randomUUID() },
    idempotencyKey: undefined,
    traceParent: null,
  };
  assert.throws(
    () =>
      commands.createDraft(meta, 'sy', 'booking.policy.v1', {
        expectedVersion: null,
        content: POLICY,
      }),
    (e: unknown) => e instanceof ConfigurationV1RuleError && e.code === 'IDEMPOTENCY_KEY_REQUIRED',
  );
  assert.throws(
    () => commands.approve(meta, 'not-a-uuid', { expectedRevision: 1 }),
    (e: unknown) => e instanceof ConfigurationContractViolation && e.path === 'path.draftId',
  );
  await assert.rejects(
    () => queries.diff('sy', 'booking.policy.v1', { from: '0', to: '1' }),
    (e: unknown) => e instanceof ConfigurationContractViolation && e.path === 'query.from',
  );
});
