import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OwnerHttpClient } from '../../src/infrastructure/http/owner-http.client';
import {
  BillingCancellationAdapter,
  DispatchChangesAdapter,
  SchedulingCommitmentsAdapter,
} from '../../src/infrastructure/owners/change-adapters';
import { holdWire, principal } from '../support/fixtures';

/**
 * P04-C3 owner adapters against a REAL local HTTP server: every recognised
 * definitive answer maps to its port outcome; everything else (5xx, timeout,
 * a body about another booking, an unknown reason) is UNKNOWN, never success.
 */
type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let handler: Handler = (_req, _body, res) => res.writeHead(500).end();
const seen: { url: string; headers: IncomingMessage['headers']; body: string }[] = [];
let server: Server;
let base = '';
const SERVICE = { clientId: 'booking', token: 't'.repeat(40) };
const BOOKING = randomUUID();
const CHANGE = randomUUID();
const CORRELATION = randomUUID();

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', headers: req.headers, body });
      handler(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function json(status: number, body: unknown): Handler {
  return (_req, _body, res) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function refusal(status: number, code: string, reason: string | null): Handler {
  return json(status, {
    error: {
      code,
      reason,
      message: 'x',
      requestId: 'r',
      correlationId: 'c',
      retryable: false,
      retryAfterMs: null,
      issues: [],
    },
  });
}

const http = (owner: string, timeoutMs = 500) =>
  new OwnerHttpClient({ owner, baseUrl: base, timeoutMs, service: SERVICE, failureThreshold: 100 });

const view = (outcome: string, bookingId = BOOKING) => ({
  bookingId,
  changeId: CHANGE,
  outcome,
  assignmentRevision: 3,
});

const slot = {
  holdId: randomUUID(),
  zoneId: randomUUID(),
  startsAt: new Date('2026-11-01T09:00:00.000Z'),
  endsAt: new Date('2026-11-01T10:00:00.000Z'),
};

test('dispatch cancel: outcomes, refusals, and UNKNOWN for anything else', async () => {
  const dispatch = new DispatchChangesAdapter(http('dispatch'));
  const cancel = () => dispatch.cancel(BOOKING, CHANGE, CORRELATION);
  handler = json(200, view('CANCELLED'));
  assert.deepEqual(await cancel(), { kind: 'CANCELLED' });
  const sent = seen.at(-1)!;
  assert.equal(sent.url, `/internal/v1/dispatch/bookings/${BOOKING}/cancellation`);
  assert.deepEqual(JSON.parse(sent.body), { changeId: CHANGE });
  assert.equal(sent.headers['idempotency-key'], `booking-change-cancel-${CHANGE}`);
  assert.equal(sent.headers['x-service-client'], 'booking');
  assert.equal(sent.headers['x-correlation-id'], CORRELATION);
  handler = json(200, view('NOT_OPENED'));
  assert.deepEqual(await cancel(), { kind: 'NOT_OPENED' });
  handler = refusal(422, 'BUSINESS_RULE_VIOLATION', 'WORK_STARTED');
  assert.deepEqual(await cancel(), { kind: 'REFUSED', reason: 'WORK_STARTED' });
  handler = refusal(422, 'BUSINESS_RULE_VIOLATION', 'WORK_COMPLETED');
  assert.deepEqual(await cancel(), { kind: 'REFUSED', reason: 'WORK_COMPLETED' });
  handler = refusal(422, 'BUSINESS_RULE_VIOLATION', 'SOMETHING_ELSE');
  assert.equal((await cancel()).kind, 'UNKNOWN');
  handler = json(200, view('CANCELLED', randomUUID()));
  assert.equal((await cancel()).kind, 'UNKNOWN', 'an answer about another booking is not trusted');
  handler = (_req, _body, res) => res.writeHead(503).end();
  assert.deepEqual(await cancel(), { kind: 'UNKNOWN', error: 'HTTP_503' });
  handler = () => undefined; // never answers
  const slow = new DispatchChangesAdapter(http('dispatch', 100));
  assert.deepEqual(await slow.cancel(BOOKING, CHANGE, CORRELATION), {
    kind: 'UNKNOWN',
    error: 'TIMEOUT',
  });
});

test('dispatch rebind / confirm / revert mapping', async () => {
  const dispatch = new DispatchChangesAdapter(http('dispatch'));
  handler = json(200, view('REBOUND'));
  assert.deepEqual(await dispatch.rebind(BOOKING, CHANGE, slot, CORRELATION), { kind: 'REBOUND' });
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), {
    changeId: CHANGE,
    holdId: slot.holdId,
    zoneId: slot.zoneId,
    startsAt: '2026-11-01T09:00:00.000Z',
    endsAt: '2026-11-01T10:00:00.000Z',
  });
  handler = json(200, view('CONFIRMED'));
  assert.deepEqual(await dispatch.rebind(BOOKING, CHANGE, slot, CORRELATION), { kind: 'REBOUND' });
  handler = refusal(409, 'CONFLICT', 'ASSIGNMENT_NOT_OPEN');
  assert.deepEqual(await dispatch.rebind(BOOKING, CHANGE, slot, CORRELATION), {
    kind: 'NOT_READY',
  });
  for (const reason of ['WORK_STARTED', 'WORK_COMPLETED', 'BOOKING_CANCELLED'] as const) {
    handler = refusal(422, 'BUSINESS_RULE_VIOLATION', reason);
    assert.deepEqual(await dispatch.rebind(BOOKING, CHANGE, slot, CORRELATION), {
      kind: 'REFUSED',
      reason,
    });
  }
  handler = refusal(409, 'CONFLICT', 'CHANGE_REVERTED');
  assert.equal((await dispatch.rebind(BOOKING, CHANGE, slot, CORRELATION)).kind, 'UNKNOWN');
  handler = json(200, view('CONFIRMED'));
  assert.deepEqual(await dispatch.confirm(BOOKING, CHANGE, CORRELATION), { kind: 'CONFIRMED' });
  handler = refusal(409, 'CONFLICT', 'CHANGE_REVERTED');
  assert.equal((await dispatch.confirm(BOOKING, CHANGE, CORRELATION)).kind, 'UNKNOWN');
  for (const outcome of ['REVERTED', 'NOTHING_TO_REVERT']) {
    handler = json(200, view(outcome));
    assert.deepEqual(await dispatch.revert(BOOKING, CHANGE, CORRELATION), { kind: 'REVERTED' });
  }
  handler = refusal(409, 'CONFLICT', 'CHANGE_CONFIRMED');
  assert.equal((await dispatch.revert(BOOKING, CHANGE, CORRELATION)).kind, 'UNKNOWN');
});

