/**
 * Configuration revisions through the real HTTP application on a real
 * PostgreSQL, with the service's runtime identity.
 *
 * Identity is represented by a loopback HTTP server that serves the published
 * `GET /internal/v1/identity/session` shape. That is a provider stub, declared
 * as such: the permissions `configuration.read`/`configuration.write` are not
 * yet granted by the real Identity (CR-D-P01-01), so a real Identity can only
 * ever produce the deny-by-default path, which `tok-staff` models here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { URLSearchParams } from 'node:url';
import path from 'node:path';
import {
  ROOT,
  appDsn,
  context,
  migrationDsn,
  serviceClient,
  sql,
} from '../../integration/_support.mjs';
import { composeExec } from '../../../scripts/acceptance/lib/infra.mjs';
import { hardenPrivileges } from '../../../scripts/acceptance/lib/migrations.mjs';

const require = createRequire(path.join(ROOT, 'services', 'configuration', 'package.json'));
require('reflect-metadata');
const { createHttpApplication } = require(
  path.join(ROOT, 'services', 'configuration', 'dist', 'transport', 'http', 'create-app.js'),
);

const AUTHOR = randomUUID();
const REVIEWER = randomUUID();
const READER = randomUUID();
const STAFF = randomUUID();
const SESSIONS = {
  'tok-author-000000000000000': {
    subject: AUTHOR,
    permissions: ['configuration.read', 'configuration.write'],
  },
  'tok-reviewer-0000000000000': {
    subject: REVIEWER,
    permissions: ['configuration.read', 'configuration.write'],
  },
  'tok-reader-000000000000000': { subject: READER, permissions: ['configuration.read'] },
  // Today's real roles: valid session, none of the requested permissions.
  'tok-staff-0000000000000000': {
    subject: STAFF,
    permissions: ['operations.dispatch', 'billing.read'],
  },
};
let identityMode = 'normal';

const identity = createServer((req, res) => {
  if (req.url !== '/internal/v1/identity/session') {
    res.writeHead(404).end();
    return;
  }
  if (identityMode === 'down') {
    res.writeHead(500, { 'content-type': 'application/json' }).end('{}');
    return;
  }
  if (identityMode === 'hang') return;
  if (identityMode === 'garbage') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"subject":"nope"}');
    return;
  }
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const session = SESSIONS[token];
  if (!session) {
    res
      .writeHead(401, { 'content-type': 'application/json' })
      .end('{"error":{"code":"AUTH_REQUIRED"}}');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      ...session,
      sessionId: randomUUID(),
      authVersion: 1,
      roles: ['operations'],
    }),
  );
});

const db = serviceClient('configuration');
let app;
let base;

test.before(async () => {
  await new Promise((resolve) => identity.listen(0, '127.0.0.1', resolve));
  process.env.DATABASE_URL = appDsn(context, 'configuration');
  process.env.IDENTITY_ORIGIN = `http://127.0.0.1:${identity.address().port}`;
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/internal/v1/configuration`;
});

test.after(async () => {
  await app?.close();
  identity.closeAllConnections();
  identity.close();
  await db.$disconnect();
});

async function call(method, route, { token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const author = 'tok-author-000000000000000';
const reviewer = 'tok-reviewer-0000000000000';
const reader = 'tok-reader-000000000000000';
const staff = 'tok-staff-0000000000000000';

function scope() {
  return {
    namespace: 'booking',
    key: `hold-ttl-${randomUUID().slice(0, 8)}`,
    environment: 'production',
  };
}

async function propose(
  target,
  value,
  { tenantId = null, key = `idem-${randomUUID()}`, type = 'integer' } = {},
) {
  return call('POST', '/revisions', {
    token: author,
    headers: { 'idempotency-key': key },
    body: { ...target, tenantId, type, value, reason: 'Adjust the hold window for peak demand' },
  });
}

async function approve(id, token = reviewer) {
  return call('POST', `/revisions/${id}/review`, {
    token,
    body: { decision: 'APPROVED', note: 'Checked against the capacity plan' },
  });
}

function effective(target, tenantId) {
  const query = new URLSearchParams({
    environment: target.environment,
    ...(tenantId ? { tenantId } : {}),
  });
  return call('GET', `/values/${target.namespace}/${target.key}?${query}`, { token: reader });
}

/* ------------------------------ authorization ----------------------------- */

