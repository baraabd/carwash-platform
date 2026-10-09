import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createHttpApplication } from '../../src/transport/http/create-app';
import { bookingEnv, startOwnerDoubles, type OwnerDoubles } from '../support/owner-doubles';
import { laneContext } from './support';

/**
 * Real Nest HTTP server of Booking on the real lane PostgreSQL, calling the
 * owners through the REAL HTTP adapters. Identity and the owners are one local
 * HTTP double speaking their published shapes (declared in the evidence).
 */
let doubles: OwnerDoubles;
let app: INestApplication;
let base = '';

const CUSTOMER = 'customer-token-000001';
const OTHER = 'customer-token-000002';
const GUEST = 'guest-token-0000000001';
const OPS = 'operations-token-0001';
const TECH = 'technician-token-0001';
const LIMITED = 'limited-token-0000001';
const ids = {
  customer: randomUUID(),
  other: randomUUID(),
  guest: randomUUID(),
  ops: randomUUID(),
  limited: randomUUID(),
};

before(async () => {
  doubles = await startOwnerDoubles();
  const self = ['bookings.create:self', 'bookings.read:self'];
  doubles.sessions.set(CUSTOMER, {
    subject: ids.customer,
    principalKind: 'account',
    permissions: self,
  });
  doubles.sessions.set(OTHER, { subject: ids.other, principalKind: 'account', permissions: self });
  doubles.sessions.set(GUEST, { subject: ids.guest, principalKind: 'guest', permissions: self });
  doubles.sessions.set(OPS, {
    subject: ids.ops,
    principalKind: 'account',
    permissions: ['operations.dispatch'],
  });
  doubles.sessions.set(TECH, {
    subject: randomUUID(),
    principalKind: 'account',
    permissions: ['work.read:assigned'],
  });
  doubles.sessions.set(LIMITED, {
    subject: ids.limited,
    principalKind: 'account',
    permissions: self,
  });
  doubles.sessions.set('identity-down-token-01', 'DOWN');
  Object.assign(process.env, bookingEnv(doubles, laneContext().databases.booking!.appUrl), {
    BOOKING_USER_REQUESTS_PER_MINUTE: '25',
    BOOKING_OWNER_TIMEOUT_MS: '1500',
  });
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

after(async () => {
  await app.close();
  await doubles.close();
});

function body(owner: { kind: 'account' | 'guest'; subjectId: string }) {
  const issued = doubles.issue(owner);
  return {
    quote: { quoteId: issued.quoteId, revision: 1 },
    hold: { holdId: issued.holdId, revision: 1 },
    vehicle: {
      source: 'inline',
      inline: { type: 'sedan', make: 'Kia', model: null, color: null, plate: null },
    },
    address: { addressId: randomUUID(), revision: 1 },
    contact: { name: 'سارة أحمد', phone: '0912345678', notes: 'البوابة الخلفية' },
    paymentMethod: 'SHAM_CASH',
  };
}

/** The response fields these tests read (booking view or error envelope). */
interface BookingResponse {
  readonly bookingId?: string;
  readonly status?: string;
  readonly confirmation?: string;
  readonly slot?: { readonly committed: boolean };
  readonly total?: unknown;
  readonly vehicle?: { readonly source: string; readonly plate: unknown };
  readonly beneficiary?: unknown;
  readonly error?: {
    readonly code: string;
    readonly reason: string | null;
    readonly retryable: boolean;
  };
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  options: { token?: string; key?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers,
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.key) headers['idempotency-key'] = options.key;
  const res = await fetch(`${base}/internal/v1/booking${path}`, {
    method,
    headers,
    ...(options.body !== undefined
      ? { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) }
      : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    json: (text ? JSON.parse(text) : {}) as BookingResponse,
  };
}

const key = () => `http-${randomUUID()}`;
const customer = { kind: 'account' as const, subjectId: '' };

test('create: 201 CONFIRMED end to end through the real adapters; replay 200; conflict 409', async () => {
  const who = { ...customer, subjectId: ids.customer };
  const b = body(who);
  const k = key();
  const correlationId = randomUUID();
  const created = await call('POST', '/bookings', {
    token: CUSTOMER,
    key: k,
    body: b,
    headers: { 'x-correlation-id': correlationId },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.status, 'CONFIRMED');
  assert.equal(created.json.confirmation, 'CONFIRMED');
  assert.equal(created.json.slot?.committed, true);
  assert.deepEqual(created.json.total, { currency: 'SYP', amountMinor: '9000000', scale: 2 });
  assert.equal(created.json.vehicle?.source, 'inline');
  assert.equal(created.json.vehicle?.plate, null, 'the plate stays optional');
  assert.equal(doubles.commitsApplied >= 1, true);
  // Correlation id reached every owner call made for this request.
  const owned = doubles.requests
    .filter((r) => r.headers['x-correlation-id'] === correlationId)
    .map((r) => r.path);
  for (const fragment of [
    '/pricing/quotes/',
    '/scheduling/holds/',
    '/customer/address-snapshots/resolve',
    '/billing/obligations',
  ]) {
    assert.ok(
      owned.some((p) => p.includes(fragment)),
      `${fragment} not correlated: ${owned.join(',')}`,
    );
  }
  const replay = await call('POST', '/bookings', { token: CUSTOMER, key: k, body: b });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.bookingId, created.json.bookingId);
  const conflict = await call('POST', '/bookings', {
    token: CUSTOMER,
    key: k,
    body: { ...b, paymentMethod: 'CASH_ON_COMPLETION' },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error?.code, 'IDEMPOTENCY_CONFLICT');
});

test('read: owner 200, other customer 404 (not 403), operations 200, malformed id 404', async () => {
  const who = { ...customer, subjectId: ids.customer };
  const created = await call('POST', '/bookings', { token: CUSTOMER, key: key(), body: body(who) });
  const id = String(created.json.bookingId);
  assert.equal((await call('GET', `/bookings/${id}`, { token: CUSTOMER })).status, 200);
  const other = await call('GET', `/bookings/${id}`, { token: OTHER });
  assert.equal(other.status, 404);
  assert.equal(other.text.includes(id), false, 'the response does not echo the id');
  assert.equal((await call('GET', `/bookings/${id}`, { token: OPS })).status, 200);
  assert.equal((await call('GET', '/bookings/not-a-uuid', { token: CUSTOMER })).status, 404);
  assert.equal((await call('GET', `/bookings/${id}`, { token: TECH })).status, 403);
});

test('guest principal: books and reads its own booking; an account cannot read it', async () => {
  const who = { kind: 'guest' as const, subjectId: ids.guest };
  const created = await call('POST', '/bookings', { token: GUEST, key: key(), body: body(who) });
  assert.equal(created.status, 201, created.text);
  assert.deepEqual(created.json.beneficiary, who);
  assert.equal(
    (await call('GET', `/bookings/${created.json.bookingId}`, { token: GUEST })).status,
    200,
  );
  assert.equal(
    (await call('GET', `/bookings/${created.json.bookingId}`, { token: CUSTOMER })).status,
    404,
  );
});

test('authentication: deny by default; service credentials are not accepted; identity outage is 503', async () => {
  const anonymous = await call('POST', '/bookings', { key: key(), body: {} });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.json.error?.code, 'AUTH_REQUIRED');
  const svc = await call('POST', '/bookings', {
    key: key(),
    body: {},
    headers: { 'x-service-client': 'dispatch', 'x-service-token': 'y'.repeat(40) },
  });
  assert.equal(svc.status, 401);
  const down = await call('POST', '/bookings', {
    token: 'identity-down-token-01',
    key: key(),
    body: {},
  });
  assert.equal(down.status, 503);
  assert.equal(down.json.error?.retryable, true);
  const tech = await call('POST', '/bookings', {
    token: TECH,
    key: key(),
    body: body({ ...customer, subjectId: ids.customer }),
  });
  assert.equal(tech.status, 403);
});

test('validation: missing key 428, unknown field 400, foreign hold 422 — envelope shape, nothing reflected', async () => {
  const who = { ...customer, subjectId: ids.customer };
  const missing = await call('POST', '/bookings', { token: CUSTOMER, body: body(who) });
  assert.equal(missing.status, 428);
  assert.equal(missing.json.error?.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const extra = await call('POST', '/bookings', {
    token: CUSTOMER,
    key: key(),
    body: { ...body(who), price: { amountMinor: '1' } },
  });
  assert.equal(extra.status, 400);
  assert.deepEqual(Object.keys(extra.json.error ?? {}).sort(), [
    'code',
    'correlationId',
    'issues',
    'message',
    'reason',
    'requestId',
    'retryAfterMs',
    'retryable',
  ]);
  assert.equal(extra.text.includes('price'), false);
  const malformed = await call('POST', '/bookings', {
    token: CUSTOMER,
    key: key(),
    body: '{"quote":',
  });
  assert.equal(malformed.status, 400);
  // Another customer's hold: the owner answers 404 to the on-behalf read.
  const foreignHold = body({ ...customer, subjectId: ids.other }).hold;
  const refused = await call('POST', '/bookings', {
    token: CUSTOMER,
    key: key(),
    body: { ...body(who), hold: foreignHold },
  });
  assert.equal(refused.status, 422);
  assert.equal(refused.json.error?.code, 'BUSINESS_RULE_VIOLATION');
  assert.equal(refused.json.error?.reason, 'HOLD_NOT_FOUND');
});

test('owner outage at capture: 503 retryable, nothing persisted, the same key succeeds later', async () => {
  const who = { ...customer, subjectId: ids.customer };
  const b = body(who);
  const k = key();
  doubles.failNext.set('pricing', { status: 503, times: 1 });
  const first = await call('POST', '/bookings', { token: CUSTOMER, key: k, body: b });
  assert.equal(first.status, 503);
  assert.equal(first.json.error?.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(first.json.error?.retryable, true);
  const second = await call('POST', '/bookings', { token: CUSTOMER, key: k, body: b });
  assert.equal(second.status, 201, second.text);
  assert.equal(second.json.status, 'CONFIRMED');
});

test('rate limit: a single principal is throttled with 429 and the envelope', async () => {
  let last = 0;
  for (let i = 0; i < 30; i += 1) {
    const res = await call('GET', `/bookings/${randomUUID()}`, { token: LIMITED });
    last = res.status;
    if (res.status === 429) {
      assert.equal(res.json.error?.code, 'RATE_LIMITED');
      break;
    }
  }
  assert.equal(last, 429);
});
