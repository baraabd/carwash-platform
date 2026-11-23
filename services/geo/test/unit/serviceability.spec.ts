import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApplicationError,
  DECISION_RETENTION_AFTER_EXPIRY_MS,
  ServiceabilityApplication,
  VALIDATE_SCOPE,
} from '../../src/application';
import { GeoDomainError, parseRing, type Decision, type Point, type Zone } from '../../src/domain';
import {
  StoreUnavailableError,
  type AuthorizedPrincipal,
  type CoverageSnapshot,
  type GeoStore,
  type IdentityAuthorizer,
} from '../../src/ports';
import { classify, envelope } from '../../src/transport/http/error-envelope';

/* Synthetic square around (0, 0); not a service area. */
const ZONE: Zone = {
  id: '00000000-0000-4000-8000-00000000000a',
  code: 't-a',
  name: 'اختبار',
  nameEn: null,
  datasetRef: 'test-fixture:synthetic',
  ring: parseRing([
    ['0', '0'],
    ['1', '0'],
    ['1', '1'],
    ['0', '1'],
    ['0', '0'],
  ]),
  status: 'ACTIVE',
  revision: 2,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  retiredAt: null,
};

class MemoryStore implements GeoStore {
  zones: Zone[] = [];
  datasetRevision = 1;
  decisions = new Map<string, Decision>();
  down = false;
  transaction(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }
  activeZones(): Promise<Zone[]> {
    return Promise.resolve(this.zones);
  }
  coverageSnapshot(point: Point): Promise<CoverageSnapshot> {
    if (this.down) return Promise.reject(new StoreUnavailableError());
    const b = (z: Zone) => z.ring.bounds;
    return Promise.resolve({
      anyActive: this.zones.length > 0,
      candidates: this.zones.filter(
        (z) =>
          b(z).minLat <= point.lat &&
          point.lat <= b(z).maxLat &&
          b(z).minLng <= point.lng &&
          point.lng <= b(z).maxLng,
      ),
      datasetRevision: this.datasetRevision,
    });
  }
  recordDecision(decision: Decision): Promise<void> {
    this.decisions.set(decision.id, decision);
    return Promise.resolve();
  }
  findDecision(id: string): Promise<Decision | null> {
    return Promise.resolve(this.decisions.get(id) ?? null);
  }
  purgeDecisions(before: Date, limit: number): Promise<number> {
    let removed = 0;
    for (const [id, d] of this.decisions) {
      if (removed < limit && d.expiresAt < before) {
        this.decisions.delete(id);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}

const GUEST: AuthorizedPrincipal = {
  principal: { kind: 'guest', subject: '00000000-0000-4000-8000-0000000000b1' },
  sessionId: '00000000-0000-4000-8000-0000000000b2',
  permissions: ['profile.read:self', 'bookings.create:self'],
};

function identity(result: AuthorizedPrincipal | ApplicationError): IdentityAuthorizer {
  return {
    authorize: () =>
      result instanceof ApplicationError ? Promise.reject(result) : Promise.resolve(result),
  };
}

let now = new Date('2026-10-08T10:00:00.000Z');
let counter = 0;
function app(store: MemoryStore, auth: IdentityAuthorizer = identity(GUEST)) {
  return new ServiceabilityApplication(
    store,
    auth,
    { now: () => now },
    { uuid: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` },
    { decisionTtlMs: 30 * 60_000 },
  );
}
const credentials = { authorization: 'Bearer x', cookie: undefined, correlationId: 'c-1' };
const body = (latitude: string, longitude: string) => ({ point: { latitude, longitude } });

test('check: no approved zones is INDETERMINATE / GEO_DATASET_UNAVAILABLE and is recorded', async () => {
  const store = new MemoryStore();
  const view = await app(store).checkServiceability(credentials, body('0.500000', '0.500000'));
  assert.equal(view.decision, 'INDETERMINATE');
  assert.equal(view.reason, 'GEO_DATASET_UNAVAILABLE');
  assert.deepEqual([view.zoneId, view.zoneRevision, view.datasetRevision], [null, null, 1]);
  assert.deepEqual(view.point, { latitude: '0.500000', longitude: '0.500000' });
  assert.equal(view.checkedAt, '2026-10-08T10:00:00.000Z');
  assert.equal(view.expiresAt, '2026-10-08T10:30:00.000Z');
  assert.ok(store.decisions.has(view.decisionId));
});

test('check: SERVICEABLE inside a zone; boundary is LOCATION_UNRESOLVED', async () => {
  const store = new MemoryStore();
  store.zones = [ZONE];
  store.datasetRevision = 4;
  const inside = await app(store).checkServiceability(credentials, body('0.500000', '0.500000'));
  assert.deepEqual(
    [inside.decision, inside.zoneId, inside.zoneRevision, inside.datasetRevision, inside.reason],
    ['SERVICEABLE', ZONE.id, 2, 4, null],
  );
  const edge = await app(store).checkServiceability(credentials, body('0.500000', '1.000000'));
  assert.deepEqual([edge.decision, edge.reason], ['INDETERMINATE', 'LOCATION_UNRESOLVED']);
  const outside = await app(store).checkServiceability(credentials, body('5.000000', '5.000000'));
  assert.deepEqual([outside.decision, outside.reason], ['OUTSIDE_ZONE', null]);
});

test('check: authorization runs first and fails closed; missing permission is forbidden', async () => {
  const store = new MemoryStore();
  for (const code of ['AUTH_REQUIRED', 'AUTH_FORBIDDEN', 'IDENTITY_UNAVAILABLE'] as const) {
    await assert.rejects(
      app(store, identity(new ApplicationError(code))).checkServiceability(credentials, {
        nonsense: true,
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === code,
    );
  }
  await assert.rejects(
    app(store, identity({ ...GUEST, permissions: ['profile.read:self'] })).checkServiceability(
      credentials,
      body('0.500000', '0.500000'),
    ),
    (error: unknown) => error instanceof ApplicationError && error.code === 'AUTH_FORBIDDEN',
  );
  assert.equal(store.decisions.size, 0, 'nothing is recorded for a refused caller');
});

test('check: closed body; contract-invalid points are refused before any read', async () => {
  const store = new MemoryStore();
  store.down = true;
  for (const [raw, code] of [
    [{}, 'MISSING_FIELD'],
    [
      { point: { latitude: '0.500000', longitude: '0.500000' }, addressId: 'x' },
      'UNEXPECTED_FIELD',
    ],
    [{ coordinates: { latitude: '0.5', longitude: '0.5' } }, 'MISSING_FIELD'],
    [body('NaN', '0.500000'), 'INVALID_COORDINATE'],
    [body('0.5000001', '0.500000'), 'INVALID_COORDINATE'],
    [body('91.000000', '0.500000'), 'COORDINATE_OUT_OF_RANGE'],
    [null, 'EXPECTED_OBJECT'],
  ] as const) {
    await assert.rejects(
      app(store).checkServiceability(credentials, raw),
      (error: unknown) => error instanceof GeoDomainError && error.code === code,
      JSON.stringify(raw),
    );
  }
});

test('check: a store outage is an error, never a decision and never SERVICEABLE', async () => {
  const store = new MemoryStore();
  store.zones = [ZONE];
  store.down = true;
  await assert.rejects(
    app(store).checkServiceability(credentials, body('0.500000', '0.500000')),
    StoreUnavailableError,
  );
  assert.equal(store.decisions.size, 0);
  const mapped = envelope(classify(new StoreUnavailableError()), {
    requestId: 'r',
    correlationId: 'c',
  });
  assert.equal(mapped.error.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(mapped.error.retryable, true);
});

test('validate: scope required; result follows the stored decision and current coverage', async () => {
  const store = new MemoryStore();
  store.zones = [ZONE];
  const service = app(store);
  const decided = await service.checkServiceability(credentials, body('0.500000', '0.500000'));
  const request = {
    decisionId: decided.decisionId,
    expectedZoneRevision: 2,
    point: decided.point,
    purpose: 'booking-create',
  };
  await assert.rejects(
    service.validate({ service: 'booking', scopes: [] }, request),
    (error: unknown) => error instanceof ApplicationError && error.code === 'AUTH_FORBIDDEN',
  );
  const actor = { service: 'booking', scopes: [VALIDATE_SCOPE] };
  assert.deepEqual(await service.validate(actor, request), {
    decisionId: decided.decisionId,
    valid: true,
    reason: null,
    zoneId: ZONE.id,
    zoneRevision: 2,
  });
  store.zones = [{ ...ZONE, revision: 3 }];
  assert.equal((await service.validate(actor, request)).reason, 'ZONE_CHANGED');
  store.zones = [ZONE];
  now = new Date(now.getTime() + 30 * 60_000);
  assert.equal((await service.validate(actor, request)).reason, 'DECISION_EXPIRED');
  await assert.rejects(
    service.validate(actor, { ...request, purpose: 'marketing' }),
    (error: unknown) => error instanceof GeoDomainError && error.code === 'INVALID_ENUM',
  );
  assert.equal(
    (
      await service.validate(actor, {
        ...request,
        decisionId: '00000000-0000-4000-8000-00000000ffff',
      })
    ).reason,
    'DECISION_NOT_FOUND',
  );
});

test('retention: only decisions past expiry + retention are purged, in batches', async () => {
  const store = new MemoryStore();
  const service = app(store);
  now = new Date('2026-10-08T10:00:00.000Z');
  for (let i = 0; i < 5; i += 1) {
    await service.checkServiceability(credentials, body('0.500000', '0.500000'));
  }
  now = new Date(now.getTime() + 30 * 60_000 + DECISION_RETENTION_AFTER_EXPIRY_MS - 1);
  assert.equal(await service.purgeExpiredDecisions(2), 0);
  now = new Date(now.getTime() + 2);
  assert.equal(await service.purgeExpiredDecisions(2), 5);
  assert.equal(store.decisions.size, 0);
});

test('envelope: validation issues carry the field path; rate limit carries retryAfterMs', () => {
  const ids = { requestId: 'r-1', correlationId: 'c-1' };
  const invalid = envelope(
    classify(new GeoDomainError('INVALID_COORDINATE', '$.point.latitude')),
    ids,
  );
  assert.deepEqual(invalid.error.issues, [
    { field: '$.point.latitude', code: 'INVALID_COORDINATE' },
  ]);
  assert.equal(invalid.error.code, 'VALIDATION_FAILED');
  assert.equal(invalid.error.retryable, false);
  const limited = envelope(classify(new ApplicationError('RATE_LIMITED', 1500)), ids);
  assert.deepEqual([limited.error.retryable, limited.error.retryAfterMs], [true, 1500]);
  const identityDown = envelope(classify(new ApplicationError('IDENTITY_UNAVAILABLE')), ids);
  assert.equal(identityDown.error.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(envelope(classify(new Error('boom')), ids).error.code, 'INTERNAL_ERROR');
});

test('identity adapter: kind comes from principalKind; malformed or role-carrying guests fail closed', async () => {
  const { createServer } = await import('node:http');
  const { HttpIdentityAuthorizer } =
    await import('../../src/infrastructure/identity/http-identity-authorizer');
  let reply: { status: number; body: unknown } = { status: 200, body: {} };
  const server = createServer((_request, response) => {
    response.writeHead(reply.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const authorizer = new HttpIdentityAuthorizer({
    origin: `http://127.0.0.1:${port}`,
    timeoutMs: 1000,
  });
  const credentials = { authorization: 'Bearer t', cookie: undefined, correlationId: 'c' };
  const view = {
    subject: '00000000-0000-4000-8000-0000000000c1',
    sessionId: '00000000-0000-4000-8000-0000000000c2',
    authVersion: 1,
    principalKind: 'guest',
    roles: [],
    permissions: ['bookings.create:self'],
  };
  const code = async () =>
    authorizer.authorize(credentials).then(
      () => 'ok',
      (error: unknown) => (error instanceof ApplicationError ? error.code : 'unexpected'),
    );
  try {
    reply = { status: 200, body: view };
    assert.equal((await authorizer.authorize(credentials)).principal.kind, 'guest');
    reply = { status: 200, body: { ...view, principalKind: 'account', roles: ['customer'] } };
    assert.equal((await authorizer.authorize(credentials)).principal.kind, 'account');
    for (const body of [
      { ...view, roles: ['admin'] },
      { ...view, principalKind: undefined },
      { ...view, principalKind: 'staff' },
      { ...view, roles: undefined },
      { ...view, permissions: 'bookings.create:self' },
    ]) {
      reply = { status: 200, body };
      assert.equal(await code(), 'IDENTITY_UNAVAILABLE', JSON.stringify(body));
    }
    reply = { status: 401, body: {} };
    assert.equal(await code(), 'AUTH_REQUIRED');
    reply = { status: 500, body: {} };
    assert.equal(await code(), 'IDENTITY_UNAVAILABLE');
    assert.equal(
      await authorizer
        .authorize({ authorization: undefined, cookie: 'other=1', correlationId: 'c' })
        .then(
          () => 'ok',
          (error: unknown) => (error instanceof ApplicationError ? error.code : 'unexpected'),
        ),
      'AUTH_REQUIRED',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
