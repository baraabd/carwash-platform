/**
 * P04-C3: the booking change saga survives lost responses, process kills and
 * worker restarts on real infrastructure.
 *
 * Runs the COMPILED Booking API (dist/main.js) and saga worker
 * (dist/workers/saga.main.js) as real OS processes against the lane PostgreSQL
 * and kills them with SIGKILL. Identity, Scheduling, Dispatch and Billing are
 * one local HTTP double speaking the published / REQUESTED shapes
 * (P04-C-interfaces.md), declared in the evidence; the real providers run
 * together in the P04-C merge candidate. Facts are read from the booking
 * tables and from the double's applied effects.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from '../../../services/booking/node_modules/pg/lib/index.js';
import { ROOT, freePort, readContext, require, startProcess, waitHttp } from './_support.mjs';

const MAIN = path.join(ROOT, 'services', 'booking', 'dist', 'main.js');
const WORKER = path.join(ROOT, 'services', 'booking', 'dist', 'workers', 'saga.main.js');
const support = path.join(ROOT, 'services', 'booking', 'dist-tests', 'test', 'support');
const { startOwnerDoubles, bookingEnv, dispatchEnv } = require(
  path.join(support, 'owner-doubles.js'),
);
const { HOUR, holdWire } = require(path.join(support, 'fixtures.js'));

let doubles;
let db;
let env;
let port;

before(async () => {
  const context = await readContext();
  doubles = await startOwnerDoubles();
  db = new pg.Pool({
    connectionString: context.databases.booking.appUrl.replace('?schema=app', ''),
    max: 2,
  });
  env = {
    ...bookingEnv(doubles, context.databases.booking.appUrl),
    ...dispatchEnv(doubles),
    HOST: '127.0.0.1',
    BOOKING_USER_REQUESTS_PER_MINUTE: '1000',
    BOOKING_SAGA_LEASE_MS: '1500',
    BOOKING_OWNER_TIMEOUT_MS: '3000',
    BOOKING_INLINE_SAGA_BUDGET_MS: '2000',
  };
  port = await freePort();
});

after(async () => {
  await db?.end();
  await doubles?.close();
});

async function startApi() {
  const proc = startProcess(MAIN, { ...env, PORT: String(port) });
  await waitHttp(`http://127.0.0.1:${port}/health/live`, (s) => s === 200);
  return proc;
}

async function call(method, route, token, { key, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/internal/v1/booking${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** A confirmed booking of a fresh customer, through the real API. */
async function confirmed() {
  const token = `change-token-${randomUUID()}`;
  const subject = randomUUID();
  doubles.sessions.set(token, {
    subject,
    principalKind: 'account',
    permissions: ['bookings.create:self', 'bookings.read:self'],
  });
  const issued = doubles.issue({ kind: 'account', subjectId: subject });
  const created = await call('POST', '/bookings', token, {
    key: `create-${randomUUID()}`,
    body: {
      quote: { quoteId: issued.quoteId, revision: 1 },
      hold: { holdId: issued.holdId, revision: 1 },
      vehicle: { source: 'saved', vehicleId: randomUUID(), revision: 2 },
      address: { addressId: randomUUID(), revision: 1 },
      contact: { name: 'سارة أحمد', phone: '0912345678', notes: null },
      paymentMethod: 'SHAM_CASH',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { token, subject, booking: created.body, zoneId: issued.zoneId };
}

async function change(changeId) {
  const { rows } = await db.query(
    `SELECT step, outcome, refusal, settlement, pivot_attempted, attention, last_error
       FROM app.booking_change WHERE change_id = $1::uuid`,
    [changeId],
  );
  return rows[0];
}

async function eventsOf(bookingId, type) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM app.outbox_message
      WHERE event_type = $2 AND payload::jsonb #>> '{aggregate,id}' = $1`,
    [bookingId, type],
  );
  return rows[0].n;
}

async function until(probe, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => undefined);
    if (value) return value;
    await delay(200);
  }
  throw new Error('condition not reached');
}