test('H1: authentication and authorization are enforced server-side and fail closed', async () => {
  const target = scope();
  const route = `/values/${target.namespace}/${target.key}?environment=production`;
  assert.equal((await call('GET', route)).status, 401, 'no token');
  assert.equal((await call('GET', route, { token: 'tok-unknown-00000000000000' })).status, 401);
  const denied = await call('GET', route, { token: staff });
  assert.equal(denied.status, 403, 'a valid staff session without the permission is denied');
  assert.equal(denied.body.error.code, 'AUTH_FORBIDDEN');
  assert.match(denied.body.error.correlationId, /^[0-9a-f-]{36}$/);
  const staffWrite = await call('POST', '/revisions', {
    token: staff,
    headers: { 'idempotency-key': `idem-${randomUUID()}` },
    body: {},
  });
  assert.equal(staffWrite.status, 403, 'permission is checked before the body is even read');
  assert.equal(
    (
      await call('POST', '/revisions', {
        token: reader,
        headers: { 'idempotency-key': `idem-${randomUUID()}` },
        body: {},
      })
    ).status,
    403,
    'read does not imply write',
  );
  const mismatch = await call('GET', route, {
    token: reader,
    headers: { 'x-auth-subject': randomUUID() },
  });
  assert.equal(mismatch.status, 401, 'a forwarded subject that disagrees with Identity is refused');

  for (const mode of ['down', 'garbage']) {
    identityMode = mode;
    try {
      const unavailable = await call('GET', route, { token: reader });
      assert.equal(unavailable.status, 503, `identity ${mode} fails closed`);
      assert.equal(unavailable.body.error.code, 'AUTH_UNAVAILABLE');
    } finally {
      identityMode = 'normal';
    }
  }
});

test('H2: an unresponsive Identity is a bounded 503, not a hang or an allow', async () => {
  identityMode = 'hang';
  try {
    const started = Date.now();
    const result = await call('GET', '/values/booking/hold-ttl?environment=production', {
      token: reader,
    });
    assert.equal(result.status, 503);
    assert.ok(Date.now() - started < 5_000, 'the 2s Identity deadline is enforced');
  } finally {
    identityMode = 'normal';
  }
});

/* -------------------------------- lifecycle ------------------------------- */

test('H3: propose → four-eyes review → activate → effective read, with idempotent replay', async () => {
  const target = scope();
  assert.deepEqual(
    (await effective(target)).body,
    { status: 'NOT_CONFIGURED' },
    'no invented default',
  );

  const key = `idem-${randomUUID()}`;
  const created = await propose(target, 900_000, { key, type: 'duration-ms' });
  assert.equal(created.status, 201);
  assert.equal(created.body.replayed, false);
  assert.equal(created.body.revision.revision, 1);
  const replay = await propose(target, 900_000, { key, type: 'duration-ms' });
  assert.equal(replay.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.revision.id, created.body.revision.id);
  assert.equal(
    (await propose(target, 1, { key, type: 'duration-ms' })).status,
    409,
    'same key, different request',
  );

  const id = created.body.revision.id;
  const early = await call('POST', `/revisions/${id}/activate`, {
    token: author,
    body: { expectedVersion: 0 },
  });
  assert.deepEqual([early.status, early.body.error.code], [409, 'REVISION_NOT_APPROVED']);
  const self = await approve(id, author);
  assert.deepEqual([self.status, self.body.error.code], [403, 'SELF_REVIEW_FORBIDDEN']);
  assert.equal((await approve(id)).status, 200);
  assert.equal((await approve(id)).status, 409, 'one decision per revision');

  const activated = await call('POST', `/revisions/${id}/activate`, {
    token: author,
    body: { expectedVersion: 0 },
  });
  assert.equal(activated.status, 200);
  assert.deepEqual(activated.body, { activeRevision: 1, version: 1 });

  const read = await effective(target);
  assert.deepEqual(read.body, {
    status: 'CONFIGURED',
    source: 'ENVIRONMENT',
    revision: 1,
    value: { type: 'duration-ms', value: 900_000 },
  });

  const audit = await db.configAudit.findMany({
    where: { revisionId: id },
    orderBy: { occurredAt: 'asc' },
  });
  assert.deepEqual(audit.map((a) => a.action).sort(), ['ACTIVATED', 'APPROVED', 'PROPOSED']);
  assert.deepEqual(audit.map((a) => a.actorSubject).sort(), [AUTHOR, AUTHOR, REVIEWER].sort());
  assert.ok(!JSON.stringify(audit).includes('900000'), 'audit rows carry a hash, never the value');
});

