// P08 evidence-gate regressions use real temporary Git repositories and synthetic
// component outcomes. They do not claim that a database or broker was recovered.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  finishRecoveryReport,
  hasExactOwnerCoverage,
  recoveryOwners,
} from '../../../scripts/production/E/recovery/drill.mjs';
import { assertExactSource } from '../../../scripts/production/E/release/source-provenance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const owner = (id) => ({
  id,
  path: `services/${id}`,
  database: `cw_${id}`,
  runtimeRole: `cw_${id}_app`,
  migrationRole: `cw_${id}_migrate`,
});

function git(work, ...args) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Recovery gate test',
      '-c',
      'user.email=recovery-test@example.invalid',
      ...args,
    ],
    { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function fixture(t, { runner = false } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), 'cw-recovery-evidence-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  if (runner) {
    // Exercise main() from its own committed checkout, including its unchanged
    // real runner code. Preparation deliberately fails before any Docker call.
    for (const directory of ['scripts', 'architecture', 'infra/release']) {
      cpSync(path.join(root, directory), path.join(work, directory), { recursive: true });
    }
    for (const { path: ownerPath } of recoveryOwners(root)) {
      cpSync(path.join(root, ownerPath, 'prisma'), path.join(work, ownerPath, 'prisma'), {
        recursive: true,
      });
    }
  } else {
    const services = [owner('booking'), owner('dispatch')];
    mkdirSync(path.join(work, 'architecture'));
    writeFileSync(
      path.join(work, 'architecture/service-catalog.json'),
      JSON.stringify({ services }),
    );
    for (const service of services) {
      const migrations = path.join(work, service.path, 'prisma/migrations');
      mkdirSync(path.join(migrations, '20260101000000_initial'), { recursive: true });
      writeFileSync(path.join(migrations, 'migration_lock.toml'), 'provider = "postgresql"\n');
      writeFileSync(
        path.join(migrations, '20260101000000_initial/migration.sql'),
        'CREATE TABLE app.probe (id int PRIMARY KEY);\n',
      );
    }
  }
  writeFileSync(path.join(work, 'source-input.txt'), 'committed source\n');
  git(work, 'init', '--quiet');
  git(work, 'add', '--all');
  git(work, 'commit', '--quiet', '-m', 'recovery test fixture');
  return work;
}

function successfulComponents(work) {
  const source = assertExactSource(work);
  const ownerInventory = recoveryOwners(work);
  return {
    source,
    report: {
      kind: 'carwash.recovery-drill',
      schemaVersion: 1,
      sourceSha: source.sha,
      sourceTree: source.tree,
      sourceVerification: { startedClean: true, finishedCleanAndUnchanged: false },
      ownerInventory,
      components: {
        postgres: {
          ok: true,
          ownerChecks: Object.fromEntries(ownerInventory.map(({ id }) => [id, { history: true }])),
        },
        rabbitmq: { ok: true },
        redis: { ok: true },
        objects: { ok: true },
        alerts: { ok: true },
      },
      failures: {},
    },
  };
}

function finish(work, report, source, reportFile = path.join(work, 'evidence/recovery.json')) {
  finishRecoveryReport(report, source, reportFile, work);
  assert.deepEqual(JSON.parse(readFileSync(reportFile, 'utf8')), report);
  assert.ok(report.finishedAt);
  return report;
}

test('recovery inventories every current database owner and every committed migration', () => {
  const catalog = JSON.parse(readFileSync(path.join(root, 'architecture/service-catalog.json')));
  const owners = recoveryOwners(root);
  assert.deepEqual(
    owners.map(({ id }) => id),
    catalog.services.map(({ id }) => id),
  );
  assert.equal(owners.length, 19);
  for (const entry of owners) {
    assert.ok(entry.migrations.length > 0, entry.id);
    for (const migration of entry.migrations) assert.match(migration.checksum, /^[a-f0-9]{64}$/);
  }
});

