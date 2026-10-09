/**
 * Media on real infrastructure: SeaweedFS (S3 API, SigV4) + PostgreSQL 16.
 *
 * Runs the COMPILED service (services/media/dist/main.js) and the compiled
 * purge worker as OS processes. Uploads and downloads go straight to the
 * object store with the presigned requests the API hands out, exactly as a
 * browser would. The only double is Identity's session endpoint
 * (identityDouble), declared as such in the evidence.
 *
 * Time travel for retention/expiry uses the service's injected clock through
 * the compiled application library, never a rewrite of database rows (the
 * lifecycle trigger would refuse that anyway).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import pg from '../../../services/media/node_modules/pg/lib/index.js';
import {
  ROOT,
  digest,
  freePort,
  identityDouble,
  readContext,
  require,
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
const { parseApiErrorEnvelope } = require(
  path.join(ROOT, 'packages', 'contracts', 'dist', 'common', 'errors.js'),
);

const MAIN = path.join(ROOT, 'services', 'media', 'dist', 'main.js');
const WORKER = path.join(ROOT, 'services', 'media', 'dist', 'workers', 'purge.main.js');
const SERVICE_TOKEN = 'm'.repeat(48);
const TECH = { token: 'technician-token-media-s3', subject: randomUUID() };
const HOUR = 3_600_000;

let context;
let identity;
let db;
let prisma;
let s3;
let api;
let port;
let env;
let blackhole;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function jpeg(size = 4_096) {
  const body = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) body[i] = (i * 31 + size) % 251;
  body.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return body;
}

before(async () => {
  context = await readContext();
  identity = await identityDouble({
    [TECH.token]: {
      subject: TECH.subject,
      permissions: ['work.read:assigned', 'work.execute:assigned'],
    },
  });
  const bucket = `media-s3-${context.runId}`;
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
    HOST: '127.0.0.1',
    DATABASE_URL: context.databases.media.appUrl,
    IDENTITY_URL: identity.url,
    MEDIA_USER_REQUESTS_PER_MINUTE: '1000',
    MEDIA_SERVICE_CLIENTS: JSON.stringify([
      {
        id: 'dispatch',
        tokenSha256: digest(SERVICE_TOKEN),
        scopes: ['media.object.read', 'media.object.claim'],
      },
    ]),
    MEDIA_S3_ENDPOINT: s3Config.endpoint,
    MEDIA_S3_REGION: s3Config.region,
    MEDIA_S3_BUCKET: bucket,
    MEDIA_S3_ACCESS_KEY_ID: s3Config.accessKeyId,
    MEDIA_S3_SECRET_ACCESS_KEY: s3Config.secretAccessKey,
    MEDIA_S3_TIMEOUT_MS: '1500',
  };
  api = startProcess(MAIN, { ...env, PORT: String(port) });
  await waitHttp(`http://127.0.0.1:${port}/health/live`, (s) => s === 200);
});

after(async () => {
  await api?.kill();
  await db?.end();
  await prisma?.client.$disconnect();
  await identity?.close();
  await new Promise((resolve) => (blackhole ? blackhole.close(resolve) : resolve()));
});

const USER = () => ({ authorization: `Bearer ${TECH.token}` });
const DISPATCH = { 'x-service-client': 'dispatch', 'x-service-token': SERVICE_TOKEN };
const idem = () => ({ 'idempotency-key': `s3-${randomUUID()}` });

async function call(method, route, headers, body, target = port) {
  const res = await fetch(`http://127.0.0.1:${target}/internal/v1/media${route}`, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (res.status >= 400) parseApiErrorEnvelope(parsed); // the PUBLISHED envelope parser
  return { status: res.status, body: parsed };
}

function declare(bytes, contentType = 'image/jpeg') {
  return { purpose: 'WORK_EVIDENCE', contentType, byteLength: bytes.length, sha256: sha(bytes) };
}

async function reserve(bytes, contentType, target = port) {
  const res = await call(
    'POST',
    '/uploads',
    { ...USER(), ...idem() },
    declare(bytes, contentType),
    target,
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

/** The HTTP client computes Content-Length itself; it is signed, so it must match. */
function withoutLength(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'content-length'));
}

/** PUT exactly as a browser would: the signed headers, the body; length is implicit. */
async function put(upload, bytes, override = {}) {
  const headers = withoutLength(upload.headers);
  const res = await fetch(upload.url, {
    method: upload.method,
    headers: { ...headers, ...override },
    body: bytes,
  });
  const text = await res.text();
  return { status: res.status, code: /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? null };
}

