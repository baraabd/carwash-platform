import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MediaService, mediaPolicy } from '../../src/application';
import { MediaError } from '../../src/domain';
import {
  loadApiConfig,
  loadS3Config,
  loadWorkerConfig,
  objectStoreFromEnv,
  UNCONFIGURED_STORE,
} from '../../src/infrastructure/config/media-config';
import {
  IdentityAuthFailure,
  IdentitySessionClient,
} from '../../src/infrastructure/identity/identity-session.client';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from '../../src/infrastructure/security/service-clients';
import { S3ObjectStore } from '../../src/infrastructure/storage/s3-object-store';
import { ActorResolver, RequestBudget } from '../../src/transport/http/actor-resolver';
import { RateLimited, errorBody, statusOf } from '../../src/transport/http/http-errors';
import type {
  MediaReadModel,
  MediaScope,
  MediaUnitOfWork,
  ObjectClaim,
  ObjectRecord,
  ObjectStore,
  PresignedRequest,
  RequestMeta,
  StoredRead,
} from '../../src/ports';

const SUBJECT = '0b8f6f8e-1d5a-4c1e-9e5f-0a3b2c1d4e5f';
const ID = '0b8f6f8e-1d5a-4c1e-9e5f-0a3b2c1d4e60';
const TOKEN = 'a'.repeat(40);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function touched(): never {
  throw new Error('PERSISTENCE_TOUCHED');
}

/** Any touch of persistence or storage fails the test: authorization must refuse first. */
class Untouchable implements MediaUnitOfWork, MediaReadModel, ObjectStore {
  run<T>(): Promise<T> {
    return touched();
  }
  findObject(): Promise<ObjectRecord | null> {
    return touched();
  }
  findClaim(): Promise<ObjectClaim | null> {
    return touched();
  }
  reservationsDue(): Promise<string[]> {
    return touched();
  }
  purgeCandidates(): Promise<string[]> {
    return touched();
  }
  sweepCandidates(): Promise<string[]> {
    return touched();
  }
  presignUpload(): PresignedRequest {
    return touched();
  }
  presignDownload(): PresignedRequest {
    return touched();
  }
  read(): Promise<StoredRead> {
    return touched();
  }
  write(): Promise<void> {
    return touched();
  }
  remove(): Promise<void> {
    return touched();
  }
}

const untouchable = new Untouchable();
const service = new MediaService(
  untouchable,
  untouchable,
  untouchable,
  { now: () => new Date('2026-10-10T08:00:00.000Z') },
  { next: () => ID },
  mediaPolicy(),
);

const user = (...permissions: string[]): RequestMeta => ({
  actor: { kind: 'USER', subject: SUBJECT, permissions },
  correlationId: ID,
});
const svc = (...scopes: MediaScope[]): RequestMeta => ({
  actor: { kind: 'SERVICE', clientId: 'dispatch', scopes },
  correlationId: ID,
});
const system: RequestMeta = {
  actor: { kind: 'SYSTEM', component: 'test' },
  correlationId: ID,
};

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MediaError) return error.code;
    return (error as Error).message;
  }
  return 'OK';
}

const reservation = {
  purpose: 'WORK_EVIDENCE',
  contentType: 'image/jpeg',
  byteLength: 100,
  sha256: 'a'.repeat(64),
};
const claimBody = { claimRef: ID, holder: 'dispatch.task-evidence' };

// ---------------------------------------------------------- authorization

test('uploads, upload-url and finalize require a user with work.execute:assigned', async () => {
  const denied = [
    user(),
    user('work.read:assigned'),
    user('bookings.create:self'),
    svc('media.object.read', 'media.object.claim'),
    system,
  ];
  for (const meta of denied) {
    assert.equal(await codeOf(service.reserve(meta, reservation, 'k'.repeat(20))), 'FORBIDDEN');
    assert.equal(await codeOf(service.issueUploadUrl(meta, ID)), 'FORBIDDEN');
    assert.equal(await codeOf(service.finalize(meta, ID, 'k'.repeat(20))), 'FORBIDDEN');
  }
});

