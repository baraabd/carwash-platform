import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, own, gateway, stub, config, start, request, ORIGIN } from './_helpers.mjs';
const { GATEWAY_ROUTES, GATEWAY_COMPOSITIONS } = own('@carwash/contracts');
const security = createRequire(path.join(ROOT, 'packages/security-kit/package.json'));
const { SignJWT } = security('jose');
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...keys.publicKey.export({ format: 'jwk' }),
  kid: 'fixture-kid-0001',
  alg: 'RS256',
  use: 'sig',
};
async function signedSession(
  t,
  permissions = [
    'profile.read:self',
    'profile.write:self',
    'bookings.read:self',
    'bookings.create:self',
  ],
  shape = { principalKind: 'account', roles: ['customer'] },
) {
  const principal = { subject: randomUUID(), sessionId: randomUUID(), authVersion: 1 };
  const session = { ...principal, ...shape, permissions };
  const token = await new SignJWT({ sid: principal.sessionId, ver: 1 })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'at+jwt' })
    .setSubject(principal.subject)
    .setIssuer('https://identity.washgo.invalid')
    .setAudience('washgo-web')
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey);
  const identity = await stub('identity', (call, res) => {
    res.end(JSON.stringify(call.path.endsWith('jwks.json') ? { keys: [jwk] } : session));
  });
  t.after(() => identity.close());
  return { identity, token, session };
}
test('F007 route manifest has unique method/path and explicit owners, all composition is GET', () => {
  assert.equal(
    new Set(GATEWAY_ROUTES.map((r) => r.method + ' ' + (r.prefix ?? '/api/v1') + r.path)).size,
    GATEWAY_ROUTES.length,
  );
  for (const r of GATEWAY_ROUTES) {
    assert.ok(r.owner);
    if (r.method !== 'GET' && !r.authTransport && !r.providerIngress && !r.safe)
      assert.equal(r.idempotency, 'required');
    if (r.safe) {
      assert.equal(r.method, 'POST');
      assert.ok(r.permission);
      assert.ok(r.id.startsWith('operator.media.'));
    }
  }
  for (const c of GATEWAY_COMPOSITIONS)
    for (const id of c.routes) assert.equal(GATEWAY_ROUTES.find((r) => r.id === id)?.method, 'GET');
});
test('Reviews principal-only routes authenticate without inventing a role grant', async (t) => {
  const { identity, token } = await signedSession(t, []);
  const reviews = await stub('reviews');
  t.after(() => reviews.close());
  const app = await start(config(identity.base, { reviews: reviews.base }));
  t.after(() => app.close());
  const bookingId = randomUUID();
  const route = `/api/v1/customer/bookings/${bookingId}/review`;
  assert.equal((await request(app.base, route)).status, 401);
  assert.equal(reviews.calls.length, 0);
  const allowed = await request(app.base, route, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(allowed.status, 200);
  assert.equal(reviews.calls[0].path, `/internal/v1/reviews/bookings/${bookingId}/review`);
  assert.equal(reviews.calls[0].headers.authorization, `Bearer ${token}`);
  assert.equal(reviews.calls[0].headers.cookie, undefined);
  const denied = await request(app.base, '/api/v1/admin/customer-reviews', {
    headers: { authorization: `Bearer ${token}`, 'x-permissions': 'reviews.moderate' },
  });
  assert.equal(denied.status, 403);
  assert.equal(reviews.calls.length, 1);
});
test('F007 route matcher rejects arbitrary origins, traversal, query injection and unsafe methods', () => {
  for (const p of [
    '/api/v1/customer/%2e%2e/billing',
    '/api/v1/customer/profile?url=https://attacker.invalid',
    'https://attacker.invalid',
    '/api/v1/customer/../profile',
    '/api/v1/customer/profile/',
    '/api/v1/customer/profile%2f',
  ])
    assert.throws(() => gateway.routeMatch('GET', p));
  assert.throws(() => gateway.routeMatch('DELETE', '/api/v1/customer/profile'));
  const id = randomUUID();
  assert.equal(
    gateway.routeMatch('POST', `/api/v1/admin/billing/obligations/${id}/refunds`).upstream,
    `/internal/v1/billing/obligations/${id}/refunds`,
  );
});
test('F007 invalid idempotency keys cannot reach an upstream', () => {
  for (const key of [undefined, '', 'short', 'x'.repeat(129), 'a'.repeat(16) + '\n'])
    assert.throws(() => gateway.idempotencyKey(key));
  assert.equal(gateway.idempotencyKey('command_1234567890'), 'command_1234567890');
});
test('P03-P06 browser routes use exact owner paths and closed parameter enums', () => {
  const id = randomUUID();
  const match = (method, path) => gateway.routeMatch(method, path).upstream;
  assert.equal(match('GET', '/api/v1/customer/packages'), '/internal/v1/catalog/definitions');
  assert.equal(match('POST', '/api/v1/customer/bookings'), '/internal/v1/booking/bookings');
  assert.equal(match('GET', `/api/operator/tasks/${id}`), `/internal/v1/dispatch/me/tasks/${id}`);
  assert.equal(
    match('PUT', `/api/operator/tasks/${id}/evidence/BEFORE/0`),
    `/internal/v1/dispatch/tasks/${id}/evidence/BEFORE/0`,
  );
  assert.equal(
    match('DELETE', `/api/operator/tasks/${id}/evidence/AFTER/1`),
    `/internal/v1/dispatch/tasks/${id}/evidence/AFTER/1`,
  );
  assert.equal(
    match('PUT', `/api/operator/tasks/${id}/checklist/wheels`),
    `/internal/v1/dispatch/tasks/${id}/checklist/wheels`,
  );
  assert.equal(
    match('PUT', '/api/operator/equipment/VACUUM/status'),
    '/internal/v1/workforce/me/equipment/VACUUM/status',
  );
  for (const bad of [
    `/api/operator/tasks/${id}/evidence/BEFORE/2`,
    `/api/operator/tasks/${id}/evidence/before/0`,
    `/api/operator/tasks/${id}/checklist/freeform`,
    '/api/operator/equipment/any/status',
    `/api/operator/tasks/${id}/evidence/%42EFORE/0`,
    `/api/operator/tasks/${id}/evidence/BEFORE/../1`,
  ])
    assert.throws(() => match('PUT', bad));
  assert.throws(() => match('GET', `/api/v1/tasks/${id}`));
  assert.throws(() => match('GET', '/api/operator/admin/billing'));
  assert.throws(() => match('POST', '/api/operator/media/claims'));
});
test('P02-P06 admin query rules reject duplicates, unknown keys and encoded injection', () => {
  const route = '/api/v1/admin/operations/bookings';
  const value = gateway.routeMatch('GET', `${route}?from=2026-11-22T00%3A00%3A00Z&limit=20`);
  assert.equal(
    value.upstream,
    '/internal/v1/reporting/operations/bookings?from=2026-11-22T00%3A00%3A00Z&limit=20',
  );
  for (const q of [
    'limit=1&limit=2',
    'limit=0',
    'limit=1000',
    'limit=2&target=x',
    'cursor=../../identity',
    'cursor=%0aanything',
    'from=https%3A%2F%2Fevil.invalid',
    'limit=1?limit=2',
    'cursor=' + 'x'.repeat(2050),
  ]) {
    assert.throws(() => gateway.routeMatch('GET', `${route}?${q}`));
  }
});
test('P03-P06 real Gateway HTTP forwards every technician and admin route without credential spoofing', async (t) => {
  const { IDENTITY_PERMISSIONS } = own('@carwash/contracts');
  const { identity, token } = await signedSession(t, [...IDENTITY_PERMISSIONS], {
    principalKind: 'account',
    roles: ['super-admin'],
  });
  const routes = GATEWAY_ROUTES.filter(
    (r) =>
      r.prefix === '/api/operator' ||
      r.id.startsWith('admin.operations.') ||
      r.id.startsWith('admin.assignments.') ||
      r.id.startsWith('admin.notifications.') ||
      r.id === 'admin.finance.cash' ||
      r.id === 'admin.booking.get',
  );
  const owners = new Map();
  for (const name of new Set(routes.map((r) => r.owner).filter((name) => name !== 'identity'))) {
    const owner = await stub(name);
    owners.set(name, owner);
    t.after(() => owner.close());
  }
  const app = await start(
    config(
      identity.base,
      Object.fromEntries([...owners].map(([name, owner]) => [name, owner.base])),
    ),
  );
  t.after(() => app.close());
  const id = randomUUID();
  for (const route of routes) {
    const expand = (path) =>
      path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, name) => route.pathEnums?.[name]?.[0] ?? id);
    const key = randomUUID();
    const response = await request(app.base, (route.prefix ?? '/api/v1') + expand(route.path), {
      method: route.method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: ORIGIN,
        'idempotency-key': key,
        'x-auth-subject': 'forged',
        'x-service-name': 'billing',
      },
      ...(route.method !== 'GET' ? { body: JSON.stringify({ expectedRevision: 1 }) } : {}),
    });
    assert.equal(response.status, 200, route.id);
    if (route.owner === 'identity') continue;
    const forwarded = owners.get(route.owner).calls.at(-1);
    assert.equal(forwarded.path, expand(route.upstream), route.id);
    assert.equal(forwarded.method, route.method, route.id);
    assert.equal(forwarded.headers.authorization, `Bearer ${token}`);
    assert.notEqual(forwarded.headers['x-auth-subject'], 'forged');
    assert.equal(forwarded.headers['x-service-name'], undefined);
    assert.equal(forwarded.headers.cookie, undefined);
    if (route.idempotency) assert.equal(forwarded.headers['idempotency-key'], key);
  }
});
test('P03 cash capability cannot reach treasury, and a customer cannot use technician routes', async (t) => {
  const { identity, token } = await signedSession(
    t,
    ['work.read:assigned', 'work.execute:assigned', 'billing.cash.collect'],
    { principalKind: 'account', roles: ['technician'] },
  );
  const billing = await stub('billing');
  t.after(() => billing.close());
  const app = await start(config(identity.base, { billing: billing.base }));
  t.after(() => app.close());
  assert.equal(
    (
      await request(app.base, '/api/operator/custody', {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status,
    200,
  );
  assert.equal(billing.calls.at(-1).path, '/internal/v1/billing/custody/holders/me');
  assert.equal(
    (
      await request(app.base, '/api/v1/admin/billing', {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status,
    403,
  );
  const customer = await signedSession(t);
  const customerApp = await start(config(customer.identity.base, { billing: billing.base }));
  t.after(() => customerApp.close());
  assert.equal(
    (
      await request(customerApp.base, '/api/operator/custody', {
        headers: { authorization: `Bearer ${customer.token}` },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(customerApp.base, '/api/operator/session', {
        headers: { authorization: `Bearer ${customer.token}` },
      })
    ).status,
    403,
  );
  assert.equal(billing.calls.length, 1);
});
test('P02 an in-flight booking retains shared idempotency recovery semantics without leaking an unpublished reason', async (t) => {
  const { identity, token } = await signedSession(t);
  let ownerCode = 'IDEMPOTENCY_IN_PROGRESS';
  const booking = await stub('booking', (_call, response) => {
    response.statusCode = 409;
    response.end(JSON.stringify({ error: { code: ownerCode, reason: 'INTERNAL_PRIVATE' } }));
  });
  t.after(() => booking.close());
  const app = await start(config(identity.base, { booking: booking.base }));
  t.after(() => app.close());
  const key = randomUUID();
  const result = await request(app.base, '/api/v1/customer/bookings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: '{}',
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'IDEMPOTENCY_IN_PROGRESS');
  assert.equal(result.body.error.retryable, true);
  assert.equal(result.body.error.reason, null);
  assert.equal(booking.calls[0].headers['idempotency-key'], key);
  ownerCode = 'INTERNAL_ERROR';
  const inconsistent = await request(app.base, '/api/v1/customer/bookings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: '{}',
  });
  assert.equal(inconsistent.status, 409);
  assert.equal(inconsistent.body.error.code, 'CONFLICT');
  assert.equal(inconsistent.body.error.retryable, false);
  assert.equal(inconsistent.body.error.reason, null);
});
test('P03 finance freshness matches the owner grant without opening operations resources', async (t) => {
  const { identity, token } = await signedSession(t, ['billing.read'], {
    principalKind: 'account',
    roles: ['finance'],
  });
  const reporting = await stub('reporting');
  t.after(() => reporting.close());
  const app = await start(config(identity.base, { reporting: reporting.base }));
  t.after(() => app.close());
  const headers = { authorization: `Bearer ${token}` };
  assert.equal(
    (await request(app.base, '/api/v1/admin/operations/freshness', { headers })).status,
    200,
  );
  assert.equal(
    (await request(app.base, '/api/v1/admin/operations/resources', { headers })).status,
    403,
  );
  assert.equal(reporting.calls.length, 1);
});
test('P01 profile revision forwarding is validated and owner scoped', async (t) => {
  const { identity, token } = await signedSession(t);
  const owner = await stub('customer');
  t.after(() => owner.close());
  const app = await start(config(identity.base, { customer: owner.base }));
  t.after(() => app.close());
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'idempotency-key': randomUUID(),
    'if-match': '"2"',
  };
  assert.equal(
    (await request(app.base, '/api/v1/customer/profile', { method: 'PATCH', headers, body: '{}' }))
      .status,
    200,
  );
  assert.equal(owner.calls.at(-1).headers['if-match'], '"2"');
  assert.equal(
    (
      await request(app.base, '/api/v1/customer/profile', {
        method: 'PATCH',
        headers: { ...headers, 'if-match': '"2147483647"' },
        body: '{}',
      })
    ).status,
    200,
  );
  assert.equal(owner.calls.at(-1).headers['if-match'], '"2147483647"');
  assert.equal(
    (
      await request(app.base, '/api/v1/customer/profile', {
        method: 'PATCH',
        headers: { ...headers, 'if-match': '"2147483648"' },
        body: '{}',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app.base, '/api/v1/customer/profile', {
        method: 'PATCH',
        headers: { ...headers, 'if-match': '*' },
        body: '{}',
      })
    ).status,
    400,
  );
  assert.equal(owner.calls.length, 2);
});
test('F007 refuses startup with missing owner or unsafe remote origin', async () => {
  await assert.rejects(gateway.createGatewayApplication(config('http://identity.internal')));
  await assert.rejects(
    gateway.createGatewayApplication(config('https://user:secret@identity.invalid')),
  );
  await assert.rejects(
    gateway.createGatewayApplication(
      config('http://127.0.0.1:3000', { rogue: 'http://127.0.0.1:3001' }),
    ),
  );
});
test('F007 real Nest 12 boots, returns honest health, and rejects unauthenticated/spoof-only calls', async (t) => {
  const app = await start(config('http://127.0.0.1:9'));
  t.after(() => app.close());
  assert.equal((await request(app.base, '/health/live')).body.businessReady, false);
  assert.equal((await request(app.base, '/health/ready')).status, 503);
  const result = await request(app.base, '/api/v1/customer/profile', {
    headers: { 'x-user-id': randomUUID(), 'x-auth-subject': randomUUID() },
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'AUTH_REQUIRED');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await request(app.base, '/bad/path')).body.error.code, 'NOT_FOUND');
});
test('P01 shared strict browser client preserves the real Gateway anonymous authentication error', async (t) => {
  const clientRequire = createRequire(path.join(ROOT, 'packages/api-clients/package.json'));
  const { HttpClient } = clientRequire('./dist/index.js');
  const app = await start(config('http://127.0.0.1:9'));
  t.after(() => app.close());
  const client = new HttpClient({ baseUrl: app.base + '/api/v1', fetch });
  const response = await client.request({
    method: 'GET',
    path: '/customer/profile',
    parse: (value) => value,
  });
  assert.equal(response.ok, false);
  assert.equal(response.status, 401);
  assert.equal(response.error.code, 'AUTH_REQUIRED');
  assert.equal(response.error.retryable, false);
  assert.equal(response.error.reason, null);
  assert.equal(response.error.retryAfterMs, null);
  assert.deepEqual(response.error.issues, []);
});
test('F007 public verifier rejects tampered tokens before calling live Identity session', async (t) => {
  const { identity, token } = await signedSession(t);
  const app = await start(config(identity.base));
  t.after(() => app.close());
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
  payload.sub = randomUUID();
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const response = await request(app.base, '/api/v1/customer/profile', {
    headers: { authorization: `Bearer ${parts.join('.')}` },
  });
  assert.equal(response.status, 401);
  assert.equal(identity.calls.filter((x) => x.path.endsWith('/session')).length, 0);
});

test('Gateway retains only the owner-published missing-resource and canonical failure reasons', async (t) => {
  const { identity, token } = await signedSession(t);
  let status = 404;
  let code = 'NOT_FOUND';
  let reason = 'PROFILE_NOT_FOUND';
  const owner = await stub('customer', (_call, response) => {
    response.statusCode = status;
    response.end(JSON.stringify({ error: { code, reason } }));
  });
  t.after(() => owner.close());
  const app = await start(config(identity.base, { customer: owner.base }));
  t.after(() => app.close());
  const read = () =>
    request(app.base, '/api/v1/customer/profile', {
      headers: { authorization: `Bearer ${token}` },
    });
  const missing = await read();
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.reason, 'PROFILE_NOT_FOUND');
  for (const [nextStatus, nextCode] of [
    [401, 'AUTH_REQUIRED'],
    [503, 'DEPENDENCY_UNAVAILABLE'],
  ]) {
    status = nextStatus;
    code = nextCode;
    const canonical = await read();
    assert.equal(canonical.status, nextStatus);
    assert.equal(canonical.body.error.reason, 'PROFILE_NOT_FOUND');
  }
  status = 404;
  code = 'NOT_FOUND';
  for (const unpublished of ['INTERNAL_PRIVATE', 'BOOKING_NOT_FOUND', 'arbitrary text']) {
    reason = unpublished;
    assert.equal((await read()).body.error.reason, null);
  }
});

test('Gateway forwards strong published revisions and exact replay flags without leaking arbitrary upstream headers', async (t) => {
  const { identity, token } = await signedSession(t);
  let etag = '"2147483647"';
  let replay = 'true';
  const owner = await stub('customer', (_call, response) => {
    response.setHeader('etag', etag);
    response.setHeader('idempotent-replayed', replay);
    response.setHeader('x-private-debug', 'must-not-leave-owner');
    response.setHeader('set-cookie', 'private=do-not-forward');
    response.end(JSON.stringify({ revision: 2147483647 }));
  });
  t.after(() => owner.close());
  const app = await start(config(identity.base, { customer: owner.base }));
  t.after(() => app.close());
  const read = () =>
    request(app.base, '/api/v1/customer/profile', {
      headers: { authorization: `Bearer ${token}` },
    });
  const valid = await read();
  assert.equal(valid.headers.get('etag'), '"2147483647"');
  assert.equal(valid.headers.get('idempotent-replayed'), 'true');
  assert.equal(valid.headers.get('x-private-debug'), null);
  assert.equal(valid.headers.get('set-cookie'), null);
  replay = 'not-true';
  for (const invalid of ['W/"123"', '"2147483648"', '"00"', '"content-hash"', '*']) {
    etag = invalid;
    const refused = await read();
    assert.equal(refused.status, 200);
    assert.equal(
      refused.headers.get('etag'),
      null,
      'the Gateway never invents a content-hash revision',
    );
    assert.equal(refused.headers.get('idempotent-replayed'), null);
  }
});
test('F007 verified context replaces every spoofed identity header; cookies never cross into domain owners', async (t) => {
  const { identity, token, session } = await signedSession(t);
  const owner = await stub('customer');
  t.after(() => owner.close());
  const app = await start(config(identity.base, { customer: owner.base }));
  t.after(() => app.close());
  const correlation = randomUUID();
  const trace = '00-1234567890abcdef1234567890abcdef-abcdefabcdefabcd-01';
  const result = await request(app.base, '/api/v1/customer/profile', {
    headers: {
      authorization: `Bearer ${token}`,
      cookie: '__Host-wg_refresh=private-refresh; x=secret',
      'x-user-id': 'forged',
      'x-auth-subject': 'forged',
      'x-auth-session': 'forged',
      'x-auth-version': '999',
      'x-service-name': 'admin',
      'x-forwarded-for': '1.2.3.4',
      'x-request-id': 'forged',
      'x-correlation-id': correlation,
      traceparent: trace,
    },
  });
  assert.equal(result.status, 200);
  const forwarded = owner.calls[0].headers;
  assert.equal(forwarded['x-auth-subject'], session.subject);
  assert.equal(forwarded['x-auth-session'], session.sessionId);
  assert.equal(forwarded['x-auth-version'], '1');
  for (const name of ['cookie', 'x-user-id', 'x-service-name', 'x-forwarded-for'])
    assert.equal(forwarded[name], undefined);
  assert.equal(forwarded.authorization, `Bearer ${token}`);
  assert.equal(forwarded['x-correlation-id'], correlation);
  assert.equal(forwarded['x-request-id'], result.headers.get('x-request-id'));
  assert.notEqual(forwarded['x-request-id'], 'forged');
  assert.equal(forwarded.traceparent.split('-')[1], trace.split('-')[1]);
  assert.notEqual(forwarded.traceparent, trace);
});
test('F007 live permissions, not caller isAdmin headers, control namespaces', async (t) => {
  const { identity, token } = await signedSession(t);
  const owner = await stub('billing');
  t.after(() => owner.close());
  const app = await start(config(identity.base, { billing: owner.base }));
  t.after(() => app.close());
  const result = await request(app.base, '/api/v1/admin/billing', {
    headers: {
      authorization: `Bearer ${token}`,
      'x-is-admin': 'true',
      'x-permissions': 'billing.read',
    },
  });
  assert.equal(result.status, 403);
  assert.equal(owner.calls.length, 0);
});
test('F007 sanitized validation errors never echo SQL, password, stack or internal exception', async (t) => {
  const { identity, token } = await signedSession(t);
  const owner = await stub('customer', (_call, res) => {
    res.statusCode = 422;
    res.end(JSON.stringify({ error: { message: 'password=SECRET SQL SELECT stack' } }));
  });
  t.after(() => owner.close());
  const app = await start(config(identity.base, { customer: owner.base }));
  t.after(() => app.close());
  const result = await request(app.base, '/api/v1/customer/profile', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.status, 422);
  assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  assert.equal(result.body.error.retryable, false);
  assert.doesNotMatch(JSON.stringify(result.body), /SECRET|SQL|SELECT|stack/);
});
test('F007 no blind retry, redirect following or unbounded response body, including after headers', async (t) => {
  const owner = await stub('booking', (_call, res) => {
    res.statusCode = 503;
    res.end('{"error":"private"}');
  });
  t.after(() => owner.close());
  const http = new gateway.BoundedHttpClient(
    config(owner.base, { booking: owner.base }, { timeoutMs: 100, responseLimit: 1024 }),
  );
  assert.equal(
    (
      await http.request(
        'booking',
        '/internal/v1/booking',
        'POST',
        { 'content-type': 'application/json' },
        { a: 1 },
      )
    ).status,
    503,
  );
  assert.equal(owner.calls.length, 1);
  owner.state.handler = (_call, res) => {
    res.statusCode = 302;
    res.setHeader('location', 'http://127.0.0.1:9/private');
    res.end('{}');
  };
  await assert.rejects(
    http.request('booking', '/', 'GET', {}),
    (e) => e.code === 'UPSTREAM_UNAVAILABLE',
  );
  owner.state.handler = (_call, res) => res.end(JSON.stringify({ huge: 'x'.repeat(4096) }));
  await assert.rejects(
    http.request('booking', '/', 'GET', {}),
    (e) => e.code === 'UPSTREAM_INVALID',
  );
  owner.state.handler = (_call, res) => {
    res.writeHead(200);
    res.write('{');
  };
  await assert.rejects(
    http.request('booking', '/', 'GET', {}),
    (e) => e.code === 'UPSTREAM_TIMEOUT',
  );
});
test('F007 required idempotency key forwards unchanged and unsafe request sent only once', async (t) => {
  const { identity, token } = await signedSession(t);
  const owner = await stub('booking');
  t.after(() => owner.close());
  const app = await start(config(identity.base, { booking: owner.base }));
  t.after(() => app.close());
  const options = {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ quoteId: randomUUID() }),
  };
  const missing = await request(app.base, '/api/v1/customer/bookings', options);
  assert.equal(missing.status, 428);
  assert.equal(missing.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  options.headers['idempotency-key'] = 'short';
  const malformed = await request(app.base, '/api/v1/customer/bookings', options);
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'REQUEST_INVALID');
  assert.equal(owner.calls.length, 0);
  options.headers['idempotency-key'] = 'safe_command_123456789';
  assert.equal((await request(app.base, '/api/v1/customer/bookings', options)).status, 200);
  assert.equal(owner.calls.length, 1);
  assert.equal(owner.calls[0].headers['idempotency-key'], options.headers['idempotency-key']);
});
test('F007 read composition contacts two distinct owners and refuses mutation variants', async (t) => {
  const { identity, token } = await signedSession(t);
  const customer = await stub('customer'),
    catalog = await stub('catalog');
  t.after(() => customer.close());
  t.after(() => catalog.close());
  const app = await start(
    config(identity.base, { customer: customer.base, catalog: catalog.base }),
  );
  t.after(() => app.close());
  const result = await request(app.base, '/api/v1/customer/overview', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body['customer.profile.read'].owner, 'customer');
  assert.equal(result.body['customer.catalog'].owner, 'catalog');
  assert.equal(customer.calls[0].method, 'GET');
  assert.equal(catalog.calls[0].method, 'GET');
  assert.equal(
    (
      await request(app.base, '/api/v1/customer/overview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    404,
  );
});
test('F007 browser cross-origin writes and mismatched cookie/bearer credentials fail closed', async (t) => {
  const { identity, token } = await signedSession(t);
  const app = await start(config(identity.base));
  t.after(() => app.close());
  assert.equal(
    (
      await request(app.base, '/api/v1/customer/profile', {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          origin: 'https://evil.invalid',
        },
        body: '{}',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app.base, '/api/v1/customer/profile', {
        headers: { authorization: `Bearer ${token}`, cookie: '__Host-wg_access=different' },
      })
    ).status,
    401,
  );
});
test('F007 malformed and oversized incoming bodies return a safe error envelope', async (t) => {
  const app = await start(config('http://127.0.0.1:9'));
  t.after(() => app.close());
  for (const body of ['{private_payload_marker', JSON.stringify({ x: 'a'.repeat(70 * 1024) })]) {
    const result = await request(app.base, '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body,
    });
    assert.ok([400, 413].includes(result.status), JSON.stringify(result));
    assert.equal(result.body.error.code, 'REQUEST_INVALID');
    assert.doesNotMatch(JSON.stringify(result.body), /private_payload_marker|aaaaa/);
  }
});
test('F007 OpenAPI exposes contracts but no internal origin/key/DB, and owner metadata matches catalog', async () => {
  const api = gateway.gatewayOpenApi();
  assert.equal(api.openapi, '3.1.0');
  assert.equal(api.paths['/api/v1/customer/profile'].get['x-owning-service'], 'customer');
  assert.equal(api.paths['/api/v1/technician/overview'].get['x-read-only'], true);
  assert.doesNotMatch(JSON.stringify(api), /127\.0\.0\.1|privateKey|DATABASE_URL/);
  const catalog = JSON.parse(
    await readFile(path.join(ROOT, 'architecture/service-catalog.json'), 'utf8'),
  );
  for (const route of GATEWAY_ROUTES) assert.ok(catalog.services.some((s) => s.id === route.owner));
});
test('F007 gateway contains no database/service implementation dependencies or persistence artifacts', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(ROOT, 'apps/api-gateway/package.json'), 'utf8'),
  );
  // F008 adds only a technical package; database and owner dependencies remain forbidden.
  const allowed = [
    '@carwash/observability',
    '@carwash/contracts',
    '@carwash/security-kit',
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/platform-express',
    'reflect-metadata',
    'rxjs',
  ];
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), allowed.sort());
  async function walk(dir) {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(p)));
      else out.push(p);
    }
    return out;
  }
  for (const file of await walk(path.join(ROOT, 'apps/api-gateway/src'))) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(
      text,
      /(?:from|require\()\s*['"](?:@prisma|pg['"]|@carwash\/(?:identity|booking|customer|billing)['"])/,
    );
  }
});

