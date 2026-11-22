/**
 * Real Customer HTTP + PostgreSQL provider conformance. Identity is an explicit
 * HTTP test double here; customer.integration.test.mjs covers real Identity.
 * No database, transaction, HTTP adapter or contract parser is mocked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const own = createRequire(new URL('../../../services/customer/package.json', import.meta.url));
const { Client } = own('pg');
const { customerV1, parseApiErrorEnvelope } = own('@carwash/contracts');
own('reflect-metadata');
const { createHttpApplication } = own('./dist/transport/http/create-app.js');
const databaseUrl = process.env.CUSTOMER_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('CUSTOMER_TEST_DATABASE_URL_REQUIRED');

const issued = new Map();
const workloadToken = randomBytes(32).toString('base64url');
let identity;
let app;
let base;

function user(kind = 'account', subject = randomUUID(), changes = {}) {
  const token = randomBytes(32).toString('base64url');
  const view = {
    subject,
    sessionId: randomUUID(),
    authVersion: 1,
    principalKind: kind,
    roles: kind === 'guest' ? [] : ['customer'],
    permissions: ['profile.read:self', 'profile.write:self'],
    ...changes,
  };
  issued.set(`Bearer ${token}`, view);
  return { token, subject, kind, headers: { authorization: `Bearer ${token}` } };
}

test.before(async () => {
  identity = createServer((request, response) => {
    const view = issued.get(request.headers.authorization);
    response.writeHead(view ? 200 : 401, { 'content-type': 'application/json' });
    response.end(JSON.stringify(view ?? { error: { code: 'AUTH_REQUIRED' } }));
  });
  await new Promise((resolve) => identity.listen(0, '127.0.0.1', resolve));
  process.env.DATABASE_URL = databaseUrl;
  process.env.CUSTOMER_IDENTITY_ORIGIN = `http://127.0.0.1:${identity.address().port}`;
  process.env.CUSTOMER_SERVICE_CLIENTS = JSON.stringify([
    {
      id: 'booking',
      tokenSha256: createHash('sha256').update(workloadToken).digest('hex'),
      scopes: ['customer.address-snapshot.resolve'],
    },
  ]);
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

test.after(async () => {
  if (app) await app.close();
  if (identity) {
    identity.closeAllConnections();
    await new Promise((resolve) => identity.close(resolve));
  }
});

async function sql(statement, values = []) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    return await client.query(statement, values);
  } finally {
    await client.end();
  }
}

async function call(path, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`${base}/internal/v1/customer${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

const key = () => randomBytes(18).toString('base64url');
const contact = { displayName: 'سامر', phone: '+963912345678', locale: 'ar' };
const parseProfile = (result) => customerV1.parseCustomerProfileV1(result.body);
const expectError = (result, status, code, reason = undefined) => {
  assert.equal(result.status, status, JSON.stringify(result.body));
  const parsed = parseApiErrorEnvelope(result.body);
  assert.equal(parsed.error.code, code);
  if (reason !== undefined) assert.equal(parsed.error.reason, reason);
  assert.equal(result.headers.get('cache-control'), 'no-store');
};

async function bootstrap(actor = user(), body = contact) {
  const result = await call('/me', {
    method: 'PUT',
    headers: { ...actor.headers, 'idempotency-key': key() },
    body,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { actor, profile: parseProfile(result) };
}

test('canonical GET/PUT/PATCH use published wire shapes, nullability and unverified contacts', async () => {
  expectError(await call('/me'), 401, 'AUTH_REQUIRED');
  const actor = user('guest');
  expectError(await call('/me', { headers: actor.headers }), 404, 'NOT_FOUND', 'PROFILE_NOT_FOUND');
  expectError(
    await call('/me', { method: 'PUT', headers: actor.headers, body: contact }),
    428,
    'IDEMPOTENCY_KEY_REQUIRED',
  );
  const initial = { ...contact, displayName: 'س'.repeat(80), locale: 'en' };
  const { profile } = await bootstrap(actor, initial);
  assert.deepEqual(profile.principal, { kind: 'guest', subjectId: actor.subject });
  assert.equal(profile.contact.displayName, initial.displayName);
  assert.equal(profile.contact.phone, contact.phone);
  assert.equal(profile.contact.phoneVerification, 'unverified');
  assert.equal(profile.status, 'ACTIVE');
  assert.equal(profile.preferences.locale, 'en');
  assert.equal(profile.revision, 1);
  assert.ok(Number.isFinite(Date.parse(profile.createdAt)));
  assert.equal(profile.createdAt, profile.updatedAt);
  const read = await call('/me', { headers: actor.headers });
  assert.deepEqual(parseProfile(read), profile);
  assert.equal(read.headers.get('etag'), '"1"');
  const patch = await call('/me', {
    method: 'PATCH',
    headers: { ...actor.headers, 'idempotency-key': key(), 'if-match': '"1"' },
    body: { displayName: null, phone: null, locale: 'ar' },
  });
  assert.equal(patch.status, 200);
  const updated = parseProfile(patch);
  assert.deepEqual(updated.contact, {
    displayName: null,
    phone: null,
    phoneVerification: 'unverified',
  });
  assert.equal(updated.revision, 2);
  assert.equal(patch.headers.get('etag'), '"2"');
  assert.equal(updated.createdAt, profile.createdAt);
});

test('canonical idempotency and optimistic revisions remain atomic under real PostgreSQL concurrency', async () => {
  const actor = user();
  const idempotency = key();
  const creates = await Promise.all(
    Array.from({ length: 6 }, () =>
      call('/me', {
        method: 'PUT',
        headers: { ...actor.headers, 'idempotency-key': idempotency },
        body: contact,
      }),
    ),
  );
  for (const created of creates) assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(new Set(creates.map((result) => parseProfile(result).customerId)).size, 1);
  assert.equal(
    creates.filter((result) => result.headers.get('idempotent-replayed') === 'true').length,
    5,
  );
  const profile = parseProfile(creates[0]);
  expectError(
    await call('/me', {
      method: 'PUT',
      headers: { ...actor.headers, 'idempotency-key': idempotency },
      body: { ...contact, locale: 'en' },
    }),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
  const writes = await Promise.all(
    ['أحمد', 'عمر'].map((displayName) =>
      call('/me', {
        method: 'PATCH',
        headers: { ...actor.headers, 'idempotency-key': key(), 'if-match': '"1"' },
        body: { ...contact, displayName },
      }),
    ),
  );
  assert.deepEqual(writes.map((result) => result.status).sort(), [200, 412]);
  const success = writes.find((result) => result.status === 200);
  assert.equal(parseProfile(success).revision, 2);
  expectError(
    writes.find((result) => result.status === 412),
    412,
    'REVISION_CONFLICT',
  );
  const rows = await sql(
    'SELECT count(*)::int AS count FROM app.outbox_message WHERE payload LIKE $1',
    [`%${profile.customerId}%`],
  );
  assert.equal(rows.rows[0].count, 2, 'one create and one update, no duplicate events');
});

test('canonical input rejects non-contract phones, overlong names, legacy fields and forged verification', async () => {
  const { actor } = await bootstrap();
  for (const body of [
    { ...contact, phone: '0912345678' },
    { ...contact, displayName: 'س'.repeat(81) },
    { displayName: 'سامر', phone: null, preferredLocale: 'ar' },
    { ...contact, phoneVerification: 'verified' },
  ]) {
    expectError(
      await call('/me', {
        method: 'PATCH',
        headers: { ...actor.headers, 'idempotency-key': key(), 'if-match': '"1"' },
        body,
      }),
      422,
      'VALIDATION_FAILED',
    );
  }
  const read = parseProfile(await call('/me', { headers: actor.headers }));
  assert.equal(read.revision, 1);
  assert.equal(read.contact.phone, contact.phone);
});

test('canonical writes normalize pre-controller JSON/size failures while legacy errors retain their format', async () => {
  const actor = user();
  const sentinel = 'private-input-must-not-be-echoed';
  for (const [method, path] of [
    ['PUT', '/me'],
    ['PATCH', '/me'],
    ['POST', '/address-snapshots/resolve'],
  ]) {
    for (const body of [
      `{"displayName":"${sentinel}",`,
      JSON.stringify({ displayName: sentinel + 'x'.repeat(20_000) }),
    ]) {
      const response = await fetch(`${base}/internal/v1/customer${path}`, {
        method,
        headers: { ...actor.headers, 'content-type': 'application/json', 'idempotency-key': key() },
        body,
      });
      const result = {
        status: response.status,
        headers: response.headers,
        body: await response.json(),
      };
      expectError(result, 400, 'REQUEST_INVALID');
      assert.ok(!JSON.stringify(result.body).includes(sentinel));
    }
  }
  const legacy = await fetch(`${base}/internal/v1/customer/me`, {
    method: 'POST',
    headers: { ...actor.headers, 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(legacy.status, 400);
  const oldError = await legacy.json();
  assert.equal(oldError.error.status, 400);
  assert.ok(!Object.hasOwn(oldError.error, 'retryable'));
  const rows = await sql(
    'SELECT count(*)::int AS count FROM app.customer_profile WHERE principal_subject=$1',
    [actor.subject],
  );
  assert.equal(rows.rows[0].count, 0, 'rejected bodies create no profile');
});

test('legacy contact data remains readable and requires an explicit canonical correction without inferred prefixes', async () => {
  const actor = user();
  const legacy = await call('/me', { method: 'POST', headers: actor.headers });
  assert.equal(legacy.status, 201);
  const changed = await call('/legacy/me', {
    method: 'PATCH',
    headers: { ...actor.headers, 'if-match': '"1"' },
    body: { phone: '0912345678' },
  });
  assert.equal(changed.body.phone, '0912345678');
  expectError(
    await call('/me', { headers: actor.headers }),
    409,
    'CONFLICT',
    'PROFILE_CONTACT_MIGRATION_REQUIRED',
  );
  const retained = await call('/legacy/me', { headers: actor.headers });
  assert.equal(retained.body.phone, '0912345678');
  assert.equal(retained.body.customerId, legacy.body.customerId);
  const corrected = await call('/me', {
    method: 'PATCH',
    headers: { ...actor.headers, 'idempotency-key': key(), 'if-match': '"2"' },
    body: { displayName: null, phone: null, locale: 'ar' },
  });
  assert.equal(corrected.status, 200);
  assert.equal(parseProfile(corrected).contact.phone, null);
  assert.equal(parseProfile(await call('/me', { headers: actor.headers })).revision, 3);
});

test('Identity principal kinds stay isolated; unknown kinds and staff-bearing guests fail closed', async () => {
  const subject = randomUUID();
  const account = await bootstrap(user('account', subject));
  const guest = await bootstrap(user('guest', subject));
  assert.notEqual(account.profile.customerId, guest.profile.customerId);
  assert.equal(account.profile.principal.kind, 'account');
  assert.equal(guest.profile.principal.kind, 'guest');
  for (const actor of [user('unknown'), user('guest', randomUUID(), { roles: ['finance'] })]) {
    expectError(await call('/me', { headers: actor.headers }), 503, 'DEPENDENCY_UNAVAILABLE');
  }
});

const serviceHeaders = () => ({ 'x-service-client': 'booking', 'x-service-token': workloadToken });

async function addressFixture(
  location = {
    kind: 'coordinates',
    source: 'pin',
    coordinates: { crs: 'EPSG:4326', latitude: '36.2', longitude: '37.123456' },
  },
  line = 'عنوان اختباري واضح',
) {
  const { actor, profile } = await bootstrap();
  const address = await call('/me/addresses', {
    method: 'POST',
    headers: { ...actor.headers, 'idempotency-key': key() },
    body: { label: 'المنزل', line, accessNote: 'الباب الخلفي', location },
  });
  assert.equal(address.status, 201, JSON.stringify(address.body));
  const request = {
    owner: profile.principal,
    addressId: address.body.addressId,
    expectedRevision: address.body.revision,
    purpose: 'booking-create',
  };
  const resolve = (body = request, headers = serviceHeaders()) =>
    call('/address-snapshots/resolve', { method: 'POST', headers, body });
  return { actor, profile, address: address.body, request, resolve };
}

test('published address snapshots resolve actual owner data with exact coordinates and a service-purpose audit', async () => {
  const { request, resolve, address } = await addressFixture();
  const result = await resolve();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const snapshot = customerV1.parseAddressSnapshotV1(result.body);
  assert.equal(snapshot.addressId, request.addressId);
  assert.equal(snapshot.addressRevision, 1);
  assert.deepEqual(snapshot.location, {
    mode: 'coordinates',
    point: { latitude: '36.200000', longitude: '37.123456' },
    description: address.line,
  });
  assert.equal(snapshot.details, address.accessNote);
  assert.ok(Number.isFinite(Date.parse(snapshot.capturedAt)));
  const audit = await sql(
    'SELECT actor_subject,actor_session_id,actor_service,actor_purpose FROM app.audit_entry WHERE target_id=$1 AND action=$2',
    [request.addressId, 'customer.address.snapshot-resolved'],
  );
  assert.deepEqual(audit.rows, [
    {
      actor_subject: null,
      actor_session_id: null,
      actor_service: 'booking',
      actor_purpose: 'booking-create',
    },
  ]);
  assert.equal(
    customerV1.parseAddressSnapshotV1((await resolve({ ...request, expectedRevision: null })).body)
      .addressRevision,
    1,
  );
});

test('snapshot owner, revision, active status and credentials are enforced before exposing any data', async () => {
  const { actor, address, request, resolve } = await addressFixture();
  expectError(await resolve(request, {}), 401, 'AUTH_REQUIRED');
  expectError(await resolve(request, actor.headers), 403, 'AUTH_FORBIDDEN');
  expectError(
    await resolve(request, { ...serviceHeaders(), ...actor.headers }),
    403,
    'AUTH_FORBIDDEN',
  );
  expectError(
    await resolve(request, {
      ...serviceHeaders(),
      'x-service-token': randomBytes(32).toString('base64url'),
    }),
    401,
    'AUTH_REQUIRED',
  );
  expectError(
    await resolve({ ...request, owner: { ...request.owner, subjectId: randomUUID() } }),
    404,
    'NOT_FOUND',
  );
  expectError(await resolve({ ...request, expectedRevision: 2 }), 412, 'REVISION_CONFLICT');
  expectError(
    await resolve({ ...request, purpose: 'unapproved-purpose' }),
    422,
    'VALIDATION_FAILED',
  );
  const audit = await sql(
    'SELECT count(*)::int AS count FROM app.audit_entry WHERE target_id=$1 AND action=$2',
    [address.addressId, 'customer.address.snapshot-resolved'],
  );
  assert.equal(audit.rows[0].count, 0, 'refused reads do not record a successful resolution');
  const archived = await call(`/me/addresses/${address.addressId}/archive`, {
    method: 'POST',
    headers: { ...actor.headers, 'if-match': '"1"' },
  });
  assert.equal(archived.status, 200);
  expectError(await resolve({ ...request, expectedRevision: null }), 404, 'NOT_FOUND');
});

test('manual addresses remain manual; underspecified legacy text is not fabricated into a snapshot', async () => {
  const manual = await addressFixture({ kind: 'manual' });
  const snapshot = customerV1.parseAddressSnapshotV1((await manual.resolve()).body);
  assert.deepEqual(snapshot.location, { mode: 'manual', description: manual.address.line });
  const tooShort = await addressFixture({ kind: 'manual' }, 'س');
  expectError(await tooShort.resolve(), 409, 'CONFLICT', 'ADDRESS_MIGRATION_REQUIRED');
});

test('PostgreSQL enforces one audit actor type while keeping service facts append-only', async () => {
  const { address, resolve } = await addressFixture();
  assert.equal((await resolve()).status, 200);
  await assert.rejects(
    () =>
      sql(
        'INSERT INTO app.audit_entry(id,actor_subject,actor_session_id,actor_service,actor_purpose,action,target_type,target_id,correlation_id,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())',
        [
          randomUUID(),
          randomUUID(),
          randomUUID(),
          'booking',
          'booking-create',
          'test.invalid',
          'address',
          address.addressId,
          randomUUID(),
        ],
      ),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    () =>
      sql('UPDATE app.audit_entry SET actor_purpose=$1 WHERE target_id=$2', [
        'booking-display',
        address.addressId,
      ]),
    (error) => error.code === '42501',
  );
});
