import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifiedNonRoot,
  verifiedNoBakedSecrets,
  BAKED_SECRET_PROBE,
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
