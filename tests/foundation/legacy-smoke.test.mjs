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
test('the original boundary gate remains byte-identical and accepts the new V2 fixture layout', (t) => {
  assert.equal(blob, '06f2a5f749a5e9acd5bb3b73117d383e46b4668f');
  const f = fixture(t);
  f.put('scripts/check-boundaries.mjs', original.toString('utf8'));
  const result = spawnSync(process.execPath, [path.join(f.root, 'scripts/check-boundaries.mjs')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /19 owners/);
});
test('the unchanged original boundary gate still rejects a cross-service import in V2 fixtures', (t) => {
  const f = fixture(t);
  f.put('scripts/check-boundaries.mjs', original.toString('utf8'));
  f.put('services/vehicle/src/violation.ts', "import '../../billing/src/index.js';\n");
  const result = spawnSync(process.execPath, [path.join(f.root, 'scripts/check-boundaries.mjs')], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
});
