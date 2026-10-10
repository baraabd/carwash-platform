// P07-E1: release manifest, migration job guards and release workflow policy.
// Pure/static tests; the registry, BuildKit attestations and real PostgreSQL
// behaviour are proven by .github/workflows/p07-release-build.yml on runners.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from '../../../scripts/ci/policy.mjs';
import {
  manifestDigest,
  migrationNames,
  migrationSetDigest,
  ownerMigrationSet,
  parseDigestReference,
  repositoryFor,
  validateManifest,
} from '../../../scripts/production/E/release/manifest.mjs';
import { assembleParts } from '../../../scripts/production/E/release/build-release.mjs';
import {
  JobRefused,
  assertMigrationIdentity,
  assessHistory,
  hardeningSql,
  readMigrationDsn,
  redactor,
} from '../../../infra/release/migrate-job.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const D = (c) => `sha256:${c.repeat(64)}`;
const SHA = 'a'.repeat(40);
const REGISTRY = 'ghcr.io/baraabd';

function artifact(target, role, digestChar) {
  const repository = repositoryFor(REGISTRY, target.id, role);
  const a = {
    id: target.id,
    kind: target.kind,
    role,
    repository,
    digest: D(digestChar),
    reference: `${repository}@${D(digestChar)}`,
    platform: 'linux/amd64',
    attestations: { sbom: true, provenance: true },
  };
  if (role === 'migration') a.migrationSet = { digest: D('9'), migrations: ['20260101000000_x'] };
  return a;
}

function validManifest(targets = inventory().targets) {
  const artifacts = [];
  for (const t of targets) {
    artifacts.push(artifact(t, 'runtime', 'b'));
    if (t.kind === 'service' && t.database) artifacts.push(artifact(t, 'migration', 'c'));
  }
  return {
    kind: 'carwash.release-manifest',
    schemaVersion: 1,
    source: { sha: SHA, tree: 'b'.repeat(40), lockfileBlob: 'c'.repeat(40), dirty: false },
    registry: REGISTRY,
    baseImages: { node: `public.ecr.aws/docker/library/node@${D('d')}` },
    artifacts,
  };
}

const codes = (problems) => problems.map((p) => p.code);

test('a complete manifest covering every catalog target validates', () => {
  assert.deepEqual(validateManifest(validManifest(), inventory().targets), []);
});

test('every catalog database owner needs a migration artifact; others must not have one', () => {
  const targets = inventory().targets;
  const owners = targets.filter((t) => t.kind === 'service' && t.database);
  assert.ok(owners.length >= 19, 'all runtime database owners are covered');
  const m = validManifest();
  m.artifacts = m.artifacts.filter((a) => !(a.id === 'billing' && a.role === 'migration'));
  assert.ok(codes(validateManifest(m, targets)).includes('MIGRATION_ARTIFACT_MISSING'));
  const g = validManifest();
  g.artifacts.push(
    artifact(
      targets.find((t) => t.kind === 'gateway'),
      'migration',
      'e',
    ),
  );
  assert.ok(codes(validateManifest(g, targets)).includes('UNEXPECTED_MIGRATION_ARTIFACT'));
});

test('a tag (floating or not) is never a deployable reference', () => {
  for (const reference of [
    'ghcr.io/baraabd/carwash-booking:latest',
    'ghcr.io/baraabd/carwash-booking:' + SHA,
    'ghcr.io/baraabd/carwash-booking:latest@' + D('b'),
    'ghcr.io/baraabd/carwash-booking@sha256:short',
    'GHCR.io/Baraabd/carwash-booking@' + D('b'),
  ]) {
    assert.equal(parseDigestReference(reference), null, reference);
    const m = validManifest();
    m.artifacts[0].reference = reference;
    assert.ok(codes(validateManifest(m, inventory().targets)).includes('REFERENCE_NOT_BY_DIGEST'));
  }
  assert.deepEqual(parseDigestReference(`localhost:5000/baraabd/carwash-booking@${D('b')}`), {
    repository: 'localhost:5000/baraabd/carwash-booking',
    digest: D('b'),
  });
});

