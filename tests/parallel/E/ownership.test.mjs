import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  REGISTRY_PATH,
  changedPaths,
  checkChangedPaths,
  effectiveOwner,
  loadTrustedRegistry,
  validateRegistry,
  validateRegistryUpdate,
  loadTrustedWriterPlan,
} from '../../../scripts/parallel/E/check-owners.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const checker = path.join(root, 'scripts/parallel/E/check-owners.mjs');
const registry = JSON.parse(readFileSync(path.join(root, REGISTRY_PATH), 'utf8'));
const clone = () => structuredClone(registry);
const check = (lane, files, candidate = registry) =>
  checkChangedPaths(candidate, { lane, paths: files });

test('all 832 tracked base files have exactly one effective owner', () => {
  const files = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', '-z', registry.inventoryBase.sha],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  validateRegistry(registry, files);
  assert.equal(files.length, 832);
  for (const file of files) assert.ok(effectiveOwner(registry, file).owner, file);
});

test('reserved manifests, Dockerfiles, tsconfigs and lockfiles override domain ownership', () => {
  for (const file of [
    'services/customer/package.json',
    'services/billing/tsconfig.build.json',
    'apps/customer-web/Dockerfile.preview',
    'services/pricing/prisma/migrations/migration_lock.toml',
    'pnpm-lock.yaml',
  ]) {
    assert.equal(check('A', [file]).ok, false, file);
    assert.equal(check('E', [file]).ok, true, file);
  }
});

test('all 33 exact C014 paths including its workflow retain the A-only W01 exception', () => {
  assert.equal(check('A', registry.w01C014.paths).ok, true);
  assert.equal(check('E', registry.w01C014.paths).findings.length, 33);
  assert.equal(
    effectiveOwner(registry, '.github/workflows/c014-booking-confirmation.yml').owner,
    'A',
  );
  assert.equal(check('A', ['.github/workflows/not-c014.yml']).ok, false);
});

test('W01 lane-local docs, test specifications and scripts belong to their one writer', () => {
  for (const lane of ['A', 'B', 'C', 'D', 'E']) {
    const files = ['docs', 'tests', 'scripts'].map(
      (prefix) => `${prefix}/parallel/${lane}/W01/specification.mjs`,
    );
    assert.equal(check(lane, files).ok, true);
    assert.equal(check(lane === 'E' ? 'A' : 'E', files).ok, false);
  }
});

test('W01 domain and app source writes stay closed to A-D outside C014', () => {
  for (const [lane, file] of [
    ['A', 'services/customer/src/domain/profile.ts'],
    ['B', 'services/billing/src/domain/payment.ts'],
    ['C', 'services/booking/src/domain/lifecycle.ts'],
    ['D', 'apps/admin-web/src/business-dashboard.tsx'],
  ]) {
    const result = check(lane, [file]);
    assert.equal(result.ok, false);
    assert.equal(result.findings[0].rule, 'W01-business-writes-not-open');
  }
});

test('E can write only the exact 165 bootstrap lease paths, never adjacent business source', () => {
  const leased = registry.leases.flatMap((lease) => lease.paths);
  assert.equal(leased.length, 165);
  assert.equal(check('E', leased).ok, true);
  for (const file of [
    'services/vehicle/src/domain/vehicle.ts',
    'services/wallet/prisma/migrations/20261006000000_money/migration.sql',
    'services/configuration/test/business-policy.test.mjs',
    'apps/operator-web/src/work-order.tsx',
  ]) {
    assert.equal(check('E', [file]).ok, false, file);
  }
});

test('overlapping leases, wildcard leases and C014 lease capture fail closed', () => {
  const overlap = clone();
  overlap.leases.push({ ...overlap.leases[0], id: 'overlap' });
  assert.throws(() => validateRegistry(overlap), /Overlapping lease/);
  const wildcard = clone();
  wildcard.leases[0].paths.push('services/vehicle/src/**');
  assert.throws(() => validateRegistry(wildcard), /exact paths/);
  const c014 = clone();
  c014.leases[0].paths.push(registry.w01C014.paths[0]);
  assert.throws(() => validateRegistry(c014), /Forbidden lease/);
});

test('candidate registry edits cannot overlap leases, unlock references or replace C014 records', () => {
  const overlap = clone();
  overlap.leases.push({ ...overlap.leases[0], id: 'candidate-overlap' });
  assert.throws(() => validateRegistryUpdate(registry, overlap), /Overlapping lease/);
  const unlocked = clone();
  unlocked.lockedPrefixes = unlocked.lockedPrefixes.filter(
    (prefix) => prefix !== 'design/reference/',
  );
  assert.throws(() => validateRegistryUpdate(registry, unlocked), /Cannot unlock/);
  const altered = clone();
  altered.w01C014.paths[0] = 'package.json';
  assert.throws(() => validateRegistryUpdate(registry, altered), /exact C014/);
});

