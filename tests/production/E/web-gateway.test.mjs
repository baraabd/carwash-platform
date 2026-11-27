import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, writeFile, rm, copyFile, mkdir, readFile, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createWebRuntime as customer } from '../../../infra/web-runtime.mjs';
import { createWebRuntime as admin } from '../../../apps/admin-web/server.mjs';
import { createWebRuntime as operator } from '../../../apps/operator-web/server.mjs';
import { loadWebGatewayConfig } from '../../../infra/web-gateway.mjs';

const runtimes = { customer, admin, operator };
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const {
  parseApiErrorEnvelope,
  API_ERROR_STATUS,
} = require('../../../packages/contracts/dist/common/errors.js');
const { HttpClient } = require('../../../packages/api-clients/dist/transport.js');

async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function request(origin, pathname, { method = 'GET', headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(origin, { path: pathname, method, headers }, (res) => {
      const parts = [];
      res.on('data', (part) => parts.push(part));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(parts).toString(),
        }),
      );
      res.on('error', reject);
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

async function fixture(t, factory = customer, overrides = {}) {
  const state = { ready: true, mode: 'normal', calls: [], cookies: [] };
  const gateway = await listen(
    t,
    createServer(async (req, res) => {
      if (req.url === '/health/ready') {
        res.writeHead(state.ready ? 200 : 503, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            service: 'api-gateway',
            ready: state.ready,
            businessReady: state.ready,
          }),
        );
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      state.calls.push({
        path: req.url,
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      if (state.mode === 'slow') return;
      if (state.mode === 'redirect') {
        res.writeHead(307, { location: '/unexpected-destination' });
        res.end();
        return;
      }
      res.writeHead(state.mode === 'denied' ? 403 : 200, {
        'content-type': 'application/json',
        'set-cookie': state.cookies,
        'x-correlation-id': 'proxy-fixture-correlation',
        etag: '"7"',
        'access-control-allow-origin': '*',
      });
      res.end(
        state.mode === 'malformed'
          ? '{invalid-json'
          : state.mode === 'large'
            ? JSON.stringify({ data: 'x'.repeat(4096) })
            : JSON.stringify({
                code: state.mode === 'denied' ? 'AUTH_CSRF' : 'FIXTURE_GATEWAY_RESPONSE',
              }),
      );
    }),
  );
  const documentRoot = await mkdtemp(path.join(tmpdir(), 'carwash-web-gateway-'));
  t.after(() => rm(documentRoot, { recursive: true, force: true }));
  await writeFile(
    path.join(documentRoot, 'index.html'),
    '<!doctype html><title>Technical runtime fixture</title>',
  );
  // Bind the real listener first so the fixed public origin includes its exact
  // assigned port; attach the unchanged production server's request listener.
  const listener = createServer();
  const origin = await listen(t, listener);
  const runtime = factory({
    documentRoot,
    env: {
      WEB_GATEWAY_ORIGIN: gateway,
      WEB_PUBLIC_ORIGIN: origin,
      WEB_GATEWAY_TIMEOUT_MS: '200',
      WEB_GATEWAY_REQUEST_LIMIT: '1024',
      WEB_GATEWAY_RESPONSE_LIMIT: '2048',
      ...overrides,
    },
  });
  listener.on('request', runtime.listeners('request')[0]);
  return { state, origin, documentRoot, gateway };
}

for (const [name, factory] of Object.entries(runtimes)) {
  test(`${name}: actual same-origin API transport preserves credentials, CSRF, binding and exact bytes`, async (t) => {
    const { state, origin } = await fixture(t, factory);
    state.cookies = [
      'wg_access=fixture-access; Path=/; HttpOnly; SameSite=Lax',
      'wg_csrf=fixture-csrf; Path=/; SameSite=Lax',
    ];
    const payload = '{"name":"طلب عربي","note":"exact bytes"}';
    const response = await request(origin, '/api/v1/identity/guest', {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        cookie: 'wg_csrf=fixture-csrf; wg_pre=fixture-pre',
        'x-csrf-token': 'fixture-csrf',
        'x-wg-session-binding': 'fixture-session-binding',
        'idempotency-key': 'fixture-idempotency',
        'if-match': '"6"',
        'x-auth-subject': 'forged-principal',
        'x-service-token': 'forged-workload',
        'x-forwarded-host': 'attacker.invalid',
        forwarded: 'host=attacker.invalid;proto=http',
      },
      chunks: [payload.slice(0, 10), payload.slice(10)],
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.headers['set-cookie'], state.cookies);
    assert.equal(response.headers['x-correlation-id'], 'proxy-fixture-correlation');
    assert.equal(response.headers.etag, '"7"');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    const [upstream] = state.calls;
    assert.equal(upstream.path, '/api/v1/identity/guest');
    assert.equal(upstream.body.toString(), payload);
    assert.equal(upstream.headers.origin, origin);
    assert.equal(upstream.headers['x-wg-session-binding'], 'fixture-session-binding');
    assert.equal(upstream.headers['x-csrf-token'], 'fixture-csrf');
    assert.equal(upstream.headers.cookie, 'wg_csrf=fixture-csrf; wg_pre=fixture-pre');
    for (const forbidden of ['x-auth-subject', 'x-service-token', 'x-forwarded-host', 'forwarded'])
      assert.equal(upstream.headers[forbidden], undefined, forbidden);
    state.mode = 'denied';
    assert.equal((await request(origin, '/api/operator/tasks')).status, 403);
  });

  test(`${name}: readiness requires both the real entry artifact and a ready Gateway`, async (t) => {
    const { state, origin, documentRoot } = await fixture(t, factory);
    let ready = await request(origin, '/health/ready');
    assert.equal(ready.status, 200);
    assert.equal(JSON.parse(ready.body).businessReady, true);
    state.ready = false;
    ready = await request(origin, '/health/ready');
    assert.equal(ready.status, 503);
    assert.equal(JSON.parse(ready.body).code, 'GATEWAY_NOT_READY');
    assert.equal((await request(origin, '/health/live')).status, 200);
    state.ready = true;
    await rm(path.join(documentRoot, 'index.html'));
    ready = await request(origin, '/health/ready');
    assert.equal(ready.status, 503);
    assert.equal(JSON.parse(ready.body).code, 'BOOT_ARTIFACT_UNAVAILABLE');
  });
}

test('fixed upstream refuses host/origin spoofing, traversal, redirects and secret-bearing headers', async (t) => {
  const { state, origin } = await fixture(t);
  assert.equal(
    (await request(origin, '/api/v1/contracts', { headers: { host: 'attacker.invalid' } })).status,
    400,
  );
  assert.equal(
    (
      await request(origin, '/api/v1/contracts', {
        headers: { origin: 'https://attacker.invalid' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(origin, '/api/v1/contracts', { headers: { 'sec-fetch-site': 'cross-site' } }))
      .status,
    403,
  );
  for (const pathname of [
    '/api/v1/%2e%2e/health/live',
    '/api/v1/a%2fb',
    '/api/v1/a%5cb',
    '/api/v1/%00',
  ])
    assert.equal((await request(origin, pathname)).status, 400, pathname);
  assert.equal(state.calls.length, 0);
  state.mode = 'redirect';
  assert.equal((await request(origin, '/api/v1/contracts')).status, 502);
  assert.equal(state.calls.length, 1, 'redirect target is never requested');
  state.mode = 'normal';
  state.cookies = ['wg_access=bad; Domain=attacker.invalid; Path=/; HttpOnly; SameSite=Lax'];
  assert.equal((await request(origin, '/api/v1/identity/session')).status, 502);
});

test('limits apply to streamed request and response bytes, and a stalled Gateway times out', async (t) => {
  const { state, origin } = await fixture(t);
  const oversized = await request(origin, '/api/v1/booking', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    chunks: ['a'.repeat(600), 'b'.repeat(600)],
  });
  assert.equal(oversized.status, 400);
  assert.equal(state.calls.length, 0);
  state.mode = 'large';
  assert.equal((await request(origin, '/api/v1/contracts')).status, 502);
  state.mode = 'slow';
  const started = Date.now();
  assert.equal((await request(origin, '/api/v1/contracts')).status, 504);
  assert.ok(Date.now() - started < 1500);
});

test('secure public origins reject insecure cookies and preserve valid __Host cookies', async (t) => {
  const { state, origin } = await fixture(t, customer, {
    WEB_PUBLIC_ORIGIN: 'https://app.example.test',
  });
  const options = { headers: { host: 'app.example.test', origin: 'https://app.example.test' } };
  state.cookies = ['wg_access=fixture; Path=/; HttpOnly; SameSite=Lax'];
  assert.equal((await request(origin, '/api/v1/identity/session', options)).status, 502);
  state.cookies = ['__Host-wg_access=fixture; Path=/; Secure; HttpOnly; SameSite=Lax'];
  const response = await request(origin, '/api/v1/identity/session', options);
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers['set-cookie'], state.cookies);
});

test('configuration uses the same explicit private transport policy as owner clients', () => {
  const base = { WEB_PUBLIC_ORIGIN: 'https://app.example.test' };
  for (const raw of [
    'http://gateway',
    'http://10.0.0.1',
    'https://u:p@example.test',
    'https://example.test/path',
    'https://example.test?query=1',
    'https://example.test#hash',
    'http://gateway.railway.internal',
  ])
    assert.throws(() => loadWebGatewayConfig({ ...base, WEB_GATEWAY_ORIGIN: raw }));
  const env = {
    ...base,
    WEB_GATEWAY_ORIGIN: 'http://gateway.railway.internal',
    CW_PRIVATE_NETWORK: 'railway',
    CW_PRIVATE_HTTP_HOSTS: 'gateway.railway.internal',
    RAILWAY_PROJECT_ID: '7aa96062-f337-4d69-92c6-2af61c9348db',
    RAILWAY_ENVIRONMENT_ID: '2bfd91fb-ae06-4c71-a267-913fa123699b',
  };
  assert.equal(loadWebGatewayConfig(env).origin, env.WEB_GATEWAY_ORIGIN);
  assert.throws(() =>
    loadWebGatewayConfig({ ...env, CW_PRIVATE_HTTP_HOSTS: 'identity.railway.internal' }),
  );
  assert.throws(() => loadWebGatewayConfig({ ...env, RAILWAY_PROJECT_ID: undefined }));
  assert.equal(loadWebGatewayConfig({}), null);
});

test('standalone web artifact loads the copied canonical transport module without workspace dependencies', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'carwash-standalone-proxy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const security = path.join(dir, 'node_modules/@carwash/security-kit');
  const contracts = path.join(dir, 'node_modules/@carwash/contracts');
  await mkdir(path.join(security, 'dist'), { recursive: true });
  await mkdir(contracts, { recursive: true });
  for (const file of ['package.json', 'server-proxy.mjs'])
    await copyFile(
      new URL(`../../../packages/security-kit/${file}`, import.meta.url),
      path.join(security, file),
    );
  await copyFile(
    new URL('../../../packages/security-kit/dist/service-origin.js', import.meta.url),
    path.join(security, 'dist/service-origin.js'),
  );
  await copyFile(
    new URL('../../../packages/contracts/package.json', import.meta.url),
    path.join(contracts, 'package.json'),
  );
  await cp(
    new URL('../../../packages/contracts/dist', import.meta.url),
    path.join(contracts, 'dist'),
    {
      recursive: true,
    },
  );
  const metadata = JSON.parse(await readFile(path.join(security, 'package.json'), 'utf8'));
  assert.equal(metadata.exports['./server-proxy'], './server-proxy.mjs');
  assert.ok(metadata.files.includes('server-proxy.mjs'));
  assert.equal(metadata.dependencies['@carwash/contracts'], 'workspace:*');
  await writeFile(
    path.join(dir, 'web-gateway.mjs'),
    "export { createWebGateway, loadWebGatewayConfig } from '@carwash/security-kit/server-proxy';",
  );
  const runtime = await import(pathToFileURL(path.join(dir, 'web-gateway.mjs')).href);
  assert.equal(runtime.createWebGateway({ env: {} }).configured, false);
  const proxy = runtime.createWebGateway({ env: {} });
  const origin = await listen(
    t,
    createServer((req, res) => proxy.handle(req, res)),
  );
  const response = await request(origin, '/api/v1/contracts');
  assert.equal(response.status, 503);
  assert.equal(parseApiErrorEnvelope(JSON.parse(response.body)).error.code, 'SERVICE_NOT_READY');
});

async function operatorClient(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'carwash-proxy-operator-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'package.json'), '{"type":"commonjs"}');
  await symlink(
    path.join(repoRoot, 'apps/operator-web/node_modules'),
    path.join(dir, 'node_modules'),
    'dir',
  );
  const ts = require(path.join(repoRoot, 'node_modules/typescript'));
  for (const name of ['client', 'parse', 'types']) {
    const source = await readFile(
      path.join(repoRoot, 'apps/operator-web/src/api', name + '.ts'),
      'utf8',
    );
    await writeFile(
      path.join(dir, name + '.js'),
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    );
  }
  return require(path.join(dir, 'client.js'));
}

async function adminClient(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'carwash-proxy-admin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await symlink(
    path.join(repoRoot, 'apps/admin-web/node_modules'),
    path.join(dir, 'node_modules'),
    'dir',
  );
  const ts = require(path.join(repoRoot, 'node_modules/typescript'));
  const source = await readFile(path.join(repoRoot, 'apps/admin-web/src/api/http.ts'), 'utf8');
  await writeFile(
    path.join(dir, 'http.cjs'),
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
  return require(path.join(dir, 'http.cjs'));
}

test('an accepted POST followed by proxy timeout or response rejection remains UNKNOWN in the actual Operator and shared clients', async (t) => {
  const { state, origin } = await fixture(t, operator);
  const client = await operatorClient(t);
  const nativeFetch = globalThis.fetch;
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'wg_csrf=fixture-csrf' },
  });
  globalThis.fetch = (url, init) =>
    typeof url === 'string' && url.startsWith('/')
      ? nativeFetch(origin + url, {
          ...init,
          headers: { ...init.headers, origin, cookie: 'wg_csrf=fixture-csrf' },
        })
      : nativeFetch(url, init);
  t.after(() => {
    globalThis.fetch = nativeFetch;
    if (document) Object.defineProperty(globalThis, 'document', document);
    else delete globalThis.document;
  });
  const shared = new HttpClient({
    baseUrl: origin + '/api/v1',
    fetch: nativeFetch,
    timeoutMs: 2000,
    headers: () => ({ origin }),
  });
  for (const [mode, expectedCode, cause] of [
    ['slow', 'UPSTREAM_TIMEOUT', 'timeout'],
    ['large', 'UPSTREAM_INVALID', 'shape'],
    ['malformed', 'UPSTREAM_INVALID', 'shape'],
    ['redirect', 'UPSTREAM_INVALID', 'shape'],
    ['cookie', 'UPSTREAM_INVALID', 'shape'],
  ]) {
    state.mode = mode;
    state.cookies =
      mode === 'cookie'
        ? ['wg_access=invalid; Domain=other.invalid; Path=/; HttpOnly; SameSite=Lax']
        : [];
    const before = state.calls.length;
    const key = 'stable-proxy-' + mode + '-idempotency-key';
    const outcome = await client.call({
      method: 'POST',
      path: '/api/operator/tasks/fixture/close',
      body: { fixture: mode },
      idempotencyKey: key,
      parse: null,
      timeoutMs: 2000,
    });
    assert.deepEqual(outcome, { kind: 'unknown', cause }, mode);
    assert.equal(state.calls.length, before + 1, 'proxy/client must not retry an ambiguous write');
    assert.equal(state.calls.at(-1).headers['idempotency-key'], key);
    const result = await shared.request({
      method: 'POST',
      path: '/fixture',
      body: { fixture: mode },
      idempotencyKey: key,
      parse: (value) => value,
    });
    assert.equal(result.ok, false, mode);
    assert.equal(result.error.code, expectedCode, mode);
    assert.equal(result.error.retryable, false, mode);
    const parsed = parseApiErrorEnvelope({ error: result.error });
    assert.deepEqual(client.unknownGatewayOutcome(result.status, parsed.error.code), {
      kind: 'unknown',
      cause,
    });
    assert.equal(
      state.calls.length,
      before + 2,
      'shared client must retain one request per explicit call',
    );
  }
});

