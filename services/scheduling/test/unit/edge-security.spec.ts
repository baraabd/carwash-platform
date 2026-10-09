import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  actorKey,
  isOperations,
  requireOperations,
  requirePrincipal,
  requireScope,
} from '../../src/application';
import { SchedulingError } from '../../src/domain';
import type { Actor } from '../../src/ports';
import {
  IdentityAuthFailure,
  IdentitySessionClient,
} from '../../src/infrastructure/identity/identity-session.client';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from '../../src/infrastructure/security/service-clients';
import { ActorResolver, RequestBudget } from '../../src/transport/http/actor-resolver';
import {
  RateLimited,
  RequestInvalid,
  errorBody,
  mapError,
  statusOf,
} from '../../src/transport/http/http-errors';
import { commitRequest, holdRequest, releaseRequest, utc } from '../../src/transport/http/wire';
import {
  isTransientConflict,
  sqlState,
} from '../../src/infrastructure/persistence/prisma-scheduling.store';

const SUBJECT = '0b8f6f8e-1d5a-4c1e-9e5f-0a3b2c1d4e5f';
const TOKEN = 'a'.repeat(40);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function identityReturning(status: number, body: unknown): IdentitySessionClient {
  return new IdentitySessionClient({
    baseUrl: 'http://identity.internal:3000',
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify(body), { status })),
  });
}

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IdentityAuthFailure) return error.reason;
    throw error;
  }
  return 'RESOLVED';
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SchedulingError) return error.code;
    if (error instanceof RequestInvalid) return `REQUEST_INVALID ${error.field}`;
    throw error;
  }
  return 'NO_ERROR';
}

const customer: Actor = {
  kind: 'USER',
  principalKind: 'guest',
  subject: SUBJECT,
  permissions: ['bookings.create:self'],
};
const ops: Actor = {
  kind: 'USER',
  principalKind: 'account',
  subject: SUBJECT,
  permissions: ['operations.dispatch'],
};
const booking: Actor = { kind: 'SERVICE', clientId: 'booking', scopes: ['scheduling.hold.commit'] };
const scopeless: Actor = { kind: 'SERVICE', clientId: 'dispatch', scopes: [] };

test('authorization is deny-by-default for every access mode', () => {
  assert.equal(requirePrincipal(customer), customer);
  assert.equal(
    code(() => requirePrincipal(booking)),
    'FORBIDDEN',
  );
  assert.equal(
    code(() => requirePrincipal({ kind: 'SYSTEM', component: 'x' })),
    'FORBIDDEN',
  );
  assert.equal(requireScope(booking, 'scheduling.hold.commit'), booking);
  assert.equal(
    code(() => requireScope(scopeless, 'scheduling.hold.commit')),
    'FORBIDDEN',
  );
  assert.equal(
    code(() => requireScope(ops, 'scheduling.hold.commit')),
    'FORBIDDEN',
    'a staff permission is not a service scope',
  );
  assert.equal(isOperations(ops), true);
  assert.equal(isOperations(customer), false);
  assert.equal(
    code(() => requireOperations(customer)),
    'FORBIDDEN',
  );
  assert.equal(actorKey(customer), `guest:${SUBJECT}`);
  assert.equal(actorKey(booking), 'service:booking');
});

test('service clients: only digests are configured and only exact matches authenticate', () => {
  const clients = parseServiceClients(
    JSON.stringify([
      { id: 'booking', tokenSha256: digest(TOKEN), scopes: ['scheduling.hold.commit'] },
    ]),
  );
  const auth = new ServiceClientAuthenticator(clients);
  assert.equal(auth.authenticate('booking', TOKEN)?.id, 'booking');
  assert.equal(auth.authenticate('booking', 'b'.repeat(40)), null);
  assert.equal(auth.authenticate('dispatch', TOKEN), null, 'a valid secret for another id');
  assert.equal(auth.authenticate('booking', 'short'), null);
  assert.deepEqual(parseServiceClients(undefined), []);
  assert.throws(
    () =>
      parseServiceClients(
        JSON.stringify([
          { id: 'booking', tokenSha256: digest(TOKEN), scopes: ['scheduling.holds.write'] },
        ]),
      ),
    /SCOPE/,
    'the pre-v1 scope is no longer granted',
  );
  assert.throws(
    () =>
      parseServiceClients(
        '[{"id":"booking","tokenSha256":"x","scopes":["scheduling.hold.commit"]}]',
      ),
    /DIGEST/,
  );
});

