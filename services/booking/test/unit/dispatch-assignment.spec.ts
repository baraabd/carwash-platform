import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DispatchAssignmentClient,
  dispatchAssignmentConfig,
  parseAssignment,
  type DispatchAssignmentConfig,
} from '../../src/infrastructure/dispatch/dispatch-assignment.client';
import { AssignmentUnavailable } from '../../src/ports';

/**
 * Dispatch assignment adapter against a REAL local HTTP server (node:http +
 * Node fetch): closed parsing, 404 mapping, timeout/retry/budget, failure
 * mapping, header propagation and startup configuration validation.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handlers: Handler[] = [];
const seen: { url: string; headers: IncomingMessage['headers'] }[] = [];
let server: Server;
let base = '';
const TOKEN = 'd'.repeat(48);
const TECH = randomUUID();

before(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    const handler = handlers.shift() ?? ((_q, r) => r.writeHead(500).end());
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

function config(timeoutMs = 300): DispatchAssignmentConfig {
  const parsed = dispatchAssignmentConfig({
    BOOKING_DISPATCH_URL: base,
    BOOKING_DISPATCH_CLIENT_ID: 'booking',
    BOOKING_DISPATCH_CLIENT_TOKEN: TOKEN,
    BOOKING_DISPATCH_TIMEOUT_MS: String(timeoutMs),
  });
  if (parsed === null) throw new Error('config expected');
  return parsed;
}

function client(timeoutMs = 300) {
  return new DispatchAssignmentClient(config(timeoutMs), { next: () => 0.5 });
}

function assignment(bookingId: string, overrides: Record<string, unknown> = {}) {
  return {
    assignmentId: randomUUID(),
    revision: 4,
    bookingId,
    holdId: randomUUID(),
    zoneId: randomUUID(),
    startsAt: '2026-10-09T10:00:00.000Z',
    endsAt: '2026-10-09T11:00:00.000Z',
    status: 'ASSIGNED',
    resourceId: randomUUID(),
    technicianSubjectId: TECH,
    cancelReason: null,
    createdAt: '2026-10-09T08:00:00.000Z',
    updatedAt: '2026-10-09T08:00:00.000Z',
    offer: null,
    ...overrides,
  };
}

const json =
  (status: number, body: unknown): Handler =>
  (_req, res) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
const raw =
  (status: number, text: string): Handler =>
  (_req, res) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(text);
const slow =
  (ms: number, then: Handler): Handler =>
  (req, res) => {
    const timer = setTimeout(() => {
      if (!res.destroyed) then(req, res);
    }, ms);
    res.on('close', () => clearTimeout(timer));
  };

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AssignmentUnavailable) return error.reason;
    throw error;
  }
  return 'NO_ERROR';
}

function reset(...next: Handler[]) {
  handlers = next;
  seen.length = 0;
}

test('200: closed parse of status, subject and revision; headers carry correlation and credential', async () => {
  const bookingId = randomUUID();
  reset(json(200, assignment(bookingId)));
  const correlationId = randomUUID();
  assert.deepEqual(await client().currentAssignee(bookingId, correlationId), {
    status: 'ASSIGNED',
    technicianSubjectId: TECH,
    revision: 4,
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.url, `/internal/v1/dispatch/bookings/${bookingId}/assignment`);
  assert.equal(seen[0]?.headers['x-correlation-id'], correlationId);
  assert.equal(seen[0]?.headers['x-service-client'], 'booking');
  assert.equal(seen[0]?.headers['x-service-token'], TOKEN);
  assert.equal(seen[0]?.headers.authorization, undefined, 'no user credential is forwarded');
});

test('404 is NOT_FOUND (no job), without retry', async () => {
  reset(json(404, { error: { code: 'NOT_FOUND' } }));
  assert.equal(await client().currentAssignee(randomUUID(), randomUUID()), 'NOT_FOUND');
  assert.equal(seen.length, 1);
});

test('500 then 200: one retry succeeds', async () => {
  const bookingId = randomUUID();
  reset(
    json(500, {}),
    json(200, assignment(bookingId, { status: 'OFFERED', technicianSubjectId: null })),
  );
  assert.deepEqual(await client().currentAssignee(bookingId, randomUUID()), {
    status: 'OFFERED',
    technicianSubjectId: null,
    revision: 4,
  });
  assert.equal(seen.length, 2);
});

test('500 twice: UNAVAILABLE after exactly one retry', async () => {
  reset(json(500, {}), json(503, {}), json(200, {}));
  assert.equal(await reason(client().currentAssignee(randomUUID(), randomUUID())), 'UPSTREAM_5XX');
  assert.equal(seen.length, 2, 'never more than one retry');
});

test('slow then fast: the timed-out attempt is retried within the budget', async () => {
  const bookingId = randomUUID();
  reset(slow(2_000, json(200, assignment(bookingId))), json(200, assignment(bookingId)));
  const started = Date.now();
  const answer = await client(300).currentAssignee(bookingId, randomUUID());
  assert.notEqual(answer, 'NOT_FOUND');
  assert.ok(Date.now() - started < 1_500);
});

test('slow twice: TIMEOUT, bounded by the total budget (2 x timeout + jitter)', async () => {
  const bookingId = randomUUID();
  reset(
    slow(3_000, json(200, assignment(bookingId))),
    slow(3_000, json(200, assignment(bookingId))),
  );
  const started = Date.now();
  assert.equal(await reason(client(300).currentAssignee(bookingId, randomUUID())), 'TIMEOUT');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 300 * 2 + 150 + 400, `elapsed ${elapsed} ms exceeds the budget`);
});

test('malformed answers are BAD_RESPONSE, never retried and never allowed', async () => {
  const bookingId = randomUUID();
  const malformed: Handler[] = [
    raw(200, '{not json'),
    json(200, []),
    json(200, assignment(randomUUID())), // another booking's assignment
    json(200, assignment(bookingId, { status: 'DONE' })),
    json(200, assignment(bookingId, { technicianSubjectId: 'tech-1' })),
    json(200, assignment(bookingId, { technicianSubjectId: null })), // ASSIGNED without technician
    json(200, assignment(bookingId, { revision: '4' })),
    json(200, assignment(bookingId, { revision: 0 })),
    raw(200, JSON.stringify({ ...assignment(bookingId), pad: 'x'.repeat(70 * 1024) })),
  ];
  for (const handler of malformed) {
    reset(handler);
    assert.equal(await reason(client().currentAssignee(bookingId, randomUUID())), 'BAD_RESPONSE');
    assert.equal(seen.length, 1);
  }
});

test('refused credential or other status: UNAVAILABLE (fail closed), no retry', async () => {
  for (const status of [401, 403, 400, 409, 429]) {
    reset(json(status, {}));
    assert.equal(
      await reason(client().currentAssignee(randomUUID(), randomUUID())),
      `UPSTREAM_${status}`,
    );
    assert.equal(seen.length, 1);
  }
});

test('network failure (connection reset): retried once, then NETWORK', async () => {
  const reset_: Handler = (req) => req.socket.destroy();
  reset(reset_, reset_);
  assert.equal(await reason(client().currentAssignee(randomUUID(), randomUUID())), 'NETWORK');
  assert.equal(seen.length, 2);
});

test('network failure then 200: the retry answers', async () => {
  const bookingId = randomUUID();
  reset((req) => req.socket.destroy(), json(200, assignment(bookingId)));
  assert.notEqual(await client().currentAssignee(bookingId, randomUUID()), 'NOT_FOUND');
  assert.equal(seen.length, 2);
});

test('not configured: every call is UNAVAILABLE, nothing is sent', async () => {
  reset();
  const none = new DispatchAssignmentClient(null, { next: () => 0 });
  assert.equal(await reason(none.currentAssignee(randomUUID(), randomUUID())), 'NOT_CONFIGURED');
  assert.equal(seen.length, 0);
});

test('config: absent is null; partial or malformed values refuse to start', () => {
  assert.equal(dispatchAssignmentConfig({}), null);
  const good = {
    BOOKING_DISPATCH_URL: 'http://dispatch:3000',
    BOOKING_DISPATCH_CLIENT_TOKEN: TOKEN,
  };
  const parsed = dispatchAssignmentConfig(good);
  assert.equal(parsed?.clientId, 'booking');
  assert.equal(parsed?.timeoutMs, 1_000);
  assert.equal(parsed?.budgetMs, 2_150);
  const bad: [Record<string, string>, string][] = [
    [{ BOOKING_DISPATCH_URL: 'http://dispatch:3000' }, 'BOOKING_DISPATCH_INCOMPLETE'],
    [{ BOOKING_DISPATCH_CLIENT_TOKEN: TOKEN }, 'BOOKING_DISPATCH_INCOMPLETE'],
    [{ BOOKING_DISPATCH_TIMEOUT_MS: '500' }, 'BOOKING_DISPATCH_INCOMPLETE'],
    [{ ...good, BOOKING_DISPATCH_URL: 'not a url' }, 'INVALID_BOOKING_DISPATCH_URL'],
    [{ ...good, BOOKING_DISPATCH_URL: 'ftp://dispatch' }, 'INVALID_BOOKING_DISPATCH_URL'],
    [{ ...good, BOOKING_DISPATCH_URL: 'http://u:p@dispatch' }, 'INVALID_BOOKING_DISPATCH_URL'],
    [{ ...good, BOOKING_DISPATCH_CLIENT_ID: 'Booking!' }, 'INVALID_BOOKING_DISPATCH_CLIENT_ID'],
    [{ ...good, BOOKING_DISPATCH_CLIENT_TOKEN: 'short' }, 'INVALID_BOOKING_DISPATCH_CLIENT_TOKEN'],
    [{ ...good, BOOKING_DISPATCH_TIMEOUT_MS: '50' }, 'INVALID_BOOKING_DISPATCH_TIMEOUT_MS'],
    [{ ...good, BOOKING_DISPATCH_TIMEOUT_MS: 'abc' }, 'INVALID_BOOKING_DISPATCH_TIMEOUT_MS'],
  ];
  for (const [env, message] of bad) {
    assert.throws(() => dispatchAssignmentConfig(env), { message });
  }
});

test('parseAssignment: ignores unknown fields, lower-cases the subject', () => {
  const bookingId = randomUUID();
  assert.deepEqual(
    parseAssignment(
      { ...assignment(bookingId), technicianSubjectId: TECH.toUpperCase(), extra: 1 },
      bookingId,
    ),
    { status: 'ASSIGNED', technicianSubjectId: TECH, revision: 4 },
  );
});