test('H4: a tenant value overrides only that tenant; decimals stay exact', async () => {
  const target = scope();
  const tenant = randomUUID();
  const env = await propose(target, '12.500000', { type: 'decimal' });
  await approve(env.body.revision.id);
  await call('POST', `/revisions/${env.body.revision.id}/activate`, {
    token: author,
    body: { expectedVersion: 0 },
  });
  const own = await propose(target, '9.250000', { type: 'decimal', tenantId: tenant });
  assert.equal(own.body.revision.revision, 1, 'tenant scope has its own revision sequence');
  await approve(own.body.revision.id);
  await call('POST', `/revisions/${own.body.revision.id}/activate`, {
    token: author,
    body: { expectedVersion: 0 },
  });

  const forTenant = await effective(target, tenant);
  assert.deepEqual(
    [forTenant.body.source, forTenant.body.value],
    ['TENANT', { type: 'decimal', value: '9.250000' }],
  );
  const forOther = await effective(target, randomUUID());
  assert.deepEqual(
    [forOther.body.source, forOther.body.value],
    ['ENVIRONMENT', { type: 'decimal', value: '12.500000' }],
  );
  assert.equal(
    (await propose(target, 12.5, { type: 'decimal' })).status,
    422,
    'a float decimal is refused',
  );
});

test('H5: concurrent activations of one pointer version: exactly one wins', async () => {
  const target = scope();
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    const created = await propose(target, i + 1);
    await approve(created.body.revision.id);
    ids.push(created.body.revision.id);
  }
  await call('POST', `/revisions/${ids[0]}/activate`, {
    token: author,
    body: { expectedVersion: 0 },
  });
  const racing = await Promise.all(
    [ids[1], ids[2]].map((id) =>
      call('POST', `/revisions/${id}/activate`, { token: author, body: { expectedVersion: 1 } }),
    ),
  );
  assert.deepEqual(racing.map((r) => r.status).sort(), [200, 409]);
  const pointer = await db.configPointer.findUnique({
    where: { namespace_key_environment_tenantScope: { ...target, tenantScope: '*' } },
  });
  assert.equal(pointer.version, 2);
  // Whichever won, an older revision cannot be re-activated over a newer one.
  if (pointer.activeRevision === 3) {
    const back = await call('POST', `/revisions/${ids[1]}/activate`, {
      token: author,
      body: { expectedVersion: 2 },
    });
    assert.deepEqual([back.status, back.body.error.code], [409, 'REVISION_NOT_NEWER_THAN_ACTIVE']);
  }
});

test('H6: concurrent proposals on one scope get distinct, gap-free revision numbers', async () => {
  const target = scope();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => propose(target, i)));
  assert.ok(
    results.every((r) => r.status === 201),
    JSON.stringify(results.map((r) => r.status)),
  );
  assert.deepEqual(
    results.map((r) => r.body.revision.revision).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  const history = await call(
    'GET',
    `/values/${target.namespace}/${target.key}/revisions?environment=production&limit=3`,
    { token: reader },
  );
  assert.deepEqual(
    history.body.revisions.map((r) => r.revision),
    [10, 9, 8],
  );
});

test('H7: invalid input is refused with stable codes; secrets are not configuration', async () => {
  const target = scope();
  const bad = await call('POST', '/revisions', {
    token: author,
    headers: { 'idempotency-key': `idem-${randomUUID()}` },
    body: {
      ...target,
      key: 'sms.api-key',
      tenantId: null,
      type: 'string',
      value: 'x',
      reason: 'Store the provider key here',
    },
  });
  assert.deepEqual([bad.status, bad.body.error.code], [422, 'SECRET_NOT_CONFIGURATION']);
  const noKey = await call('POST', '/revisions', {
    token: author,
    body: { ...target, type: 'integer', value: 1, reason: 'Missing idempotency key test' },
  });
  assert.deepEqual([noKey.status, noKey.body.error.code], [422, 'IDEMPOTENCY_KEY_REQUIRED']);
  const missing = await call('POST', `/revisions/${randomUUID()}/activate`, {
    token: author,
    body: { expectedVersion: 0 },
  });
  assert.equal(missing.status, 404);
});

