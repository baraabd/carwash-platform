import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigurationRuleError,
  assertActivatable,
  assertReviewer,
  configScope,
  configValue,
  proposalFingerprint,
  reasonText,
  resolve,
} from '../src/domain/configuration';
import { AccessFault } from '../src/ports/identity.ports';
import { requirePermission } from '../src/application/access';
import { ConfigurationQueries } from '../src/application/configuration.service';
import type { ConfigurationRepository, RevisionRecord } from '../src/ports/configuration.ports';

const TENANT = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

function rejects(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof ConfigurationRuleError && e.code === code);
}

test('configuration domain: scopes are closed and secrets are refused', () => {
  const scope = configScope({
    namespace: 'booking',
    key: 'hold.ttl-ms',
    environment: 'production',
    tenantId: null,
  });
  assert.equal(scope.tenantScope, '*');
  assert.equal(
    configScope({
      namespace: 'booking',
      key: 'hold.ttl-ms',
      environment: 'staging',
      tenantId: TENANT.toUpperCase(),
    }).tenantScope,
    TENANT,
  );
  rejects(
    () =>
      configScope({
        namespace: 'Booking',
        key: 'key-one',
        environment: 'production',
        tenantId: null,
      }),
    'INVALID_NAMESPACE',
  );
  rejects(
    () =>
      configScope({ namespace: 'booking', key: 'key-one', environment: 'prod', tenantId: null }),
    'INVALID_ENVIRONMENT',
  );
  rejects(
    () =>
      configScope({
        namespace: 'booking',
        key: 'key-one',
        environment: 'production',
        tenantId: 'x',
      }),
    'INVALID_TENANT',
  );
  for (const key of ['sms.api-key', 'gateway.token-ttl', 'db.password', 'wallet.secret'])
    rejects(
      () => configScope({ namespace: 'ops', key, environment: 'production', tenantId: null }),
      'SECRET_NOT_CONFIGURATION',
    );
});

test('configuration domain: values are typed and decimals are exact text', () => {
  assert.deepEqual(configValue({ type: 'decimal', value: '12.500000' }), {
    type: 'decimal',
    value: '12.500000',
  });
  rejects(() => configValue({ type: 'decimal', value: 12.5 }), 'INVALID_DECIMAL');
  rejects(() => configValue({ type: 'decimal', value: '1.1234567' }), 'INVALID_DECIMAL');
  rejects(() => configValue({ type: 'decimal', value: '01.5' }), 'INVALID_DECIMAL');
  rejects(() => configValue({ type: 'decimal', value: '-0' }), 'INVALID_DECIMAL');
  rejects(() => configValue({ type: 'integer', value: 1.5 }), 'INVALID_INTEGER');
  rejects(() => configValue({ type: 'integer', value: 2 ** 53 }), 'INVALID_INTEGER');
  rejects(() => configValue({ type: 'duration-ms', value: -1 }), 'INVALID_DURATION');
  rejects(() => configValue({ type: 'boolean', value: 'true' }), 'INVALID_BOOLEAN');
  rejects(() => configValue({ type: 'string', value: '' }), 'INVALID_STRING');
  rejects(() => configValue({ type: 'string', value: 'a\u0000b' }), 'INVALID_STRING');
  rejects(() => configValue({ type: 'json', value: {} }), 'INVALID_VALUE_TYPE');
});

test('configuration domain: every change needs a real reason and a second person', () => {
  rejects(() => reasonText('short'), 'REASON_REQUIRED');
  assert.equal(reasonText('  Raise hold TTL for peak hours  '), 'Raise hold TTL for peak hours');
  rejects(() => assertReviewer(TENANT, TENANT.toUpperCase()), 'SELF_REVIEW_FORBIDDEN');
  assertReviewer(TENANT, '0e1f4a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b');
});

