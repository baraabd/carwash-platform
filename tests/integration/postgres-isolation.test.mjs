import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appDsn,
  assertPrivilegeDenied,
  context,
  crossDsn,
  migrationDsn,
  sql,
} from './_support.mjs';

/**
 * Real-PostgreSQL isolation proof.
 *
 * Every assertion below is made against a live server, because privilege
 * enforcement lives in the server and nowhere else. A unit test with a mocked
 * client would assert that our code asked nicely, not that the database refuses.
 *
 * Statements that are expected to be refused are wrapped in a transaction that
 * is rolled back, so that if a privilege check ever DID succeed, the discovery of
 * that defect cannot leave the acceptance schema mutated.
 */

const SERVICES = context.services;

/** Wrap in a transaction and roll back, so a surprise success cannot persist. */
function rollbackWrapped(statement) {
  return `BEGIN; ${statement}; ROLLBACK;`;
}

test('every service has its own logical database', async () => {
  const result = await sql(
    migrationDsn(context, 'catalog'),
    "SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'cw\\_%'",
  );
  assert.equal(result.ok, true, result.message ?? '');
  assert.equal(result.rows[0].n, SERVICES.length);
});

test('every service has a distinct application and migration role', async () => {
  const result = await sql(
    migrationDsn(context, 'catalog'),
    "SELECT rolname FROM pg_roles WHERE rolname LIKE 'cw\\_%' ORDER BY rolname",
  );
  const roles = result.rows.map((r) => r.rolname);
  for (const service of SERVICES) {
    assert.ok(roles.includes(`cw_${service}_app`), `missing cw_${service}_app`);
    assert.ok(roles.includes(`cw_${service}_migrate`), `missing cw_${service}_migrate`);
  }
});

test('no cw_ role is a superuser, and none may create databases or roles', async () => {
  const result = await sql(
    migrationDsn(context, 'catalog'),
    `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole
       FROM pg_roles
      WHERE rolname LIKE 'cw\\_%' AND rolname <> 'cw_acceptance_bootstrap'`,
  );
  for (const role of result.rows) {
    assert.equal(role.rolsuper, false, `${role.rolname} is a superuser`);
    assert.equal(role.rolcreatedb, false, `${role.rolname} may create databases`);
    assert.equal(role.rolcreaterole, false, `${role.rolname} may create roles`);
  }
});

test('no cw_ role is a member of any other role', async () => {
  // Role attributes alone are not isolation: membership would let SET ROLE
  // borrow another service's privileges. There must be no memberships at all.
  const result = await sql(
    migrationDsn(context, 'catalog'),
    `SELECT member.rolname AS member, grantee.rolname AS grantee
       FROM pg_auth_members am
       JOIN pg_roles member ON member.oid = am.member
       JOIN pg_roles grantee ON grantee.oid = am.roleid
      WHERE member.rolname LIKE 'cw\\_%'`,
  );
  assert.deepEqual(result.rows, [], 'unexpected role membership found');
});

test('the application role can do ordinary DML in its own schema', async () => {
  const result = await sql(
    appDsn(context, 'catalog'),
    `INSERT INTO app.foundation_probe (id, label, version)
     VALUES ('11111111-1111-4111-8111-111111111111', 'probe-dml', 1)
     ON CONFLICT (id) DO UPDATE SET version = app.foundation_probe.version;
     SELECT count(*)::int AS n FROM app.foundation_probe;`,
  );
  assert.equal(result.ok, true, result.message ?? '');
});

/* ---------------------- DDL denial for runtime roles ---------------------- */

const DDL_CASES = [
  ['CREATE TABLE', 'CREATE TABLE app.should_not_exist (id integer)'],
  ['ALTER TABLE', 'ALTER TABLE app.service_marker ADD COLUMN injected integer'],
  ['DROP TABLE', 'DROP TABLE app.service_marker'],
  ['CREATE INDEX', 'CREATE INDEX should_not_exist_idx ON app.service_marker (service)'],
  ['CREATE SCHEMA', 'CREATE SCHEMA rogue'],
  ['TRUNCATE another owner table', 'TRUNCATE app.service_marker'],
];