test('proxy-generated path, origin, size and host refusals use the strict published error envelope before forwarding', async (t) => {
  const { state, origin } = await fixture(t);
  const cases = [
    ['/api/v1/a%2fb', {}, 'REQUEST_INVALID'],
    ['/api/v1/contracts', { headers: { origin: 'https://other.invalid' } }, 'AUTH_CSRF'],
    ['/api/v1/contracts', { headers: { host: 'other.invalid' } }, 'REQUEST_INVALID'],
    ['/api/v1/fixture', { method: 'POST', chunks: ['a'.repeat(2048)] }, 'REQUEST_INVALID'],
    ['/api/v1/fixture', { method: 'TRACE' }, 'REQUEST_INVALID'],
  ];
  for (const [pathname, options, code] of cases) {
    const response = await request(origin, pathname, options);
    assert.ok(response.status >= 400 && response.status < 500);
    const parsed = parseApiErrorEnvelope(JSON.parse(response.body));
    assert.equal(parsed.error.code, code);
    assert.equal(response.status, API_ERROR_STATUS[code]);
    assert.equal(parsed.error.retryable, false);
    assert.equal(response.headers['x-correlation-id'], parsed.error.correlationId);
    assert.equal(response.headers['x-request-id'], parsed.error.requestId);
  }
  assert.equal(state.calls.length, 0);
});

test('actual Admin client treats an oversized pre-forward write as INVALID without an ambiguous outcome', async (t) => {
  const { state, origin } = await fixture(t, admin);
  const client = await adminClient(t);
  const nativeFetch = globalThis.fetch;
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'wg_csrf=fixture-csrf' },
  });
  globalThis.fetch = (url, init) =>
    typeof url === 'string' && url.startsWith('/')
      ? nativeFetch(origin + url, {
          ...init,
          headers: { ...init.headers, origin, cookie: 'wg_csrf=fixture-csrf' },
        })
      : nativeFetch(url, init);
  t.after(() => {
    globalThis.fetch = nativeFetch;
    if (document) Object.defineProperty(globalThis, 'document', document);
    else delete globalThis.document;
  });
  const result = await client.request('/fixture', {
    method: 'POST',
    body: { text: 'a'.repeat(2048) },
    idempotencyKey: 'stable-admin-proxy-command-key',
    read: (value) => value,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'INVALID');
  assert.equal(result.code, 'REQUEST_INVALID');
  assert.equal(state.calls.length, 0, 'no owner received the refused request');
});
