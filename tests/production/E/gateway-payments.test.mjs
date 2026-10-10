/**
 * P04-E2 — Gateway payment routes and provider-notification ingress.
 *
 * Real Nest 12 Gateway (apps/api-gateway/dist) in front of loopback test
 * owners. The owners are explicit test stubs that record the exact bytes and
 * headers they receive; they are not Billing. Billing's own HTTP/PostgreSQL
 * behaviour is proven in Lane B's suites and in the P04-E4 certification.
 *
 * Requires: pnpm build:packages && pnpm --filter @carwash/api-gateway build
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, config, own, request, start, stub } from '../../gateway/_helpers.mjs';

const contracts = own('@carwash/contracts');
const { GATEWAY_ROUTES, OWNER_CONTRACTS, PROVIDER_INGRESS_MAX_BYTES } = contracts;
const security = createRequire(path.join(ROOT, 'packages/security-kit/package.json'));
const { SignJWT } = security('jose');
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...keys.publicKey.export({ format: 'jwk' }),
  kid: 'p04e2-kid-0001',
  alg: 'RS256',
  use: 'sig',
};
const ORIGIN = 'https://customer.washgo.invalid';

async function identityWith(t, permissions, principalKind = 'account') {
  const principal = { subject: randomUUID(), sessionId: randomUUID(), authVersion: 1 };
  const session = {
    ...principal,
    principalKind,
    roles: principalKind === 'guest' ? [] : ['customer'],
    permissions,
  };
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

/** Raw-recording owner: keeps the exact request bytes (stub() parses JSON). */
async function rawOwner(t, handler) {
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const call = {
        path: req.url,
        method: req.method,
        headers: req.headers,
        raw: Buffer.concat(chunks),
      };
      calls.push(call);
      handler(call, res);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  });
  return { calls, base: `http://127.0.0.1:${server.address().port}` };
}

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(body === undefined ? '' : JSON.stringify(body));
};

// ---------------------------------------------------------------- route table

test('payment route table: owner, permissions, idempotency and ingress shape', () => {
  const billing = GATEWAY_ROUTES.filter((r) => r.owner === 'billing');
  for (const route of billing)
    assert.ok(route.upstream.startsWith('/internal/v1/billing/'), route.id);
  const byId = Object.fromEntries(GATEWAY_ROUTES.map((r) => [r.id, r]));
  assert.equal(byId['admin.billing.reconcile'].permission, 'billing.reconcile');
  assert.equal(byId['admin.billing.refund.outcome'].permission, 'billing.reconcile');
  assert.equal(byId['admin.billing.refunds.request'].permission, 'billing.refund');
  for (const id of [
    'customer.payments.create',
    'customer.payments.method',
    'customer.payments.reference',
  ])
    assert.equal(byId[id].permission, 'bookings.create:self');
  for (const id of [
    'customer.payments.read',
    'customer.payments.status',
    'customer.payments.refunds',
  ])
    assert.equal(byId[id].permission, 'bookings.read:self');
  // The retired refund alias pointed at an upstream that never existed.
  assert.equal(byId['admin.refund'], undefined);
  const ingress = GATEWAY_ROUTES.filter((r) => r.providerIngress);
  assert.deepEqual(ingress.map((r) => r.path).sort(), [
    '/payments/provider-notifications/sham-cash',
    '/payments/provider-notifications/syriatel-cash',
  ]);
  for (const route of ingress) {
    assert.equal(route.method, 'POST');
    assert.equal(route.owner, 'billing');
    for (const flag of ['permission', 'public', 'authTransport', 'idempotency'])
      assert.equal(route[flag], undefined, `${route.id}.${flag}`);
  }
});

// ---------------------------------------------------------------- customer and finance

test('customer payment step forwards a verified identity and the Idempotency-Key only', async (t) => {
  const { identity, token, session } = await identityWith(
    t,
    ['bookings.read:self', 'bookings.create:self'],
    'guest',
  );
  const billing = await stub('billing', (call, res) => json(res, 202, { accepted: true }));
  t.after(() => billing.close());
  const app = await start(config(identity.base, { billing: billing.base }));
  t.after(() => app.close());
  const obligation = randomUUID();
  const send = (headers) =>
    request(app.base, `/api/v1/customer/payments/${obligation}/transaction-reference`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: ORIGIN,
        'x-auth-subject': randomUUID(),
        ...headers,
      },
      body: JSON.stringify({ expectedRevision: 2, providerReference: 'TX-12345678' }),
    });
  const missing = await send({});
  assert.equal(missing.status, 400);
  assert.equal(billing.calls.length, 0, 'no key, no upstream call');
  const ok = await send({ 'idempotency-key': 'payment_attempt_000001' });
  assert.equal(ok.status, 202);
  const call = billing.calls[0];
  assert.equal(call.path, `/internal/v1/billing/obligations/${obligation}/payment-attempts`);
  assert.equal(call.headers['idempotency-key'], 'payment_attempt_000001');
  assert.equal(call.headers['x-auth-subject'], session.subject, 'spoofed subject replaced');
  assert.equal(call.headers['x-auth-principal-kind'], 'guest');
  assert.equal(call.headers.cookie, undefined);
});