test('F007 discovery marks every BFF composition authenticated with every required permission', () => {
  const api = gateway.gatewayOpenApi();
  for (const composition of GATEWAY_COMPOSITIONS) {
    const operation = api.paths['/api/v1' + composition.path].get;
    const composed = composition.routes.map((id) =>
      GATEWAY_ROUTES.find((route) => route.id === id),
    );
    // Every composed route is either permissioned or explicitly public; none is silently open.
    for (const route of composed) assert.ok(route.permission || route.public, route.id);
    const expected = [
      ...new Set(composed.flatMap((route) => (route.permission ? [route.permission] : []))),
    ].sort();
    assert.deepEqual(operation.security, [{ bearer: [] }, { session: [] }]);
    assert.deepEqual(operation['x-required-permissions'], expected);
    assert.equal(operation['x-read-only'], true);
  }
});

test('Reviews discovery requires a principal without claiming an unrelated role grant', () => {
  const api = gateway.gatewayOpenApi();
  for (const [path, method] of [
    ['/api/v1/customer/reviews', 'post'],
    ['/api/v1/customer/bookings/{id}/review', 'get'],
  ]) {
    const operation = api.paths[path][method];
    assert.deepEqual(operation.security, [{ bearer: [] }, { session: [] }]);
    assert.equal(operation['x-required-permission'], undefined);
    assert.equal(operation['x-any-permission'], undefined);
    assert.equal(operation['x-public'], undefined);
  }
});