for (const [label, remove, error] of [
  ['missing migration directory', '', /RECOVERY_OWNER_MIGRATIONS_INVALID: dispatch/],
  [
    'only a migration lock file',
    '20260101000000_initial',
    /RECOVERY_OWNER_MIGRATIONS_EMPTY: dispatch/,
  ],
  [
    'missing migration SQL',
    '20260101000000_initial/migration.sql',
    /RECOVERY_OWNER_MIGRATIONS_INVALID: dispatch/,
  ],
]) {
  test(`recovery refuses an owner with ${label} instead of silently dropping it`, (t) => {
    const work = fixture(t);
    rmSync(path.join(work, 'services/dispatch/prisma/migrations', remove), {
      recursive: true,
      force: true,
    });
    assert.throws(() => recoveryOwners(work), error);
  });
}

for (const [label, change, error] of [
  ['empty', (services) => services.splice(0), /RECOVERY_OWNER_INVENTORY_EMPTY/],
  ['duplicate', (services) => services.push(services[0]), /RECOVERY_OWNER_DUPLICATE/],
  [
    'wrong path',
    (services) => (services[0].path = 'services/dispatch'),
    /RECOVERY_OWNER_PATH_MISMATCH/,
  ],
  [
    'missing database',
    (services) => delete services[0].database,
    /RECOVERY_OWNER_DATABASE_MISMATCH/,
  ],
  [
    'wrong runtime role',
    (services) => (services[0].runtimeRole = 'cw_dispatch_app'),
    /RECOVERY_OWNER_RUNTIME_ROLE_MISMATCH/,
  ],
  [
    'wrong migration role',
    (services) => (services[0].migrationRole = 'cw_dispatch_migrate'),
    /RECOVERY_OWNER_MIGRATION_ROLE_MISMATCH/,
  ],
]) {
  test(`recovery rejects ${label} owner metadata`, (t) => {
    const work = fixture(t);
    const file = path.join(work, 'architecture/service-catalog.json');
    const catalog = JSON.parse(readFileSync(file, 'utf8'));
    change(catalog.services);
    writeFileSync(file, JSON.stringify(catalog));
    assert.throws(() => recoveryOwners(work), error);
  });
}

test('owner coverage requires the exact nonempty inventory, including no extra or duplicate owners', () => {
  const owners = [owner('booking'), owner('dispatch')];
  assert.equal(hasExactOwnerCoverage(owners, { dispatch: {}, booking: {} }), true);
  assert.equal(hasExactOwnerCoverage(owners, { booking: {} }), false);
  assert.equal(hasExactOwnerCoverage(owners, { booking: {}, dispatch: {}, unknown: {} }), false);
  assert.equal(hasExactOwnerCoverage([], {}), false);
  assert.equal(hasExactOwnerCoverage([owner('booking'), owner('booking')], { booking: {} }), false);
});

test('unchanged source and complete component outcomes can finalize recovery evidence', (t) => {
  const work = fixture(t);
  const { report, source } = successfulComponents(work);
  finish(work, report, source);
  assert.equal(report.accepted, true);
  assert.equal(report.sourceVerification.finishedCleanAndUnchanged, true);
  assert.deepEqual(report.failures, {});
});

for (const [label, mutate, reason] of [
  [
    'tracked source edit',
    (work) => writeFileSync(path.join(work, 'source-input.txt'), 'changed\n'),
    /tracked files are modified/,
  ],
  [
    'untracked source',
    (work) => writeFileSync(path.join(work, 'new-source.mjs'), 'export const changed = true;\n'),
    /untracked source files/,
  ],
  [
    'new commit with the same tree',
    (work) => git(work, 'commit', '--quiet', '--allow-empty', '-m', 'moved HEAD'),
    /source commit or tree changed/,
  ],
]) {
  test(`a ${label} after the drill leaves failed evidence even when all components pass`, (t) => {
    const work = fixture(t);
    const { report, source } = successfulComponents(work);
    mutate(work);
    finish(work, report, source);
    assert.equal(report.accepted, false);
    assert.equal(report.sourceVerification.finishedCleanAndUnchanged, false);
    assert.match(report.failures.source, reason);
    assert.equal(report.sourceSha, source.sha);
    assert.ok(Object.values(report.components).every(({ ok }) => ok));
  });
}

