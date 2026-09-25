import assert from 'node:assert/strict';
import { readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkRepository } from '../../dist/ownership/checker.mjs';
import { fixture, treeDigest } from './fixtures.mjs';

function rejects(root, rule) {
  const result = checkRepository(root);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.rule === rule),
    JSON.stringify(result.diagnostics, null, 2),
  );
  return result;
}
function accepts(root) {
  const result = checkRepository(root);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  return result;
}
test('complete isolated fixture has one owner per workspace', (t) => {
  const f = fixture(t);
  const result = accepts(f.root);
  assert.equal(result.workspaces, 11);
  assert.equal(result.sourceFiles, 22);
});
test('same-owner local imports are allowed', (t) => {
  const f = fixture(t);
  f.put('services/booking/src/index.ts', "import './events.js';");
  accepts(f.root);
});
test('versioned public contracts are allowed from all deployable owners', (t) => {
  const f = fixture(t);
  for (const dir of [
    'services/booking',
    'services/billing',
    'apps/customer-web',
    'apps/operator-web',
    'apps/admin-web',
    'apps/api-gateway',
  ]) {
    f.put(`${dir}/src/index.ts`, "import '@carwash/event-contracts/events';");
  }
  accepts(f.root);
});
test('apps may use shared UI primitives', (t) => {
  const f = fixture(t);
  f.put('apps/customer-web/src/index.ts', "import '@carwash/ui';");
  accepts(f.root);
});
test('node builtins are allowed without package dependencies', (t) => {
  const f = fixture(t);
  f.put('services/booking/src/index.ts', "import fs from 'node:fs'; import path from 'path';");
  accepts(f.root);
});
test('declared external dependency is not mistaken for a service', (t) => {
  const f = fixture(t);
  f.change('services/booking/package.json', (p) => {
    p.dependencies.rxjs = '7.8.2';
  });
  f.put('services/booking/src/index.ts', "import 'rxjs/operators';");
  accepts(f.root);
});
test('scanner is read-only and output order is deterministic', (t) => {
  const f = fixture(t);
  const before = treeDigest(f.root);
  const a = checkRepository(f.root);
  const b = checkRepository(f.root);
  assert.deepEqual(a, b);
  assert.equal(treeDigest(f.root), before);
});
const violations = [
  [
    'regression: comment after from',
    'services/booking/src/probe.ts',
    "import {x} from /* invisible to old regex */ '../../billing/src/index.js';",
    'CROSS_OWNER_IMPORT',
  ],
  [
    'regression: template literal import',
    'services/booking/src/probe.ts',
    'import(`../../billing/src/index.js`);',
    'CROSS_OWNER_IMPORT',
  ],
  [
    'regression: TSX source',
    'services/booking/src/probe.tsx',
    "import '../../billing/src/index.js'; export const X = <div/>;",
    'CROSS_OWNER_IMPORT',
  ],
  [
    'regression: application imports service',
    'apps/customer-web/src/probe.ts',
    "import '../../../services/billing/src/index.js';",
    'CROSS_OWNER_IMPORT',
  ],
  [
    'regression: shared contract imports service',
    'packages/event-contracts/src/probe.ts',
    "import '../../../services/billing/src/index.js';",
    'CROSS_OWNER_IMPORT',
  ],
  [
    'gateway imports service implementation',
    'apps/api-gateway/src/probe.ts',
    "import '@carwash/billing';",
    'CROSS_OWNER_IMPORT',
  ],
  [
    'service imports an app',
    'services/booking/src/probe.ts',
    "import '@carwash/customer-web';",
    'CROSS_OWNER_IMPORT',
  ],
  [
    'app imports another app',
    'apps/customer-web/src/probe.ts',
    "import '@carwash/admin-web';",
    'CROSS_OWNER_IMPORT',
  ],
  [
    'service uses cross-service declaration file',
    'services/booking/src/probe.d.ts',
    "export type X = import('@carwash/billing').X;",
    'CROSS_OWNER_IMPORT',
  ],
  [
    'shared private subpath',
    'services/booking/src/probe.ts',
    "import '@carwash/event-contracts/src/index';",
    'PRIVATE_SHARED_IMPORT',
  ],
  [
    'shared blocked subpath',
    'services/booking/src/probe.ts',
    "import '@carwash/event-contracts/blocked';",
    'PRIVATE_SHARED_IMPORT',
  ],
  [
    'shared relative bypass',
    'services/booking/src/probe.ts',
    "import '../../../packages/event-contracts/src/index.js';",
    'PRIVATE_SHARED_IMPORT',
  ],
  [
    'dynamic variable import',
    'services/booking/src/probe.ts',
    'import(moduleName);',
    'OPAQUE_MODULE_REFERENCE',
  ],
  ['dynamic require', 'services/booking/src/probe.cts', 'require(moduleName);', 'OPAQUE_MODULE_REFERENCE'],
  [
    'aliased loader',
    'services/booking/src/probe.cts',
    'const r = require; r(moduleName);',
    'OPAQUE_MODULE_REFERENCE',
  ],
  [
    'computed string concatenation',
    'services/booking/src/probe.ts',
    "import('@carwash/' + service);",
    'OPAQUE_MODULE_REFERENCE',
  ],
  ['inline eval', 'services/booking/src/probe.ts', 'eval(code);', 'OPAQUE_MODULE_REFERENCE'],
  ['Function loader', 'services/booking/src/probe.ts', 'new Function(code);', 'OPAQUE_MODULE_REFERENCE'],
  [
    'unknown workspace',
    'services/booking/src/probe.ts',
    "import '@carwash/unknown';",
    'UNKNOWN_WORKSPACE_DEPENDENCY',
  ],
  [
    'unknown path alias',
    'services/booking/src/probe.ts',
    "import '#unresolved';",
    'UNRESOLVED_MODULE_REFERENCE',
  ],
  [
    'unresolved relative module',
    'services/booking/src/probe.ts',
    "import './does-not-exist.js';",
    'UNRESOLVED_MODULE_REFERENCE',
  ],
  [
    'root helper escape',
    'services/booking/src/probe.ts',
    "import '../../../scripts/hidden-business.js';",
    'OWNER_ESCAPE',
  ],
  [
    'absolute loader',
    'services/booking/src/probe.ts',
    "import '/services/billing/src/index.js';",
    'UNSUPPORTED_MODULE_PATH',
  ],
  [
    'file URL loader',
    'services/booking/src/probe.ts',
    "import 'file:///services/billing/src/index.js';",
    'UNSUPPORTED_MODULE_PATH',
  ],
  ['syntax error', 'services/booking/src/probe.ts', 'import {', 'INVALID_SOURCE_SYNTAX'],
  [
    'gateway DB import',
    'apps/api-gateway/src/probe.ts',
    "import '@prisma/client';",
    'DATABASE_CLIENT_OUTSIDE_SERVICE',
  ],
  [
    'shared DB import',
    'packages/event-contracts/src/probe.ts',
    "import '@prisma/client';",
    'DATABASE_CLIENT_OUTSIDE_SERVICE',
  ],
];
for (const [name, file, source, rule] of violations) {
  test(`rejects ${name}`, (t) => {
    const f = fixture(t);
    f.put(file, source);
    rejects(f.root, rule);
  });
}
for (const ext of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']) {
  test(`covers source extension .${ext}`, (t) => {
    const f = fixture(t);
    f.put(`services/booking/probe.${ext}`, "import '@carwash/billing';");
    rejects(f.root, 'CROSS_OWNER_IMPORT');
  });
}
for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  test(`cross-service manifest ${field} is forbidden`, (t) => {
    const f = fixture(t);
    f.change('services/booking/package.json', (p) => {
      p[field] = { '@carwash/billing': 'workspace:0.0.1' };
    });
    rejects(f.root, 'CROSS_OWNER_IMPORT');
  });
}
for (const version of [
  'npm:@carwash/billing@0.0.1',
  'file:../billing',
  'link:../billing',
  'workspace:../billing',
  'workspace:@carwash/billing@*',
]) {
  test(`cross-service dependency alias ${version} is forbidden`, (t) => {
    const f = fixture(t);
    f.change('services/booking/package.json', (p) => {
      p.dependencies.hidden = version;
    });
    rejects(f.root, 'CROSS_OWNER_IMPORT');
  });
}
test('same-owner tsconfig paths alias is permitted', (t) => {
  const f = fixture(t);
  f.put('services/booking/tsconfig.json', {
    compilerOptions: { baseUrl: '.', paths: { '@local/*': ['src/*'] } },
  });
  f.put('services/booking/src/index.ts', "import '@local/events';");
  accepts(f.root);
});
test('cross-service tsconfig paths alias is forbidden', (t) => {
  const f = fixture(t);
  f.put('services/booking/tsconfig.json', {
    compilerOptions: { baseUrl: '.', paths: { '@hidden/*': ['../billing/src/*'] } },
  });
  f.put('services/booking/src/index.ts', "import '@hidden/index';");
  rejects(f.root, 'CROSS_OWNER_IMPORT');
});
test('inherited tsconfig paths alias cannot bypass boundaries', (t) => {
  const f = fixture(t);
  f.put('tsconfig.base.json', {
    compilerOptions: { baseUrl: '.', paths: { '@hidden/*': ['services/billing/src/*'] } },
  });
  f.put('services/booking/tsconfig.json', { extends: '../../tsconfig.base.json' });
  f.put('services/booking/src/index.ts', "import '@hidden/index';");
  rejects(f.root, 'CROSS_OWNER_IMPORT');
});
test('tsconfig include/exclude cannot hide an ownership violation', (t) => {
  const f = fixture(t);
  f.put('services/booking/tsconfig.json', { files: ['src/index.ts'], exclude: ['src/probe.ts'] });
  f.put('services/booking/src/probe.ts', "import '@carwash/billing';");
  rejects(f.root, 'CROSS_OWNER_IMPORT');
});
test('cross-service project reference is forbidden', (t) => {
  const f = fixture(t);
  f.put('services/booking/tsconfig.json', { references: [{ path: '../billing' }] });
  f.put('services/booking/src/index.ts', "import './events.js';");
  rejects(f.root, 'CROSS_PROJECT_REFERENCE');
});
test('conditional package imports cannot hide a forbidden service', (t) => {
  const f = fixture(t);
  f.change('services/booking/package.json', (p) => {
    p.imports = { '#billing': { browser: '@carwash/billing', default: './src/index.ts' } };
  });
  rejects(f.root, 'CROSS_OWNER_IMPORT');
});
test('package export target cannot escape ownership', (t) => {
  const f = fixture(t);
  f.change('packages/event-contracts/package.json', (p) => {
    p.exports = { '.': '../../services/billing/src/index.ts' };
  });
  rejects(f.root, 'MANIFEST_TARGET_ESCAPE');
});
test('package root import needs a declared dependency', (t) => {
  const f = fixture(t);
  f.change('services/booking/package.json', (p) => {
    p.dependencies = {};
  });
  f.put('services/booking/src/index.ts', "import '@carwash/event-contracts';");
  rejects(f.root, 'UNDECLARED_SHARED_DEPENDENCY');
});
test('local file dependency may not bypass shared versioning', (t) => {
  const f = fixture(t);
  f.change('services/booking/package.json', (p) => {
    p.dependencies['@carwash/event-contracts'] = 'file:../../packages/event-contracts';
  });
  rejects(f.root, 'UNVERSIONED_SHARED_DEPENDENCY');
});
test('service may not consume UI primitives', (t) => {
  const f = fixture(t);
  f.change('services/booking/package.json', (p) => {
    p.dependencies['@carwash/ui'] = 'workspace:0.0.1';
  });
  rejects(f.root, 'UI_IN_BACKEND');
});
test('test-utils can be used from test source only', (t) => {
  const f = fixture(t);
  f.change('services/booking/package.json', (p) => {
    p.devDependencies = { '@carwash/test-utils': 'workspace:0.0.1' };
  });
  f.put('services/booking/src/booking.spec.ts', "import '@carwash/test-utils';");
  accepts(f.root);
  f.put('services/booking/src/index.ts', "import '@carwash/test-utils';");
  rejects(f.root, 'TEST_UTILS_IN_RUNTIME');
});
test('contracts must not pull a runtime technical library', (t) => {
  const f = fixture(t);
  f.change('packages/event-contracts/package.json', (p) => {
    p.dependencies['@carwash/observability'] = 'workspace:0.0.1';
  });
  rejects(f.root, 'CONTRACT_RUNTIME_DEPENDENCY');
});
test('shared dependency cycle is rejected', (t) => {
  const f = fixture(t);
  f.change('packages/observability/package.json', (p) => {
    p.dependencies['@carwash/test-utils'] = 'workspace:0.0.1';
  });
  f.change('packages/test-utils/package.json', (p) => {
    p.dependencies['@carwash/observability'] = 'workspace:0.0.1';
  });
  rejects(f.root, 'WORKSPACE_DEPENDENCY_CYCLE');
});
for (const field of ['id', 'database', 'runtimeRole', 'migrationRole']) {
  test(`duplicate service ${field} is rejected`, (t) => {
    const f = fixture(t);
    f.change('architecture/service-catalog.json', (c) => {
      c.services[1][field] = c.services[0][field];
    });
    rejects(f.root, 'DUPLICATE_OWNERSHIP');
  });
}
test('duplicate business data ownership is rejected', (t) => {
  const f = fixture(t);
  f.change('architecture/service-catalog.json', (c) => {
    c.services[1].owns = c.services[0].owns;
  });
  rejects(f.root, 'DUPLICATE_OWNERSHIP');
});
test('duplicate package name is rejected', (t) => {
  const f = fixture(t);
  f.change('services/billing/package.json', (p) => {
    p.name = '@carwash/booking';
  });
  rejects(f.root, 'DUPLICATE_PACKAGE');
});
test('missing declared service is rejected', (t) => {
  const f = fixture(t);
  rmSync(path.join(f.root, 'services/billing'), { recursive: true });
  rejects(f.root, 'MISSING_WORKSPACE');
});
test('missing app manifest fails closed instead of being skipped', (t) => {
  const f = fixture(t);
  rmSync(path.join(f.root, 'apps/customer-web/package.json'));
  rejects(f.root, 'MISSING_WORKSPACE_MANIFEST');
});
test('unregistered service directory is rejected', (t) => {
  const f = fixture(t);
  f.addPackage('services/unregistered');
  rejects(f.root, 'UNREGISTERED_WORKSPACE');
});
test('uncontrolled shared business package is rejected', (t) => {
  const f = fixture(t);
  f.addPackage('packages/business-logic');
  rejects(f.root, 'UNREGISTERED_WORKSPACE');
});
test('nested workspace package is rejected', (t) => {
  const f = fixture(t);
  f.addPackage('services/booking/hidden');
  rejects(f.root, 'NESTED_WORKSPACE');
});
test('source symlink is rejected', (t) => {
  const f = fixture(t);
  symlinkSync(
    path.join(f.root, 'services/billing/src'),
    path.join(f.root, 'services/booking/src/hidden'),
    'junction',
  );
  rejects(f.root, 'SOURCE_SYMLINK');
});
test('source in a workspace root but outside an owner is rejected', (t) => {
  const f = fixture(t);
  f.put('services/hidden.ts', "import '@carwash/billing';");
  rejects(f.root, 'UNOWNED_SOURCE');
});
test('invalid catalog JSON is an explicit failure', (t) => {
  const f = fixture(t);
  f.put('architecture/service-catalog.json', '{');
  rejects(f.root, 'INVALID_MANIFEST');
});
test('invalid package version is rejected', (t) => {
  const f = fixture(t);
  f.change('packages/event-contracts/package.json', (p) => {
    p.version = 'latest';
  });
  rejects(f.root, 'INVALID_PACKAGE_VERSION');
});
const cli = fileURLToPath(new URL('../../scripts/check-ownership.mjs', import.meta.url));
test('CLI emits parseable success JSON and exit 0 for the fixture', (t) => {
  const f = fixture(t);
  const run = spawnSync(process.execPath, [cli, '--root', f.root, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(JSON.parse(run.stdout).ok, true);
});
test('CLI returns exit 1 for actual ownership violations, not success', (t) => {
  const f = fixture(t);
  f.put('services/booking/src/probe.ts', "import '@carwash/billing';");
  const run = spawnSync(process.execPath, [cli, '--root', f.root, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).ok, false);
});
test('CLI returns exit 2 on invalid options', () => {
  const run = spawnSync(process.execPath, [cli, '--json', '--skip-errors'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).ok, false);
});
test('CLI CI mode refuses an unqualified toolchain', (t) => {
  const f = fixture(t);
  const compiler = JSON.parse(
    readFileSync(new URL('../../node_modules/typescript/package.json', import.meta.url), 'utf8'),
  ).version;
  const target = process.versions.node.startsWith('24.') && compiler === '5.9.3';
  const run = spawnSync(process.execPath, [cli, '--root', f.root, '--ci', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, target ? 0 : 2, run.stdout + run.stderr);
  if (!target) assert.match(JSON.parse(run.stdout).error, /TOOLCHAIN_MISMATCH/);
});
test('registered public package name cannot be shadowed to a service via paths', (t) => {
  const f = fixture(t);
  f.put('services/booking/tsconfig.json', {
    compilerOptions: { baseUrl: '.', paths: { '@carwash/event-contracts': ['../billing/src/index.ts'] } },
  });
  f.put('services/booking/src/index.ts', "import '@carwash/event-contracts';");
  rejects(f.root, 'CROSS_OWNER_IMPORT');
});
test('cross-project reference is rejected even in a source file without imports', (t) => {
  const f = fixture(t);
  f.put('services/booking/tsconfig.json', { references: [{ path: '../billing' }] });
  rejects(f.root, 'CROSS_PROJECT_REFERENCE');
});
test('public wildcard cannot permit package subpath traversal', (t) => {
  const f = fixture(t);
  f.change('packages/event-contracts/package.json', (p) => {
    p.exports = { './*': './src/*' };
  });
  f.put('services/booking/src/index.ts', "import '@carwash/event-contracts/../../billing';");
  rejects(f.root, 'UNSUPPORTED_MODULE_PATH');
});
