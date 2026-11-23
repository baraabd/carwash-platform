#!/usr/bin/env node
/**
 * W01 changed-path authorization. No dependency installation is required.
 *
 * Inspection: node scripts/parallel/E/check-owners.mjs --inventory
 * Commit check: --base-ref <full-sha> --head-ref <full-sha> --lane E
 * Local edits: --base-ref <full-sha> --worktree --lane E
 * First promotion: add --bootstrap-registry-sha256 <independently-reviewed-pin>.
 * CI additionally requires --ci --input-plan-ref <approved-policy-commit-sha>
 * --input-plan-path <protected-plan.json> --input-plan-sha256 <reviewed-pin>.
 * A separate policy commit binds the known exact base/head and changed paths;
 * storing a plan in the same commit whose SHA it names creates a SHA cycle.
 *
 * CI must run THIS SCRIPT from the protected base. Running PR code, supplying
 * a candidate's lane/plan or computing either reviewed pin from the candidate does
 * not establish trust. This preparatory CLI does not configure GitHub rules.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTRY_PATH = 'architecture/parallel-ownership.json';
const LANES = ['A', 'B', 'C', 'D', 'E'];
const SHA = /^[a-f0-9]{40}$/;
const LEASE_SERVICES = new Set([
  'vehicle',
  'pricing',
  'scheduling',
  'dispatch',
  'wallet',
  'subscription',
  'reviews',
  'geo',
  'configuration',
]);
const REQUIRED_JOBS = ['plan', 'targeted', 'static', 'integration', 'images', 'security', 'codeql'];
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function safePath(value) {
  assert.equal(typeof value, 'string', 'Path must be a string');
  assert.ok(
    value &&
      !value.includes('\\') &&
      ![...value].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ),
    'Unsafe repository path',
  );
  assert.ok(!path.posix.isAbsolute(value), 'Absolute repository path');
  assert.ok(
    value.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Unsafe path segment',
  );
  return value;
}

export function isReserved(file) {
  const name = path.posix.basename(file);
  return (
    name === 'package.json' ||
    /^tsconfig.*\.json$/.test(name) ||
    /^Dockerfile/.test(name) ||
    /(?:^|[.-])lock(?:\.(?:json|ya?ml|toml|b))?$/.test(name) ||
    ['npm-shrinkwrap.json', 'pnpm-workspace.yaml', 'migration_lock.toml'].includes(name) ||
    /^(?:\.github|packages|architecture|infra)\//.test(file) ||
    (!file.includes('/') &&
      ([
        '.dockerignore',
        '.env.example',
        '.gitattributes',
        '.gitignore',
        '.npmrc',
        '.nvmrc',
        '.prettierignore',
        '.prettierrc.json',
        '.prettierrc.f001.json',
        'turbo.json',
      ].includes(name) ||
        /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)?\.config\.(?:mjs|cjs|js|ts|json)$/.test(name)))
  );
}

function locked(registry, file) {
  return (
    registry.lockedPaths.includes(file) ||
    registry.lockedPrefixes.some((prefix) => file.startsWith(prefix))
  );
}

function inventoryOwner(registry, file) {
  return Object.entries(registry.inventory).find(([, files]) => files.includes(file))?.[0] ?? null;
}

/** New service/app namespaces and global tests are deliberately not inferred. */
function permanentOwner(registry, file) {
  if (locked(registry, file)) return 'LOCKED';
  const parts = file.split('/');
  if (parts[0] === 'services' && !Object.hasOwn(registry.serviceOwners, parts[1])) return null;
  if (parts[0] === 'apps' && !Object.hasOwn(registry.appOwners, parts[1])) return null;
  if (isReserved(file)) return 'E';
  const laneLocal = /^(?:docs|tests|scripts)\/parallel\/([A-E])\//.exec(file);
  if (laneLocal) return laneLocal[1];
  const inventoried = inventoryOwner(registry, file);
  if (inventoried) return inventoried;
  if (parts[0] === 'services' && /^(?:src|test|prisma)\//.test(parts.slice(2).join('/'))) {
    return registry.serviceOwners[parts[1]];
  }
  if (parts[0] === 'apps' && parts[2] === 'src') return registry.appOwners[parts[1]];
  if (registry.customerScriptPrefixes.some((prefix) => file.startsWith(prefix))) return 'A';
  if (file.startsWith('docs/customer/')) return 'A';
  // New global test/script/docs paths require a reviewed inventory update.
  return null;
}

