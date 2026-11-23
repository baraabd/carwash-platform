import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { billingFaultProxy } from '../production/A/_billing-fault-proxy.mjs';

const CREATE = '/internal/v1/billing/booking-obligations';
const COMPENSATE = '/internal/v1/billing/booking-obligations/compensations';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

// node:http preserves the raw request target; fetch would normalize traversal
// and absolute targets before they reached the proxy under test.
function send(base, target, { method = 'POST', body = '', headers = {} } = {}) {
  const endpoint = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: target,
        method,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('TEST_PROXY_REQUEST_TIMEOUT')));
    req.end(body);
  });
}

async function fixture(t) {
  const requests = [];
  const control = { redirect: null };
  const owner = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (control.redirect) {
        res.writeHead(307, { location: control.redirect }).end();
        return;
      }
      res
        .writeHead(req.url === CREATE ? 201 : 200, {
          'content-type': 'application/json',
          'idempotency-replayed': 'true',
        })
        .end('{"ownerReceipt":"verified"}');
    });
  });
  const origin = await listen(owner);
  const proxy = await billingFaultProxy(origin);
  t.after(async () => {
    await proxy.close();
    await close(owner);
  });
  return { origin, proxy, requests, control };
}

test('Billing fault proxy forwards only its two POST commands and preserves owner replies', async (t) => {
  const { origin, proxy, requests } = await fixture(t);
  const token = randomUUID();
  const body = JSON.stringify({ bookingId: randomUUID() });
  for (const target of [CREATE, COMPENSATE]) {
    const result = await send(proxy.base, target, {
      body,
      headers: {
        'x-service-client': 'booking',
        'x-service-token': token,
        host: 'untrusted.invalid',
      },
    });
    assert.equal(result.status, target === CREATE ? 201 : 200);
    assert.equal(result.body, '{"ownerReceipt":"verified"}');
    assert.equal(result.headers['idempotency-replayed'], 'true');
  }
  assert.deepEqual(proxy.calls, { create: 1, compensate: 1 });
  assert.deepEqual(
    requests.map(({ method, url, body: actualBody, headers }) => ({
      method,
      url,
      body: actualBody,
      host: headers.host,
      client: headers['x-service-client'],
      token: headers['x-service-token'],
    })),
    [CREATE, COMPENSATE].map((url) => ({
      method: 'POST',
      url,
      body,
      host: new URL(origin).host,
      client: 'booking',
      token,
    })),
  );
});

test('Billing fault proxy rejects unsafe raw targets and methods without forwarding or disclosing credentials', async (t) => {
  const { proxy, requests } = await fixture(t);
  let escaped = 0;
  const outsider = createServer((_req, res) => {
    escaped += 1;
    res.end();
  });
  const outside = await listen(outsider);
  t.after(() => close(outsider));
  const token = randomUUID();
  const paths = [
    '/',
    '/health/live',
    `${CREATE}/`,
    `${CREATE}?redirect=${outside}`,
    `${CREATE}#ignored`,
    `${outside}${CREATE}`,
    `//${new URL(outside).host}${CREATE}`,
    '/internal/v1/billing/%62ooking-obligations',
    '/internal/v1/billing/ignored/../booking-obligations',
    '/internal/v1/billing/ignored/%2e%2e/booking-obligations',
    '/internal%2fv1/billing/booking-obligations',
    `${COMPENSATE}?query=1`,
    `${COMPENSATE}/extra`,
  ];
  for (const target of paths) {
    const result = await send(proxy.base, target, {
      headers: { 'x-service-token': token, authorization: `Bearer ${token}` },
    });
    assert.equal(result.status, 404, target);
    assert.equal(result.body, '{"error":{"code":"NOT_FOUND"}}');
    assert.equal(result.body.includes(token), false);
  }
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const target of [CREATE, COMPENSATE]) {
      const result = await send(proxy.base, target, {
        method,
        headers: { 'x-service-token': token },
      });
      assert.equal(result.status, 405, method);
      assert.equal(result.headers.allow, 'POST');
      assert.equal(result.body.includes(token), false);
    }
  }
  assert.deepEqual(proxy.calls, { create: 0, compensate: 0 });
  assert.equal(requests.length, 0);
  assert.equal(escaped, 0);
});

