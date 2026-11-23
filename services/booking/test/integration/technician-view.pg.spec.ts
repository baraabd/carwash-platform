import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { createHttpApplication } from '../../src/transport/http/create-app';
import { bookingEnv, startOwnerDoubles, type OwnerDoubles } from '../support/owner-doubles';
import { laneContext } from './support';

/**
 * Technician view (P03-C3) through the real Nest HTTP server of Booking on the
 * real lane PostgreSQL (runtime role). Bookings are created through Booking's
 * own POST /bookings path (real saga, real store). Identity and the owners are
 * the shared HTTP double; Dispatch is a local HTTP double of
 * `GET /internal/v1/dispatch/bookings/:id/assignment` that checks the service
 * credential (declared as doubles in the evidence).
 */
type Answer =
  | { status: 'UNASSIGNED' | 'OFFERED' | 'ASSIGNED' | 'CANCELLED'; tech: string | null }
  | 'DOWN'
  | 'MALFORMED';

let doubles: OwnerDoubles;
let dispatch: Server;
let app: INestApplication;
let prisma: PrismaService;
let base = '';
const answers = new Map<string, Answer>();
const dispatchCalls: { bookingId: string; correlationId: string | undefined; client: unknown }[] =
  [];
const DISPATCH_TOKEN = 'z'.repeat(44);

const CUSTOMER = 'tv-customer-token-0001';
const TECH_A = 'tv-technician-token-a01';
const TECH_B = 'tv-technician-token-b01';
const OPS = 'tv-operations-token-001';
const ids = { customer: randomUUID(), a: randomUUID(), b: randomUUID(), ops: randomUUID() };

