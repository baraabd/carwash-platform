import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFoundation, comparePnpmDiscovery } from '../../dist/ownership/foundation.mjs';
import { catalogDefinitions } from '../../dist/ownership/catalog.mjs';
import { checkRepository } from '../../dist/ownership/checker.mjs';
import { catalog, fixture } from './fixtures.mjs';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
test('static workspace discovery accounts for all 35 synthetic fixture workspaces exactly once', (t) => {
  const f = fixture(t);
  const result = checkFoundation(f.root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.workspaces, 35);
  assert.equal(result.scope, 'F001-catalog-and-static-workspace-only');
  assert.equal(checkRepository(f.root).ok, true);
});
const cases = {
  'missing workspace': (f) => rmSync(path.join(f.root, 'services/vehicle'), { recursive: true }),
  'missing package manifest': (f) => rmSync(path.join(f.root, 'services/vehicle/package.json')),
  'unregistered workspace': (f) => mkdirSync(path.join(f.root, 'services/mega-service')),
  'nested manifest': (f) => f.put('services/vehicle/sub/package.json', { name: '@carwash/nested' }),
  'wrong package name': (f) =>
    f.change('services/vehicle/package.json', (p) => {
      p.name = '@carwash/billing';
    }),
  'unversioned package': (f) =>
    f.change('services/vehicle/package.json', (p) => {
      p.version = 'latest';
    }),
  'public internal package': (f) =>
    f.change('services/vehicle/package.json', (p) => {
      p.private = false;
    }),
  'invalid JSON package': (f) => f.put('services/vehicle/package.json', '{broken'),
  'array package': (f) => f.put('services/vehicle/package.json', []),
  'version drift': (f) =>
    f.change('packages/contracts/package.json', (p) => {
      p.version = '0.1.0';
    }),
  'unowned root source': (f) => f.put('services/unowned.ts', 'export {};'),
  'duplicated discovery glob': (f) =>
    f.put(
      'pnpm-workspace.yaml',
      "packages:\n  - 'apps/*'\n  - 'services/*'\n  - 'packages/*'\n  - 'services/*'\n",
    ),
  'widened discovery glob': (f) => f.put('pnpm-workspace.yaml', "packages:\n  - '**'\n"),
  'linked manifest': (f) => {
    rmSync(path.join(f.root, 'services/vehicle/package.json'));
    symlinkSync(
      path.join(f.root, 'services/billing/package.json'),
      path.join(f.root, 'services/vehicle/package.json'),
    );
  },
  'linked workspace': (f) => {
    rmSync(path.join(f.root, 'services/vehicle'), { recursive: true });
    symlinkSync(path.join(f.root, 'services/billing'), path.join(f.root, 'services/vehicle'), 'junction');
  },
  'linked implementation': (f) =>
    symlinkSync(
      path.join(f.root, 'services/billing/src'),
      path.join(f.root, 'services/vehicle/foreign'),
      'junction',
    ),
};
for (const [name, edit] of Object.entries(cases))
  test(`discovery rejects ${name}`, (t) => {
    const f = fixture(t);
    edit(f);
    assert.equal(checkFoundation(f.root).ok, false);
  });
test('pnpm output comparator accepts 35 rows with or without the root row (not a real pnpm run)', (t) => {
  const f = fixture(t);
  const definitions = catalogDefinitions(catalog);
  assert.deepEqual(comparePnpmDiscovery(f.root, definitions, f.rows), []);
  assert.deepEqual(
    comparePnpmDiscovery(f.root, definitions, [...f.rows, { name: 'carwash-platform', path: f.root }]),
    [],
  );
});
const rowCases = {
  'missing member': (rows) => rows.slice(1),
  'duplicate member': (rows) => [...rows, rows[0]],
  'wrong identity': (rows) => [{ ...rows[0], name: '@carwash/wrong' }, ...rows.slice(1)],
  'wrong path': (rows) => [{ ...rows[0], path: '/not/a/workspace' }, ...rows.slice(1)],
  'malformed result': () => ({}),
  'malformed row': (rows) => [...rows, {}],
};
for (const [name, edit] of Object.entries(rowCases))
  test(`pnpm comparator rejects ${name}`, (t) => {
    const f = fixture(t);
    assert.notEqual(comparePnpmDiscovery(f.root, catalogDefinitions(catalog), edit(f.rows)).length, 0);
  });
test('catalog V2 is validated by the ownership checker as well as the dedicated gate', (t) => {
  const f = fixture(t);
  f.change('architecture/service-catalog.json', (c) => {
    c.gateway.database = 'cw_illegal';
  });
  const result = checkRepository(f.root);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.rule === 'INVALID_CATALOG'));
});
test('foundation CLI exits zero for valid fixture and nonzero for an ownership violation', (t) => {
  const f = fixture(t);
  const script = path.join(sourceRoot, 'scripts/check-foundation.mjs');
  const run = () => spawnSync(process.execPath, [script, '--root', f.root], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  f.change('architecture/service-catalog.json', (c) => {
    c.services.pop();
  });
  const rejected = run();
  assert.equal(rejected.status, 1);
  assert.equal(JSON.parse(rejected.stdout).ok, false);
});
test('foundation CLI rejects unknown flags', () => {
  const run = spawnSync(
    process.execPath,
    [path.join(sourceRoot, 'scripts/check-foundation.mjs'), '--bypass'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 2);
});