export function validateRegistry(registry, trackedPaths = null) {
  assert.equal(registry.schemaVersion, 1, 'Unknown ownership schema');
  assert.equal(registry.wave, 'W01', 'Unknown ownership wave');
  assert.match(registry.inventoryBase?.sha ?? '', SHA, 'Inventory needs full commit SHA');
  assert.match(registry.inventoryBase?.tree ?? '', SHA, 'Inventory needs full tree SHA');
  assert.ok(registry.serviceOwners && registry.appOwners, 'Missing namespace owners');
  for (const [id, lane] of [
    ...Object.entries(registry.serviceOwners),
    ...Object.entries(registry.appOwners),
  ]) {
    assert.match(id, /^[a-z][a-z0-9-]*$/, 'Unsafe namespace');
    assert.ok(LANES.includes(lane), 'Unknown namespace lane');
  }
  assert.deepEqual(
    Object.keys(registry.inventory).sort(),
    [...LANES, 'LOCKED'].sort(),
    'Incomplete lane inventory',
  );
  const inventoried = new Set();
  for (const [owner, files] of Object.entries(registry.inventory)) {
    assert.ok(Array.isArray(files), 'Inventory paths must be arrays');
    for (const file of files) {
      safePath(file);
      assert.ok(!inventoried.has(file), `Multiply-owned inventory path: ${file}`);
      inventoried.add(file);
      if (locked(registry, file)) assert.equal(owner, 'LOCKED', `Unlocked reference: ${file}`);
      else if (isReserved(file)) assert.equal(owner, 'E', `Reserved file is not E-owned: ${file}`);
      else if (file.startsWith('services/'))
        assert.equal(
          owner,
          registry.serviceOwners[file.split('/')[1]],
          `Wrong service owner: ${file}`,
        );
      else if (file.startsWith('apps/'))
        assert.equal(owner, registry.appOwners[file.split('/')[1]], `Wrong app owner: ${file}`);
    }
  }
  for (const file of registry.lockedPaths) safePath(file);
  for (const prefix of [...registry.lockedPrefixes, ...registry.customerScriptPrefixes]) {
    assert.ok(prefix.endsWith('/'), 'Prefix requires a directory boundary');
    safePath(prefix.slice(0, -1));
  }
  assert.equal(registry.w01C014?.owner, 'A', 'C014 must retain A ownership');
  assert.match(registry.w01C014.head, SHA, 'C014 head needs full SHA');
  const exceptions = new Set();
  for (const file of registry.w01C014.paths) {
    safePath(file);
    assert.ok(!exceptions.has(file) && !locked(registry, file), `Invalid C014 exception: ${file}`);
    exceptions.add(file);
  }
  assert.equal(exceptions.size, 33, 'W01 requires all 33 audited C014 changed paths');
  const leased = new Set();
  const leaseIds = new Set();
  for (const lease of registry.leases) {
    assert.ok(lease.id && !leaseIds.has(lease.id), 'Duplicate/empty lease ID');
    leaseIds.add(lease.id);
    assert.equal(lease.owner, 'E', 'W01 bootstrap lease writer must be E');
    assert.equal(lease.expiresAt, 'verified-BASE_W02', 'Unbounded lease');
    assert.ok(
      typeof lease.purpose === 'string' && lease.purpose.length > 10,
      'Lease needs purpose',
    );
    assert.ok(Array.isArray(lease.paths) && lease.paths.length > 0, 'Lease needs exact paths');
    for (const file of lease.paths) {
      safePath(file);
      const parts = file.split('/');
      assert.ok(!file.includes('*'), 'Lease must list exact paths, not patterns');
      assert.ok(!leased.has(file), `Overlapping lease: ${file}`);
      assert.ok(
        !exceptions.has(file) && !locked(registry, file) && !isReserved(file),
        `Forbidden lease: ${file}`,
      );
      assert.ok(
        (parts[0] === 'services' && LEASE_SERVICES.has(parts[1])) ||
          (parts[0] === 'apps' && ['operator-web', 'admin-web'].includes(parts[1])),
        `Unknown bootstrap lease: ${file}`,
      );
      assert.equal(
        permanentOwner(registry, file) ??
          registry.serviceOwners[parts[1]] ??
          registry.appOwners[parts[1]],
        lease.permanentOwner,
        `Lease owner mismatch: ${file}`,
      );
      leased.add(file);
    }
  }
  if (registry.verifiedBaseW02 !== null) {
    const next = registry.verifiedBaseW02;
    assert.match(next.sha ?? '', SHA, 'BASE_W02 needs full SHA');
    assert.match(next.tree ?? '', SHA, 'BASE_W02 needs full tree SHA');
    assert.ok(
      typeof next.evidence === 'string' && next.evidence.length > 0,
      'BASE_W02 needs accepted evidence',
    );
    assert.deepEqual(
      Object.keys(next.requiredChecks ?? {}).sort(),
      [...REQUIRED_JOBS].sort(),
      'BASE_W02 needs every mandatory check',
    );
    for (const job of REQUIRED_JOBS)
      assert.equal(next.requiredChecks[job], 'success', `BASE_W02 ${job} not verified`);
  }
  if (trackedPaths !== null) {
    assert.deepEqual(
      [...inventoried].sort(),
      [...trackedPaths].map(safePath).sort(),
      'Tracked inventory does not match its source tree',
    );
  }
  return registry;
}