test('scheduling release / replace mapping, validated against the published hold shape', async () => {
  const scheduling = new SchedulingCommitmentsAdapter(http('scheduling'));
  const who = principal();
  const now = new Date();
  const from = holdWire({ beneficiary: who, zoneId: slot.zoneId, startsAt: slot.startsAt, now });
  const to = holdWire({ beneficiary: who, zoneId: slot.zoneId, startsAt: slot.endsAt, now });
  handler = json(200, { ...from, state: 'RELEASED', revision: 3, bookingId: null });
  assert.deepEqual(await scheduling.release(BOOKING, from.holdId, CORRELATION), {
    kind: 'RELEASED',
  });
  assert.equal(seen.at(-1)!.url, `/internal/v1/scheduling/bookings/${BOOKING}/commitment/release`);
  handler = json(200, { ...from, state: 'COMMITTED', revision: 2, bookingId: BOOKING });
  assert.equal((await scheduling.release(BOOKING, from.holdId, CORRELATION)).kind, 'UNKNOWN');
  handler = refusal(409, 'CONFLICT', 'COMMITMENT_NOT_FOUND');
  assert.deepEqual(await scheduling.release(BOOKING, from.holdId, CORRELATION), {
    kind: 'NOT_COMMITTED',
  });

  const input = {
    bookingId: BOOKING,
    fromHoldId: from.holdId,
    toHoldId: to.holdId,
    toExpectedRevision: 1,
  };
  handler = json(200, {
    bookingId: BOOKING,
    released: { ...from, state: 'RELEASED', revision: 3, bookingId: null },
    committed: { ...to, state: 'COMMITTED', revision: 2, bookingId: BOOKING },
  });
  const replaced = await scheduling.replace(input, CORRELATION);
  assert.equal(replaced.kind, 'REPLACED');
  if (replaced.kind === 'REPLACED') assert.equal(replaced.slot.holdId, to.holdId);
  handler = json(200, {
    bookingId: BOOKING,
    released: { ...from, state: 'RELEASED', revision: 3, bookingId: null },
    committed: { ...to, state: 'COMMITTED', revision: 2, bookingId: randomUUID() },
  });
  assert.equal(
    (await scheduling.replace(input, CORRELATION)).kind,
    'UNKNOWN',
    'committed to someone else',
  );
  const cases: [Handler, string][] = [
    [refusal(422, 'BUSINESS_RULE_VIOLATION', 'HOLD_EXPIRED'), 'HOLD_EXPIRED'],
    [refusal(422, 'BUSINESS_RULE_VIOLATION', 'HOLD_NOT_ACTIVE'), 'HOLD_NOT_ACTIVE'],
    [refusal(412, 'REVISION_CONFLICT', null), 'HOLD_NOT_ACTIVE'],
    [refusal(404, 'NOT_FOUND', null), 'HOLD_UNAVAILABLE'],
    [refusal(409, 'CONFLICT', 'COMMITMENT_NOT_FOUND'), 'HOLD_UNAVAILABLE'],
  ];
  for (const [answer, reason] of cases) {
    handler = answer;
    assert.deepEqual(await scheduling.replace(input, CORRELATION), { kind: 'REFUSED', reason });
  }
  handler = (_req, _body, res) => res.writeHead(500).end();
  assert.equal((await scheduling.replace(input, CORRELATION)).kind, 'UNKNOWN');
});