async function row(id) {
  const { rows } = await db.query(
    `SELECT status, version, reject_reason FROM app.media_object WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function stored(key) {
  const result = await s3.read(key, 20 * 1024 * 1024);
  return result.kind === 'FOUND' ? Buffer.from(result.bytes) : null;
}

/** The compiled application library with a chosen clock, on the real stores. */
function libraryAt(at) {
  const store = new PrismaMediaStore(prisma);
  const clock = { now: () => new Date(at.getTime()) };
  return new MediaService(store, store, s3, clock, uuidGenerator, mediaPolicy());
}

const techMeta = () => ({
  actor: {
    kind: 'USER',
    subject: TECH.subject,
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  correlationId: randomUUID(),
});

test('presigned PUT with real bytes, finalize -> AVAILABLE; verified bytes under objects/<id>', async () => {
  const bytes = jpeg(64 * 1024);
  const ticket = await reserve(bytes);
  assert.equal(ticket.status, 'RESERVED');
  assert.equal(ticket.upload.method, 'PUT');
  assert.ok(!ticket.upload.url.includes(TECH.subject), 'no subject id in the URL');
  assert.equal(
    new URL(ticket.upload.url).pathname,
    `/media-s3-${context.runId}/uploads/${ticket.objectId}`,
  );
  assert.equal((await put(ticket.upload, bytes)).status, 200);
  const done = await call('POST', `/objects/${ticket.objectId}/finalize`, { ...USER(), ...idem() });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.status, 'AVAILABLE');
  assert.equal(done.body.revision, 2);
  assert.deepEqual(await row(ticket.objectId), {
    status: 'AVAILABLE',
    version: 2,
    reject_reason: null,
  });
  assert.ok((await stored(objectKey(ticket.objectId)))?.equals(bytes));
  assert.equal(await stored(stagingKey(ticket.objectId)), null, 'staging upload removed');
});

test('the store enforces the signed contract: wrong bytes, length, type or an expired URL are refused', async () => {
  const bytes = jpeg(2_048);
  const ticket = await reserve(bytes);
  const tampered = Buffer.from(bytes);
  tampered[1000] ^= 0xff;
  const wrongBytes = await put(ticket.upload, tampered);
  assert.equal(wrongBytes.status, 400);
  assert.equal(wrongBytes.code, 'BadDigest', 'checksum header bound to the declared SHA-256');
  assert.equal((await put(ticket.upload, Buffer.concat([bytes, Buffer.from([0])]))).status, 403);
  assert.equal((await put(ticket.upload, bytes, { 'content-type': 'image/png' })).status, 403);
  // A URL signed ten minutes ago for 60 s: the same signer the API uses.
  const past = new Date(Date.now() - 10 * 60_000);
  const stale = s3.presignUpload(
    stagingKey(ticket.objectId),
    { contentType: 'image/jpeg', contentLength: bytes.length, sha256Hex: sha(bytes) },
    new Date(past.getTime() + 60_000),
    past,
  );
  const expired = await put(stale, bytes);
  assert.equal(expired.status, 403);
  assert.equal(expired.code, 'AccessDenied');
  assert.equal(await stored(stagingKey(ticket.objectId)), null, 'nothing was stored');
  assert.deepEqual(await row(ticket.objectId), {
    status: 'RESERVED',
    version: 1,
    reject_reason: null,
  });
});

test('bytes that differ from the declaration -> REJECTED UPLOAD_MISMATCH, bytes deleted', async () => {
  const bytes = jpeg(3_000);
  const ticket = await reserve(bytes);
  // A store that did not enforce the checksum: different bytes land under the staging key.
  const other = jpeg(3_001);
  await s3.write(stagingKey(ticket.objectId), other, 'image/jpeg');
  const res = await call('POST', `/objects/${ticket.objectId}/finalize`, { ...USER(), ...idem() });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'REJECTED');
  assert.equal(res.body.rejectReason, 'UPLOAD_MISMATCH');
  assert.equal(await stored(stagingKey(ticket.objectId)), null);
  assert.equal(await stored(objectKey(ticket.objectId)), null);
  const read = await call('POST', `/objects/${ticket.objectId}/read-url`, USER());
  assert.equal(read.status, 409);
  assert.equal(read.body.error.reason, 'OBJECT_NOT_AVAILABLE');
});

test('a genuine upload of the wrong format -> REJECTED UNSUPPORTED_MEDIA, bytes deleted', async () => {
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(500, 9)]);
  const ticket = await reserve(gif, 'image/png');
  assert.equal((await put(ticket.upload, gif)).status, 200, 'the checksum matches, S3 accepts it');
  const res = await call('POST', `/objects/${ticket.objectId}/finalize`, { ...USER(), ...idem() });
  assert.equal(res.body.status, 'REJECTED');
  assert.equal(res.body.rejectReason, 'UNSUPPORTED_MEDIA');
  assert.equal(await stored(stagingKey(ticket.objectId)), null);
  assert.equal(await stored(objectKey(ticket.objectId)), null);
});

test('finalize before upload -> 409 UPLOAD_MISSING; upload and retry the same key -> AVAILABLE', async () => {
  const bytes = jpeg(5_000);
  const ticket = await reserve(bytes);
  const key = idem();
  const early = await call('POST', `/objects/${ticket.objectId}/finalize`, { ...USER(), ...key });
  assert.equal(early.status, 409);
  assert.equal(early.body.error.reason, 'UPLOAD_MISSING');
  assert.deepEqual(await row(ticket.objectId), {
    status: 'RESERVED',
    version: 1,
    reject_reason: null,
  });
  const fresh = await call('POST', `/objects/${ticket.objectId}/upload-url`, USER());
  assert.equal(fresh.status, 200);
  assert.equal((await put(fresh.body.upload, bytes)).status, 200);
  const done = await call('POST', `/objects/${ticket.objectId}/finalize`, { ...USER(), ...key });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'AVAILABLE');
});

test('read-url downloads identical bytes (owner and Dispatch); an expired read URL is refused', async () => {
  const bytes = jpeg(32 * 1024);
  const ticket = await reserve(bytes);
  assert.equal((await put(ticket.upload, bytes)).status, 200);
  await call('POST', `/objects/${ticket.objectId}/finalize`, { ...USER(), ...idem() });
  for (const headers of [USER(), DISPATCH]) {
    const read = await call('POST', `/objects/${ticket.objectId}/read-url`, headers);
    assert.equal(read.status, 200);
    assert.equal(read.body.method, 'GET');
    const ttl = Date.parse(read.body.expiresAt) - Date.now();
    assert.ok(ttl > 50_000 && ttl <= 300_000, `TTL within 60..300 s: ${ttl}`);
    const res = await fetch(read.body.url);
    assert.equal(res.status, 200);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(bytes));
  }
  const past = new Date(Date.now() - 10 * 60_000);
  const stale = s3.presignDownload(
    objectKey(ticket.objectId),
    new Date(past.getTime() + 60_000),
    past,
  );
  const refused = await fetch(stale.url);
  assert.equal(refused.status, 403);
  const anonymous = await fetch(
    `${context.s3.endpoint}/media-s3-${context.runId}/${objectKey(ticket.objectId)}`,
  );
  assert.equal(anonymous.status, 403, 'the bucket is private');
});

test('purge worker deletes the bytes of unclaimed old evidence; claimed evidence and its bytes stay', async () => {
  // Finalized three days ago through the compiled library with an injected clock.
  const then = new Date(Date.now() - 72 * HOUR);
  const lib = libraryAt(then);
  const make = async () => {
    const bytes = jpeg(1_500 + Math.floor(Math.random() * 500));
    const { value } = await lib.reserve(techMeta(), declare(bytes), `lib-${randomUUID()}`);
    const id = value.record.object.id;
    // Upload with a URL signed NOW (a URL signed in the past would be expired).
    const ticket = s3.presignUpload(
      stagingKey(id),
      { contentType: 'image/jpeg', contentLength: bytes.length, sha256Hex: sha(bytes) },
      new Date(Date.now() + 60_000),
      new Date(),
    );
    assert.equal((await put(ticket, bytes)).status, 200);
    const done = await lib.finalize(techMeta(), id, `lib-${randomUUID()}`);
    assert.equal(done.value.object.status, 'AVAILABLE');
    return id;
  };
  const doomed = [await make(), await make()];
  const kept = await make();
  await lib.claim(
    {
      actor: { kind: 'SERVICE', clientId: 'dispatch', scopes: ['media.object.claim'] },
      correlationId: randomUUID(),
    },
    kept,
    { claimRef: randomUUID(), holder: 'dispatch.task-evidence' },
  );
  // A reservation that expired an hour ago, with stray bytes uploaded to it.
  const stale = await libraryAt(new Date(Date.now() - HOUR)).reserve(
    techMeta(),
    declare(jpeg(900)),
    `lib-${randomUUID()}`,
  );
  const strayId = stale.value.record.object.id;
  await s3.write(stagingKey(strayId), jpeg(900), 'image/jpeg');

  const worker = startProcess(WORKER, env, ['--once', '--batch', '200']);
  const exit = await worker.exited;
  assert.equal(exit.code, 0, worker.stderr());
  for (const id of doomed) {
    assert.equal((await row(id)).status, 'PURGED');
    assert.equal(await stored(objectKey(id)), null, 'purged bytes are gone from S3');
  }
  assert.equal((await row(kept)).status, 'AVAILABLE');
  assert.ok(await stored(objectKey(kept)), 'claimed bytes are kept');
  assert.equal((await row(strayId)).status, 'EXPIRED');
  assert.equal(
    await stored(stagingKey(strayId)),
    null,
    'stray upload of an expired reservation deleted',
  );
  const read = await call('POST', `/objects/${doomed[0]}/read-url`, DISPATCH);
  assert.equal(read.status, 409);
});

test('S3 unreachable or hanging -> 503 STORAGE_UNAVAILABLE, retryable, state unchanged', async () => {
  // (1) a closed port: connection refused; (2) a listener that never answers: timeout.
  const closed = await freePort();
  blackhole = createServer(() => {});
  await new Promise((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
  for (const endpoint of [
    `http://127.0.0.1:${closed}`,
    `http://127.0.0.1:${blackhole.address().port}`,
  ]) {
    const brokenPort = await freePort();
    const broken = startProcess(MAIN, {
      ...env,
      PORT: String(brokenPort),
      MEDIA_S3_ENDPOINT: endpoint,
    });
    try {
      await waitHttp(`http://127.0.0.1:${brokenPort}/health/live`, (s) => s === 200);
      const bytes = jpeg(2_222);
      // Reserve through the healthy API and upload for real, then finalize through
      // the replica whose store is down: the bytes exist, the store cannot be read.
      const ticket = await reserve(bytes);
      assert.equal((await put(ticket.upload, bytes)).status, 200);
      const key = idem();
      const res = await call(
        'POST',
        `/objects/${ticket.objectId}/finalize`,
        { ...USER(), ...key },
        undefined,
        brokenPort,
      );
      assert.equal(res.status, 503, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'DEPENDENCY_UNAVAILABLE');
      assert.equal(res.body.error.reason, 'STORAGE_UNAVAILABLE');
      assert.equal(res.body.error.retryable, true);
      assert.deepEqual(await row(ticket.objectId), {
        status: 'RESERVED',
        version: 1,
        reject_reason: null,
      });
      const recovered = await call('POST', `/objects/${ticket.objectId}/finalize`, {
        ...USER(),
        ...key,
      });
      assert.equal(recovered.status, 200, 'the same key works once the store is back');
      assert.equal(recovered.body.status, 'AVAILABLE');
    } finally {
      await broken.kill();
    }
  }
});