test('reschedule: replace applied but its answer lost, API killed; the worker replays it once', async () => {
  let api = await startApi();
  const who = await confirmed();
  const now = new Date();
  const target = {
    ...holdWire({
      beneficiary: { kind: 'account', subjectId: who.subject },
      zoneId: who.zoneId,
      startsAt: new Date(now.getTime() + 8 * HOUR),
      now,
    }),
    owner: who.subject,
  };
  doubles.holds.set(target.holdId, target);
  // Scheduling commits the move, then the answer is lost twice.
  doubles.loseAfterApply.set('scheduling.replace', 1_000);
  const requested = await call('POST', `/bookings/${who.booking.bookingId}/reschedule`, who.token, {
    key: `move-${randomUUID()}`,
    body: { expectedRevision: who.booking.revision, holdId: target.holdId, holdRevision: 1 },
  });
  assert.equal(requested.status, 202, JSON.stringify(requested.body));
  assert.equal(requested.body.state, 'IN_PROGRESS', 'UNKNOWN is never reported as done');
  await api.kill();
  doubles.loseAfterApply.set('scheduling.replace', 0);
  const stuck = await change(requested.body.changeId);
  assert.equal(stuck.step, 'REPLACE_COMMITMENT');
  assert.equal(stuck.pivot_attempted, true, 'the pivot was recorded before the request left');
  assert.equal(doubles.holds.get(target.holdId).state, 'COMMITTED', 'the owner did apply it');

  const worker = startProcess(WORKER, env, ['--interval-ms', '200']);
  try {
    const done = await until(async () => {
      const row = await change(requested.body.changeId);
      return row.outcome ? row : undefined;
    });
    assert.equal(done.outcome, 'COMPLETED');
    assert.equal(await eventsOf(who.booking.bookingId, 'booking.rescheduled.v1'), 1);
  } finally {
    await worker.kill();
  }
  api = await startApi();
  try {
    const view = await call('GET', `/bookings/${who.booking.bookingId}`, who.token);
    assert.equal(view.body.schedule.holdId, target.holdId);
    assert.equal(view.body.schedule.revision, 2);
    assert.equal(view.body.pendingChange, null);
  } finally {
    await api.kill();
  }
});

test('cancellation: Billing route absent keeps PENDING across worker kills; it settles once Billing serves it', async () => {
  let api = await startApi();
  const who = await confirmed();
  doubles.settlementAvailable = false;
  doubles.loseAfterApply.set('dispatch.cancellation', 1);
  const requested = await call(
    'POST',
    `/bookings/${who.booking.bookingId}/cancellation`,
    who.token,
    {
      key: `cancel-${randomUUID()}`,
      body: { expectedRevision: who.booking.revision, reason: 'CUSTOMER_REQUEST' },
    },
  );
  assert.equal(requested.status, 202);
  await api.kill();

  let worker = startProcess(WORKER, env, ['--interval-ms', '100']);
  const pending = await until(async () => {
    const row = await change(requested.body.changeId);
    return row.step === 'SETTLE_BILLING' ? row : undefined;
  });
  assert.equal(pending.settlement, 'PENDING');
  assert.equal(pending.outcome, null);
  await worker.kill(); // SIGKILL mid-retry
  const { rows } = await db.query(`SELECT status FROM app.booking WHERE id = $1::uuid`, [
    who.booking.bookingId,
  ]);
  assert.equal(rows[0].status, 'CANCELLED');
  assert.equal(doubles.jobs.get(who.booking.bookingId).cancelled, true);
  assert.equal(doubles.holds.get(who.booking.slot.holdId).state, 'RELEASED');

  doubles.settlementAvailable = true;
  worker = startProcess(WORKER, env, ['--interval-ms', '100']);
  try {
    const done = await until(async () => {
      const row = await change(requested.body.changeId);
      return row.outcome ? row : undefined;
    }, 60_000);
    assert.deepEqual([done.outcome, done.settlement], ['COMPLETED', 'VOIDED']);
    assert.equal(await eventsOf(who.booking.bookingId, 'booking.cancelled.v1'), 1);
  } finally {
    await worker.kill();
  }
});

test('two workers race the same due changes: every owner effect and event happens once', async () => {
  const api = await startApi();
  const bookings = [];
  try {
    doubles.failNext.set('dispatch', { status: 503, times: 4 });
    for (let i = 0; i < 4; i += 1) {
      const who = await confirmed();
      const requested = await call(
        'POST',
        `/bookings/${who.booking.bookingId}/cancellation`,
        who.token,
        {
          key: `race-${randomUUID()}`,
          body: { expectedRevision: who.booking.revision, reason: 'CUSTOMER_REQUEST' },
        },
      );
      bookings.push({ who, changeId: requested.body.changeId });
    }
  } finally {
    await api.kill();
  }
  const workers = [
    startProcess(WORKER, env, ['--interval-ms', '50']),
    startProcess(WORKER, env, ['--interval-ms', '50']),
  ];
  try {
    for (const { who, changeId } of bookings) {
      await until(async () => (await change(changeId)).outcome === 'COMPLETED');
      assert.equal(await eventsOf(who.booking.bookingId, 'booking.cancelled.v1'), 1);
      assert.equal(doubles.settlements.get(who.booking.bookingId), 'VOIDED');
    }
  } finally {
    await Promise.all(workers.map((w) => w.kill()));
  }
});