test('F007 discovery documents one closed error envelope and correlation headers on every operation', () => {
  const api = gateway.gatewayOpenApi();
  const schema = api.components.schemas?.GatewayErrorEnvelope;
  assert.ok(schema, 'stable error envelope is missing from discovery');
  assert.equal(
    api.components.responses.GatewayError.content['application/json'].schema.$ref,
    '#/components/schemas/GatewayErrorEnvelope',
  );
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['error']);
  assert.deepEqual(schema.properties.error.required, [
    'code',
    'reason',
    'message',
    'requestId',
    'correlationId',
    'retryable',
    'retryAfterMs',
    'issues',
  ]);
  for (const pathItem of Object.values(api.paths)) {
    for (const operation of Object.values(pathItem)) {
      for (const status of [
        '400',
        '401',
        '403',
        '404',
        '409',
        '412',
        '413',
        '422',
        '428',
        '429',
        '500',
        '502',
        '503',
        '504',
      ]) {
        assert.equal(operation.responses[status]?.$ref, '#/components/responses/GatewayError');
      }
      for (const name of ['X-Correlation-Id', 'traceparent']) {
        assert.ok(
          operation.parameters.some(
            (parameter) => parameter.in === 'header' && parameter.name === name,
          ),
        );
      }
    }
  }
});

