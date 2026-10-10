/**
 * Pure console rules, executed on the TypeScript sources with Node's built-in
 * type stripping (no bundler, no DOM). Browser behaviour is covered by
 * tests/production/D/admin-operations.browser.mjs.
 */
/* global crypto, Response -- Node 24 web globals */
import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, canOpen, defaultScreen, isStaff } from '../src/domain/access.ts';
import {
  STATUS_TONE,
  bookingReference,
  isDerivedStatus,
  periodWindow,
  shortRef,
} from '../src/domain/bookings.ts';
import { MAX_VALIDITY_DAYS, approval, isProblem, rejection } from '../src/domain/review.ts';
import {
  csrfToken,
  idempotencyKey,
  integer,
  list,
  object,
  oneOf,
  request,
  text,
} from '../src/api/http.ts';

const session = (permissions, principalKind = 'account') => ({
  subject: crypto.randomUUID(),
  principalKind,
  roles: [],
  permissions,
});

test('access: each role sees only its screens; customers, technicians and guests see none', () => {
  const operations = capabilities(session(['operations.dispatch']));
  assert.deepEqual(operations, {
    bookings: true,
    resources: true,
    reviewDecisions: false,
    assignmentActions: true,
    payments: false,
    reconcile: false,
  });
  assert.equal(defaultScreen(operations), 'dashboard');
  assert.equal(canOpen('payments', operations), false);

  const reviewer = capabilities(session(['verification.review']));
  assert.deepEqual(reviewer, {
    bookings: false,
    resources: true,
    reviewDecisions: true,
    assignmentActions: false,
    payments: false,
    reconcile: false,
  });
  assert.equal(defaultScreen(reviewer), 'technicians');
  assert.equal(canOpen('bookings', reviewer), false);

  for (const permissions of [
    ['profile.read:self', 'bookings.read:self'],
    ['work.read:assigned', 'work.execute:assigned'],
    [],
  ]) {
    const caps = capabilities(session(permissions));
    assert.equal(isStaff(caps), false);
    assert.equal(defaultScreen(caps), null);
  }
  // A guest principal never gains staff capabilities, whatever it claims.
  assert.equal(isStaff(capabilities(session(['operations.dispatch'], 'guest'))), false);
});

