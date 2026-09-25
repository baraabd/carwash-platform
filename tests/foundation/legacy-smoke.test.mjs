import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fixture } from './fixtures.mjs';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const original = readFileSync(path.join(sourceRoot, 'scripts/check-boundaries.mjs'));
const blob = createHash('sha1').update(`blob ${original.length}\0`).update(original).digest('hex');
test('the approved post-F002 boundary gate remains byte-identical and accepts the V2 fixture layout', (t) => {
  assert.equal(blob, '814d9a7fee7aa7c1184bb03fbf22dbbee5149f89');
  const f = fixture(t);
  f.put('scripts/check-boundaries.mjs', original.toString('utf8'));
  const result = spawnSync(process.execPath, [path.join(f.root, 'scripts/check-boundaries.mjs')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /19 owners/);
});
test('the unchanged approved boundary gate still rejects a cross-service import in V2 fixtures', (t) => {
  const f = fixture(t);
  f.put('scripts/check-boundaries.mjs', original.toString('utf8'));
  f.put('services/vehicle/src/violation.ts', "import '../../billing/src/index.js';\n");
  const result = spawnSync(process.execPath, [path.join(f.root, 'scripts/check-boundaries.mjs')], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
});
