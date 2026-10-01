import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const fixtures = readFileSync(
  path.join(ROOT, 'apps/customer-web/src/fixtures/customerFixtureStates.ts'),
  'utf8',
);
const router = readFileSync(path.join(ROOT, 'apps/customer-web/src/app/router.tsx'), 'utf8');
const checker = path.join(ROOT, 'scripts/c002/check-feature-boundaries.mjs');

test('C002 fixture contract exposes one deterministic state per owned shell route', () => {
  const ids = [...fixtures.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(ids, [
    'home-default',
    'booking-vehicle-default',
    'booking-care-default',
    'booking-location-default',
    'booking-time-default',
    'booking-contact-default',
    'booking-payment-default',
    'booking-review-default',
    'orders-default',
    'garage-default',
    'account-default',
    'payment-default',
    'tracking-default',
  ]);
  assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(fixtures, /Date\(|Math\.random|fetch\(|localStorage|sessionStorage/);
});

test('C002 router mounts feature entry points instead of feature internals', () => {
  for (const feature of ['account', 'booking', 'garage', 'home', 'orders', 'payment', 'tracking']) {
    assert.match(router, new RegExp(`from '../features/${feature}'`));
  }
  assert.doesNotMatch(router, /features\/.+\/(?:components|internal|state)\//);
});

test('C002 feature-boundary checker accepts the repository feature graph', () => {
  const result = spawnSync(process.execPath, [checker, ROOT], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('C002 feature-boundary checker rejects cross-feature imports', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'washgo-c002-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const features = ['account', 'booking', 'garage', 'home', 'orders', 'payment', 'tracking'];
  for (const feature of features) {
    const directory = path.join(root, 'apps/customer-web/src/features', feature);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'index.ts'), 'export const value = true;\n');
  }
  writeFileSync(
    path.join(root, 'apps/customer-web/src/features/home/index.ts'),
    "import { value } from '../orders';\nexport { value };\n",
  );

  const result = spawnSync(process.execPath, [checker, root], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /CROSS_FEATURE_IMPORT/);
});
