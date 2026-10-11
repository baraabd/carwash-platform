import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { createHttpApplication } from '../../src/transport/http/create-app';
import {
  DISPATCH_CLIENT,
  DISPATCH_CLIENT_TOKEN,
  workforceDouble,
  type Double,
  type ResourceSetting,
} from './http-doubles';
import { TestClock, laneContext, openJob, replica, type Replica } from './support';

/**
 * Real Nest HTTP server on the real lane PostgreSQL.
 *
 * Identity is a local HTTP double of `GET /internal/v1/identity/session`
 * (Identity V1 contract shape). It is the only substitute in this suite and it
 * is declared as such in the evidence; token verification itself is Identity's
 * own tested responsibility. Workforce eligibility comes from an HTTP double
 * of the PUBLISHED workforce.v1 capacity-resources route (./http-doubles).
 */
const SERVICE_TOKEN = 's'.repeat(48);
const CHANGE_TOKEN = 'c'.repeat(48);
const TECH_A = randomUUID();
const TECH_B = randomUUID();
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
  'customer-token-000001': {
    subject: randomUUID(),
    permissions: ['bookings.create:self', 'bookings.read:self'],
  },
  'limited-token-000001': { subject: randomUUID(), permissions: ['operations.dispatch'] },
  'identity-down-token-1': 'DOWN',
};

let identity: Server;
let workforce: Double;
const RESOURCES = new Map<string, ResourceSetting>();