test('reads: users need a work permission, services need media.object.read', async () => {
  for (const meta of [user(), user('operations.dispatch'), svc('media.object.claim'), system]) {
    assert.equal(await codeOf(service.getObject(meta, ID)), 'FORBIDDEN');
    assert.equal(await codeOf(service.issueReadUrl(meta, ID)), 'FORBIDDEN');
  }
});

test('claims require the service scope media.object.claim; users never claim', async () => {
  for (const meta of [
    user('work.execute:assigned', 'work.read:assigned'),
    svc('media.object.read'),
    system,
  ]) {
    assert.equal(await codeOf(service.claim(meta, ID, claimBody)), 'FORBIDDEN');
  }
});

test('input is validated before persistence: ids, keys, bodies, holders', async () => {
  const tech = user('work.execute:assigned', 'work.read:assigned');
  assert.equal(
    await codeOf(service.reserve(tech, reservation, undefined)),
    'IDEMPOTENCY_KEY_REQUIRED',
  );
  assert.equal(await codeOf(service.reserve(tech, reservation, 'short')), 'INVALID_INPUT');
  assert.equal(await codeOf(service.reserve(tech, reservation, 'k'.repeat(129))), 'INVALID_INPUT');
  assert.equal(
    await codeOf(
      service.reserve(tech, { ...reservation, contentType: 'image/gif' }, 'k'.repeat(20)),
    ),
    'INVALID_INPUT',
  );
  assert.equal(await codeOf(service.finalize(tech, 'not-a-uuid', 'k'.repeat(20))), 'INVALID_INPUT');
  assert.equal(await codeOf(service.finalize(tech, ID, undefined)), 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(await codeOf(service.getObject(tech, '../objects')), 'INVALID_INPUT');
  const claimer = svc('media.object.claim');
  assert.equal(
    await codeOf(service.claim(claimer, ID, { ...claimBody, holder: 'booking.anything' })),
    'INVALID_INPUT',
  );
  assert.equal(
    await codeOf(service.claim(claimer, ID, { ...claimBody, claimRef: 'x' })),
    'INVALID_INPUT',
  );
});

// ---------------------------------------------------------- error envelope

test('domain errors map onto the shared envelope with fixed messages', () => {
  const cases: Array<[MediaError, number, string, string | null, boolean]> = [
    [new MediaError('OBJECT_NOT_FOUND', 'x'), 404, 'NOT_FOUND', 'OBJECT_NOT_FOUND', false],
    [new MediaError('OBJECT_NOT_AVAILABLE', 'x'), 409, 'CONFLICT', 'OBJECT_NOT_AVAILABLE', false],
    [new MediaError('UPLOAD_MISSING', 'x'), 409, 'CONFLICT', 'UPLOAD_MISSING', false],
    [new MediaError('IDEMPOTENCY_CONFLICT', 'x'), 409, 'IDEMPOTENCY_CONFLICT', null, false],
    [new MediaError('IDEMPOTENCY_KEY_REQUIRED', 'x'), 428, 'IDEMPOTENCY_KEY_REQUIRED', null, false],
    [new MediaError('INVALID_INPUT', 'x'), 400, 'REQUEST_INVALID', null, false],
    [new MediaError('FORBIDDEN', 'x'), 403, 'AUTH_FORBIDDEN', null, false],
    [
      new MediaError('STORAGE_UNAVAILABLE', 'x'),
      503,
      'DEPENDENCY_UNAVAILABLE',
      'STORAGE_UNAVAILABLE',
      true,
    ],
  ];
  for (const [error, status, code, reason, retryable] of cases) {
    const body = errorBody(error, ID, 'req-1');
    assert.equal(statusOf(body), status, error.code);
    assert.equal(body.error.code, code);
    assert.equal(body.error.reason, reason);
    assert.equal(body.error.retryable, retryable);
    assert.notEqual(body.error.message, 'x', 'internal text is never reflected');
  }
  const limited = errorBody(new RateLimited(1_500), ID, 'r');
  assert.equal(statusOf(limited), 429);
  assert.equal(limited.error.retryAfterMs, 1_500);
  const unknown = errorBody(new Error('https://bucket/objects/x?X-Amz-Signature=abc'), ID, 'r');
  assert.equal(statusOf(unknown), 500);
  assert.ok(!JSON.stringify(unknown).includes('Signature'));
  assert.equal(statusOf(errorBody(new IdentityAuthFailure('UNAVAILABLE'), ID, 'r')), 503);
  assert.equal(statusOf(errorBody(new IdentityAuthFailure('UNAUTHENTICATED'), ID, 'r')), 401);
});

// ---------------------------------------------------------- edge identity

test('service credentials: digests only, constant-time match, unknown scopes rejected', () => {
  const clients = parseServiceClients(
    JSON.stringify([
      {
        id: 'dispatch',
        tokenSha256: digest(TOKEN),
        scopes: ['media.object.read', 'media.object.claim'],
      },
    ]),
  );
  const auth = new ServiceClientAuthenticator(clients);
  assert.equal(auth.authenticate('dispatch', TOKEN)?.id, 'dispatch');
  assert.equal(auth.authenticate('dispatch', 'b'.repeat(40)), null);
  assert.equal(auth.authenticate('booking', TOKEN), null);
  assert.equal(auth.authenticate('dispatch', 'short'), null);
  assert.throws(
    () =>
      parseServiceClients(
        JSON.stringify([{ id: 'x1', tokenSha256: digest(TOKEN), scopes: ['media.object.delete'] }]),
      ),
    /SERVICE_CLIENTS_INVALID_SCOPE/,
  );
  assert.throws(() => parseServiceClients('{'), /SERVICE_CLIENTS_INVALID_JSON/);
});

test('actor resolution: exactly one credential kind; Identity outage fails closed', async () => {
  const fakeFetch =
    (status: number, body: unknown): typeof fetch =>
    () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
  const resolver = (fetchImpl: typeof fetch) =>
    new ActorResolver(
      new IdentitySessionClient({ baseUrl: 'http://identity.invalid', fetchImpl }),
      new ServiceClientAuthenticator(
        parseServiceClients(
          JSON.stringify([
            { id: 'dispatch', tokenSha256: digest(TOKEN), scopes: ['media.object.read'] },
          ]),
        ),
      ),
      new RequestBudget(100),
      new RequestBudget(100),
    );
  const ok = resolver(fakeFetch(200, { subject: SUBJECT, permissions: ['work.read:assigned'] }));
  const bearer = { authorization: 'Bearer abcdefghijklmnop' };
  const meta = await ok.resolve({ headers: bearer });
  assert.deepEqual(meta.actor, {
    kind: 'USER',
    subject: SUBJECT,
    permissions: ['work.read:assigned'],
  });
  const service = await ok.resolve({
    headers: { 'x-service-client': 'dispatch', 'x-service-token': TOKEN },
  });
  assert.equal(service.actor.kind, 'SERVICE');
  const reject = async (headers: Record<string, string | string[]>, r = ok) => {
    try {
      await r.resolve({ headers });
      return 'OK';
    } catch (error) {
      return error instanceof IdentityAuthFailure ? error.reason : 'OTHER';
    }
  };
  assert.equal(await reject({}), 'UNAUTHENTICATED');
  assert.equal(
    await reject({ ...bearer, 'x-service-client': 'dispatch', 'x-service-token': TOKEN }),
    'UNAUTHENTICATED',
  );
  assert.equal(await reject({ 'x-service-client': 'dispatch' }), 'UNAUTHENTICATED');
  assert.equal(await reject({ authorization: ['Bearer a', 'Bearer b'] }), 'UNAUTHENTICATED');
  assert.equal(await reject(bearer, resolver(fakeFetch(401, {}))), 'UNAUTHENTICATED');
  assert.equal(await reject(bearer, resolver(fakeFetch(500, {}))), 'UNAVAILABLE');
  assert.equal(
    await reject(bearer, resolver(fakeFetch(200, { subject: 'x', permissions: [] }))),
    'UNAVAILABLE',
    'a malformed session is never guessed into an identity',
  );
  const down: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));
  assert.equal(await reject(bearer, resolver(down)), 'UNAVAILABLE');
});

