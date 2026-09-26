import test from 'node:test';
import assert from 'node:assert/strict';
import { context, migrationDsn, sql } from './_support.mjs';

/**
 * Privilege-level isolation proof, asked of the server's own catalogue.
 *
 * `postgres-isolation.test.mjs` proves cross-service denial by ATTEMPTING a
 * connection and being refused. That is the stronger guarantee in practice - a
 * role that cannot connect cannot read a table either - but it also means the
 * SELECT/INSERT/UPDATE/DELETE case can never be observed directly, because the
 * attempt dies at the door.
 *
 * So this suite asks a different question, from inside each database, using
 * PostgreSQL's own privilege functions: does role X hold ANY privilege on
 * service Y's objects? `has_table_privilege` and friends answer from the same
 * catalogue the executor consults, so a "no" here is the server's answer and not
 * an inference from a failed connection.
 *
 * Together the two suites cover the boundary from both sides: the door is shut,
 * and there is nothing granted behind it either.
 *
 * Every query is read-only. Nothing here mutates a database.
 */

const SERVICES = context.services;

/**
 * The SERVICE identities, listed explicitly from the catalogue.
 *
 * Deliberately not a `LIKE 'cw\_%'` pattern. That pattern also matches
 * `cw_acceptance_bootstrap`, the disposable superuser that provisions the
 * cluster, which legitimately holds everything everywhere - so a pattern-based
 * filter reports the provisioner as a cross-service violation in every database.
 * It is excluded here because it is not a service identity and never appears in a
 * service's connection string; what constrains it is that it exists only inside
 * the throwaway acceptance container.
 */
const SERVICE_ROLES = SERVICES.flatMap((service) => [`cw_${service}_app`, `cw_${service}_migrate`]);

/** A SQL array literal of every service role, safe because all names are ours. */
const ALL_SERVICE_ROLES = `ARRAY[${SERVICE_ROLES.map((role) => `'${role}'`).join(',')}]`;

/** Service roles that do NOT belong to `service`. */
function foreignRolesSql(service) {
  const foreign = SERVICE_ROLES.filter(
    (role) => role !== `cw_${service}_app` && role !== `cw_${service}_migrate`,
  );
  return `ARRAY[${foreign.map((role) => `'${role}'`).join(',')}]`;
}

/**
 * `has_*_privilege` throws for a role that does not exist, which would look like
 * a test error rather than a pass. Asserting presence first makes a missing role a
 * clear failure instead of a confusing one.
 */
async function assertRolesExist(service) {
  const result = await sql(
    migrationDsn(context, service),
    `SELECT rolname FROM pg_roles WHERE rolname = ANY(${ALL_SERVICE_ROLES}) ORDER BY rolname`,
  );
  assert.equal(result.ok, true, result.message ?? '');
  assert.equal(
    result.rows.length,
    SERVICE_ROLES.length,
    `expected ${SERVICE_ROLES.length} service roles, found ${result.rows.length}`,
  );
}

