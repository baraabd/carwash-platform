#!/usr/bin/env node
/**
 * Lane A production-provider acceptance on disposable, owned infrastructure.
 *
 *   node scripts/production/A/acceptance-a.mjs --services customer[,vehicle,geo] [--keep]
 *
 * Starts ONE scoped compose project (PostgreSQL 16 with the repository's own
 * least-privilege provisioning script, plus Redis for the real Identity rate
 * budget), applies every migration with each service's MIGRATION identity,
 * proves the Prisma schema mirrors the migrated database, then runs the Lane A
 * integration suites against the real servers with each service's RUNTIME
 * identity. Nothing is mocked: Identity is the real Nest application.
 *
 * Secrets are generated per run, registered for redaction, kept in a 0600
 * context file under .acceptance/ (git-ignored) and removed on teardown. The
 * committed evidence summary contains no credential, DSN or personal data.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { redact, registerSecret, run } from '../../acceptance/lib/exec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LANE_SERVICES = ['customer', 'vehicle', 'geo'];
const SUITES = {
  customer: 'tests/production/A/customer.integration.test.mjs',
  vehicle: 'tests/production/A/vehicle.integration.test.mjs',
  geo: 'tests/production/A/geo.integration.test.mjs',
};
const PG_IMAGE = 'postgres:16.10-alpine';
const REDIS_IMAGE = 'redis:8.2.10-alpine';

const args = process.argv.slice(2);
const servicesArg = args[args.indexOf('--services') + 1] ?? '';
const services = servicesArg.split(',').filter(Boolean);
if (
  args.indexOf('--services') < 0 ||
  services.length === 0 ||
  services.some((service) => !LANE_SERVICES.includes(service))
) {
  console.error('usage: acceptance-a.mjs --services customer[,vehicle,geo] [--keep]');
  process.exit(2);
}
const keep = args.includes('--keep');

const project = `cw-p01a-${randomBytes(6).toString('hex')}`;
const work = path.join(ROOT, '.acceptance', project);
const composeFile = path.join(work, 'compose.json');
const evidenceDir = path.join(ROOT, 'docs', 'production', 'A', 'evidence');
const own = createRequire(path.join(ROOT, 'services/identity/package.json'));
const { Client } = own('pg');

const allServices = ['identity', ...services];
const secret = () => {
  const value = randomBytes(32).toString('base64url');
  registerSecret(value);
  return value;
};
const credentials = { bootstrap: secret(), redis: secret() };
for (const service of allServices) {
  credentials[`${service}_app`] = secret();
  credentials[`${service}_migrate`] = secret();
}

const report = {
  lane: 'A',
  task: 'P01-A',
  project,
  services,
  startedAt: new Date().toISOString(),
  node: process.version,
  images: {},
  source: {},
  phases: [],
  suites: [],
  scope:
    'Real PostgreSQL 16 (least-privilege roles from infra/postgres/provision.sh), real Redis, ' +
    'real Identity Nest application and real owner-service HTTP adapters on loopback. ' +
    'No broker relay, no gateway, no browser, no production deployment.',
};

async function checked(command, commandArgs, options = {}) {
  const result = await run(command, commandArgs, { cwd: ROOT, timeoutMs: 300_000, ...options });
  if (result.code !== 0 || result.signal || result.outcome !== 'exited') {
    throw new Error(
      `${command} ${commandArgs.slice(0, 3).join(' ')} failed (${result.code ?? result.signal}): ` +
        redact(result.stderr || result.stdout).slice(-6000),
    );
  }
  return result;
}

async function phase(name, operation) {
  const started = Date.now();
  try {
    const value = await operation();
    report.phases.push({ name, status: 'PASS', ms: Date.now() - started });
    console.log(`[PASS] ${name}`);
    return value;
  } catch (error) {
    const detail = redact(error instanceof Error ? error.message : String(error));
    report.phases.push({ name, status: 'FAIL', ms: Date.now() - started, detail });
    console.error(`[FAIL] ${name}: ${detail}`);
    throw error;
  }
}

const dc = (composeArgs, options) =>
  checked('docker', ['compose', '-p', project, '-f', composeFile, ...composeArgs], options);

function port(output) {
  const value = Number(output.trim().split(':').at(-1));
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('INVALID_PORT');
  return value;
}

async function sql(url, statement, values = []) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    return await client.query(statement, values);
  } finally {
    await client.end().catch(() => {});
  }
}

async function waitFor(operation, label) {
  const deadline = Date.now() + 90_000;
  let last;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      await delay(300);
    }
  }
  throw new Error(`${label} not ready: ${redact(String(last?.message ?? last))}`);
}

const dsn = (role, password, database, pgPort) =>
  `postgresql://${role}:${encodeURIComponent(password)}@127.0.0.1:${pgPort}/${database}?schema=app`;

let provisioned = false;
let exitCode = 1;
try {
  await mkdir(work, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });

  await phase('record exact source', async () => {
    report.source.head = (await checked('git', ['rev-parse', 'HEAD'])).stdout.trim();
    report.source.tree = (await checked('git', ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
    report.source.dirtyTrackedFiles = (
      await checked('git', ['status', '--porcelain', '--untracked-files=no'])
    ).stdout
      .split('\n')
      .filter(Boolean).length;
  });

  await phase('pin infrastructure images', async () => {
    for (const image of [PG_IMAGE, REDIS_IMAGE]) {
      await checked('docker', ['pull', image]);
      report.images[image] = JSON.parse(
        (await checked('docker', ['image', 'inspect', image, '--format', '{{json .RepoDigests}}']))
          .stdout,
      );
    }
  });

  const acl =
    `user default off\nuser cw_identity_rate on #${createHash('sha256').update(credentials.redis).digest('hex')} ` +
    '~identity:rate:* -@all +hello +auth +ping +quit +select +client|setinfo +client|setname +client|id +eval +incr +pexpire +pttl\n';
  await writeFile(path.join(work, 'users.acl'), acl, { mode: 0o644 });
  const pgEnvironment = {
    POSTGRES_USER: 'cw_p01a_bootstrap',
    POSTGRES_PASSWORD: credentials.bootstrap,
    CW_SERVICES: allServices.join(' '),
  };
  for (const service of allServices) {
    pgEnvironment[`${service.toUpperCase()}_DB_PASSWORD`] = credentials[`${service}_app`];
    pgEnvironment[`${service.toUpperCase()}_MIGRATION_PASSWORD`] =
      credentials[`${service}_migrate`];
  }
  await writeFile(
    composeFile,
    JSON.stringify(
      {
        services: {
          postgres: {
            image: PG_IMAGE,
            environment: pgEnvironment,
            ports: ['127.0.0.1::5432'],
            volumes: [
              `${path.join(ROOT, 'infra/postgres/provision.sh')}:/docker-entrypoint-initdb.d/01-provision.sh:ro`,
            ],
          },
          redis: {
            image: REDIS_IMAGE,
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
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  provisioned = true;
  await phase('start scoped disposable stack', () =>
    dc(['up', '-d', '--wait', '--wait-timeout', '120']),
  );
  const pgPort = port((await dc(['port', 'postgres', '5432'])).stdout);
  const redisPort = port((await dc(['port', 'redis', '6379'])).stdout);

  const urls = {};
  for (const service of allServices) {
    urls[service] = {
      app: dsn(`cw_${service}_app`, credentials[`${service}_app`], `cw_${service}`, pgPort),
      migrate: dsn(
        `cw_${service}_migrate`,
        credentials[`${service}_migrate`],
        `cw_${service}`,
        pgPort,
      ),
    };
    registerSecret(urls[service].app);
    registerSecret(urls[service].migrate);
  }

  await phase('PostgreSQL accepts every runtime identity', async () => {
    for (const service of allServices)
      await waitFor(() => sql(urls[service].app, 'SELECT 1'), service);
  });

  for (const service of allServices) {
    await phase(`${service}: migrate deploy with the migration identity`, () =>
      checked('pnpm', ['--filter', `@carwash/${service}`, 'exec', 'prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: urls[service].migrate },
      }),
    );
  }
  for (const service of services) {
    await phase(`${service}: Prisma schema mirrors the migrated database`, () =>
      checked(
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
        { env: { ...process.env, DATABASE_URL: urls[service].migrate } },
      ),
    );
  }

  const contextFile = path.join(work, 'context.json');
  await writeFile(
    contextFile,
    JSON.stringify({
      project,
      identityDatabaseUrl: urls.identity.app,
      redisUrl: `redis://cw_identity_rate:${credentials.redis}@127.0.0.1:${redisPort}/0`,
      services: Object.fromEntries(services.map((service) => [service, urls[service]])),
      crossServiceUrl: {
        role: `cw_${services[0]}_app`,
        database: 'cw_identity',
        url: dsn(`cw_${services[0]}_app`, credentials[`${services[0]}_app`], 'cw_identity', pgPort),
      },
    }),
    { mode: 0o600 },
  );

  const suites = services.map((service) => SUITES[service]);
  const result = await run(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-timeout=180000', '--test-reporter=spec', ...suites],
    {
      cwd: ROOT,
      timeoutMs: 900_000,
      env: { ...process.env, P01A_CONTEXT_FILE: contextFile },
    },
  );
  const output = redact(result.stdout + result.stderr);
  process.stdout.write(output);
  const count = (label) => Number(new RegExp(`ℹ ${label} (\\d+)`).exec(output)?.[1] ?? NaN);
  report.suites.push({
    files: suites,
    exit: result.code,
    tests: count('tests'),
    pass: count('pass'),
    fail: count('fail'),
    skipped: count('skipped'),
    todo: count('todo'),
    cancelled: count('cancelled'),
  });
  report.phases.push({ name: 'integration suites', status: result.code === 0 ? 'PASS' : 'FAIL' });
  exitCode = result.code === 0 ? 0 : 1;
} catch {
  exitCode = 1;
} finally {
  if (provisioned && !keep) {
    await dc(['down', '-v', '--remove-orphans']).catch((error) =>
      console.error(`teardown failed: ${redact(error.message)}`),
    );
  }
  if (!keep) await rm(work, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  report.result = exitCode === 0 ? 'PASSED' : 'FAILED';
  const file = path.join(evidenceDir, `${project}.json`);
  await writeFile(file, redact(JSON.stringify(report, null, 2)) + '\n');
  console.log(`evidence: ${path.relative(ROOT, file)} (${report.result})`);
  process.exit(exitCode);
}