test('finance separation: only billing.reconcile reaches reconciliation; read or customer never does', async (t) => {
  const billing = await stub('billing', (call, res) => json(res, 200, { ok: true }));
  t.after(() => billing.close());
  const attempt = randomUUID();
  const reconcile = async (permissions) => {
    const { identity, token } = await identityWith(t, permissions);
    const app = await start(config(identity.base, { billing: billing.base }));
    t.after(() => app.close());
    return request(app.base, `/api/v1/admin/billing/payment-attempts/${attempt}/reconciliation`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: ORIGIN,
        'idempotency-key': `reconcile_${randomUUID()}`,
      },
      body: JSON.stringify({ expectedRevision: 3, outcome: 'UNKNOWN', observedAmount: null }),
    });
  };
  assert.equal((await reconcile(['bookings.read:self', 'bookings.create:self'])).status, 403);
  assert.equal((await reconcile(['billing.read'])).status, 403);
  assert.equal((await reconcile(['billing.read', 'billing.refund'])).status, 403);
  assert.equal(billing.calls.length, 0, 'denied before any owner call');
  assert.equal((await reconcile(['billing.reconcile'])).status, 200);
  assert.equal(billing.calls.length, 1);
});

test('owner reasons: only the merged contract reasons reach the client; 412 stays a conflict; timeout is never success', async (t) => {
  const { identity, token } = await identityWith(t, ['bookings.read:self', 'bookings.create:self']);
  let reply = { status: 409, code: 'PAYMENT_IN_REVIEW' };
  const billing = await stub('billing', (call, res) => {
    if (reply.hang) return; // never answers
    json(res, reply.status, {
      error: { code: reply.code, message: 'x', correlationId: randomUUID(), status: reply.status },
    });
  });
  t.after(() => billing.close());
  const app = await start(config(identity.base, { billing: billing.base }, { timeoutMs: 300 }));
  t.after(() => app.close());
  const choose = () =>
    request(app.base, `/api/v1/customer/payments/${randomUUID()}/method`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: ORIGIN,
        'idempotency-key': `method_${randomUUID()}`,
      },
      body: JSON.stringify({ expectedRevision: 1, method: 'SHAM_CASH' }),
    });
  const published = OWNER_CONTRACTS.find((c) => c.owner === 'billing')?.reasons ?? [];
  const conflict = await choose();
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'CONFLICT');
  // Forwarded only once billing.v1 (P04-E1) is merged; never invented before that.
  assert.equal(
    conflict.body.error.reason,
    published.includes('PAYMENT_IN_REVIEW') ? 'PAYMENT_IN_REVIEW' : undefined,
  );
  reply = { status: 409, code: 'SQLSTATE_23505_DUPLICATE' };
  assert.equal((await choose()).body.error.reason, undefined, 'unpublished codes never leak');
  reply = { status: 412, code: 'REVISION_CONFLICT' };
  const stale = await choose();
  assert.equal(stale.status, 412);
  assert.equal(stale.body.error.code, 'CONFLICT');
  reply = { hang: true };
  const timedOut = await choose();
  assert.equal(timedOut.status, 504);
  assert.equal(timedOut.body.error.code, 'UPSTREAM_TIMEOUT');
});

