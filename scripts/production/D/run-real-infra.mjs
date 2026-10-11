#!/usr/bin/env node
/**
 * Lane D real-infrastructure gate.
 *
 * Runs against an ALREADY provisioned acceptance stack (a real PostgreSQL and a
 * real RabbitMQ). It provisions nothing and tears nothing down:
 *
 *   node scripts/dev/acceptance-infra.mjs up
 *   pnpm generate && pnpm build            # dist/ is what the suites load
 *   node scripts/production/D/run-real-infra.mjs [--suite <file-prefix>] [--evidence <file>]
 *
 * Steps, each of which fails the gate on its own:
 *   1. apply every committed migration of the involved services with the
 *      MIGRATION identity (never the runtime identity),
 *   2. harden runtime privileges exactly as the acceptance runner does,
 *   3. prove replaying the migrations yields schema.prisma (no drift),
 *   4. run the selected node:test suites serially (they share one cluster).
 *
 * Scope: one real PostgreSQL server and one single-node broker for this run.
 * Default mode is not a high-availability, browser, provider or production proof.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapSharedTopology } from '../../acceptance/lib/broker.mjs';
import { readContextFile } from '../../acceptance/lib/context.mjs';
import { registerSecret } from '../../acceptance/lib/exec.mjs';
import { testResults } from './test-results.mjs';
import {
  createShadowDatabase,
  dropShadowDatabase,
  hardenPrivileges,
  migrateDeploy,
  migrationDrift,
} from '../../acceptance/lib/migrations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Every Lane D real-infrastructure suite is a file in tests/production/D.
 * Discovery (rather than a list) keeps this runner byte-identical across the
 * independent child branches, so they merge in any order without conflict.
 */
const SUITE_DIR = 'tests/production/D';

/**
 * Browser journeys (`*.browser.mjs`) drive several real services and a real
 * Chromium. They run only with --browser, so the default gate stays a pure
 * persistence/broker/HTTP gate.
 */
async function discoverSuites(filter, browser) {
  const suffix = browser ? '.browser.mjs' : '.test.mjs';
  const files = (await readdir(path.join(ROOT, SUITE_DIR)))
    .filter((name) => name.endsWith(suffix) && (!filter || name.startsWith(filter)))
    .sort();
  return files.map((name) => `${SUITE_DIR}/${name}`);
}

/**
 * The probe producer (catalog) is migrated because the broker suites drive it.
 * Identity is migrated because the P02 suites authorize through the REAL
 * Identity service; Workforce because the admin journeys act on its records.
 * Support is Lane D's own exception-case service (P04-D1).
 */
const SERVICES = [
  'catalog',
  'communications',
  'reporting',
  'support',
  'configuration',
  'identity',
  'workforce',
];

/** Identity's rate budget needs Redis; the acceptance stack has none, so the gate owns one. */
const REDIS_IMAGE = 'redis:8.2.10-alpine';

function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * A disposable, loopback-only Redis with a least-privilege ACL user for
 * Identity's rate keys. The credential is generated per run, registered for
 * redaction and handed to the suites through the environment only.
 */
async function startRedis(context) {
  const aclSecret = randomBytes(24).toString('hex');
  registerSecret(aclSecret);
  const acl = path.join(context.workDir, 'lane-d-redis.acl');
  const digest = createHash('sha256').update(aclSecret).digest('hex');
  await writeFile(
    acl,
    'user default off\n' +
      `user cw_identity_rate on #${digest} ~identity:rate:* -@all +hello +auth +ping +quit ` +
      '+select +client|setinfo +client|setname +client|id +eval +incr +pexpire +pttl\n',
    { mode: 0o644 },
  );
  const name = `cw-lane-d-redis-${context.runId}`.toLowerCase();
  try {
    docker(['rm', '-f', name]);
  } catch {
    // Nothing left over from an earlier run.
  }
  docker([
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '-p',
    '127.0.0.1::6379',
    '-v',
    `${acl}:/run/cw/users.acl:ro`,
    REDIS_IMAGE,
    'redis-server',
    '--aclfile',
    '/run/cw/users.acl',
    '--save',
    '',
    '--appendonly',
    'no',
  ]);
  const port = Number(docker(['port', name, '6379/tcp']).split('\n')[0].split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('REDIS_PORT_UNKNOWN');
  const url = `redis://cw_identity_rate:${aclSecret}@127.0.0.1:${port}`;
  registerSecret(url);
  return {
    url,
    image: REDIS_IMAGE,
    stop: async () => {
      try {
        docker(['rm', '-f', name]);
      } finally {
        await rm(acl, { force: true });
      }
    },
  };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function contextFile() {
  if (process.env.CW_CONTEXT_FILE) return process.env.CW_CONTEXT_FILE;
  const pointer = path.join(ROOT, '.acceptance', 'current-dev-stack.json');
  const { contextFile: file } = JSON.parse(await readFile(pointer, 'utf8'));
  return file;
}

function must(result, step) {
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || '').slice(-2000);
    throw new Error(`${step} failed (exit ${result.code})\n${detail}`);
  }
}