test('the compiled API and worker refuse to start on an incomplete or unsafe configuration', async () => {
  const cases = [
    ['MEDIA_S3_BUCKET', { ...env, MEDIA_S3_BUCKET: undefined }],
    ['MEDIA_S3_ENDPOINT', { ...env, MEDIA_S3_ENDPOINT: 'http://s3.example.internal:8333' }],
    ['MEDIA_READ_URL_TTL_SECONDS', { ...env, MEDIA_READ_URL_TTL_SECONDS: 'soon' }],
  ];
  for (const [name, broken] of cases) {
    for (const script of [MAIN, WORKER]) {
      const child = startProcess(script, { ...broken, PORT: String(await freePort()) }, ['--once']);
      const exit = await child.exited;
      assert.equal(exit.code, 1, `${name} ${path.basename(script)}`);
      const text = `${JSON.stringify(child.lines)}${child.stderr()}`;
      assert.match(text, new RegExp(`MEDIA_CONFIG_INVALID_${name}`));
      assert.ok(!text.includes(context.s3.secretAccessKey), 'the secret is never echoed');
    }
  }
});

test('process logs never carry presigned URLs, signatures, object keys or subject ids', async (t) => {
  const text = api.lines.map((line) => JSON.stringify(line)).join('\n');
  assert.ok(api.lines.length > 0);
  const kinds = [...new Set(api.lines.map((line) => line.msg))].sort();
  t.diagnostic(`${api.lines.length} structured lines inspected; messages: ${kinds.join(', ')}`);
  assert.ok(!/X-Amz-Signature|X-Amz-Credential|uploads\/|objects\/[0-9a-f]/.test(text));
  assert.ok(!text.includes(TECH.subject));
  assert.ok(!text.includes(context.s3.secretAccessKey));
});
