#!/usr/bin/env node
/**
 * One-shot migration job for a single database owner (P07-E1).
 *
 * Runs inside the owner's migration image (infra/release/Dockerfile.migrate).
 * It is the ONLY accepted way a release changes a schema; runtime replicas never
 * migrate on start-up.
 *
 *   node migrate-job.mjs deploy   apply pending migrations, harden, verify
 *   node migrate-job.mjs verify   read-only: history + deployed-schema drift
 *
 * Fail-closed rules:
 *   - the DSN comes only from MIGRATION_DATABASE_URL_FILE (a mounted secret);
 *     a plaintext DATABASE_URL in the environment is refused,
 *   - the DSN must name exactly this owner's migration role and database
 *     (cw_<svc>_migrate on cw_<svc>, schema "app"); a runtime role, a superuser
 *     or another owner's database is refused before any connection is made,
 *   - TLS is required unless the operator explicitly declares a loopback
 *     rehearsal, and the evidence records which one it was,
 *   - an applied migration whose checksum differs from the image, a failed or
 *     rolled-back migration, or a migration in the database that this image does
 *     not know (an older job against a newer schema) all stop the job,
 *   - after deploy, the deployed schema must equal schema.prisma (no drift).
 *
 * The DSN and password never reach stdout/stderr: child output is redacted.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT = Object.freeze({ OK: 0, FAILED: 1, REFUSED: 3 });

const SERVICE_PATTERN = /^[a-z][a-z0-9]*$/;
const TLS_MODES = new Set(['require', 'verify-ca', 'verify-full']);
const MAX_SECRET_BYTES = 4096;

export class JobRefused extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** Reads the DSN from the mounted secret file; never from a plain env value. */
export function readMigrationDsn(env, readFile = readFileSync, stat = statSync) {
  if (env.DATABASE_URL !== undefined) throw new JobRefused('PLAINTEXT_DATABASE_URL_REFUSED');
  const file = env.MIGRATION_DATABASE_URL_FILE;
  if (!file) throw new JobRefused('MIGRATION_DATABASE_URL_FILE_REQUIRED');
  if (!path.isAbsolute(file)) throw new JobRefused('SECRET_FILE_NOT_ABSOLUTE');
  const info = stat(file);
  if (!info.isFile()) throw new JobRefused('SECRET_FILE_NOT_REGULAR');
  if (info.size === 0 || info.size > MAX_SECRET_BYTES) throw new JobRefused('SECRET_FILE_SIZE');
  const lines = readFile(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) throw new JobRefused('SECRET_FILE_MUST_HOLD_ONE_DSN');
  return lines[0];
}

/**
 * Accepts only this owner's migration identity. Returns the parsed identity
 * without the password so it can be logged.
 */
export function assertMigrationIdentity(dsn, service, { tlsMode = 'required' } = {}) {
  if (!SERVICE_PATTERN.test(service ?? '')) throw new JobRefused('SERVICE_INVALID');
  let url;
  try {
    url = new URL(dsn);
  } catch {
    throw new JobRefused('DSN_UNPARSEABLE');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new JobRefused('DSN_PROTOCOL');
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const expectedUser = `cw_${service}_migrate`;
  const expectedDatabase = `cw_${service}`;
  if (user !== expectedUser) {
    throw new JobRefused('NOT_THIS_OWNERS_MIGRATION_IDENTITY', { user, expected: expectedUser });
  }
  if (database !== expectedDatabase) {
    throw new JobRefused('NOT_THIS_OWNERS_DATABASE', { database, expected: expectedDatabase });
  }
  if (!url.password) throw new JobRefused('DSN_PASSWORD_REQUIRED');
  if (url.searchParams.get('schema') !== 'app') throw new JobRefused('DSN_SCHEMA_MUST_BE_APP');
  const sslmode = url.searchParams.get('sslmode');
  if (tlsMode === 'required') {
    if (!TLS_MODES.has(sslmode ?? '')) throw new JobRefused('DSN_TLS_REQUIRED', { sslmode });
  } else if (tlsMode !== 'disabled-rehearsal') {
    throw new JobRefused('TLS_MODE_INVALID', { tlsMode });
  }
  return {
    user,
    database,
    host: url.hostname,
    port: url.port || '5432',
    tls: tlsMode === 'required' ? sslmode : 'disabled (declared rehearsal)',
    appRole: `cw_${service}_app`,
  };
}

/** Removes every secret-bearing fragment from text that may be persisted. */
export function redactor(dsn) {
  const secrets = [];
  try {
    const url = new URL(dsn);
    if (url.password) {
      secrets.push(url.password, decodeURIComponent(url.password));
    }
  } catch {
    // An unparseable DSN was already refused; still redact the raw value.
  }
  secrets.push(dsn);
  const unique = [...new Set(secrets.filter((s) => s.length >= 4))].sort(
    (a, b) => b.length - a.length,
  );
  return (text) => {
    let out = String(text ?? '');
    for (const secret of unique) out = out.split(secret).join('[REDACTED]');
    return out.replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, 'postgresql://[REDACTED]');
  };
}

