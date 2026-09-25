/**
 * Shared scaffolding for the real-infrastructure integration tests.
 *
 * These tests talk to a real PostgreSQL and a real RabbitMQ provisioned by the
 * acceptance runner. They deliberately use no mocks and no in-memory doubles:
 * the properties under test (role privileges, broker ACLs, transactional
 * commit/ack ordering) exist only in the real servers, and a double would prove
 * nothing about them.
 *
 * Synchronisation is done by OBSERVING worker output, never by sleeping for a
 * guessed interval. A sleep that is too short is a flaky failure; a sleep that is
 * long enough to be safe is a slow suite that still hides real races.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ROOT,
  appDsn,
  brokerUrl,
  brokerUrlAs,
  crossDsn,
  infraBrokerUrl,
  migrationDsn,
  readContextFile,
} from '../../scripts/acceptance/lib/context.mjs';
import { killTree, run } from '../../scripts/acceptance/lib/exec.mjs';

export { ROOT, appDsn, brokerUrl, brokerUrlAs, crossDsn, infraBrokerUrl, migrationDsn };

const require = createRequire(path.join(ROOT, 'package.json'));

export const context = await readContextFile();

export function amqp() {
  return require(path.join(ROOT, 'packages', 'platform-messaging', 'node_modules', 'amqplib'));
}

export function messaging() {
  return require(path.join(ROOT, 'packages', 'platform-messaging', 'dist', 'index.js'));
}

/** A service's own Prisma client, built exactly the way the service builds it. */
export function serviceClient(service, url = appDsn(context, service)) {
  const serviceRequire = createRequire(path.join(ROOT, 'services', service, 'package.json'));
  const { PrismaClient } = serviceRequire(
    path.join(ROOT, 'services', service, 'dist', 'generated', 'prisma', 'client.js'),
  );
  const { PrismaPg } = serviceRequire('@prisma/adapter-pg');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema: 'app' }) });
}

/**
 * Run SQL through a separate process so the connection string and the statement
 * travel in the environment and are never concatenated into a command line.
 */
export async function sql(url, statement) {
  const result = await run(
    process.execPath,
    [path.join('scripts', 'acceptance', 'lib', 'psql-runner.mjs')],
    {
      cwd: ROOT,
      env: { ...process.env, CW_PSQL_URL: url, CW_PSQL_SQL: statement },
      timeoutMs: 60_000,
    },
  );
  let parsed;
  const raw = result.code === 0 ? result.stdout.trim() : result.stderr.trim();
  try {
    parsed = JSON.parse(raw.split('\n').filter(Boolean).at(-1) ?? '{}');
  } catch {
    parsed = { ok: false, code: null, message: raw };
  }
  return {
    ok: result.code === 0,
    code: parsed?.code ?? null,
    message: parsed?.message ?? null,
    rows: parsed?.rows ?? [],
  };
}

/** Assert that an operation was refused by PostgreSQL for the RIGHT reason. */
export function assertPrivilegeDenied(result, assert, what) {
  assert.equal(result.ok, false, `${what} should have been refused but succeeded`);
  assert.equal(
    result.code,
    '42501',
    `${what} failed with ${result.code} (${result.message}) instead of insufficient_privilege`,
  );
}

/* ------------------------------- processes ------------------------------- */

/**
 * Spawn a worker and expose its stdout as observable JSON lines.
 * Every worker in this sprint prints one JSON object per meaningful step, which
 * is what lets a test wait for a fact instead of for a duration.
 */
export function spawnWorker(argv, env, options = {}) {
  const child = spawn(process.execPath, argv, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const lines = [];
  const waiters = new Set();
  let stderr = '';
  let buffer = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          record = { event: 'unparsed', raw: line };
        }
        lines.push(record);
        for (const waiter of [...waiters]) {
          if (waiter.predicate(record)) {
            waiters.delete(waiter);
            waiter.resolve(record);
          }
        }
      }
      index = buffer.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exited = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });

  return {
    child,
    lines,
    get stderr() {
      return stderr;
    },
    exited,
    label: options.label ?? argv[0],
    /** Resolve when a line matching the predicate is seen; reject on timeout. */
    async waitFor(predicate, { timeoutMs = 60_000, description = 'line' } = {}) {
      const existing = lines.find(predicate);
      if (existing) return existing;
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.add(waiter);
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(
            new Error(
              `TIMEOUT waiting for ${description} from ${options.label ?? 'worker'}\n` +
                `seen: ${JSON.stringify(lines)}\nstderr: ${stderr.slice(0, 2000)}`,
            ),
          );
        }, timeoutMs);
        timer.unref?.();
      });
    },
    /** SIGKILL the whole tree: models an abrupt crash, not a graceful stop. */
    kill() {
      killTree(child);
      return exited;
    },
    /** SIGTERM: models an orderly shutdown. */
    async stop(timeoutMs = 15_000) {
      if (child.exitCode !== null) return exited;
      child.kill('SIGTERM');
      const outcome = await Promise.race([exited, delay(timeoutMs).then(() => 'timeout')]);
      if (outcome === 'timeout') {
        killTree(child);
        return exited;
      }
      return outcome;
    },
  };
}

export function relayArgs(extra = []) {
  return [path.join('services', 'catalog', 'dist', 'outbox', 'relay.runner.js'), ...extra];
}

export function consumerArgs(service, extra = []) {
  return [path.join('services', service, 'dist', 'inbox', 'consumer.runner.js'), ...extra];
}