test('dirty source, tag base images, missing attestations and digest mismatch are refused', () => {
  const t = inventory().targets;
  const dirty = validManifest();
  dirty.source.dirty = true;
  assert.ok(codes(validateManifest(dirty, t)).includes('SOURCE_NOT_CLEAN'));
  const base = validManifest();
  base.baseImages.node = 'node:24.21.0-bookworm-slim';
  assert.ok(codes(validateManifest(base, t)).includes('BASE_IMAGE_NOT_BY_DIGEST'));
  const unattested = validManifest();
  unattested.artifacts[1].attestations.provenance = false;
  assert.ok(codes(validateManifest(unattested, t)).includes('ATTESTATIONS_MISSING'));
  const mismatch = validManifest();
  mismatch.artifacts[0].digest = D('f');
  assert.ok(codes(validateManifest(mismatch, t)).includes('DIGEST_MISMATCH'));
  const moved = validManifest();
  moved.artifacts[0].reference = `ghcr.io/someone-else/carwash-x@${moved.artifacts[0].digest}`;
  assert.ok(codes(validateManifest(moved, t)).includes('REPOSITORY_MISMATCH'));
  const unknown = validManifest();
  unknown.artifacts.push({ ...artifact({ id: 'ghost', kind: 'service' }, 'runtime', 'a') });
  assert.ok(codes(validateManifest(unknown, t)).includes('UNKNOWN_TARGET'));
});

test('assembly refuses parts from different commits or base images and digests the result', () => {
  const targets = inventory().targets;
  const full = validManifest();
  const parts = targets.map((t) => ({
    source: full.source,
    registry: REGISTRY,
    baseImages: full.baseImages,
    artifacts: full.artifacts.filter((a) => a.id === t.id),
  }));
  const manifest = assembleParts(parts, REGISTRY, targets);
  const { manifestDigest: recorded, ...body } = manifest;
  assert.equal(recorded, manifestDigest(body));
  assert.equal(manifestDigest(body), manifestDigest(JSON.parse(JSON.stringify(body))));
  const drifted = structuredClone(parts);
  drifted[3].source = { ...drifted[3].source, sha: 'f'.repeat(40) };
  assert.throws(() => assembleParts(drifted, REGISTRY, targets), /different sources/);
  const rebased = structuredClone(parts);
  rebased[2].baseImages = { node: `node@${D('e')}` };
  assert.throws(() => assembleParts(rebased, REGISTRY, targets), /different base images/);
  assert.throws(() => assembleParts(parts.slice(1), REGISTRY, targets), /invalid/);
});

test('migration set digest is order-independent, content-bound and line-ending proof', () => {
  const a = '100644 blob ' + '1'.repeat(40) + '\tservices/x/prisma/migrations/1_a/migration.sql';
  const b = '100644 blob ' + '2'.repeat(40) + '\tservices/x/prisma/schema.prisma';
  assert.equal(migrationSetDigest(`${a}\n${b}`), migrationSetDigest(`${b}\r\n${a}\n`));
  assert.notEqual(
    migrationSetDigest(`${a}\n${b}`),
    migrationSetDigest(a.replace('1'.repeat(40), '3'.repeat(40)) + `\n${b}`),
  );
  assert.deepEqual(migrationNames(`${a}\n${b}`), ['1_a']);
  assert.throws(() => migrationSetDigest(''), /EMPTY_MIGRATION_SET/);
});

test('owner migration sets read from git match the committed migration directories', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  for (const target of inventory().targets.filter((t) => t.kind === 'service' && t.database)) {
    const set = ownerMigrationSet(root, head, target.path);
    const committed = execFileSync(
      'git',
      ['ls-tree', '--name-only', `${head}:${target.path}/prisma/migrations`],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\n')
      .filter((n) => n && n !== 'migration_lock.toml')
      .sort();
    assert.deepEqual(set.migrations, committed, target.id);
    assert.match(set.digest, /^sha256:[0-9a-f]{64}$/);
  }
});

