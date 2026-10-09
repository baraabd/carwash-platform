/**
 * Media restart safety on real infrastructure (PostgreSQL 16 + SeaweedFS S3).
 *
 * Runs the COMPILED service (services/media/dist/main.js) and the compiled
 * purge worker as real OS processes, kills them with SIGKILL (no shutdown
 * hooks, no finally blocks) in the middle of finalizes, reservations and a
 * purge sweep, restarts them, and checks from the tables and the object store
 * that no transition was lost or duplicated.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from '../../../services/media/node_modules/pg/lib/index.js';
import {
  ROOT,
  freePort,
  identityDouble,
  readContext,
  serviceDist,
  startProcess,
  waitHttp,
} from './_support.mjs';

const { MediaService, mediaPolicy } = serviceDist('media', 'application/index.js');
const { PrismaService } = serviceDist('media', 'infrastructure/persistence/prisma.service.js');
const { PrismaMediaStore } = serviceDist(
  'media',
  'infrastructure/persistence/prisma-media.store.js',
);
const { S3ObjectStore } = serviceDist('media', 'infrastructure/storage/s3-object-store.js');
const { uuidGenerator } = serviceDist('media', 'infrastructure/runtime/system.js');
const { objectKey, stagingKey } = serviceDist('media', 'domain/index.js');

const MAIN = path.join(ROOT, 'services', 'media', 'dist', 'main.js');
const WORKER = path.join(ROOT, 'services', 'media', 'dist', 'workers', 'purge.main.js');
const TECHS = Array.from({ length: 12 }, (_, i) => ({
  token: `technician-token-media-restart-${String(i).padStart(2, '0')}`,
  subject: randomUUID(),
}));

let context;
let identity;
let db;
let prisma;
let s3;
let port;
let env;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function jpeg(size) {
  const body = Buffer.alloc(size, size % 251);
  body.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return body;
}

before(async () => {
  context = await readContext();
  identity = await identityDouble(
    Object.fromEntries(
      TECHS.map((t) => [
        t.token,
        { subject: t.subject, permissions: ['work.read:assigned', 'work.execute:assigned'] },
      ]),
    ),
  );
  const bucket = `media-restart-${context.runId}`;
  const s3Config = {
    endpoint: context.s3.endpoint,
    region: context.s3.region,
    bucket,
    accessKeyId: context.s3.accessKeyId,
    secretAccessKey: context.s3.secretAccessKey,
    requestTimeoutMs: 5_000,
    maxConcurrentReads: 4,
  };
  s3 = new S3ObjectStore(s3Config);
  await s3.createBucketIfMissing();
  db = new pg.Pool({
    connectionString: context.databases.media.appUrl.replace('?schema=app', ''),
    max: 2,
  });
  prisma = new PrismaService(context.databases.media.appUrl);
  port = await freePort();
  env = {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_URL: context.databases.media.appUrl,
    IDENTITY_URL: identity.url,
    MEDIA_USER_REQUESTS_PER_MINUTE: '1000',
    MEDIA_S3_ENDPOINT: s3Config.endpoint,
    MEDIA_S3_REGION: s3Config.region,
    MEDIA_S3_BUCKET: bucket,
    MEDIA_S3_ACCESS_KEY_ID: s3Config.accessKeyId,
    MEDIA_S3_SECRET_ACCESS_KEY: s3Config.secretAccessKey,
  };
});

after(async () => {
  await db?.end();
  await prisma?.client.$disconnect();
  await identity?.close();
});

const base = () => `http://127.0.0.1:${port}/internal/v1/media`;

async function call(method, route, headers, body) {
  const res = await fetch(`${base()}${route}`, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function startService() {
  const proc = startProcess(MAIN, env);
  await waitHttp(`http://127.0.0.1:${port}/health/live`, (s) => s === 200);
  return proc;
}

function declare(bytes) {
  return {
    purpose: 'WORK_EVIDENCE',
    contentType: 'image/jpeg',
    byteLength: bytes.length,
    sha256: sha(bytes),
  };
}

/** The HTTP client computes Content-Length itself; it is signed, so it must match. */
function withoutLength(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'content-length'));
}

async function put(upload, bytes) {
  const headers = withoutLength(upload.headers);
  const res = await fetch(upload.url, { method: 'PUT', headers, body: bytes });
  await res.arrayBuffer();
  return res.status;
}

