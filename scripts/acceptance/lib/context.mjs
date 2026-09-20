/**
 * Run context: identity, paths, ports and per-run credentials.
 *
 * Everything an acceptance run touches is namespaced by the run id, so cleanup
 * can be scoped to exactly this run and can never remove another project's
 * containers, volumes or databases.
 *
 * Credentials are generated per run, written only to a git-ignored directory,
 * and registered with the redactor before they are used anywhere.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSecret } from './exec.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Image references are pinned by tag here and resolved to a digest at run time. */
export const IMAGES = {
  postgres: 'postgres:16.10-alpine',
  rabbitmq: 'rabbitmq:4.2-management-alpine',
  node: 'node:24.21.0-bookworm-slim',
};

export const SERVICES = [
  'identity',
  'customer',
  'catalog',
  'workforce',
  'booking',
  'billing',
  'media',
  'communications',
  'support',
  'reporting',
];

/** Services that take part in the Sprint 0.2 messaging slice. */
export const BROKER_SERVICES = ['catalog', 'communications', 'reporting'];

function password() {
  // URL-safe so it can be embedded in a DSN without escaping surprises.
  return randomBytes(24).toString('base64url');
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    // Port 0 asks the OS for a port that is genuinely free right now.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function createRunContext(options = {}) {
  const runId =
    options.runId ??
    `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8)}`;
  const project = `cw-s02-${runId}`.toLowerCase();

  const [pgPort, rabbitPort, rabbitMgmtPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);

  const credentials = {
    postgresBootstrap: password(),
    rabbitBootstrap: password(),
    rabbitInfra: password(),
  };
  for (const service of SERVICES) {
    credentials[`${service}_db`] = password();
    credentials[`${service}_migration`] = password();
  }
  for (const service of BROKER_SERVICES) {
    credentials[`${service}_broker`] = password();
  }
  for (const value of Object.values(credentials)) registerSecret(value);

  const workDir = path.join(ROOT, '.acceptance', runId);
  const evidenceDir = path.join(ROOT, 'evidence', 'acceptance', runId);
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(evidenceDir, 'logs'), { recursive: true });

  const context = {
    runId,
    project,
    startedAt: new Date().toISOString(),
    root: ROOT,
    workDir,
    evidenceDir,
    logsDir: path.join(evidenceDir, 'logs'),
    composeFile: path.join(ROOT, 'infra', 'compose.acceptance.yml'),
    envFile: path.join(workDir, 'acceptance.env'),
    images: { ...IMAGES },
    resolvedDigests: {},
    ports: { postgres: pgPort, rabbitmq: rabbitPort, rabbitmqManagement: rabbitMgmtPort },
    vhost: 'washgo-acceptance',
    credentials,
    services: SERVICES,
    brokerServices: BROKER_SERVICES,
  };

  await writeEnvFile(context);
  return context;
}

/**
 * The compose env file. It contains generated secrets and therefore lives under
 * .acceptance/ which is git-ignored and is never copied into evidence.
 */
export async function writeEnvFile(context) {
  const lines = [
    '# Generated per acceptance run. Ephemeral, git-ignored, never committed.',
    `CW_PROJECT=${context.project}`,
    `CW_SERVICES=${context.services.join(' ')}`,
    `CW_POSTGRES_IMAGE=${context.images.postgres}`,
    `CW_RABBITMQ_IMAGE=${context.images.rabbitmq}`,
    `CW_PG_PORT=${context.ports.postgres}`,
    `CW_RABBIT_PORT=${context.ports.rabbitmq}`,
    `CW_RABBIT_MGMT_PORT=${context.ports.rabbitmqManagement}`,
    `POSTGRES_BOOTSTRAP_PASSWORD=${context.credentials.postgresBootstrap}`,
    `RABBITMQ_BOOTSTRAP_PASSWORD=${context.credentials.rabbitBootstrap}`,
  ];
  for (const service of context.services) {
    const prefix = service.toUpperCase();
    lines.push(`${prefix}_DB_PASSWORD=${context.credentials[`${service}_db`]}`);
    lines.push(`${prefix}_MIGRATION_PASSWORD=${context.credentials[`${service}_migration`]}`);
  }
  await writeFile(context.envFile, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** DSN for a service's APPLICATION identity (DML only, own database only). */
export function appDsn(context, service) {
  const pw = encodeURIComponent(context.credentials[`${service}_db`]);
  return `postgresql://cw_${service}_app:${pw}@127.0.0.1:${context.ports.postgres}/cw_${service}?schema=app`;
}

/** DSN for a service's MIGRATION identity. Used only by migration jobs. */
export function migrationDsn(context, service) {
  const pw = encodeURIComponent(context.credentials[`${service}_migration`]);
  return `postgresql://cw_${service}_migrate:${pw}@127.0.0.1:${context.ports.postgres}/cw_${service}?schema=app`;
}

/** DSN for an arbitrary role/database pair, used by the negative isolation tests. */
export function crossDsn(context, role, rolePassword, database) {
  const pw = encodeURIComponent(rolePassword);
  return `postgresql://${role}:${pw}@127.0.0.1:${context.ports.postgres}/${database}`;
}

export function brokerUrl(context, service) {
  const pw = encodeURIComponent(context.credentials[`${service}_broker`]);
  return `amqp://cw_${service}_app:${pw}@127.0.0.1:${context.ports.rabbitmq}/${encodeURIComponent(context.vhost)}`;
}

export function infraBrokerUrl(context) {
  const pw = encodeURIComponent(context.credentials.rabbitInfra);
  return `amqp://cw_infra_topology:${pw}@127.0.0.1:${context.ports.rabbitmq}/${encodeURIComponent(context.vhost)}`;
}

/** Arbitrary identity, for ACL denial tests. */
export function brokerUrlAs(context, user, userPassword) {
  const pw = encodeURIComponent(userPassword);
  return `amqp://${user}:${pw}@127.0.0.1:${context.ports.rabbitmq}/${encodeURIComponent(context.vhost)}`;
}

/** The environment child processes receive: run config, never a stray secret. */
export function childEnv(context, extra = {}) {
  return {
    ...process.env,
    CW_RUN_ID: context.runId,
    CW_PROJECT: context.project,
    CW_VHOST: context.vhost,
    CW_PG_PORT: String(context.ports.postgres),
    CW_RABBIT_PORT: String(context.ports.rabbitmq),
    CW_RABBIT_MGMT_PORT: String(context.ports.rabbitmqManagement),
    CW_CONTEXT_FILE: path.join(context.workDir, 'context.json'),
    ...extra,
  };
}

/**
 * Written for the integration test processes. Contains credentials, so it stays
 * in the git-ignored working directory alongside the compose env file.
 */
export async function writeContextFile(context) {
  const file = path.join(context.workDir, 'context.json');
  await writeFile(file, JSON.stringify(context, null, 2), { encoding: 'utf8', mode: 0o600 });
  return file;
}

export async function readContextFile(file = process.env.CW_CONTEXT_FILE) {
  if (!file) throw new Error('CW_CONTEXT_FILE_REQUIRED');
  const context = JSON.parse(await readFile(file, 'utf8'));
  for (const value of Object.values(context.credentials)) registerSecret(value);
  return context;
}
