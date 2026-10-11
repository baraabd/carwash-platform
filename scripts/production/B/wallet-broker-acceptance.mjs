#!/usr/bin/env node
/**
 * Lane B P05-B3 real RabbitMQ + real PostgreSQL acceptance for the Wallet
 * technician-custody projection.
 *
 *   node scripts/production/B/wallet-broker-acceptance.mjs [--record]
 *
 * 1. Builds the Wallet service and its specs from this source.
 * 2. Starts ONE disposable pinned PostgreSQL (shared provisioner: separate
 *    migration/runtime identities) and ONE disposable pinned RabbitMQ, both bound
 *    to 127.0.0.1 with random per-run credentials that are never printed.
 * 3. Applies the Wallet migrations with the MIGRATION identity.
 * 4. Runs tests/production/B/wallet-broker.test.mjs: real envelope-v2 Billing
 *    events are published to the real `washgo.billing.events` topic exchange,
 *    consumed from a bound queue with manual ack, and delivered into the compiled
 *    Wallet handler writing as the RUNTIME identity.
 *
 * Honest scope: the test's amqplib consumer loop IS the broker adapter for this
 * run. Wallet's runtime broker wiring stays blocked on Lane E (CR-B-12.3: the
 * service has no broker dependency and its lockfile entry is E-owned). Billing is
 * not running; events are built in its registered shape. Containers are removed
 * in every outcome. Local disposable evidence, NOT production evidence.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { redact, registerSecret, run } from '../../acceptance/lib/exec.mjs';
import { pullImageWithMirrors } from '../../lib/image-references.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const IMAGES = { postgres: 'postgres:16.10-alpine', rabbitmq: 'rabbitmq:4.2-management-alpine' };
const record = process.argv.includes('--record');
const runId = randomBytes(6).toString('hex');
const names = { pg: `cw-p05b-wallet-pg-${runId}`, mq: `cw-p05b-wallet-mq-${runId}` };
const credentials = {
  bootstrap: randomBytes(32).toString('base64url'),
  app: randomBytes(32).toString('base64url'),
  migration: randomBytes(32).toString('base64url'),
  broker: randomBytes(32).toString('base64url'),
};
Object.values(credentials).forEach(registerSecret);
const { Client } = createRequire(path.join(ROOT, 'services/wallet/package.json'))('pg');
const amqplib = createRequire(path.join(ROOT, 'packages/platform-messaging/package.json'))(
  'amqplib',
);

const report = {
  task: 'P05-B',
  child: 'B3',
  suite: 'wallet-broker',
  runId,
  startedAt: new Date().toISOString(),
  sourceSHA: null,
  sourceTree: null,
  sourceDirty: null,
  images: IMAGES,
  dependencies: {
    postgres: 'REAL (disposable container)',
    broker: 'REAL RabbitMQ (disposable container); the test consumer loop is the broker adapter',
    billing: 'NOT RUNNING (events built in the registered billing.v1 envelope-v2 shape)',
  },
  phases: [],
  tests: null,
  accepted: false,
};

async function checked(command, args, options = {}) {
  const result = await run(command, args, { cwd: ROOT, timeoutMs: 600_000, ...options });
  if (result.code !== 0 || result.signal || result.outcome !== 'exited')
    throw new Error(
      `${command} ${args[0] ?? ''} failed: ${redact(result.stderr || result.stdout).slice(-4000)}`,
    );
  return result;
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

async function hostPort(container, port) {
  const out = (await checked('docker', ['port', container, String(port)])).stdout
    .trim()
    .split('\n')[0];
  return Number(out.split(':').at(-1));
}

async function until(label, probe) {
  const deadline = Date.now() + 120_000;
  let last;
  while (Date.now() < deadline) {
    try {
      return await probe();
    } catch (error) {
      last = error;
      await delay(1_000);
    }
  }
  throw new Error(`${label} not ready: ${last?.message}`);
}

const started = [];
let exitCode = 1;
try {
  await phase('toolchain and source provenance', async () => {
    report.sourceSHA = (await checked('git', ['rev-parse', 'HEAD'])).stdout.trim();
    report.sourceTree = (await checked('git', ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
    report.sourceDirty =
      (await checked('git', ['status', '--porcelain', '--untracked-files=no'])).stdout.trim()
        .length > 0;
  });
  await phase('build wallet and specs from this source', async () => {
    await checked('pnpm', ['--filter', '@carwash/wallet', 'run', 'generate']);
    await checked('pnpm', ['--filter', '@carwash/wallet', 'run', 'build:tests']);
  });
  await phase('pull pinned images', async () => {
    const docker = (args, options = {}) =>
      run('docker', args, { cwd: ROOT, timeoutMs: 600_000, ...options });
    for (const image of Object.values(IMAGES))
      await pullImageWithMirrors(image, docker, { quiet: false });
  });
  await phase('start disposable PostgreSQL and RabbitMQ', async () => {
    started.push(names.pg);
    await checked('docker', [
      'run',
      '-d',
      '--name',
      names.pg,
      '-e',
      'POSTGRES_USER=cw_p05b_bootstrap',
      '-e',
      `POSTGRES_PASSWORD=${credentials.bootstrap}`,
      '-e',
      'CW_SERVICES=wallet',
      '-e',
      `WALLET_DB_PASSWORD=${credentials.app}`,
      '-e',
      `WALLET_MIGRATION_PASSWORD=${credentials.migration}`,
      '-v',
      `${path.join(ROOT, 'infra/postgres/provision.sh')}:/docker-entrypoint-initdb.d/01-provision.sh:ro`,
      '-p',
      '127.0.0.1::5432',
      IMAGES.postgres,
    ]);
    started.push(names.mq);
    await checked('docker', [
      'run',
      '-d',
      '--name',
      names.mq,
      '-e',
      'RABBITMQ_DEFAULT_USER=cw_p05b_wallet',
      '-e',
      `RABBITMQ_DEFAULT_PASS=${credentials.broker}`,
      '-p',
      '127.0.0.1::5672',
      IMAGES.rabbitmq,
    ]);
  });
  const pgPort = await hostPort(names.pg, 5432);
  const mqPort = await hostPort(names.mq, 5672);
  const appUrl = `postgresql://cw_wallet_app:${credentials.app}@127.0.0.1:${pgPort}/cw_wallet?schema=app`;
  const migrateUrl = `postgresql://cw_wallet_migrate:${credentials.migration}@127.0.0.1:${pgPort}/cw_wallet?schema=app`;
  const brokerUrl = `amqp://cw_p05b_wallet:${encodeURIComponent(credentials.broker)}@127.0.0.1:${mqPort}/`;

  await phase('runtime identity and broker reachable', async () => {
    await until('postgres', async () => {
      const client = new Client({ connectionString: appUrl, connectionTimeoutMillis: 3_000 });
      await client.connect();
      await client.end();
    });
    await until('rabbitmq', async () => {
      const connection = await amqplib.connect(brokerUrl);
      await connection.close();
    });
  });
  await phase('apply wallet migrations with the migration identity', async () => {
    // The provisioner restarts PostgreSQL once after init; retry the transient window.
    await until('migrate', () =>
      checked('pnpm', ['--filter', '@carwash/wallet', 'exec', 'prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: migrateUrl },
      }),
    );
  });
  await phase('real broker delivery into the Wallet projection (runtime role)', async () => {
    const result = await run(
      process.execPath,
      ['--test', '--test-reporter=spec', 'tests/production/B/wallet-broker.test.mjs'],
      {
        cwd: ROOT,
        timeoutMs: 600_000,
        env: {
          ...process.env,
          WALLET_TEST_DATABASE_URL: appUrl,
          WALLET_TEST_AMQP_URL: brokerUrl,
          LOG_LEVEL: 'error',
        },
      },
    );
    const out = redact(result.stdout);
    const summary = Object.fromEntries(
      [...out.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map((m) => [
        m[1],
        Number(m[2]),
      ]),
    );
    report.tests = {
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
        `BROKER_SUITE_FAILED: ${redact(result.stderr).slice(-3000)}\n${out.slice(-4000)}`,
      );
  });
  report.accepted = true;
  exitCode = 0;
} catch (error) {
  console.error(redact(String(error?.stack ?? error)).slice(0, 6000));
} finally {
  for (const name of started)
    await run('docker', ['rm', '-f', '-v', name], { cwd: ROOT, timeoutMs: 120_000 }).catch(
      () => {},
    );
  report.finishedAt = new Date().toISOString();
  const json = JSON.stringify(report, null, 2) + '\n';
  const work = path.join(ROOT, '.acceptance', `cw-p05b-wallet-broker-${runId}`);
  await mkdir(work, { recursive: true });
  await writeFile(path.join(work, 'report.json'), json);
  if (record) {
    const out = path.join(ROOT, 'docs/production/B/evidence');
    await mkdir(out, { recursive: true });
    await writeFile(
      path.join(out, `wallet-broker-${report.sourceSHA?.slice(0, 12) ?? 'unknown'}.json`),
      json,
    );
  }
  console.log(
    `${report.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}: wallet broker acceptance (${path.relative(ROOT, work)}/report.json)`,
  );
  process.exit(exitCode);
}