test('writing a report over a tracked source file cannot produce passing evidence', (t) => {
  const work = fixture(t);
  const { report, source } = successfulComponents(work);
  finish(work, report, source, path.join(work, 'source-input.txt'));
  assert.equal(report.accepted, false);
  assert.match(report.failures.source, /tracked files are modified/);
});

test('a passing PostgreSQL component cannot hide omitted owner evidence', (t) => {
  const work = fixture(t);
  const { report, source } = successfulComponents(work);
  delete report.components.postgres.ownerChecks.dispatch;
  finish(work, report, source);
  assert.equal(report.accepted, false);
  assert.equal(report.failures.inventory, 'RECOVERY_OWNER_COVERAGE_MISMATCH');
});

for (const component of ['postgres', 'rabbitmq', 'redis', 'objects', 'alerts']) {
  test(`an omitted ${component} component cannot pass the recovery gate`, (t) => {
    const work = fixture(t);
    const { report, source } = successfulComponents(work);
    delete report.components[component];
    finish(work, report, source);
    assert.equal(report.accepted, false);
  });
}

test('an image preparation failure still writes a truthful failed recovery report', async (t) => {
  const work = fixture(t, { runner: true });
  const { main } = await import(
    pathToFileURL(path.join(work, 'scripts/production/E/recovery/drill.mjs'))
  );
  const reportFile = path.join(work, 'evidence/recovery.json');
  const report = await main({
    argv: ['--report', reportFile],
    resolveImage: async () => {
      throw new Error('image acquisition unavailable');
    },
  });
  assert.equal(report.accepted, false);
  assert.match(report.failures.preparation, /image acquisition unavailable/);
  assert.deepEqual(report.components, {});
  assert.deepEqual(report.sourceVerification, {
    startedClean: true,
    finishedCleanAndUnchanged: true,
  });
  assert.deepEqual(JSON.parse(readFileSync(reportFile, 'utf8')), report);
});

test('a dirty starting checkout writes failed evidence without acquiring images or running drills', async (t) => {
  const work = fixture(t, { runner: true });
  const { main } = await import(
    pathToFileURL(path.join(work, 'scripts/production/E/recovery/drill.mjs'))
  );
  writeFileSync(path.join(work, 'source-input.txt'), 'dirty before preparation\n');
  let acquired = false;
  const reportFile = path.join(work, 'evidence/recovery.json');
  const report = await main({
    argv: ['--report', reportFile],
    resolveImage: async () => {
      acquired = true;
      throw new Error('must not acquire images');
    },
  });
  assert.equal(acquired, false);
  assert.equal(report.accepted, false);
  assert.equal(report.sourceSha, null);
  assert.equal(report.sourceVerification.startedClean, false);
  assert.match(report.failures.source, /tracked files are modified/);
  assert.deepEqual(JSON.parse(readFileSync(reportFile, 'utf8')), report);
});

test('an owner missing committed migrations fails preparation before any image acquisition', async (t) => {
  const work = fixture(t, { runner: true });
  rmSync(path.join(work, 'services/booking/prisma/migrations'), { recursive: true });
  git(work, 'add', '--all');
  git(work, 'commit', '--quiet', '-m', 'incomplete owner fixture');
  const { main } = await import(
    pathToFileURL(path.join(work, 'scripts/production/E/recovery/drill.mjs'))
  );
  let acquired = false;
  const reportFile = path.join(work, 'evidence/recovery.json');
  const report = await main({
    argv: ['--report', reportFile],
    resolveImage: async () => {
      acquired = true;
      throw new Error('must not acquire images');
    },
  });
  assert.equal(acquired, false);
  assert.equal(report.accepted, false);
  assert.match(report.failures.preparation, /RECOVERY_OWNER_MIGRATIONS_INVALID: booking/);
  assert.deepEqual(JSON.parse(readFileSync(reportFile, 'utf8')), report);
});
