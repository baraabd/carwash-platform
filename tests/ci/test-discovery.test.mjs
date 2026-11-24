import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverServiceSpecs } from '../../scripts/lib/test-discovery.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'cw-test-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, contents = '// spec\n') => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return file;
  };
  const spec = (name) => {
    write(`test/${name}.spec.ts`);
    return write(`dist-tests/test/${name}.spec.js`);
  };
  return { root, write, spec };
}

test('offline discovery includes nested domain/unit suites and excludes real integration', (t) => {
  const f = fixture(t);
  const expected = [f.spec('bootstrap'), f.spec('domain/aggregate'), f.spec('unit/adapter/nested')];
  f.spec('integration/postgres');
  f.spec('integration/broker/nested');
  assert.deepEqual(discoverServiceSpecs(f.root), expected);
});

test('integration discovery selects every nested integration spec only', (t) => {
  const f = fixture(t);
  f.spec('bootstrap');
  const expected = [f.spec('integration/broker/nested'), f.spec('integration/owner.pg')];
  assert.deepEqual(discoverServiceSpecs(f.root, { kind: 'integration' }), expected);
});

test('an uncompiled nested source fails even when top-level artifacts exist', (t) => {
  const f = fixture(t);
  f.spec('bootstrap');
  f.write('test/unit/omitted.spec.ts');
  assert.throws(() => discoverServiceSpecs(f.root), /Missing compiled spec/);
});

test('missing source and stale compiled artifacts cannot make an empty family pass', (t) => {
  const f = fixture(t);
  f.write('dist-tests/test/stale.spec.js');
  assert.throws(() => discoverServiceSpecs(f.root), /Missing offline spec sources/);
  f.spec('bootstrap');
  assert.throws(() => discoverServiceSpecs(f.root, { kind: 'integration' }), /Missing integration/);
});

test('empty compiled specs and unknown families fail closed', (t) => {
  const f = fixture(t);
  f.spec('bootstrap');
  f.write('dist-tests/test/bootstrap.spec.js', '');
  assert.throws(() => discoverServiceSpecs(f.root), /Empty or invalid compiled spec/);
  assert.throws(() => discoverServiceSpecs(f.root, { kind: 'all' }), /Unknown test family/);
});
