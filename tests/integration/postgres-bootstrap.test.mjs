import test from 'node:test';
import assert from 'node:assert/strict';
import { context, migrationDsn, sql } from './_support.mjs';
import { run } from '../../scripts/acceptance/lib/exec.mjs';

/**
 * The provisioning script is idempotent, proven by replaying it.
 *
 * `infra/postgres/provision.sh` runs once from the PostgreSQL entrypoint on a
 * fresh volume. That single execution path has two problems worth a test:
 *
 *   A container restart, or an operator re-running the bootstrap after editing
 *   it, must not wedge the stack. `CREATE ROLE` and `CREATE DATABASE` fail on a
 *   second run, and with `ON_ERROR_STOP=1` the whole script then aborts partway -
 *   leaving a cluster provisioned up to whichever service failed first.
 *
 *   A bootstrap that can only ever run once cannot be verified. The test would
 *   have to trust that a second run "would have worked".
 *
 * So this replays the real script, in the real container, against the already
 * provisioned cluster, and then asserts that the privilege surface is EXACTLY
 * what it was beforehand. Idempotent means "changes nothing", not merely "exits
 * zero": a replay that quietly re-granted the application role access to
 * `_prisma_migrations` would exit zero and still be a regression.
 *
 * It mutates only the acceptance cluster, which the runner destroys afterwards.
 */

const PROVISION_IN_CONTAINER = '/docker-entrypoint-initdb.d/01-provision.sh';

function compose(args) {
  return run(
    'docker',
    [
      'compose',
      '-p',
      context.project,
      '-f',
      context.composeFile,
      '--env-file',
      context.envFile,
      ...args,
    ],
    { cwd: context.root, timeoutMs: 240_000 },
  );
}

/**
 * A complete, ordered snapshot of who may do what.
 *
 * Taken from the server's own catalogue rather than from the script's intent, and
 * covering role attributes, database CONNECT, schema rights and per-table DML for
 * every cw_ role. Comparing two of these is what makes "changed nothing"
 * checkable instead of asserted.
 */
async function privilegeSnapshot(service) {
  const result = await sql(
    migrationDsn(context, service),
    `WITH roles AS (
       SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
              rolreplication, rolbypassrls, rolcanlogin
         FROM pg_roles WHERE rolname LIKE 'cw\\_%'
     ),
     db AS (
       SELECT r.rolname,
              has_database_privilege(r.rolname, current_database(), 'CONNECT') AS c,
              has_database_privilege(r.rolname, current_database(), 'TEMPORARY') AS t
         FROM roles r
     ),
     sch AS (
       SELECT r.rolname, n.nspname,
              has_schema_privilege(r.rolname, n.nspname, 'USAGE') AS u,
              has_schema_privilege(r.rolname, n.nspname, 'CREATE') AS cr
         FROM roles r CROSS JOIN pg_namespace n
        WHERE n.nspname IN ('app', 'public')
     ),
     tbl AS (
       SELECT r.rolname, t.tablename, p.priv,
              has_table_privilege(r.rolname, format('app.%I', t.tablename), p.priv) AS granted
         FROM roles r
         CROSS JOIN pg_tables t
         CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                            ('TRUNCATE'),('REFERENCES')) AS p(priv)
        WHERE t.schemaname = 'app'
     )
     SELECT json_build_object(
       'roles', (SELECT json_agg(row_to_json(r) ORDER BY r.rolname) FROM roles r),
       'database', (SELECT json_agg(row_to_json(d) ORDER BY d.rolname) FROM db d),
       'schemas', (SELECT json_agg(row_to_json(s) ORDER BY s.rolname, s.nspname) FROM sch s),
       'tables', (SELECT json_agg(row_to_json(x) ORDER BY x.rolname, x.tablename, x.priv)
                    FROM tbl x WHERE x.granted)
     )::text AS snapshot`,
  );
  assert.equal(result.ok, true, result.message ?? '');
  return result.rows[0].snapshot;
}

test('the provisioning script replays cleanly and changes no privilege', async () => {
  // A representative subset: every service shares one generated script, so the
  // property is the script's rather than any one service's. Snapshotting all ten
  // would multiply a slow catalogue query for no additional coverage.
  const sampled = ['catalog', 'reporting', 'identity'];

  const before = {};
  for (const service of sampled) before[service] = await privilegeSnapshot(service);

  /*
   * Run the real script in the real container. `exec` inherits the container's
   * environment, which already carries CW_SERVICES and every password, so the
   * replay uses exactly the inputs the entrypoint used.
   */
  const replay = await compose(['exec', '-T', 'postgres', 'sh', PROVISION_IN_CONTAINER]);
  assert.equal(
    replay.code,
    0,
    `replaying the bootstrap failed:\n${replay.stdout}\n${replay.stderr}`,
  );
  // Every service must be reported, not just the ones before the first failure.
  for (const service of context.services) {
    assert.match(
      replay.stdout,
      new RegExp(`provisioned cw_${service}\\b`),
      `the replay did not reach ${service}; a partial bootstrap is not idempotent`,
    );
  }

  for (const service of sampled) {
    const after = await privilegeSnapshot(service);
    assert.equal(
      after,
      before[service],
      `${service}: the privilege surface changed across a bootstrap replay`,
    );
  }
});

test('a second replay is still clean, so idempotency is not a one-shot property', async () => {
  const first = await compose(['exec', '-T', 'postgres', 'sh', PROVISION_IN_CONTAINER]);
  assert.equal(first.code, 0, first.stderr);
  const second = await compose(['exec', '-T', 'postgres', 'sh', PROVISION_IN_CONTAINER]);
  assert.equal(second.code, 0, second.stderr);
});

test('the application role still cannot reach the migration history after a replay', async () => {
  // Called out separately because it is the privilege most easily re-granted by
  // accident: `GRANT ... ON ALL TABLES IN SCHEMA app` includes
  // _prisma_migrations, and the script must revoke it again afterwards.
  for (const service of context.services) {
    const result = await sql(
      migrationDsn(context, service),
      `SELECT p.priv
         FROM (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) AS p(priv)
        WHERE has_table_privilege('cw_${service}_app', 'app._prisma_migrations', p.priv)`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.deepEqual(
      result.rows,
      [],
      `${service} runtime role regained ${JSON.stringify(result.rows)} on _prisma_migrations`,
    );
  }
});

test('the owned schema is still owned by the migration role after a replay', async () => {
  for (const service of context.services) {
    const result = await sql(
      migrationDsn(context, service),
      `SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'app'`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.equal(
      result.rows[0].owner,
      `cw_${service}_migrate`,
      `${service}: schema ownership must not fall back to the bootstrap superuser`,
    );
  }
});
