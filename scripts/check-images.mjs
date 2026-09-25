#!/usr/bin/env node
/**
 * Builds and boots service container images, then verifies the properties the
 * Dockerfile claims.
 *
 * What it proves, per service:
 *   - the image builds from the pinned Node base with a frozen lockfile,
 *   - the container runs as a NON-ROOT user,
 *   - liveness answers 200 once the process is up,
 *   - readiness answers 503, because a foundation shell has no business API.
 *     A 200 here would be the failure: it would mean the shell is advertising a
 *     readiness it does not have,
 *   - SIGTERM is received by PID 1 and the process exits promptly and cleanly,
 *     which only happens because there is no shell wrapper in the CMD,
 *   - no .env file and no .acceptance directory were copied into the image.
 *
 * Every container is named for this run and removed afterwards; nothing that
 * this script did not create is ever touched.
 *
 *   node scripts/check-images.mjs                     default service set
 *   node scripts/check-images.mjs catalog reporting   explicit services
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { run } from './acceptance/lib/exec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Must match the Dockerfile default and the image the acceptance run pins. */
const NODE_IMAGE = 'node:24.21.0-bookworm-slim';

/** The Sprint 0.2 messaging slice; enough to prove the shared Dockerfile works. */
const DEFAULT_SERVICES = ['catalog', 'communications', 'reporting'];

/**
 * Generous by default because the slow step is `pnpm install` inside the build,
 * and its duration is dominated by download throughput to the registry from
 * inside the container - which on a desktop Docker VM can be an order of
 * magnitude slower than on the host. A timeout here reports a build failure that
 * is really a network condition, so it is configurable rather than tight.
 */
const DOCKER_TIMEOUT_MS = Number(process.env.CW_IMAGE_TIMEOUT_MS ?? 60 * 60 * 1000);

const runId = randomUUID().slice(0, 8);

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function docker(args, options = {}) {
  return run('docker', args, { cwd: ROOT, timeoutMs: DOCKER_TIMEOUT_MS, ...options });
}

function fail(service, check, detail) {
  return { service, check, ok: false, detail };
}

function pass(service, check, detail = '') {
  return { service, check, ok: true, detail };
}

async function buildImage(service, tag) {
  const result = await docker([
    'build',
    '--file',
    'Dockerfile',
    '--build-arg',
    `SERVICE=${service}`,
    '--build-arg',
    `NODE_IMAGE=${NODE_IMAGE}`,
    '--tag',
    tag,
    '.',
  ]);
  return result;
}

/** Poll an endpoint from INSIDE the container, so no port has to be published. */
async function probe(container, pathname) {
  const script =
    `fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'${pathname}')` +
    `.then(async r=>{process.stdout.write(r.status+' '+(await r.text()).slice(0,200));process.exit(0)})` +
    `.catch(e=>{process.stdout.write('ERR '+e.message);process.exit(1)})`;
  const result = await docker(['exec', container, 'node', '-e', script], { timeoutMs: 60_000 });
  return result.stdout.trim();
}

async function waitForLive(container, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const state = await docker(['inspect', '-f', '{{.State.Running}}', container], {
      timeoutMs: 30_000,
    });
    if (state.stdout.trim() !== 'true') {
      const logs = await docker(['logs', '--tail', '40', container], { timeoutMs: 30_000 });
      throw new Error(`container exited before becoming live:\n${logs.stdout}\n${logs.stderr}`);
    }
    last = await probe(container, '/health/live');
    if (last.startsWith('200')) return last;
    await delay(1500);
  }
  throw new Error(`liveness never returned 200; last response: ${last}`);
}

