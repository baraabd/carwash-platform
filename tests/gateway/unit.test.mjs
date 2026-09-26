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
) {
  const principal = { subject: randomUUID(), sessionId: randomUUID(), authVersion: 1 };
  const session = { ...principal, roles: ['customer'], permissions };
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
    new Set(GATEWAY_ROUTES.map((r) => r.method + ' ' + r.path)).size,
    GATEWAY_ROUTES.length,
  );
  for (const r of GATEWAY_ROUTES) {
    assert.ok(r.owner);
    if (r.method !== 'GET' && !r.authTransport) assert.equal(r.idempotency, 'required');
  }
  for (const c of GATEWAY_COMPOSITIONS)
    for (const id of c.routes) assert.equal(GATEWAY_ROUTES.find((r) => r.id === id)?.method, 'GET');
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
    gateway.routeMatch('POST', `/api/v1/admin/billing/${id}/refund`).upstream,
    `/internal/v1/billing/${id}/refund`,
  );
});
test('F007 invalid idempotency keys cannot reach an upstream', () => {
  for (const key of [undefined, '', 'short', 'x'.repeat(129), 'a'.repeat(16) + '\n'])
    assert.throws(() => gateway.idempotencyKey(key));
  assert.equal(gateway.idempotencyKey('command_1234567890'), 'command_1234567890');
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
  assert.equal((await request(app.base, '/api/v1/customer/bookings', options)).status, 400);
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
  const allowed = [
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
    const expected = [
      ...new Set(
        composition.routes.map((id) => GATEWAY_ROUTES.find((route) => route.id === id).permission),
      ),
    ].sort();
    assert.deepEqual(operation.security, [{ bearer: [] }, { session: [] }]);
    assert.deepEqual(operation['x-required-permissions'], expected);
    assert.equal(operation['x-read-only'], true);
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
    'message',
    'requestId',
    'correlationId',
  ]);
  for (const pathItem of Object.values(api.paths)) {
    for (const operation of Object.values(pathItem)) {
      for (const status of [
        '400',
        '401',
        '403',
        '404',
        '409',
        '413',
        '422',
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
  assert.doesNotMatch(JSON.stringify(result.body), /SQL|password|private|testStub/);
});
