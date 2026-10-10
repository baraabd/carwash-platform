#!/usr/bin/env node
/**
 * Real-PostgreSQL rehearsal of ONE owner's published migration job (P07-E1).
 *
 *   rehearse-migration-job.mjs --manifest-part <part.json> --report <file>
 *
 * The migration image is run BY DIGEST (pulled from the registry it was pushed
 * to) against a disposable PostgreSQL provisioned with the same role model as
 * every environment (infra/postgres/provision.sh): cw_<svc>_migrate owns the
 * database, cw_<svc>_app gets DML only.
 *
 * Cases (all must hold; a case that cannot run is a FAIL, never a skip):
 *   refuse-plaintext-env      DATABASE_URL in the environment is refused
 *   refuse-runtime-identity   the runtime role's DSN is refused before connecting
 *   refuse-missing-tls        a DSN without sslmode is refused by default
 *   deploy                    applies exactly the manifest's migration set
 *   deploy-idempotent         a second deploy applies nothing
 *   runtime-ddl-denied        the runtime role cannot CREATE/ALTER/DROP/TRUNCATE,
 *                             cannot read migration history, cannot SET ROLE
 *   runtime-dml-allowed       the runtime role can still read an owner table
 *   detect-database-ahead     an unknown applied migration stops the job
 *   detect-schema-drift       an out-of-band column is reported as drift
 *   job-sandbox               job runs read-only rootfs, uid 1000, no caps
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../../../ci/policy.mjs';
import { command } from '../../../ci/runtime.mjs';
import { officialImagePullCandidates } from '../../../lib/image-references.mjs';

const POSTGRES_TAG = 'postgres:16.10-alpine';

const option = (argv, name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function docker(args, options = {}) {
  return command('docker', args, { capture: true, timeoutMs: 900_000, ...options });
}

async function dockerOk(args, options) {
  const result = await docker(args, options);
  assert.equal(
    result.code,
    0,
    `docker ${args.slice(0, 2).join(' ')}: ${result.stderr.slice(-2000)}`,
  );
  return result.stdout.trim();
}

export async function resolvePostgresByDigest() {
  for (const candidate of officialImagePullCandidates(POSTGRES_TAG)) {
    const result = await docker([
      'buildx',
      'imagetools',
      'inspect',
      candidate,
      '--format',
      '{{json .Manifest}}',
    ]);
    if (result.code !== 0) continue;
    const { digest } = JSON.parse(result.stdout);
    return `${candidate.replace(/:[^:/]+$/, '')}@${digest}`;
  }
  throw new Error(`Cannot resolve ${POSTGRES_TAG} to a digest`);
}

function events(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

export async function rehearse({ part, reportFile }) {
  const artifact = part.artifacts.find((a) => a.role === 'migration');
  assert.ok(artifact, 'Part has no migration artifact');
  const service = artifact.id;
  const run = randomUUID().slice(0, 8);
  const network = `cw-rel-${service}-${run}`;
  const pg = `cw-rel-pg-${service}-${run}`;
  const work = mkdtempSync(path.join(tmpdir(), 'cw-migrate-job-'));
  const secrets = {
    bootstrap: randomBytes(24).toString('hex'),
    app: randomBytes(24).toString('hex'),
    migrate: randomBytes(24).toString('hex'),
  };
  const prefix = service.toUpperCase();
  const cases = [];
  const record = (name, ok, detail = {}) => {
    cases.push({ case: name, status: ok ? 'PASS' : 'FAIL', ...detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${service} ${name}`);
  };
  const postgresImage = await resolvePostgresByDigest();

  const dsnFile = (name, dsn) => {
    const file = path.join(work, name);
    writeFileSync(file, `${dsn}\n`, { mode: 0o444 });
    chmodSync(file, 0o444);
    return file;
  };
  const migrateDsn = `postgresql://cw_${service}_migrate:${secrets.migrate}@${pg}:5432/cw_${service}?schema=app`;
  const appDsn = `postgresql://cw_${service}_app:${secrets.app}@${pg}:5432/cw_${service}?schema=app`;
  const files = {
    migrate: dsnFile('migrate.dsn', migrateDsn),
    app: dsnFile('app.dsn', appDsn),
  };

  async function job(
    mode,
    { secretFile = files.migrate, env = {}, tls = 'disabled-rehearsal' } = {},
  ) {
    const envArgs = Object.entries({
      MIGRATION_DATABASE_URL_FILE: '/run/secrets/dsn',
      ...(tls ? { MIGRATION_DB_TLS: tls } : {}),
      ...env,
    }).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
    const result = await docker([
      'run',
      '--rm',
      '--network',
      network,
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '1000:1000',
      '--volume',
      `${secretFile}:/run/secrets/dsn:ro`,
      ...envArgs,
      artifact.reference,
      mode,
    ]);
    return { code: result.code, events: events(result.stdout), stderr: result.stderr.slice(-2000) };
  }

  async function psql(role, sql) {
    const password = role === 'app' ? secrets.app : secrets.migrate;
    return docker([
      'exec',
      '--env',
      `PGPASSWORD=${password}`,
      pg,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '127.0.0.1',
      '-U',
      `cw_${service}_${role === 'app' ? 'app' : 'migrate'}`,
      '-d',
      `cw_${service}`,
      '-tAc',
      sql,
    ]);
  }

  try {
    await dockerOk(['network', 'create', '--internal', network]);
    await dockerOk([
      'run',
      '-d',
      '--name',
      pg,
      '--network',
      network,
      '--env',
      'POSTGRES_USER=cw_release_bootstrap',
      '--env',
      `POSTGRES_PASSWORD=${secrets.bootstrap}`,
      '--env',
      'POSTGRES_DB=postgres',
      '--env',
      'LANG=C',
      '--env',
      `CW_SERVICES=${service}`,
      '--env',
      `${prefix}_DB_PASSWORD=${secrets.app}`,
      '--env',
      `${prefix}_MIGRATION_PASSWORD=${secrets.migrate}`,
      '--volume',
      `${path.join(ROOT, 'infra/postgres/provision.sh')}:/docker-entrypoint-initdb.d/01-provision.sh:ro`,
      postgresImage,
    ]);
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      const probe = await psql('migrate', 'SELECT 1');
      ready = probe.code === 0 && probe.stdout.trim() === '1';
      if (!ready) await delay(1000);
    }
    assert.ok(ready, 'PostgreSQL with provisioned owner roles did not become ready');

    const plaintext = await job('deploy', { env: { DATABASE_URL: migrateDsn } });
    record(
      'refuse-plaintext-env',
      plaintext.code === 3 &&
        plaintext.events.some((e) => e.code === 'PLAINTEXT_DATABASE_URL_REFUSED'),
    );

    const runtimeIdentity = await job('deploy', { secretFile: files.app });
    record(
      'refuse-runtime-identity',
      runtimeIdentity.code === 3 &&
        runtimeIdentity.events.some((e) => e.code === 'NOT_THIS_OWNERS_MIGRATION_IDENTITY'),
    );

    const noTls = await job('deploy', { tls: null });
    record(
      'refuse-missing-tls',
      noTls.code === 3 && noTls.events.some((e) => e.code === 'DSN_TLS_REQUIRED'),
    );

    const first = await job('deploy');
    const firstResult = first.events.find((e) => e.event === 'migration-job.result');
    record(
      'deploy',
      first.code === 0 &&
        firstResult?.status === 'PASS' &&
        firstResult.schemaDrift === 'NONE' &&
        JSON.stringify(firstResult.applied) === JSON.stringify(artifact.migrationSet.migrations),
      {
        applied: firstResult?.applied,
        problems: firstResult?.problems,
        stderr: first.code ? first.stderr : undefined,
      },
    );

    const second = await job('deploy');
    const secondResult = second.events.find((e) => e.event === 'migration-job.result');
    record('deploy-idempotent', second.code === 0 && secondResult?.appliedNow?.length === 0);

    const tables = await psql(
      'migrate',
      "SELECT tablename FROM pg_tables WHERE schemaname='app' AND tablename <> '_prisma_migrations' ORDER BY 1 LIMIT 1",
    );
    const table = tables.stdout.trim();
    assert.match(table, /^[a-z_][a-z0-9_]*$/, 'Owner schema has no table to probe');

    const denied = {
      'create-table-app': 'CREATE TABLE app.cw_ddl_probe (i int)',
      'create-table-public': 'CREATE TABLE public.cw_ddl_probe (i int)',
      'create-schema': 'CREATE SCHEMA cw_ddl_probe',
      'alter-table': `ALTER TABLE app."${table}" ADD COLUMN cw_ddl_probe int`,
      'drop-table': `DROP TABLE app."${table}"`,
      truncate: `TRUNCATE app."${table}"`,
      'read-migration-history': 'SELECT count(*) FROM app._prisma_migrations',
      'set-role-migrate': `SET ROLE cw_${service}_migrate`,
      'create-function': 'CREATE FUNCTION app.cw_probe() RETURNS int LANGUAGE sql AS $$SELECT 1$$',
    };
    const ddl = {};
    for (const [name, sql] of Object.entries(denied)) {
      const result = await psql('app', sql);
      ddl[name] =
        result.code !== 0 && /permission denied|must be owner|must be member/i.test(result.stderr)
          ? 'DENIED'
          : `NOT_DENIED (${result.code}) ${result.stderr.slice(0, 200)}`;
    }
    record(
      'runtime-ddl-denied',
      Object.values(ddl).every((v) => v === 'DENIED'),
      { probes: ddl },
    );

    const dml = await psql('app', `SELECT count(*) FROM app."${table}"`);
    record('runtime-dml-allowed', dml.code === 0, { table });

    await psql(
      'migrate',
      "INSERT INTO app._prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('cw-ahead-probe', repeat('0',64), '99999999999999_from_a_newer_release', now(), now(), 1)",
    );
    const ahead = await job('verify');
    record(
      'detect-database-ahead',
      ahead.code === 1 &&
        ahead.events.some((e) => e.problems?.some((p) => p.code === 'DATABASE_AHEAD_OF_IMAGE')),
    );
    await psql('migrate', "DELETE FROM app._prisma_migrations WHERE id = 'cw-ahead-probe'");

    await psql('migrate', `ALTER TABLE app."${table}" ADD COLUMN cw_drift_probe int`);
    const drift = await job('verify');
    const driftResult = drift.events.find((e) => e.event === 'migration-job.result');
    record('detect-schema-drift', drift.code === 1 && driftResult?.schemaDrift === 'DRIFT');
    await psql('migrate', `ALTER TABLE app."${table}" DROP COLUMN cw_drift_probe`);
    const clean = await job('verify');
    record('verify-after-repair', clean.code === 0);

    const user = await dockerOk([
      'image',
      'inspect',
      '--format',
      '{{.Config.User}}|{{json .Config.Entrypoint}}',
      artifact.reference,
    ]);
    record('job-sandbox', user === '1000:1000|["node","/migrate/migrate-job.mjs"]', { user });
  } finally {
    await docker(['rm', '-f', pg]);
    await docker(['network', 'rm', network]);
    rmSync(work, { recursive: true, force: true });
  }

  const report = {
    service,
    reference: artifact.reference,
    postgresImage,
    sourceSha: part.source.sha,
    migrationSet: artifact.migrationSet,
    accepted: cases.length > 0 && cases.every((c) => c.status === 'PASS'),
    cases,
    scope: {
      proves:
        'the published migration job by digest against a real PostgreSQL 16 with the production role model',
      doesNotProve: 'TLS to a managed database, populated upgrade, backup/restore (P07-E2/E3)',
    },
  };
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const partFile = option(argv, 'manifest-part');
  const reportFile = option(argv, 'report');
  assert.ok(partFile && reportFile, '--manifest-part and --report are required');
  rehearse({ part: JSON.parse(readFileSync(partFile, 'utf8')), reportFile })
    .then((report) => process.exit(report.accepted ? 0 : 1))
    .catch((error) => {
      console.error(error.stack ?? error.message);
      process.exit(1);
    });
}
