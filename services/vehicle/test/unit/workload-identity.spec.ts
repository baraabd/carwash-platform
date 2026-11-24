import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { serviceTokenDigest } from '@carwash/service-kit';
import { ApplicationError } from '../../src/application/errors';
import { ServiceWorkloadIdentity } from '../../src/infrastructure/identity/service-workload-identity';

const token = randomBytes(32).toString('hex');
const credential = { serviceClient: 'booking', serviceToken: token, correlationId: randomUUID() };
const config = JSON.stringify([
  { id: 'booking', tokenSha256: serviceTokenDigest(token), scopes: ['vehicle.snapshot.resolve'] },
]);
const denied = (error: unknown) =>
  error instanceof ApplicationError && ['AUTH_REQUIRED', 'AUTH_FORBIDDEN'].includes(error.code);

test('vehicle runtime workload identity accepts only the configured client and snapshot scope', async () => {
  const auth = new ServiceWorkloadIdentity(config);
  assert.deepEqual(await auth.authenticate(credential), {
    service: 'booking',
    scopes: ['vehicle.snapshot.resolve'],
  });
  for (const value of [
    { ...credential, serviceToken: randomBytes(32).toString('hex') },
    { ...credential, serviceClient: 'pricing' },
    { ...credential, authorization: 'Bearer browser-session' },
    { ...credential, cookie: 'wg_access=browser-session' },
    { serviceClient: 'booking', correlationId: randomUUID() },
    { correlationId: randomUUID() },
  ])
    await assert.rejects(auth.authenticate(value), denied);
});

test('vehicle workload identity fails closed without configuration and refuses malformed scope grants', async () => {
  await assert.rejects(new ServiceWorkloadIdentity(undefined).authenticate(credential), denied);
  assert.throws(
    () =>
      new ServiceWorkloadIdentity(
        JSON.stringify([{ id: 'booking', tokenSha256: serviceTokenDigest(token), scopes: ['*'] }]),
      ),
  );
  assert.throws(() => new ServiceWorkloadIdentity('not-json'));
  assert.throws(
    () =>
      new ServiceWorkloadIdentity(
        JSON.stringify([{ id: 'booking', token: token, scopes: ['vehicle.snapshot.resolve'] }]),
      ),
  );
});
