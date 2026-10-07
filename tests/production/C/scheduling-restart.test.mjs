/**
 * Scheduling restart safety on real infrastructure.
 *
 * Runs the COMPILED service (services/scheduling/dist/main.js) and the compiled
 * hold-expiry worker as real OS processes against the lane PostgreSQL, kills
 * them with SIGKILL (no shutdown hooks) and restarts the database container.
 * Invariants checked after every disruption are read straight from the tables.
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

let context;
let identity;
let db;
let port;
let serviceEnv;

before(async () => {
  context = await readContext();
  identity = await identityDouble({
    [OPS_TOKEN]: { subject: randomUUID(), permissions: ['operations.dispatch'] },
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
    SCHEDULING_SERVICE_CLIENTS: JSON.stringify([
      { id: 'booking', tokenSha256: digest(SERVICE_TOKEN), scopes: ['scheduling.holds.write'] },
    ]),
  };
});

after(async () => {
  await db?.end();
  await identity?.close();
});

const base = () => `http://127.0.0.1:${port}/internal/v1/scheduling`;
const booking = { 'x-service-client': 'booking', 'x-service-token': SERVICE_TOKEN };

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
  startsAt.setUTCMilliseconds(0);
  const res = await call(
    'POST',
    '/windows',
    { authorization: `Bearer ${OPS_TOKEN}` },
    {
      zoneId: randomUUID(),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      capacity,
    },
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.windowId;
}

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

test('SIGKILL with 20 acquisitions in flight: nothing half-written, retries converge, no oversell', async () => {
  let proc = await startService();
  const windowId = await newWindow(5);
  const keys = Array.from({ length: 20 }, () => `restart-${randomUUID()}`);
  const holders = keys.map(() => randomUUID());
  const inflight = keys.map((key, i) =>
    call(
      'POST',
      '/holds',
      { ...booking, 'idempotency-key': key },
      { windowId, holderRef: holders[i], units: 1 },
    ).catch(() => null),
  );
  await new Promise((resolve) => setTimeout(resolve, 15));
  await proc.kill();
  const firstRound = await Promise.all(inflight);
  await assertConsistent(windowId);

  proc = await startService();
  try {
    // The caller retries every request with the SAME key after the crash.
    const retried = await Promise.all(
      keys.map((key, i) =>
        call(
          'POST',
          '/holds',
          { ...booking, 'idempotency-key': key },
          { windowId, holderRef: holders[i], units: 1 },
        ),
      ),
    );
    const won = retried.filter((r) => r.status === 200 || r.status === 201);
    const lost = retried.filter((r) => r.status === 409);
    assert.equal(won.length, 5, 'exactly the capacity');
    assert.equal(lost.length, 15);
    assert.ok(lost.every((r) => r.body.error.code === 'CAPACITY_EXHAUSTED'));
    // Every hold acknowledged before the crash is still the same hold after it.
    for (const [i, res] of firstRound.entries()) {
      if (res && (res.status === 201 || res.status === 200))
        assert.equal(retried[i].body.holdId, res.body.holdId);
    }
    const { rows } = await db.query(
      `SELECT idempotency_key, count(*)::int AS n FROM app.capacity_hold WHERE window_id = $1 GROUP BY 1 HAVING count(*) > 1`,
      [windowId],
    );
    assert.deepEqual(rows, [], 'one hold per idempotency key');
    const state = await assertConsistent(windowId);
    assert.equal(state.held, 5);
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
      const windowId = await newWindow(5);
      windows.push(windowId);
      for (let h = 0; h < 5; h += 1) {
        const res = await call(
          'POST',
          '/holds',
          { ...booking, 'idempotency-key': `sweep-${randomUUID()}` },
          {
            windowId,
            holderRef: randomUUID(),
            units: 1,
            ttlSeconds: 60,
          },
        );
        assert.equal(res.status, 201);
        holdIds.push(res.body.holdId);
      }
    }
  } finally {
    await proc.kill();
  }
  // Fixture shortcut standing in for 60 s of wall-clock time: move the
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
  const pass = await first.waitFor((l) => l.msg === 'expiry_pass' && l.holds > 0);
  await first.kill();
  assert.ok(pass.holds >= 1);

  const second = startProcess(WORKER, { DATABASE_URL: context.databases.scheduling.appUrl }, [
    '--batch',
    '50',
    '--interval-ms',
    '50',
  ]);
  try {
    await second.waitFor((l) => l.msg === 'expiry_pass' && l.holds === 0, 30_000);
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
      WHERE event_type = 'scheduling.hold-expired.v1' AND (payload::jsonb -> 'data' ->> 'holdId') = ANY($1::text[])`,
    [holdIds],
  );
  assert.equal(events.rows[0].n, 20, 'one expiry event per hold, none duplicated by the crash');
  for (const windowId of windows) assert.equal((await assertConsistent(windowId)).held, 0);
});

test('PostgreSQL restart: requests fail during the outage (never fake success) and recover without a service restart', async () => {
  const proc = await startService();
  try {
    // Large enough that load during the outage can never exhaust it.
    const windowId = await newWindow(500);
    const restart = dockerRestart(context.containers.postgres);
    const during = [];
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const key = `pg-${randomUUID()}`;
      const holderRef = randomUUID();
      const res = await call(
        'POST',
        '/holds',
        { ...booking, 'idempotency-key': key },
        { windowId, holderRef, units: 1 },
      ).catch(() => ({ status: 0, body: null }));
      during.push({ key, holderRef, res });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await restart;
    // Recovery: the same process serves again once the pool reconnects.
    let recovered = null;
    for (let i = 0; i < 60 && !recovered; i += 1) {
      const res = await call(
        'POST',
        '/holds',
        { ...booking, 'idempotency-key': `pg-after-${randomUUID()}` },
        {
          windowId,
          holderRef: randomUUID(),
          units: 1,
        },
      ).catch(() => null);
      if (res && res.status === 201) recovered = res;
      else await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(recovered, 'the service recovered without being restarted');
    // Every success that was reported must exist; every failure must be retryable.
    const failed = during.filter((d) => d.res.status !== 201 && d.res.status !== 200);
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
      const retry = await call(
        'POST',
        '/holds',
        { ...booking, 'idempotency-key': d.key },
        { windowId, holderRef: d.holderRef, units: 1 },
      );
      assert.ok(
        retry.status === 201 || retry.status === 200,
        `retry after outage: ${retry.status}`,
      );
    }
    await assertConsistent(windowId);
  } finally {
    await proc.kill();
  }
});
