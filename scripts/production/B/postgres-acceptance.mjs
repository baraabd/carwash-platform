#!/usr/bin/env node
/**
 * Lane B real PostgreSQL acceptance for owner services (P01-B catalog/pricing,
 * P02-B billing core, P03-B billing cash custody).
 *
 *   node scripts/production/B/postgres-acceptance.mjs --service catalog|pricing|billing [--record]
 *
 * 1. Starts ONE disposable, pinned PostgreSQL container bound to 127.0.0.1 and
 *    provisions it with the shared infra/postgres/provision.sh (database per
 *    service, separate migration/runtime identities).
 * 2. Upgrade path: applies only the migrations that existed before this change,
 *    writes sentinel data (for billing: a real P02-B1 cash obligation with its
 *    journal and intent), then applies the full history and proves the data
 *    survived and still works with the new code paths (expand-only compatibility).
 * 3. Re-runs the provisioner (migration-history restriction) and proves the
 *    runtime role cannot read _prisma_migrations.
 * 4. Proves the committed Prisma schema mirror has no drift from the migrated
 *    database.
 * 5. Runs the service's compiled integration specs as the runtime role.
 *
 * Credentials are random per run and never printed. The container is removed in
 * every outcome. This is local disposable evidence, NOT production evidence.
 */
import crypto, { randomBytes } from 'node:crypto';
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { redact, registerSecret, run } from '../../acceptance/lib/exec.mjs';
import { pullImageWithMirrors } from '../../lib/image-references.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PG_IMAGE = 'postgres:16.10-alpine';
const IDENTITY_STUB = {
  postgres: 'REAL (disposable container)',
  identity: 'LOCAL HTTP STUB',
  broker: 'NOT USED',
};
const SERVICES = {
  catalog: {
    task: 'P01-B',
    previousMigrations: 2,
    env: 'CATALOG_TEST_DATABASE_URL',
    dependencies: IDENTITY_STUB,
  },
  pricing: {
    task: 'P01-B',
    previousMigrations: 1,
    env: 'PRICING_TEST_DATABASE_URL',
    dependencies: IDENTITY_STUB,
  },
  billing: {
    task: 'P03-B',
    previousMigrations: 2,
    env: 'BILLING_TEST_DATABASE_URL',
    dependencies: {
      ...IDENTITY_STUB,
      pricing: 'LOCAL HTTP STUB (published pricing.v1 getQuote shape)',
      broker: 'NOT USED (outbox rows written; relay not started until E registers billing events)',
    },
  },
};

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const service = arg('service');
if (!service || !(service in SERVICES)) {
  console.error(`usage: --service ${Object.keys(SERVICES).join('|')} [--record]`);
  process.exit(2);
}
const record = process.argv.includes('--record');
const spec = SERVICES[service];
const serviceDir = path.join(ROOT, 'services', service);
const { Client } = createRequire(path.join(serviceDir, 'package.json'))('pg');

const runId = randomBytes(6).toString('hex');
const container = `cw-${spec.task.toLowerCase().replace('-', '')}-${service}-${runId}`;
const work = path.join(ROOT, '.acceptance', container);
const credentials = {
  bootstrap: randomBytes(32).toString('base64url'),
  app: randomBytes(32).toString('base64url'),
  migration: randomBytes(32).toString('base64url'),
};
Object.values(credentials).forEach(registerSecret);

const report = {
  task: spec.task,
  service,
  runId,
  startedAt: new Date().toISOString(),
  sourceSHA: null,
  sourceTree: null,
  sourceDirty: null,
  node: process.version,
  docker: null,
  image: { name: PG_IMAGE, repoDigests: null, serverVersion: null },
  dependencies: spec.dependencies,
  phases: [],
  tests: null,
  accepted: false,
};

async function checked(command, args, options = {}) {
  const result = await run(command, args, { cwd: ROOT, timeoutMs: 600_000, ...options });
  if (result.code !== 0 || result.signal || result.outcome !== 'exited' || result.truncated)
    throw new Error(
      `${command} ${args[0] ?? ''} failed (${result.code ?? result.signal}): ${redact(result.stderr || result.stdout).slice(-6000)}`,
    );
  return result;
}

async function pullPinnedImage(image) {
  return pullImageWithMirrors(
    image,
    (args, options = {}) => run('docker', args, { cwd: ROOT, timeoutMs: 600_000, ...options }),
    { quiet: false },
  );
}

