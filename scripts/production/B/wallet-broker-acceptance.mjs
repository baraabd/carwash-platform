#!/usr/bin/env node
/**
 * P06 Billing cash outbox -> production relay -> RabbitMQ -> production Wallet
 * custody consumer. Both owner databases use separate runtime/migration roles.
 * Identity/Pricing/Dispatch remain explicit upstream doubles. This disposable
 * acceptance is not a live payment-provider or production readiness approval.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { redact, registerSecret, run } from '../../acceptance/lib/exec.mjs';
import { pullImageWithMirrors } from '../../lib/image-references.mjs';
import { testResults } from '../../lib/test-results.mjs';
import {
  assertBrokerContainerNotExited,
  brokerContainerDiagnostics,
  ownedBrokerContainer,
} from './broker-diagnostics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const IMAGES = { postgres: 'postgres:16.10-alpine', rabbitmq: 'rabbitmq:4.2-management-alpine' };
const record = process.argv.includes('--record');
const runId = randomBytes(6).toString('hex');
const containerOwner = process.env.CW_BUSINESS_ACCEPTANCE_RUN ?? runId;
const names = { pg: `cw-p05b-wallet-pg-${runId}`, mq: `cw-p05b-wallet-mq-${runId}` };
const work = path.join(ROOT, '.acceptance', `cw-p05b-wallet-broker-${runId}`);
const secret = () => randomBytes(32).toString('base64url');
const credentials = {
  postgresBootstrap: secret(),
  brokerBootstrap: secret(),
  billingApp: secret(),
  billingMigration: secret(),
  billingBroker: secret(),
  walletApp: secret(),
  walletMigration: secret(),
  walletBroker: secret(),
};
Object.values(credentials).forEach(registerSecret);
const services = ['billing', 'wallet'];
const vhost = `cw-finance-${runId}`;
const { Client } = createRequire(path.join(ROOT, 'services/wallet/package.json'))('pg');
const amqplib = createRequire(path.join(ROOT, 'packages/platform-messaging/package.json'))(
  'amqplib',
);
const report = {
  task: 'P06-B',
  child: 'B-messaging',
  suite: 'wallet-broker',
  runId,
  startedAt: new Date().toISOString(),
  sourceSHA: null,
  sourceTree: null,
  sourceDirty: null,
  images: IMAGES,
  dependencies: {
    postgres: 'REAL pinned PostgreSQL; two owner databases, separate migration/runtime roles',
    broker:
      'REAL pinned RabbitMQ; distinct least-privilege Billing/Wallet identities, quorum custody queue and DLQ',
    billing: 'REAL Billing HTTP/application + committed outbox + production cash relay process',
    wallet: 'REAL production consumer process + own transactional custody projection',
    upstreams:
      'Identity and Pricing HTTP doubles; Dispatch WorkAuthority port double; synthetic fault envelopes clearly identified',
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
  const value = (await checked('docker', ['port', container, String(port)])).stdout
    .trim()
    .split('\n')[0];
  return Number(value.split(':').at(-1));
}
async function until(label, probe) {
  const deadline = Date.now() + 120_000;
  let last;
  while (Date.now() < deadline) {
    try {
      return await probe();
    } catch (error) {
      if (error.code === 'ACCEPTANCE_CONTAINER_EXITED') throw error;
      last = error;
      await delay(1_000);
    }
  }
  throw new Error(`${label} not ready: ${redact(last?.message)}`);
}
const started = [];
let exitCode = 1;
try {
  await mkdir(work, { recursive: true });
  await phase('toolchain and source provenance', async () => {
    report.sourceSHA = (await checked('git', ['rev-parse', 'HEAD'])).stdout.trim();
    report.sourceTree = (await checked('git', ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
    report.sourceDirty =
      (await checked('git', ['status', '--porcelain', '--untracked-files=no'])).stdout.trim()
        .length > 0;
  });
  await phase('build both production workers and owner HTTP test harnesses', async () => {
    await checked('pnpm', ['--filter', '@carwash/platform-messaging', 'run', 'build']);
    for (const service of services) {
      for (const command of ['generate', 'build', 'build:tests'])
        await checked('pnpm', ['--filter', `@carwash/${service}`, 'run', command]);
    }
  });
  await phase('pull pinned images', async () => {
    const docker = (args, options = {}) =>
      run('docker', args, { cwd: ROOT, timeoutMs: 600_000, ...options });
    for (const image of Object.values(IMAGES))
      await pullImageWithMirrors(image, docker, { quiet: false });
  });
  await phase('start isolated PostgreSQL and RabbitMQ', async () => {
    started.push(names.pg);
    await checked('docker', [
      'run',
      '-d',
      '--name',
      names.pg,
      '--label',
      `carwash.business-acceptance.run=${containerOwner}`,
      '-e',
      'POSTGRES_USER=cw_finance_bootstrap',
      '-e',
      `POSTGRES_PASSWORD=${credentials.postgresBootstrap}`,
      '-e',
      'CW_SERVICES=billing wallet',
      '-e',
      `BILLING_DB_PASSWORD=${credentials.billingApp}`,
      '-e',
      `BILLING_MIGRATION_PASSWORD=${credentials.billingMigration}`,
      '-e',
      `WALLET_DB_PASSWORD=${credentials.walletApp}`,
      '-e',
      `WALLET_MIGRATION_PASSWORD=${credentials.walletMigration}`,
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
      '--label',
      `carwash.business-acceptance.run=${containerOwner}`,
      '-e',
      'RABBITMQ_DEFAULT_USER=cw_finance_bootstrap',
      '-e',
      `RABBITMQ_DEFAULT_PASS=${credentials.brokerBootstrap}`,
      '-v',
      `${path.join(ROOT, 'infra/rabbitmq/billing-wallet-bootstrap.sh')}:/finance-bootstrap.sh:ro`,
      '-p',
      '127.0.0.1::5672',
      IMAGES.rabbitmq,
    ]);
  });
  const pgPort = await hostPort(names.pg, 5432);
  const mqPort = await hostPort(names.mq, 5672);
  const appUrl = (service) =>
    `postgresql://cw_${service}_app:${credentials[`${service}App`]}@127.0.0.1:${pgPort}/cw_${service}?schema=app`;
  const migrateUrl = (service) =>
    `postgresql://cw_${service}_migrate:${credentials[`${service}Migration`]}@127.0.0.1:${pgPort}/cw_${service}?schema=app`;
  const brokerUrl = (service) =>
    `amqp://cw_${service}_app:${credentials[`${service}Broker`]}@127.0.0.1:${mqPort}/${encodeURIComponent(vhost)}`;
  for (const service of services)
    [appUrl(service), migrateUrl(service), brokerUrl(service)].forEach(registerSecret);
  await phase(
    'provision least-privilege broker identities and remove disposable bootstrap login',
    async () => {
      await until('rabbitmq', async () => {
        const container = await ownedBrokerContainer(
          (args) => run('docker', args, { cwd: ROOT, timeoutMs: 10_000 }),
          names.mq,
          containerOwner,
        );
        assertBrokerContainerNotExited(container);
        return checked(
          'docker',
          [
            'exec',
            '--user',
            'rabbitmq',
            container.id,
            'sh',
            '-ec',
            // A root CLI can create a root-owned cookie before the server has
            // initialized its own. Wait for the server-created file, then run
            // every Erlang CLI with the same OS identity as the server.
            'test -s /var/lib/rabbitmq/.erlang.cookie && exec rabbitmq-diagnostics -q check_running',
          ],
          {
            timeoutMs: 15_000,
          },
        );
      });
      await checked('docker', [
        'exec',
        '--user',
        'rabbitmq',
        '-e',
        `CW_FINANCE_VHOST=${vhost}`,
        '-e',
        `BILLING_BROKER_PASSWORD=${credentials.billingBroker}`,
        '-e',
        `WALLET_BROKER_PASSWORD=${credentials.walletBroker}`,
        names.mq,
        'sh',
        '/finance-bootstrap.sh',
      ]);
      await checked('docker', [
        'exec',
        '--user',
        'rabbitmq',
        names.mq,
        'rabbitmqctl',
        'delete_user',
        'cw_finance_bootstrap',
      ]);
      const users = (
        await checked('docker', [
          'exec',
          '--user',
          'rabbitmq',
          names.mq,
          'rabbitmqctl',
          '-q',
          'list_users',
        ])
      ).stdout;
      assert.match(users, /^cw_billing_app\s+\[\]\s*$/m);
      assert.match(users, /^cw_wallet_app\s+\[\]\s*$/m);
      assert.doesNotMatch(users, /administrator|cw_finance_bootstrap/);
      await writeFile(path.join(work, 'broker-identities.log'), users);
    },
  );
  await phase('Erlang cookie belongs to the broker user and stays private', async () => {
    const metadata = (
      await checked('docker', [
        'exec',
        '--user',
        'rabbitmq',
        names.mq,
        'stat',
        '-c',
        '%U %a',
        '/var/lib/rabbitmq/.erlang.cookie',
      ])
    ).stdout.trim();
    const [owner, mode] = metadata.split(/\s+/);
    assert.equal(owner, 'rabbitmq');
    assert.match(mode, /^[0-7]{3,4}$/);
    assert.equal(Number.parseInt(mode, 8) & 0o077, 0, 'Erlang cookie must stay owner-only');
    assert.notEqual(Number.parseInt(mode, 8) & 0o400, 0, 'Broker owner must read its cookie');
    // Record metadata only; never read or emit the cluster authentication secret.
    await writeFile(path.join(work, 'broker-cookie-permissions.log'), `${metadata}\n`);
  });
  await phase('owner runtime identities reach only their own services', async () => {
    for (const service of services) {
      await until(`${service} postgres`, async () => {
        const client = new Client({
          connectionString: appUrl(service),
          connectionTimeoutMillis: 3_000,
        });
        try {
          await client.connect();
        } finally {
          await client.end();
        }
      });
      const connection = await amqplib.connect(brokerUrl(service));
      await connection.close();
    }
  });
  await phase('migrate both owners then harden runtime grants', async () => {
    for (const service of services)
      await until(`${service} migrate`, () =>
        checked('pnpm', ['--filter', `@carwash/${service}`, 'run', 'migrate:deploy'], {
          env: { ...process.env, DATABASE_URL: migrateUrl(service) },
        }),
      );
    await checked('docker', [
      'exec',
      names.pg,
      'sh',
      '/docker-entrypoint-initdb.d/01-provision.sh',
    ]);
    for (const service of services) {
      const client = new Client({ connectionString: appUrl(service) });
      await client.connect();
      try {
        await assert.rejects(
          () => client.query('SELECT * FROM app._prisma_migrations'),
          /permission denied/,
        );
      } finally {
        await client.end();
      }
    }
  });
  await phase(
    'real owner workers: delivery, crashes, duplicate, order, poison, bounded retry and broker ACL',
    async () => {
      const result = await run(
        process.execPath,
        ['--test', '--test-reporter=spec', 'tests/production/B/wallet-broker.test.mjs'],
        {
          cwd: ROOT,
          timeoutMs: 600_000,
          env: {
            ...process.env,
            BILLING_TEST_DATABASE_URL: appUrl('billing'),
            WALLET_TEST_DATABASE_URL: appUrl('wallet'),
            BILLING_TEST_AMQP_URL: brokerUrl('billing'),
            WALLET_TEST_AMQP_URL: brokerUrl('wallet'),
            CW_WALLET_BROKER_LOG_DIR: path.join(work, 'workers'),
            LOG_LEVEL: 'error',
          },
        },
      );
      const output = redact(result.stdout);
      const errors = redact(result.stderr);
      await writeFile(path.join(work, 'tests.log'), `${output}\n${errors}`);
      const summary = testResults(output, result.code, result.signal);
      report.tests = {
        summary,
        names: [...output.matchAll(/^\s*[✔✖] (.+?) \(/gm)].map((match) => match[1]),
      };
      process.stdout.write(
        output
          .split('\n')
          .filter((line) => /^\s*[✔✖ℹ]/.test(line))
          .join('\n') + '\n',
      );
      if (!summary.accepted || result.outcome !== 'exited')
        throw new Error(`BROKER_SUITE_FAILED: ${errors.slice(-3000)}\n${output.slice(-6000)}`);
    },
  );
  report.accepted = true;
  exitCode = 0;
} catch (error) {
  console.error(redact(String(error?.stack ?? error)).slice(0, 6000));
} finally {
  if (!report.accepted) {
    const diagnostics = [];
    for (const name of started) {
      try {
        diagnostics.push(
          await brokerContainerDiagnostics(
            (args) => run('docker', args, { cwd: ROOT, timeoutMs: 10_000 }),
            name,
            containerOwner,
            redact,
          ),
        );
      } catch (error) {
        diagnostics.push(redact(`Startup diagnostics unavailable: ${error.message}`));
      }
    }
    const detail = diagnostics.join('\n\n') + '\n';
    try {
      await writeFile(path.join(work, 'infrastructure.log'), detail);
    } catch (error) {
      console.error(redact(`Cannot retain startup diagnostic file: ${error.message}`));
    }
    // The outer runner retains this command's stderr even when child reports
    // cannot be accepted. Keep the actual startup fault visible in that artifact.
    console.error(detail);
  }
  for (const name of started)
    await run('docker', ['rm', '-f', '-v', name], { cwd: ROOT, timeoutMs: 120_000 }).catch(
      () => {},
    );
  report.finishedAt = new Date().toISOString();
  const json = JSON.stringify(report, null, 2) + '\n';
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
