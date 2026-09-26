#!/usr/bin/env node
/**
 * Static guards on the migration layout. No database required.
 *
 * These check the properties that a running database CANNOT tell you, because by
 * the time a migration has been applied the mistake is already permanent:
 *
 *   APPEND-ONLY. An applied migration must never be edited. Prisma records a
 *   checksum per migration; editing a file that some environment has already run
 *   makes that environment permanently "failed", and no later migration can
 *   repair it. The fix is always a NEW migration, so an edit to an existing one
 *   is caught here rather than in production.
 *
 *   ONE OWNER. A migration lives under exactly one service and must not name
 *   another service's database, schema or role. A cross-service statement in a
 *   migration is a boundary violation that no privilege check would catch,
 *   because migrations run as the one identity allowed to change a schema.
 *
 *   NO db push. `prisma db push` mutates a schema with no migration recorded,
 *   which is how an environment ends up in a state no file describes.
 *
 *   NO CROSS-SERVICE REFERENCES. A foreign key across service boundaries is
 *   impossible to honour once the two databases are separate servers.
 *
 *   node scripts/check-migrations.mjs
 *   node scripts/check-migrations.mjs --root DIR
 *   node scripts/check-migrations.mjs --base-ref <git-ref>   append-only check
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
function option(name, fallback = null) {
  const at = args.indexOf(`--${name}`);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
}
const root = path.resolve(option('root', REPO));
const baseRef = option('base-ref');
const asJson = flag('json');

const findings = [];
const checks = [];
const fail = (rule, where, detail) => findings.push({ rule, where, detail });
const pass = (rule, detail) => checks.push({ rule, detail });

const catalogFile = path.join(root, 'architecture/service-catalog.json');
if (!existsSync(catalogFile)) {
  console.error('architecture/service-catalog.json is missing; nothing to check.');
  process.exit(1);
}
const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));

/** migration directories for a service, oldest first (Prisma orders by name). */
async function migrationsOf(service) {
  const dir = path.join(root, 'services', service, 'prisma/migrations');
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// ------------------------------------------------------------- one owner -----

let migrationCount = 0;
for (const service of catalog.services) {
  const names = await migrationsOf(service.id);
  migrationCount += names.length;

  if (names.length === 0) {
    fail('has-migrations', `services/${service.id}`, 'no migration directory');
    continue;
  }

  // Prisma applies in lexicographic order, so a timestamp prefix is what makes
  // the order deterministic across machines.
  for (const name of names) {
    if (!/^\d{14}_/.test(name)) {
      fail(
        'ordered-name',
        `services/${service.id}/prisma/migrations/${name}`,
        'must start with a 14-digit timestamp so the apply order is deterministic',
      );
    }
  }

  const lock = path.join(root, 'services', service.id, 'prisma/migrations/migration_lock.toml');
  if (!existsSync(lock)) {
    fail('provider-lock', `services/${service.id}`, 'migration_lock.toml is missing');
  } else {
    const text = await readFile(lock, 'utf8');
    if (!/provider\s*=\s*"postgresql"/.test(text)) {
      fail('provider-lock', `services/${service.id}`, 'migration provider is not postgresql');
    }
  }

  for (const name of names) {
    const file = path.join(
      root,
      'services',
      service.id,
      'prisma/migrations',
      name,
      'migration.sql',
    );
    if (!existsSync(file)) {
      fail('migration-sql', `services/${service.id}/${name}`, 'migration.sql is missing');
      continue;
    }
    const sql = await readFile(file, 'utf8');

    // Another service's database, schema-qualified table or role must not appear.
    for (const other of catalog.services) {
      if (other.id === service.id) continue;
      for (const token of [other.database, other.runtimeRole, other.migrationRole]) {
        if (new RegExp(`\\b${token}\\b`).test(sql)) {
          fail(
            'one-owner',
            `services/${service.id}/prisma/migrations/${name}/migration.sql`,
            `names another service's object: ${token}`,
          );
        }
      }
    }

    // A migration must not grant anything to a role it does not own, which would
    // hand another identity access from inside the owner's own migration.
    const grants = [...sql.matchAll(/\bGRANT\b[^;]*?\bTO\s+([A-Za-z0-9_",\s]+)/gi)];
    for (const [, grantees] of grants) {
      for (const grantee of grantees.split(',').map((value) => value.trim().replace(/"/g, ''))) {
        if (!grantee || grantee.startsWith(`cw_${service.id}_`)) continue;
        fail(
          'one-owner',
          `services/${service.id}/prisma/migrations/${name}/migration.sql`,
          `grants to a role this service does not own: ${grantee}`,
        );
      }
    }

    // A connection string has no business in a migration file.
    if (/postgres(?:ql)?:\/\//.test(sql)) {
      fail(
        'no-dsn',
        `services/${service.id}/prisma/migrations/${name}/migration.sql`,
        'contains a connection URL',
      );
    }
  }
}
if (migrationCount > 0) {
  pass('one-owner', `${migrationCount} migration(s) name only their own service`);
}

// ------------------------------------------------------------- no db push ----

const SCAN_DIRS = ['scripts', '.github/workflows', 'services', 'infra'];
const DB_PUSH = /prisma\s+db\s+push|\bdb:push\b/;
async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (['node_modules', 'dist', 'dist-tests', 'generated', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(mjs|js|ts|json|ya?ml|sh|sql)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let scanned = 0;
for (const dir of SCAN_DIRS) {
  for (const file of await walk(path.join(root, dir))) {
    // This file names the command in order to forbid it.
    if (path.basename(file) === 'check-migrations.mjs') continue;
    scanned++;
    const text = await readFile(file, 'utf8');
    if (DB_PUSH.test(text)) {
      fail(
        'no-db-push',
        path.relative(root, file).split(path.sep).join('/'),
        'uses prisma db push, which changes a schema with no migration recorded',
      );
    }
  }
}
pass('no-db-push', `${scanned} file(s) scanned`);

// ------------------------------------------------------------- append-only ---

/*
 * An applied migration must not be edited. Compared against a git ref rather
 * than a stored hash, because git already is the record of what was committed.
 */
if (baseRef) {
  const diff = spawnSync(
    'git',
    ['diff', '--name-status', `${baseRef}`, '--', 'services/*/prisma/migrations'],
    { cwd: root, encoding: 'utf8' },
  );
  if (diff.status !== 0) {
    fail('append-only', baseRef, `git diff failed: ${diff.stderr.trim()}`);
  } else {
    const edited = diff.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/))
      // Added files are how a new migration arrives; modified or deleted ones are
      // how an already-applied migration gets rewritten.
      .filter(([status]) => status !== 'A')
      .map(([status, file]) => `${status} ${file}`);

    if (edited.length > 0) {
      fail(
        'append-only',
        baseRef,
        `already-committed migrations were modified or deleted: ${edited.join(', ')}. ` +
          'Add a new migration instead; editing one that an environment has applied ' +
          'leaves that environment permanently failed.',
      );
    } else {
      pass('append-only', `no committed migration was edited since ${baseRef}`);
    }
  }
} else {
  pass('append-only', 'skipped: pass --base-ref <git-ref> to compare against history');
}

// ----------------------------------------------------------------- report ----

if (asJson) {
  console.log(JSON.stringify({ ok: findings.length === 0, checks, findings }, null, 2));
} else if (findings.length === 0) {
  for (const check of checks) console.log(`  ok   ${check.rule} - ${check.detail}`);
  console.log(
    '\nMigration guards passed. Scope: file layout, ownership and append-only history.\n' +
      'It does not execute any migration; applying them to a real database is the\n' +
      "acceptance run's job.",
  );
} else {
  console.error(`Migration guards FAILED: ${findings.length} finding(s).\n`);
  for (const finding of findings) {
    console.error(`  [${finding.rule}] ${finding.where}\n      ${finding.detail}`);
  }
}

process.exit(findings.length === 0 ? 0 : 1);
