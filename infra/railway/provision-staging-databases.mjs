/* global Bun -- Railway one-shot Bun function; no HTTP endpoint and no secret output. */
/**
 * Staging bootstrap only. The platform supplies the bootstrap URL by reference.
 * Runtime replicas never receive it. Each owner gets two independent passwords.
 * This creates roles/databases/schema grants, not application migrations or data.
 */
const OWNERS = [
  'identity',
  'customer',
  'vehicle',
  'catalog',
  'pricing',
  'workforce',
  'scheduling',
  'booking',
  'dispatch',
  'billing',
  'wallet',
  'subscription',
  'media',
  'communications',
  'support',
  'reviews',
  'reporting',
  'geo',
  'configuration',
];
const EXPECTED_PROJECT = '7aa96062-f337-4d69-92c6-2af61c9348db';
const EXPECTED_ENVIRONMENT = '2bfd91fb-ae06-4c71-a267-913fa123699b';
const fail = (code) => {
  throw new Error(code);
};
let step = 'configuration';
let owner = null;
let bootstrap;
try {
  if (
    Bun.env.RAILWAY_PROJECT_ID !== EXPECTED_PROJECT ||
    Bun.env.RAILWAY_ENVIRONMENT_ID !== EXPECTED_ENVIRONMENT ||
    Bun.env.CW_PROVISION_SCOPE !== 'carwash-staging-initial-20261127'
  )
    fail('WRONG_BOOTSTRAP_SCOPE');
  const root = new URL(Bun.env.BOOTSTRAP_DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(root.protocol) ||
    !/^[a-z][a-z0-9-]*\.railway\.internal$/.test(root.hostname) ||
    root.pathname !== '/platform_bootstrap' ||
    root.username !== 'platform_bootstrap'
  )
    fail('INVALID_BOOTSTRAP_DATABASE');
  for (const service of OWNERS) {
    for (const suffix of ['DB_PASSWORD', 'MIGRATION_PASSWORD']) {
      if (!/^[A-Za-z0-9_-]{48,128}$/.test(Bun.env[`${service.toUpperCase()}_${suffix}`] ?? ''))
        fail('OWNER_PASSWORD_REQUIRED');
    }
  }
  bootstrap = new Bun.SQL(root.toString(), { max: 1, connectionTimeout: 15 });
  const version =
    await bootstrap`SELECT current_user AS actor, current_setting('server_version_num') AS version`;
  if (
    version[0].actor !== 'platform_bootstrap' ||
    Number(version[0].version) < 160000 ||
    Number(version[0].version) >= 170000
  )
    fail('POSTGRES_16_REQUIRED');
  for (const service of OWNERS) {
    owner = service;
    step = 'roles';
    const database = `cw_${service}`;
    const app = `${database}_app`;
    const migrate = `${database}_migrate`;
    // Names are closed constants, passwords are constrained to base64url above.
    for (const [role, suffix] of [
      [app, 'DB_PASSWORD'],
      [migrate, 'MIGRATION_PASSWORD'],
    ]) {
      const found =
        await bootstrap`SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = ${role}`;
      if (!found.length)
        await bootstrap.unsafe(
          `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '${Bun.env[`${service.toUpperCase()}_${suffix}`]}'`,
        );
      else if (
        found[0].rolsuper ||
        found[0].rolcreatedb ||
        found[0].rolcreaterole ||
        found[0].rolreplication ||
        found[0].rolbypassrls
      )
        fail('UNEXPECTED_ROLE_PRIVILEGES');
      const memberships =
        await bootstrap`SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = ${role}`;
      if (memberships.length) fail('UNEXPECTED_ROLE_MEMBERSHIP');
    }
    step = 'database';
    const found =
      await bootstrap`SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = ${database}`;
    if (!found.length) await bootstrap.unsafe(`CREATE DATABASE "${database}" OWNER "${migrate}"`);
    else if (found[0].owner !== migrate) fail('UNEXPECTED_DATABASE_OWNER');
    await bootstrap.unsafe(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await bootstrap.unsafe(`GRANT CONNECT ON DATABASE "${database}" TO "${app}"`);
    await bootstrap.unsafe(`GRANT CONNECT, TEMPORARY ON DATABASE "${database}" TO "${migrate}"`);
    step = 'schema';
    const connection = new URL(root);
    connection.pathname = `/${database}`;
    const sql = new Bun.SQL(connection.toString(), { max: 1, connectionTimeout: 15 });
    try {
      await sql.unsafe('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      const schema =
        await sql`SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'app'`;
      if (schema.length && schema[0].owner !== migrate) fail('UNEXPECTED_SCHEMA_OWNER');
      await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION "${migrate}"`);
      await sql.unsafe(`GRANT USAGE ON SCHEMA app TO "${app}"`);
      await sql.unsafe(`REVOKE CREATE ON SCHEMA app FROM "${app}"`);
      await sql.unsafe(
        `ALTER DEFAULT PRIVILEGES FOR ROLE "${migrate}" IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${app}"`,
      );
      await sql.unsafe(
        `ALTER DEFAULT PRIVILEGES FOR ROLE "${migrate}" IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO "${app}"`,
      );
      await sql.unsafe(
        `ALTER DEFAULT PRIVILEGES FOR ROLE "${migrate}" IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC`,
      );
      const privileges =
        await sql`SELECT has_schema_privilege(${app}, 'app', 'USAGE') AS usage, has_schema_privilege(${app}, 'app', 'CREATE') AS create`;
      if (!privileges[0].usage || privileges[0].create) fail('SCHEMA_PRIVILEGE_MISMATCH');
    } finally {
      await sql.close({ timeout: 5 });
    }
  }
  step = 'isolation';
  for (const service of OWNERS)
    for (const other of OWNERS) {
      const role = `cw_${service}_app`;
      const database = `cw_${other}`;
      const access =
        await bootstrap`SELECT has_database_privilege(${role}, ${database}, 'CONNECT') AS allowed`;
      if (access[0].allowed !== (service === other)) fail('CROSS_OWNER_CONNECT');
    }
  console.log(
    JSON.stringify({
      kind: 'carwash.staging.database-provisioning.v1',
      projectId: EXPECTED_PROJECT,
      environmentId: EXPECTED_ENVIRONMENT,
      accepted: true,
      postgresVersion: version[0].version,
      owners: OWNERS,
      databaseIsolationChecks: OWNERS.length ** 2,
      migrationsApplied: false,
      applicationAccepted: false,
      completedAt: new Date().toISOString(),
    }),
  );
} catch (error) {
  // SQL errors can contain credential-bearing statements. Retain only a closed code.
  const code = /^[A-Z_]{3,64}$/.test(error?.message ?? '')
    ? error.message
    : 'DATABASE_PROVISIONING_FAILED';
  console.error(
    JSON.stringify({
      kind: 'carwash.staging.database-provisioning.v1',
      accepted: false,
      step,
      owner,
      code,
    }),
  );
  process.exitCode = 1;
} finally {
  if (bootstrap) await bootstrap.close({ timeout: 5 });
}