test('reason forwarding uses the owner registry for an already-merged owner (customer.v1)', async (t) => {
  const { identity, token } = await identityWith(t, ['profile.read:self', 'profile.write:self']);
  const reasons = OWNER_CONTRACTS.find((c) => c.owner === 'customer').reasons;
  const code = reasons[0];
  const customer = await stub('customer', (call, res) =>
    json(res, 409, { error: { code, message: 'x', correlationId: randomUUID(), status: 409 } }),
  );
  t.after(() => customer.close());
  const app = await start(config(identity.base, { customer: customer.base }));
  t.after(() => app.close());
  const result = await request(app.base, '/api/v1/customer/profile', {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin: ORIGIN,
      'idempotency-key': `profile_${randomUUID()}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.error.reason, code);
});

// ---------------------------------------------------------------- provider ingress

const SECRET = randomBytes(32);
const sign = (timestamp, id, raw) =>
  createHmac('sha256', SECRET).update(`${timestamp}.${id}.`).update(raw).digest('hex');

/** Owner stub that verifies washgo-hmac-v1 over the bytes it RECEIVED. */
async function verifyingBilling(t) {
  return rawOwner(t, (call, res) => {
    const ts = call.headers['x-provider-timestamp'];
    const id = call.headers['x-provider-notification-id'];
    const expected = `v1=${sign(ts, id, call.raw)}`;
    if (call.headers['x-provider-signature'] !== expected)
      return json(res, 401, {
        error: {
          code: 'NOTIFICATION_SIGNATURE_INVALID',
          message: 'x',
          correlationId: randomUUID(),
          status: 401,
        },
      });
    res.statusCode = 204;
    res.end();
  });
}

test('provider ingress: exact bytes reach the owner, so a valid signature still verifies', async (t) => {
  const identity = await stub('identity');
  t.after(() => identity.close());
  const billing = await verifyingBilling(t);
  const app = await start(config(identity.base, { billing: billing.base }));
  t.after(() => app.close());
  // Deliberately non-canonical JSON: re-serialising would break the signature.
  const raw = Buffer.from('{ "reference":"TX-1",\n  "amountMinor" : "150000" ,"x":1.50 }');
  const ts = String(Math.floor(Date.now() / 1000));
  const id = `ntf_${randomUUID()}`;
  const send = (body, signature, extra = {}) =>
    request(app.base, '/api/v1/payments/provider-notifications/sham-cash', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-provider-timestamp': ts,
        'x-provider-notification-id': id,
        'x-provider-signature': `v1=${signature}`,
        ...extra,
      },
      body,
    });
  const ok = await send(raw, sign(ts, id, raw), {
    cookie: '__Host-wg_access=browser-session; __Host-wg_refresh=r',
    authorization: 'Bearer stolen',
    'x-auth-subject': randomUUID(),
    'x-forwarded-for': '203.0.113.9',
    origin: 'https://attacker.invalid',
    'x-correlation-id': '0b1a6d8e-6e0e-4d2c-9b5f-3c2c1f0a7e11',
  });
  assert.equal(ok.status, 204);
  const call = billing.calls[0];
  assert.equal(call.path, '/internal/v1/billing/provider-notifications/sham-cash');
  assert.ok(call.raw.equals(raw), 'byte-identical body');
  for (const header of [
    'cookie',
    'authorization',
    'x-auth-subject',
    'x-forwarded-for',
    'origin',
    'idempotency-key',
  ])
    assert.equal(call.headers[header], undefined, `${header} must not reach the owner`);
  assert.equal(call.headers['x-correlation-id'], '0b1a6d8e-6e0e-4d2c-9b5f-3c2c1f0a7e11');
  assert.match(call.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  // Tampered body under the original signature: the owner refuses, the Gateway says 401.
  const tampered = Buffer.from(raw.toString().replace('150000', '1500000'));
  const refused = await send(tampered, sign(ts, id, raw));
  assert.equal(refused.status, 401);
  assert.equal(refused.body.error.code, 'AUTH_REQUIRED');
});

test('provider ingress: form bodies pass byte-for-byte; other types, empty and oversized bodies never reach the owner', async (t) => {
  const identity = await stub('identity');
  t.after(() => identity.close());
  const billing = await verifyingBilling(t);
  const app = await start(config(identity.base, { billing: billing.base }));
  t.after(() => app.close());
  const url = '/api/v1/payments/provider-notifications/syriatel-cash';
  const ts = String(Math.floor(Date.now() / 1000));
  const id = `ntf_${randomUUID()}`;
  const form = Buffer.from('ref=TX-9&amount=150000&sig_note=a%20b');
  const formOk = await request(app.base, url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-provider-timestamp': ts,
      'x-provider-notification-id': id,
      'x-provider-signature': `v1=${sign(ts, id, form)}`,
    },
    body: form,
  });
  assert.equal(formOk.status, 204);
  assert.ok(billing.calls[0].raw.equals(form));
  const before = billing.calls.length;
  const post = (body, type) =>
    request(app.base, url, { method: 'POST', headers: { 'content-type': type }, body });
  assert.equal((await post('<xml/>', 'text/xml')).status, 400);
  assert.equal((await post('', 'application/json')).status, 400);
  const big = JSON.stringify({ pad: 'x'.repeat(PROVIDER_INGRESS_MAX_BYTES) });
  assert.equal((await post(big, 'application/json')).status, 413);
  assert.equal((await request(app.base, url)).status, 404, 'GET is not routed');
  assert.equal(
    (
      await request(app.base, '/api/v1/payments/provider-notifications/other-wallet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    404,
  );
  assert.equal(billing.calls.length, before, 'refused requests never reach Billing');
});
