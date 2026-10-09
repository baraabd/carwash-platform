/**
 * Provider verification of scheduling.v1 against the PUBLISHED contract.
 *
 * The compiled service runs as a real process on the lane PostgreSQL. Every
 * response of every published route, success or error, is parsed with the
 * parsers Lane E published in @carwash/contracts (scheduling/v1, common/errors),
 * and every outbox event with @carwash/event-contracts business-v1. Requests are
 * built with, and checked by, the published request parsers, so consumer and
 * provider agree on the exact wire shape. Identity is the lane HTTP double.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from '../../../services/scheduling/node_modules/pg/lib/index.js';
import {
  ROOT,
  digest,
  freePort,
  identityDouble,
  publishedContracts,
  readContext,
  startProcess,
  waitHttp,
} from './_support.mjs';

const MAIN = path.join(ROOT, 'services', 'scheduling', 'dist', 'main.js');
const SERVICE_TOKEN = 'p'.repeat(48);
const OPS_TOKEN = 'operations-token-provider';
const GUEST = { token: 'guest-token-provider-01', subject: randomUUID() };
const ACCOUNT = { token: 'account-token-provider-1', subject: randomUUID() };
const contracts = publishedContracts();
const {
  SCHEDULING_V1,
  parseAvailabilityV1,
  parseHoldV1,
  parseHoldRequestV1,
  parseCommitHoldRequestV1,
  parseReleaseHoldRequestV1,
} = contracts.scheduling;
const { parseApiErrorEnvelope, API_ERROR_STATUS } = contracts.errors;
const { SCHEDULING_HOLD_CHANGED_V1 } = contracts.events;

let context;
let identity;
let proc;
let port;
let db;

before(async () => {
  context = await readContext();
  identity = await identityDouble({
    [OPS_TOKEN]: {
      subject: randomUUID(),
      principalKind: 'account',
      permissions: ['operations.dispatch'],
    },
    [GUEST.token]: {
      subject: GUEST.subject,
      principalKind: 'guest',
      permissions: ['bookings.create:self'],
    },
    [ACCOUNT.token]: {
      subject: ACCOUNT.subject,
      principalKind: 'account',
      permissions: ['bookings.create:self'],
    },
  });
  port = await freePort();
  proc = startProcess(MAIN, {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_URL: context.databases.scheduling.appUrl,
    IDENTITY_URL: identity.url,
    SCHEDULING_SERVICE_CLIENTS: JSON.stringify([
      { id: 'booking', tokenSha256: digest(SERVICE_TOKEN), scopes: ['scheduling.hold.commit'] },
    ]),
  });
  await waitHttp(`http://127.0.0.1:${port}/health/live`, (s) => s === 200);
  db = new pg.Pool({
    connectionString: context.databases.scheduling.appUrl.replace('?schema=app', ''),
    max: 2,
  });
});

after(async () => {
  await proc?.kill();
  await db?.end();
  await identity?.close();
});

const url = (route) => `http://127.0.0.1:${port}${SCHEDULING_V1.prefix}${route}`;
const booking = { 'x-service-client': 'booking', 'x-service-token': SERVICE_TOKEN };
const as = (who, key) => ({
  authorization: `Bearer ${who.token}`,
  ...(key ? { 'idempotency-key': key } : {}),
});
const key = () => `prov-${randomUUID()}`;

async function call(method, route, headers, body) {
  const res = await fetch(url(route), {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** An error must parse as the published envelope, with the status its code fixes. */
function assertPublishedError(res, code, reason = null) {
  const envelope = parseApiErrorEnvelope(res.body);
  assert.equal(envelope.error.code, code, JSON.stringify(res.body));
  assert.equal(res.status, API_ERROR_STATUS[code]);
  assert.equal(envelope.error.reason, reason);
  if (reason !== null) assert.ok(SCHEDULING_V1.reasons.includes(reason), `${reason} is published`);
}

