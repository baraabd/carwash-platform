import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { createHttpApplication } from '../../src/transport/http/create-app';
import { laneContext } from './support';

/**
 * Real Nest HTTP server on the real lane PostgreSQL.
 *
 * Identity is a local HTTP double of `GET /internal/v1/identity/session`
 * (Identity V1 contract shape). It is the only substitute in this suite and it
 * is declared as such in the evidence; token verification itself is Identity's
 * own tested responsibility.
 */
const SERVICE_TOKEN = 's'.repeat(48);
const READER_TOKEN = 'r'.repeat(48);
const SESSIONS: Record<string, { subject: string; permissions: string[] } | 'DOWN'> = {
  'customer-token-000001': {
    subject: randomUUID(),
    permissions: ['bookings.create:self', 'bookings.read:self'],
  },
  'operations-token-0001': { subject: randomUUID(), permissions: ['operations.dispatch'] },
  'technician-token-0001': { subject: randomUUID(), permissions: ['work.read:assigned'] },
  'identity-down-token-1': 'DOWN',
};

let identity: Server;
let app: INestApplication;
let base: string;
const identityCalls: string[] = [];

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

before(async () => {
  identity = createServer((req, res) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    identityCalls.push(req.url ?? '');
    const session = SESSIONS[token];
    if (req.url !== '/internal/v1/identity/session' || session === undefined) {
      res
        .writeHead(401, { 'content-type': 'application/json' })
        .end('{"error":{"code":"AUTH_REQUIRED"}}');
      return;
    }
    if (session === 'DOWN') {
      res.writeHead(500).end();
      return;
    }
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ...session, sessionId: randomUUID(), authVersion: 1, roles: [] }));
  });
  await new Promise<void>((resolve) => identity.listen(0, '127.0.0.1', resolve));
  process.env.DATABASE_URL = laneContext().databases.scheduling!.appUrl;
  process.env.IDENTITY_URL = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;
  process.env.SCHEDULING_USER_REQUESTS_PER_MINUTE = '40';
  process.env.SCHEDULING_SERVICE_CLIENTS = JSON.stringify([
    { id: 'booking', tokenSha256: digest(SERVICE_TOKEN), scopes: ['scheduling.holds.write'] },
    { id: 'gateway', tokenSha256: digest(READER_TOKEN), scopes: ['scheduling.availability.read'] },
  ]);
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/internal/v1/scheduling`;
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve) => identity.close(() => resolve()));
});

const user = (token: string) => ({ authorization: `Bearer ${token}` });
const booking = { 'x-service-client': 'booking', 'x-service-token': SERVICE_TOKEN };
const reader = { 'x-service-client': 'gateway', 'x-service-token': READER_TOKEN };

/** The fields these tests read from responses; everything else stays unknown. */
interface ApiBody {
  readonly error?: { readonly code: string; readonly correlationId: string };
  readonly windowId?: string;
  readonly holdId?: string;
  readonly status?: string;
  readonly slots?: readonly Record<string, unknown>[];
}

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as ApiBody };
}

async function newWindow(capacity = 2) {
  const zoneId = randomUUID();
  const startsAt = new Date(Date.now() + 3 * 3_600_000);
  startsAt.setUTCMilliseconds(0);
  const res = await call('POST', '/windows', user('operations-token-0001'), {
    zoneId,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
    capacity,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { zoneId, startsAt, window: res.body };
}

test('unauthenticated, mixed and forged callers are refused before any business logic', async () => {
  assert.equal((await call('GET', `/holds/${randomUUID()}`, {})).status, 401);
  assert.equal(
    (await call('GET', `/holds/${randomUUID()}`, { ...booking, ...user('operations-token-0001') }))
      .status,
    401,
  );
  assert.equal(
    (await call('GET', `/holds/${randomUUID()}`, { ...booking, 'x-service-token': 'x'.repeat(48) }))
      .status,
    401,
  );
  // x-auth-* headers from the gateway are never trusted on their own.
  const forged = await call('GET', `/holds/${randomUUID()}`, { 'x-auth-subject': randomUUID() });
  assert.equal(forged.status, 401);
  assert.equal(
    (await call('GET', `/holds/${randomUUID()}`, user('unknown-token-000001'))).status,
    401,
  );
});

test('identity outage fails closed with 503, never as an anonymous or guessed caller', async () => {
  const res = await call('GET', `/holds/${randomUUID()}`, user('identity-down-token-1'));
  assert.equal(res.status, 503);
  assert.equal(res.body.error?.code, 'AUTH_UNAVAILABLE');
});

test('operations define windows; customers and technicians cannot', async () => {
  const body = {
    zoneId: randomUUID(),
    startsAt: new Date(Date.now() + 7_200_000).toISOString(),
    endsAt: new Date(Date.now() + 10_800_000).toISOString(),
    capacity: 1,
  };
  assert.equal((await call('POST', '/windows', user('customer-token-000001'), body)).status, 403);
  assert.equal((await call('POST', '/windows', user('technician-token-0001'), body)).status, 403);
  assert.equal((await call('POST', '/windows', booking, body)).status, 403);
  const created = await call('POST', '/windows', user('operations-token-0001'), body);
  assert.equal(created.status, 201);
  const replay = await call('POST', '/windows', user('operations-token-0001'), body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.windowId, created.body.windowId);
});

test('strict input: unknown fields, local times and bad types are rejected', async () => {
  const ops = user('operations-token-0001');
  const start = new Date(Date.now() + 7_200_000);
  const good = {
    zoneId: randomUUID(),
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
    capacity: 1,
  };
  assert.equal((await call('POST', '/windows', ops, { ...good, extra: true })).status, 400);
  assert.equal(
    (await call('POST', '/windows', ops, { ...good, startsAt: '2026-12-01T10:00:00+03:00' }))
      .status,
    400,
  );
  assert.equal((await call('POST', '/windows', ops, { ...good, capacity: '3' })).status, 400);
  assert.equal(
    (await call('POST', '/windows', ops, { ...good, zoneId: 'not-a-uuid' })).status,
    400,
  );
});

test('customers see availability without capacity internals; operations and readers see detail', async () => {
  const { zoneId, startsAt } = await newWindow(2);
  const query = `/availability?zoneId=${zoneId}&from=${new Date(startsAt.getTime() - 60_000).toISOString()}&to=${new Date(startsAt.getTime() + 60_000).toISOString()}`;
  const customer = await call('GET', query, user('customer-token-000001'));
  assert.equal(customer.status, 200);
  assert.deepEqual(Object.keys(customer.body.slots?.[0] ?? {}).sort(), [
    'available',
    'endsAt',
    'startsAt',
    'windowId',
  ]);
  const detailed = await call('GET', query, reader);
  assert.equal(detailed.body.slots?.[0]?.freeUnits, 2);
  assert.equal((await call('GET', query, user('technician-token-0001'))).status, 403);
  assert.equal(
    (await call('GET', query, booking)).status,
    403,
    'holds.write does not imply availability.read',
  );
});

test('hold lifecycle over HTTP: idempotency key required, replay, confirm, private fields hidden', async () => {
  const { window } = await newWindow(1);
  const body = { windowId: window.windowId, holderRef: randomUUID(), units: 1, ttlSeconds: 120 };
  assert.equal(
    (await call('POST', '/holds', booking, body)).status,
    400,
    'Idempotency-Key is mandatory',
  );
  const idem = { ...booking, 'idempotency-key': `http-${randomUUID()}` };
  const created = await call('POST', '/holds', idem, body);
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.body).sort(), [
    'expiresAt',
    'holdId',
    'holderRef',
    'releaseReason',
    'status',
    'units',
    'version',
    'windowId',
  ]);
  const replay = await call('POST', '/holds', idem, body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.holdId, created.body.holdId);
  const exhausted = await call(
    'POST',
    '/holds',
    { ...booking, 'idempotency-key': `http-${randomUUID()}` },
    body,
  );
  assert.equal(exhausted.status, 409);
  assert.equal(exhausted.body.error?.code, 'CAPACITY_EXHAUSTED');
  assert.equal(
    (await call('POST', '/holds', user('customer-token-000001'), body)).status,
    403,
    'customers cannot hoard holds directly',
  );
  const confirmed = await call('POST', `/holds/${created.body.holdId}/confirm`, booking, {});
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, 'CONFIRMED');
  const cancelled = await call('POST', `/holds/${created.body.holdId}/release`, booking, {
    reason: 'BOOKING_CANCELLED',
  });
  assert.equal(cancelled.body.status, 'CANCELLED');
  assert.equal(
    (await call('POST', `/holds/${created.body.holdId}/release`, booking, { reason: 'NOPE' }))
      .status,
    400,
  );
});

test('error bodies carry a correlation id and no internals', async () => {
  const correlationId = randomUUID();
  const res = await call('GET', `/holds/${randomUUID()}`, {
    ...booking,
    'x-correlation-id': correlationId,
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error?.correlationId, correlationId);
  assert.ok(!JSON.stringify(res.body).includes('prisma'));
});

test('per-user request budget answers 429 instead of exhausting the store', async () => {
  let limited = 0;
  for (let i = 0; i < 45; i += 1) {
    const res = await call('GET', `/holds/${randomUUID()}`, user('operations-token-0001'));
    if (res.status === 429) limited += 1;
  }
  assert.ok(limited > 0, 'the configured budget of 40/min must trip');
});