test('request budget: fixed window per actor key', () => {
  let now = 0;
  const budget = new RequestBudget(2, 1_000, () => now);
  budget.take('a');
  budget.take('a');
  assert.throws(
    () => budget.take('a'),
    (error: unknown) => error instanceof RateLimited,
  );
  budget.take('b');
  now = 1_000;
  budget.take('a');
});

// ---------------------------------------------------------- configuration

const S3_ENV = {
  MEDIA_S3_ENDPOINT: 'http://127.0.0.1:8333',
  MEDIA_S3_REGION: 'us-east-1',
  MEDIA_S3_BUCKET: 'washgo-media-test',
  MEDIA_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE1',
  MEDIA_S3_SECRET_ACCESS_KEY: 'secret-value-123',
};
const API_ENV = {
  ...S3_ENV,
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/cw_media?schema=app',
  IDENTITY_URL: 'http://127.0.0.1:9999',
};

test('configuration: complete settings load; each missing or unsafe value stops the process', () => {
  assert.equal(loadS3Config(S3_ENV).bucket, 'washgo-media-test');
  assert.equal(loadApiConfig(API_ENV).policy.readUrlTtlMs, 120_000);
  assert.equal(loadWorkerConfig(API_ENV).s3.requestTimeoutMs, 5_000);
  const broken: Array<[string, Record<string, string | undefined>]> = [
    ['MEDIA_S3_ENDPOINT', { ...API_ENV, MEDIA_S3_ENDPOINT: undefined }],
    ['MEDIA_S3_ENDPOINT', { ...API_ENV, MEDIA_S3_ENDPOINT: 'ftp://127.0.0.1' }],
    ['MEDIA_S3_ENDPOINT', { ...API_ENV, MEDIA_S3_ENDPOINT: 'http://u:p@127.0.0.1:8333' }],
    ['MEDIA_S3_ENDPOINT', { ...API_ENV, MEDIA_S3_ENDPOINT: 'http://127.0.0.1:8333/bucket' }],
    ['MEDIA_S3_ENDPOINT', { ...API_ENV, MEDIA_S3_ENDPOINT: 'http://s3.internal:8333' }],
    ['MEDIA_S3_BUCKET', { ...API_ENV, MEDIA_S3_BUCKET: 'Bad_Bucket' }],
    ['MEDIA_S3_REGION', { ...API_ENV, MEDIA_S3_REGION: undefined }],
    ['MEDIA_S3_ACCESS_KEY_ID', { ...API_ENV, MEDIA_S3_ACCESS_KEY_ID: '' }],
    ['MEDIA_S3_SECRET_ACCESS_KEY', { ...API_ENV, MEDIA_S3_SECRET_ACCESS_KEY: 'short' }],
    ['MEDIA_S3_TIMEOUT_MS', { ...API_ENV, MEDIA_S3_TIMEOUT_MS: '60000' }],
    ['IDENTITY_URL', { ...API_ENV, IDENTITY_URL: undefined }],
    ['DATABASE_URL', { ...API_ENV, DATABASE_URL: undefined }],
    ['MEDIA_SERVICE_CLIENTS', { ...API_ENV, MEDIA_SERVICE_CLIENTS: '[{"id":"x"}]' }],
    ['POLICY', { ...API_ENV, MEDIA_READ_URL_TTL_SECONDS: '900' }],
    ['MEDIA_READ_URL_TTL_SECONDS', { ...API_ENV, MEDIA_READ_URL_TTL_SECONDS: '1e3' }],
  ];
  for (const [name, env] of broken) {
    assert.throws(
      () => loadApiConfig(env),
      (error: unknown) =>
        error instanceof Error &&
        error.message.startsWith(`MEDIA_CONFIG_INVALID_${name}`) &&
        !error.message.includes('secret-value'),
      name,
    );
  }
  assert.equal(
    loadS3Config({
      ...S3_ENV,
      MEDIA_S3_ENDPOINT: 'http://s3.internal:8333',
      MEDIA_S3_ALLOW_PLAINTEXT: 'true',
    }).endpoint,
    'http://s3.internal:8333',
  );
  assert.equal(objectStoreFromEnv({}), UNCONFIGURED_STORE);
  assert.throws(() => objectStoreFromEnv({ MEDIA_S3_BUCKET: 'x' }), /MEDIA_CONFIG_INVALID/);
});