test('identity client requires the principal kind and fails closed', async () => {
  const good = identityReturning(200, {
    subject: SUBJECT,
    principalKind: 'guest',
    permissions: ['bookings.create:self'],
    roles: [],
  });
  const session = await good.resolve(`Bearer ${TOKEN}`, SUBJECT);
  assert.equal(session.principalKind, 'guest');
  assert.equal(
    await reason(
      identityReturning(200, { subject: SUBJECT, permissions: [] }).resolve(
        `Bearer ${TOKEN}`,
        SUBJECT,
      ),
    ),
    'UNAVAILABLE',
    'a session without principalKind is never guessed to be an account',
  );
  assert.equal(
    await reason(
      identityReturning(200, { subject: SUBJECT, principalKind: 'staff', permissions: [] }).resolve(
        `Bearer ${TOKEN}`,
        SUBJECT,
      ),
    ),
    'UNAVAILABLE',
  );
  assert.equal(
    await reason(identityReturning(401, {}).resolve(`Bearer ${TOKEN}`, SUBJECT)),
    'UNAUTHENTICATED',
  );
  assert.equal(
    await reason(identityReturning(500, {}).resolve(`Bearer ${TOKEN}`, SUBJECT)),
    'UNAVAILABLE',
  );
  assert.equal(await reason(good.resolve('Basic abc', SUBJECT)), 'UNAUTHENTICATED');
  const hanging = new IdentitySessionClient({
    baseUrl: 'http://identity.internal:3000',
    timeoutMs: 50,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  });
  assert.equal(await reason(hanging.resolve(`Bearer ${TOKEN}`, SUBJECT)), 'UNAVAILABLE');
});

