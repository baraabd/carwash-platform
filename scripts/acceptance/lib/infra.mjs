/**
 * Ephemeral acceptance infrastructure.
 *
 * Safety rules encoded here:
 *   - every docker command is scoped with `-p <project>`; there is no global
 *     prune, no `docker volume rm` by pattern and no `docker rm` of anything
 *     this run did not create,
 *   - the docker context and daemon are identified and recorded BEFORE any
 *     command that can change data,
 *   - image digests are read back from the daemon after pulling rather than
 *     being written down by hand,
 *   - cleanup failure is reported as a failure; it is never swallowed.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { run, runOrThrow } from './exec.mjs';
import { childEnv } from './context.mjs';

function composeArgs(context) {
  return [
    'compose',
    '-p',
    context.project,
    '-f',
    context.composeFile,
    '--env-file',
    context.envFile,
  ];
}

export async function dockerEnvironment(context) {
  const version = await run('docker', ['version', '--format', '{{json .}}'], {
    cwd: context.root,
    timeoutMs: 60_000,
  });
  const info = await run(
    'docker',
    [
      'info',
      '--format',
      '{{.Name}}|{{.ServerVersion}}|{{.OSType}}|{{.Architecture}}|{{.DockerRootDir}}',
    ],
    { cwd: context.root, timeoutMs: 60_000 },
  );
  const ctx = await run('docker', ['context', 'show'], { cwd: context.root, timeoutMs: 60_000 });
  const compose = await run('docker', ['compose', 'version', '--short'], {
    cwd: context.root,
    timeoutMs: 60_000,
  });
  if (version.code !== 0 || info.code !== 0) {
    const error = new Error('DOCKER_DAEMON_UNAVAILABLE');
    error.result = info.code !== 0 ? info : version;
    throw error;
  }
  const [name, serverVersion, osType, architecture, rootDir] = info.stdout.trim().split('|');
  return {
    context: ctx.stdout.trim(),
    daemon: { name, serverVersion, osType, architecture, rootDir },
    composeVersion: compose.stdout.trim(),
  };
}

/** Pull each pinned tag and read back the digest the daemon actually resolved. */
export async function resolveImageDigests(context) {
  const digests = {};
  for (const [key, reference] of Object.entries(context.images)) {
    await runOrThrow('docker', ['pull', '--quiet', reference], {
      cwd: context.root,
      timeoutMs: 15 * 60 * 1000,
    });
    const inspected = await runOrThrow(
      'docker',
      ['image', 'inspect', reference, '--format', '{{json .RepoDigests}}|{{.Id}}'],
      { cwd: context.root, timeoutMs: 60_000 },
    );
    const [repoDigests, imageId] = inspected.stdout.trim().split('|');
    digests[key] = {
      reference,
      // Whatever the registry actually served. Never hand-written.
      repoDigests: JSON.parse(repoDigests),
      imageId,
    };
  }
  context.resolvedDigests = digests;
  return digests;
}

export async function composeUp(context, signal) {
  return runOrThrow(
    'docker',
    [...composeArgs(context), 'up', '-d', '--wait', '--wait-timeout', '180'],
    {
      cwd: context.root,
      env: childEnv(context),
      timeoutMs: 10 * 60 * 1000,
      signal,
    },
  );
}

export async function composePs(context) {
  return run('docker', [...composeArgs(context), 'ps', '--format', 'json'], {
    cwd: context.root,
    env: childEnv(context),
    timeoutMs: 60_000,
  });
}

export async function composeLogs(context, service) {
  return run('docker', [...composeArgs(context), 'logs', '--no-color', '--tail', '400', service], {
    cwd: context.root,
    env: childEnv(context),
    timeoutMs: 120_000,
  });
}

/** Scoped teardown: this project's containers, networks and volumes, nothing else. */
export async function composeDown(context) {
  return run('docker', [...composeArgs(context), 'down', '-v', '--remove-orphans', '-t', '30'], {
    cwd: context.root,
    env: childEnv(context),
    timeoutMs: 5 * 60 * 1000,
  });
}