// ---------------------------------------------------------- object store adapter

function store(fetchImpl: typeof fetch): S3ObjectStore {
  return new S3ObjectStore(
    {
      endpoint: 'http://127.0.0.1:8333',
      region: 'us-east-1',
      bucket: 'b-test',
      accessKeyId: 'AKIAEXAMPLE1',
      secretAccessKey: 'secret-value-123',
      requestTimeoutMs: 200,
      maxConcurrentReads: 1,
    },
    fetchImpl,
  );
}

const respond =
  (status: number, body: Uint8Array | null = null): typeof fetch =>
  () =>
    Promise.resolve(new Response(body, { status }));

test('object store fails closed: 5xx, 403, network error and timeout are STORAGE_UNAVAILABLE', async () => {
  for (const fetchImpl of [
    respond(500),
    respond(503),
    respond(403),
    respond(301),
    (() => Promise.reject(new TypeError('fetch failed'))) satisfies typeof fetch,
  ]) {
    const s3 = store(fetchImpl);
    assert.equal(await codeOf(s3.read('uploads/x', 10)), 'STORAGE_UNAVAILABLE');
    assert.equal(
      await codeOf(s3.write('objects/x', new Uint8Array(1), 'image/png')),
      'STORAGE_UNAVAILABLE',
    );
    assert.equal(await codeOf(s3.remove('objects/x')), 'STORAGE_UNAVAILABLE');
  }
  const hanging: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  assert.equal(await codeOf(store(hanging).read('uploads/x', 10)), 'STORAGE_UNAVAILABLE');
});

