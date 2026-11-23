import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DispatchService } from '../../src/application';
import { DispatchError } from '../../src/domain';
import {
  IdentityAuthFailure,
  IdentitySessionClient,
} from '../../src/infrastructure/identity/identity-session.client';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from '../../src/infrastructure/security/service-clients';
import {
  ConcurrencyViolation,
  isTransientConflict,
  sqlState,
} from '../../src/infrastructure/persistence/prisma-dispatch.store';
import { ActorResolver, RequestBudget } from '../../src/transport/http/actor-resolver';
import { RateLimited, errorBody, statusOf } from '../../src/transport/http/http-errors';
import type { Actor, DispatchReadModel, DispatchUnitOfWork, RequestMeta } from '../../src/ports';

const SUBJECT = '0b8f6f8e-1d5a-4c1e-9e5f-0a3b2c1d4e5f';
const ID = '0b8f6f8e-1d5a-4c1e-9e5f-0a3b2c1d4e60';
const TOKEN = 'a'.repeat(40);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Any touch of persistence fails the test: authorization must refuse first. */
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error('PERSISTENCE_TOUCHED');
    },
  },
) as DispatchUnitOfWork & DispatchReadModel;

const service = new DispatchService(
  untouchable,
  untouchable,
  { now: () => new Date('2026-10-10T08:00:00.000Z') },
  { next: () => ID },
);

const user = (...permissions: string[]): RequestMeta => ({
  actor: { kind: 'USER', subject: SUBJECT, permissions },
  correlationId: ID,
});
const svc = (...scopes: Array<'dispatch.assignment.read'>): RequestMeta => ({
  actor: { kind: 'SERVICE', clientId: 'booking', scopes },
  correlationId: ID,
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DispatchError) return error.code;
    return (error as Error).message;
  }
  return 'OK';
}

test('deny by default: every command refuses a caller without the exact permission', async () => {
  const offerInput = { expectedRevision: 1, resourceId: ID, technicianSubject: SUBJECT };
  const cases: Array<[string, Promise<unknown>]> = [
    [
      'offer by technician',
      service.offer(user('work.execute:assigned'), ID, offerInput, 'k'.repeat(16)),
    ],
    [
      'reassign by customer',
      service.reassign(user('bookings.create:self'), ID, offerInput, 'k'.repeat(16)),
    ],
    [
      'unassign by service',
      service.unassign(
        svc('dispatch.assignment.read'),
        ID,
        { expectedRevision: 1 },
        'k'.repeat(16),
      ),
    ],
    ['accept by ops', service.acceptOffer(user('operations.dispatch'), ID, 'k'.repeat(16))],
    [
      'accept by read-only technician',
      service.acceptOffer(user('work.read:assigned'), ID, 'k'.repeat(16)),
    ],
    [
      'decline by service',
      service.declineOffer(svc('dispatch.assignment.read'), ID, 'OTHER', null, 'k'.repeat(16)),
    ],
    ['ops read by technician', service.getAssignment(user('work.read:assigned'), ID)],
    ['booking read by service without scope', service.getAssignmentByBooking(svc(), ID)],
    ['booking read by customer', service.getAssignmentByBooking(user('bookings.read:self'), ID)],
    ['my offers by ops', service.listMyOffers(user('operations.dispatch'))],
  ];
  for (const [label, promise] of cases) {
    assert.equal(await codeOf(promise), 'FORBIDDEN', label);
  }
});