async function verifyService(service) {
  const tag = `cw-s02-image-check/${service}:${runId}`;
  const container = `cw-s02-imgcheck-${service}-${runId}`;
  const results = [];

  const built = await buildImage(service, tag);
  if (built.code !== 0) {
    results.push(
      fail(service, 'image builds', built.stderr.slice(-2000) || built.stdout.slice(-2000)),
    );
    return results;
  }
  results.push(pass(service, 'image builds', `from ${NODE_IMAGE}`));

  const port = await freePort();
  const started = await docker([
    'run',
    '--detach',
    '--name',
    container,
    // No published port is needed; probes run inside. Keeps CI hosts clean.
    '--env',
    'PORT=3000',
    '--env',
    'HOST=0.0.0.0',
    '--env',
    // The shell needs a well-formed DSN to boot, but never connects: nothing is
    // listening on this port. The password is the literal placeholder "changeme"
    // so that neither a reader nor the secret scan mistakes it for a credential.
    `DATABASE_URL=postgresql://cw_${service}_app:changeme@127.0.0.1:${port}/cw_${service}?schema=app`,
    '--env',
    'LOG_LEVEL=warn',
    tag,
  ]);
  if (started.code !== 0) {
    results.push(fail(service, 'container starts', started.stderr.slice(-2000)));
    await docker(['rm', '-f', container], { timeoutMs: 60_000 });
    await docker(['image', 'rm', '-f', tag], { timeoutMs: 120_000 });
    return results;
  }

  try {
    // ---- non-root ----
    const whoami = await docker(['exec', container, 'id', '-u'], { timeoutMs: 60_000 });
    const uid = whoami.stdout.trim();
    results.push(
      uid && uid !== '0'
        ? pass(service, 'runs as non-root', `uid=${uid}`)
        : fail(service, 'runs as non-root', `uid=${uid || 'unknown'}`),
    );

    // ---- liveness ----
    try {
      const live = await waitForLive(container);
      results.push(pass(service, 'liveness returns 200', live.slice(0, 80)));
    } catch (error) {
      const logs = await docker(['logs', '--tail', '40', container], { timeoutMs: 30_000 });
      results.push(
        fail(service, 'liveness returns 200', `${error.message}\n${logs.stdout}${logs.stderr}`),
      );
      return results;
    }

    // ---- readiness is deliberately 503 ----
    const ready = await probe(container, '/health/ready');
    results.push(
      ready.startsWith('503')
        ? pass(service, 'readiness is 503 (foundation-only, correct)', ready.slice(0, 120))
        : fail(
            service,
            'readiness is 503 (foundation-only, correct)',
            `expected 503 for a foundation shell, got: ${ready.slice(0, 200)}`,
          ),
    );

    // ---- no secrets baked in ----
    const leaked = await docker(
      ['exec', container, 'sh', '-c', 'ls -a /app | grep -E "^\\.env|^\\.acceptance" || true'],
      { timeoutMs: 60_000 },
    );
    results.push(
      leaked.stdout.trim() === ''
        ? pass(service, 'no .env or .acceptance in image')
        : fail(service, 'no .env or .acceptance in image', leaked.stdout.trim()),
    );

    // ---- graceful shutdown ----
    const stopStarted = Date.now();
    const stopped = await docker(['stop', '-t', '20', container], { timeoutMs: 90_000 });
    const stopMs = Date.now() - stopStarted;
    const exit = await docker(['inspect', '-f', '{{.State.ExitCode}}', container], {
      timeoutMs: 30_000,
    });
    const exitCode = exit.stdout.trim();
    // Docker sends SIGTERM, then SIGKILLs after the timeout. Exit 0 well within
    // the window is what proves the signal reached PID 1 and was handled.
    results.push(
      stopped.code === 0 && exitCode === '0' && stopMs < 20_000
        ? pass(service, 'SIGTERM shuts down cleanly', `exit=${exitCode} in ${stopMs}ms`)
        : fail(
            service,
            'SIGTERM shuts down cleanly',
            `exit=${exitCode} after ${stopMs}ms (137 means it had to be killed)`,
          ),
    );
  } finally {
    await docker(['rm', '-f', container], { timeoutMs: 60_000 });
    await docker(['image', 'rm', '-f', tag], { timeoutMs: 120_000 });
  }

  return results;
}

async function main() {
  const services = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets = services.length > 0 ? services : DEFAULT_SERVICES;

  console.log(`Image checks for: ${targets.join(', ')} (base ${NODE_IMAGE})\n`);

  const all = [];
  for (const service of targets) {
    const results = await verifyService(service);
    for (const result of results) {
      console.log(
        `[${result.ok ? 'PASS' : 'FAIL'}] ${result.service}: ${result.check}` +
          (result.detail ? ` - ${String(result.detail).split('\n')[0]}` : ''),
      );
      if (!result.ok && result.detail) console.log(String(result.detail));
    }
    all.push(...results);
  }

  const failures = all.filter((r) => !r.ok);
  console.log(
    `\n${all.length - failures.length}/${all.length} image checks passed across ${targets.length} services.`,
  );
  console.log(
    'Scope: build, non-root execution, liveness/readiness semantics and signal handling.\n' +
      'It does not scan the image for vulnerabilities and is not a production deployment test.',
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