/** Local migration directories with the sha256 Prisma records as `checksum`. */
export function localMigrations(migrationsDir) {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(migrationsDir, name, 'migration.sql'));
      return { name, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

/**
 * Compares the image's migrations with `_prisma_migrations` rows.
 * `phase` is 'before' (pending allowed) or 'after' (everything applied).
 */
export function assessHistory(local, rows, phase) {
  const problems = [];
  const byName = new Map(local.map((m) => [m.name, m]));
  const applied = new Map();
  for (const row of rows) {
    if (row.rolled_back_at) {
      problems.push({ code: 'ROLLED_BACK_MIGRATION_PRESENT', migration: row.migration_name });
      continue;
    }
    if (!row.finished_at) {
      problems.push({ code: 'FAILED_OR_RUNNING_MIGRATION', migration: row.migration_name });
      continue;
    }
    const known = byName.get(row.migration_name);
    if (!known) {
      problems.push({ code: 'DATABASE_AHEAD_OF_IMAGE', migration: row.migration_name });
      continue;
    }
    if (known.checksum !== row.checksum) {
      problems.push({ code: 'APPLIED_MIGRATION_MODIFIED', migration: row.migration_name });
    }
    applied.set(row.migration_name, row);
  }
  const pending = local.filter((m) => !applied.has(m.name)).map((m) => m.name);
  if (phase === 'after' && pending.length > 0) {
    problems.push({ code: 'MIGRATIONS_NOT_APPLIED', migrations: pending });
  }
  return { applied: [...applied.keys()].sort(), pending, problems };
}

/** Owner-executable hardening: the migration role owns every object it grants. */
export function hardeningSql(service) {
  const app = `cw_${service}_app`;
  const db = `cw_${service}`;
  return `
REVOKE ALL ON TABLE app._prisma_migrations FROM PUBLIC, "${app}";
REVOKE CREATE ON SCHEMA app FROM PUBLIC, "${app}";
REVOKE ALL ON DATABASE "${db}" FROM PUBLIC;
GRANT CONNECT ON DATABASE "${db}" TO "${app}";
DO $$
DECLARE history_table text;
BEGIN
  IF current_database() = 'cw_configuration' THEN
    FOREACH history_table IN ARRAY ARRAY['config_revision', 'config_review', 'config_audit'] LOOP
      IF to_regclass('app.' || history_table) IS NOT NULL THEN
        EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE app.%I FROM %I', history_table, '${app}');
      END IF;
    END LOOP;
  END IF;
END
$$;`;
}

function emit(event, payload) {
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...payload })}\n`);
}

function prisma(args, dsn, redact, root) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'node_modules', 'prisma', 'build', 'index.js'), ...args],
      {
        cwd: root,
        // A minimal environment: nothing from the job's env leaks into Prisma
        // except what it needs, and the DSN is passed only to the child.
        env: {
          PATH: process.env.PATH ?? '',
          HOME: '/tmp',
          DATABASE_URL: dsn,
          PRISMA_HIDE_UPDATE_MESSAGE: '1',
          CHECKPOINT_DISABLE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output: redact(out).slice(-8000) });
    });
  });
}

async function history(client) {
  const exists = await client.query(
    "SELECT to_regclass('app._prisma_migrations') IS NOT NULL AS present",
  );
  if (!exists.rows[0].present) return [];
  const result = await client.query(
    'SELECT migration_name, checksum, finished_at, rolled_back_at FROM app._prisma_migrations ORDER BY migration_name',
  );
  return result.rows;
}

export async function runJob(
  mode,
  env = process.env,
  root = path.dirname(fileURLToPath(import.meta.url)),
) {
  const service = env.CW_SERVICE;
  const dsn = readMigrationDsn(env);
  const redact = redactor(dsn);
  const identity = assertMigrationIdentity(dsn, service, {
    tlsMode: env.MIGRATION_DB_TLS ?? 'required',
  });
  if (!['deploy', 'verify'].includes(mode)) throw new JobRefused('MODE_INVALID', { mode });
  const migrationsDir = path.join(root, 'prisma', 'migrations');
  if (!existsSync(migrationsDir)) throw new JobRefused('MIGRATIONS_MISSING');
  const local = localMigrations(migrationsDir);
  emit('migration-job.start', { service, mode, identity, migrations: local.length });

  const require = createRequire(path.join(root, 'package.json'));
  const { Client } = require('pg');
  const client = new Client({ connectionString: dsn, statement_timeout: 120_000 });
  await client.connect();
  try {
    const who = await client.query('SELECT current_user AS u, current_database() AS d');
    if (who.rows[0].u !== identity.user || who.rows[0].d !== identity.database) {
      throw new JobRefused('SESSION_IDENTITY_MISMATCH');
    }
    const before = assessHistory(local, await history(client), 'before');
    if (before.problems.length > 0) {
      emit('migration-job.refused', { service, phase: 'before', problems: before.problems });
      return EXIT.FAILED;
    }

    if (mode === 'deploy') {
      const deployed = await prisma(['migrate', 'deploy'], dsn, redact, root);
      emit('migration-job.prisma-deploy', {
        service,
        exitCode: deployed.code,
        output: deployed.output,
      });
      if (deployed.code !== 0) return EXIT.FAILED;
      await client.query(hardeningSql(service));
    }

    const after = assessHistory(local, await history(client), 'after');
    const drift = await prisma(
      [
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        path.join('prisma', 'schema.prisma'),
        '--exit-code',
      ],
      dsn,
      redact,
      root,
    );
    const driftStatus = { 0: 'NONE', 2: 'DRIFT' }[drift.code] ?? 'ERROR';
    const ok = after.problems.length === 0 && driftStatus === 'NONE';
    emit('migration-job.result', {
      service,
      mode,
      status: ok ? 'PASS' : 'FAIL',
      appliedBefore: before.applied,
      appliedNow: after.applied.filter((name) => !before.applied.includes(name)),
      applied: after.applied,
      problems: after.problems,
      schemaDrift: driftStatus,
      driftOutput: driftStatus === 'NONE' ? undefined : drift.output,
    });
    return ok ? EXIT.OK : EXIT.FAILED;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runJob(process.argv[2] ?? 'deploy')
    .then((code) => process.exit(code))
    .catch((error) => {
      if (error instanceof JobRefused) {
        emit('migration-job.refused', { code: error.code, detail: error.detail });
        process.exit(EXIT.REFUSED);
      }
      // Never print a raw stack that could embed a connection string.
      emit('migration-job.error', {
        code: 'UNEXPECTED',
        message: String(error?.message ?? error).replace(
          /postgres(?:ql)?:\/\/[^\s'"]+/g,
          'postgresql://[REDACTED]',
        ),
      });
      process.exit(EXIT.FAILED);
    });
}