before(async () => {
  doubles = await startOwnerDoubles();
  doubles.sessions.set(CUSTOMER, {
    subject: ids.customer,
    principalKind: 'account',
    permissions: ['bookings.create:self', 'bookings.read:self'],
  });
  const tech = ['work.read:assigned', 'work.execute:assigned'];
  doubles.sessions.set(TECH_A, { subject: ids.a, principalKind: 'account', permissions: tech });
  doubles.sessions.set(TECH_B, { subject: ids.b, principalKind: 'account', permissions: tech });
  doubles.sessions.set(OPS, {
    subject: ids.ops,
    principalKind: 'account',
    permissions: ['operations.dispatch'],
  });

  dispatch = createServer((req, res) => {
    const m = /^\/internal\/v1\/dispatch\/bookings\/([^/]+)\/assignment$/.exec(req.url ?? '');
    const bookingId = m?.[1] ?? '';
    dispatchCalls.push({
      bookingId,
      correlationId: req.headers['x-correlation-id'] as string | undefined,
      client: req.headers['x-service-client'],
    });
    const send = (status: number, body: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (
      req.headers['x-service-client'] !== 'booking' ||
      req.headers['x-service-token'] !== DISPATCH_TOKEN
    ) {
      return send(401, { error: { code: 'AUTH_REQUIRED' } });
    }
    const answer = answers.get(bookingId);
    if (answer === undefined) return send(404, { error: { code: 'NOT_FOUND' } });
    if (answer === 'DOWN') return send(503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } });
    if (answer === 'MALFORMED') return send(200, { bookingId, status: 'ASSIGNED' });
    return send(200, {
      assignmentId: randomUUID(),
      revision: 2,
      bookingId,
      status: answer.status,
      technicianSubjectId: answer.tech,
      resourceId: answer.tech === null ? null : randomUUID(),
      offer: null,
    });
  });
  await new Promise<void>((resolve) => dispatch.listen(0, '127.0.0.1', resolve));

  const databaseUrl = laneContext().databases.booking!.appUrl;
  prisma = new PrismaService(databaseUrl);
  Object.assign(process.env, bookingEnv(doubles, databaseUrl), {
    BOOKING_USER_REQUESTS_PER_MINUTE: '200',
    BOOKING_OWNER_TIMEOUT_MS: '1500',
    BOOKING_DISPATCH_URL: `http://127.0.0.1:${(dispatch.address() as AddressInfo).port}`,
    BOOKING_DISPATCH_CLIENT_ID: 'booking',
    BOOKING_DISPATCH_CLIENT_TOKEN: DISPATCH_TOKEN,
    BOOKING_DISPATCH_TIMEOUT_MS: '400',
  });
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

after(async () => {
  await app.close();
  await prisma.client.$disconnect();
  await doubles.close();
  dispatch.closeAllConnections();
  await new Promise<void>((resolve) => dispatch.close(() => resolve()));
});

interface Reply {
  readonly status: number;
  readonly text: string;
  readonly json: Record<string, unknown> & {
    error?: { code: string; reason: string | null; correlationId: string };
  };
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers,
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (method === 'POST') headers['idempotency-key'] = `tv-${randomUUID()}`;
  const res = await fetch(`${base}/internal/v1/booking${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : {} };
}

/** Creates a CONFIRMED booking through Booking's own API (real saga, real store). */
async function confirmedBooking(): Promise<string> {
  const issued = doubles.issue({ kind: 'account', subjectId: ids.customer });
  const created = await call('POST', '/bookings', {
    token: CUSTOMER,
    body: {
      quote: { quoteId: issued.quoteId, revision: 1 },
      hold: { holdId: issued.holdId, revision: 1 },
      vehicle: {
        source: 'inline',
        inline: { type: 'sedan', make: 'Kia', model: 'Sportage', color: null, plate: null },
      },
      address: { addressId: randomUUID(), revision: 1 },
      contact: { name: 'سارة أحمد', phone: '0912345678', notes: 'البوابة الخلفية' },
      paymentMethod: 'SHAM_CASH',
    },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.status, 'CONFIRMED');
  return String(created.json.bookingId);
}

const view = (bookingId: string, token?: string, headers?: Record<string, string>) =>
  call('GET', `/bookings/${bookingId}/technician-view`, {
    ...(token ? { token } : {}),
    ...(headers ? { headers } : {}),
  });

async function audits(bookingId: string) {
  return prisma.client.$queryRawUnsafe<
    { actor_kind: string; actor_id: string; correlation_id: string; details: unknown }[]
  >(
    `SELECT actor_kind, actor_id, correlation_id::text, details
       FROM app.audit_entry
      WHERE target_id = $1::uuid AND action = 'booking.technician-view.read'
      ORDER BY occurred_at`,
    bookingId,
  );
}

test('assigned technician: 200 with the exact purpose-limited view, audited in the same request', async () => {
  const bookingId = await confirmedBooking();
  answers.set(bookingId, { status: 'ASSIGNED', tech: ids.a });
  const correlationId = randomUUID();
  const ok = await view(bookingId, TECH_A, { 'x-correlation-id': correlationId });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(Object.keys(ok.json).sort(), [
    'address',
    'bookingId',
    'contact',
    'lines',
    'paymentMethod',
    'revision',
    'slot',
    'status',
    'total',
    'vehicle',
  ]);
  assert.equal(ok.json.bookingId, bookingId);
  assert.equal(ok.json.status, 'CONFIRMED');
  assert.equal(ok.json.paymentMethod, 'SHAM_CASH');
  assert.deepEqual(ok.json.total, { currency: 'SYP', amountMinor: '9000000', scale: 2 });
  assert.deepEqual(ok.json.vehicle, {
    type: 'sedan',
    make: 'Kia',
    model: 'Sportage',
    color: null,
    plate: null,
  });
  assert.deepEqual(ok.json.contact, {
    name: 'سارة أحمد',
    phone: '+963912345678',
    notes: 'البوابة الخلفية',
  });
  assert.equal(ok.text.includes(ids.customer), false, 'no customer subject id');
  for (const internal of [
    'priceBookRevision',
    'catalogRevision',
    'beneficiary',
    'quoteId',
    'holdId',
  ]) {
    assert.equal(ok.text.includes(internal), false, `${internal} is not exposed`);
  }
  // Dispatch was asked with the request's correlation id and Booking's service identity.
  const call = dispatchCalls.find((c) => c.bookingId === bookingId);
  assert.equal(call?.correlationId, correlationId);
  assert.equal(call?.client, 'booking');
  // The audit row exists as soon as the response is received.
  const rows = await audits(bookingId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.actor_kind, 'USER');
  assert.equal(rows[0]?.actor_id, ids.a);
  assert.equal(rows[0]?.correlation_id, correlationId);
  const serialized = JSON.stringify(rows);
  for (const personal of ['سارة', '+963912345678', ids.customer]) {
    assert.equal(serialized.includes(personal), false, 'audit rows carry opaque ids only');
  }
});

test('404 for another technician, OFFERED, UNASSIGNED, CANCELLED, no job, unknown id; nothing audited', async () => {
  const bookingId = await confirmedBooking();
  const cases: [string, Answer | undefined, string][] = [
    ['other technician', { status: 'ASSIGNED', tech: ids.a }, TECH_B],
    ['offered only', { status: 'OFFERED', tech: ids.a }, TECH_A],
    ['unassigned', { status: 'UNASSIGNED', tech: null }, TECH_A],
    ['cancelled', { status: 'CANCELLED', tech: null }, TECH_A],
    ['no dispatch job', undefined, TECH_A],
  ];
  const bodies = new Set<string>();
  for (const [name, answer, token] of cases) {
    if (answer === undefined) answers.delete(bookingId);
    else answers.set(bookingId, answer);
    const denied = await view(bookingId, token);
    assert.equal(denied.status, 404, `${name}: ${denied.text}`);
    assert.equal(denied.json.error?.code, 'NOT_FOUND');
    assert.equal(denied.json.error?.reason, 'BOOKING_NOT_FOUND');
    assert.equal(denied.text.includes(bookingId), false, 'the id is not echoed');
    const shape = Object.entries(denied.json.error ?? {}).filter(
      ([field]) => field !== 'requestId' && field !== 'correlationId',
    );
    bodies.add(JSON.stringify(shape));
  }
  assert.equal(bodies.size, 1, 'every denial looks the same');
  // A booking that does not exist, even if Dispatch claims an assignment.
  const ghost = randomUUID();
  answers.set(ghost, { status: 'ASSIGNED', tech: ids.a });
  assert.equal((await view(ghost, TECH_A)).status, 404);
  assert.equal((await view('not-a-uuid', TECH_A)).status, 404);
  assert.equal((await audits(bookingId)).length, 0);
});

test('a REJECTED booking is 404 even for the technician Dispatch names', async () => {
  doubles.failNext.set('billing', { status: 422, times: 1 });
  const issued = doubles.issue({ kind: 'account', subjectId: ids.customer });
  const created = await call('POST', '/bookings', {
    token: CUSTOMER,
    body: {
      quote: { quoteId: issued.quoteId, revision: 1 },
      hold: { holdId: issued.holdId, revision: 1 },
      vehicle: {
        source: 'inline',
        inline: { type: 'sedan', make: null, model: null, color: null, plate: null },
      },
      address: { addressId: randomUUID(), revision: 1 },
      contact: { name: 'سارة أحمد', phone: '0912345678', notes: null },
      paymentMethod: 'CASH_ON_COMPLETION',
    },
  });
  assert.equal(created.json.status, 'REJECTED', created.text);
  const bookingId = String(created.json.bookingId);
  answers.set(bookingId, { status: 'ASSIGNED', tech: ids.a });
  assert.equal((await view(bookingId, TECH_A)).status, 404);
  assert.equal((await audits(bookingId)).length, 0);
});

test('Dispatch unavailable or malformed: 503 ASSIGNMENT_UNVERIFIED, never 200, nothing audited', async () => {
  const bookingId = await confirmedBooking();
  for (const answer of ['DOWN', 'MALFORMED'] as const) {
    answers.set(bookingId, answer);
    const unverified = await view(bookingId, TECH_A);
    assert.equal(unverified.status, 503, unverified.text);
    assert.equal(unverified.json.error?.code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(unverified.json.error?.reason, 'ASSIGNMENT_UNVERIFIED');
  }
  // The same answer for an id that does not exist: a 503 reveals nothing.
  const ghost = randomUUID();
  answers.set(ghost, 'DOWN');
  assert.equal((await view(ghost, TECH_A)).status, 503);
  assert.equal((await audits(bookingId)).length, 0);
  // Recovery is immediate: no negative or positive result was cached.
  answers.set(bookingId, { status: 'ASSIGNED', tech: ids.a });
  assert.equal((await view(bookingId, TECH_A)).status, 200);
});

test('401 without credentials, 403 for customers and operations; Dispatch is not asked', async () => {
  const bookingId = await confirmedBooking();
  answers.set(bookingId, { status: 'ASSIGNED', tech: ids.a });
  const before = dispatchCalls.length;
  assert.equal((await view(bookingId)).status, 401);
  assert.equal((await view(bookingId, 'unknown-token-000000001')).status, 401);
  const service = await view(bookingId, undefined, {
    'x-service-client': 'dispatch',
    'x-service-token': 'y'.repeat(40),
  });
  assert.equal(service.status, 401, 'service credentials are refused on Booking');
  const customer = await view(bookingId, CUSTOMER);
  assert.equal(customer.status, 403);
  assert.equal(customer.json.error?.code, 'AUTH_FORBIDDEN');
  assert.equal((await view(bookingId, OPS)).status, 403);
  assert.equal(dispatchCalls.length, before);
});