/** Row-level invariants that must survive every crash. */
async function assertConsistent(ids) {
  const { rows } = await db.query(
    `SELECT o.id::text, o.status, o.version,
            count(a.*) FILTER (WHERE a.action = 'media.finalized')::int AS finalized,
            count(a.*) FILTER (WHERE a.action = 'media.rejected')::int AS rejected
       FROM app.media_object o LEFT JOIN app.audit_entry a ON a.target_id = o.id
      WHERE o.id = ANY($1::uuid[]) GROUP BY o.id`,
    [ids],
  );
  assert.equal(rows.length, ids.length);
  for (const row of rows) {
    assert.equal(row.rejected, 0, row.id);
    if (row.status === 'RESERVED') {
      assert.equal(row.version, 1, `untouched ${row.id}`);
      assert.equal(row.finalized, 0, `no audit without a transition ${row.id}`);
    } else {
      assert.equal(row.status, 'AVAILABLE');
      assert.equal(row.version, 2, `exactly one transition ${row.id}`);
      assert.equal(row.finalized, 1, `exactly one audit ${row.id}`);
    }
  }
  return rows;
}

test('liveness is up while readiness honestly stays 503 (media.v1 not yet published)', async () => {
  const proc = await startService();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/health/ready`)).status, 503);
  } finally {
    await proc.kill();
  }
});

test('SIGKILL with finalizes in flight: nothing half-written, retries with the same keys converge', async (t) => {
  let proc = await startService();
  const jobs = [];
  for (const [i, tech] of TECHS.entries()) {
    const bytes = jpeg(48 * 1024 + i);
    const headers = { authorization: `Bearer ${tech.token}` };
    const ticket = await call(
      'POST',
      '/uploads',
      { ...headers, 'idempotency-key': `r-${randomUUID()}` },
      declare(bytes),
    );
    assert.equal(ticket.status, 201);
    assert.equal(await put(ticket.body.upload, bytes), 200);
    jobs.push({ id: ticket.body.objectId, bytes, headers, key: `f-${randomUUID()}` });
  }
  const inflight = jobs.map((job) =>
    call('POST', `/objects/${job.id}/finalize`, {
      ...job.headers,
      'idempotency-key': job.key,
    }).catch(() => null),
  );
  // Kill as soon as the first transition is durable, so the crash lands with
  // some finalizes committed and others in their read/verify/write phase.
  const deadline = Date.now() + 15_000;
  let committed = 0;
  while (committed === 0 && Date.now() < deadline) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM app.media_object WHERE id = ANY($1::uuid[]) AND status = 'AVAILABLE'`,
      [jobs.map((j) => j.id)],
    );
    committed = rows[0].n;
  }
  await proc.kill();
  const firstRound = await Promise.all(inflight);
  const done = firstRound.filter((r) => r?.status === 200).length;
  const { rows: atKill } = await db.query(
    `SELECT count(*)::int AS n FROM app.media_object WHERE id = ANY($1::uuid[]) AND status = 'AVAILABLE'`,
    [jobs.map((j) => j.id)],
  );
  t.diagnostic(
    `at SIGKILL: ${atKill[0].n}/${jobs.length} committed, ${done} acknowledged to the client`,
  );
  assert.ok(atKill[0].n < jobs.length, 'the crash interrupted work in flight');
  await assertConsistent(jobs.map((j) => j.id));

  proc = await startService();
  try {
    const retried = await Promise.all(
      jobs.map((job) =>
        call('POST', `/objects/${job.id}/finalize`, { ...job.headers, 'idempotency-key': job.key }),
      ),
    );
    assert.ok(
      retried.every((r) => r.status === 200 && r.body.status === 'AVAILABLE'),
      JSON.stringify(retried.map((r) => [r.status, r.body?.error?.reason])),
    );
    const rows = await assertConsistent(jobs.map((j) => j.id));
    assert.ok(rows.every((r) => r.status === 'AVAILABLE'));
    for (const job of jobs) {
      const stored = await s3.read(objectKey(job.id), job.bytes.length + 1);
      assert.equal(stored.kind, 'FOUND');
      assert.ok(Buffer.from(stored.bytes).equals(job.bytes), 'final bytes are the verified ones');
    }
  } finally {
    await proc.kill();
  }
});

