/**
 * Dispatch restart safety on real infrastructure.
 *
 * Runs the COMPILED service (services/dispatch/dist/main.js) and the compiled
 * offer-expiry worker as real OS processes against the lane PostgreSQL, kills
 * them with SIGKILL (no shutdown hooks) and restarts the database container.
 * Invariants checked after every disruption are read straight from the tables.
 * Jobs are opened through the real inbox path (published hold-changed parser).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from '../../../services/dispatch/node_modules/pg/lib/index.js';
import {
  ROOT,
  digest,
  dockerRestart,
  freePort,
  identityDouble,
  readContext,
  serviceDist,
  startProcess,
  waitHttp,
} from './_support.mjs';
import { startWorkforceDouble } from './support/dispatch-workforce-double.mjs';

const { PrismaService } = serviceDist('dispatch', 'infrastructure/persistence/prisma.service.js');
const { PrismaDispatchStore } = serviceDist(
  'dispatch',
  'infrastructure/persistence/prisma-dispatch.store.js',
);
const { holdChangedConsumerParts } = serviceDist(
  'dispatch',
  'transport/messaging/hold-changed.consumer.js',
);
const { systemClock, uuidGenerator } = serviceDist('dispatch', 'infrastructure/runtime/system.js');

const MAIN = path.join(ROOT, 'services', 'dispatch', 'dist', 'main.js');
const WORKER = path.join(ROOT, 'services', 'dispatch', 'dist', 'workers', 'offer-expiry.main.js');
const OPS_TOKEN = 'operations-token-restart';
const SERVICE_TOKEN = 'k'.repeat(48);
const TECHS = Array.from({ length: 12 }, (_, i) => ({
  token: `technician-token-restart-${String(i).padStart(2, '0')}`,
  subject: randomUUID(),
}));

let context;
let identity;
let db;
let prisma;
let parts;
let port;
let serviceEnv;
let workforce;

before(async () => {
  context = await readContext();
  identity = await identityDouble({
    [OPS_TOKEN]: { subject: randomUUID(), permissions: ['operations.dispatch'] },
    ...Object.fromEntries(
      TECHS.map((t) => [
        t.token,
        { subject: t.subject, permissions: ['work.read:assigned', 'work.execute:assigned'] },
      ]),
    ),
  });
  db = new pg.Pool({
    connectionString: context.databases.dispatch.appUrl.replace('?schema=app', ''),
    max: 2,
  });
  // The suite restarts PostgreSQL on purpose; idle clients then report the
  // termination, which is expected here and must not crash the runner.
  db.on('error', () => {});
  prisma = new PrismaService(context.databases.dispatch.appUrl);
  parts = holdChangedConsumerParts(new PrismaDispatchStore(prisma), systemClock, uuidGenerator);
  workforce = await startWorkforceDouble();
  port = await freePort();
  serviceEnv = {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_URL: context.databases.dispatch.appUrl,
    IDENTITY_URL: identity.url,
    DISPATCH_USER_REQUESTS_PER_MINUTE: '1000',
    ...workforce.env(),
    DISPATCH_SERVICE_CLIENTS: JSON.stringify([
      { id: 'booking', tokenSha256: digest(SERVICE_TOKEN), scopes: ['dispatch.assignment.read'] },
    ]),
  };
});

after(async () => {
  await db?.end();
  await prisma?.client.$disconnect();
  await identity?.close();
  await workforce?.close();
});

const base = () => `http://127.0.0.1:${port}/internal/v1/dispatch`;
const OPS = { authorization: `Bearer ${OPS_TOKEN}` };

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

/** Opens a job exactly as a committed-hold message from RabbitMQ would. */
async function openJob(offsetHours) {
  const startsAt = new Date(Date.now() + offsetHours * 3_600_000);
  const bookingId = randomUUID();
  const raw = {
    eventId: randomUUID(),
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: randomUUID(), version: 2 },
    actor: { kind: 'service', id: 'booking' },
    data: {
      state: 'COMMITTED',
      zoneId: randomUUID(),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      bookingId,
    },
  };
  const body = JSON.stringify(raw);
  const message = parts.parse(JSON.parse(body));
  const outcome = await parts.store.applyOnce(
    {
      eventId: message.eventId,
      eventType: message.eventType,
      payloadHash: createHash('sha256').update(body).digest('hex'),
      correlationId: message.correlationId,
    },
    (tx) => parts.effect(message, tx),
  );
  assert.equal(outcome, 'APPLIED');
  const { rows } = await db.query(`SELECT id::text FROM app.assignment WHERE booking_id = $1`, [
    bookingId,
  ]);
  return rows[0].id;
}

