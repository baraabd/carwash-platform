import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  IdentityAuthFailure,
  IdentitySessionClient,
} from '../../src/infrastructure/identity/identity-session.client';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from '../../src/infrastructure/security/service-clients';
import { ActorResolver, RequestBudget } from '../../src/transport/http/actor-resolver';

test('workforce edge: Identity outage fails closed', async () => {
  const client = new IdentitySessionClient({
    baseUrl: 'http://identity.invalid',
    fetchImpl: () => Promise.reject(new Error('down')),
  });
  await assert.rejects(
    () => client.resolve('Bearer abcdefghijklmnop', '11111111-1111-4111-8111-111111111111'),
    (error: unknown) => error instanceof IdentityAuthFailure && error.reason === 'UNAVAILABLE',
  );
});

test('workforce edge: service credentials are digest-configured and scope bounded', () => {
  const token = 'x'.repeat(48);
  const digest = createHash('sha256').update(token).digest('hex');
  const auth = new ServiceClientAuthenticator(
    parseServiceClients(
      JSON.stringify([
        {
          id: 'dispatch',
          tokenSha256: digest,
          scopes: ['workforce.eligibility.read'],
        },
      ]),
    ),
  );
  assert.equal(auth.authenticate('dispatch', token)?.scopes[0], 'workforce.eligibility.read');
  assert.equal(auth.authenticate('dispatch', 'y'.repeat(48)), null);
});

test('workforce edge: presenting user and service credentials together is rejected', async () => {
  const token = 'x'.repeat(48);
  const digest = createHash('sha256').update(token).digest('hex');
  const actors = new ActorResolver(
    new IdentitySessionClient({ baseUrl: 'http://identity.invalid' }),
    new ServiceClientAuthenticator(
      parseServiceClients(
        JSON.stringify([
          {
            id: 'dispatch',
            tokenSha256: digest,
            scopes: ['workforce.eligibility.read'],
          },
        ]),
      ),
    ),
    new RequestBudget(10),
    new RequestBudget(10),
  );
  await assert.rejects(
    () =>
      actors.resolve({
        headers: {
          authorization: 'Bearer abcdefghijklmnop',
          'x-service-client': 'dispatch',
          'x-service-token': token,
        },
      }),
    (error: unknown) => error instanceof IdentityAuthFailure && error.reason === 'UNAUTHENTICATED',
  );
});