/** A resource the Workforce double lists as ELIGIBLE for any job window. */
function eligible(): string {
  const id = randomUUID();
  RESOURCES.set(id, { eligibility: 'ELIGIBLE', eligibilityRevision: 1 });
  return id;
}
let app: INestApplication;
let base: string;
let seed: Replica;
const clock = new TestClock();

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
  process.env.DATABASE_URL = laneContext().databases.dispatch!.appUrl;
  process.env.IDENTITY_URL = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;
  workforce = await workforceDouble(RESOURCES);
  process.env.DISPATCH_WORKFORCE_URL = workforce.url;
  process.env.DISPATCH_WORKFORCE_CLIENT_ID = DISPATCH_CLIENT;
  process.env.DISPATCH_WORKFORCE_CLIENT_TOKEN = DISPATCH_CLIENT_TOKEN;
  process.env.DISPATCH_USER_REQUESTS_PER_MINUTE = '60';
  process.env.DISPATCH_SERVICE_CLIENTS = JSON.stringify([
    { id: 'booking', tokenSha256: digest(SERVICE_TOKEN), scopes: ['dispatch.assignment.read'] },
    {
      id: 'booking-saga',
      tokenSha256: digest(CHANGE_TOKEN),
      scopes: ['dispatch.assignment.read', 'dispatch.booking.change'],
    },
  ]);
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/internal/v1/dispatch`;
  seed = replica(clock);
});

after(async () => {
  await app.close();
  await seed.prisma.client.$disconnect();
  await new Promise<void>((resolve) => identity.close(() => resolve()));
  await workforce.close();
});

const user = (token: string) => ({ authorization: `Bearer ${token}` });
const OPS = user('operations-token-0001');
const booking = { 'x-service-client': 'booking', 'x-service-token': SERVICE_TOKEN };

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
  readonly headers: Headers;
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
    headers: response.headers,
    body: text ? (JSON.parse(text) as Reply['body']) : {},
  };
}

const idem = () => ({ 'idempotency-key': `http-${randomUUID()}` });

function offerBody(revision: number, technician = TECH_A) {
  return { expectedRevision: revision, resourceId: eligible(), technicianSubjectId: technician };
}

test('authentication: none, ambiguous, invalid and Identity outage fail closed', async () => {
  const id = randomUUID();
  const none = await call('GET', `/assignments/${id}`, {});
  assert.equal(none.status, 401);
  assert.equal(none.body.error?.code, 'AUTH_REQUIRED');
  const both = await call('GET', `/assignments/${id}`, { ...OPS, ...booking });
  assert.equal(both.status, 401);
  assert.equal((await call('GET', `/assignments/${id}`, user('unknown-token-000001'))).status, 401);
  const forged = await call('GET', `/assignments/${id}`, {
    'x-service-client': 'booking',
    'x-service-token': 'x'.repeat(48),
  });
  assert.equal(forged.status, 401);
  const down = await call('GET', `/assignments/${id}`, user('identity-down-token-1'));
  assert.equal(down.status, 503);
  assert.equal(down.body.error?.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(down.body.error?.retryable, true);
});

test('authorization: permissions decide, other technicians get 404, the service scope reads only', async () => {
  const { assignment } = await openJob(seed, clock);
  const customer = user('customer-token-000001');
  assert.equal((await call('GET', `/assignments/${assignment.id}`, customer)).status, 403);
  assert.equal(
    (
      await call(
        'POST',
        `/assignments/${assignment.id}/offers`,
        { ...customer, ...idem() },
        offerBody(1),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        'POST',
        `/assignments/${assignment.id}/offers`,
        { ...booking, ...idem() },
        offerBody(1),
      )
    ).status,
    403,
  );
  const offered = await call(
    'POST',
    `/assignments/${assignment.id}/offers`,
    { ...OPS, ...idem() },
    offerBody(1),
  );
  assert.equal(offered.status, 201);
  const offer = offered.body.offer as { offerId: string };

  const stranger = await call('POST', `/offers/${offer.offerId}/accept`, {
    ...user('technician-b-token-01'),
    ...idem(),
  });
  assert.equal(stranger.status, 404, 'another technician cannot even learn the offer exists');
  assert.equal(stranger.body.error?.reason, 'OFFER_NOT_FOUND');

  const viaService = await call('GET', `/bookings/${assignment.bookingId}/assignment`, booking);
  assert.equal(viaService.status, 200);
  assert.equal(viaService.body.status, 'OFFERED');
  assert.equal((await call('GET', `/assignments/${assignment.id}`, booking)).status, 403);

  const mine = await call('GET', '/me/offers', user('technician-a-token-01'));
  assert.equal(mine.status, 200);
  const items = mine.body.items as Array<{ offerId: string; job: Record<string, unknown> }>;
  const item = items.find((i) => i.offerId === offer.offerId);
  assert.ok(item);
  assert.deepEqual(Object.keys(item.job).sort(), [
    'assignmentId',
    'bookingId',
    'endsAt',
    'startsAt',
    'status',
    'zoneId',
  ]);
  const theirs = await call('GET', '/me/offers', user('technician-b-token-01'));
  assert.ok(
    !(theirs.body.items as Array<{ offerId: string }>).some((i) => i.offerId === offer.offerId),
  );

  const accepted = await call('POST', `/offers/${offer.offerId}/accept`, {
    ...user('technician-a-token-01'),
    ...idem(),
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, 'ACCEPTED');
  assert.equal((accepted.body.job as { status: string }).status, 'ASSIGNED');
});

test('idempotency at the edge: header required, replay 200 with the same offer, misuse 409', async () => {
  const { assignment } = await openJob(seed, clock);
  const path = `/assignments/${assignment.id}/offers`;
  const missing = await call('POST', path, OPS, offerBody(1));
  assert.equal(missing.status, 428);
  assert.equal(missing.body.error?.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const headers = { ...OPS, ...idem() };
  const body = offerBody(1);
  const first = await call('POST', path, headers, body);
  const replay = await call('POST', path, headers, body);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.offer, first.body.offer);
  const misuse = await call('POST', path, headers, { ...body, resourceId: eligible() });
  assert.equal(misuse.status, 409);
  assert.equal(misuse.body.error?.code, 'IDEMPOTENCY_CONFLICT');
  const stale = await call(
    'POST',
    `/assignments/${assignment.id}/unassign`,
    { ...OPS, ...idem() },
    {
      expectedRevision: 1,
    },
  );
  assert.equal(stale.status, 412);
  assert.equal(stale.body.error?.code, 'REVISION_CONFLICT');
  const live = await call('POST', path, { ...OPS, ...idem() }, offerBody(2));
  assert.equal(live.status, 409);
  assert.equal(live.body.error?.reason, 'LIVE_OFFER_EXISTS');
});

test('strict input: closed bodies, UUIDs, UTC-only instants, unknown enums', async () => {
  const { assignment } = await openJob(seed, clock);
  const path = `/assignments/${assignment.id}/offers`;
  const cases: Array<[string, unknown]> = [
    ['extra field', { ...offerBody(1), price: 10 }],
    ['missing field', { expectedRevision: 1, resourceId: randomUUID() }],
    ['bad uuid', { ...offerBody(1), resourceId: 'abc' }],
    ['string revision', { ...offerBody(1), expectedRevision: '1' }],
    ['array body', [offerBody(1)]],
    ['ttl out of range', { ...offerBody(1), ttlSeconds: 10 }],
  ];
  for (const [label, body] of cases) {
    const reply = await call('POST', path, { ...OPS, ...idem() }, body);
    assert.equal(reply.status, 400, label);
    assert.equal(reply.body.error?.code, 'REQUEST_INVALID', label);
  }
  const malformed = await call('POST', path, { ...OPS, ...idem() }, '{"expectedRevision":');
  assert.equal(malformed.status, 400);
  const zone = randomUUID();
  const local = await call(
    'GET',
    `/assignments?zoneId=${zone}&from=2026-10-10T10:00:00%2B03:00&to=2026-10-11T00:00:00Z`,
    OPS,
  );
  assert.equal(local.status, 400, 'offset instants are refused, never guessed');
  const status = await call(
    'GET',
    `/assignments?zoneId=${zone}&from=2026-10-10T00:00:00Z&to=2026-10-11T00:00:00Z&status=DONE`,
    OPS,
  );
  assert.equal(status.status, 400);
  const decline = await call(
    'POST',
    `/offers/${randomUUID()}/decline`,
    { ...user('technician-a-token-01'), ...idem() },
    { reason: 'BORED' },
  );
  assert.equal(decline.status, 400);
  assert.equal((await call('GET', '/nowhere', OPS)).status, 404);
});

test('list by zone and window returns the jobs of that zone only', async () => {
  const { assignment, hold } = await openJob(seed, clock);
  const from = new Date(hold.startsAt.getTime() - 60_000).toISOString();
  const to = new Date(hold.startsAt.getTime() + 60_000).toISOString();
  const reply = await call('GET', `/assignments?zoneId=${hold.zoneId}&from=${from}&to=${to}`, OPS);
  assert.equal(reply.status, 200);
  assert.deepEqual(
    (reply.body.items as Array<{ assignmentId: string }>).map((i) => i.assignmentId),
    [assignment.id],
  );
});

test('error envelope never leaks internals and carries correlation and request ids', async () => {
  const correlationId = randomUUID();
  const reply = await call('GET', `/assignments/${randomUUID()}`, {
    ...OPS,
    'x-correlation-id': correlationId,
    'x-request-id': 'req-abc-123',
  });
  assert.equal(reply.status, 404);
  assert.deepEqual(Object.keys(reply.body.error ?? {}).sort(), [
    'code',
    'correlationId',
    'issues',
    'message',
    'reason',
    'requestId',
    'retryAfterMs',
    'retryable',
  ]);
  assert.equal(reply.body.error?.correlationId, correlationId);
  assert.equal(reply.body.error?.requestId, 'req-abc-123');
  assert.equal(reply.headers.get('x-correlation-id'), correlationId);
});

test('per-actor budget answers 429 with a retry hint; other actors are unaffected', async () => {
  const limited = user('limited-token-000001');
  let last: Reply | undefined;
  for (let i = 0; i < 70; i += 1) {
    last = await call('GET', `/assignments/${randomUUID()}`, limited);
    if (last.status === 429) break;
  }
  assert.equal(last?.status, 429);
  assert.equal(last?.body.error?.code, 'RATE_LIMITED');
  assert.ok((last?.body.error?.retryAfterMs ?? 0) > 0);
  assert.ok(Number(last?.headers.get('retry-after')) > 0);
  assert.equal((await call('GET', `/assignments/${randomUUID()}`, OPS)).status, 404);
});

test('booking changes at the edge (P04-C2): scope, strict bodies, replay, refusal envelope', async () => {
  const saga = { 'x-service-client': 'booking-saga', 'x-service-token': CHANGE_TOKEN };
  const { hold } = await openJob(seed, clock, 200 * 3_600_000);
  const path = `/bookings/${hold.bookingId}`;
  const slot = {
    holdId: randomUUID(),
    zoneId: hold.zoneId,
    startsAt: new Date(hold.startsAt.getTime() + 3_600_000).toISOString(),
    endsAt: new Date(hold.endsAt.getTime() + 3_600_000).toISOString(),
  };
  for (const who of [OPS, booking]) {
    const reply = await call(
      'POST',
      `${path}/cancellation`,
      { ...who, ...idem() },
      { changeId: randomUUID() },
    );
    assert.equal(reply.status, 403, JSON.stringify(reply.body));
  }
  assert.equal(
    (await call('POST', `${path}/cancellation`, saga, { changeId: randomUUID() })).status,
    428,
  );
  const extra = await call(
    'POST',
    `${path}/rebinding`,
    { ...saga, ...idem() },
    {
      changeId: randomUUID(),
      ...slot,
      note: 'x',
    },
  );
  assert.equal(extra.status, 400);
  const offset = await call(
    'POST',
    `${path}/rebinding`,
    { ...saga, ...idem() },
    {
      changeId: randomUUID(),
      ...slot,
      startsAt: '2026-10-20T10:00:00+03:00',
    },
  );
  assert.equal(offset.status, 400, 'local times are refused, never guessed');

  const changeId = randomUUID();
  const rebound = await call(
    'POST',
    `${path}/rebinding`,
    { ...saga, ...idem() },
    { changeId, ...slot },
  );
  assert.equal(rebound.status, 200, JSON.stringify(rebound.body));
  assert.deepEqual(Object.keys(rebound.body).sort(), [
    'assignmentRevision',
    'bookingId',
    'changeId',
    'outcome',
  ]);
  assert.equal(rebound.body.outcome, 'REBOUND');
  const replay = await call(
    'POST',
    `${path}/rebinding`,
    { ...saga, ...idem() },
    { changeId, ...slot },
  );
  assert.deepEqual(replay.body, rebound.body, 'a lost response replays by change id');
  const reverted = await call(
    'POST',
    `${path}/rebinding/revert`,
    { ...saga, ...idem() },
    { changeId },
  );
  assert.equal(reverted.body.outcome, 'REVERTED');
  const confirm = await call(
    'POST',
    `${path}/rebinding/confirm`,
    { ...saga, ...idem() },
    { changeId },
  );
  assert.equal(confirm.status, 409);
  assert.equal(confirm.body.error?.reason, 'CHANGE_REVERTED');

  const cancelled = await call(
    'POST',
    `${path}/cancellation`,
    { ...saga, ...idem() },
    { changeId: randomUUID() },
  );
  assert.equal(cancelled.body.outcome, 'CANCELLED');
  const late = await call(
    'POST',
    `${path}/rebinding`,
    { ...saga, ...idem() },
    {
      changeId: randomUUID(),
      ...slot,
    },
  );
  assert.equal(late.status, 422);
  assert.equal(late.body.error?.code, 'BUSINESS_RULE_VIOLATION');
  assert.equal(late.body.error?.reason, 'BOOKING_CANCELLED');
  assert.equal(late.body.error?.retryable, false);
  const notOpen = await call(
    'POST',
    `/bookings/${randomUUID()}/rebinding`,
    { ...saga, ...idem() },
    {
      changeId: randomUUID(),
      ...slot,
    },
  );
  assert.equal(notOpen.status, 409);
  assert.equal(notOpen.body.error?.reason, 'ASSIGNMENT_NOT_OPEN');
});