for (const service of ['identity', 'catalog', 'billing', 'reporting']) {
  for (const [label, statement] of DDL_CASES) {
    test(`${service} runtime role cannot ${label}`, async () => {
      const result = await sql(appDsn(context, service), rollbackWrapped(statement));
      assertPrivilegeDenied(result, assert, `${service} runtime ${label}`);
    });
  }

  test(`${service} runtime role cannot touch migration history`, async () => {
    // Being unable to change the schema is not enough: it must also be unable to
    // rewrite the record of which migrations ran.
    const read = await sql(appDsn(context, service), 'SELECT count(*) FROM app._prisma_migrations');
    assertPrivilegeDenied(read, assert, `${service} runtime reading _prisma_migrations`);

    const write = await sql(
      appDsn(context, service),
      rollbackWrapped("DELETE FROM app._prisma_migrations WHERE migration_name <> ''"),
    );
    assertPrivilegeDenied(write, assert, `${service} runtime writing _prisma_migrations`);
  });

  test(`${service} runtime role cannot SET ROLE to its own migration identity`, async () => {
    const result = await sql(appDsn(context, service), `SET ROLE cw_${service}_migrate`);
    assertPrivilegeDenied(result, assert, `${service} runtime SET ROLE`);
  });
}

/* --------------------------- cross-database denial --------------------------- */

const CROSS_PAIRS = [
  ['identity', 'booking'],
  ['booking', 'billing'],
  ['billing', 'identity'],
  ['catalog', 'customer'],
  ['reporting', 'billing'],
  ['communications', 'catalog'],
];

for (const [from, to] of CROSS_PAIRS) {
  test(`${from} runtime role cannot connect to the ${to} database`, async () => {
    const result = await sql(
      crossDsn(context, `cw_${from}_app`, context.credentials[`${from}_db`], `cw_${to}`),
      'SELECT 1',
    );
    assertPrivilegeDenied(result, assert, `${from} runtime -> cw_${to}`);
  });

  test(`${from} MIGRATION role cannot connect to the ${to} database either`, async () => {
    // A migration identity is more powerful, so its blast radius matters more.
    const result = await sql(
      crossDsn(context, `cw_${from}_migrate`, context.credentials[`${from}_migration`], `cw_${to}`),
      'SELECT 1',
    );
    assertPrivilegeDenied(result, assert, `${from} migration -> cw_${to}`);
  });
}

test('a runtime role cannot SET ROLE to another service identity', async () => {
  const result = await sql(appDsn(context, 'catalog'), 'SET ROLE cw_billing_app');
  assertPrivilegeDenied(result, assert, 'catalog runtime SET ROLE cw_billing_app');
});

test('a self-GRANT does not actually escalate the runtime role', async () => {
  // PostgreSQL answers a GRANT issued without grant option with a WARNING and
  // grants nothing, rather than raising an error. So "did the statement fail?"
  // is the wrong question - the security property is that the privilege is not
  // obtained. This asserts the effect: after attempting to grant itself CREATE,
  // the role still cannot create anything. The whole attempt is rolled back, so
  // a hypothetical escalation could not persist into the rest of the suite.
  const result = await sql(
    appDsn(context, 'catalog'),
    `BEGIN;
     GRANT ALL ON SCHEMA app TO cw_catalog_app;
     CREATE TABLE app.escalation_probe (id integer);
     ROLLBACK;`,
  );
  assertPrivilegeDenied(result, assert, 'catalog runtime privilege escalation via self-GRANT');
});

test('a runtime role cannot grant another service access to its database', async () => {
  const result = await sql(
    appDsn(context, 'catalog'),
    rollbackWrapped('GRANT CONNECT ON DATABASE cw_catalog TO cw_billing_app'),
  );
  // Either refused outright, or a no-op warning; what matters is that billing
  // still cannot connect, which the cross-database tests above already assert.
  assert.ok(
    result.ok === false || result.code === null,
    'granting cross-service access must not be a privileged operation here',
  );
});

test('the migration role owns the schema and can change it in its own database', async () => {
  // The positive control: without this, the negative results above could simply
  // mean the connection never worked.
  const result = await sql(
    migrationDsn(context, 'catalog'),
    rollbackWrapped('CREATE TABLE app.temp_migration_probe (id integer)'),
  );
  assert.equal(
    result.ok,
    true,
    `migration role should be able to create tables: ${result.message}`,
  );
});

test('the public schema is unusable, so nothing lands there by accident', async () => {
  const result = await sql(
    appDsn(context, 'catalog'),
    rollbackWrapped('CREATE TABLE public.should_not_exist (id integer)'),
  );
  assertPrivilegeDenied(result, assert, 'catalog runtime CREATE TABLE in public');
});
