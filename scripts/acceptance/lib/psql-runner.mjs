#!/usr/bin/env node
/**
 * Runs one SQL statement batch against a given DSN using the `pg` driver.
 *
 * Lives in its own process so the SQL and the connection string arrive through
 * the environment and are never concatenated into a shell command line. Prints
 * the result as JSON on stdout; diagnostics go to stderr.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// `pg` is a service-local dependency; resolve it from a service that declares it
// rather than requiring a root-level copy.
const require = createRequire(path.join(root, 'services', 'catalog', 'package.json'));
const { Client } = require('pg');

const url = process.env.CW_PSQL_URL;
const sql = process.env.CW_PSQL_SQL;
if (!url || !sql) {
  process.stderr.write('CW_PSQL_URL and CW_PSQL_SQL are required\n');
  process.exit(2);
}

const client = new Client({ connectionString: url });
try {
  await client.connect();
  const result = await client.query(sql);
  const rows = Array.isArray(result) ? result.flatMap((r) => r.rows ?? []) : (result.rows ?? []);
  process.stdout.write(`${JSON.stringify({ ok: true, rows })}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) })}\n`,
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
