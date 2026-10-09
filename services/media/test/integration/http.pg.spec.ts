import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { S3ObjectStore } from '../../src/infrastructure/storage/s3-object-store';
import { createHttpApplication } from '../../src/transport/http/create-app';
import { declare, jpeg, laneContext } from './support';

/**
 * Real Nest HTTP server on the real lane PostgreSQL (runtime role) and the
 * lane SeaweedFS S3 endpoint.
 *
 * Identity is a local HTTP double of `GET /internal/v1/identity/session`
 * (Identity V1 contract shape). It is the only substitute in this suite and it
 * is declared as such in the evidence; token verification itself is Identity's
 * own tested responsibility.
 */
const SERVICE_TOKEN = 'd'.repeat(48);
const READER_TOKEN = 'r'.repeat(48);
const TECH_A = randomUUID();
const TECH_B = randomUUID();
const SESSIONS: Record<string, { subject: string; permissions: string[] } | 'DOWN'> = {
  'technician-a-token-01': {
    subject: TECH_A,
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  'technician-b-token-01': {
    subject: TECH_B,
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  'reader-only-token-001': { subject: TECH_A, permissions: ['work.read:assigned'] },
  'customer-token-000001': {
    subject: randomUUID(),
    permissions: ['bookings.create:self', 'bookings.read:self'],
  },
  'limited-token-000001': {
    subject: randomUUID(),
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  'identity-down-token-1': 'DOWN',
};

let identity: Server;
let app: INestApplication;
let root: string;
let base: string;

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

before(async () => {
  identity = createServer((req, res) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const session = SESSIONS[token];
    if (req.url !== '/internal/v1/identity/session' || session === undefined) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    if (session === 'DOWN') {
      res.writeHead(500).end();
      return;
    }
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ...session, sessionId: randomUUID(), authVersion: 1, roles: [] }));
  });
  await new Promise<void>((resolve) => identity.listen(0, '127.0.0.1', resolve));
  const context = laneContext();
  const bucket = `media-http-${context.runId}`;
  const s3 = {
    endpoint: context.s3.endpoint,
    region: context.s3.region,
    bucket,
    accessKeyId: context.s3.accessKeyId,
    secretAccessKey: context.s3.secretAccessKey,
    requestTimeoutMs: 5_000,
    maxConcurrentReads: 4,
  };
  await new S3ObjectStore(s3).createBucketIfMissing();
  Object.assign(process.env, {
    DATABASE_URL: context.databases.media!.appUrl,
    IDENTITY_URL: `http://127.0.0.1:${(identity.address() as AddressInfo).port}`,
    MEDIA_USER_REQUESTS_PER_MINUTE: '60',
    MEDIA_SERVICE_CLIENTS: JSON.stringify([
      {
        id: 'dispatch',
        tokenSha256: digest(SERVICE_TOKEN),
        scopes: ['media.object.read', 'media.object.claim'],
      },
      { id: 'reporting', tokenSha256: digest(READER_TOKEN), scopes: ['media.object.read'] },
    ]),
    MEDIA_S3_ENDPOINT: s3.endpoint,
    MEDIA_S3_REGION: s3.region,
    MEDIA_S3_BUCKET: bucket,
    MEDIA_S3_ACCESS_KEY_ID: s3.accessKeyId,
    MEDIA_S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
  });
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  root = await app.getUrl();
  base = `${root}/internal/v1/media`;
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve) => identity.close(() => resolve()));
});

const user = (token: string) => ({ authorization: `Bearer ${token}` });
const TECH = user('technician-a-token-01');
const OTHER = user('technician-b-token-01');
const dispatch = { 'x-service-client': 'dispatch', 'x-service-token': SERVICE_TOKEN };
const reporting = { 'x-service-client': 'reporting', 'x-service-token': READER_TOKEN };

interface ApiError {
  readonly code: string;
  readonly reason: string | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly correlationId: string;
  readonly requestId: string;
}

interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Record<string, unknown> & { readonly error?: ApiError };
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Reply> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? (JSON.parse(text) as Reply['body']) : {},
  };
}

const idem = () => ({ 'idempotency-key': `http-${randomUUID()}` });

async function reserve(headers = TECH, bytes = jpeg()) {
  const reply = await call('POST', '/uploads', { ...headers, ...idem() }, declare(bytes));
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return { id: reply.body.objectId as string, bytes, reply };
}

/** The HTTP client computes Content-Length itself; it is signed, so it must match. */
function withoutLength(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'content-length'));
}

async function upload(reply: Reply, bytes: Buffer): Promise<number> {
  const ticket = reply.body.upload as { url: string; headers: Record<string, string> };
  const headers = withoutLength(ticket.headers);
  const res = await fetch(ticket.url, { method: 'PUT', headers, body: bytes });
  await res.arrayBuffer();
  return res.status;
}