test('unknown service/app namespaces and undeclared global tests or docs reject E', () => {
  for (const file of [
    'services/unknown/package.json',
    'services/unknown/src/main.ts',
    'apps/technician-web/src/main.ts',
    'tests/unit/unknown-domain.test.mjs',
    'tests/unknown/test.mjs',
    'docs/unknown/product.md',
    'scripts/unknown-business.mjs',
    'undeclared-business.ts',
  ]) {
    const result = check('E', [file]);
    assert.equal(result.ok, false, file);
    assert.equal(result.findings[0].rule, 'undeclared-path');
  }
});

test('approved artifacts, manifests and frozen policy files remain immutable for every lane', () => {
  for (const lane of ['A', 'B', 'C', 'D', 'E']) {
    assert.equal(
      check(lane, [...registry.lockedPaths, 'design/reference/approved/new-golden.html']).ok,
      false,
    );
  }
  assert.equal(check('E', ['.github/CODEOWNERS']).findings[0].owner, 'LOCKED');
});

test('duplicate inventory ownership or incomplete inventory is rejected', () => {
  const duplicate = clone();
  duplicate.inventory.A.push('package.json');
  assert.throws(() => validateRegistry(duplicate), /Reserved file|Multiply-owned/);
  assert.throws(() => validateRegistry(registry, ['package.json']), /source tree/);
});

test('leases and reserved C014 workflow exception expire only at a fully verified BASE_W02', () => {
  const next = clone();
  next.verifiedBaseW02 = {
    sha: '1'.repeat(40),
    tree: '2'.repeat(40),
    evidence: 'accepted-resulting-target-checks',
    requiredChecks: Object.fromEntries(
      ['plan', 'targeted', 'static', 'integration', 'images', 'security', 'codeql'].map((job) => [
        job,
        'success',
      ]),
    ),
  };
  assert.equal(check('E', ['services/vehicle/src/main.ts'], next).ok, false);
  assert.equal(check('A', ['services/vehicle/src/main.ts'], next).ok, true);
  assert.equal(check('A', ['.github/workflows/c014-booking-confirmation.yml'], next).ok, false);
  assert.equal(check('E', ['.github/workflows/c014-booking-confirmation.yml'], next).ok, true);
  next.verifiedBaseW02.requiredChecks.integration = 'cancelled';
  assert.throws(() => validateRegistry(next), /integration not verified/);
});

test('writer plans cover all changes exactly and cannot use an unknown writer', () => {
  const files = ['docs/parallel/A/W01/packet.md', 'docs/parallel/E/W01/handoff.md'];
  assert.equal(
    checkChangedPaths(registry, { paths: files, writers: { [files[0]]: 'A', [files[1]]: 'E' } }).ok,
    true,
  );
  assert.throws(
    () => checkChangedPaths(registry, { paths: files, writers: { [files[0]]: 'A' } }),
    /every changed path/,
  );
  assert.throws(
    () =>
      checkChangedPaths(registry, { paths: files, writers: { [files[0]]: 'X', [files[1]]: 'E' } }),
    /Unknown plan writer/,
  );
});

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'washgo-owner-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };
  git('init', '--quiet');
  git('config', 'user.name', 'Ownership Tests');
  git('config', 'user.email', 'ownership-tests@washgo.invalid');
  write('package.json', '{}\n');
  write('services/identity/src/main.ts', 'export {};\n');
  write('.github/workflows/c014-booking-confirmation.yml', 'name: c014\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'fixture source');
  const source = git('rev-parse', 'HEAD');
  const r = clone();
  r.inventoryBase = { sha: source, tree: git('rev-parse', 'HEAD^{tree}') };
  r.inventory = {
    A: [],
    B: [],
    C: [],
    D: [],
    E: [
      'package.json',
      'services/identity/src/main.ts',
      '.github/workflows/c014-booking-confirmation.yml',
    ],
    LOCKED: [],
  };
  write(REGISTRY_PATH, JSON.stringify(r));
  git('add', '.');
  git('commit', '--quiet', '-m', 'fixture protected registry');
  return { dir, git, write, registry: r, source, base: git('rev-parse', 'HEAD') };
}

test('a changed head registry cannot grant itself a forbidden manifest or C014 file', (t) => {
  const f = fixture(t);
  const candidate = structuredClone(f.registry);
  candidate.w01C014.paths[1] = 'package.json';
  candidate.w01C014.paths[0] = 'services/identity/src/main.ts';
  f.write(REGISTRY_PATH, JSON.stringify(candidate));
  f.write('package.json', '{"selfApproved":true}\n');
  f.git('add', '.');
  f.git('commit', '--quiet', '-m', 'untrusted candidate grants');
  const trusted = loadTrustedRegistry(f.dir, f.base);
  assert.equal(trusted.trust, 'protected-base-blob');
  assert.equal(
    checkChangedPaths(trusted.registry, { lane: 'A', paths: ['package.json'] }).ok,
    false,
  );
  assert.equal(
    checkChangedPaths(trusted.registry, {
      lane: 'E',
      paths: ['.github/workflows/c014-booking-confirmation.yml'],
    }).ok,
    false,
  );
});