async function prepareDatabases(context) {
  const steps = [];
  for (const service of SERVICES) {
    must(await migrateDeploy(context, service), `${service} migrate deploy`);
    must(await hardenPrivileges(context, service), `${service} privilege hardening`);
    const shadowName = `cw_shadow_d_${service}`;
    const shadowUrl = await createShadowDatabase(context, shadowName);
    try {
      must(await migrationDrift(context, service, { shadowUrl }), `${service} migration drift`);
    } finally {
      await dropShadowDatabase(context, shadowName);
    }
    steps.push({ service, migrateDeploy: 'PASSED', hardenPrivileges: 'PASSED', drift: 'NONE' });
  }
  return steps;
}

function runSuites(suites, env, browser) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(
      process.execPath,
      [
        '--test',
        '--test-concurrency=1',
        browser ? '--test-timeout=600000' : '--test-timeout=240000',
        '--test-reporter=spec',
        ...suites,
      ],
      { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.on('close', (code, signal) => resolve({ code, signal, output }));
  });
}

async function main() {
  const file = await contextFile();
  // The context records the worktree that CREATED the stack. Migrations must
  // come from the tree under test, or a reused stack would be migrated from a
  // different checkout than the code the suites load.
  const context = { ...(await readContextFile(file)), root: ROOT };
  const browser = process.argv.includes('--browser');
  const suites = await discoverSuites(option('suite'), browser);
  if (suites.length === 0) throw new Error('NO_SUITES_SELECTED');

  console.log(`Lane D real-infra gate: run ${context.runId}, suites ${suites.length}.`);
  const migrations = await prepareDatabases(context);
  // Shared exchange, declared by the infrastructure identity exactly as the
  // acceptance runner does before any producer or subscriber connects.
  await bootstrapSharedTopology(context);
  const redis = await startRedis(context);
  let result;
  try {
    result = await runSuites(
      suites,
      {
        ...process.env,
        CW_CONTEXT_FILE: file,
        CW_D_REDIS_URL: redis.url,
      },
      browser,
    );
  } finally {
    await redis.stop();
  }
  const tests = testResults(result.output, result.code, result.signal);
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

  const evidence = {
    gate: browser ? 'lane-d-browser' : 'lane-d-real-infra',
    sourceSha: git('rev-parse', 'HEAD'),
    sourceTree: git('rev-parse', 'HEAD^{tree}'),
    sourceDirty: git('status', '--porcelain', '--untracked-files=normal') !== '',
    runId: context.runId,
    images: { ...context.images, redis: REDIS_IMAGE },
    suites,
    suiteSha256: Object.fromEntries(
      await Promise.all(
        suites.map(async (suite) => [
          suite,
          createHash('sha256')
            .update(await readFile(path.join(ROOT, suite)))
            .digest('hex'),
        ]),
      ),
    ),
    migrations,
    tests,
    exitCode: result.code,
    scope: browser
      ? 'Real services and headless Chromium on one machine, against real PostgreSQL 16, ' +
        'single-node RabbitMQ 4 and a disposable Redis. Not HA, not a device matrix, not ' +
        'production proof.'
      : 'Real PostgreSQL 16, single-node RabbitMQ 4 and a disposable Redis (Identity rate ' +
        'budget only) for one ephemeral run. Not HA, not a provider, browser or production proof.',
  };
  const out = option('evidence');
  if (out) await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence.tests));
  process.exit(tests.accepted ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
