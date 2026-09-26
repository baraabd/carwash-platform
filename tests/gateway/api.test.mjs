import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, register, login, ApiClient, IDENTITY_V1 } from '../identity/_fixture.mjs';
import { stub, config, start, request, ORIGIN } from './_helpers.mjs';
/** Real Identity + Postgres + Redis. Domain response servers are explicit contract stubs. */
async function scenario(t) {
  const identity = await fixture();
  t.after(() => identity.close());
  const customer = await stub('customer'),
    catalog = await stub('catalog'),
    booking = await stub('booking'),
    billing = await stub('billing'),
    workforce = await stub('workforce');
  for (const owner of [customer, catalog, booking, billing, workforce])
    t.after(() => owner.close());
  const app = await start(
    config(
      identity.base,
      {
        customer: customer.base,
        catalog: catalog.base,
        booking: booking.base,
        billing: billing.base,
        workforce: workforce.base,
      },
      { timeoutMs: 2500 },
    ),
  );
  t.after(() => app.close());
  const registered = await register(identity);
  const token = registered.client.cookie('__Host-wg_access');
  const cookie = [...registered.client.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    identity,
    customer,
    catalog,
    booking,
    billing,
    workforce,
    app,
    registered,
    token,
    cookie,
  };
}
test('F007 real Identity/JWKS and two owner contracts drive authenticated BFF reads', async (t) => {
  const f = await scenario(t);
  const response = await request(f.app.base, '/api/v1/customer/overview', {
    headers: {
      authorization: `Bearer ${f.token}`,
      'x-user-id': randomUUID(),
      'x-is-admin': 'true',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body['customer.profile.read'].owner, 'customer');
  assert.equal(response.body['customer.catalog'].owner, 'catalog');
  assert.equal(f.customer.calls[0].headers['x-auth-subject'], f.registered.session.subject);
  assert.equal(f.customer.calls[0].headers['x-user-id'], undefined);
  assert.equal(f.catalog.calls[0].headers.cookie, undefined);
});
test('F007 real Identity-owned signed CSRF authorizes cookie writes; missing, forged and cross-site tokens fail', async (t) => {
  const f = await scenario(t);
  const headers = {
    cookie: f.cookie,
    origin: ORIGIN,
    'content-type': 'application/json',
    'idempotency-key': 'gateway-command-123456789',
  };
  const send = () =>
    request(f.app.base, '/api/v1/customer/profile', { method: 'PATCH', headers, body: '{}' });
  assert.equal((await send()).status, 403);
  assert.equal(f.customer.calls.length, 0);
  headers['x-csrf-token'] = 'forged';
  assert.equal((await send()).status, 403);
  headers['x-csrf-token'] = f.registered.client.cookie('__Host-wg_csrf');
  assert.equal((await send()).status, 200);
  assert.equal(f.customer.calls[0].headers.cookie, undefined);
  assert.equal(f.customer.calls[0].headers['x-csrf-token'], undefined);
  headers.origin = 'https://evil.invalid';
  assert.equal((await send()).status, 403);
});
test('F007 suspended real account and revoked session cannot reach owner despite a valid signed JWT', async (t) => {
  const f = await scenario(t);
  const call = () =>
    request(f.app.base, '/api/v1/customer/profile', {
      headers: { authorization: `Bearer ${f.token}` },
    });
  assert.equal((await call()).status, 200);
  await f.identity.db.identityAccount.update({
    where: { id: f.registered.session.subject },
    data: { status: 'SUSPENDED' },
  });
  assert.equal((await call()).status, 401);
  assert.equal(f.customer.calls.length, 1);
  await f.identity.db.identityAccount.update({
    where: { id: f.registered.session.subject },
    data: { status: 'ACTIVE' },
  });
  await f.identity.db.identitySession.update({
    where: { id: f.registered.session.sessionId },
    data: { revokedAt: new Date() },
  });
  assert.equal((await call()).status, 401);
  assert.equal(f.customer.calls.length, 1);
});
test('F007 customer denied admin/technician; real finance and technician grants allow only their routes', async (t) => {
  const f = await scenario(t);
  const read = (path, token = f.token) =>
    request(f.app.base, path, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await read('/api/v1/admin/billing')).status, 403);
  assert.equal((await read('/api/v1/technician/work')).status, 403);
  await f.identity.db.identityAccount.update({
    where: { id: f.registered.session.subject },
    data: { roles: ['finance'] },
  });
  const finance = await login(f.identity, f.registered.email);
  const ft = finance.client.cookie('__Host-wg_access');
  assert.equal((await read('/api/v1/admin/billing', ft)).status, 200);
  assert.equal((await read('/api/v1/technician/work', ft)).status, 403);
  await f.identity.db.identityAccount.update({
    where: { id: f.registered.session.subject },
    data: { roles: ['technician'] },
  });
  const technician = await login(f.identity, f.registered.email);
  const tt = technician.client.cookie('__Host-wg_access');
  assert.equal((await read('/api/v1/technician/work', tt)).status, 200);
  assert.equal((await read('/api/v1/admin/billing', tt)).status, 403);
});
test('F007 auth cookie transport preserves hardened attributes and does not expose internal auth paths', async (t) => {
  const f = await scenario(t);
  const result = await request(f.app.base, '/api/v1/auth/csrf');
  assert.equal(result.status, 200);
  const cookies = result.headers.getSetCookie();
  assert.ok(cookies.length > 0);
  for (const cookie of cookies) {
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
  }
  assert.equal(
    (
      await request(f.app.base, IDENTITY_V1 + '/session', {
        headers: { authorization: `Bearer ${f.token}` },
      })
    ).status,
    404,
  );
  const jar = new ApiClient(f.identity.base).jar;
  assert.equal(jar.size, 0);
  const noCsrf = await request(f.app.base, '/api/v1/auth/logout', {
    method: 'POST',
    headers: { cookie: f.cookie, origin: ORIGIN, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(noCsrf.status, 403);
});