test('SIGKILL with reservations in flight: each key yields at most one object, retries return it', async () => {
  let proc = await startService();
  const jobs = TECHS.map((tech, i) => ({
    tech,
    bytes: jpeg(1_000 + i),
    key: `res-${randomUUID()}`,
  }));
  const send = (job) =>
    call(
      'POST',
      '/uploads',
      { authorization: `Bearer ${job.tech.token}`, 'idempotency-key': job.key },
      declare(job.bytes),
    );
  const inflight = jobs.map((job) => send(job).catch(() => null));
  await new Promise((resolve) => setTimeout(resolve, 15));
  await proc.kill();
  const firstRound = await Promise.all(inflight);
  proc = await startService();
  try {
    const retried = await Promise.all(jobs.map(send));
    assert.ok(retried.every((r) => r.status === 201 || r.status === 200));
    for (const [i, job] of jobs.entries()) {
      if (firstRound[i]?.status === 201) assert.equal(retried[i].status, 200);
      if (firstRound[i]?.body?.objectId)
        assert.equal(retried[i].body.objectId, firstRound[i].body.objectId);
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM app.media_object WHERE owner_subject = $1 AND sha256 = $2`,
        [job.tech.subject, sha(job.bytes)],
      );
      assert.equal(rows[0].n, 1, 'exactly one object per idempotency key');
    }
  } finally {
    await proc.kill();
  }
});

test('purge worker killed mid-sweep: a second pair finishes, every object purged exactly once', async () => {
  const then = new Date(Date.now() - 4 * 24 * 3_600_000);
  const store = new PrismaMediaStore(prisma);
  const lib = new MediaService(
    store,
    store,
    s3,
    { now: () => new Date(then) },
    uuidGenerator,
    mediaPolicy(),
  );
  const owner = {
    actor: { kind: 'USER', subject: TECHS[0].subject, permissions: ['work.execute:assigned'] },
    correlationId: randomUUID(),
  };
  const ids = [];
  for (let i = 0; i < 10; i += 1) {
    const bytes = jpeg(2_000 + i);
    const { value } = await lib.reserve(owner, declare(bytes), `lib-${randomUUID()}`);
    const id = value.record.object.id;
    const ticket = s3.presignUpload(
      stagingKey(id),
      { contentType: 'image/jpeg', contentLength: bytes.length, sha256Hex: sha(bytes) },
      new Date(Date.now() + 60_000),
      new Date(),
    );
    assert.equal(await put(ticket, bytes), 200);
    await lib.finalize(owner, id, `lib-${randomUUID()}`);
    ids.push(id);
  }
  const workerEnv = { ...env };
  delete workerEnv.PORT;
  const first = startProcess(WORKER, workerEnv, ['--batch', '1', '--interval-ms', '50']);
  const pass = await first.waitFor((l) => l.msg === 'purge_pass' && l.purged > 0, 60_000);
  await first.kill();
  assert.ok(pass.purged >= 1);

  const second = startProcess(WORKER, workerEnv, ['--batch', '50', '--interval-ms', '50']);
  const third = startProcess(WORKER, workerEnv, ['--batch', '50', '--interval-ms', '50']);
  const idle = (l) => l.msg === 'purge_pass' && l.purged === 0 && l.expired === 0 && l.swept === 0;
  try {
    await second.waitFor(idle, 60_000);
    await third.waitFor(idle, 60_000);
  } finally {
    await second.kill();
    await third.kill();
  }
  const { rows } = await db.query(
    `SELECT status, count(*)::int AS n FROM app.media_object WHERE id = ANY($1::uuid[]) GROUP BY 1`,
    [ids],
  );
  assert.deepEqual(rows, [{ status: 'PURGED', n: ids.length }]);
  const audits = await db.query(
    `SELECT target_id::text, count(*)::int AS n FROM app.audit_entry
      WHERE action = 'media.purged' AND target_id = ANY($1::uuid[]) GROUP BY 1`,
    [ids],
  );
  assert.equal(audits.rows.length, ids.length);
  assert.ok(
    audits.rows.every((r) => r.n === 1),
    'one purge per object, none duplicated by the crash',
  );
  for (const id of ids) assert.equal((await s3.read(objectKey(id), 10)).kind, 'MISSING');
});