for (const service of SERVICES) {
  const foreign = foreignRolesSql(service);

  test(`${service}: no foreign role holds any table privilege in this database`, async () => {
    await assertRolesExist(service);

    /*
     * Cross-join every foreign role against every table in the owned schema and
     * ask the server for each of the four DML privileges. One row per violation,
     * so a failure names exactly which role holds what on which table.
     */
    const result = await sql(
      migrationDsn(context, service),
      `SELECT r.rolname, t.tablename, p.priv
         FROM pg_tables t
         CROSS JOIN pg_roles r
         CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
        WHERE t.schemaname = 'app'
          AND r.rolname = ANY(${foreign})
          AND has_table_privilege(r.rolname, format('app.%I', t.tablename), p.priv)`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.deepEqual(
      result.rows,
      [],
      `foreign roles hold table privileges in ${service}: ${JSON.stringify(result.rows)}`,
    );
  });

  test(`${service}: no foreign role holds schema USAGE or CREATE in this database`, async () => {
    // USAGE would let a foreign role resolve object names; CREATE would let it
    // add objects into a schema it does not own.
    const result = await sql(
      migrationDsn(context, service),
      `SELECT r.rolname, n.nspname, p.priv
         FROM pg_namespace n
         CROSS JOIN pg_roles r
         CROSS JOIN (VALUES ('USAGE'), ('CREATE')) AS p(priv)
        WHERE n.nspname IN ('app', 'public')
          AND r.rolname = ANY(${foreign})
          AND has_schema_privilege(r.rolname, n.nspname, p.priv)`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.deepEqual(
      result.rows,
      [],
      `foreign roles hold schema privileges in ${service}: ${JSON.stringify(result.rows)}`,
    );
  });

  test(`${service}: no foreign role holds any sequence privilege in this database`, async () => {
    // A writable sequence is a write primitive: it would let a foreign role
    // consume or reset identifier allocation for tables it cannot even read.
    const result = await sql(
      migrationDsn(context, service),
      `SELECT r.rolname, c.relname, p.priv
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN pg_roles r
         CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS p(priv)
        WHERE c.relkind = 'S'
          AND n.nspname = 'app'
          AND r.rolname = ANY(${foreign})
          AND has_sequence_privilege(r.rolname, c.oid, p.priv)`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.deepEqual(result.rows, [], JSON.stringify(result.rows));
  });

  test(`${service}: no foreign role may EXECUTE a function in the owned schema`, async () => {
    const result = await sql(
      migrationDsn(context, service),
      `SELECT r.rolname, p.proname
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN pg_roles r
        WHERE n.nspname = 'app'
          AND r.rolname = ANY(${foreign})
          AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.deepEqual(result.rows, [], JSON.stringify(result.rows));
  });

  test(`${service}: no foreign role may CONNECT to this database`, async () => {
    // The same fact the isolation suite proves by being refused, asserted here
    // from the catalogue so the two agree.
    const result = await sql(
      migrationDsn(context, service),
      `SELECT r.rolname
         FROM pg_roles r
        WHERE r.rolname = ANY(${foreign})
          AND has_database_privilege(r.rolname, current_database(), 'CONNECT')`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.deepEqual(
      result.rows,
      [],
      `foreign roles may connect to ${service}: ${JSON.stringify(result.rows)}`,
    );
  });

  test(`${service}: the runtime role holds DML but no DDL-capable privilege`, async () => {
    /*
     * The positive half. Proving only denials would pass just as well if the role
     * had no privileges at all and the service were simply broken, so the grant
     * the application actually needs is asserted too.
     */
    const result = await sql(
      migrationDsn(context, service),
      `SELECT
         has_table_privilege('cw_${service}_app', 'app.service_marker', 'SELECT') AS can_select,
         has_table_privilege('cw_${service}_app', 'app.service_marker', 'INSERT') AS can_insert,
         has_table_privilege('cw_${service}_app', 'app.service_marker', 'UPDATE') AS can_update,
         has_table_privilege('cw_${service}_app', 'app.service_marker', 'DELETE') AS can_delete,
         has_table_privilege('cw_${service}_app', 'app.service_marker', 'TRUNCATE') AS can_truncate,
         has_table_privilege('cw_${service}_app', 'app.service_marker', 'REFERENCES') AS can_reference,
         has_schema_privilege('cw_${service}_app', 'app', 'USAGE') AS schema_usage,
         has_schema_privilege('cw_${service}_app', 'app', 'CREATE') AS schema_create`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    const row = result.rows[0];
    assert.equal(row.can_select, true, 'the application must be able to read its own tables');
    assert.equal(row.can_insert, true);
    assert.equal(row.can_update, true);
    assert.equal(row.can_delete, true);
    assert.equal(row.schema_usage, true, 'the application must be able to resolve its own objects');

    // TRUNCATE and REFERENCES are owner-level: one destroys data without a WHERE
    // clause, the other can add a constraint. CREATE on the schema would be DDL.
    assert.equal(row.can_truncate, false, 'TRUNCATE is not DML and must not be granted');
    assert.equal(row.can_reference, false, 'REFERENCES would let the app alter constraints');
    assert.equal(row.schema_create, false, 'CREATE on the schema would permit DDL');
  });

  test(`${service}: the runtime role cannot read the migration history`, async () => {
    // Asserted from the catalogue as well as by attempt, because this one is
    // easy to re-grant by accident: `GRANT ... ON ALL TABLES IN SCHEMA app`
    // includes _prisma_migrations unless it is revoked afterwards.
    const result = await sql(
      migrationDsn(context, service),
      `SELECT p.priv
         FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
        WHERE has_table_privilege('cw_${service}_app', 'app._prisma_migrations', p.priv)`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.deepEqual(
      result.rows,
      [],
      `the ${service} runtime role holds ${JSON.stringify(result.rows)} on _prisma_migrations`,
    );
  });
}

test('no service role is a member of any other role, so SET ROLE has no target', async () => {
  // Membership is the escalation path that role ATTRIBUTES do not show: a role
  // with no CREATEROLE and no superuser flag can still become another identity
  // if it was granted membership in it.
  const result = await sql(
    migrationDsn(context, 'catalog'),
    `SELECT grantee.rolname AS member, granted.rolname AS granted_role
       FROM pg_auth_members m
       JOIN pg_roles grantee ON grantee.oid = m.member
       JOIN pg_roles granted ON granted.oid = m.roleid
      WHERE grantee.rolname = ANY(${ALL_SERVICE_ROLES})`,
  );
  assert.equal(result.ok, true, result.message ?? '');
  assert.deepEqual(result.rows, [], `unexpected role membership: ${JSON.stringify(result.rows)}`);
});

test('no service role can inherit privileges implicitly', async () => {
  // NOINHERIT is what makes the membership check above complete: with INHERIT, a
  // future accidental GRANT would take effect without anyone calling SET ROLE.
  const result = await sql(
    migrationDsn(context, 'catalog'),
    `SELECT rolname FROM pg_roles WHERE rolname = ANY(${ALL_SERVICE_ROLES}) AND rolinherit`,
  );
  assert.equal(result.ok, true, result.message ?? '');
  assert.deepEqual(
    result.rows,
    [],
    `these roles would inherit granted privileges: ${JSON.stringify(result.rows)}`,
  );
});

test('no service role carries a cluster-wide capability', async () => {
  const result = await sql(
    migrationDsn(context, 'catalog'),
    `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       FROM pg_roles
      WHERE rolname = ANY(${ALL_SERVICE_ROLES})
        AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)`,
  );
  assert.equal(result.ok, true, result.message ?? '');
  assert.deepEqual(
    result.rows,
    [],
    `privileged service roles found: ${JSON.stringify(result.rows)}`,
  );
});

test('every service role can log in, so the denials are not an artefact of a dead role', async () => {
  // Without this, every denial above would also pass if the roles had been
  // created unable to connect at all.
  const result = await sql(
    migrationDsn(context, 'catalog'),
    `SELECT rolname FROM pg_roles WHERE rolname = ANY(${ALL_SERVICE_ROLES}) AND NOT rolcanlogin`,
  );
  assert.equal(result.ok, true, result.message ?? '');
  assert.deepEqual(result.rows, [], `roles that cannot log in: ${JSON.stringify(result.rows)}`);
});

test('PUBLIC holds no privilege on any service database', async () => {
  // PUBLIC is the grant everyone forgets: a privilege held by PUBLIC is held by
  // every current and future role, including every other service's.
  for (const service of SERVICES) {
    const result = await sql(
      migrationDsn(context, service),
      `SELECT
         has_database_privilege('public', current_database(), 'CONNECT') AS db_connect,
         has_schema_privilege('public', 'app', 'USAGE') AS app_usage,
         has_schema_privilege('public', 'public', 'CREATE') AS public_create`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    const row = result.rows[0];
    assert.equal(row.db_connect, false, `PUBLIC may connect to ${service}`);
    assert.equal(row.app_usage, false, `PUBLIC has USAGE on ${service}'s app schema`);
    assert.equal(row.public_create, false, `PUBLIC may create in ${service}'s public schema`);
  }
});