test('authentication: none, ambiguous, invalid, forged and Identity outage fail closed', async () => {
  const id = randomUUID();
  const none = await call('GET', `/objects/${id}`, {});
  assert.equal(none.status, 401);
  assert.equal(none.body.error?.code, 'AUTH_REQUIRED');
  assert.equal((await call('GET', `/objects/${id}`, { ...TECH, ...dispatch })).status, 401);
  assert.equal((await call('GET', `/objects/${id}`, user('unknown-token-000001'))).status, 401);
  const forged = await call('GET', `/objects/${id}`, {
    'x-service-client': 'dispatch',
    'x-service-token': 'x'.repeat(48),
  });
  assert.equal(forged.status, 401);
  const down = await call('GET', `/objects/${id}`, user('identity-down-token-1'));
  assert.equal(down.status, 503);
  assert.equal(down.body.error?.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(down.body.error?.retryable, true);
});

test('authorization: permissions and scopes decide; services never upload, users never claim', async () => {
  const customer = user('customer-token-000001');
  assert.equal(
    (await call('POST', '/uploads', { ...customer, ...idem() }, declare(jpeg()))).status,
    403,
  );
  assert.equal(
    (await call('POST', '/uploads', { ...dispatch, ...idem() }, declare(jpeg()))).status,
    403,
  );
  const readerOnly = user('reader-only-token-001');
  assert.equal(
    (await call('POST', '/uploads', { ...readerOnly, ...idem() }, declare(jpeg()))).status,
    403,
  );
  const { id, bytes, reply } = await reserve();
  assert.equal(await upload(reply, bytes), 200);
  assert.equal((await call('POST', `/objects/${id}/finalize`, { ...TECH, ...idem() })).status, 200);
  const claim = { claimRef: randomUUID(), holder: 'dispatch.task-evidence' };
  assert.equal((await call('POST', `/objects/${id}/claims`, TECH, claim)).status, 403);
  assert.equal((await call('POST', `/objects/${id}/claims`, reporting, claim)).status, 403);
  assert.equal((await call('GET', `/objects/${id}`, customer)).status, 403);
  assert.equal((await call('GET', `/objects/${id}`, readerOnly)).status, 200, 'owner may read');
  assert.equal((await call('GET', `/objects/${id}`, reporting)).status, 200);
  assert.equal((await call('POST', `/objects/${id}/read-url`, reporting)).status, 200);
  const created = await call('POST', `/objects/${id}/claims`, dispatch, claim);
  assert.equal(created.status, 201);
  assert.equal(created.body.claimed, true);
  const again = await call('POST', `/objects/${id}/claims`, dispatch, claim);
  assert.equal(again.status, 200);
});

test('owner-only access: another technician gets 404 OBJECT_NOT_FOUND on every route', async () => {
  const { id } = await reserve();
  for (const [method, path] of [
    ['GET', `/objects/${id}`],
    ['POST', `/objects/${id}/upload-url`],
    ['POST', `/objects/${id}/finalize`],
    ['POST', `/objects/${id}/read-url`],
  ] as const) {
    const reply = await call(method, path, { ...OTHER, ...idem() });
    assert.equal(reply.status, 404, path);
    assert.equal(reply.body.error?.reason, 'OBJECT_NOT_FOUND', path);
  }
  const unknown = await call('GET', `/objects/${randomUUID()}`, TECH);
  assert.equal(unknown.status, 404);
  const mine = await call('GET', `/objects/${id}`, TECH);
  assert.equal(mine.status, 200);
  assert.deepEqual(Object.keys(mine.body).sort(), [
    'byteLength',
    'claimed',
    'contentType',
    'createdAt',
    'expiresAt',
    'finalizedAt',
    'objectId',
    'ownerSubjectId',
    'purpose',
    'rejectReason',
    'revision',
    'sha256',
    'status',
  ]);
  assert.equal(mine.body.ownerSubjectId, TECH_A);
});

test('reservation at the edge: 201, replay 200 with the same object, misuse 409, key required', async () => {
  const bytes = jpeg();
  const missing = await call('POST', '/uploads', TECH, declare(bytes));
  assert.equal(missing.status, 428);
  const headers = { ...TECH, ...idem() };
  const first = await call('POST', '/uploads', headers, declare(bytes));
  const replay = await call('POST', '/uploads', headers, declare(bytes));
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.objectId, first.body.objectId);
  const upload = first.body.upload as {
    method: string;
    headers: Record<string, string>;
    url: string;
  };
  assert.equal(upload.method, 'PUT');
  assert.deepEqual(Object.keys(upload.headers).sort(), [
    'content-length',
    'content-type',
    'x-amz-checksum-sha256',
  ]);
  assert.ok(new URL(upload.url).pathname.endsWith(`/uploads/${String(first.body.objectId)}`));
  const misuse = await call('POST', '/uploads', headers, declare(jpeg(300)));
  assert.equal(misuse.status, 409);
  assert.equal(misuse.body.error?.code, 'IDEMPOTENCY_CONFLICT');
});