test('object store: 404 is MISSING, delete of a missing key succeeds, reads stop at the limit', async () => {
  assert.deepEqual(await store(respond(404)).read('uploads/x', 10), { kind: 'MISSING' });
  await store(respond(404)).remove('objects/x');
  await store(respond(204)).remove('objects/x');
  const full = await store(respond(200, new Uint8Array([1, 2, 3]))).read('uploads/x', 10);
  assert.deepEqual(full, { kind: 'FOUND', bytes: Buffer.from([1, 2, 3]), truncated: false });
  const capped = await store(respond(200, new Uint8Array(50).fill(7))).read('uploads/x', 11);
  assert.equal(capped.kind, 'FOUND');
  if (capped.kind === 'FOUND') {
    assert.equal(capped.bytes.length, 11);
    assert.equal(capped.truncated, true);
  }
});

test('object store errors and presigned requests never leak into error text', async () => {
  const error = await store(respond(500))
    .read('uploads/secret-key', 10)
    .catch((e: unknown) => e);
  assert.ok(error instanceof MediaError);
  assert.ok(!error.message.includes('uploads') && !error.message.includes('127.0.0.1'));
  const now = new Date('2026-10-10T08:00:00.000Z');
  const put = store(respond(200)).presignUpload(
    'uploads/abc',
    { contentType: 'image/png', contentLength: 99, sha256Hex: 'a'.repeat(64) },
    new Date(now.getTime() + 120_500),
    now,
  );
  assert.equal(put.method, 'PUT');
  assert.equal(put.expiresAt.getTime(), now.getTime() + 120_000, 'whole seconds, never longer');
  assert.deepEqual(Object.keys(put.headers).sort(), [
    'content-length',
    'content-type',
    'x-amz-checksum-sha256',
  ]);
  assert.equal(new URL(put.url).pathname, '/b-test/uploads/abc');
  assert.throws(() => store(respond(200)).presignDownload('objects/x', now, now), /LIFETIME/);
});

test('an unconfigured store refuses every call', async () => {
  assert.equal(await codeOf(UNCONFIGURED_STORE.read('k', 1)), 'STORAGE_UNAVAILABLE');
  assert.throws(
    () => UNCONFIGURED_STORE.presignDownload('k', new Date(), new Date()),
    (error: unknown) => error instanceof MediaError && error.code === 'STORAGE_UNAVAILABLE',
  );
});