test('Billing fault proxy requires an explicit plain-HTTP IPv4 loopback port without credentials or URL suffixes', async () => {
  for (const origin of [
    'http://example.invalid:8080',
    'https://127.0.0.1:8080',
    'http://localhost:8080',
    'http://127.0.0.1',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:8080/',
    'http://127.0.0.1:8080/path',
    'http://127.0.0.1:8080?target=remote',
    'http://127.0.0.1:8080#fragment',
    'http://user:password@127.0.0.1:8080',
    'http://2130706433:8080',
    null,
  ]) {
    await assert.rejects(billingFaultProxy(origin), /BILLING_PROXY_LOOPBACK_ORIGIN_REQUIRED/);
  }
});

test('Billing fault proxy rejection controls fail before the owner and recover when released', async (t) => {
  const { proxy, requests } = await fixture(t);
  proxy.state.rejectCreate = true;
  proxy.state.rejectCompensation = true;
  for (const target of [CREATE, COMPENSATE]) {
    const result = await send(proxy.base, target);
    assert.equal(result.status, 503);
    assert.equal(result.body, '{"error":{"code":"UPSTREAM_UNAVAILABLE"}}');
  }
  assert.equal(requests.length, 0);
  proxy.state.rejectCreate = false;
  proxy.state.rejectCompensation = false;
  assert.equal((await send(proxy.base, CREATE)).status, 201);
  assert.equal((await send(proxy.base, COMPENSATE)).status, 200);
  assert.equal(requests.length, 2);
  assert.deepEqual(proxy.calls, { create: 2, compensate: 2 });
});

test('Billing fault proxy loses only the requested successful replies after the owner handled them', async (t) => {
  const { proxy, requests } = await fixture(t);
  for (const [target, fault] of [
    [CREATE, 'loseCreate'],
    [COMPENSATE, 'loseCompensation'],
  ]) {
    proxy.state[fault] = 1;
    const before = requests.length;
    await assert.rejects(send(proxy.base, target), { code: 'ECONNRESET' });
    assert.equal(requests.length, before + 1);
    assert.equal(proxy.state[fault], 0);
    assert.equal((await send(proxy.base, target)).status, target === CREATE ? 201 : 200);
    assert.equal(requests.length, before + 2);
  }
});

test(
  'Billing fault proxy pauses delivery after the real owner reply and returns it unchanged on release',
  { timeout: 5000 },
  async (t) => {
    const { proxy, requests } = await fixture(t);
    const bookingId = randomUUID();
    const gate = proxy.pauseNextCreate();
    t.after(gate.release);
    let delivered = false;
    const pending = send(proxy.base, CREATE, { body: JSON.stringify({ bookingId }) });
    void pending.then(() => {
      delivered = true;
    });
    assert.deepEqual(await gate.entered, { bookingId, status: 201 });
    assert.equal(requests.length, 1);
    assert.equal(delivered, false);
    gate.release();
    assert.equal((await pending).body, '{"ownerReceipt":"verified"}');
  },
);

test('Billing fault proxy never follows an owner redirect with workload credentials', async (t) => {
  const { proxy, requests, control } = await fixture(t);
  let escaped = 0;
  const outsider = createServer((_req, res) => {
    escaped += 1;
    res.end();
  });
  const outside = await listen(outsider);
  t.after(() => close(outsider));
  control.redirect = outside + '/capture';
  await assert.rejects(send(proxy.base, CREATE, { headers: { 'x-service-token': randomUUID() } }), {
    code: 'ECONNRESET',
  });
  assert.equal(requests.length, 1);
  assert.equal(escaped, 0);
});
