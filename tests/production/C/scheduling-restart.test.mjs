/**
 * Scheduling restart safety on real infrastructure (scheduling.v1 surface).
 *
 * Runs the COMPILED service (services/scheduling/dist/main.js) and the compiled
 * hold-expiry worker as real OS processes against the lane PostgreSQL, kills
 * them with SIGKILL (no shutdown hooks) and restarts the database container.
 * Invariants checked after every disruption are read straight from the tables.
 * Identity is the lane HTTP double (token -> session view), declared in evidence.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from '../../../services/scheduling/node_modules/pg/lib/index.js';
import {
  ROOT,
  digest,
  dockerRestart,
  freePort,
  identityDouble,
  readContext,
  startProcess,
  waitHttp,
} from './_support.mjs';

const MAIN = path.join(ROOT, 'services', 'scheduling', 'dist', 'main.js');
const WORKER = path.join(ROOT, 'services', 'scheduling', 'dist', 'workers', 'hold-expiry.main.js');
const SERVICE_TOKEN = 'k'.repeat(48);
const OPS_TOKEN = 'operations-token-restart';
const GUESTS = Array.from({ length: 120 }, (_, i) => ({
  token: `guest-token-restart-${String(i).padStart(4, '0')}`,
  subject: randomUUID(),
}));

let context;
let identity;
let db;
let port;
let serviceEnv;
let nextGuest = 0;

before(async () => {
  context = await readContext();
  identity = await identityDouble({
    [OPS_TOKEN]: {
      subject: randomUUID(),
      principalKind: 'account',
      permissions: ['operations.dispatch'],
    },
    ...Object.fromEntries(
      GUESTS.map((g) => [
        g.token,
        { subject: g.subject, principalKind: 'guest', permissions: ['bookings.create:self'] },
      ]),
    ),
  });
  db = new pg.Pool({
    connectionString: context.databases.scheduling.appUrl.replace('?schema=app', ''),
    max: 2,
  });
  // The suite restarts PostgreSQL on purpose; idle clients then report the
  // termination, which is expected here and must not crash the runner.
  db.on('error', () => {});
  port = await freePort();
  serviceEnv = {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_URL: context.databases.scheduling.appUrl,
    IDENTITY_URL: identity.url,
    SCHEDULING_USER_REQUESTS_PER_MINUTE: '1000',
    SCHEDULING_SERVICE_CLIENTS: JSON.stringify([
      { id: 'booking', tokenSha256: digest(SERVICE_TOKEN), scopes: ['scheduling.hold.commit'] },
    ]),
  };
});

after(async () => {
  await db?.end();
  await identity?.close();
});

const base = () => `http://127.0.0.1:${port}/internal/v1/scheduling`;
const booking = { 'x-service-client': 'booking', 'x-service-token': SERVICE_TOKEN };
const guest = () => GUESTS[nextGuest++];

async function call(method, route, headers, body) {
  const res = await fetch(`${base()}${route}`, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function startService() {
  const proc = startProcess(MAIN, serviceEnv);
  await waitHttp(`http://127.0.0.1:${port}/health/live`, (s) => s === 200);
  return proc;
}

async function newWindow(capacity) {
  const startsAt = new Date(Date.now() + 3 * 3_600_000);
  startsAt.setUTCSeconds(0, 0);
  const zoneId = randomUUID();
  const res = await call(
    'POST',
    '/windows',
    { authorization: `Bearer ${OPS_TOKEN}` },
    {
      zoneId,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      capacity,
    },
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { windowId: res.body.windowId, zoneId, startsAt };
}

function holdRequest(g, window) {
  return {
    beneficiary: { kind: 'guest', subjectId: g.subject },
    zoneId: window.zoneId,
    startsAt: window.startsAt.toISOString(),
    durationMinutes: 30,
    quoteRef: { quoteId: randomUUID(), revision: 1 },
  };
}

const asGuest = (g, key) => ({ authorization: `Bearer ${g.token}`, 'idempotency-key': key });

/** The invariants that must survive every crash: counters match the hold rows. */
async function assertConsistent(windowId) {
  const { rows } = await db.query(
    `SELECT w.capacity, w.held, w.reserved,
            COALESCE(SUM(h.units) FILTER (WHERE h.status = 'ACTIVE'), 0)::int AS active_units,
            COALESCE(SUM(h.units) FILTER (WHERE h.status = 'CONFIRMED'), 0)::int AS confirmed_units
       FROM app.capacity_window w LEFT JOIN app.capacity_hold h ON h.window_id = w.id
      WHERE w.id = $1 GROUP BY w.id`,
    [windowId],
  );
  const [row] = rows;
  assert.equal(row.held, row.active_units, 'held counter equals ACTIVE hold units');
  assert.equal(row.reserved, row.confirmed_units, 'reserved counter equals CONFIRMED hold units');
  assert.ok(row.held + row.reserved <= row.capacity, 'never oversold');
  return row;
}

