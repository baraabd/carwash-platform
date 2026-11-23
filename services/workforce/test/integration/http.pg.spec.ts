import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { createHttpApplication } from '../../src/transport/http/create-app';
import {
  DAY,
  HOUR,
  TestClock,
  replica,
  seedOperator,
  shift,
  workforceAppUrl,
  type Replica,
} from './support';

/**
 * Real Nest HTTP server on the real lane PostgreSQL (runtime role).
 *
 * Identity is a local HTTP double of `GET /internal/v1/identity/session`
 * (Identity V1 contract shape). It is the only substitute in this suite and is
 * declared as such in the evidence; token verification is Identity's own
 * tested responsibility. Service callers use the real interim digest
 * credentials (x-service-client / x-service-token).
 */
const CAPACITY_TOKEN = 'c'.repeat(48);
const ELIGIBILITY_TOKEN = 'e'.repeat(48);
const TECH_A = randomUUID();
const TECH_B = randomUUID();
const STRANGER = randomUUID();
const SESSIONS: Record<string, { subject: string; permissions: string[] } | 'DOWN'> = {
  'operations-token-0001': { subject: randomUUID(), permissions: ['operations.dispatch'] },
  'technician-a-token-01': {
    subject: TECH_A,
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  'technician-b-token-01': {
    subject: TECH_B,
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  'technician-ro-token01': { subject: TECH_A, permissions: ['work.read:assigned'] },
  'stranger-token-00001': {
    subject: STRANGER,
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  'customer-token-000001': {
    subject: randomUUID(),
    permissions: ['bookings.create:self', 'bookings.read:self'],
  },
  'identity-down-token-1': 'DOWN',
};

let identity: Server;
let app: INestApplication;
let base: string;
let seed: Replica;
const clock = new TestClock();
const zone = randomUUID();
const dayStart = new Date(Math.floor(Date.now() / DAY) * DAY + 6 * DAY);
const from = new Date(dayStart.getTime() + 8 * HOUR).toISOString();
const to = new Date(dayStart.getTime() + 16 * HOUR).toISOString();

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

before(async () => {
  identity = createServer((req, res) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const session = SESSIONS[token];
    if (req.url !== '/internal/v1/identity/session' || session === undefined) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{}');
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
  process.env.DATABASE_URL = workforceAppUrl();
  process.env.IDENTITY_URL = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;
  process.env.WORKFORCE_USER_REQUESTS_PER_MINUTE = '600';
  process.env.WORKFORCE_SERVICE_CLIENTS = JSON.stringify([
    { id: 'scheduling', tokenSha256: digest(CAPACITY_TOKEN), scopes: ['workforce.capacity.read'] },
    {
      id: 'booking',
      tokenSha256: digest(ELIGIBILITY_TOKEN),
      scopes: ['workforce.eligibility.read'],
    },
  ]);
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/internal/v1/workforce`;
  seed = replica(clock);
  for (const subject of [TECH_A, TECH_B]) {
    await seedOperator(seed, clock, {
      subject,
      shifts: [shift(zone, new Date(dayStart.getTime() + 9 * HOUR), 4)],
    });
  }
  await seedOperator(seed, clock, {
    shifts: [shift(zone, new Date(dayStart.getTime() + 10 * HOUR), 4)],
  });
});

after(async () => {
  await app.close();
  await seed.prisma.client.$disconnect();
  await new Promise<void>((resolve) => identity.close(() => resolve()));
});

const user = (token: string) => ({ authorization: `Bearer ${token}` });
const capacity = { 'x-service-client': 'scheduling', 'x-service-token': CAPACITY_TOKEN };
const eligibilityOnly = { 'x-service-client': 'booking', 'x-service-token': ELIGIBILITY_TOKEN };

interface ApiError {
  readonly code: string;
  readonly reason: string | null;
  readonly message: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly issues: readonly unknown[];
}

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown> & { readonly error?: ApiError };
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Reply> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Reply['body']) : {},
  };
}

function capacityPath(params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ zoneId: zone, from, to, ...params });
  return `/capacity-resources?${query.toString()}`;
}

function assertEnvelope(reply: Reply, status: number, code: string, reason: string | null = null) {
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  const error = reply.body.error;
  assert.ok(error, 'error envelope');
  assert.equal(error.code, code);
  assert.equal(error.reason, reason);
  assert.deepEqual(Object.keys(error).sort(), [
    'code',
    'correlationId',
    'issues',
    'message',
    'reason',
    'requestId',
    'retryAfterMs',
    'retryable',
  ]);
}

test('authentication: none, ambiguous, invalid, forged and Identity outage fail closed', async () => {
  assertEnvelope(await call('GET', capacityPath(), {}), 401, 'AUTH_REQUIRED');
  assertEnvelope(await call('GET', '/me/availability', {}), 401, 'AUTH_REQUIRED');
  assertEnvelope(
    await call('GET', capacityPath(), { ...capacity, ...user('technician-a-token-01') }),
    401,
    'AUTH_REQUIRED',
  );
  assertEnvelope(
    await call('GET', '/me/availability', user('unknown-token-000001')),
    401,
    'AUTH_REQUIRED',
  );
  assertEnvelope(
    await call('GET', capacityPath(), { ...capacity, 'x-service-token': 'f'.repeat(48) }),
    401,
    'AUTH_REQUIRED',
  );
  const down = await call('GET', '/me/availability', user('identity-down-token-1'));
  assertEnvelope(down, 503, 'DEPENDENCY_UNAVAILABLE', 'IDENTITY_UNAVAILABLE');
  assert.equal(down.body.error?.retryable, true);
});

test('capacity-resources: deny by default; only workforce.capacity.read is admitted', async () => {
  for (const headers of [
    user('operations-token-0001'),
    user('technician-a-token-01'),
    user('customer-token-000001'),
    eligibilityOnly,
  ]) {
    assertEnvelope(await call('GET', capacityPath(), headers), 403, 'AUTH_FORBIDDEN');
  }
  // Denied before the query is read: a malformed query from a denied caller is still 403.
  assertEnvelope(
    await call('GET', '/capacity-resources?zoneId=nope', eligibilityOnly),
    403,
    'AUTH_FORBIDDEN',
  );
  const ok = await call('GET', capacityPath(), capacity);
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.body).sort(), ['asOf', 'items', 'nextCursor']);
  const items = ok.body.items;
  assert.ok(Array.isArray(items));
  assert.equal(items.length, 3);
});

test('capacity-resources: malformed queries are 400 in the shared envelope', async () => {
  const bad = [
    `/capacity-resources?from=${from}&to=${to}`,
    capacityPath({ zoneId: 'not-a-uuid' }),
    capacityPath({ from: '2026-10-10T08:00:00Z' }),
    capacityPath({ to: from }),
    capacityPath({ limit: '0' }),
    capacityPath({ limit: '101' }),
    capacityPath({ limit: 'ten' }),
    capacityPath({ cursor: 'has space' }),
    capacityPath({ unexpected: '1' }),
    `${capacityPath()}&zoneId=${zone}`,
  ];
  for (const path of bad) {
    assertEnvelope(await call('GET', path, capacity), 400, 'REQUEST_INVALID');
  }
  assertEnvelope(
    await call('GET', capacityPath({ cursor: 'AAAA' }), capacity),
    400,
    'REQUEST_INVALID',
    'INVALID_CURSOR',
  );
});

test('capacity-resources: paging over HTTP returns every resource exactly once', async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const reply: Reply = await call(
      'GET',
      capacityPath({ limit: '1', ...(cursor === null ? {} : { cursor }) }),
      capacity,
    );
    assert.equal(reply.status, 200);
    const items = reply.body.items as Array<{ resourceId: string }>;
    seen.push(...items.map((item) => item.resourceId));
    const next = reply.body.nextCursor;
    cursor = typeof next === 'string' ? next : null;
  } while (cursor !== null);
  assert.equal(seen.length, 3);
  assert.equal(new Set(seen).size, 3);
});

test('availability: user permissions, never a service; unknown subject is 404', async () => {
  assertEnvelope(await call('GET', '/me/availability', capacity), 403, 'AUTH_FORBIDDEN');
  assertEnvelope(
    await call('PUT', '/me/availability', capacity, { status: 'AVAILABLE', expectedRevision: 0 }),
    403,
    'AUTH_FORBIDDEN',
  );
  assertEnvelope(
    await call('GET', '/me/availability', user('operations-token-0001')),
    403,
    'AUTH_FORBIDDEN',
  );
  assertEnvelope(
    await call('PUT', '/me/availability', user('technician-ro-token01'), {
      status: 'AVAILABLE',
      expectedRevision: 0,
    }),
    403,
    'AUTH_FORBIDDEN',
  );
  assertEnvelope(
    await call('GET', '/me/availability', user('stranger-token-00001')),
    404,
    'NOT_FOUND',
    'OPERATOR_NOT_FOUND',
  );
  assertEnvelope(
    await call('PUT', '/me/availability', user('stranger-token-00001'), {
      status: 'AVAILABLE',
      expectedRevision: 0,
    }),
    404,
    'NOT_FOUND',
    'OPERATOR_NOT_FOUND',
  );
});

test('availability: self-only view {status, revision, updatedAt}, 409 on stale, closed body', async () => {
  const a = user('technician-a-token-01');
  const b = user('technician-b-token-01');
  const initial = await call('GET', '/me/availability', a);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, { status: 'ON_BREAK', revision: 0, updatedAt: null });

  const set = await call('PUT', '/me/availability', a, {
    status: 'AVAILABLE',
    expectedRevision: 0,
  });
  assert.equal(set.status, 200);
  assert.deepEqual(Object.keys(set.body).sort(), ['revision', 'status', 'updatedAt']);
  assert.equal(set.body.status, 'AVAILABLE');
  assert.equal(set.body.revision, 1);
  assert.match(String(set.body.updatedAt), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  // B's view is B's own; A's change is invisible to B and B cannot address A.
  assert.deepEqual((await call('GET', '/me/availability', b)).body, {
    status: 'ON_BREAK',
    revision: 0,
    updatedAt: null,
  });
  assert.deepEqual((await call('GET', '/me/availability', a)).body, set.body);

  assertEnvelope(
    await call('PUT', '/me/availability', a, { status: 'ON_BREAK', expectedRevision: 0 }),
    409,
    'CONFLICT',
    'REVISION_CONFLICT',
  );
  const noop = await call('PUT', '/me/availability', a, {
    status: 'AVAILABLE',
    expectedRevision: 1,
  });
  assert.equal(noop.status, 200);
  assert.deepEqual(noop.body, set.body);

  for (const body of [
    { status: 'AVAILABLE' },
    { status: 'AVAILABLE', expectedRevision: 1, operatorId: randomUUID() },
    { status: 'BUSY', expectedRevision: 1 },
    { status: 'AVAILABLE', expectedRevision: '1' },
    '[]',
    '{not json',
  ]) {
    assertEnvelope(await call('PUT', '/me/availability', a, body), 400, 'REQUEST_INVALID');
  }
});