test('F007 rejects JSON-lookalike upstream media types while allowing JSON with charset', async (t) => {
  const owner = await stub('customer');
  t.after(() => owner.close());
  const http = new gateway.BoundedHttpClient(config(owner.base, { customer: owner.base }));
  for (const mediaType of ['application/jsonp', 'application/json-extra', 'text/html']) {
    owner.state.handler = (_call, res) => {
      res.setHeader('content-type', mediaType);
      res.end('{"private":"not a contracted response"}');
    };
    await assert.rejects(
      http.request('customer', '/', 'GET', {}),
      (error) => error.code === 'UPSTREAM_INVALID',
    );
  }
  owner.state.handler = (_call, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end('{"ok":true}');
  };
  assert.deepEqual((await http.request('customer', '/', 'GET', {})).body, { ok: true });
  assert.equal(owner.calls.length, 4, 'one attempt per request, including rejected responses');
});

test('F007 admin BFF requires the intersection of component permissions before any owner call', async (t) => {
  const { identity, token, session } = await signedSession(t, ['billing.read']);
  const billing = await stub('billing');
  const support = await stub('support');
  t.after(() => billing.close());
  t.after(() => support.close());
  const app = await start(config(identity.base, { billing: billing.base, support: support.base }));
  t.after(() => app.close());
  const options = { headers: { authorization: `Bearer ${token}` } };
  assert.equal((await request(app.base, '/api/v1/admin/overview', options)).status, 403);
  assert.equal(billing.calls.length, 0);
  assert.equal(support.calls.length, 0);
  session.permissions = ['billing.read', 'support.cases.read'];
  const allowed = await request(app.base, '/api/v1/admin/overview', options);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body['admin.billing'].owner, 'billing');
  assert.equal(allowed.body['admin.support'].owner, 'support');
  assert.equal(billing.calls[0].method, 'GET');
  assert.equal(support.calls[0].method, 'GET');
});