async function offer(assignmentId, tech, ttlSeconds) {
  const res = await call(
    'POST',
    `/assignments/${assignmentId}/offers`,
    { ...OPS, 'idempotency-key': `offer-${randomUUID()}` },
    {
      expectedRevision: 1,
      resourceId: workforce.resource(),
      technicianSubjectId: tech.subject,
      ...(ttlSeconds ? { ttlSeconds } : {}),
    },
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.offer.offerId;
}

/** Row-level invariants that must survive every crash. */
async function assertConsistent(assignmentIds) {
  const { rows } = await db.query(
    `SELECT a.id::text, a.status, a.resource_id::text,
            count(o.*) FILTER (WHERE o.status = 'OFFERED')::int AS live,
            count(o.*) FILTER (WHERE o.status = 'ACCEPTED')::int AS accepted
       FROM app.assignment a LEFT JOIN app.dispatch_offer o ON o.assignment_id = a.id
      WHERE a.id = ANY($1::uuid[]) GROUP BY a.id`,
    [assignmentIds],
  );
  for (const row of rows) {
    assert.equal(row.status === 'OFFERED', row.live === 1, `live offer matches state ${row.id}`);
    assert.equal(
      row.status === 'ASSIGNED',
      row.accepted === 1,
      `accepted offer matches state ${row.id}`,
    );
    assert.ok(row.live <= 1 && row.accepted <= 1);
  }
  return rows;
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

test('SIGKILL with accepts in flight: nothing half-written, retries with the same keys converge', async (t) => {
  let proc = await startService();
  const jobs = [];
  for (const [i, tech] of TECHS.entries()) {
    const assignmentId = await openJob(20 + i * 2);
    jobs.push({
      assignmentId,
      tech,
      offerId: await offer(assignmentId, tech),
      key: `accept-${randomUUID()}`,
    });
  }
  const inflight = jobs.map((job) =>
    call('POST', `/offers/${job.offerId}/accept`, {
      authorization: `Bearer ${job.tech.token}`,
      'idempotency-key': job.key,
    }).catch(() => null),
  );
  await new Promise((resolve) => setTimeout(resolve, 15));
  await proc.kill();
  const firstRound = await Promise.all(inflight);
  // Backends of the killed process may still hold locks "idle in transaction";
  // the service's idle_in_transaction_session_timeout is what releases them.
  const orphans = await db.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE usename = current_user AND state = 'idle in transaction' AND pid <> pg_backend_pid()`,
  );
  t.diagnostic(`orphaned idle-in-transaction sessions after SIGKILL: ${orphans.rows[0].n}`);
  await assertConsistent(jobs.map((j) => j.assignmentId));

  proc = await startService();
  try {
    const retried = await Promise.all(
      jobs.map((job) =>
        call('POST', `/offers/${job.offerId}/accept`, {
          authorization: `Bearer ${job.tech.token}`,
          'idempotency-key': job.key,
        }),
      ),
    );
    assert.ok(
      retried.every((r) => r.status === 200),
      JSON.stringify(retried.map((r) => [r.status, r.body?.error?.reason])),
    );
    assert.ok(
      retried.every((r) => r.body.status === 'ACCEPTED' && r.body.job.status === 'ASSIGNED'),
    );
    for (const [i, res] of firstRound.entries()) {
      if (res?.status === 200) assert.equal(retried[i].body.offerId, res.body.offerId);
    }
    const rows = await assertConsistent(jobs.map((j) => j.assignmentId));
    assert.ok(rows.every((r) => r.status === 'ASSIGNED'));
    const audits = await db.query(
      `SELECT target_id::text, count(*)::int AS n FROM app.audit_entry
        WHERE action = 'offer.accepted' AND target_id = ANY($1::uuid[]) GROUP BY 1`,
      [jobs.map((j) => j.offerId)],
    );
    assert.equal(audits.rows.length, jobs.length);
    assert.ok(
      audits.rows.every((r) => r.n === 1),
      'each accept happened exactly once',
    );
  } finally {
    await proc.kill();
  }
});

test('expiry worker killed mid-sweep: a second worker finishes, every offer expires exactly once', async () => {
  const proc = await startService();
  const offers = [];
  const assignments = [];
  try {
    for (let i = 0; i < 8; i += 1) {
      const assignmentId = await openJob(60 + i * 2);
      assignments.push(assignmentId);
      offers.push(await offer(assignmentId, TECHS[i], 60));
    }
  } finally {
    await proc.kill();
  }
  // Fixture shortcut standing in for 60 s of wall-clock time: move the
  // deadlines into the past. The worker uses the real system clock.
  await db.query(
    `UPDATE app.dispatch_offer SET expires_at = now() - interval '1 second' WHERE id = ANY($1::uuid[])`,
    [offers],
  );
  const env = { DATABASE_URL: context.databases.dispatch.appUrl };
  const first = startProcess(WORKER, env, ['--batch', '1', '--interval-ms', '50']);
  const pass = await first.waitFor((l) => l.msg === 'expiry_pass' && l.offers > 0);
  await first.kill();
  assert.ok(pass.offers >= 1);

  const second = startProcess(WORKER, env, ['--batch', '50', '--interval-ms', '50']);
  const third = startProcess(WORKER, env, ['--batch', '50', '--interval-ms', '50']);
  try {
    await second.waitFor((l) => l.msg === 'expiry_pass' && l.offers === 0, 30_000);
    await third.waitFor((l) => l.msg === 'expiry_pass' && l.offers === 0, 30_000);
  } finally {
    await second.kill();
    await third.kill();
  }
  const { rows } = await db.query(
    `SELECT status, count(*)::int AS n FROM app.dispatch_offer WHERE id = ANY($1::uuid[]) GROUP BY 1`,
    [offers],
  );
  assert.deepEqual(rows, [{ status: 'EXPIRED', n: offers.length }]);
  const audits = await db.query(
    `SELECT count(*)::int AS n FROM app.audit_entry WHERE action = 'offer.expired' AND target_id = ANY($1::uuid[])`,
    [offers],
  );
  assert.equal(
    audits.rows[0].n,
    offers.length,
    'one expiry per offer, none duplicated by the crash',
  );
  const states = await assertConsistent(assignments);
  assert.ok(states.every((r) => r.status === 'UNASSIGNED'));
});

test('PostgreSQL restart: commands fail during the outage (never fake success) and recover without a service restart', async () => {
  const proc = await startService();
  try {
    const pending = [];
    for (let i = 0; i < 40; i += 1) pending.push(await openJob(200 + i * 2));
    const restart = dockerRestart(context.containers.postgres);
    const during = [];
    const deadline = Date.now() + 8_000;
    let next = 0;
    while (Date.now() < deadline && next < pending.length) {
      const assignmentId = pending[next];
      next += 1;
      const key = `pg-${randomUUID()}`;
      const body = {
        expectedRevision: 1,
        resourceId: workforce.resource(),
        technicianSubjectId: TECHS[0].subject,
      };
      const res = await call(
        'POST',
        `/assignments/${assignmentId}/offers`,
        { ...OPS, 'idempotency-key': key },
        body,
      ).catch(() => ({ status: 0, body: null }));
      during.push({ assignmentId, key, body, res });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await restart;
    let recovered = false;
    for (let i = 0; i < 60 && !recovered; i += 1) {
      const res = await call('GET', `/assignments/${pending[pending.length - 1]}`, OPS).catch(
        () => null,
      );
      if (res?.status === 200) recovered = true;
      else await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(recovered, 'the service recovered without being restarted');
    const failed = during.filter((d) => d.res.status !== 201);
    assert.ok(
      failed.every((d) => d.res.status === 0 || d.res.status >= 500),
      `outage surfaces as 5xx, not 2xx/4xx: ${JSON.stringify(failed.map((d) => d.res.status))}`,
    );
    for (const d of during.filter((x) => x.res.status === 201)) {
      const { rows } = await db.query(`SELECT status FROM app.dispatch_offer WHERE id = $1`, [
        d.res.body.offer.offerId,
      ]);
      assert.equal(rows[0]?.status, 'OFFERED', 'an acknowledged offer is durable');
    }
    for (const d of during) {
      const retry = await call(
        'POST',
        `/assignments/${d.assignmentId}/offers`,
        { ...OPS, 'idempotency-key': d.key },
        d.body,
      );
      assert.ok(
        retry.status === 201 || retry.status === 200,
        `retry after outage: ${retry.status}`,
      );
      if (d.res.status === 201) assert.equal(retry.body.offer.offerId, d.res.body.offer.offerId);
    }
    await assertConsistent(during.map((d) => d.assignmentId));
  } finally {
    await proc.kill();
  }
});