export async function containerId(context, service) {
  const result = await run('docker', [...composeArgs(context), 'ps', '-q', service], {
    cwd: context.root,
    env: childEnv(context),
    timeoutMs: 60_000,
  });
  return result.stdout.trim().split('\n').filter(Boolean)[0] ?? null;
}

/** Run a command inside a compose service without a shell on the host side. */
export async function composeExec(context, service, argv, options = {}) {
  return run('docker', [...composeArgs(context), 'exec', '-T', service, ...argv], {
    cwd: context.root,
    env: childEnv(context, options.env ?? {}),
    timeoutMs: options.timeoutMs ?? 5 * 60 * 1000,
    signal: options.signal,
    input: options.input,
  });
}

export async function stopService(context, service, timeoutSeconds = 20) {
  return runOrThrow(
    'docker',
    [...composeArgs(context), 'stop', '-t', String(timeoutSeconds), service],
    {
      cwd: context.root,
      env: childEnv(context),
      timeoutMs: 3 * 60 * 1000,
    },
  );
}

export async function startService(context, service) {
  return runOrThrow('docker', [...composeArgs(context), 'start', service], {
    cwd: context.root,
    env: childEnv(context),
    timeoutMs: 3 * 60 * 1000,
  });
}

/**
 * Wait for an observable condition rather than sleeping a guessed interval.
 * A fixed sleep either wastes time or hides a race; this polls the real state.
 */
export async function waitFor(description, probe, { timeoutMs = 120_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  const error = new Error(`WAIT_TIMEOUT: ${description}`);
  error.cause = lastError;
  throw error;
}

export async function waitForRabbitReady(context, signal) {
  return waitFor(
    'rabbitmq check_running',
    async () => {
      const result = await composeExec(
        context,
        'rabbitmq',
        ['rabbitmq-diagnostics', '-q', 'check_running'],
        { timeoutMs: 60_000, signal },
      );
      return result.code === 0;
    },
    { timeoutMs: 180_000, intervalMs: 2000 },
  );
}

export async function waitForPostgresReady(context, signal) {
  return waitFor(
    'pg_isready',
    async () => {
      const result = await composeExec(
        context,
        'postgres',
        ['pg_isready', '-U', 'cw_acceptance_bootstrap', '-d', 'postgres'],
        { timeoutMs: 60_000, signal },
      );
      return result.code === 0;
    },
    { timeoutMs: 180_000, intervalMs: 1000 },
  );
}

/** Provision the least-privilege broker identities. */
export async function bootstrapRabbitIdentities(context, signal) {
  const env = {
    CW_VHOST: context.vhost,
    CW_INFRA_PASSWORD: context.credentials.rabbitInfra,
    CATALOG_BROKER_PASSWORD: context.credentials.catalog_broker,
    COMMUNICATIONS_BROKER_PASSWORD: context.credentials.communications_broker,
    REPORTING_BROKER_PASSWORD: context.credentials.reporting_broker,
  };
  const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return run(
    'docker',
    [
      ...composeArgs(context),
      'exec',
      '-T',
      ...envArgs,
      'rabbitmq',
      'sh',
      '/opt/cw/acceptance-bootstrap.sh',
    ],
    {
      cwd: context.root,
      env: childEnv(context),
      timeoutMs: 5 * 60 * 1000,
      signal,
    },
  );
}

/** psql as the acceptance bootstrap superuser, inside the container. */
export async function psqlBootstrap(context, database, sql, options = {}) {
  return run(
    'docker',
    [
      ...composeArgs(context),
      'exec',
      '-T',
      '-e',
      `PGPASSWORD=${context.credentials.postgresBootstrap}`,
      'postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'cw_acceptance_bootstrap',
      '-d',
      database,
      '-t',
      '-A',
      '-f',
      '-',
    ],
    {
      cwd: context.root,
      env: childEnv(context),
      timeoutMs: options.timeoutMs ?? 2 * 60 * 1000,
      signal: options.signal,
      input: sql,
    },
  );
}