test('the migration job only accepts a mounted secret file, never a plaintext env DSN', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cw-mj-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const one = path.join(dir, 'dsn');
  writeFileSync(one, 'postgresql://u:p@h/db\n');
  const two = path.join(dir, 'two');
  writeFileSync(two, 'postgresql://a\npostgresql://b\n');
  assert.equal(readMigrationDsn({ MIGRATION_DATABASE_URL_FILE: one }), 'postgresql://u:p@h/db');
  const refused = (env) => {
    try {
      readMigrationDsn(env);
    } catch (error) {
      assert.ok(error instanceof JobRefused);
      return error.code;
    }
    return 'ACCEPTED';
  };
  assert.equal(
    refused({ DATABASE_URL: 'x', MIGRATION_DATABASE_URL_FILE: one }),
    'PLAINTEXT_DATABASE_URL_REFUSED',
  );
  assert.equal(refused({}), 'MIGRATION_DATABASE_URL_FILE_REQUIRED');
  assert.equal(
    refused({ MIGRATION_DATABASE_URL_FILE: 'relative/dsn' }),
    'SECRET_FILE_NOT_ABSOLUTE',
  );
  assert.equal(refused({ MIGRATION_DATABASE_URL_FILE: two }), 'SECRET_FILE_MUST_HOLD_ONE_DSN');
  assert.equal(refused({ MIGRATION_DATABASE_URL_FILE: dir }), 'SECRET_FILE_NOT_REGULAR');
});