export function effectiveOwner(registry, file) {
  safePath(file);
  const owner = permanentOwner(registry, file);
  if (owner === 'LOCKED')
    return { path: file, owner, writable: false, rule: 'frozen-reference-or-policy' };
  const w01 = registry.verifiedBaseW02 === null;
  if (w01 && registry.w01C014.paths.includes(file))
    return { path: file, owner: 'A', writable: true, rule: 'W01-C014-exact-exception' };
  if (w01) {
    const lease = registry.leases.find((entry) => entry.paths.includes(file));
    if (lease) return { path: file, owner: 'E', writable: true, rule: lease.id };
  }
  if (!owner) return { path: file, owner: null, writable: false, rule: 'undeclared-path' };
  const local = /^(?:docs|tests|scripts)\/parallel\/[A-E]\//.test(file);
  return {
    path: file,
    owner,
    writable: !w01 || owner === 'E' || local,
    rule: w01 && owner !== 'E' && !local ? 'W01-business-writes-not-open' : 'permanent-owner',
  };
}

export function checkChangedPaths(registry, { lane, paths, writers = null }) {
  validateRegistry(registry);
  if (writers === null) assert.ok(LANES.includes(lane), 'Unknown writer lane');
  const unique = [...new Set(paths.map(safePath))].sort();
  if (writers !== null) {
    assert.deepEqual(
      Object.keys(writers).sort(),
      unique,
      'Writer plan must cover exactly every changed path',
    );
    for (const writer of Object.values(writers))
      assert.ok(LANES.includes(writer), 'Unknown plan writer');
  }
  const inventory = unique.map((file) => ({
    ...effectiveOwner(registry, file),
    writer: writers?.[file] ?? lane,
  }));
  const findings = inventory.filter((entry) => !entry.writable || entry.owner !== entry.writer);
  return { ok: findings.length === 0, inventory, findings };
}