test('the first registry promotion requires an externally pinned digest', (t) => {
  const f = fixture(t);
  assert.throws(() => loadTrustedRegistry(f.dir, f.source), /independently reviewed/);
  assert.throws(
    () => loadTrustedRegistry(f.dir, f.source, '0'.repeat(64)),
    /differs from reviewed pin/,
  );
  const pin = createHash('sha256')
    .update(readFileSync(path.join(f.dir, REGISTRY_PATH)))
    .digest('hex');
  assert.equal(loadTrustedRegistry(f.dir, f.source, pin).trust, 'digest-pinned-bootstrap');
});

test('deletions and both sides of renames are authorized; untracked changes are included', (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.dir, 'services/customer/src'), { recursive: true });
  renameSync(
    path.join(f.dir, 'services/identity/src/main.ts'),
    path.join(f.dir, 'services/customer/src/main.ts'),
  );
  const files = changedPaths(f.dir, f.base);
  assert.deepEqual(files, ['services/customer/src/main.ts', 'services/identity/src/main.ts']);
  assert.equal(checkChangedPaths(f.registry, { lane: 'E', paths: files }).ok, false);
  f.git('add', '.');
  f.git('commit', '--quiet', '-m', 'rename across owner boundary');
  assert.deepEqual(changedPaths(f.dir, f.base, f.git('rev-parse', 'HEAD')), files);
  rmSync(path.join(f.dir, '.github/workflows/c014-booking-confirmation.yml'));
  assert.equal(
    checkChangedPaths(f.registry, { lane: 'E', paths: changedPaths(f.dir, f.base) }).ok,
    false,
  );
});

test('CI refuses lane-only input and a candidate-local writer plan', (t) => {
  const f = fixture(t);
  f.write(
    'docs/parallel/E/W01/writer-plan.json',
    JSON.stringify({ schemaVersion: 1, baseSha: f.base, headSha: f.base, writers: {} }),
  );
  for (const extra of [
    [],
    ['--input-plan-ref', f.base, '--input-plan-path', 'docs/parallel/E/W01/writer-plan.json'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        checker,
        '--root',
        f.dir,
        '--base-ref',
        f.base,
        '--head-ref',
        f.base,
        '--lane',
        'E',
        '--ci',
        ...extra,
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(
      result.stderr,
      /approved immutable policy|reviewed SHA-256 pin|does not exist|but not in/,
    );
  }
});

test('an independently pinned separate policy commit binds known base/head without a Git SHA cycle', (t) => {
  const f = fixture(t);
  const changed = 'docs/parallel/E/W01/packet.md';
  const planPath = 'docs/parallel/E/W01/writer-plan.json';
  f.write(changed, 'candidate proposal\n');
  f.git('add', '.');
  f.git('commit', '--quiet', '-m', 'fixture candidate');
  const headSha = f.git('rev-parse', 'HEAD');
  const source =
    JSON.stringify({ schemaVersion: 1, baseSha: f.base, headSha, writers: { [changed]: 'E' } }) +
    '\n';
  f.write(planPath, source);
  f.git('add', '.');
  f.git('commit', '--quiet', '-m', 'fixture separate reviewed writer policy');
  const policyRef = f.git('rev-parse', 'HEAD');
  const pin = createHash('sha256').update(source).digest('hex');
  assert.notEqual(policyRef, f.base);
  assert.notEqual(policyRef, headSha);
  const inputs = { policyRef, planPath, pin, baseSha: f.base, headSha };
  assert.equal(loadTrustedWriterPlan(f.dir, inputs).writers[changed], 'E');
  assert.throws(
    () => loadTrustedWriterPlan(f.dir, { ...inputs, pin: '0'.repeat(64) }),
    /differs from reviewed pin/,
  );
  assert.throws(
    () => loadTrustedWriterPlan(f.dir, { ...inputs, headSha: f.base }),
    /head mismatch/,
  );
  assert.throws(
    () => loadTrustedWriterPlan(f.dir, { ...inputs, baseSha: headSha }),
    /base mismatch/,
  );
  const result = spawnSync(
    process.execPath,
    [
      checker,
      '--root',
      f.dir,
      '--base-ref',
      f.base,
      '--head-ref',
      headSha,
      '--ci',
      '--input-plan-ref',
      policyRef,
      '--input-plan-path',
      planPath,
      '--input-plan-sha256',
      pin,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('absolute, traversal, control-character and Windows paths cannot bypass checks', () => {
  for (const file of [
    '/package.json',
    '../package.json',
    'services/customer/../identity/src/main.ts',
    'services\\customer\\src\\main.ts',
    'tests/parallel/A/hidden\npath.mjs',
  ]) {
    assert.throws(() => check('E', [file]), /path|Path|segment/);
  }
});