export function relayEnv(overrides = {}) {
  return {
    DATABASE_URL: appDsn(context, 'catalog'),
    BROKER_URL: brokerUrl(context, 'catalog'),
    LOG_LEVEL: 'warn',
    ...overrides,
  };
}

export function consumerEnv(service, overrides = {}) {
  return {
    DATABASE_URL: appDsn(context, service),
    BROKER_URL: brokerUrl(context, service),
    LOG_LEVEL: 'warn',
    ...overrides,
  };
}

/* -------------------------------- fixtures -------------------------------- */

/** Produce a probe through the real transactional producer. */
export async function createProbe(catalog, input) {
  const catalogRequire = createRequire(path.join(ROOT, 'services', 'catalog', 'package.json'));
  const { ProbeService } = catalogRequire(
    path.join(ROOT, 'services', 'catalog', 'dist', 'probe', 'probe.service.js'),
  );
  return new ProbeService({ client: catalog }).createProbe(input);
}

/**
 * Return the slice to a known state.
 * Scoped to the Sprint 0.2 probe tables of the three participating services; it
 * never touches anything else, and it only ever runs against the ephemeral
 * acceptance databases identified by the run context.
 */
export async function resetSlice(clients) {
  // DELETE, not TRUNCATE: the application role holds DML only, and TRUNCATE is
  // one of the privileges it is deliberately denied. The fixture runs with the
  // same identity the service uses, so it must live within the same limits.
  await clients.catalog.$executeRawUnsafe('DELETE FROM app.outbox_message');
  await clients.catalog.$executeRawUnsafe('DELETE FROM app.foundation_probe');
  await clients.communications.$executeRawUnsafe('DELETE FROM app.probe_notification');
  await clients.communications.$executeRawUnsafe('DELETE FROM app.inbox_message');
  await clients.reporting.$executeRawUnsafe('DELETE FROM app.probe_projection');
  await clients.reporting.$executeRawUnsafe('DELETE FROM app.inbox_message');
  // The queues are part of the known state, so make sure they exist before
  // emptying them. See ensureSubscriberQueues for why this is not a workaround.
  await ensureSubscriberQueues();
  await purgeQueues();
}

const SUBSCRIBERS = ['communications', 'reporting'];

/**
 * Open a connection and channel, run an operation, and always close both.
 *
 * The error handlers are load-bearing, not defensive noise. When the broker
 * refuses a channel operation (a 404 on a queue that does not exist, a 403 from
 * an ACL) amqplib closes the channel and emits 'error' on the CONNECTION. With
 * no listener, Node turns that into an uncaught exception, and the pending
 * operation's promise never settles - so the caller hangs forever rather than
 * failing. Attaching the listeners turns a broker refusal back into a rejected
 * promise that a test can assert on.
 */
async function withChannel(url, fn) {
  const { connect } = amqp();
  const connection = await connect(url);
  connection.on('error', () => {});
  connection.on('close', () => {});
  try {
    const channel = await connection.createChannel();
    channel.on('error', () => {});
    channel.on('close', () => {});
    try {
      return await fn(channel);
    } finally {
      await channel.close().catch(() => {});
    }
  } finally {
    await connection.close().catch(() => {});
  }
}

/**
 * Declare each subscriber's own queues, using that subscriber's own broker
 * identity.
 *
 * A subscribing service owns its namespace and declares its queues when its
 * consumer starts. On a freshly provisioned stack no consumer has run yet, so
 * on the first test the queues genuinely do not exist and every purge/depth
 * call returns 404.
 *
 * Declaring them here is not papering over that: assertQueue is idempotent, it
 * runs as the subscriber (so it still proves the ACL permits exactly this), and
 * it is the same declaration the consumer performs. What it buys is that
 * `queueDepth` can stay STRICT - a missing queue remains an error rather than
 * being reported as "zero messages", which would let a consumer that never
 * declared its queue pass a depth-is-zero assertion.
 */
export async function ensureSubscriberQueues() {
  const { assertTopology, subscriberTopology } = messaging();
  for (const service of SUBSCRIBERS) {
    await withChannel(brokerUrl(context, service), async (channel) => {
      await assertTopology(channel, subscriberTopology(service));
    });
  }
}

export async function purgeQueues() {
  for (const service of SUBSCRIBERS) {
    // One channel per queue: a refused operation closes the channel it ran on,
    // and every later operation on that channel would be refused too.
    for (const queue of [`${service}.catalog.foundation-probe`, `${service}.dlq`]) {
      await withChannel(brokerUrl(context, service), async (channel) => {
        await channel.purgeQueue(queue);
      }).catch((error) => {
        // A queue that does not exist holds no messages, so there is nothing to
        // purge. Anything else is a real failure and must not be swallowed.
        if (error?.code !== 404) throw error;
      });
    }
  }
}

export async function queueDepth(service, queue) {
  return withChannel(brokerUrl(context, service), async (channel) => {
    const info = await channel.checkQueue(queue);
    return info.messageCount;
  });
}

/** Poll a real observable until it holds, with a bounded deadline. */
export async function eventually(
  probe,
  { timeoutMs = 30_000, intervalMs = 150, description = 'condition' } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await delay(intervalMs);
  }
  throw new Error(`TIMEOUT waiting for ${description}; last value ${JSON.stringify(last)}`);
}

export { delay };