/** A proposed registry is validated, but never used to authorize its own diff. */
export function validateRegistryUpdate(previous, candidate) {
  validateRegistry(candidate);
  for (const file of previous.lockedPaths) {
    assert.ok(candidate.lockedPaths.includes(file), `Cannot unlock frozen path: ${file}`);
  }
  for (const prefix of previous.lockedPrefixes) {
    assert.ok(candidate.lockedPrefixes.includes(prefix), `Cannot unlock frozen prefix: ${prefix}`);
  }
  assert.deepEqual(
    [...candidate.w01C014.paths].sort(),
    [...previous.w01C014.paths].sort(),
    'W01 must retain the full exact C014 exception record',
  );
  return candidate;
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function changedPaths(root, baseSha, headSha = null) {
  assert.match(baseSha, SHA, 'Changed-path base requires a full SHA');
  if (headSha !== null) assert.match(headSha, SHA, 'Changed-path head requires a full SHA');
  // No rename collapsing: both the deleted source and added destination must
  // be authorized. -z preserves spaces/newlines; unsafe paths fail later.
  const files = git(root, [
    'diff',
    '--no-ext-diff',
    '--no-renames',
    '--name-only',
    '-z',
    baseSha,
    ...(headSha ? [headSha] : []),
    '--',
  ])
    .split('\0')
    .filter(Boolean);
  if (headSha === null)
    files.push(
      ...git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
        .split('\0')
        .filter(Boolean),
    );
  return [...new Set(files)].map(safePath).sort();
}

export function loadTrustedRegistry(root, baseSha, bootstrapPin = null) {
  assert.match(baseSha, SHA, 'Trusted base requires full SHA');
  git(root, ['rev-parse', '--verify', `${baseSha}^{commit}`]);
  let source;
  let trust = 'protected-base-blob';
  try {
    source = git(root, ['show', `${baseSha}:${REGISTRY_PATH}`]);
  } catch {
    assert.match(
      bootstrapPin ?? '',
      /^[a-f0-9]{64}$/,
      'Base has no registry; independently reviewed bootstrap SHA-256 pin required',
    );
    source = readFileSync(path.join(root, REGISTRY_PATH), 'utf8');
    assert.equal(
      createHash('sha256').update(source).digest('hex'),
      bootstrapPin,
      'Bootstrap registry differs from reviewed pin',
    );
    trust = 'digest-pinned-bootstrap';
  }
  const registry = validateRegistry(JSON.parse(source));
  const tracked = git(root, ['ls-tree', '-r', '--name-only', '-z', registry.inventoryBase.sha])
    .split('\0')
    .filter(Boolean);
  validateRegistry(registry, tracked);
  assert.equal(
    git(root, ['rev-parse', `${registry.inventoryBase.sha}^{tree}`]).trim(),
    registry.inventoryBase.tree,
    'Inventory tree mismatch',
  );
  if (registry.verifiedBaseW02) {
    assert.equal(
      git(root, ['rev-parse', `${registry.verifiedBaseW02.sha}^{tree}`]).trim(),
      registry.verifiedBaseW02.tree,
      'BASE_W02 tree mismatch',
    );
    git(root, ['merge-base', '--is-ancestor', registry.verifiedBaseW02.sha, baseSha]);
  }
  return { registry, trust };
}

/** The workflow must obtain policyRef/pin from protected reviewer-controlled inputs. */
export function loadTrustedWriterPlan(root, { policyRef, planPath, pin, baseSha, headSha }) {
  assert.match(policyRef ?? '', SHA, 'CI writer plan requires an approved immutable policy commit');
  assert.match(
    pin ?? '',
    /^[a-f0-9]{64}$/,
    'CI writer plan requires an independently reviewed SHA-256 pin',
  );
  safePath(planPath);
  git(root, ['rev-parse', '--verify', `${policyRef}^{commit}`]);
  const source = git(root, ['show', `${policyRef}:${planPath}`]);
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    pin,
    'Writer plan differs from reviewed pin',
  );
  const plan = JSON.parse(source);
  assert.equal(plan.schemaVersion, 1, 'Unknown writer plan');
  assert.equal(plan.baseSha, baseSha, 'Writer plan base mismatch');
  assert.equal(plan.headSha, headSha, 'Writer plan head mismatch');
  assert.ok(
    plan.writers && typeof plan.writers === 'object' && !Array.isArray(plan.writers),
    'Missing protected writer map',
  );
  return plan;
}