async function window(capacity = 2) {
  const startsAt = new Date(Date.now() + 4 * 3_600_000);
  startsAt.setUTCMinutes(0, 0, 0);
  const zoneId = randomUUID();
  const res = await fetch(`http://127.0.0.1:${port}/internal/v1/scheduling/windows`, {
    method: 'POST',
    headers: { authorization: `Bearer ${OPS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      zoneId,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 2 * 3_600_000).toISOString(),
      capacity,
    }),
  });
  assert.equal(res.status, 201);
  return { zoneId, startsAt };
}

/** Request bodies are produced, then validated by the published parser. */
function holdRequest(who, kind, w) {
  return parseHoldRequestV1({
    beneficiary: { kind, subjectId: who.subject },
    zoneId: w.zoneId,
    startsAt: w.startsAt.toISOString(),
    durationMinutes: 45,
    quoteRef: { quoteId: randomUUID(), revision: 1 },
  });
}

test('the published route table is exactly the surface exercised below', () => {
  const served = Object.values(SCHEDULING_V1.routes).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(served.sort(), [
    'GET /availability',
    'GET /availability/earliest',
    'GET /holds/:holdId',
    'POST /holds',
    'POST /holds/:holdId/commit',
    'POST /holds/:holdId/release',
  ]);
  assert.equal(SCHEDULING_V1.prefix, '/internal/v1/scheduling');
});

test('availability and earliest responses parse with parseAvailabilityV1', async () => {
  const w = await window(2);
  const date = new Date(w.startsAt.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  const day = await call(
    'GET',
    `/availability?zoneId=${w.zoneId}&date=${date}&durationMinutes=45`,
    {},
  );
  assert.equal(day.status, 200);
  const parsed = parseAvailabilityV1(day.body);
  assert.ok(parsed.slots.length >= 1);
  assert.equal(parsed.slots[0].startsAt, w.startsAt.toISOString());
  const earliest = await call(
    'GET',
    `/availability/earliest?zoneId=${w.zoneId}&durationMinutes=45`,
    {},
  );
  assert.ok(parseAvailabilityV1(earliest.body).earliest !== null);
  const empty = await call(
    'GET',
    `/availability?zoneId=${randomUUID()}&date=${date}&durationMinutes=45`,
    {},
  );
  assert.deepEqual(parseAvailabilityV1(empty.body).slots, []);
  assertPublishedError(
    await call('GET', `/availability?zoneId=${w.zoneId}&date=2026-02-30&durationMinutes=45`, {}),
    'REQUEST_INVALID',
  );
});

test('hold create/get/commit/release responses parse with parseHoldV1; replays are identical', async () => {
  const w = await window(1);
  const request = holdRequest(GUEST, 'guest', w);
  const k = key();
  const created = await call('POST', SCHEDULING_V1.routes.createHold.path, as(GUEST, k), request);
  assert.equal(created.status, 201);
  const hold = parseHoldV1(created.body);
  assert.equal(hold.state, 'HELD');
  assert.deepEqual(hold.beneficiary, { kind: 'guest', subjectId: GUEST.subject });
  assert.equal(Date.parse(hold.endsAt) - Date.parse(hold.startsAt), 45 * 60_000);
  assert.deepEqual(
    await call('POST', '/holds', as(GUEST, k), request),
    created,
    'same key + same body replays byte for byte',
  );
  parseHoldV1((await call('GET', `/holds/${hold.holdId}`, as(GUEST))).body);
  assertPublishedError(await call('GET', `/holds/${hold.holdId}`, as(ACCOUNT)), 'NOT_FOUND');

  const commit = parseCommitHoldRequestV1({
    expectedRevision: hold.revision,
    bookingId: randomUUID(),
  });
  const committed = await call(
    'POST',
    `/holds/${hold.holdId}/commit`,
    { ...booking, 'idempotency-key': key() },
    commit,
  );
  assert.equal(committed.status, 200);
  const after = parseHoldV1(committed.body);
  assert.equal(after.state, 'COMMITTED');
  assert.equal(after.bookingId, commit.bookingId);
  assert.equal(after.revision, hold.revision + 1);
  const replay = await call(
    'POST',
    `/holds/${hold.holdId}/commit`,
    { ...booking, 'idempotency-key': key() },
    commit,
  );
  assert.deepEqual(parseHoldV1(replay.body), after, 'same booking, new key: same hold');
  assertPublishedError(
    await call(
      'POST',
      `/holds/${hold.holdId}/commit`,
      { ...booking, 'idempotency-key': key() },
      { expectedRevision: after.revision, bookingId: randomUUID() },
    ),
    'BUSINESS_RULE_VIOLATION',
    'HOLD_NOT_ACTIVE',
  );

  const w2 = await window(1);
  const second = parseHoldV1(
    (await call('POST', '/holds', as(ACCOUNT, key()), holdRequest(ACCOUNT, 'account', w2))).body,
  );
  const release = parseReleaseHoldRequestV1({
    expectedRevision: second.revision,
    reason: 'CUSTOMER_CHANGED',
  });
  const released = await call(
    'POST',
    `/holds/${second.holdId}/release`,
    as(ACCOUNT, key()),
    release,
  );
  assert.equal(released.status, 200);
  assert.equal(parseHoldV1(released.body).state, 'RELEASED');
});

test('every published refusal reason is produced with the published envelope', async () => {
  const w = await window(1);
  const first = parseHoldV1(
    (await call('POST', '/holds', as(GUEST, key()), holdRequest(GUEST, 'guest', w))).body,
  );
  assertPublishedError(
    await call('POST', '/holds', as(ACCOUNT, key()), holdRequest(ACCOUNT, 'account', w)),
    'BUSINESS_RULE_VIOLATION',
    'SLOT_UNAVAILABLE',
  );
  const far = {
    ...holdRequest(ACCOUNT, 'account', w),
    startsAt: new Date(Date.now() + 40 * 86_400_000).toISOString(),
  };
  far.startsAt = far.startsAt.replace(/\.\d{3}Z$/, '.000Z');
  assertPublishedError(
    await call('POST', '/holds', as(ACCOUNT, key()), far),
    'BUSINESS_RULE_VIOLATION',
    'OUTSIDE_HORIZON',
  );
  assertPublishedError(
    await call(
      'POST',
      `/holds/${first.holdId}/commit`,
      { ...booking, 'idempotency-key': key() },
      { expectedRevision: first.revision + 1, bookingId: randomUUID() },
    ),
    'REVISION_CONFLICT',
  );
  // Expire it by moving the deadline (fixture shortcut for 10 min of wall time).
  await db.query(
    `UPDATE app.capacity_hold SET expires_at = now() - interval '1 second' WHERE id = $1`,
    [first.holdId],
  );
  assertPublishedError(
    await call(
      'POST',
      `/holds/${first.holdId}/commit`,
      { ...booking, 'idempotency-key': key() },
      { expectedRevision: first.revision, bookingId: randomUUID() },
    ),
    'BUSINESS_RULE_VIOLATION',
    'HOLD_EXPIRED',
  );
  assert.equal(
    parseHoldV1((await call('GET', `/holds/${first.holdId}`, as(GUEST))).body).state,
    'EXPIRED',
  );
  assertPublishedError(
    await call('POST', '/holds', as(GUEST), holdRequest(GUEST, 'guest', w)),
    'IDEMPOTENCY_KEY_REQUIRED',
  );
  const k = key();
  await call('POST', '/holds', as(GUEST, k), holdRequest(GUEST, 'guest', w));
  assertPublishedError(
    await call('POST', '/holds', as(GUEST, k), holdRequest(GUEST, 'guest', w)),
    'IDEMPOTENCY_CONFLICT',
  );
  assertPublishedError(
    await call('POST', `/holds/${first.holdId}/commit`, as(GUEST, key()), {}),
    'REQUEST_INVALID',
  );
  assertPublishedError(
    await call('POST', `/holds/${first.holdId}/commit`, as(GUEST, key()), {
      expectedRevision: 1,
      bookingId: randomUUID(),
    }),
    'AUTH_FORBIDDEN',
  );
  assertPublishedError(await call('GET', `/holds/${first.holdId}`, {}), 'AUTH_REQUIRED');
});

test('every outbox event of this suite parses with the published hold-changed.v1 parser', async () => {
  const { rows } = await db.query(
    `SELECT payload FROM app.outbox_message WHERE event_type = 'scheduling.hold-changed.v1'`,
  );
  assert.ok(rows.length >= 6);
  for (const row of rows) {
    const event = SCHEDULING_HOLD_CHANGED_V1.parse(JSON.parse(row.payload));
    assert.equal(event.producer, 'scheduling');
    assert.equal(event.aggregate.type, 'hold');
  }
});