test('liveness is up while readiness honestly stays 503 (not yet accepted for production)', async () => {
  const proc = await startService();
  try {
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(ready.status, 503);
  } finally {
    await proc.kill();
  }
});

test('SIGKILL with 20 holds in flight: nothing half-written, same-key retries converge, no oversell', async () => {
  let proc = await startService();
  const window = await newWindow(5);
  const attempts = Array.from({ length: 20 }, () => ({
    g: guest(),
    key: `restart-${randomUUID()}`,
  }));
  const bodies = attempts.map(({ g }) => holdRequest(g, window));
  const inflight = attempts.map(({ g, key }, i) =>
    call('POST', '/holds', asGuest(g, key), bodies[i]).catch(() => null),
  );
  await new Promise((resolve) => setTimeout(resolve, 15));
  await proc.kill();
  const firstRound = await Promise.all(inflight);
  await assertConsistent(window.windowId);

  proc = await startService();
  try {
    // Every caller retries with the SAME key and body after the crash.
    const retried = await Promise.all(
      attempts.map(({ g, key }, i) => call('POST', '/holds', asGuest(g, key), bodies[i])),
    );
    const won = retried.filter((r) => r.status === 201);
    const lost = retried.filter((r) => r.status === 422);
    assert.equal(won.length, 5, 'exactly the capacity');
    assert.equal(lost.length, 15);
    assert.ok(lost.every((r) => r.body.error.reason === 'SLOT_UNAVAILABLE'));
    for (const [i, res] of firstRound.entries()) {
      if (res && res.status === 201) assert.equal(retried[i].body.holdId, res.body.holdId);
    }
    const state = await assertConsistent(window.windowId);
    assert.equal(state.held, 5);
  } finally {
    await proc.kill();
  }
});