async function phase(name, operation) {
  try {
    const value = await operation();
    report.phases.push({ name, status: 'PASS' });
    console.log(`[PASS] ${name}`);
    return value;
  } catch (error) {
    report.phases.push({
      name,
      status: 'FAIL',
      detail: redact(String(error?.message ?? error)).slice(0, 4000),
    });
    console.log(`[FAIL] ${name}`);
    throw error;
  }
}

async function query(url, statement, values = []) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    return await client.query(statement, values);
  } finally {
    await client.end().catch(() => {});
  }
}

/** Runs statements in ONE transaction on one connection (COMMIT-time triggers apply). */
async function transaction(url, statements) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query('BEGIN');
    for (const [statement, values] of statements) await client.query(statement, values);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Billing upgrade sentinel: a P02-B1 obligation awaiting cash, written under the
 * PREVIOUS schema by the runtime role (all P02-B1 triggers apply), then - after
 * the upgrade - collected into technician custody under the NEW schema. Proves
 * the widened constraints accepted existing rows and old facts work with new code.
 */
const BILLING_SENTINEL = (() => {
  const ids = Object.fromEntries(
    [
      'obligation',
      'owner',
      'quote',
      'journal',
      'intent',
      'correlation',
      'receipt',
      'collection',
      'holder',
      'booking',
      'assignment',
    ].map((name) => [name, crypto.randomUUID()]),
  );
  return {
    async write(url) {
      await transaction(url, [
        [
          `INSERT INTO app.billing_obligation (id, owner_kind, owner_subject, quote_id, currency, amount_minor,
             verified_minor, status, revision, created_at, updated_at, correlation_id)
           VALUES ($1, 'account', $2, $3, 'SYP', 150000, 0, 'OPEN', 1, now(), now(), $4)`,
          [ids.obligation, ids.owner, ids.quote, ids.correlation],
        ],
        [
          `INSERT INTO app.ledger_journal (id, kind, business_ref, obligation_id, posted_at, correlation_id)
           VALUES ($1, 'OBLIGATION_BILLED', $2, $3, now(), $4)`,
          [ids.journal, `obligation:${ids.obligation}:billed`, ids.obligation, ids.correlation],
        ],
        [
          `INSERT INTO app.ledger_line (journal_id, line_no, account, side, currency, amount_minor) VALUES
             ($1, 0, 'CUSTOMER_RECEIVABLE', 'DEBIT', 'SYP', 150000),
             ($1, 1, 'BILLED_OBLIGATIONS_CONTROL', 'CREDIT', 'SYP', 150000)`,
          [ids.journal],
        ],
        [
          `INSERT INTO app.payment_intent (id, obligation_id, method, status, active_slot, currency, amount_minor,
             created_at, updated_at, correlation_id)
           VALUES ($1, $2, 'CASH_ON_COMPLETION', 'AWAITING_CASH_COLLECTION', 1, 'SYP', 150000, now(), now(), $3)`,
          [ids.intent, ids.obligation, ids.correlation],
        ],
      ]);
    },
    async verify(url) {
      await transaction(url, [
        [
          `INSERT INTO app.cash_receipt (id, obligation_id, intent_id, booking_id, assignment_id, assignment_revision,
             collector_subject, currency, amount_minor, custody_status, active_slot, revision, collected_at,
             updated_at, correlation_id)
           VALUES ($1, $2, $3, $4, $5, 1, $6, 'SYP', 150000, 'HELD', 1, 1, now(), now(), $7)`,
          [
            ids.receipt,
            ids.obligation,
            ids.intent,
            ids.booking,
            ids.assignment,
            ids.holder,
            ids.correlation,
          ],
        ],
        [
          `UPDATE app.payment_intent SET status = 'SUCCEEDED', active_slot = NULL, updated_at = now() WHERE id = $1`,
          [ids.intent],
        ],
        [
          `INSERT INTO app.ledger_journal (id, kind, business_ref, obligation_id, posted_at, correlation_id)
           VALUES ($1, 'CASH_COLLECTED', $2, $3, now(), $4)`,
          [ids.collection, `receipt:${ids.receipt}:collected`, ids.obligation, ids.correlation],
        ],
        [
          `INSERT INTO app.ledger_line (journal_id, line_no, account, side, currency, amount_minor, holder_subject) VALUES
             ($1, 0, 'CASH_IN_CUSTODY', 'DEBIT', 'SYP', 150000, $2),
             ($1, 1, 'CUSTOMER_RECEIVABLE', 'CREDIT', 'SYP', 150000, NULL)`,
          [ids.collection, ids.holder],
        ],
        [
          `UPDATE app.billing_obligation SET verified_minor = 150000, status = 'SETTLED', revision = revision + 1,
             updated_at = now() WHERE id = $1`,
          [ids.obligation],
        ],
      ]);
      const settled = await query(
        url,
        `SELECT o.status, r.custody_status FROM app.billing_obligation o
           JOIN app.cash_receipt r ON r.obligation_id = o.id WHERE o.id = $1`,
        [ids.obligation],
      );
      if (settled.rows[0]?.status !== 'SETTLED' || settled.rows[0]?.custody_status !== 'HELD')
        throw new Error('UPGRADED_OBLIGATION_NOT_COLLECTABLE');
    },
  };
})();

