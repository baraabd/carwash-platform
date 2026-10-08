import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { createHttpApplication } from '../../src/transport/http/create-app';
import { laneContext } from './support';

/**
 * scheduling.v1 over the real Nest HTTP server on the real lane PostgreSQL.
 *
 * Identity is a local HTTP double of `GET /internal/v1/identity/session`
 * (IdentitySessionView shape, incl. principalKind). It is the only substitute
 * in this suite and is declared as such in the evidence; token verification
 * itself is Identity's own tested responsibility.
 */
const SERVICE_TOKEN = 's'.repeat(48);
const NOSCOPE_TOKEN = 'n'.repeat(48);

interface Session {
  readonly subject: string;
  readonly principalKind: 'account' | 'guest';
  readonly permissions: string[];
}
const GUEST: Session = {
  subject: randomUUID(),
  principalKind: 'guest',
  permissions: ['bookings.create:self', 'bookings.read:self'],
};
const ACCOUNT: Session = {
  subject: randomUUID(),
  principalKind: 'account',
  permissions: ['bookings.create:self', 'bookings.read:self'],
};
const OPS: Session = {
  subject: randomUUID(),
  principalKind: 'account',
  permissions: ['operations.dispatch'],
};
const SESSIONS: Record<string, Session | 'DOWN'> = {
  'guest-token-00000001': GUEST,
  'account-token-0000001': ACCOUNT,
  'operations-token-0001': OPS,
  'identity-down-token-1': 'DOWN',
};