test('finalize at the edge: 409 UPLOAD_MISSING before the upload, then AVAILABLE with the same key', async () => {
  const { id, bytes, reply } = await reserve();
  const key = idem();
  const early = await call('POST', `/objects/${id}/finalize`, { ...TECH, ...key });
  assert.equal(early.status, 409);
  assert.equal(early.body.error?.reason, 'UPLOAD_MISSING');
  const readEarly = await call('POST', `/objects/${id}/read-url`, TECH);
  assert.equal(readEarly.status, 409);
  assert.equal(readEarly.body.error?.reason, 'OBJECT_NOT_AVAILABLE');
  const fresh = await call('POST', `/objects/${id}/upload-url`, TECH);
  assert.equal(fresh.status, 200);
  assert.equal(await upload(fresh, bytes), 200);
  const done = await call('POST', `/objects/${id}/finalize`, { ...TECH, ...key });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'AVAILABLE');
  assert.equal(done.body.expiresAt, null);
  const late = await call('POST', `/objects/${id}/upload-url`, TECH);
  assert.equal(late.status, 409, 'no upload URL once finalized');
  assert.ok(reply.body.upload);
});

test('strict input: closed bodies, UUIDs, unknown enums and malformed JSON', async () => {
  const good = declare(jpeg());
  const cases: Array<[string, unknown]> = [
    ['extra field', { ...good, ownerSubjectId: TECH_B }],
    ['missing field', { purpose: 'WORK_EVIDENCE', contentType: 'image/jpeg', byteLength: 100 }],
    ['svg', { ...good, contentType: 'image/svg+xml' }],
    ['too large', { ...good, byteLength: 10 * 1024 * 1024 + 1 }],
    ['array body', [good]],
  ];
  for (const [label, body] of cases) {
    const reply = await call('POST', '/uploads', { ...TECH, ...idem() }, body);
    assert.equal(reply.status, 400, label);
    assert.equal(reply.body.error?.code, 'REQUEST_INVALID', label);
  }
  assert.equal((await call('POST', '/uploads', { ...TECH, ...idem() }, '{"purpose":')).status, 400);
  assert.equal((await call('GET', '/objects/not-a-uuid', TECH)).status, 400);
  const { id } = await reserve();
  assert.equal(
    (await call('POST', `/objects/${id}/finalize`, { ...TECH, ...idem() }, { force: true })).status,
    400,
  );
  const badHolder = await call('POST', `/objects/${id}/claims`, dispatch, {
    claimRef: randomUUID(),
    holder: 'anyone',
  });
  assert.equal(badHolder.status, 400);
  assert.equal((await call('GET', '/nowhere', TECH)).status, 404);
});

test('error envelope never leaks internals and carries correlation and request ids', async () => {
  const correlationId = randomUUID();
  const reply = await call('GET', `/objects/${randomUUID()}`, {
    ...TECH,
    'x-correlation-id': correlationId,
    'x-request-id': 'req-abc-123',
  });
  assert.equal(reply.status, 404);
  assert.deepEqual(Object.keys(reply.body.error ?? {}).sort(), [
    'code',
    'correlationId',
    'issues',
    'message',
    'reason',
    'requestId',
    'retryAfterMs',
    'retryable',
  ]);
  assert.equal(reply.body.error?.correlationId, correlationId);
  assert.equal(reply.body.error?.requestId, 'req-abc-123');
  assert.equal(reply.headers.get('x-correlation-id'), correlationId);
});

test('per-actor budget answers 429 with a retry hint; other actors are unaffected', async () => {
  const limited = user('limited-token-000001');
  let last: Reply | undefined;
  for (let i = 0; i < 70; i += 1) {
    last = await call('GET', `/objects/${randomUUID()}`, limited);
    if (last.status === 429) break;
  }
  assert.equal(last?.status, 429);
  assert.equal(last?.body.error?.code, 'RATE_LIMITED');
  assert.ok((last?.body.error?.retryAfterMs ?? 0) > 0);
  assert.ok(Number(last?.headers.get('retry-after')) > 0);
  assert.equal((await call('GET', `/objects/${randomUUID()}`, TECH)).status, 404);
});

test('liveness is up while readiness honestly stays 503 until media.v1 is published', async () => {
  assert.equal((await fetch(`${root}/health/live`)).status, 200);
  assert.equal((await fetch(`${root}/health/ready`)).status, 503);
});