test('the migration job accepts only its own migration identity, database, schema and TLS', () => {
  const ok =
    'postgresql://cw_booking_migrate:s3cret@db.internal:5432/cw_booking?schema=app&sslmode=verify-full';
  const identity = assertMigrationIdentity(ok, 'booking');
  assert.equal(identity.user, 'cw_booking_migrate');
  assert.equal(identity.appRole, 'cw_booking_app');
  assert.ok(!JSON.stringify(identity).includes('s3cret'));
  const code = (dsn, service = 'booking', opts) => {
    try {
      assertMigrationIdentity(dsn, service, opts);
      return 'ACCEPTED';
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(
    code(ok.replace('cw_booking_migrate', 'cw_booking_app')),
    'NOT_THIS_OWNERS_MIGRATION_IDENTITY',
  );
  assert.equal(
    code(ok.replace('cw_booking_migrate', 'postgres')),
    'NOT_THIS_OWNERS_MIGRATION_IDENTITY',
  );
  assert.equal(code(ok, 'billing'), 'NOT_THIS_OWNERS_MIGRATION_IDENTITY');
  assert.equal(code(ok.replace('/cw_booking?', '/cw_billing?')), 'NOT_THIS_OWNERS_DATABASE');
  assert.equal(code(ok.replace('schema=app', 'schema=public')), 'DSN_SCHEMA_MUST_BE_APP');
  assert.equal(code(ok.replace('&sslmode=verify-full', '')), 'DSN_TLS_REQUIRED');
  assert.equal(code(ok.replace('sslmode=verify-full', 'sslmode=prefer')), 'DSN_TLS_REQUIRED');
  assert.equal(
    code(ok.replace('&sslmode=verify-full', ''), 'booking', { tlsMode: 'disabled-rehearsal' }),
    'ACCEPTED',
  );
  assert.equal(code(ok, 'booking', { tlsMode: 'off' }), 'TLS_MODE_INVALID');
  assert.equal(code(ok.replace(':s3cret', '')), 'DSN_PASSWORD_REQUIRED');
  assert.equal(
    code('mysql://cw_booking_migrate:x@h/cw_booking?schema=app&sslmode=require'),
    'DSN_PROTOCOL',
  );
  assert.equal(code(ok, '../booking'), 'SERVICE_INVALID');
});

test('job output redaction removes the password in raw and encoded form and any DSN', () => {
  const dsn = 'postgresql://cw_x_migrate:p%40ss-w0rd@h:5432/cw_x?schema=app';
  const redact = redactor(dsn);
  const out = redact(`error at ${dsn} using p@ss-w0rd and p%40ss-w0rd; postgres://other:zz@q/r`);
  assert.ok(!out.includes('p@ss-w0rd') && !out.includes('p%40ss-w0rd') && !out.includes('zz@q'));
});

test('history assessment fails closed on modified, failed, rolled-back or newer migrations', () => {
  const local = [
    { name: '1_a', checksum: 'x1' },
    { name: '2_b', checksum: 'x2' },
  ];
  const row = (name, checksum, extra = {}) => ({
    migration_name: name,
    checksum,
    finished_at: '2026-10-11T00:00:00Z',
    rolled_back_at: null,
    ...extra,
  });
  assert.deepEqual(assessHistory(local, [row('1_a', 'x1')], 'before'), {
    applied: ['1_a'],
    pending: ['2_b'],
    problems: [],
  });
  assert.deepEqual(codes(assessHistory(local, [row('1_a', 'x1')], 'after').problems), [
    'MIGRATIONS_NOT_APPLIED',
  ]);
  assert.deepEqual(codes(assessHistory(local, [row('1_a', 'zz')], 'before').problems), [
    'APPLIED_MIGRATION_MODIFIED',
  ]);
  assert.deepEqual(codes(assessHistory(local, [row('3_c', 'x3')], 'before').problems), [
    'DATABASE_AHEAD_OF_IMAGE',
  ]);
  assert.deepEqual(
    codes(assessHistory(local, [row('1_a', 'x1', { finished_at: null })], 'before').problems),
    ['FAILED_OR_RUNNING_MIGRATION'],
  );
  assert.deepEqual(
    codes(
      assessHistory(local, [row('1_a', 'x1', { rolled_back_at: '2026-10-11T00:00:00Z' })], 'before')
        .problems,
    ),
    ['ROLLED_BACK_MIGRATION_PRESENT'],
  );
});

test('owner hardening removes history access and DDL from the runtime role only', () => {
  const sql = hardeningSql('configuration');
  assert.match(
    sql,
    /REVOKE ALL ON TABLE app\._prisma_migrations FROM PUBLIC, "cw_configuration_app"/,
  );
  assert.match(sql, /REVOKE CREATE ON SCHEMA app FROM PUBLIC, "cw_configuration_app"/);
  assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE/);
  assert.doesNotMatch(sql, /GRANT (?!CONNECT)/);
});

test('migration image: no app code, install shared across owners, non-root, no package managers', () => {
  const dockerfile = read('infra/release/Dockerfile.migrate');
  assert.ok(
    dockerfile.indexOf('pnpm install --frozen-lockfile') <
      dockerfile.indexOf('ARG SERVICE\nRUN test'),
  );
  assert.match(dockerfile, /^USER 1000:1000$/m);
  assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm/);
  assert.match(dockerfile, /ENTRYPOINT \["node", "\/migrate\/migrate-job\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /COPY[^\n]*\/deploy\/dist/);
  assert.doesNotMatch(dockerfile, /:latest/);
  const ignore = read('infra/release/Dockerfile.migrate.dockerignore');
  assert.match(ignore, /^!infra\/release\/migrate-job\.mjs$/m);
  assert.match(ignore, /^\.env$/m);
});

test('release workflows: SHA-pinned actions, no floating tags, rehearsal has no write token', () => {
  const files = readdirSync(path.join(root, '.github/workflows')).filter((f) =>
    f.startsWith('p07-release'),
  );
  assert.deepEqual(files.sort(), ['p07-release-artifacts.yml', 'p07-release-build.yml']);
  for (const file of files) {
    const text = read(`.github/workflows/${file}`);
    for (const [, ref] of text.matchAll(/uses: ([^\s]+)/g)) {
      if (ref.startsWith('./')) continue;
      assert.match(ref, /@[0-9a-f]{40}$/, `${file}: ${ref} must be pinned to a commit`);
    }
    assert.doesNotMatch(text, /:latest\b/);
    if (text.includes('actions/setup-node')) assert.match(text, /node-version-file: \.nvmrc/);
  }
  const caller = read('.github/workflows/p07-release-artifacts.yml');
  const rehearse = /rehearse:\n([\s\S]*?)\n {2}publish:/.exec(caller)[1];
  assert.doesNotMatch(rehearse, /:\s*write/);
  assert.match(rehearse, /publish: false/);
  const publish = caller.slice(caller.indexOf('  publish:'));
  assert.match(publish, /github\.ref == 'refs\/heads\/main'/);
  const build = read('.github/workflows/p07-release-build.yml');
  assert.doesNotMatch(build.split('\njobs:')[0], /^permissions:/m);
  assert.match(build, /--provenance=mode=max|verify-release\.mjs --part/);
});

test('the build pins every image build arg by digest and records only the pushed digest', () => {
  const source = read('scripts/production/E/release/build-release.mjs');
  assert.match(source, /'--provenance=mode=max'/);
  assert.match(source, /'--sbom=true'/);
  assert.match(source, /NODE_IMAGE=\$\{nodeBase\.reference\}/);
  assert.match(source, /RUNTIME_IMAGE=\$\{toolLock\.runtime\.image\}/);
  assert.match(source, /containerimage\.digest/);
  assert.match(source, /assertCleanSource\(\)/);
});
