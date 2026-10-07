import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifiedNonRoot,
  verifiedNoBakedSecrets,
  BAKED_SECRET_PROBE,
  verifiedReadiness,
} from '../../scripts/lib/image-probes.mjs';
test('non-root probe requires successful exec and a nonzero numeric UID', () => {
  assert.equal(verifiedNonRoot({ code: 0, stdout: '1000\n' }), true);
  for (const result of [
    { code: 0, stdout: '0' },
    { code: 127, stdout: '1000' },
    { code: 127, stdout: 'OCI runtime exec failed' },
    { code: 0, stdout: 'NaN' },
    { code: null, stdout: '1000' },
    { code: 0, stdout: '' },
  ])
    assert.equal(verifiedNonRoot(result), false);
});
test('credential probe requires successful explicit empty inventory', () => {
  assert.equal(verifiedNoBakedSecrets({ code: 0, stdout: '[]' }), true);
  for (const result of [
    { code: 1, stdout: '[]' },
    { code: 0, stdout: '' },
    { code: 0, stdout: '[".env.local"]' },
    { code: 127, stdout: 'OCI runtime exec failed' },
  ])
    assert.equal(verifiedNoBakedSecrets(result), false);
  assert.ok(BAKED_SECRET_PROBE.includes("n.startsWith('.env')"));
  assert.ok(BAKED_SECRET_PROBE.includes("n==='.acceptance'"));
  assert.ok(BAKED_SECRET_PROBE.includes("n==='.git'"));
});

test('readiness probe distinguishes foundation shells from dependency failure and never accepts 200', () => {
  const body = (o) =>
    JSON.stringify({
      service: 's',
      ready: false,
      dependenciesReady: false,
      dependencies: [],
      ...o,
    });
  assert.equal(
    verifiedReadiness(`503 ${body({ businessReady: false, code: 'FOUNDATION_NOT_READY' })}`).ok,
    true,
  );
  assert.equal(
    verifiedReadiness(`503 ${body({ businessReady: true, code: 'DEPENDENCY_DOWN' })}`).ok,
    true,
  );
  // A shell with no registered probe reports null (not checked), as the real images do.
  assert.equal(
    verifiedReadiness(
      `503 ${body({ businessReady: false, code: 'FOUNDATION_NOT_READY', dependenciesReady: null })}`,
    ).ok,
    true,
  );
  for (const raw of [
    `503 ${body({ businessReady: true, code: 'DEPENDENCY_DOWN', dependenciesReady: null })}`,
    `503 ${body({ businessReady: false, code: 'FOUNDATION_NOT_READY', dependenciesReady: null, dependencies: [{ name: 'db', status: 'DOWN' }] })}`,
    `200 ${body({ businessReady: true, ready: true, dependenciesReady: true, code: 'READY' })}`,
    `503 ${body({ businessReady: true, code: 'FOUNDATION_NOT_READY' })}`,
    `503 ${body({ businessReady: false, code: 'DEPENDENCY_DOWN' })}`,
    `503 ${body({ businessReady: false, code: 'FOUNDATION_NOT_READY', dependenciesReady: true })}`,
    `503 ${body({ businessReady: false, code: 'FOUNDATION_NOT_READY', dependenciesReady: undefined })}`,
    '503 {"truncated',
    'ERR fetch failed',
    '',
  ])
    assert.equal(verifiedReadiness(raw).ok, false, raw);
});
