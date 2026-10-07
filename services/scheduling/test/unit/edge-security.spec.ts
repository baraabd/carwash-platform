import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { availabilityAudience, requireOperations, requireScope } from '../../src/application';
import { SchedulingError } from '../../src/domain';
import {
  IdentityAuthFailure,
  IdentitySessionClient,
} from '../../src/infrastructure/identity/identity-session.client';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from '../../src/infrastructure/security/service-clients';
import { ActorResolver, RequestBudget } from '../../src/transport/http/actor-resolver';
import { RateLimited, toAppError } from '../../src/transport/http/http-errors';
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

test('authorization is deny-by-default for every actor kind', () => {
  const customer = {
    kind: 'USER' as const,
    subject: SUBJECT,
    permissions: ['bookings.create:self'],
  };
  const ops = { kind: 'USER' as const, subject: SUBJECT, permissions: ['operations.dispatch'] };
  const nobody = { kind: 'USER' as const, subject: SUBJECT, permissions: [] };
  const reader = {
    kind: 'SERVICE' as const,
    clientId: 'gateway',
    scopes: ['scheduling.availability.read' as const],
  };
  assert.equal(availabilityAudience(customer), 'CUSTOMER');
  assert.equal(availabilityAudience(ops), 'DETAILED');
  assert.equal(availabilityAudience(reader), 'DETAILED');
  assert.throws(() => availabilityAudience(nobody), SchedulingError);
  assert.throws(() => requireOperations(customer), SchedulingError);
  assert.throws(() => requireScope(reader, 'scheduling.holds.write'), SchedulingError);
  assert.throws(() => requireScope(ops, 'scheduling.holds.write'), SchedulingError);
  assert.throws(() => availabilityAudience({ kind: 'SYSTEM', component: 'x' }), SchedulingError);
});

test('service clients: only digests are configured and only exact matches authenticate', () => {
  const clients = parseServiceClients(
    JSON.stringify([
      { id: 'booking', tokenSha256: digest(TOKEN), scopes: ['scheduling.holds.write'] },
    ]),
  );
  const auth = new ServiceClientAuthenticator(clients);
  assert.equal(auth.authenticate('booking', TOKEN)?.id, 'booking');
  assert.equal(auth.authenticate('booking', 'b'.repeat(40)), null);
  assert.equal(
    auth.authenticate('dispatch', TOKEN),
    null,
    'a valid secret for another id is rejected',
  );
  assert.equal(auth.authenticate('booking', 'short'), null);
  assert.deepEqual(parseServiceClients(undefined), []);
  assert.throws(
    () =>
      parseServiceClients(
        '[{"id":"booking","tokenSha256":"x","scopes":["scheduling.holds.write"]}]',
      ),
    /DIGEST/,
  );
  assert.throws(
    () =>
      parseServiceClients(
        JSON.stringify([{ id: 'booking', tokenSha256: digest(TOKEN), scopes: ['admin'] }]),
      ),
    /SCOPE/,
  );
  assert.throws(
    () =>
      parseServiceClients(
        JSON.stringify([
          { id: 'booking', tokenSha256: digest(TOKEN), scopes: ['scheduling.holds.write'] },
          { id: 'booking', tokenSha256: digest(TOKEN), scopes: ['scheduling.holds.write'] },
        ]),
      ),
    /INVALID_ID/,
  );
});

test('identity client fails closed and never invents an identity', async () => {
  const good = identityReturning(200, {
    subject: SUBJECT,
    permissions: ['operations.dispatch'],
    roles: ['operations'],
  });
  const session = await good.resolve(`Bearer ${TOKEN}`, SUBJECT);
  assert.deepEqual(session.permissions, ['operations.dispatch']);
  assert.equal(
    await reason(identityReturning(401, {}).resolve(`Bearer ${TOKEN}`, SUBJECT)),
    'UNAUTHENTICATED',
  );
  assert.equal(
    await reason(identityReturning(500, {}).resolve(`Bearer ${TOKEN}`, SUBJECT)),
    'UNAVAILABLE',
  );
  assert.equal(
    await reason(
      identityReturning(200, { subject: 'x', permissions: [] }).resolve(`Bearer ${TOKEN}`, SUBJECT),
    ),
    'UNAVAILABLE',
  );
  assert.equal(await reason(good.resolve('Basic abc', SUBJECT)), 'UNAUTHENTICATED');
  const unconfigured = new IdentitySessionClient({ baseUrl: undefined });
  assert.equal(await reason(unconfigured.resolve(`Bearer ${TOKEN}`, SUBJECT)), 'UNAVAILABLE');
  const hanging = new IdentitySessionClient({
    baseUrl: 'http://identity.internal:3000',
    timeoutMs: 50,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  });
  assert.equal(
    await reason(hanging.resolve(`Bearer ${TOKEN}`, SUBJECT)),
    'UNAVAILABLE',
    'timeout is not success',
  );
});

test('actor resolver rejects missing, mixed and duplicated credentials', async () => {
  const clients = new ServiceClientAuthenticator(
    parseServiceClients(
      JSON.stringify([
        { id: 'booking', tokenSha256: digest(TOKEN), scopes: ['scheduling.holds.write'] },
      ]),
    ),
  );
  const resolver = new ActorResolver(
    identityReturning(200, { subject: SUBJECT, permissions: [] }),
    clients,
    new RequestBudget(100),
    new RequestBudget(100),
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
    await reason(resolver.resolve({ headers: { 'x-service-client': 'booking' } })),
    'UNAUTHENTICATED',
  );
  assert.equal(
    await reason(
      resolver.resolve({ headers: { authorization: [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`] } }),
    ),
    'UNAUTHENTICATED',
  );
  const meta = await resolver.resolve({
    headers: { 'x-service-client': 'booking', 'x-service-token': TOKEN },
  });
  assert.deepEqual(meta.actor, {
    kind: 'SERVICE',
    clientId: 'booking',
    scopes: ['scheduling.holds.write'],
  });
});

test('request budget limits one actor per window and resets afterwards', () => {
  let now = 0;
  const budget = new RequestBudget(2, 1_000, () => now);
  budget.take('a');
  budget.take('a');
  assert.throws(() => budget.take('a'), RateLimited);
  budget.take('b');
  now = 1_000;
  assert.doesNotThrow(() => budget.take('a'));
});

test('domain and auth failures map to stable HTTP statuses; unknown errors stay 500', () => {
  const status = (error: unknown) => (toAppError(error) as { status?: number }).status;
  assert.equal(status(new SchedulingError('CAPACITY_EXHAUSTED', 'x')), 409);
  assert.equal(status(new SchedulingError('FORBIDDEN', 'x')), 403);
  assert.equal(status(new SchedulingError('HOLD_NOT_FOUND', 'x')), 404);
  assert.equal(status(new SchedulingError('IDEMPOTENCY_KEY_REUSED', 'x')), 422);
  assert.equal(status(new IdentityAuthFailure('UNAVAILABLE')), 503);
  assert.equal(status(new IdentityAuthFailure('UNAUTHENTICATED')), 401);
  assert.equal(status(Object.assign(new Error('x'), { code: 'P2028' })), 503);
  const unknown = new Error('boom');
  assert.equal(toAppError(unknown), unknown);
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
    (toAppError(Object.assign(new Error('deadlock'), classified)) as { status?: number }).status,
    503,
  );
});
