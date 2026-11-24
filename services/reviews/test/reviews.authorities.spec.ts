import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { ReviewsError } from '../src/application/errors';
import { HttpBookingAuthority } from '../src/infrastructure/booking/booking.authority';
import { IdentitySessionAuthority } from '../src/infrastructure/identity/identity.authority';
import { bearer, ownerEndpoint } from '../src/infrastructure/http/owner-http';
import type { RequestContext } from '../src/ports/reviews.ports';

const token = 'Bearer fixture_signed.token_value.signature_value';
const principal = { kind: 'account', subjectId: randomUUID() } as const;
const context: RequestContext = {
  actor: { principal, permissions: ['bookings.read:self'] },
  credential: token,
  correlationId: randomUUID(),
};
const bookingId = randomUUID();
const booking = () => ({
  bookingId,
  revision: 7,
  beneficiary: principal,
  status: 'COMPLETED',
  contact: { name: 'PRIVATE_OWNER_CONTACT' },
});

async function server(
  t: test.TestContext,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return new URL(`http://127.0.0.1:${address.port}`);
}
const json = (res: ServerResponse, value: unknown, status = 200) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: unknown) => error instanceof ReviewsError && error.code === code);

test('Reviews authority configuration is bounded and sends credentials only to a configured origin', () => {
  assert.deepEqual(ownerEndpoint({}, 'OWNER', 'TIMEOUT'), { origin: null, timeoutMs: 2000 });
  for (const raw of [
    'http://public.example.test',
    'ftp://127.0.0.1',
    'https://user:password@example.test',
    'https://example.test/path',
    'https://example.test/?token=secret',
    'https://example.test/#fragment',
    'invalid',
  ])
    assert.throws(() => ownerEndpoint({ OWNER: raw }, 'OWNER', 'TIMEOUT'), /OWNER_INVALID/);
  for (const raw of ['0', '99', '10001', '2.5', 'NaN'])
    assert.throws(() => ownerEndpoint({ TIMEOUT: raw }, 'OWNER', 'TIMEOUT'), /TIMEOUT_INVALID/);
  assert.equal(
    ownerEndpoint({ OWNER: 'https://booking.example.test', TIMEOUT: '100' }, 'OWNER', 'TIMEOUT')
      .origin?.origin,
    'https://booking.example.test',
  );
  for (const raw of [
    '',
    'Bearer token',
    'Basic user',
    token + '\r\nspoof: yes',
    'Bearer ' + 'x'.repeat(9000),
  ])
    assert.equal(bearer(raw), false);
});

test('Booking authority retains only strict eligibility fields and forwards no service credentials', async (t) => {
  const calls: IncomingMessage[] = [];
  const origin = await server(t, (req, res) => {
    calls.push(req);
    json(res, booking());
  });
  const authority = new HttpBookingAuthority({ origin, timeoutMs: 1000 });
  const fact = await authority.read(context, bookingId);
  assert.deepEqual(fact, { bookingId, revision: 7, beneficiary: principal, status: 'COMPLETED' });
  assert.equal(calls[0]?.url, `/internal/v1/booking/bookings/${bookingId}`);
  assert.equal(calls[0]?.headers.authorization, token);
  assert.equal(calls[0]?.headers['x-correlation-id'], context.correlationId);
  for (const name of ['cookie', 'x-auth-subject', 'x-service-client', 'x-service-token'])
    assert.equal(calls[0]?.headers[name], undefined);
});

test('Booking authority rejects changed bindings, malformed facts, HTML, oversized and incomplete bodies', async (t) => {
  let response: unknown = booking(),
    mode = 'json';
  const origin = await server(t, (_req, res) => {
    if (mode === 'html') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<html>private</html>');
      return;
    }
    if (mode === 'oversize') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(' '.repeat(65_537));
      res.end('{}');
      return;
    }
    if (mode === 'incomplete') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
      return;
    }
    json(res, response);
  });
  const authority = new HttpBookingAuthority({ origin, timeoutMs: 100 });
  for (const patch of [
    { bookingId: randomUUID() },
    { revision: 0 },
    { beneficiary: { subjectId: principal.subjectId } },
    { status: 'complete' },
    { status: 'UNKNOWN' },
  ]) {
    response = { ...booking(), ...patch };
    await rejects(authority.read(context, bookingId), 'UPSTREAM_INVALID');
  }
  for (const next of ['html', 'oversize', 'incomplete']) {
    mode = next;
    await rejects(authority.read(context, bookingId), 'UPSTREAM_INVALID');
  }
});

test('Booking authority follows no redirects and fails closed for denial/unavailable origins', async (t) => {
  let captured = 0;
  const destination = await server(t, (_req, res) => {
    captured += 1;
    json(res, booking());
  });
  let status = 302;
  const origin = await server(t, (_req, res) => {
    res
      .writeHead(status, { location: destination.href, 'content-type': 'application/json' })
      .end('{}');
  });
  const authority = new HttpBookingAuthority({ origin, timeoutMs: 1000 });
  await rejects(authority.read(context, bookingId), 'DEPENDENCY_UNAVAILABLE');
  assert.equal(captured, 0);
  status = 404;
  assert.equal(await authority.read(context, bookingId), null);
  status = 401;
  await rejects(authority.read(context, bookingId), 'AUTH_REQUIRED');
  status = 403;
  await rejects(authority.read(context, bookingId), 'AUTH_FORBIDDEN');
  status = 503;
  await rejects(authority.read(context, bookingId), 'DEPENDENCY_UNAVAILABLE');
  await rejects(
    new HttpBookingAuthority({ origin: null, timeoutMs: 100 }).read(context, bookingId),
    'DEPENDENCY_UNAVAILABLE',
  );
});

test('Identity authority rechecks every request and rejects malformed authority, never spoofed hints', async (t) => {
  const session = {
    subject: principal.subjectId,
    sessionId: randomUUID(),
    authVersion: 1,
    principalKind: 'account',
    roles: ['customer'],
    permissions: ['bookings.read:self'],
  };
  let body: unknown = session,
    status = 200,
    calls = 0;
  const origin = await server(t, (req, res) => {
    calls += 1;
    assert.equal(req.url, '/internal/v1/identity/session');
    assert.equal(req.headers.authorization, token);
    json(res, body, status);
  });
  const authority = new IdentitySessionAuthority({ origin, timeoutMs: 1000 });
  assert.deepEqual(await authority.verify(token, context.correlationId), context.actor);
  status = 401;
  await rejects(authority.verify(token, context.correlationId), 'AUTH_REQUIRED');
  assert.equal(calls, 2);
  status = 200;
  for (const patch of [
    { authVersion: 0 },
    { principalKind: 'service' },
    { permissions: ['reviews.moderate', 'reviews.moderate'] },
    { permissions: ['made-up.grant'] },
    { principalKind: 'guest', roles: ['super-admin'] },
  ]) {
    body = { ...session, ...patch };
    await rejects(authority.verify(token, context.correlationId), 'DEPENDENCY_UNAVAILABLE');
  }
  await rejects(authority.verify(undefined, context.correlationId), 'AUTH_REQUIRED');
  await rejects(
    new IdentitySessionAuthority({ origin: null, timeoutMs: 100 }).verify(
      token,
      context.correlationId,
    ),
    'DEPENDENCY_UNAVAILABLE',
  );
});
