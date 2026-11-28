import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, register, login, ApiClient, IDENTITY_V1 } from '../identity/_fixture.mjs';
import { own, stub, config, start, request, ORIGIN } from './_helpers.mjs';
const { SESSION_BINDING_HEADER, formatSessionBinding } = own('@carwash/contracts');
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
test('F007 real Identity refresh preserves session binding; replacement cookies reject stale commands before owner forwarding', async (t) => {
  const f = await scenario(t);
  const cookieHeader = (client) => [...client.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const send = (client, expected) =>
    request(f.app.base, '/api/v1/customer/profile', {
      method: 'PATCH',
      headers: {
        cookie: cookieHeader(client),
        origin: ORIGIN,
        'content-type': 'application/json',
        'x-csrf-token': client.cookie('__Host-wg_csrf'),
        'idempotency-key': randomUUID(),
        [SESSION_BINDING_HEADER]: expected,
      },
      body: '{}',
    });
  const first = f.registered;
  const expected = formatSessionBinding(first.session);
  assert.equal((await send(first.client, expected)).status, 200);
  const previousRefresh = first.client.cookie('__Host-wg_refresh');
  const refreshed = await request(f.app.base, '/api/v1/auth/refresh', {
    method: 'POST',
    headers: {
      cookie: cookieHeader(first.client),
      origin: ORIGIN,
      'content-type': 'application/json',
      'x-csrf-token': first.client.cookie('__Host-wg_csrf'),
    },
    body: '{}',
  });
  assert.equal(refreshed.status, 200);
  assert.equal(formatSessionBinding(refreshed.body), expected);
  for (const cookie of refreshed.headers.getSetCookie()) {
    const field = cookie.split(';')[0];
    const index = field.indexOf('=');
    first.client.jar.set(field.slice(0, index), field.slice(index + 1));
  }
  assert.notEqual(first.client.cookie('__Host-wg_refresh'), previousRefresh);
  assert.equal((await send(first.client, expected)).status, 200);
  assert.equal(f.customer.calls.length, 2);

  // Both replacements are genuine OTP-verified sessions. The stale page keeps
  // its original binding while another tab replaces the HttpOnly cookie jar.
  const relogin = await login(f.identity, first.email);
  assert.equal(relogin.session.subject, first.session.subject);
  assert.notEqual(relogin.session.sessionId, first.session.sessionId);
  const sameAccount = await send(relogin.client, expected);
  assert.equal(sameAccount.status, 401);
  assert.equal(sameAccount.body.error.code, 'AUTH_REQUIRED');
  assert.equal(f.customer.calls.length, 2);
  assert.equal((await send(relogin.client, formatSessionBinding(relogin.session))).status, 200);

  const second = await register(f.identity);
  assert.notEqual(second.session.subject, first.session.subject);
  const changedAccount = await send(second.client, expected);
  assert.equal(changedAccount.status, 401);
  assert.equal(changedAccount.body.error.code, 'AUTH_REQUIRED');
  assert.equal(f.customer.calls.length, 3);
  const replacementBinding = formatSessionBinding(second.session);
  assert.equal((await send(second.client, replacementBinding)).status, 200);
  assert.equal(f.customer.calls.length, 4);
  assert.equal(f.customer.calls.at(-1).headers['x-auth-subject'], second.session.subject);
  for (const call of f.customer.calls) {
    assert.equal(call.headers[SESSION_BINDING_HEADER], undefined);
    assert.equal(call.headers.cookie, undefined);
    assert.equal(call.headers['x-csrf-token'], undefined);
  }
  const headerAlone = await request(f.app.base, '/api/v1/customer/profile', {
    headers: { [SESSION_BINDING_HEADER]: replacementBinding },
  });
  assert.equal(headerAlone.status, 401, 'an assertion cannot authenticate a caller');
  assert.equal(f.customer.calls.length, 4);
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
