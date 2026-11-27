/** Actual TypeScript client with an HTTP double; not browser/Identity acceptance. */
/* global Response, document -- Node 24 Response and a per-test browser-cookie double. */
import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules/typescript'));
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
let temporary;
let auth;
let client;
before(() => {
  temporary = mkdtempSync(path.join(tmpdir(), 'operator-auth-client-'));
  writeFileSync(path.join(temporary, 'package.json'), '{"type":"commonjs"}');
  symlinkSync(
    path.join(root, 'apps/operator-web/node_modules'),
    path.join(temporary, 'node_modules'),
    'dir',
  );
  const compile = (directory, relative = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) compile(path.join(directory, entry.name), next);
      else if (entry.name.endsWith('.ts')) {
        const output = path.join(temporary, next.replace(/\.ts$/, '.js'));
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(
          output,
          ts.transpileModule(readFileSync(path.join(directory, entry.name), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
          }).outputText,
        );
      }
    }
  };
  compile(path.join(root, 'apps/operator-web/src/api'));
  auth = require(path.join(temporary, 'auth-api.js'));
  client = require(path.join(temporary, 'client.js'));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.document = originalDocument;
});
after(() => rmSync(temporary, { recursive: true, force: true }));
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('operator login prepares CSRF and sends credentials only to same-origin Identity transport', async () => {
  const challenge = { challengeId: randomUUID(), expiresIn: 300, resendAfter: 30 };
  const calls = [];
  globalThis.document = { cookie: '' };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/csrf')) {
      document.cookie = '__Host-wg_csrf=challenge-bound';
      return json({});
    }
    return json(challenge);
  };
  const result = await auth.startLogin('worker@example.invalid', 'test-password');
  assert.deepEqual(result.value, challenge);
  assert.deepEqual(
    calls.map((c) => c.url),
    ['/api/operator/auth/csrf', '/api/operator/auth/login'],
  );
  assert.equal(calls[1].options.headers['x-csrf-token'], 'challenge-bound');
  assert.equal(calls[1].options.headers.authorization, undefined);
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    email: 'worker@example.invalid',
    password: 'test-password',
  });
});

test('CSRF failure prevents login; malformed challenge cannot be accepted', async () => {
  globalThis.document = { cookie: '' };
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return json({}, 503);
  };
  assert.equal((await auth.startLogin('worker@example.invalid', 'test-password')).kind, 'error');
  assert.equal(calls, 1);
  for (const value of [
    null,
    {},
    { challengeId: randomUUID(), expiresIn: -1, resendAfter: 0 },
    { challengeId: randomUUID(), expiresIn: 300, resendAfter: 0, token: 'unexpected' },
  ])
    assert.throws(() => auth.parseChallenge(value));
});

test('OTP verification uses the challenge and validates the returned session; lost logout stays unknown', async () => {
  globalThis.document = { cookie: 'wg_csrf=valid' };
  const challengeId = randomUUID();
  const session = {
    subject: randomUUID(),
    sessionId: randomUUID(),
    authVersion: 1,
    principalKind: 'account',
    roles: ['technician'],
    permissions: ['work.read:assigned'],
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/operator/auth/challenges/verify');
    assert.deepEqual(JSON.parse(options.body), { challengeId, code: '123456' });
    return json(session);
  };
  assert.deepEqual((await auth.verifyCode(challengeId, '123456')).value, session);
  globalThis.fetch = async () => {
    throw new TypeError('connection lost');
  };
  assert.deepEqual(await auth.signOut(), { kind: 'unknown', cause: 'network' });
});

test('concurrent unauthorized reads share one refresh and each retry only once', async () => {
  globalThis.document = { cookie: 'wg_csrf=valid' };
  let refreshes = 0;
  let authorized = false;
  const counts = new Map();
  globalThis.fetch = async (url) => {
    counts.set(url, (counts.get(url) ?? 0) + 1);
    if (url === '/api/operator/auth/refresh') {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      authorized = true;
      return json({});
    }
    return authorized ? json({ value: url }) : json({}, 401);
  };
  const results = await Promise.all(
    ['/api/operator/tasks', '/api/operator/availability'].map((path) =>
      client.call({ method: 'GET', path, parse: (value) => value }),
    ),
  );
  assert.equal(refreshes, 1);
  assert.ok(results.every((result) => result.kind === 'ok'));
  assert.equal(counts.get('/api/operator/tasks'), 2);
  assert.equal(counts.get('/api/operator/availability'), 2);
});

test('a rejected write preserves its key/body on refresh; a lost write is never retried', async () => {
  globalThis.document = { cookie: 'wg_csrf=valid' };
  const writes = [];
  let refreshed = false;
  const request = {
    method: 'POST',
    path: '/api/operator/tasks',
    body: { expectedRevision: 2 },
    idempotencyKey: randomUUID(),
    parse: (value) => value,
  };
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/refresh')) {
      refreshed = true;
      return json({});
    }
    writes.push(options);
    return json({}, refreshed ? 200 : 401);
  };
  assert.equal((await client.call(request)).kind, 'ok');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body, writes[1].body);
  assert.equal(writes[0].headers['idempotency-key'], writes[1].headers['idempotency-key']);
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    throw new TypeError('connection lost');
  };
  assert.equal((await client.call(request)).kind, 'unknown');
  assert.equal(attempts, 1);
});

test('permanent 401 cannot recurse and malformed cookie cannot crash an auth request', async () => {
  globalThis.document = { cookie: 'wg_csrf=%broken' };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return json({}, 401);
  };
  const result = await client.call({
    method: 'GET',
    path: '/api/operator/session',
    parse: (value) => value,
  });
  assert.equal(result.kind, 'error');
  assert.equal(result.status, 401);
  assert.deepEqual(
    calls.map((c) => c.url),
    ['/api/operator/session', '/api/operator/auth/refresh'],
  );
  assert.equal(calls[1].options.headers['x-csrf-token'], undefined);
});

test('operator identity replacement discards a late read and never replays an old write after refresh', async () => {
  globalThis.document = { cookie: 'wg_csrf=valid' };
  client.sessionRequests.invalidate();
  let finish;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const read = client.call({ method: 'GET', path: '/api/operator/tasks', parse: (value) => value });
  client.sessionRequests.invalidate();
  finish(json({ privateValue: 'old-operator' }));
  assert.equal((await read).code, 'SESSION_CHANGED');
  const calls = [];
  let refresh;
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/refresh'))
      return new Promise((resolve) => {
        refresh = resolve;
      });
    return json({}, 401);
  };
  const pending = client.call({
    method: 'POST',
    path: '/api/operator/tasks',
    body: { expectedRevision: 4 },
    parse: null,
  });
  while (!refresh) await new Promise((resolve) => setImmediate(resolve));
  client.sessionRequests.invalidate();
  refresh(json({}));
  assert.equal((await pending).code, 'SESSION_CHANGED');
  assert.deepEqual(calls, ['/api/operator/tasks', '/api/operator/auth/refresh']);
});