async function prisma(args, databaseUrl) {
  return checked('pnpm', ['--filter', `@carwash/${service}`, 'exec', 'prisma', ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

let started = false;
let exitCode = 1;
try {
  await phase('toolchain and source provenance', async () => {
    report.sourceSHA = (await checked('git', ['rev-parse', 'HEAD'])).stdout.trim();
    report.sourceTree = (await checked('git', ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
    report.sourceDirty =
      (await checked('git', ['status', '--porcelain', '--untracked-files=no'])).stdout.trim()
        .length > 0;
    report.docker = (
      await checked('docker', ['version', '--format', '{{.Server.Version}}'])
    ).stdout.trim();
  });

  await phase('build service and integration specs from this source', async () => {
    await checked('pnpm', ['--filter', `@carwash/${service}`, 'run', 'generate']);
    await checked('pnpm', ['--filter', `@carwash/${service}`, 'run', 'build:tests']);
  });

  await phase('pull pinned PostgreSQL image', async () => {
    await pullPinnedImage(PG_IMAGE);
    report.image.repoDigests = JSON.parse(
      (await checked('docker', ['image', 'inspect', PG_IMAGE, '--format', '{{json .RepoDigests}}']))
        .stdout,
    );
  });

  const prefix = service.toUpperCase().replaceAll('-', '_');
  await phase('start disposable PostgreSQL with shared provisioner', async () => {
    started = true;
    await checked('docker', [
      'run',
      '-d',
      '--name',
      container,
      '-e',
      'POSTGRES_USER=cw_p01b_bootstrap',
      '-e',
      `POSTGRES_PASSWORD=${credentials.bootstrap}`,
      '-e',
      `CW_SERVICES=${service}`,
      '-e',
      `${prefix}_DB_PASSWORD=${credentials.app}`,
      '-e',
      `${prefix}_MIGRATION_PASSWORD=${credentials.migration}`,
      '-v',
      `${path.join(ROOT, 'infra/postgres/provision.sh')}:/docker-entrypoint-initdb.d/01-provision.sh:ro`,
      '-p',
      '127.0.0.1::5432',
      PG_IMAGE,
    ]);
  });

  const portOut = (await checked('docker', ['port', container, '5432'])).stdout
    .trim()
    .split('\n')[0];
  const port = Number(portOut.split(':').at(-1));
  const db = `cw_${service}`;
  const appUrl = `postgresql://${db}_app:${credentials.app}@127.0.0.1:${port}/${db}?schema=app`;
  const migrateUrl = `postgresql://${db}_migrate:${credentials.migration}@127.0.0.1:${port}/${db}?schema=app`;

  await phase('runtime identity can connect after provisioning', async () => {
    const deadline = Date.now() + 90_000;
    let last;
    while (Date.now() < deadline) {
      try {
        // The init script finishes before the final server restart; require the
        // provisioned runtime role, not just a listening socket.
        const result = await query(appUrl, 'SELECT current_user, version()');
        report.image.serverVersion = String(result.rows[0].version)
          .split(' ')
          .slice(0, 2)
          .join(' ');
        return;
      } catch (error) {
        last = error;
        await delay(500);
      }
    }
    throw new Error(`PostgreSQL not ready: ${last?.message}`);
  });

  await phase('upgrade from previous migration history preserves existing data', async () => {
    const source = path.join(serviceDir, 'prisma/migrations');
    const all = (await readdir(source, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (all.length <= spec.previousMigrations) throw new Error('NEW_MIGRATION_REQUIRED');
    report.migrations = {
      previous: all.slice(0, spec.previousMigrations),
      added: all.slice(spec.previousMigrations),
    };
    const partial = path.join(work, 'previous-migrations');
    await mkdir(partial, { recursive: true });
    await cp(path.join(source, 'migration_lock.toml'), path.join(partial, 'migration_lock.toml'));
    for (const name of all.slice(0, spec.previousMigrations))
      await cp(path.join(source, name), path.join(partial, name), { recursive: true });
    const config = path.join(work, 'previous.config.mjs');
    await writeFile(
      config,
      `export default { schema: ${JSON.stringify(path.join(serviceDir, 'prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(partial)} }, datasource: { url: process.env.DATABASE_URL } };\n`,
    );
    await prisma(['migrate', 'deploy', '--config', config], migrateUrl);
    await query(appUrl, 'INSERT INTO app.service_marker(service, schema_rev) VALUES ($1, 1)', [
      `p01b-${runId}`,
    ]);
    if (service === 'billing') await BILLING_SENTINEL.write(appUrl);
    await prisma(['migrate', 'deploy'], migrateUrl);
    if (service === 'billing') await BILLING_SENTINEL.verify(appUrl);
    const kept = await query(appUrl, 'SELECT 1 FROM app.service_marker WHERE service = $1', [
      `p01b-${runId}`,
    ]);
    if (kept.rowCount !== 1) throw new Error('UPGRADE_LOST_EXISTING_DATA');
    // Re-applying is a no-op, not an error.
    await prisma(['migrate', 'deploy'], migrateUrl);
  });

  await phase('re-provision restricts migration history from the runtime role', async () => {
    await checked('docker', [
      'exec',
      container,
      'sh',
      '/docker-entrypoint-initdb.d/01-provision.sh',
    ]);
    const allowed = await query(
      appUrl,
      "SELECT has_table_privilege(current_user, 'app._prisma_migrations', 'SELECT') AS allowed",
    );
    if (allowed.rows[0].allowed !== false) throw new Error('RUNTIME_CAN_READ_MIGRATIONS');
  });

  await phase('committed Prisma schema mirror has no drift from migrated database', async () => {
    const result = await run(
      'pnpm',
      [
        '--filter',
        `@carwash/${service}`,
        'exec',
        'prisma',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      { cwd: ROOT, timeoutMs: 180_000, env: { ...process.env, DATABASE_URL: migrateUrl } },
    );
    if (result.code !== 0)
      throw new Error(`SCHEMA_DRIFT: ${redact(result.stdout + result.stderr).slice(-4000)}`);
  });

  await phase('integration specs as the least-privileged runtime role', async () => {
    const dir = path.join(serviceDir, 'dist-tests/test/integration');
    const files = (await readdir(dir))
      .filter((file) => file.endsWith('.spec.js'))
      .map((file) => path.join(dir, file));
    if (files.length === 0) throw new Error('NO_INTEGRATION_SPECS');
    const result = await run(process.execPath, ['--test', '--test-reporter=spec', ...files], {
      cwd: ROOT,
      timeoutMs: 600_000,
      env: { ...process.env, [spec.env]: appUrl, LOG_LEVEL: 'error' },
    });
    const out = redact(result.stdout);
    const summary = Object.fromEntries(
      [...out.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map((m) => [
        m[1],
        Number(m[2]),
      ]),
    );
    report.tests = {
      files: files.map((file) => path.relative(ROOT, file)),
      summary,
      names: [...out.matchAll(/^\s*[✔✖] (.+?) \(/gm)].map((m) => m[0].trim()),
    };
    process.stdout.write(
      out
        .split('\n')
        .filter((line) => /^\s*[✔✖ℹ]/.test(line))
        .join('\n') + '\n',
    );
    if (
      result.code !== 0 ||
      !summary.tests ||
      summary.fail !== 0 ||
      summary.skipped !== 0 ||
      summary.todo !== 0
    )
      throw new Error(
        `INTEGRATION_FAILED: ${redact(result.stderr).slice(-4000)}\n${out.slice(-6000)}`,
      );
  });

  report.accepted = true;
  exitCode = 0;
} catch (error) {
  console.error(redact(String(error?.stack ?? error)).slice(0, 8000));
} finally {
  if (started)
    await run('docker', ['rm', '-f', '-v', container], { cwd: ROOT, timeoutMs: 120_000 }).catch(
      () => {},
    );
  report.finishedAt = new Date().toISOString();
  await mkdir(work, { recursive: true });
  const json = JSON.stringify(report, null, 2) + '\n';
  await writeFile(path.join(work, 'report.json'), json);
  if (record) {
    const out = path.join(ROOT, 'docs/production/B/evidence');
    await mkdir(out, { recursive: true });
    await writeFile(
      path.join(out, `${service}-postgres-${report.sourceSHA?.slice(0, 12) ?? 'unknown'}.json`),
      json,
    );
  }
  console.log(
    `${report.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}: ${service} postgres acceptance (${path.relative(ROOT, work)}/report.json)`,
  );
  process.exit(exitCode);
}
