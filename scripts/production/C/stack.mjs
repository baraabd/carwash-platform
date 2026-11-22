#!/usr/bin/env node
/**
 * Lane C disposable real-infrastructure stack.
 *
 *   node scripts/production/C/stack.mjs up        # start + provision + migrate
 *   node scripts/production/C/stack.mjs migrate   # re-run migrate deploy only
 *   node scripts/production/C/stack.mjs restart-postgres
 *   node scripts/production/C/stack.mjs down      # remove exactly this run's containers
 *   node scripts/production/C/stack.mjs print     # non-secret summary
 *
 * What it gives the lane-C suites:
 *   - PostgreSQL 16 provisioned by the repository's own infra/postgres/provision.sh,
 *     so every service gets its own database, a DDL-capable migration role and a
 *     DML-only runtime role. Migrations are applied with the migration identity;
 *     the tests connect with the runtime identity.
 *   - RabbitMQ 4.2 for outbox relay evidence.
 *   - SeaweedFS (S3 API, SigV4) as the local/test S3-compatible object store.
 *
 * Safety: every container carries a run label and is named after the run id.
 * `down` removes only containers carrying this run's label. Nothing here is a
 * production deployment and none of these credentials are production secrets.
 * The context file holds per-run generated credentials and lives under the
 * gitignored .acceptance/ directory.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { pullImageWithMirrors } from '../../lib/image-references.mjs';
import { redact, registerSecret } from '../../acceptance/lib/exec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STATE_DIR = path.join(ROOT, '.acceptance', 'production-C');
const POINTER = path.join(STATE_DIR, 'current.json');

/** Pinned by digest so a run is reproducible and the evidence names exact bits. */
export const IMAGES = Object.freeze({
  postgres: 'postgres:16.10-alpine',
  rabbitmq: 'rabbitmq:4.2-management-alpine',
  s3: 'chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d',
});

export const LANE_SERVICES = Object.freeze([
  'scheduling',
  'workforce',
  'media',
  'booking',
  'dispatch',
]);

