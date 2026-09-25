import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { context, migrationDsn, sql } from './_support.mjs';
import {
  createShadowDatabase,
  dropShadowDatabase,
  migrateDeploy,
  migrateStatus,
  migrationDrift,
} from '../../scripts/acceptance/lib/migrations.mjs';

/**
 * Migration architecture, verified against the real databases the acceptance run
 * provisioned.
 *
 * The properties that matter operationally:
 *   - migrations really ran (not "the code would have run them"),
 *   - running them again is a no-op, so a redeploy is safe,
 *   - the committed migrations reproduce exactly the committed schema, so the
 *     two cannot drift apart unnoticed,
 *   - application replicas cannot perform schema changes at all.
 */

const SHADOW = `cw_shadow_drift_${context.runId
  .replace(/[^a-z0-9]/gi, '')
  .slice(0, 16)
  .toLowerCase()}`;
let shadowUrl;

after(async () => {
  if (shadowUrl) await dropShadowDatabase(context, SHADOW);
});

for (const service of context.services) {
  test(`${service}: the migration really was applied to a real database`, async () => {
    const result = await sql(
      migrationDsn(context, service),
      `SELECT migration_name, finished_at IS NOT NULL AS finished
         FROM app._prisma_migrations
        ORDER BY started_at`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.ok(result.rows.length >= 1, `${service} has no applied migrations`);
    for (const row of result.rows) {
      assert.equal(row.finished, true, `${service} migration ${row.migration_name} did not finish`);
    }
  });

  test(`${service}: the migration job left its marker`, async () => {
    // Distinguishes "the job ran" from "the tables happen to exist".
    const result = await sql(
      migrationDsn(context, service),
      `SELECT service, schema_rev FROM app.service_marker WHERE service = '${service}'`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.equal(result.rows.length, 1, `${service} marker missing`);
    assert.equal(result.rows[0].schema_rev, 1);
  });

  test(`${service}: expected tables exist in the owned schema, not in public`, async () => {
    const result = await sql(
      migrationDsn(context, service),
      `SELECT table_schema, table_name
         FROM information_schema.tables
        WHERE table_name IN ('service_marker', 'outbox_message', 'inbox_message')`,
    );
    assert.equal(result.ok, true, result.message ?? '');
    assert.ok(result.rows.length > 0);
    for (const row of result.rows) {
      assert.equal(row.table_schema, 'app', `${row.table_name} landed in ${row.table_schema}`);
    }
  });

  test(`${service}: re-running migrate deploy is a safe no-op`, async () => {
    const result = await migrateDeploy(context, service);
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      result.stdout,
      /No pending migrations|already in sync|successfully applied/i,
      `unexpected deploy output: ${result.stdout}`,
    );
  });

  test(`${service}: migrate status reports the database as up to date`, async () => {
    const result = await migrateStatus(context, service);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /up to date|No pending migrations/i, result.stdout);
  });
}

test('the committed migrations reproduce the committed schema exactly', async () => {
  // Drift in either direction is a real defect: replaying migrations on a fresh
  // database must yield precisely what schema.prisma describes.
  shadowUrl = await createShadowDatabase(context, SHADOW);
  for (const service of context.services) {
    const result = await migrationDrift(context, service, { shadowUrl });
    // --exit-code: 0 = no difference, 2 = a difference, 1 = an error.
    assert.equal(
      result.code,
      0,
      `${service} has schema/migration drift (exit ${result.code}): ${result.stdout}${result.stderr}`,
    );
  }
});

test('the migration identity is not the runtime identity', async () => {
  for (const service of context.services) {
    assert.ok(migrationDsn(context, service).includes(`cw_${service}_migrate`));
  }
});

test('application replicas hold no privilege that could migrate a schema', async () => {
  // Proven at the database, not by reading the code: even a service that tried
  // to migrate on startup would be refused.
  for (const service of ['identity', 'catalog', 'reporting']) {
    const result = await sql(
      `${migrationDsn(context, service)
        .replace(`cw_${service}_migrate`, `cw_${service}_app`)
        .replace(
          encodeURIComponent(context.credentials[`${service}_migration`]),
          encodeURIComponent(context.credentials[`${service}_db`]),
        )}`,
      'BEGIN; CREATE TABLE app.startup_migration_probe (id integer); ROLLBACK;',
    );
    assert.equal(result.ok, false, `${service} runtime could create a table`);
    assert.equal(result.code, '42501');
  }
});