test('H8: history remains append-only after provisioning replay and privilege hardening', async () => {
  const url = appDsn(context, 'configuration');
  const tables = ['config_revision', 'config_review', 'config_audit'];
  const assertImmutable = async () => {
    for (const table of tables) {
      for (const statement of [
        `UPDATE app.${table} SET ${table === 'config_review' ? 'decision = decision' : table === 'config_revision' ? 'reason = reason' : 'action = action'} WHERE false`,
        `DELETE FROM app.${table} WHERE false`,
        `TRUNCATE app.${table} CASCADE`,
      ]) {
        const result = await sql(url, statement);
        assert.equal(result.ok, false, `${statement} must be refused`);
        assert.equal(result.code, '42501', `${statement}: ${result.message}`);
      }
    }
    const writable = await sql(
      url,
      `SELECT has_table_privilege(current_user, 'app.config_pointer', 'UPDATE') AS allowed`,
    );
    assert.equal(writable.ok, true);
    assert.equal(writable.rows[0].allowed, true, 'activation pointer keeps its update permission');
  };
  // Replay the provisioner from the tree under test, not a stale bind mount
  // belonging to whichever worktree created this disposable stack.
  const replay = await composeExec(
    context,
    'postgres',
    ['sh', '-c', 'CW_SERVICES=configuration sh -s'],
    {
      input: await readFile(path.join(ROOT, 'infra/postgres/provision.sh'), 'utf8'),
    },
  );
  assert.equal(replay.code, 0, replay.stderr);
  await assertImmutable();

  // Prove the separate post-migration repair path restores the policy too.
  for (const table of tables) {
    const grant = await sql(
      migrationDsn(context, 'configuration'),
      `GRANT UPDATE, DELETE, TRUNCATE ON app.${table} TO cw_configuration_app`,
    );
    assert.equal(grant.ok, true, grant.message);
  }
  const hardened = await hardenPrivileges(context, 'configuration');
  assert.equal(hardened.code, 0, hardened.stderr);
  await assertImmutable();
});

test('H9: tenant miss and environment fallback remain coherent during concurrent activations', async () => {
  const target = scope();
  const tenantId = randomUUID();
  const previous = await propose(target, 10);
  const next = await propose(target, 20);
  const tenant = await propose(target, 30, { tenantId });
  for (const result of [previous, next, tenant]) {
    assert.equal(result.status, 201);
    assert.equal((await approve(result.body.revision.id)).status, 200);
  }
  const activate = (id, expectedVersion) =>
    call('POST', `/revisions/${id}/activate`, {
      token: reviewer,
      body: { expectedVersion },
    });
  assert.equal((await activate(previous.body.revision.id, 0)).status, 200);
  let concurrentWrites = 0;
  const observing = db.$extends({
    query: {
      configPointer: {
        async findUnique({ args, query }) {
          const pointer = await query(args);
          if (args.where.namespace_key_environment_tenantScope?.tenantScope === tenantId) {
            assert.equal(pointer, null);
            concurrentWrites += 1;
            // The new environment value is NEVER effective for this tenant: its
            // override commits first, while the read has already observed a miss.
            assert.equal((await activate(tenant.body.revision.id, 0)).status, 200);
            assert.equal((await activate(next.body.revision.id, 1)).status, 200);
          }
          return pointer;
        },
      },
    },
  });
  let snapshots = 0;
  const client = new Proxy(observing, {
    get(object, key) {
      if (key === '$transaction')
        return (...args) => {
          snapshots += 1;
          return object.$transaction(...args);
        };
      return Reflect.get(object, key);
    },
  });
  const { ConfigurationQueries } = require(
    path.join(ROOT, 'services/configuration/dist/application/configuration.service.js'),
  );
  const { PrismaConfigurationRepository } = require(
    path.join(
      ROOT,
      'services/configuration/dist/infrastructure/persistence/prisma-configuration.repository.js',
    ),
  );
  const queries = new ConfigurationQueries(new PrismaConfigurationRepository(client));
  const result = await queries.effective({ ...target, tenantId });
  assert.equal(snapshots, 1, 'one snapshot includes the miss and its fallback');
  assert.equal(concurrentWrites, 1, 'both activations committed between scope lookups');
  assert.equal(result.source, 'ENVIRONMENT');
  assert.equal(result.value.value, 10, 'read retains the earlier coherent snapshot');
  const current = await effective(target, tenantId);
  assert.equal(current.body.source, 'TENANT');
  assert.equal(current.body.value.value, 30);
});
