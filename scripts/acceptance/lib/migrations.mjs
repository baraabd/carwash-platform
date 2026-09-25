/**
 * Migration execution.
 *
 * Migrations are a SEPARATE JOB run by a SEPARATE IDENTITY. Application replicas
 * never call any of this: a service that migrates its own schema on startup
 * turns a rolling deploy into a race between replicas and makes a rollback
 * unpredictable.
 *
 * After the schema exists, privileges are hardened: the application role gets
 * DML on the service's tables (via the migration role's default privileges) and
 * is then explicitly stripped of any access to _prisma_migrations, so it cannot
 * rewrite migration history to hide or fake a schema change.
 */
import path from 'node:path';
import { run, runOrThrow } from './exec.mjs';
import { migrationDsn } from './context.mjs';
import { psqlBootstrap } from './infra.mjs';

function prismaBin(context, service) {
  return path.join(
    context.root,
    'services',
    service,
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );
}

function serviceDir(context, service) {
  return path.join(context.root, 'services', service);
}

export async function migrateDeploy(context, service, options = {}) {
  return run(process.execPath, [prismaBin(context, service), 'migrate', 'deploy'], {
    cwd: serviceDir(context, service),
    env: { ...process.env, DATABASE_URL: migrationDsn(context, service) },
    timeoutMs: options.timeoutMs ?? 5 * 60 * 1000,
    signal: options.signal,
  });
}

export async function migrateStatus(context, service, options = {}) {
  return run(process.execPath, [prismaBin(context, service), 'migrate', 'status'], {
    cwd: serviceDir(context, service),
    env: { ...process.env, DATABASE_URL: migrationDsn(context, service) },
    timeoutMs: options.timeoutMs ?? 3 * 60 * 1000,
    signal: options.signal,
  });
}

/**
 * Schema/migration consistency: replaying the committed migrations must produce
 * exactly the datamodel in schema.prisma. --exit-code makes "empty diff" 0 and
 * "there is a difference" 2, so drift cannot pass unnoticed.
 */
export async function migrationDrift(context, service, options = {}) {
  return run(
    process.execPath,
    [
      prismaBin(context, service),
      'migrate',
      'diff',
      '--from-migrations',
      path.join('prisma', 'migrations'),
      '--to-schema',
      path.join('prisma', 'schema.prisma'),
      '--exit-code',
    ],
    {
      cwd: serviceDir(context, service),
      // Prisma 7 takes the shadow database from the config file, which reads it
      // from the environment; there is no --shadow-database-url flag on `diff`.
      // Replaying migrations needs a throwaway database, so it is created by the
      // bootstrap superuser rather than by giving the migration role CREATEDB.
      env: {
        ...process.env,
        DATABASE_URL: migrationDsn(context, service),
        SHADOW_DATABASE_URL: options.shadowUrl,
      },
      timeoutMs: options.timeoutMs ?? 5 * 60 * 1000,
      signal: options.signal,
    },
  );
}

/**
 * Privilege hardening that must happen AFTER the tables exist.
 *
 * Default privileges cover tables the migration role creates from here on, but
 * _prisma_migrations is one of them, and the application account has no business
 * touching migration history. Revoking it is the difference between "the app
 * cannot change the schema" and "the app cannot change the schema or lie about
 * having changed it".
 */
export async function hardenPrivileges(context, service, options = {}) {
  const app = `cw_${service}_app`;
  const sql = `
DO $$
BEGIN
  -- Fail loudly rather than silently leaving the grant in place.
  IF to_regclass('app._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_TABLE_MISSING';
  END IF;
END
$$;

REVOKE ALL ON TABLE app._prisma_migrations FROM "${app}";

-- Belt and braces: no CREATE anywhere for the application identity.
REVOKE CREATE ON SCHEMA app FROM "${app}";
REVOKE CREATE ON SCHEMA public FROM "${app}";
REVOKE ALL ON DATABASE cw_${service} FROM "${app}";
GRANT CONNECT ON DATABASE cw_${service} TO "${app}";
`;
  return psqlBootstrap(context, `cw_${service}`, sql, options);
}

/** Written by the migration job so a test can prove the job actually ran. */
export async function stampServiceMarker(context, service, schemaRev, options = {}) {
  const sql = `
INSERT INTO app.service_marker (service, schema_rev, created_at)
VALUES ('${service}', ${Number(schemaRev)}, now())
ON CONFLICT (service) DO UPDATE SET schema_rev = EXCLUDED.schema_rev;
`;
  return run(
    process.execPath,
    [path.join(context.root, 'scripts', 'acceptance', 'lib', 'psql-runner.mjs')],
    {
      cwd: context.root,
      env: {
        ...process.env,
        CW_PSQL_URL: migrationDsn(context, service),
        CW_PSQL_SQL: sql,
      },
      timeoutMs: options.timeoutMs ?? 2 * 60 * 1000,
      signal: options.signal,
    },
  );
}

export async function createShadowDatabase(context, name) {
  // Created by the bootstrap superuser, never by a migration role: keeping
  // CREATEDB off the migration role is part of the isolation model.
  const created = await psqlBootstrap(
    context,
    'postgres',
    `DROP DATABASE IF EXISTS ${name}; CREATE DATABASE ${name};`,
  );
  if (created.code !== 0) {
    const error = new Error('SHADOW_DATABASE_CREATE_FAILED');
    error.result = created;
    throw error;
  }

  // The shadow database must mirror the REAL layout, including the schema the
  // services live in. Without it, replayed migrations land in `public` while the
  // datamodel resolves to `app`, and the comparison reports a difference that is
  // pure schema qualification rather than actual drift.
  const prepared = await psqlBootstrap(context, name, 'CREATE SCHEMA IF NOT EXISTS app;');
  if (prepared.code !== 0) {
    const error = new Error('SHADOW_DATABASE_PREPARE_FAILED');
    error.result = prepared;
    throw error;
  }

  return `postgresql://cw_acceptance_bootstrap:${encodeURIComponent(
    context.credentials.postgresBootstrap,
  )}@127.0.0.1:${context.ports.postgres}/${name}?schema=app`;
}

export async function dropShadowDatabase(context, name) {
  return psqlBootstrap(context, 'postgres', `DROP DATABASE IF EXISTS ${name};`);
}

export { runOrThrow };
