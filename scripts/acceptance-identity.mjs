#!/usr/bin/env node
/** F006: disposable PostgreSQL/Redis + real Nest API and Chromium security acceptance. */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, cp, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { run, registerSecret, redact } from './acceptance/lib/exec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = `cw-f006-${randomBytes(6).toString('hex')}`;
const work = path.join(ROOT, '.acceptance', project);
const evidence = path.join(ROOT, 'evidence', 'identity', project);
const compose = path.join(work, 'compose.json');
const own = createRequire(path.join(ROOT, 'services/identity/package.json'));
const security = createRequire(path.join(ROOT, 'packages/security-kit/package.json'));
const { Client } = own('pg');
const { createClient } = security('@redis/client');
const passwords = Object.fromEntries(
  ['bootstrap', 'app', 'migration', 'redis'].map((key) => [
    key,
    randomBytes(32).toString('base64url'),
  ]),
);
Object.values(passwords).forEach(registerSecret);
const report = {
  sprint: 'F006',
  project,
  sourceSHA: null,
  startedAt: new Date().toISOString(),
  node: process.version,
  pnpm: null,
  docker: null,
  images: {},
  phases: [],
  accepted: false,
};
let provisioned = false;
async function checked(command, args, options = {}) {
  const result = await run(command, args, { cwd: ROOT, timeoutMs: 180_000, ...options });
  if (result.code !== 0 || result.signal || result.outcome !== 'exited' || result.truncated) {
    throw new Error(
      `${command} failed (${result.code ?? result.signal}): ${redact(result.stderr || result.stdout).slice(-8000)}`,
    );
  }
  return result;
}
async function phase(name, operation) {
  try {
    const result = await operation();
    report.phases.push({ name, status: 'PASS' });
    console.log(`[PASS] ${name}`);
    return result;
  } catch (error) {
    report.phases.push({
      name,
      status: 'FAIL',
      detail: redact(error instanceof Error ? error.message : String(error)),
    });
    throw error;
  }
}
async function dc(args, options = {}) {
  return checked('docker', ['compose', '-p', project, '-f', compose, ...args], options);
}
async function sql(url, statement, values = []) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 10_000,
  });
  try {
    await client.connect();
    return await client.query(statement, values);
  } finally {
    await client.end();
  }
}
function port(output) {
  const value = Number(output.trim().split(':').at(-1));
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error('INVALID_EPHEMERAL_PORT');
  return value;
}
async function waitFor(operation, label) {
  const deadline = Date.now() + 60_000;
  let last;
  while (Date.now() < deadline) {
    try {
      await operation();
      return;
    } catch (error) {
      last = error;
      await delay(300);
    }
  }
  throw new Error(
    `Readiness timeout: ${label}: ${last instanceof Error ? last.message : 'unknown'}`,
  );
}
await mkdir(work, { recursive: true, mode: 0o700 });
await mkdir(evidence, { recursive: true });
try {
  await phase('toolchain and source provenance', async () => {
    const pin = (await readFile(path.join(ROOT, '.nvmrc'), 'utf8')).trim().replace(/^v/, '');
    if (process.version !== `v${pin}`) throw new Error('PINNED_NODE_REQUIRED');
    report.sourceSHA = (await checked('git', ['rev-parse', 'HEAD'])).stdout.trim();
    report.sourceDirty =
      (await checked('git', ['status', '--porcelain', '--untracked-files=no'])).stdout.length > 0;
    report.pnpm = (await checked('pnpm', ['--version'])).stdout.trim();
    report.docker = (
      await checked('docker', ['version', '--format', '{{.Server.Version}}'])
    ).stdout.trim();
  });
  const pgImage = 'postgres:16.10-alpine';
  const redisImage = 'redis:8.2.10-alpine';
  await phase('resolve fixed infrastructure images', async () => {
    for (const image of [pgImage, redisImage]) {
      await checked('docker', ['pull', image]);
      report.images[image] = JSON.parse(
        (await checked('docker', ['image', 'inspect', image, '--format', '{{json .RepoDigests}}']))
          .stdout,
      );
    }
  });
  const acl = `user default off\nuser cw_identity_rate on #${createHash('sha256').update(passwords.redis).digest('hex')} ~identity:rate:* -@all +hello +auth +ping +quit +select +client|setinfo +client|setname +client|id +eval +incr +pexpire +pttl\n`;
  // Read-only container mount: Redis runs as a non-root user. This file contains
  // only a SHA-256 hash of the generated high-entropy test credential.
  await writeFile(path.join(work, 'users.acl'), acl, { mode: 0o644 });
  await writeFile(
    compose,
    JSON.stringify(
      {
        services: {
          postgres: {
            image: pgImage,
            environment: {
              POSTGRES_USER: 'cw_f006_bootstrap',
              POSTGRES_PASSWORD: passwords.bootstrap,
              CW_SERVICES: 'identity',
              IDENTITY_DB_PASSWORD: passwords.app,
              IDENTITY_MIGRATION_PASSWORD: passwords.migration,
            },
            ports: ['127.0.0.1::5432'],
            volumes: [
              `${path.join(ROOT, 'infra/postgres/provision.sh')}:/docker-entrypoint-initdb.d/01-provision.sh:ro`,
              'pg_data:/var/lib/postgresql/data',
            ],
          },
          redis: {
            image: redisImage,
            command: [
              'redis-server',
              '--aclfile',
              '/run/cw/users.acl',
              '--save',
              '',
              '--appendonly',
              'no',
            ],
            ports: ['127.0.0.1::6379'],
            volumes: [`${path.join(work, 'users.acl')}:/run/cw/users.acl:ro`],
          },
        },
        volumes: { pg_data: {} },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  provisioned = true;
  await phase('start only the scoped disposable stack', () =>
    dc(['up', '-d', '--wait', '--wait-timeout', '90']),
  );
  const pgPort = port((await dc(['port', 'postgres', '5432'])).stdout);
  const redisPort = port((await dc(['port', 'redis', '6379'])).stdout);
  const databaseUrl = `postgresql://cw_identity_app:${passwords.app}@127.0.0.1:${pgPort}/cw_identity?schema=app`;
  const migrationUrl = `postgresql://cw_identity_migrate:${passwords.migration}@127.0.0.1:${pgPort}/cw_identity?schema=app`;
  const redisUrl = `redis://cw_identity_rate:${passwords.redis}@127.0.0.1:${redisPort}/0`;
  const sentinel = `f006-${randomUUID()}`;
  await phase('real service readiness with least-privilege identities', async () => {
    await waitFor(() => sql(databaseUrl, 'SELECT 1'), 'PostgreSQL');
    await waitFor(async () => {
      const client = createClient({
        url: redisUrl,
        socket: { connectTimeout: 2000, reconnectStrategy: false },
      });
      client.on('error', () => {});
      try {
        await client.connect();
        await client.ping();
      } finally {
        if (client.isOpen) client.destroy();
      }
    }, 'Redis');
  });
  await phase(
    'upgrade foundation migration to identity schema without losing existing data',
    async () => {
      const source = path.join(ROOT, 'services/identity/prisma/migrations');
      const dirs = (await readdir(source, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      if (dirs.length < 2) throw new Error('FOUNDATION_AND_IDENTITY_MIGRATIONS_REQUIRED');
      const migrations = path.join(work, 'upgrade-migrations');
      await mkdir(migrations);
      await cp(
        path.join(source, 'migration_lock.toml'),
        path.join(migrations, 'migration_lock.toml'),
      );
      await cp(path.join(source, dirs[0]), path.join(migrations, dirs[0]), { recursive: true });
      const config = path.join(work, 'upgrade.config.mjs');
      await writeFile(
        config,
        `export default { schema: ${JSON.stringify(path.join(ROOT, 'services/identity/prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL } };\n`,
      );
      const env = { ...process.env, DATABASE_URL: migrationUrl };
      await checked(
        'pnpm',
        [
          '--filter',
          '@carwash/identity',
          'exec',
          'prisma',
          'migrate',
          'deploy',
          '--config',
          config,
        ],
        { env },
      );
      await sql(databaseUrl, 'INSERT INTO app.service_marker(service,schema_rev) VALUES($1,1)', [
        sentinel,
      ]);
      for (const name of dirs.slice(1))
        await cp(path.join(source, name), path.join(migrations, name), { recursive: true });
      await checked(
        'pnpm',
        [
          '--filter',
          '@carwash/identity',
          'exec',
          'prisma',
          'migrate',
          'deploy',
          '--config',
          config,
        ],
        { env },
      );
      await checked(
        'pnpm',
        ['--filter', '@carwash/identity', 'exec', 'prisma', 'migrate', 'deploy'],
        { env },
      );
      if (
        (
          await sql(databaseUrl, 'SELECT service FROM app.service_marker WHERE service=$1', [
            sentinel,
          ])
        ).rowCount !== 1
      )
        throw new Error('UPGRADE_LOST_FOUNDATION_DATA');
      // Same owning provisioner applies the F004 migration-history restriction.
      await dc(['exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/01-provision.sh']);
      const permissions = await sql(
        databaseUrl,
        "SELECT has_table_privilege(current_user,'app._prisma_migrations','SELECT') AS allowed",
      );
      if (permissions.rows[0].allowed !== false) throw new Error('RUNTIME_CAN_READ_MIGRATIONS');
    },
  );
  await phase('build a private test-only HTTPS certificate', async () => {
    await checked('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:3072',
      '-nodes',
      '-keyout',
      path.join(work, 'tls.key'),
      '-out',
      path.join(work, 'tls.crt'),
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ]);
  });
  const contextFile = path.join(work, 'context.json');
  await writeFile(
    contextFile,
    JSON.stringify({
      project,
      runId: project,
      sentinel,
      databaseUrl,
      redisUrl,
      tls: { keyFile: path.join(work, 'tls.key'), certFile: path.join(work, 'tls.crt') },
    }),
    { mode: 0o600 },
  );
  await phase('real Nest/PostgreSQL/Redis and Chromium security suites', async () => {
    const result = await run(
      process.execPath,
      [
        '--test',
        '--test-concurrency=1',
        '--test-timeout=180000',
        '--test-reporter=tap',
        'tests/identity/api.test.mjs',
        'tests/identity/browser.test.mjs',
      ],
      { cwd: ROOT, env: { ...process.env, F006_CONTEXT_FILE: contextFile }, timeoutMs: 360_000 },
    );
    const tap = redact(result.stdout);
    await writeFile(path.join(evidence, 'integration.tap'), tap);
    await writeFile(path.join(evidence, 'stderr.log'), redact(result.stderr));
    const number = (field) => Number(tap.match(new RegExp(`^# ${field} (\\d+)`, 'm'))?.[1] ?? -1);
    report.tests = {
      total: number('tests'),
      passed: number('pass'),
      failed: number('fail'),
      skipped: number('skipped'),
      todo: number('todo'),
    };
    console.log(tap);
    if (
      result.code !== 0 ||
      result.signal ||
      result.outcome !== 'exited' ||
      result.truncated ||
      report.tests.total < 1 ||
      report.tests.failed !== 0 ||
      report.tests.skipped !== 0 ||
      report.tests.todo !== 0 ||
      report.tests.passed !== report.tests.total
    )
      throw new Error(
        `IDENTITY_SECURITY_SUITES_FAILED: ${JSON.stringify(report.tests)} ${redact(result.stderr).slice(-3000)}`,
      );
  });
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  if (provisioned) {
    const logs = await run(
      'docker',
      ['compose', '-p', project, '-f', compose, 'logs', '--no-color', '--tail', '200'],
      { cwd: ROOT, timeoutMs: 30_000 },
    );
    await writeFile(path.join(evidence, 'infrastructure.log'), redact(logs.stdout + logs.stderr));
    try {
      await phase('scoped teardown', () => dc(['down', '--volumes', '--remove-orphans']));
    } catch (error) {
      console.error(redact(error.message));
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  report.accepted = process.exitCode !== 1 && report.phases.every((item) => item.status === 'PASS');
  await writeFile(
    path.join(evidence, 'acceptance-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    `${report.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}: F006; evidence ${path.relative(ROOT, evidence)}`,
  );
}