test('configuration domain: only approved, newer revisions activate', () => {
  rejects(
    () => assertActivatable({ decision: null, activeRevision: null, candidateRevision: 1 }),
    'REVISION_NOT_APPROVED',
  );
  rejects(
    () => assertActivatable({ decision: 'REJECTED', activeRevision: null, candidateRevision: 1 }),
    'REVISION_NOT_APPROVED',
  );
  rejects(
    () => assertActivatable({ decision: 'APPROVED', activeRevision: 3, candidateRevision: 2 }),
    'REVISION_NOT_NEWER_THAN_ACTIVE',
  );
  rejects(
    () => assertActivatable({ decision: 'APPROVED', activeRevision: 3, candidateRevision: 3 }),
    'REVISION_NOT_NEWER_THAN_ACTIVE',
  );
  assertActivatable({ decision: 'APPROVED', activeRevision: 3, candidateRevision: 4 });
});

test('configuration domain: resolution prefers the tenant value and never invents a default', () => {
  const scope = configScope({
    namespace: 'booking',
    key: 'key-one',
    environment: 'production',
    tenantId: null,
  });
  const env = { scope, revision: 2, value: { type: 'integer' as const, value: 5 } };
  const tenant = {
    scope: { ...scope, tenantScope: TENANT },
    revision: 1,
    value: { type: 'integer' as const, value: 9 },
  };
  const preferred = resolve(tenant, env);
  assert.ok(
    preferred.status === 'CONFIGURED' && preferred.source === 'TENANT' && preferred.revision === 1,
  );
  const fallback = resolve(null, env);
  assert.ok(
    fallback.status === 'CONFIGURED' &&
      fallback.source === 'ENVIRONMENT' &&
      fallback.revision === 2,
  );
  assert.deepEqual(resolve(null, null), { status: 'NOT_CONFIGURED' });
});

test('configuration domain: the proposal fingerprint covers scope, value and reason', () => {
  const scope = configScope({
    namespace: 'booking',
    key: 'key-one',
    environment: 'production',
    tenantId: null,
  });
  const a = proposalFingerprint(scope, { type: 'integer', value: 1 }, 'Reason number one');
  assert.notEqual(
    a,
    proposalFingerprint(scope, { type: 'integer', value: 2 }, 'Reason number one'),
  );
  assert.notEqual(
    a,
    proposalFingerprint(scope, { type: 'integer', value: 1 }, 'Reason number two'),
  );
});

test('configuration access: permissions are required exactly, deny by default', () => {
  const session = {
    subject: TENANT,
    sessionId: TENANT,
    authVersion: 1,
    permissions: ['operations.dispatch'],
  };
  assert.throws(
    () => requirePermission(session, 'configuration.read'),
    (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_FORBIDDEN',
  );
  requirePermission({ ...session, permissions: ['configuration.read'] }, 'configuration.read');
});

test('configuration queries resolve one coherent repository snapshot without inventing a value', async () => {
  const input = {
    namespace: 'booking',
    key: 'hold-ttl',
    environment: 'production',
    tenantId: TENANT,
  };
  const scope = configScope(input);
  const record: RevisionRecord = {
    id: TENANT,
    scope: { ...scope, tenantScope: '*' },
    revision: 2,
    value: { type: 'integer', value: 60 },
    valueHash: 'hash',
    authorSubject: TENANT,
    reason: 'Review the hold duration',
    proposedAt: new Date(0),
    review: null,
  };
  let snapshot: Awaited<ReturnType<ConfigurationRepository['effectiveSnapshot']>> = {
    tenant: null,
    environment: { record, pointer: { activeRevisionId: TENANT, activeRevision: 2, version: 1 } },
  };
  let reads = 0;
  const queries = new ConfigurationQueries({
    effectiveSnapshot(requested) {
      reads += 1;
      assert.deepEqual(requested, scope);
      return Promise.resolve(snapshot);
    },
    history() {
      return Promise.reject(new Error('history must not participate in effective reads'));
    },
  });
  assert.deepEqual(await queries.effective(input), {
    status: 'CONFIGURED',
    source: 'ENVIRONMENT',
    scope: record.scope,
    revision: 2,
    value: { type: 'integer', value: 60 },
  });
  assert.equal(reads, 1);
  snapshot = { tenant: null, environment: null };
  assert.deepEqual(await queries.effective(input), { status: 'NOT_CONFIGURED' });
  assert.equal(reads, 2);
});
