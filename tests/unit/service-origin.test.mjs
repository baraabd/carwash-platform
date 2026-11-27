import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isServiceOriginAllowed,
  isServiceUrlAllowed,
  privateServiceNetworkFromEnv,
} = require('../../packages/security-kit/dist/service-origin.js');
const { AccessTokenVerifier } = require('../../packages/security-kit/dist/jwt-verifier.js');
const deployment = () => ({
  CW_PRIVATE_NETWORK: 'railway',
  CW_PRIVATE_HTTP_HOSTS: 'identity.railway.internal,billing.railway.internal',
  RAILWAY_PROJECT_ID: randomUUID(),
  RAILWAY_ENVIRONMENT_ID: randomUUID(),
});

test('owner credentials can travel only over HTTPS, loopback or scoped encrypted Railway targets', () => {
  const env = deployment();
  for (const value of [
    'https://identity.example.invalid',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])
    assert.equal(isServiceOriginAllowed(new URL(value), {}), true);
  assert.equal(isServiceOriginAllowed(new URL('http://identity.railway.internal:3000'), env), true);
  for (const value of [
    'http://identity',
    'http://10.0.0.1',
    'http://example.invalid',
    'http://identity.railway.internal.evil.invalid',
    'http://railway.internal',
    'http://identity.railway.internal.',
    'http://unlisted.railway.internal',
    'http://user:password@identity.railway.internal',
    'http://identity.railway.internal/path',
    'http://identity.railway.internal?query=1',
    'ftp://identity.railway.internal',
  ])
    assert.equal(isServiceOriginAllowed(new URL(value), env), false, value);
  assert.equal(isServiceOriginAllowed(new URL('http://identity.railway.internal:3000'), {}), false);
});

test('private transport refuses missing platform scope and wildcard or non-private allowlists', () => {
  for (const change of [
    { CW_PRIVATE_NETWORK: 'true' },
    { RAILWAY_PROJECT_ID: '' },
    { RAILWAY_ENVIRONMENT_ID: '' },
    { CW_PRIVATE_HTTP_HOSTS: '' },
    { CW_PRIVATE_HTTP_HOSTS: '*.railway.internal' },
    { CW_PRIVATE_HTTP_HOSTS: 'identity.railway.internal,example.invalid' },
    { CW_PRIVATE_HTTP_HOSTS: 'identity.railway.internal.evil.invalid' },
  ])
    assert.throws(() => privateServiceNetworkFromEnv({ ...deployment(), ...change }));
});

test('JWKS uses the same private host boundary and preserves endpoint restrictions', () => {
  const network = privateServiceNetworkFromEnv(deployment());
  const policy = { issuer: 'https://identity.example.invalid', audience: 'washgo' };
  const allowed = new URL(
    'http://identity.railway.internal:3000/internal/v1/identity/.well-known/jwks.json',
  );
  assert.equal(isServiceUrlAllowed(allowed, network), true);
  assert.doesNotThrow(() => new AccessTokenVerifier(policy, allowed, network));
  assert.throws(
    () =>
      new AccessTokenVerifier(policy, new URL('http://unlisted.railway.internal/jwks'), network),
  );
  assert.throws(
    () =>
      new AccessTokenVerifier(
        policy,
        new URL('http://identity.railway.internal/jwks?token=value'),
        network,
      ),
  );
});

test('existing scoped Gateway origin map is an exact legacy allowlist', () => {
  const scope = deployment();
  delete scope.CW_PRIVATE_NETWORK;
  delete scope.CW_PRIVATE_HTTP_HOSTS;
  const policy = privateServiceNetworkFromEnv({
    ...scope,
    GATEWAY_PRIVATE_NETWORK: 'railway',
    GATEWAY_UPSTREAMS: JSON.stringify({ identity: 'http://identity.railway.internal:3000' }),
  });
  assert.equal(isServiceUrlAllowed(new URL('http://identity.railway.internal:3000'), policy), true);
  assert.equal(isServiceUrlAllowed(new URL('http://billing.railway.internal:3000'), policy), false);
});