let identity: Server;
let app: INestApplication;
let base: string;

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
  process.env.DATABASE_URL = laneContext().databases.scheduling!.appUrl;
  process.env.IDENTITY_URL = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;
  process.env.SCHEDULING_USER_REQUESTS_PER_MINUTE = '60';
  process.env.SCHEDULING_PUBLIC_REQUESTS_PER_MINUTE = '30';
  process.env.SCHEDULING_SERVICE_CLIENTS = JSON.stringify([
    { id: 'booking', tokenSha256: digest(SERVICE_TOKEN), scopes: ['scheduling.hold.commit'] },
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
const guest = user('guest-token-00000001');
const account = user('account-token-0000001');
const ops = user('operations-token-0001');
const booking = { 'x-service-client': 'booking', 'x-service-token': SERVICE_TOKEN };
const idem = () => ({ 'idempotency-key': `http-${randomUUID()}` });

interface ErrorBody {
  readonly code: string;
  readonly reason: string | null;
  readonly correlationId: string;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly issues: readonly { field: string; code: string }[];
  readonly message: string;
}
interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown> & { readonly error?: ErrorBody };
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Reply> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

function expectError(reply: Reply, status: number, code: string, reason: string | null = null) {
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  assert.equal(reply.body.error?.code, code);
  assert.equal(reply.body.error?.reason, reason);
}

/** Opens a 2 h window three hours ahead in a fresh zone. */
async function newWindow(capacity = 2) {
  const zoneId = randomUUID();
  const startsAt = new Date(Date.now() + 3 * 3_600_000);
  startsAt.setUTCSeconds(0, 0);
  const res = await call('POST', '/windows', ops, {
    zoneId,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 2 * 3_600_000).toISOString(),
    capacity,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { zoneId, startsAt };
}

function holdBody(who: Session, zoneId: string, startsAt: Date) {
  return {
    beneficiary: { kind: who.principalKind, subjectId: who.subject },
    zoneId,
    startsAt: startsAt.toISOString(),
    durationMinutes: 45,
    quoteRef: { quoteId: randomUUID(), revision: 1 },
  };
}

test('deny by default: no, mixed, forged or unknown credentials are 401 in the published envelope', async () => {
  const id = randomUUID();
  expectError(await call('GET', `/holds/${id}`, {}), 401, 'AUTH_REQUIRED');
  expectError(await call('GET', `/holds/${id}`, { ...booking, ...guest }), 401, 'AUTH_REQUIRED');
  expectError(
    await call('GET', `/holds/${id}`, { ...booking, 'x-service-token': 'x'.repeat(48) }),
    401,
    'AUTH_REQUIRED',
  );
  expectError(await call('GET', `/holds/${id}`, { 'x-auth-subject': id }), 401, 'AUTH_REQUIRED');
  expectError(
    await call('GET', `/holds/${id}`, user('unknown-token-000001')),
    401,
    'AUTH_REQUIRED',
  );
  expectError(
    await call('POST', `/holds/${id}/commit`, {
      'x-service-client': 'dispatch',
      'x-service-token': NOSCOPE_TOKEN,
    }),
    401,
    'AUTH_REQUIRED',
  );
});

test('identity outage fails closed: 503 DEPENDENCY_UNAVAILABLE, retryable, never a guessed caller', async () => {
  const res = await call('GET', `/holds/${randomUUID()}`, user('identity-down-token-1'));
  expectError(res, 503, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(res.body.error?.retryable, true);
});

test('availability is public and strictly parsed', async () => {
  const { zoneId, startsAt } = await newWindow(2);
  const date = new Date(startsAt.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  const ok = await call(
    'GET',
    `/availability?zoneId=${zoneId}&date=${date}&durationMinutes=45`,
    {},
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.body.timezone, 'Asia/Damascus');
  assert.ok(Array.isArray(ok.body.slots));
  expectError(
    await call('GET', `/availability?zoneId=${zoneId}&date=${date}&durationMinutes=4`, {}),
    400,
    'REQUEST_INVALID',
  );
  expectError(
    await call('GET', `/availability?zoneId=${zoneId}&date=${date}&durationMinutes=45&x=1`, {}),
    400,
    'REQUEST_INVALID',
  );
  expectError(
    await call('GET', `/availability?zoneId=nope&date=${date}&durationMinutes=45`, {}),
    400,
    'REQUEST_INVALID',
  );
  const earliest = await call(
    'GET',
    `/availability/earliest?zoneId=${zoneId}&durationMinutes=45`,
    {},
  );
  assert.equal(earliest.status, 200);
  assert.ok(earliest.body.earliest !== null);
});

test('hold lifecycle: guest holds for itself, other principals get 404, Booking commits', async () => {
  const { zoneId, startsAt } = await newWindow(1);
  const body = holdBody(GUEST, zoneId, startsAt);
  expectError(await call('POST', '/holds', guest, body), 428, 'IDEMPOTENCY_KEY_REQUIRED');
  expectError(
    await call('POST', '/holds', { ...guest, ...idem() }, holdBody(ACCOUNT, zoneId, startsAt)),
    403,
    'AUTH_FORBIDDEN',
  );
  expectError(await call('POST', '/holds', { ...booking, ...idem() }, body), 403, 'AUTH_FORBIDDEN');
  const key = idem();
  const created = await call('POST', '/holds', { ...guest, ...key }, body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(Object.keys(created.body).sort(), [
    'beneficiary',
    'bookingId',
    'createdAt',
    'endsAt',
    'expiresAt',
    'holdId',
    'revision',
    'startsAt',
    'state',
    'updatedAt',
    'zoneId',
  ]);
  assert.equal(created.body.state, 'HELD');
  const replay = await call('POST', '/holds', { ...guest, ...key }, body);
  assert.deepEqual(replay, created, 'same key + body replays the stored response');
  expectError(
    await call('POST', '/holds', { ...guest, ...key }, { ...body, durationMinutes: 30 }),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
  expectError(
    await call('POST', '/holds', { ...account, ...idem() }, holdBody(ACCOUNT, zoneId, startsAt)),
    422,
    'BUSINESS_RULE_VIOLATION',
    'SLOT_UNAVAILABLE',
  );

  const holdId = String(created.body.holdId);
  assert.equal((await call('GET', `/holds/${holdId}`, guest)).status, 200);
  expectError(await call('GET', `/holds/${holdId}`, account), 404, 'NOT_FOUND');
  assert.equal((await call('GET', `/holds/${holdId}`, ops)).status, 200);

  const bookingId = randomUUID();
  expectError(
    await call(
      'POST',
      `/holds/${holdId}/commit`,
      { ...guest, ...idem() },
      { expectedRevision: 1, bookingId },
    ),
    403,
    'AUTH_FORBIDDEN',
  );
  expectError(
    await call(
      'POST',
      `/holds/${holdId}/commit`,
      { ...booking, ...idem() },
      { expectedRevision: 3, bookingId },
    ),
    412,
    'REVISION_CONFLICT',
  );
  expectError(
    await call('POST', `/holds/${holdId}/commit`, booking, { expectedRevision: 1, bookingId }),
    428,
    'IDEMPOTENCY_KEY_REQUIRED',
  );
  const committed = await call(
    'POST',
    `/holds/${holdId}/commit`,
    { ...booking, ...idem() },
    { expectedRevision: 1, bookingId },
  );
  assert.equal(committed.status, 200);
  assert.equal(committed.body.state, 'COMMITTED');
  assert.equal(committed.body.bookingId, bookingId);
  const again = await call(
    'POST',
    `/holds/${holdId}/commit`,
    { ...booking, ...idem() },
    { expectedRevision: 1, bookingId },
  );
  assert.deepEqual(again, committed, 'response loss: a new key for the same booking replays');
  expectError(
    await call(
      'POST',
      `/holds/${holdId}/commit`,
      { ...booking, ...idem() },
      { expectedRevision: 2, bookingId: randomUUID() },
    ),
    422,
    'BUSINESS_RULE_VIOLATION',
    'HOLD_NOT_ACTIVE',
  );
  expectError(
    await call(
      'POST',
      `/holds/${holdId}/release`,
      { ...guest, ...idem() },
      { expectedRevision: 2, reason: 'CUSTOMER_CHANGED' },
    ),
    422,
    'BUSINESS_RULE_VIOLATION',
    'HOLD_NOT_ACTIVE',
  );
});

test('release by the beneficiary frees the slot; reasons are the published ones only', async () => {
  const { zoneId, startsAt } = await newWindow(1);
  const created = await call(
    'POST',
    '/holds',
    { ...account, ...idem() },
    holdBody(ACCOUNT, zoneId, startsAt),
  );
  const holdId = String(created.body.holdId);
  expectError(
    await call(
      'POST',
      `/holds/${holdId}/release`,
      { ...account, ...idem() },
      { expectedRevision: 1, reason: 'OPERATIONS_OVERRIDE' },
    ),
    400,
    'REQUEST_INVALID',
  );
  expectError(
    await call(
      'POST',
      `/holds/${holdId}/release`,
      { ...guest, ...idem() },
      { expectedRevision: 1, reason: 'CUSTOMER_CHANGED' },
    ),
    404,
    'NOT_FOUND',
  );
  const released = await call(
    'POST',
    `/holds/${holdId}/release`,
    { ...account, ...idem() },
    { expectedRevision: 1, reason: 'CUSTOMER_CHANGED' },
  );
  assert.equal(released.status, 200);
  assert.equal(released.body.state, 'RELEASED');
  const next = await call(
    'POST',
    '/holds',
    { ...guest, ...idem() },
    holdBody(GUEST, zoneId, startsAt),
  );
  assert.equal(next.status, 201, 'the freed unit is holdable again');
});

test('staff surface: windows by operations only; malformed bodies are 400 without echo', async () => {
  const body = {
    zoneId: randomUUID(),
    startsAt: new Date(Date.now() + 7_200_000).toISOString(),
    endsAt: new Date(Date.now() + 10_800_000).toISOString(),
    capacity: 1,
  };
  expectError(await call('POST', '/windows', guest, body), 403, 'AUTH_FORBIDDEN');
  expectError(await call('POST', '/windows', booking, body), 403, 'AUTH_FORBIDDEN');
  assert.equal((await call('POST', '/windows', ops, body)).status, 201);
  assert.equal(
    (await call('POST', '/windows', ops, body)).status,
    200,
    'identical definition replays',
  );
  const bad = await call('POST', '/windows', ops, { ...body, secret: '0991234567' });
  expectError(bad, 400, 'REQUEST_INVALID');
  assert.ok(!JSON.stringify(bad.body).includes('0991234567'));
  expectError(await call('POST', '/windows', ops, '{"zoneId":'), 400, 'REQUEST_INVALID');
  expectError(await call('GET', '/no-such-route', ops), 404, 'NOT_FOUND');
});

test('error bodies carry the caller correlation id, a request id and no internals', async () => {
  const correlationId = randomUUID();
  const res = await call('GET', `/holds/${randomUUID()}`, {
    ...guest,
    'x-correlation-id': correlationId,
  });
  expectError(res, 404, 'NOT_FOUND');
  assert.equal(res.body.error?.correlationId, correlationId);
  assert.ok(res.body.error?.requestId);
  assert.ok(!/prisma|postgres|select/i.test(JSON.stringify(res.body)));
});

test('request budgets answer 429 RATE_LIMITED (retryable) instead of exhausting the store', async () => {
  let limited: Reply | null = null;
  for (let i = 0; i < 40 && !limited; i += 1) {
    const res = await call(
      'GET',
      `/availability/earliest?zoneId=${randomUUID()}&durationMinutes=30`,
      {},
    );
    if (res.status === 429) limited = res;
  }
  assert.ok(limited, 'the public budget of 30/min must trip');
  assert.equal(limited.body.error?.code, 'RATE_LIMITED');
  assert.equal(limited.body.error?.retryable, true);
});
