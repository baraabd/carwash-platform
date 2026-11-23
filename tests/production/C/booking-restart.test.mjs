/**
 * Booking crash/restart safety on real infrastructure.
 *
 * Runs the COMPILED API (services/booking/dist/main.js) and the compiled saga
 * worker (dist/workers/saga.main.js) as real OS processes against the lane
 * PostgreSQL, kills them with SIGKILL (no shutdown hooks) and restarts the
 * database container. Identity and the owner services are one local HTTP
 * double speaking their published shapes (Billing: the requested shape),
 * declared in the evidence. Facts are read straight from the booking tables
 * and from the double's applied effects.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from '../../../services/booking/node_modules/pg/lib/index.js';
import {
  ROOT,
  dockerRestart,
  freePort,
  readContext,
  require,
  startProcess,
  waitHttp,
} from './_support.mjs';

const MAIN = path.join(ROOT, 'services', 'booking', 'dist', 'main.js');
const WORKER = path.join(ROOT, 'services', 'booking', 'dist', 'workers', 'saga.main.js');
const { startOwnerDoubles, bookingEnv } = require(
  path.join(ROOT, 'services', 'booking', 'dist-tests', 'test', 'support', 'owner-doubles.js'),
);

let context;
let doubles;
let db;
let env;
const ports = [];

before(async () => {
  context = await readContext();
  doubles = await startOwnerDoubles();
  db = new pg.Pool({
    connectionString: context.databases.booking.appUrl.replace('?schema=app', ''),
    max: 2,
  });
  db.on('error', () => {}); // the suite restarts PostgreSQL on purpose
  env = {
    ...bookingEnv(doubles, context.databases.booking.appUrl),
    HOST: '127.0.0.1',
    BOOKING_USER_REQUESTS_PER_MINUTE: '1000',
    BOOKING_SAGA_LEASE_MS: '1500',
    BOOKING_OWNER_TIMEOUT_MS: '8000',
    BOOKING_INLINE_SAGA_BUDGET_MS: '15000',
  };
  ports.push(await freePort(), await freePort());
});

after(async () => {
  await db?.end();
  await doubles?.close();
});

function customer() {
  const token = `restart-token-${randomUUID()}`;
  const subject = randomUUID();
  doubles.sessions.set(token, {
    subject,
    principalKind: 'account',
    permissions: ['bookings.create:self', 'bookings.read:self'],
  });
  const issued = doubles.issue({ kind: 'account', subjectId: subject });
  return {
    token,
    subject,
    body: {
      quote: { quoteId: issued.quoteId, revision: 1 },
      hold: { holdId: issued.holdId, revision: 1 },
      vehicle: { source: 'saved', vehicleId: randomUUID(), revision: 2 },
      address: { addressId: randomUUID(), revision: 1 },
      contact: { name: 'سارة أحمد', phone: '0912345678', notes: null },
      paymentMethod: 'CASH_ON_COMPLETION',
    },
  };
}

async function startApi(port) {
  const proc = startProcess(MAIN, { ...env, PORT: String(port) });
  await waitHttp(`http://127.0.0.1:${port}/health/live`, (s) => s === 200);
  return proc;
}

async function post(port, who, key) {
  const res = await fetch(`http://127.0.0.1:${port}/internal/v1/booking/bookings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${who.token}`,
      'idempotency-key': key,
    },
    body: JSON.stringify(who.body),
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function facts(holdId) {
  const { rows } = await db.query(
    `SELECT b.id, b.status, b.version, s.step, s.outcome, s.pivot_attempted, s.fence,
            (SELECT count(*)::int FROM app.outbox_message o WHERE o.payload::jsonb #>> '{aggregate,id}' = b.id::text) AS events
       FROM app.booking b JOIN app.booking_saga s ON s.booking_id = b.id
      WHERE b.hold_id = $1`,
    [holdId],
  );
  return rows;
}

async function until(probe, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => undefined);
    if (value) return value;
    await delay(150);
  }
  throw new Error('condition not reached');
}

test('readiness stays 503: implemented but not accepted for production', async () => {
  const api = await startApi(ports[0]);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${ports[0]}/health/ready`)).status, 503);
  } finally {
    await api.kill();
  }
});

test('SIGKILL of the API while the pivot commit is in flight: the worker replays it; one booking, one commit, one event', async () => {
  const who = customer();
  const key = `restart-${randomUUID()}`;
  doubles.commitDelayMs = 5_000; // Scheduling applies the commit, then answers late
  const before = doubles.commitsApplied;
  let api = await startApi(ports[0]);
  const inflight = post(ports[0], who, key).catch((error) => ({ status: 0, error }));
  await until(async () => doubles.commitsApplied === before + 1);
  await api.kill(); // the answer to the commit is lost with the process
  const lost = await inflight;
  assert.equal(lost.status, 0, 'the client saw the connection die, not a success');
  doubles.commitDelayMs = 0;

  const [stuck] = await facts(who.body.hold.holdId);
  assert.equal(stuck.status, 'PENDING_CONFIRMATION');
  assert.equal(stuck.step, 'COMMIT_HOLD');
  assert.equal(stuck.pivot_attempted, true, 'the pivot was recorded before the request left');

  const worker = startProcess(WORKER, env, ['--interval-ms', '200']);
  try {
    const done = await until(async () => {
      const [row] = await facts(who.body.hold.holdId);
      return row?.status === 'CONFIRMED' ? row : undefined;
    });
    assert.equal(done.outcome, 'CONFIRMED');
    assert.equal(done.events, 1);
    assert.equal(doubles.commitsApplied, before + 1, 'the replay did not commit twice');
  } finally {
    await worker.kill();
  }

  // The customer retries with the same key on a fresh API process: same booking.
  api = await startApi(ports[0]);
  try {
    const retry = await post(ports[0], who, key);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.status, 'CONFIRMED');
    assert.equal((await facts(who.body.hold.holdId)).length, 1);
  } finally {
    await api.kill();
  }
});

test('two API replicas, 10 concurrent duplicate confirmations each: exactly one booking per key', async () => {
  const [a, b] = [await startApi(ports[0]), await startApi(ports[1])];
  try {
    const who = customer();
    const key = `dup-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => post(ports[i % 2], who, key)),
    );
    const statuses = results.map((r) => r.status);
    assert.ok(
      statuses.every((s) => s === 200 || s === 201 || s === 409),
      statuses.join(','),
    );
    assert.equal(statuses.filter((s) => s === 201).length, 1, statuses.join(','));
    assert.ok(
      results
        .filter((r) => r.status === 409)
        .every((r) => r.body.error.code === 'IDEMPOTENCY_IN_PROGRESS'),
    );
    const rows = await facts(who.body.hold.holdId);
    assert.equal(rows.length, 1);
    const done = await until(async () => {
      const [row] = await facts(who.body.hold.holdId);
      return row?.status === 'CONFIRMED' ? row : undefined;
    });
    assert.equal(done.events, 1);
  } finally {
    await a.kill();
    await b.kill();
  }
});

test('PostgreSQL restart mid-saga and a SIGKILLed worker: the saga resumes and finishes exactly once', async () => {
  const who = customer();
  // Billing is down for the inline attempt: the saga is persisted and waits.
  doubles.failNext.set('billing', { status: 503, times: 1_000 });
  const api = await startApi(ports[0]);
  let first;
  try {
    first = await post(ports[0], who, `pg-${randomUUID()}`);
  } finally {
    await api.kill();
  }
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.confirmation, 'PENDING');

  const doomed = startProcess(WORKER, env, ['--interval-ms', '100']);
  await doomed.waitFor((l) => l.msg === 'saga_pass');
  await doomed.kill();
  await dockerRestart(context.containers.postgres);
  await until(async () => (await db.query('SELECT 1')).rowCount === 1, 60_000);

  doubles.failNext.delete('billing');
  const worker = startProcess(WORKER, env, ['--interval-ms', '100']);
  try {
    const done = await until(async () => {
      const [row] = await facts(who.body.hold.holdId);
      return row?.status === 'CONFIRMED' ? row : undefined;
    }, 60_000);
    assert.equal(done.events, 1);
    assert.equal(doubles.obligations.size >= 1, true);
  } finally {
    await worker.kill();
  }
  const [row] = await facts(who.body.hold.holdId);
  assert.equal(
    row.status,
    'CONFIRMED',
    'still exactly one confirmed booking after all disruptions',
  );
});