test('billing settlement: three outcomes; a missing route (404) stays UNKNOWN', async () => {
  const billing = new BillingCancellationAdapter(http('billing'));
  for (const outcome of ['VOIDED', 'REFUND_PENDING', 'NOTHING_DUE'] as const) {
    handler = json(200, { bookingId: BOOKING, outcome });
    assert.deepEqual(await billing.settle(BOOKING, CHANGE, CORRELATION), {
      kind: 'SETTLED',
      settlement: outcome,
    });
  }
  assert.equal(
    seen.at(-1)!.url,
    `/internal/v1/billing/bookings/${BOOKING}/cancellation-settlement`,
  );
  assert.equal(seen.at(-1)!.headers['idempotency-key'], `booking-change-settle-${CHANGE}`);
  handler = json(200, { bookingId: BOOKING, outcome: 'PAID' });
  assert.equal((await billing.settle(BOOKING, CHANGE, CORRELATION)).kind, 'UNKNOWN');
  handler = refusal(404, 'NOT_FOUND', null);
  assert.deepEqual(await billing.settle(BOOKING, CHANGE, CORRELATION), {
    kind: 'UNKNOWN',
    error: 'HTTP_404',
  });
  const unconfigured = new BillingCancellationAdapter(
    new OwnerHttpClient({ owner: 'billing', baseUrl: undefined, timeoutMs: 100, service: SERVICE }),
  );
  assert.deepEqual(await unconfigured.settle(BOOKING, CHANGE, CORRELATION), {
    kind: 'UNKNOWN',
    error: 'NOT_CONFIGURED',
  });
});