test('actor resolver: exactly one credential; principal kind comes from Identity', async () => {
  const clients = new ServiceClientAuthenticator(
    parseServiceClients(
      JSON.stringify([
        { id: 'booking', tokenSha256: digest(TOKEN), scopes: ['scheduling.hold.commit'] },
      ]),
    ),
  );
  const resolver = new ActorResolver(
    identityReturning(200, { subject: SUBJECT, principalKind: 'guest', permissions: [] }),
    clients,
    new RequestBudget(100),
    new RequestBudget(100),
    new RequestBudget(2),
  );
  assert.equal(await reason(resolver.resolve({ headers: {} })), 'UNAUTHENTICATED');
  assert.equal(
    await reason(
      resolver.resolve({
        headers: {
          'x-service-client': 'booking',
          'x-service-token': TOKEN,
          authorization: `Bearer ${TOKEN}`,
        },
      }),
    ),
    'UNAUTHENTICATED',
  );
  assert.equal(
    await reason(
      resolver.resolve({ headers: { authorization: [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`] } }),
    ),
    'UNAUTHENTICATED',
  );
  const user = await resolver.resolve({ headers: { authorization: `Bearer ${TOKEN}` } });
  assert.deepEqual(user.actor, {
    kind: 'USER',
    principalKind: 'guest',
    subject: SUBJECT,
    permissions: [],
  });
  resolver.takePublic({ headers: {}, ip: '10.0.0.1' });
  resolver.takePublic({ headers: {}, ip: '10.0.0.1' });
  assert.throws(() => resolver.takePublic({ headers: {}, ip: '10.0.0.1' }), RateLimited);
  assert.doesNotThrow(() => resolver.takePublic({ headers: {}, ip: '10.0.0.2' }));
});

test('wire parsing mirrors scheduling.v1: closed objects, canonical UTC, bounded revisions', () => {
  const valid = {
    beneficiary: { kind: 'guest', subjectId: SUBJECT },
    zoneId: SUBJECT,
    startsAt: '2026-10-08T09:00:00.000Z',
    durationMinutes: 45,
    quoteRef: { quoteId: SUBJECT, revision: 1 },
  };
  assert.equal(holdRequest(valid).durationMinutes, 45);
  assert.equal(
    code(() => holdRequest({ ...valid, extra: 1 })),
    'REQUEST_INVALID $.extra',
  );
  assert.equal(
    code(() => holdRequest({ ...valid, startsAt: '2026-10-08T09:00:00Z' })),
    'REQUEST_INVALID $.startsAt',
    'milliseconds are part of the canonical form',
  );
  assert.equal(
    code(() => holdRequest({ ...valid, startsAt: '2026-10-08T12:00:00.000+03:00' })),
    'REQUEST_INVALID $.startsAt',
  );
  assert.equal(
    code(() => holdRequest({ ...valid, durationMinutes: 4 })),
    'REQUEST_INVALID $.durationMinutes',
  );
  assert.equal(
    code(() => holdRequest({ ...valid, beneficiary: { kind: 'staff', subjectId: SUBJECT } })),
    'REQUEST_INVALID $.beneficiary.kind',
  );
  assert.equal(
    code(() => commitRequest({ expectedRevision: 0, bookingId: SUBJECT })),
    'REQUEST_INVALID $.expectedRevision',
  );
  assert.equal(
    code(() => commitRequest({ expectedRevision: 2 ** 31, bookingId: SUBJECT })),
    'REQUEST_INVALID $.expectedRevision',
  );
  assert.equal(
    code(() => releaseRequest({ expectedRevision: 1, reason: 'OPERATIONS_OVERRIDE' })),
    'REQUEST_INVALID $.reason',
    'the staff-only reason is not on the principal surface',
  );
  assert.equal(
    releaseRequest({ expectedRevision: 1, reason: 'EXPIRED_BY_CLIENT' }).reason,
    'EXPIRED_BY_CLIENT',
  );
  assert.equal(
    code(() => utc('2026-02-30T00:00:00.000Z', '$.x')),
    'REQUEST_INVALID $.x',
  );
});

test('errors use the published envelope; status and retryable follow the code', () => {
  const body = (error: unknown) => errorBody(mapError(error), 'corr-1', 'req-1').error;
  const expectations: [unknown, string, number, string | null, boolean][] = [
    [
      new SchedulingError('HOLD_EXPIRED', 'x'),
      'BUSINESS_RULE_VIOLATION',
      422,
      'HOLD_EXPIRED',
      false,
    ],
    [
      new SchedulingError('HOLD_NOT_ACTIVE', 'x'),
      'BUSINESS_RULE_VIOLATION',
      422,
      'HOLD_NOT_ACTIVE',
      false,
    ],
    [
      new SchedulingError('CAPACITY_EXHAUSTED', 'x'),
      'BUSINESS_RULE_VIOLATION',
      422,
      'SLOT_UNAVAILABLE',
      false,
    ],
    [
      new SchedulingError('OUTSIDE_HORIZON', 'x'),
      'BUSINESS_RULE_VIOLATION',
      422,
      'OUTSIDE_HORIZON',
      false,
    ],
    [new SchedulingError('VERSION_CONFLICT', 'x'), 'REVISION_CONFLICT', 412, null, false],
    [new SchedulingError('HOLD_NOT_FOUND', 'x'), 'NOT_FOUND', 404, null, false],
    [new SchedulingError('FORBIDDEN', 'x'), 'AUTH_FORBIDDEN', 403, null, false],
    [new SchedulingError('IDEMPOTENCY_KEY_REUSED', 'x'), 'IDEMPOTENCY_CONFLICT', 409, null, false],
    [
      new SchedulingError('IDEMPOTENCY_IN_PROGRESS', 'x'),
      'IDEMPOTENCY_IN_PROGRESS',
      409,
      null,
      true,
    ],
    [
      new SchedulingError('IDEMPOTENCY_KEY_REQUIRED', 'x'),
      'IDEMPOTENCY_KEY_REQUIRED',
      428,
      null,
      false,
    ],
    [
      new SchedulingError('BOOKING_ALREADY_COMMITTED', 'x'),
      'CONFLICT',
      409,
      'BOOKING_ALREADY_COMMITTED',
      false,
    ],
    [new IdentityAuthFailure('UNAUTHENTICATED'), 'AUTH_REQUIRED', 401, null, false],
    [new IdentityAuthFailure('UNAVAILABLE'), 'DEPENDENCY_UNAVAILABLE', 503, null, true],
    [new RateLimited(), 'RATE_LIMITED', 429, null, true],
    [new RequestInvalid('$.x'), 'REQUEST_INVALID', 400, null, false],
    [new Error('boom'), 'INTERNAL_ERROR', 500, null, false],
  ];
  for (const [error, expected, status, why, retryable] of expectations) {
    const e = body(error);
    assert.equal(e.code, expected);
    assert.equal(statusOf(e.code), status);
    assert.equal(e.reason, why);
    assert.equal(e.retryable, retryable);
    if (!retryable) assert.equal(e.retryAfterMs, null, 'a hint only for retryable codes');
    assert.equal(e.correlationId, 'corr-1');
  }
  assert.equal(body(new Error('secret detail')).message, 'Internal error.', 'no internals leak');
});

test('SQLSTATE is read from both driver-adapter error shapes; conflicts are retryable 503', () => {
  const plain = { code: 'P2010', meta: { driverAdapterError: { cause: { code: '23P01' } } } };
  const classified = {
    code: 'P2010',
    meta: {
      driverAdapterError: { cause: { originalCode: '40P01', kind: 'TransactionWriteConflict' } },
    },
  };
  assert.equal(sqlState(plain), '23P01');
  assert.equal(sqlState(classified), '40P01');
  assert.equal(sqlState(new Error('x')), undefined);
  assert.equal(isTransientConflict(classified), true);
  assert.equal(isTransientConflict(plain), false);
  assert.equal(
    mapError(Object.assign(new Error('deadlock'), classified)).code,
    'DEPENDENCY_UNAVAILABLE',
  );
});
