/**
 * The production Gateway, Identity, Customer and Vehicle applications together.
 * PostgreSQL and Redis are real and use the lane's disposable least-privilege
 * identities. No HTTP owner, authentication decision, persistence or wire
 * parser is doubled. Identity's unused OTP delivery port is captured by the
 * shared fixture; these scenarios create real guest sessions through Gateway.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  ROOT,
  ORIGIN,
  Jar,
  context,
  contracts,
  idempotencyKey,
  sql,
  startIdentity,
  startService,
} from './_support.mjs';

const own = createRequire(path.join(ROOT, 'apps/api-gateway/package.json'));
const { createGatewayApplication } = own('./dist/index.js');
const { customerV1, vehicleV1, parseApiErrorEnvelope, parsePage } = contracts;
const identity = await startIdentity();
const customer = await startService('customer', context.services.customer.app, {
  CUSTOMER_IDENTITY_ORIGIN: identity.base,
  CUSTOMER_IDENTITY_TIMEOUT_MS: '3000',
});
const vehicle = await startService('vehicle', context.services.vehicle.app, {
  VEHICLE_IDENTITY_ORIGIN: identity.base,
  VEHICLE_IDENTITY_TIMEOUT_MS: '3000',
});
const app = await createGatewayApplication({
  origins: { identity: identity.base, customer: customer.base, vehicle: vehicle.base },
  issuer: 'https://identity.washgo.invalid',
  audience: 'washgo-web',
  cookiePrefix: '__Host-wg_',
  timeoutMs: 5000,
  responseLimit: 262144,
  allowedOrigins: [ORIGIN],
});
await app.listen(0, '127.0.0.1');
const base = await app.getUrl();

test.after(async () => {
  await app.close();
  await vehicle.app.close();
  await customer.app.close();
  await identity.app.close();
});

async function call(jar, route, { method = 'GET', body, headers = {}, csrf = true } = {}) {
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    headers: {
      ...(jar ? { cookie: jar.header() } : {}),
      ...(method === 'GET'
        ? {}
        : {
            'content-type': 'application/json',
            origin: ORIGIN,
            ...(csrf && jar ? { 'x-csrf-token': jar.cookies.get('__Host-wg_csrf') ?? '' } : {}),
          }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
  });
  jar?.absorb(response);
  const text = await response.text();
  const result = {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
  if (result.status >= 400) parseApiErrorEnvelope(result.body);
  return result;
}

async function visitor() {
  const jar = new Jar();
  const csrf = await call(jar, '/auth/csrf');
  assert.equal(csrf.status, 200);
  const created = await call(jar, '/auth/guest-sessions', { method: 'POST', body: {} });
  assert.equal(created.status, 201, 'Real guest session creation must succeed');
  assert.equal(created.body.session.principalKind, 'guest');
  assert.deepEqual(created.body.session.roles, []);
  assert.ok(jar.cookies.has('__Host-wg_access'));
  return { jar, subject: created.body.session.subject, recoveryCode: created.body.recoveryCode };
}

const contact = { displayName: 'عميل اختبار الربط', phone: '+963912345678', locale: 'ar' };
const savedVehicle = {
  type: 'sedan',
  make: 'كيا',
  model: 'ريو',
  color: 'أبيض',
  nickname: 'سيارتي',
  plate: null,
};
const profile = (result) => customerV1.parseCustomerProfileV1(result.body);
const car = (result) => vehicleV1.parseVehicleV1(result.body);
const cars = (result) => parsePage(result.body, '$', vehicleV1.parseVehicleV1);

async function bootstrap(guest, body = contact) {
  const result = await call(guest.jar, '/customer/profile', {
    method: 'PUT',
    headers: { 'idempotency-key': idempotencyKey() },
    body,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return profile(result);
}

test('production Gateway creates a real guest, persists canonical profile and reads the same owner data', async () => {
  const anonymous = await call(null, '/customer/profile');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error.code, 'AUTH_REQUIRED');
  const guest = await visitor();
  const created = await bootstrap(guest);
  assert.deepEqual(created.principal, { kind: 'guest', subjectId: guest.subject });
  assert.equal(created.contact.phoneVerification, 'unverified');
  const read = await call(guest.jar, '/customer/profile');
  assert.equal(read.status, 200);
  assert.deepEqual(profile(read), created);
  assert.equal(read.headers.get('cache-control'), 'no-store');
  const persisted = await sql(
    context.services.customer.app,
    'SELECT principal_kind, principal_subject FROM app.customer_profile WHERE id = $1',
    [created.customerId],
  );
  assert.deepEqual(persisted.rows, [{ principal_kind: 'guest', principal_subject: guest.subject }]);
});

test('production Gateway retains profile optimistic conflict and exact idempotent replay semantics', async () => {
  const guest = await visitor();
  const initial = await bootstrap(guest);
  const key = idempotencyKey();
  const options = {
    method: 'PATCH',
    headers: { 'idempotency-key': key, 'if-match': `"${initial.revision}"` },
    body: { ...contact, displayName: 'تم التحديث' },
  };
  const updated = await call(guest.jar, '/customer/profile', options);
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(profile(updated).revision, initial.revision + 1);
  const replay = await call(guest.jar, '/customer/profile', options);
  assert.equal(replay.status, 200);
  assert.deepEqual(profile(replay), profile(updated));
  const stale = await call(guest.jar, '/customer/profile', {
    ...options,
    headers: { ...options.headers, 'idempotency-key': idempotencyKey() },
  });
  assert.equal(stale.status, 412);
  assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
  assert.equal(stale.body.error.retryable, false);
  assert.deepEqual(profile(await call(guest.jar, '/customer/profile')), profile(updated));
});

test('production Gateway refuses cross-origin and missing-CSRF writes and observes live session revocation', async () => {
  const guest = await visitor();
  const original = await bootstrap(guest);
  const command = {
    method: 'PATCH',
    headers: { 'idempotency-key': idempotencyKey(), 'if-match': `"${original.revision}"` },
    body: { ...contact, displayName: 'غير مسموح' },
  };
  for (const options of [
    { ...command, csrf: false },
    { ...command, headers: { ...command.headers, origin: 'https://foreign.invalid' } },
  ]) {
    const result = await call(guest.jar, '/customer/profile', options);
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'AUTH_CSRF');
  }
  assert.deepEqual(profile(await call(guest.jar, '/customer/profile')), original);
  const stillSignedToken = guest.jar.cookies.get('__Host-wg_access');
  assert.equal((await call(guest.jar, '/auth/logout', { method: 'POST', body: {} })).status, 204);
  const revoked = await call(null, '/customer/profile', {
    headers: { authorization: `Bearer ${stillSignedToken}` },
  });
  assert.equal(revoked.status, 401);
  assert.equal(revoked.body.error.code, 'AUTH_REQUIRED');
});

test('production Gateway persists canonical Vehicle CRUD, preserves revision conflicts and filters archived vehicles', async () => {
  const guest = await visitor();
  const key = idempotencyKey();
  const create = {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: savedVehicle,
  };
  const created = await call(guest.jar, '/customer/vehicles', create);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const original = car(created);
  assert.deepEqual(car(await call(guest.jar, '/customer/vehicles', create)), original);
  const read = await call(guest.jar, '/customer/vehicles?limit=1');
  assert.equal(read.status, 200);
  assert.deepEqual(cars(read).items, [original]);
  const updated = await call(guest.jar, `/customer/vehicles/${original.vehicleId}`, {
    method: 'PATCH',
    headers: { 'idempotency-key': idempotencyKey(), 'if-match': `"${original.revision}"` },
    body: { ...savedVehicle, color: 'أزرق' },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(car(updated).color, 'أزرق');
  const stale = await call(guest.jar, `/customer/vehicles/${original.vehicleId}/archive`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey(), 'if-match': `"${original.revision}"` },
    body: {},
  });
  assert.equal(stale.status, 412);
  assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
  const archived = await call(guest.jar, `/customer/vehicles/${original.vehicleId}/archive`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey(), 'if-match': `"${car(updated).revision}"` },
    body: {},
  });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  assert.equal(car(archived).archived, true);
  assert.deepEqual(cars(await call(guest.jar, '/customer/vehicles')).items, []);
});

test('production Gateway cannot select another principal through spoofed headers, vehicle IDs or queries', async () => {
  const owner = await visitor();
  const other = await visitor();
  const original = await bootstrap(owner);
  const foreign = await bootstrap(other, { ...contact, displayName: 'عميل آخر' });
  const ownProfile = await call(owner.jar, '/customer/profile', {
    headers: { 'x-auth-subject': other.subject, 'x-auth-principal-kind': 'account' },
  });
  assert.equal(profile(ownProfile).customerId, original.customerId);
  assert.notEqual(profile(ownProfile).customerId, foreign.customerId);
  const created = await call(owner.jar, '/customer/vehicles', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey() },
    body: savedVehicle,
  });
  assert.equal(created.status, 201);
  const item = car(created);
  const denied = await call(other.jar, `/customer/vehicles/${item.vehicleId}/archive`, {
    method: 'POST',
    headers: {
      'idempotency-key': idempotencyKey(),
      'if-match': `"${item.revision}"`,
      'x-auth-subject': owner.subject,
      'x-service-client': 'booking',
      'x-service-token': 'not-a-workload-credential',
    },
    body: {},
  });
  assert.equal(denied.status, 404);
  assert.equal(denied.body.error.code, 'NOT_FOUND');
  assert.deepEqual(cars(await call(other.jar, '/customer/vehicles')).items, []);
  assert.equal(cars(await call(owner.jar, '/customer/vehicles')).items[0].archived, false);
  const query = await call(other.jar, `/customer/vehicles?subjectId=${owner.subject}`);
  assert.equal(query.status, 400);
  assert.equal(query.body.error.code, 'REQUEST_INVALID');
});

test('real guest recovery preserves owned records, rotates the recovery code and revokes the previous session', async () => {
  const original = await visitor();
  const originalProfile = await bootstrap(original);
  const created = await call(original.jar, '/customer/vehicles', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey() },
    body: savedVehicle,
  });
  assert.equal(created.status, 201);
  const originalVehicle = car(created);
  const previousToken = original.jar.cookies.get('__Host-wg_access');
  const recoveredJar = new Jar();
  assert.equal((await call(recoveredJar, '/auth/csrf')).status, 200);
  const recovered = await call(recoveredJar, '/auth/guest-sessions/recover', {
    method: 'POST',
    body: { recoveryCode: original.recoveryCode },
  });
  assert.equal(recovered.status, 200, 'Guest recovery must use the actual Identity owner');
  assert.equal(recovered.body.session.subject, original.subject);
  assert.equal(recovered.body.session.principalKind, 'guest');
  assert.ok(
    typeof recovered.body.recoveryCode === 'string' &&
      recovered.body.recoveryCode !== original.recoveryCode,
    'Recovery must issue a new one-time code',
  );
  // A new client has only the server-issued cookies, no previous JS session data.
  const reloaded = new Jar();
  reloaded.cookies = new Map(recoveredJar.cookies);
  assert.deepEqual(profile(await call(reloaded, '/customer/profile')), originalProfile);
  assert.deepEqual(cars(await call(reloaded, '/customer/vehicles')).items, [originalVehicle]);
  assert.equal(
    (
      await call(null, '/customer/profile', {
        headers: { authorization: `Bearer ${previousToken}` },
      })
    ).status,
    401,
  );
  const anotherJar = new Jar();
  await call(anotherJar, '/auth/csrf');
  const oldCode = await call(anotherJar, '/auth/guest-sessions/recover', {
    method: 'POST',
    body: { recoveryCode: original.recoveryCode },
  });
  assert.equal(oldCode.status, 401);
  assert.equal(oldCode.body.error.code, 'AUTH_REQUIRED');
});
