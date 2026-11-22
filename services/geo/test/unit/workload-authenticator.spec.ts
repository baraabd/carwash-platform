import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { ServiceWorkloadAuthenticator } from '../../src/infrastructure/identity/workload-authenticator';

const token = randomBytes(32).toString('base64url');
const configuration = JSON.stringify([
  {
    id: 'booking',
    tokenSha256: createHash('sha256').update(token).digest('hex'),
    scopes: ['geo.serviceability.validate'],
  },
]);
const credential = { 'x-service-client': 'booking', 'x-service-token': token };

test('geo workload: configured credential resolves only its owner-granted scope', async () => {
  const auth = new ServiceWorkloadAuthenticator(configuration);
  assert.deepEqual(await auth.authenticate(credential), {
    service: 'booking',
    scopes: ['geo.serviceability.validate'],
  });
  for (const headers of [
    {},
    { 'x-service-client': 'booking' },
    { ...credential, 'x-service-token': randomBytes(32).toString('base64url') },
    { ...credential, 'x-service-client': 'pricing' },
    { ...credential, authorization: 'Bearer user-session' },
    { ...credential, cookie: '' },
    { ...credential, authorization: undefined },
  ]) {
    await assert.rejects(auth.authenticate(headers), /AUTH_FORBIDDEN/);
  }
});

test('geo workload: absent configuration refuses credentials and malformed authority stops startup', async () => {
  for (const raw of [undefined, '', '[]'])
    await assert.rejects(
      new ServiceWorkloadAuthenticator(raw).authenticate(credential),
      /AUTH_FORBIDDEN/,
    );
  for (const raw of [
    '{',
    '{}',
    configuration.replace('geo.serviceability.validate', 'vehicle.snapshot.resolve'),
    JSON.stringify([{ id: 'booking', token, scopes: ['geo.serviceability.validate'] }]),
  ]) {
    assert.throws(() => new ServiceWorkloadAuthenticator(raw), /SERVICE_CLIENTS_INVALID/);
  }
});
