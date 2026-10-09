import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acceptancePlan, suiteAccepted } from '../../../scripts/production/A/acceptance-plan.mjs';

test('suite preflight rejects invalid selections and absent suites before infrastructure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lane-a-preflight-'));
  try {
    for (const args of [
      [],
      ['--services'],
      ['--services', 'vehicle,'],
      ['--services', 'vehicle,vehicle'],
      ['--services', '../geo'],
      ['--services', 'geo', '--unknown'],
    ]) {
      assert.throws(() => acceptancePlan(args, root));
    }
    assert.throws(
      () => acceptancePlan(['--services', 'vehicle'], root),
      /MISSING_ACCEPTANCE_SUITE/,
    );
    await mkdir(path.join(root, 'tests/production/A'), { recursive: true });
    await writeFile(path.join(root, 'tests/production/A/vehicle.integration.test.mjs'), '');
    assert.deepEqual(acceptancePlan(['--services', 'vehicle'], root).services, ['vehicle']);
    assert.throws(
      () => acceptancePlan(['--services', 'vehicle,geo'], root),
      /MISSING_ACCEPTANCE_SUITE/,
    );
    await writeFile(path.join(root, 'tests/production/A/geo.integration.test.mjs'), '');
    const geo = acceptancePlan(['--services', 'geo'], root);
    assert.match(geo.scope, /Real Identity Nest application and Redis/);
    const mixed = acceptancePlan(['--services', 'vehicle,geo', '--keep'], root);
    assert.match(mixed.scope, /Real Identity Nest application and Redis/);
    assert.match(mixed.scope, /OTP delivery port is captured/);
    assert.equal(mixed.keep, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('suite acceptance requires complete, nonempty execution without skipped or unknown counts', () => {
  const result = { code: 0, outcome: 'exited', signal: null };
  const counts = { tests: 5, pass: 5, fail: 0, skipped: 0, todo: 0, cancelled: 0 };
  assert.equal(suiteAccepted(result, counts), true);
  for (const field of ['fail', 'skipped', 'todo', 'cancelled']) {
    assert.equal(suiteAccepted(result, { ...counts, [field]: 1 }), false);
  }
  assert.equal(suiteAccepted(result, { ...counts, tests: 0, pass: 0 }), false);
  assert.equal(suiteAccepted(result, { ...counts, pass: NaN }), false);
  assert.equal(suiteAccepted({ ...result, signal: 'SIGTERM' }, counts), false);
  assert.equal(suiteAccepted({ ...result, outcome: 'timeout' }, counts), false);
  assert.equal(suiteAccepted({ ...result, code: 1 }, counts), false);
});
