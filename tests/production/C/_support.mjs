/**
 * Shared support for lane-C real-infrastructure suites.
 *
 * Requires: `node scripts/production/C/stack.mjs up` and built services
 * (`pnpm --filter @carwash/<service> run build`). Suites load the compiled
 * service artifacts, i.e. exactly what the release image would run.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { readContext } from '../../../scripts/production/C/stack.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const require = createRequire(import.meta.url);

export { readContext };

/** Load a compiled module of a lane service, failing with the remedy if absent. */
export function serviceDist(service, relative) {
  const file = path.join(ROOT, 'services', service, 'dist', relative);
  if (!existsSync(file))
    throw new Error(`Missing ${file}. Run: pnpm --filter @carwash/${service} run build`);
  return require(file);
}

export function messaging() {
  return require(path.join(ROOT, 'packages', 'platform-messaging', 'dist', 'index.js'));
}

/** amqplib exactly as the shared messaging package resolves it. */
export function amqplib() {
  return createRequire(path.join(ROOT, 'packages', 'platform-messaging', 'package.json'))(
    'amqplib',
  );
}

export const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Local double of Identity's `GET /internal/v1/identity/session`. Only used to
 * map test bearer tokens to permission sets; declared as a double in evidence.
 */
export async function identityDouble(sessions) {
  const server = createServer((req, res) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const session = sessions[token];
    if (req.url !== '/internal/v1/identity/session' || !session) {
      res.writeHead(401).end();
      return;
    }
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ...session, sessionId: randomUUID(), authVersion: 1, roles: [] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * A spawned service/worker process whose structured stdout lines can be awaited.
 */
export function startProcess(script, env, args = []) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines = [];
  const waiters = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      let line;
      try {
        line = JSON.parse(raw);
      } catch {
        continue;
      }
      lines.push(line);
      for (const waiter of [...waiters]) {
        if (waiter.match(line)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(line);
        }
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) =>
    child.on('exit', (code, signal) => resolve({ code, signal })),
  );
  return {
    child,
    lines,
    exited,
    stderr: () => stderr,
    waitFor(match, timeoutMs = 30_000) {
      const found = lines.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timeout waiting for line; stderr=${stderr.slice(-500)}`)),
          timeoutMs,
        );
        waiters.push({
          match,
          resolve: (line) => {
            clearTimeout(timer);
            resolve(line);
          },
        });
      });
    },
    /** SIGKILL: no shutdown hook, no finally block, exactly like a crash. */
    async kill() {
      if (child.exitCode !== null) return;
      child.kill('SIGKILL');
      await exited;
    },
  };
}

export async function waitHttp(url, accept = (status) => status > 0, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: globalThis.AbortSignal.timeout(1_000) });
      if (accept(res.status)) return res.status;
    } catch {
      // not listening yet
    }
    await delay(150);
  }
  throw new Error(`HTTP_NOT_READY ${url}`);
}

export async function dockerRestart(container) {
  await new Promise((resolve, reject) => {
    const child = spawn('docker', ['restart', container], { stdio: 'ignore', windowsHide: true });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`docker restart exited ${code}`)),
    );
  });
}