test('SIGKILL during commit: Booking retries with a new key and exactly one reservation exists', async () => {
  let proc = await startService();
  const window = await newWindow(1);
  const g = guest();
  const created = await call(
    'POST',
    '/holds',
    asGuest(g, `c-${randomUUID()}`),
    holdRequest(g, window),
  );
  assert.equal(created.status, 201);
  const bookingId = randomUUID();
  const body = { expectedRevision: 1, bookingId };
  const inflight = Array.from({ length: 5 }, () =>
    call(
      'POST',
      `/holds/${created.body.holdId}/commit`,
      { ...booking, 'idempotency-key': `commit-${randomUUID()}` },
      body,
    ).catch(() => null),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  await proc.kill();
  await Promise.all(inflight);
  await assertConsistent(window.windowId);
  proc = await startService();
  try {
    // The response was lost: Booking does not know the outcome and retries.
    const retry = await call(
      'POST',
      `/holds/${created.body.holdId}/commit`,
      { ...booking, 'idempotency-key': `commit-${randomUUID()}` },
      body,
    );
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.state, 'COMMITTED');
    assert.equal(retry.body.bookingId, bookingId);
    const state = await assertConsistent(window.windowId);
    assert.equal(state.reserved, 1);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM app.outbox_message
        WHERE (payload::jsonb -> 'aggregate' ->> 'id') = $1
          AND (payload::jsonb -> 'data' ->> 'state') = 'COMMITTED'`,
      [created.body.holdId],
    );
    assert.equal(rows[0].n, 1, 'one COMMITTED event despite the crash and retries');
  } finally {
    await proc.kill();
  }
});

test('expiry worker killed mid-sweep: a second worker finishes, every hold expires exactly once', async () => {
  const proc = await startService();
  const windows = [];
  const holdIds = [];
  try {
    for (let w = 0; w < 4; w += 1) {
      const window = await newWindow(5);
      windows.push(window.windowId);
      for (let h = 0; h < 5; h += 1) {
        const g = guest();
        const res = await call(
          'POST',
          '/holds',
          asGuest(g, `sweep-${randomUUID()}`),
          holdRequest(g, window),
        );
        assert.equal(res.status, 201, JSON.stringify(res.body));
        holdIds.push(res.body.holdId);
      }
    }
  } finally {
    await proc.kill();
  }
  // Fixture shortcut standing in for 10 min of wall-clock time: move the
  // deadlines into the past. The worker uses the real system clock.
  await db.query(
    `UPDATE app.capacity_hold SET expires_at = now() - interval '1 second' WHERE id = ANY($1::uuid[])`,
    [holdIds],
  );

  // Worker A handles one window per pass and is killed right after its first pass.
  const first = startProcess(WORKER, { DATABASE_URL: context.databases.scheduling.appUrl }, [
    '--batch',
    '1',
    '--interval-ms',
    '50',
  ]);
  const pass = await first.waitFor((l) => l.msg === 'expiry_pass' && l.units > 0);
  await first.kill();
  assert.ok(pass.units >= 1);

  const second = startProcess(WORKER, { DATABASE_URL: context.databases.scheduling.appUrl }, [
    '--batch',
    '50',
    '--interval-ms',
    '50',
  ]);
  try {
    await second.waitFor((l) => l.msg === 'expiry_pass' && l.units === 0, 30_000);
  } finally {
    await second.kill();
  }
  const { rows } = await db.query(
    `SELECT status, count(*)::int AS n FROM app.capacity_hold WHERE id = ANY($1::uuid[]) GROUP BY 1`,
    [holdIds],
  );
  assert.deepEqual(rows, [{ status: 'EXPIRED', n: 20 }]);
  const events = await db.query(
    `SELECT count(*)::int AS n FROM app.outbox_message
      WHERE (payload::jsonb -> 'data' ->> 'state') = 'EXPIRED'
        AND (payload::jsonb -> 'aggregate' ->> 'id') = ANY($1::text[])`,
    [holdIds],
  );
  assert.equal(events.rows[0].n, 20, 'one expiry event per hold, none duplicated by the crash');
  for (const windowId of windows) assert.equal((await assertConsistent(windowId)).held, 0);
});

test('PostgreSQL restart: requests fail during the outage (never fake success) and recover without a service restart', async () => {
  const proc = await startService();
  try {
    // Large enough that load during the outage can never exhaust it.
    const window = await newWindow(500);
    const restart = dockerRestart(context.containers.postgres);
    const during = [];
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && nextGuest < GUESTS.length - 10) {
      const g = guest();
      const key = `pg-${randomUUID()}`;
      const body = holdRequest(g, window);
      const res = await call('POST', '/holds', asGuest(g, key), body).catch(() => ({
        status: 0,
        body: null,
      }));
      during.push({ g, key, body, res });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await restart;
    let recovered = null;
    for (let i = 0; i < 60 && !recovered; i += 1) {
      const g = GUESTS[GUESTS.length - 1 - (i % 10)];
      const res = await call(
        'POST',
        '/holds',
        asGuest(g, `pg-after-${randomUUID()}`),
        holdRequest(g, window),
      ).catch(() => null);
      if (res && res.status === 201) recovered = res;
      else await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(recovered, 'the service recovered without being restarted');
    const failed = during.filter((d) => d.res.status !== 201);
    assert.ok(
      failed.every((d) => d.res.status === 0 || d.res.status >= 500),
      'outage surfaces as 5xx, not 2xx/4xx',
    );
    for (const d of during.filter((x) => x.res.status === 201)) {
      const { rows } = await db.query(`SELECT 1 FROM app.capacity_hold WHERE id = $1`, [
        d.res.body.holdId,
      ]);
      assert.equal(rows.length, 1, 'an acknowledged hold is durable');
    }
    for (const d of failed) {
      const retry = await call('POST', '/holds', asGuest(d.g, d.key), d.body);
      assert.equal(retry.status, 201, `retry after outage: ${JSON.stringify(retry.body)}`);
    }
    await assertConsistent(window.windowId);
  } finally {
    await proc.kill();
  }
});