test('F007 mismatched live Identity subject, session or version fails before a business owner', async (t) => {
  const { identity, token, session } = await signedSession(t);
  const customer = await stub('customer');
  t.after(() => customer.close());
  const app = await start(config(identity.base, { customer: customer.base }));
  t.after(() => app.close());
  for (const mismatch of [
    { subject: randomUUID() },
    { sessionId: randomUUID() },
    { authVersion: 2 },
  ]) {
    identity.state.handler = (call, res) =>
      res.end(
        JSON.stringify(
          call.path.endsWith('jwks.json') ? { keys: [jwk] } : { ...session, ...mismatch },
        ),
      );
    const response = await request(app.base, '/api/v1/customer/profile', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 502);
    assert.equal(response.body.error.code, 'UPSTREAM_INVALID');
  }
  assert.equal(customer.calls.length, 0);
});

test('F007 a failed BFF component returns a safe failure rather than invented partial business data', async (t) => {
  const { identity, token } = await signedSession(t);
  const customer = await stub('customer');
  const catalog = await stub('catalog', (_call, res) => {
    res.statusCode = 500;
    res.end('{"error":"SQL password=private"}');
  });
  t.after(() => customer.close());
  t.after(() => catalog.close());
  const app = await start(
    config(identity.base, { customer: customer.base, catalog: catalog.base }),
  );
  t.after(() => app.close());
  const result = await request(app.base, '/api/v1/customer/overview', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.status, 502);
  assert.deepEqual(Object.keys(result.body), ['error']);
  assert.equal(result.body.error.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(result.body.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(result.body), /SQL|password|private|testStub/);
});

test('P01-E3 public routes forward no credentials and need no identity', async (t) => {
  const catalog = await stub('catalog');
  t.after(() => catalog.close());
  // Identity origin is unreachable: a public read must not depend on it.
  const app = await start(config('http://127.0.0.1:9', { catalog: catalog.base }));
  t.after(() => app.close());
  const result = await request(app.base, '/api/v1/customer/packages', {
    headers: {
      authorization: 'Bearer leaked.token.value',
      cookie: '__Host-wg_access=abc; __Host-wg_refresh=def',
      'x-auth-subject': randomUUID(),
    },
  });
  assert.equal(result.status, 200);
  assert.equal(catalog.calls.length, 1);
  const forwarded = catalog.calls[0].headers;
  for (const header of [
    'authorization',
    'cookie',
    'x-auth-subject',
    'x-auth-session',
    'x-auth-principal-kind',
  ])
    assert.equal(forwarded[header], undefined, header);
  assert.ok(forwarded['x-correlation-id']);
  for (const route of GATEWAY_ROUTES.filter((r) => r.public)) {
    assert.equal(route.method, 'GET', route.id);
    assert.equal(route.permission, undefined, route.id);
  }
});

test('P01-E3 guest principals reach owners with an explicit principal kind and no roles', async (t) => {
  const { identity, token } = await signedSession(t, undefined, {
    principalKind: 'guest',
    roles: [],
  });
  const customer = await stub('customer');
  t.after(() => customer.close());
  const app = await start(config(identity.base, { customer: customer.base }));
  t.after(() => app.close());
  const result = await request(app.base, '/api/v1/customer/profile', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.status, 200);
  assert.equal(customer.calls[0].headers['x-auth-principal-kind'], 'guest');
  assert.ok(gateway.routeMatch('POST', '/api/v1/auth/guest-sessions').route.authTransport);
  assert.ok(gateway.routeMatch('POST', '/api/v1/auth/guest-sessions/recover').route.authTransport);
});

test('P01-E3 identity session views without a valid principal kind, or guests with roles, fail closed', async (t) => {
  for (const shape of [
    { roles: ['customer'] },
    { principalKind: 'admin', roles: ['customer'] },
    { principalKind: 'guest', roles: ['customer'] },
  ]) {
    const { identity, token } = await signedSession(t, undefined, shape);
    const customer = await stub('customer');
    const app = await start(config(identity.base, { customer: customer.base }));
    const result = await request(app.base, '/api/v1/customer/profile', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(result.status, 502, JSON.stringify(shape));
    assert.equal(result.body.error.code, 'UPSTREAM_INVALID');
    assert.equal(customer.calls.length, 0);
    await app.close();
    await customer.close();
  }
});