function run(command, args, { input, env, allowFailure = false, quiet = false, cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!quiet) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !allowFailure) {
        reject(
          new Error(`${command} ${args[0]} exited ${code}: ${redact(stderr).trim().slice(-400)}`),
        );
      } else resolve({ code, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function dockerResult(args, options = {}) {
  return run('docker', args, { quiet: true, allowFailure: true, ...options });
}

const secret = () => {
  const value = randomBytes(18).toString('base64url');
  registerSecret(value);
  return value;
};

/**
 * Explicit loopback host ports. Docker's ephemeral mapping (127.0.0.1::5432)
 * hands out a NEW host port when a container restarts, which would turn a
 * database-restart test into a "database moved" test.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function hostPort(container, port) {
  const { stdout } = await run('docker', ['port', container, `${port}/tcp`], { quiet: true });
  const line = stdout.split(/\r?\n/).find((x) => x.startsWith('127.0.0.1:'));
  if (!line) throw new Error(`NO_LOOPBACK_PORT ${container} ${port}`);
  return Number(line.split(':')[1]);
}

async function waitFor(label, probe, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (error) {
      last = error;
    }
    await delay(500);
  }
  throw new Error(`${label}_NOT_READY ${last instanceof Error ? last.message : ''}`);
}

export async function readContext(file = process.env.CW_PROD_C_CONTEXT) {
  const target = file ?? JSON.parse(await readFile(POINTER, 'utf8')).contextFile;
  return JSON.parse(await readFile(target, 'utf8'));
}

function dsn(user, password, port, database) {
  return `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}?schema=app`;
}

async function waitForPostgres(context) {
  // Provisioning runs inside the init phase; the runtime role of the LAST
  // service existing proves the whole loop completed (the script is set -eu).
  const last = LANE_SERVICES[LANE_SERVICES.length - 1];
  await waitFor('postgres', async () => {
    const result = await run(
      'docker',
      [
        'exec',
        context.containers.postgres,
        'psql',
        '-U',
        'platform_bootstrap',
        '-d',
        `cw_${last}`,
        '-tAc',
        `SELECT 1 FROM pg_roles WHERE rolname = 'cw_${last}_app'`,
      ],
      { allowFailure: true, quiet: true },
    );
    // The init phase restarts the server once; probe the TCP listener too.
    if (result.code !== 0 || result.stdout.trim() !== '1') return false;
    const tcp = await run(
      'docker',
      [
        'exec',
        context.containers.postgres,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'platform_bootstrap',
      ],
      { allowFailure: true, quiet: true },
    );
    return tcp.code === 0;
  });
}

async function up() {
  const runId = randomBytes(4).toString('hex');
  const workDir = path.join(STATE_DIR, runId);
  await mkdir(workDir, { recursive: true });
  const label = `carwash.production-c.run=${runId}`;
  const acceptanceLabel = `carwash.business-acceptance.run=${process.env.CW_BUSINESS_ACCEPTANCE_RUN ?? runId}`;
  const containers = {
    postgres: `cwprodc-${runId}-pg`,
    rabbitmq: `cwprodc-${runId}-mq`,
    s3: `cwprodc-${runId}-s3`,
  };
  const credentials = {
    postgres: secret(),
    rabbitmq: secret(),
    s3: { accessKey: `cwc${randomBytes(6).toString('hex')}`, secretKey: secret() },
    services: Object.fromEntries(
      LANE_SERVICES.map((service) => [service, { app: secret(), migrate: secret() }]),
    ),
  };
  registerSecret(credentials.s3.accessKey);

  const reserved = { postgres: await freePort(), rabbitmq: await freePort(), s3: await freePort() };
  // Persist cleanup ownership before the first container is created. A failed
  // image/start/readiness operation must still leave a scoped teardown target.
  const contextFile = path.join(workDir, 'context.json');
  await writeFile(contextFile, JSON.stringify({ runId, label, workDir, containers }), {
    mode: 0o600,
  });
  await writeFile(POINTER, JSON.stringify({ contextFile }), { mode: 0o600 });
  const serviceEnv = LANE_SERVICES.flatMap((service) => {
    const prefix = service.toUpperCase();
    return [
      '-e',
      `${prefix}_DB_PASSWORD=${credentials.services[service].app}`,
      '-e',
      `${prefix}_MIGRATION_PASSWORD=${credentials.services[service].migrate}`,
    ];
  });

  for (const image of Object.values(IMAGES)) {
    await pullImageWithMirrors(image, dockerResult, { quiet: false });
  }

  await run('docker', [
    'run',
    '-d',
    '--name',
    containers.postgres,
    '--label',
    label,
    '--label',
    acceptanceLabel,
    '-e',
    'POSTGRES_USER=platform_bootstrap',
    '-e',
    `POSTGRES_PASSWORD=${credentials.postgres}`,
    '-e',
    `CW_SERVICES=${LANE_SERVICES.join(' ')}`,
    ...serviceEnv,
    '-v',
    `${path.join(ROOT, 'infra', 'postgres', 'provision.sh')}:/docker-entrypoint-initdb.d/01-provision.sh:ro`,
    '-p',
    `127.0.0.1:${reserved.postgres}:5432`,
    IMAGES.postgres,
  ]);

  await run('docker', [
    'run',
    '-d',
    '--name',
    containers.rabbitmq,
    '--label',
    label,
    '--label',
    acceptanceLabel,
    '-e',
    'RABBITMQ_DEFAULT_USER=cw_prod_c',
    '-e',
    `RABBITMQ_DEFAULT_PASS=${credentials.rabbitmq}`,
    '-p',
    `127.0.0.1:${reserved.rabbitmq}:5672`,
    IMAGES.rabbitmq,
  ]);

  const s3Config = {
    identities: [
      {
        name: 'media-service',
        credentials: [{ accessKey: credentials.s3.accessKey, secretKey: credentials.s3.secretKey }],
        actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
      },
    ],
  };
  const s3ConfigFile = path.join(workDir, 's3.json');
  await writeFile(s3ConfigFile, JSON.stringify(s3Config), { mode: 0o600 });
  await run('docker', [
    'run',
    '-d',
    '--name',
    containers.s3,
    '--label',
    label,
    '--label',
    acceptanceLabel,
    '-v',
    `${s3ConfigFile}:/run/secrets/s3.json:ro`,
    '-p',
    `127.0.0.1:${reserved.s3}:8333`,
    '--entrypoint',
    '/bin/sh',
    IMAGES.s3,
    '-ec',
    // The pinned image's entrypoint drops to seaweed:seaweed (uid 1000).
    // GitHub's runner owns the host's 0600 secret under another uid. Keep
    // that bind mount private, copy it into the container with the correct
    // owner, then use the image's normal privilege-dropping entrypoint.
    'umask 077; cp /run/secrets/s3.json /etc/seaweedfs/s3.json; ' +
      'chown seaweed:seaweed /etc/seaweedfs/s3.json; ' +
      'chmod 600 /etc/seaweedfs/s3.json; exec /entrypoint.sh "$@"',
    'seaweed-private-config',
    'server',
    '-dir=/data',
    '-s3',
    '-s3.port=8333',
    '-s3.config=/etc/seaweedfs/s3.json',
  ]);

  const ports = {
    postgres: await hostPort(containers.postgres, 5432),
    rabbitmq: await hostPort(containers.rabbitmq, 5672),
    s3: await hostPort(containers.s3, 8333),
  };

  const context = {
    runId,
    label,
    workDir,
    containers,
    images: IMAGES,
    ports,
    brokerUrl: `amqp://cw_prod_c:${encodeURIComponent(credentials.rabbitmq)}@127.0.0.1:${ports.rabbitmq}/`,
    s3: {
      endpoint: `http://127.0.0.1:${ports.s3}`,
      region: 'us-east-1',
      accessKeyId: credentials.s3.accessKey,
      secretAccessKey: credentials.s3.secretKey,
    },
    bootstrapUrl: `postgresql://platform_bootstrap:${encodeURIComponent(credentials.postgres)}@127.0.0.1:${ports.postgres}/postgres`,
    databases: Object.fromEntries(
      LANE_SERVICES.map((service) => [
        service,
        {
          appUrl: dsn(
            `cw_${service}_app`,
            credentials.services[service].app,
            ports.postgres,
            `cw_${service}`,
          ),
          migrateUrl: dsn(
            `cw_${service}_migrate`,
            credentials.services[service].migrate,
            ports.postgres,
            `cw_${service}`,
          ),
        },
      ]),
    ),
  };
  await writeFile(contextFile, JSON.stringify(context, null, 2), { mode: 0o600 });
  await writeFile(POINTER, JSON.stringify({ contextFile }), { mode: 0o600 });

  await waitFor(
    's3_private_config',
    async () =>
      (
        await run(
          'docker',
          [
            'exec',
            '--user',
            'seaweed:seaweed',
            containers.s3,
            '/bin/sh',
            '-ec',
            'test -r /etc/seaweedfs/s3.json && test "$(stat -c %a /etc/seaweedfs/s3.json)" = 600',
          ],
          { quiet: true, allowFailure: true },
        )
      ).code === 0,
    15000,
  );

  await waitForPostgres(context);
  await waitFor(
    'rabbitmq',
    async () => {
      const result = await run(
        'docker',
        ['exec', containers.rabbitmq, 'rabbitmq-diagnostics', '-q', 'check_running'],
        { allowFailure: true, quiet: true },
      );
      return result.code === 0;
    },
    180_000,
  );
  await waitFor(
    's3',
    async () => {
      const response = await fetch(context.s3.endpoint, {
        signal: globalThis.AbortSignal.timeout(2_000),
      });
      // Unsigned request: a real S3 front end answers 403 AccessDenied.
      return response.status === 403 || response.status === 200;
    },
    120_000,
  );

  await migrate(context);
  console.log(JSON.stringify(summary(context, contextFile), null, 2));
}

export async function migrate(context, services = LANE_SERVICES) {
  for (const service of services) {
    // Equivalent to `pnpm --filter @carwash/<service> migrate:deploy`, invoked
    // through node so it also works where pnpm is a .cmd shim (Windows).
    const serviceDir = path.join(ROOT, 'services', service);
    await run(
      process.execPath,
      [path.join(serviceDir, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'],
      {
        env: { DATABASE_URL: context.databases[service].migrateUrl },
        quiet: true,
        cwd: serviceDir,
      },
    ).then(
      () => console.log(`migrated ${service}`),
      (error) => {
        throw new Error(`MIGRATE_FAILED ${service}: ${error.message}`);
      },
    );
    await hardenPrivileges(context, service);
  }
}

/**
 * Same post-migration hardening as scripts/acceptance/lib/migrations.mjs:
 * default privileges also granted the runtime role DML on _prisma_migrations,
 * which only exists once the first migration ran. Strip it, and any CREATE.
 */
async function hardenPrivileges(context, service) {
  const app = `cw_${service}_app`;
  const sql = `
DO $$
BEGIN
  IF to_regclass('app._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_TABLE_MISSING';
  END IF;
END
$$;
REVOKE ALL ON TABLE app._prisma_migrations FROM "${app}";
REVOKE CREATE ON SCHEMA app FROM "${app}";
REVOKE CREATE ON SCHEMA public FROM "${app}";
REVOKE ALL ON DATABASE cw_${service} FROM "${app}";
GRANT CONNECT ON DATABASE cw_${service} TO "${app}";
`;
  await run(
    'docker',
    [
      'exec',
      '-i',
      context.containers.postgres,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'platform_bootstrap',
      '-d',
      `cw_${service}`,
    ],
    { input: sql, quiet: true },
  );
}

async function restartPostgres(context) {
  await run('docker', ['restart', context.containers.postgres], { quiet: true });
  await waitForPostgres(context);
}

async function down() {
  let context;
  try {
    context = await readContext();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log('No owned lane C stack to remove');
    return;
  }
  const { stdout } = await run('docker', ['ps', '-aq', '--filter', `label=${context.label}`], {
    quiet: true,
  });
  const ids = stdout.split(/\s+/).filter(Boolean);
  if (ids.length > 0) await run('docker', ['rm', '-f', '-v', ...ids], { quiet: true });
  await rm(POINTER, { force: true });
  await rm(context.workDir, { recursive: true, force: true });
  console.log(`removed ${ids.length} container(s) for run ${context.runId}`);
}

function summary(context, contextFile) {
  return {
    runId: context.runId,
    containers: context.containers,
    images: context.images,
    ports: context.ports,
    contextFile,
  };
}

/** Read bounded logs only from this run, with generated credentials removed. */
async function failureDiagnostics() {
  let context;
  try {
    context = await readContext();
  } catch {
    return;
  }
  if (!/^[a-f0-9]{8}$/.test(context.runId)) return;
  for (const name of Object.values(context.containers ?? {})) {
    if (!new RegExp(`^cwprodc-${context.runId}-(pg|mq|s3)$`).test(name)) continue;
    const owner = await dockerResult([
      'inspect',
      '--format',
      '{{index .Config.Labels "carwash.production-c.run"}}',
      name,
    ]);
    if (owner.code !== 0 || owner.stdout.trim() !== context.runId) continue;
    const state = await dockerResult(['inspect', '--format', '{{json .State}}', name]);
    const logs = await dockerResult(['logs', '--tail', '80', name]);
    console.error(
      redact(`Owned container ${name}\n${state.stdout}\n${logs.stdout}\n${logs.stderr}`).slice(
        -12000,
      ),
    );
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const command = process.argv[2] ?? 'print';
  if (command === 'up') {
    try {
      await up();
    } catch (error) {
      await failureDiagnostics().catch(() => {});
      throw error;
    }
  } else if (command === 'migrate')
    await migrate(
      await readContext(),
      process.argv.slice(3).length ? process.argv.slice(3) : LANE_SERVICES,
    );
  else if (command === 'restart-postgres') await restartPostgres(await readContext());
  else if (command === 'down') await down();
  else if (command === 'print') {
    const context = await readContext();
    console.log(
      JSON.stringify(summary(context, path.join(context.workDir, 'context.json')), null, 2),
    );
  } else throw new Error(`UNKNOWN_COMMAND ${command}`);
}
