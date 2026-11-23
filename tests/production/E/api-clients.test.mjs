// Executes the BUILT @carwash/api-clients ESM package against a real local HTTP
// server (node:http) using Node's real fetch. No mocked transport.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createRequire } from 'node:module';
import { randomFillSync } from 'node:crypto';

const require = createRequire(import.meta.url);
const contracts = require('../../../packages/contracts/dist/index.js');
const clients = await import('../../../packages/api-clients/dist/index.js');

// Idempotency keys are not secrets; this one is deliberately low-entropy and descriptive.
const IDEMPOTENCY = 'test-idempotency-key-0001';
const profile = {
  customerId: '11111111-1111-4111-8111-111111111111',
  principal: { kind: 'guest', subjectId: '22222222-2222-4222-8222-222222222222' },
  revision: 3,
  status: 'ACTIVE',
  contact: { displayName: 'سامر', phone: '+963912345678', phoneVerification: 'unverified' },
  preferences: { locale: 'ar' },
  createdAt: '2026-10-07T08:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
};

async function server(t, handler) {
  const seen = [];
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        s.closeAllConnections();
        s.close(resolve);
      }),
  );
  const { port } = s.address();
  return { seen, baseUrl: `http://127.0.0.1:${port}` };
}

const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
};

test('typed GET validates the owner response and reads the ETag revision', async (t) => {
  const { seen, baseUrl } = await server(t, (_req, res) =>
    json(res, 200, profile, { etag: '"3"' }),
  );
  const client = new clients.HttpClient({ baseUrl, fetch });
  const result = await clients.callRoute(client, contracts.customerV1.CUSTOMER_V1, 'getProfile', {
    parse: (v) => contracts.customerV1.parseCustomerProfileV1(v),
    correlationId: 'corr-123',
  });
  assert.equal(result.ok, true);
  assert.equal(result.revision, 3);
  assert.deepEqual(result.value, profile);
  assert.equal(seen[0].url, '/internal/v1/customer/me');
  assert.equal(seen[0].headers['x-correlation-id'], 'corr-123');
});

test('revisioned mutation sends Idempotency-Key and If-Match; refuses to send without them', async (t) => {
  const { seen, baseUrl } = await server(t, (_req, res) =>
    json(res, 200, { ...profile, revision: 4 }),
  );
  const client = new clients.HttpClient({ baseUrl, fetch });
  const call = (extra) =>
    clients.callRoute(client, contracts.customerV1.CUSTOMER_V1, 'updateProfile', {
      body: { displayName: null, phone: null, locale: 'ar' },
      parse: (v) => contracts.customerV1.parseCustomerProfileV1(v),
      ...extra,
    });
  assert.throws(() => call({ idempotencyKey: IDEMPOTENCY }), /REVISION_REQUIRED/);
  assert.throws(() => call({ expectedRevision: 3 }), /IDEMPOTENCY_KEY_REQUIRED/);
  const ok = await call({ idempotencyKey: IDEMPOTENCY, expectedRevision: 3 });
  assert.equal(ok.ok, true);
  assert.equal(seen.length, 1, 'refused calls never reached the server');
  assert.equal(seen[0].method, 'PATCH');
  assert.equal(seen[0].headers['idempotency-key'], IDEMPOTENCY);
  assert.equal(seen[0].headers['if-match'], '"3"');
  assert.equal(seen[0].headers['content-type'], 'application/json');
});

test('owner error envelopes are parsed, not collapsed', async (t) => {
  const envelope = contracts.apiError(
    'REVISION_CONFLICT',
    'stale',
    { requestId: 'r1', correlationId: 'c1' },
    { reason: 'ADDRESS_ARCHIVED' },
  );
  const { baseUrl } = await server(t, (_req, res) => json(res, 412, envelope));
  const client = new clients.HttpClient({ baseUrl, fetch });
  const result = await client.request({ method: 'GET', path: '/x', parse: (v) => v });
  assert.equal(result.ok, false);
  assert.equal(result.status, 412);
  assert.deepEqual(result.error, envelope.error);
});

test('a lost mutation response is OUTCOME_UNKNOWN, a lost read is UPSTREAM_TIMEOUT', async (t) => {
  const { seen, baseUrl } = await server(t, () => {
    /* never respond */
  });
  const client = new clients.HttpClient({ baseUrl, fetch, timeoutMs: 150 });
  const write = await client.request({
    method: 'POST',
    path: '/w',
    body: {},
    idempotencyKey: IDEMPOTENCY,
    parse: (v) => v,
  });
  assert.equal(write.ok, false);
  assert.equal(write.error.code, 'OUTCOME_UNKNOWN');
  assert.equal(write.error.retryable, false);
  const read = await client.request({ method: 'GET', path: '/r', parse: (v) => v });
  assert.equal(read.error.code, 'UPSTREAM_TIMEOUT');
  // The server DID receive the mutation: exactly why the client must not claim failure.
  assert.equal(seen.length, 2);
});

test('a 2xx that violates the contract is never success', async (t) => {
  const { baseUrl } = await server(t, (req, res) => json(res, 200, { ...profile, extra: 1 }));
  const client = new clients.HttpClient({ baseUrl, fetch });
  const read = await client.request({
    method: 'GET',
    path: '/r',
    parse: (v) => contracts.customerV1.parseCustomerProfileV1(v),
  });
  assert.equal(read.error.code, 'UPSTREAM_INVALID');
  const write = await client.request({
    method: 'POST',
    path: '/w',
    body: {},
    idempotencyKey: IDEMPOTENCY,
    parse: (v) => contracts.customerV1.parseCustomerProfileV1(v),
  });
  assert.equal(write.error.code, 'OUTCOME_UNKNOWN');
});

test('a non-envelope error body is UPSTREAM_INVALID; mutation without key never leaves', async (t) => {
  const { seen, baseUrl } = await server(t, (_req, res) => {
    res.writeHead(500, { 'content-type': 'text/html' });
    res.end('<html>oops</html>');
  });
  const client = new clients.HttpClient({ baseUrl, fetch });
  const read = await client.request({ method: 'GET', path: '/r', parse: (v) => v });
  assert.equal(read.error.code, 'UPSTREAM_INVALID');
  const unkeyed = await client.request({ method: 'POST', path: '/w', body: {}, parse: (v) => v });
  assert.equal(unkeyed.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(seen.length, 1);
});

test('path params are encoded and must match the template exactly', () => {
  assert.equal(
    clients.expandPath('/me/addresses/:addressId', { addressId: 'a b/c' }),
    '/me/addresses/a%20b%2Fc',
  );
  assert.throws(() => clients.expandPath('/me/addresses/:addressId', {}), /MISSING_PATH_PARAM/);
  assert.throws(() => clients.expandPath('/me', { x: '1' }), /UNEXPECTED_PATH_PARAM/);
  assert.throws(() => new clients.HttpClient({ baseUrl: 'http://x/', fetch }), /INVALID_BASE_URL/);
  const key = clients.newIdempotencyKey((b) => randomFillSync(b));
  assert.equal(contracts.parseIdempotencyKey(key), key);
});