function main() {
  const args = process.argv.slice(2);
  const options = new Map();
  const flags = new Set(['--inventory', '--worktree', '--ci']);
  const known = new Set([
    ...flags,
    '--root',
    '--registry',
    '--base-ref',
    '--head-ref',
    '--lane',
    '--bootstrap-registry-sha256',
    '--input-plan-ref',
    '--input-plan-path',
    '--input-plan-sha256',
  ]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    assert.ok(known.has(key) && !options.has(key), `Unknown/duplicate option: ${key}`);
    if (flags.has(key)) options.set(key, true);
    else {
      assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `${key} requires value`);
      options.set(key, args[++i]);
    }
  }
  const root = path.resolve(options.get('--root') ?? DEFAULT_ROOT);
  if (options.has('--inventory')) {
    const registry = validateRegistry(
      JSON.parse(
        readFileSync(path.resolve(root, options.get('--registry') ?? REGISTRY_PATH), 'utf8'),
      ),
    );
    const tracked = git(root, ['ls-tree', '-r', '--name-only', '-z', registry.inventoryBase.sha])
      .split('\0')
      .filter(Boolean);
    validateRegistry(registry, tracked);
    const inventory = tracked.map((file) => effectiveOwner(registry, file));
    assert.ok(
      inventory.every((entry) => entry.owner),
      'Unowned tracked file',
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'proposal-inventory-only',
          sourceSha: registry.inventoryBase.sha,
          tracked: inventory.length,
          owners: Object.fromEntries(
            [...LANES, 'LOCKED'].map((lane) => [
              lane,
              inventory.filter((entry) => entry.owner === lane).length,
            ]),
          ),
          leasePaths: registry.leases.reduce((n, lease) => n + lease.paths.length, 0),
          c014Paths: registry.w01C014.paths.length,
        },
        null,
        2,
      ),
    );
    return;
  }
  assert.ok(
    !options.has('--registry'),
    'Changed-path checks cannot trust a candidate-selected registry',
  );
  const baseSha = options.get('--base-ref');
  assert.match(baseSha ?? '', SHA, '--base-ref requires full immutable SHA');
  assert.ok(
    !(options.has('--worktree') && options.has('--head-ref')),
    '--worktree and --head-ref are exclusive',
  );
  const headSha = options.has('--worktree')
    ? null
    : (options.get('--head-ref') ?? git(root, ['rev-parse', 'HEAD']).trim());
  const { registry, trust } = loadTrustedRegistry(
    root,
    baseSha,
    options.get('--bootstrap-registry-sha256'),
  );
  const files = changedPaths(root, baseSha, headSha);
  if (files.includes(REGISTRY_PATH)) {
    const source =
      headSha === null
        ? readFileSync(path.join(root, REGISTRY_PATH), 'utf8')
        : git(root, ['show', `${headSha}:${REGISTRY_PATH}`]);
    validateRegistryUpdate(registry, JSON.parse(source));
  }
  let writers = null;
  if (options.has('--ci')) {
    assert.ok(headSha, 'CI cannot authorize a dirty worktree');
    const plan = loadTrustedWriterPlan(root, {
      policyRef: options.get('--input-plan-ref'),
      planPath: options.get('--input-plan-path'),
      pin: options.get('--input-plan-sha256'),
      baseSha,
      headSha,
    });
    writers = plan.writers;
  }
  const result = checkChangedPaths(registry, {
    lane: options.get('--lane'),
    paths: files,
    writers,
  });
  console.log(
    JSON.stringify(
      {
        ...result,
        baseSha,
        headSha,
        trust,
        scope: 'changed paths only; not production or independent-review evidence',
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Ownership guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