test('commands validate the Idempotency-Key and ids before touching persistence', async () => {
  const ops = user('operations.dispatch');
  const input = { expectedRevision: 1, resourceId: ID, technicianSubject: SUBJECT };
  assert.equal(await codeOf(service.offer(ops, ID, input, undefined)), 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(await codeOf(service.offer(ops, ID, input, '')), 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(await codeOf(service.offer(ops, ID, input, 'short')), 'INVALID_INPUT');
  assert.equal(
    await codeOf(service.offer(ops, ID, input, 'bad key with spaces!')),
    'INVALID_INPUT',
  );
  assert.equal(await codeOf(service.offer(ops, 'x', input, 'k'.repeat(16))), 'INVALID_INPUT');
  assert.equal(
    await codeOf(service.offer(ops, ID, { ...input, resourceId: 'r' }, 'k'.repeat(16))),
    'INVALID_INPUT',
  );
  assert.equal(
    await codeOf(service.offer(ops, ID, { ...input, expectedRevision: 0 }, 'k'.repeat(16))),
    'INVALID_INPUT',
  );
  assert.equal(
    await codeOf(service.offer(ops, ID, { ...input, ttlSeconds: 5 }, 'k'.repeat(16))),
    'INVALID_INPUT',
  );
});

test('list queries are bounded to a 31-day span', async () => {
  const ops = user('operations.dispatch');
  const from = new Date('2026-10-10T00:00:00.000Z');
  assert.equal(
    await codeOf(service.listAssignments(ops, { zoneId: ID, from, to: from, status: null })),
    'INVALID_INPUT',
  );
  assert.equal(
    await codeOf(
      service.listAssignments(ops, {
        zoneId: ID,
        from,
        to: new Date(from.getTime() + 32 * 86_400_000),
        status: null,
      }),
    ),
    'INVALID_INPUT',
  );
});

test('error envelope: shared codes, owner reasons, retryable only where the contract says', () => {
  const ids = ['corr-1', 'req-1'] as const;
  const body = (error: unknown) => errorBody(error, ids[0], ids[1]);
  const notLive = body(new DispatchError('OFFER_NOT_LIVE', 'internal detail'));
  assert.equal(notLive.error.code, 'CONFLICT');
  assert.equal(notLive.error.reason, 'OFFER_NOT_LIVE');
  assert.equal(notLive.error.message, 'The request conflicts with the current state.');
  assert.equal(statusOf(notLive), 409);
  assert.equal(notLive.error.retryable, false);
  assert.equal(notLive.error.retryAfterMs, null);

  const revision = body(new DispatchError('REVISION_CONFLICT', 'x'));
  assert.equal(revision.error.code, 'REVISION_CONFLICT');
  assert.equal(revision.error.reason, null);
  assert.equal(statusOf(revision), 412);

  assert.equal(statusOf(body(new DispatchError('IDEMPOTENCY_KEY_REQUIRED', 'x'))), 428);
  assert.equal(statusOf(body(new DispatchError('OFFER_NOT_FOUND', 'x'))), 404);
  assert.equal(body(new DispatchError('OFFER_NOT_FOUND', 'x')).error.reason, 'OFFER_NOT_FOUND');
  assert.equal(body(new DispatchError('FORBIDDEN', 'x')).error.reason, null);
  assert.equal(statusOf(body(new IdentityAuthFailure('UNAUTHENTICATED'))), 401);

  const down = body(new IdentityAuthFailure('UNAVAILABLE'));
  assert.equal(statusOf(down), 503);
  assert.equal(down.error.retryable, true);
  assert.equal(down.error.reason, 'IDENTITY_UNAVAILABLE');

  const limited = body(new RateLimited(12_345.2));
  assert.equal(statusOf(limited), 429);
  assert.equal(limited.error.retryAfterMs, 12_346);

  assert.equal(body(new ConcurrencyViolation('ASSIGNMENT')).error.reason, 'CONCURRENT_UPDATE');
  const deadlock = { meta: { driverAdapterError: { cause: { originalCode: '40P01' } } } };
  assert.equal(body(deadlock).error.code, 'DEPENDENCY_UNAVAILABLE');
  const internal = body(new Error('connect ECONNREFUSED postgresql://user:secret@db'));
  assert.equal(statusOf(internal), 500);
  assert.ok(!JSON.stringify(internal).includes('secret'), 'internal text never reflected');
});

test('sqlState reads both adapter shapes', () => {
  assert.equal(sqlState({ meta: { driverAdapterError: { cause: { code: '23P01' } } } }), '23P01');
  assert.equal(
    isTransientConflict({ meta: { driverAdapterError: { cause: { originalCode: '40001' } } } }),
    true,
  );
  assert.equal(isTransientConflict(new Error('x')), false);
});

test('service clients: digests only, unknown scopes and malformed config fail closed', () => {
  assert.deepEqual(parseServiceClients(undefined), []);
  assert.throws(() => parseServiceClients('{'), /INVALID_JSON/);
  assert.throws(
    () =>
      parseServiceClients(
        JSON.stringify([
          { id: 'booking', tokenSha256: digest(TOKEN), scopes: ['scheduling.hold.commit'] },
        ]),
      ),
    /INVALID_SCOPE/,
  );
  assert.throws(
    () =>
      parseServiceClients(
        JSON.stringify([
          { id: 'booking', tokenSha256: 'abc', scopes: ['dispatch.assignment.read'] },
        ]),
      ),
    /INVALID_DIGEST/,
  );
  const auth = new ServiceClientAuthenticator(
    parseServiceClients(
      JSON.stringify([
        { id: 'booking', tokenSha256: digest(TOKEN), scopes: ['dispatch.assignment.read'] },
      ]),
    ),
  );
  assert.equal(auth.authenticate('booking', TOKEN)?.id, 'booking');
  assert.equal(auth.authenticate('booking', 'b'.repeat(40)), null);
  assert.equal(auth.authenticate('other', TOKEN), null);
  assert.equal(auth.authenticate('booking', 'short'), null);
});

test('actor resolver: exactly one credential kind; Identity decides user permissions', async () => {
  const identity = new IdentitySessionClient({
    baseUrl: 'http://identity.internal:3000',
    fetchImpl: () =>
      Promise.resolve(
        new Response(JSON.stringify({ subject: SUBJECT, permissions: ['operations.dispatch'] }), {
          status: 200,
        }),
      ),
  });
  const auth = new ServiceClientAuthenticator(
    parseServiceClients(
      JSON.stringify([
        { id: 'booking', tokenSha256: digest(TOKEN), scopes: ['dispatch.assignment.read'] },
      ]),
    ),
  );
  const resolver = new ActorResolver(
    identity,
    auth,
    new RequestBudget(100),
    new RequestBudget(100),
  );
  const reason = async (headers: Record<string, string>) => {
    try {
      const meta = await resolver.resolve({ headers });
      return meta.actor.kind;
    } catch (error) {
      return error instanceof IdentityAuthFailure ? error.reason : (error as Error).message;
    }
  };
  assert.equal(await reason({}), 'UNAUTHENTICATED');
  assert.equal(await reason({ authorization: `Bearer ${'t'.repeat(32)}` }), 'USER');
  assert.equal(
    await reason({ 'x-service-client': 'booking', 'x-service-token': TOKEN }),
    'SERVICE',
  );
  assert.equal(
    await reason({
      'x-service-client': 'booking',
      'x-service-token': TOKEN,
      authorization: `Bearer ${'t'.repeat(32)}`,
    }),
    'UNAUTHENTICATED',
  );
  assert.equal(await reason({ 'x-service-client': 'booking' }), 'UNAUTHENTICATED');
  // Forged permission headers are ignored: permissions come from Identity only.
  const meta = await resolver.resolve({
    headers: {
      authorization: `Bearer ${'t'.repeat(32)}`,
      'x-auth-permissions': 'work.execute:assigned',
    },
  });
  const actor: Actor = meta.actor;
  assert.deepEqual(actor.kind === 'USER' ? actor.permissions : [], ['operations.dispatch']);
});

test('request budget answers RateLimited with the remaining window', () => {
  let now = 0;
  const budget = new RequestBudget(2, 60_000, () => now);
  budget.take('a');
  budget.take('a');
  now = 10_000;
  assert.throws(
    () => budget.take('a'),
    (error: unknown) => error instanceof RateLimited && error.retryAfterMs === 50_000,
  );
  budget.take('b');
  now = 60_000;
  budget.take('a');
});