test('bookings: periods are local calendar windows within the 31-day bound', () => {
  // Wednesday 2026-10-07 15:00 local (the test runs in the process time zone).
  const now = new Date(2026, 9, 7, 15, 0, 0);
  const day = periodWindow('today', now);
  assert.equal(new Date(day.from).getTime(), new Date(2026, 9, 7).getTime());
  assert.equal(new Date(day.to).getTime(), new Date(2026, 9, 8).getTime());
  const week = periodWindow('week', now);
  assert.equal(new Date(week.from).getDay(), 6, 'weeks start on Saturday');
  assert.equal(new Date(week.from).getTime(), new Date(2026, 9, 3).getTime());
  const month = periodWindow('month', now);
  assert.equal(new Date(month.from).getTime(), new Date(2026, 9, 1).getTime());
  assert.equal(new Date(month.to).getTime(), new Date(2026, 10, 1).getTime());
  for (const w of [day, week, month]) {
    assert.match(w.from, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(Date.parse(w.to) - Date.parse(w.from) <= 31 * 86_400_000);
  }
});

test('bookings: search accepts only a full reference; statuses map to the reference palette', () => {
  const id = crypto.randomUUID();
  assert.equal(bookingReference(`  ${id.toUpperCase()} `), id);
  for (const bad of ['', 'WG-1001', id.slice(0, 8), `${id}x`])
    assert.equal(bookingReference(bad), null);
  assert.equal(shortRef(id), `#${id.slice(0, 8).toUpperCase()}`);
  assert.equal(isDerivedStatus('SCHEDULED'), true);
  assert.equal(isDerivedStatus('COMPLETED'), false);
  assert.deepEqual(
    new Set(Object.values(STATUS_TONE)),
    new Set(['s-green', 's-amber', 's-blue', 's-red']),
  );
});

test('review: approval needs a real future day within two years; rejection a closed reason', () => {
  const now = new Date(2026, 9, 7, 12, 0, 0);
  const approved = approval('2027-03-01', now);
  assert.equal(isProblem(approved), false);
  assert.equal(approved.decision, 'APPROVE');
  assert.equal(new Date(approved.validUntil).getTime(), new Date(2027, 2, 1, 23, 59, 59).getTime());
  assert.equal(approval('', now), 'VALID_UNTIL_REQUIRED');
  assert.equal(approval('2027-02-30', now), 'VALID_UNTIL_REQUIRED');
  assert.equal(approval('2026-10-06', now), 'VALID_UNTIL_NOT_FUTURE');
  const tooFar = new Date(now.getTime() + (MAX_VALIDITY_DAYS + 2) * 86_400_000);
  assert.equal(approval(tooFar.toISOString().slice(0, 10), now), 'VALID_UNTIL_TOO_FAR');
  assert.deepEqual(rejection('EVIDENCE_INCOMPLETE'), {
    decision: 'REJECT',
    reason: 'EVIDENCE_INCOMPLETE',
  });
  assert.equal(rejection('BECAUSE'), 'REASON_REQUIRED');
  assert.equal(rejection(''), 'REASON_REQUIRED');
});

test('http: CSRF cookie, idempotency key and strict readers', () => {
  assert.equal(csrfToken('a=1; wg_csrf=abc.def; b=2'), 'abc.def');
  assert.equal(csrfToken('__Host-wg_csrf=xyz'), 'xyz');
  assert.equal(csrfToken('other=1'), '');
  const keys = new Set(Array.from({ length: 50 }, idempotencyKey));
  assert.equal(keys.size, 50);
  for (const key of keys) assert.match(key, /^[A-Za-z0-9_-]{16,128}$/);
  assert.throws(() => object([], '$'));
  assert.throws(() => text(1, 'x'));
  assert.throws(() => text('a', 'x', /^b$/));
  assert.throws(() => integer(-1, 'n'));
  assert.throws(() => integer(1.5, 'n'));
  assert.throws(() => oneOf('X', ['A', 'B'], 's'));
  assert.throws(() => list(new Array(501).fill(1), 'l', (v) => v));
});

/** Runs `request` against a scripted fetch and returns the typed outcome. */
async function withFetch(script, run) {
  const original = globalThis.fetch;
  globalThis.fetch = script;
  // Writes echo the CSRF cookie; outside a browser there is none.
  globalThis.document ??= { cookie: 'wg_csrf=token-from-cookie' };
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const read = (body) => object(body, '$');
const reply = (status, body) => () =>
  Promise.resolve(new Response(body === undefined ? '' : JSON.stringify(body), { status }));

test('http: statuses map to typed failures; a failed write is UNKNOWN, never success', async () => {
  for (const [status, failure] of [
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [422, 'INVALID'],
    [412, 'CONFLICT'],
    [429, 'RATE_LIMITED'],
    [503, 'UNAVAILABLE'],
  ]) {
    const result = await withFetch(reply(status, { error: { code: 'SOME_CODE' } }), () =>
      request('/x', { read }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.failure, failure, String(status));
  }
  const ok = await withFetch(reply(200, { a: 1 }), () => request('/x', { read }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { a: 1 });
  assert.match(ok.correlationId, /^[0-9a-f-]{36}$/);
  const malformed = await withFetch(reply(200, [1]), () => request('/x', { read }));
  assert.equal(malformed.failure, 'MALFORMED');

  const network = () => Promise.reject(new TypeError('network down'));
  assert.equal((await withFetch(network, () => request('/x', { read }))).failure, 'UNAVAILABLE');
  const write = { method: 'POST', body: {}, read };
  assert.equal((await withFetch(network, () => request('/x', write))).failure, 'UNKNOWN_OUTCOME');
  assert.equal(
    (await withFetch(reply(502, {}), () => request('/x', write))).failure,
    'UNKNOWN_OUTCOME',
  );
  assert.equal(
    (await withFetch(reply(200, 'oops'), () => request('/x', write))).failure,
    'UNKNOWN_OUTCOME',
  );

  let seen;
  await withFetch(
    (url, init) => {
      seen = { url, init };
      return reply(200, {})();
    },
    () => request('/admin/operations/bookings', { query: { from: 'a b', to: undefined }, read }),
  );
  assert.equal(seen.url, '/api/v1/admin/operations/bookings?from=a+b');
  assert.equal(seen.init.credentials, 'same-origin');
  assert.equal(seen.init.redirect, 'error');
  assert.match(seen.init.headers['x-correlation-id'], /^[0-9a-f-]{36}$/);
});
