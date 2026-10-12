#!/usr/bin/env node
/**
 * P07-E3a data-plane recovery drill. Runs on a disposable Docker host (CI runner).
 *
 *   node scripts/production/E/recovery/drill.mjs --report <file> [--keep]
 *
 * Every component is exercised against a REAL server, a real failure is injected
 * (SIGKILL / data loss), recovery is performed the way an operator would, and the
 * outcome is RECONCILED and TIMED. Nothing here invents an RPO/RTO target: the
 * report records measured values; approved targets are an owner decision.
 *
 *   postgres   WAL archiving + pg_basebackup during live writes -> SIGKILL ->
 *              point-in-time restore into an ISOLATED network -> ledger gap/RPO
 *              check, static-data checksums, all 19 owners' migration history
 *              and runtime-role DDL denial survive the restore.
 *   rabbitmq   (a) crash: confirmed persistent messages in a quorum queue
 *              survive SIGKILL; (b) loss: exported definitions restore the
 *              topology into an empty broker (messages are re-derived from
 *              owner outboxes, which are the system of record).
 *   redis      AOF everysec crash recovery (measured loss window) and RDB
 *              snapshot restore into a fresh instance.
 *   objects    S3 bucket logical backup -> instance + data loss -> restore into
 *              a fresh instance -> per-object sha256 and private-bucket check.
 *   alerts     Prometheus rule -> Alertmanager -> webhook receiver delivery,
 *              then acknowledgement by silence and proof of suppression.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { privilegeHardeningSql } from '../../../acceptance/lib/migrations.mjs';
import { observePostgresClient, startAcknowledgedWrites } from './postgres-writer.mjs';
import { run as runCommand } from '../../../acceptance/lib/exec.mjs';
import { acquireDrillImage } from './image-acquisition.mjs';
import {
  assertSameQuorumTopology,
  closeRecoveredQueue,
  consumeRecoveredQueue,
  inspectQuorumTopology,
  openRecoveredQueue,
} from './rabbitmq-recovery.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(path.join(ROOT, 'services/booking/package.json'));

export const IMAGE_TAGS = Object.freeze({
  postgres: 'postgres:16.10-alpine',
  rabbitmq: 'rabbitmq:4.2-management-alpine',
  redis: 'redis:8.2.10-alpine',
  prometheus: 'prom/prometheus:v3.5.0',
  alertmanager: 'prom/alertmanager:v0.28.1',
  node: 'node:24.21.0-bookworm-slim',
});
const SEAWEED =
  'chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d';
const PG_UID = '70:70';

const run = randomUUID().slice(0, 8);
const name = (part) => `cw-drill-${run}-${part}`;
const created = { containers: [], volumes: [], networks: [] };
const secrets = [];
const secret = () => {
  const value = randomBytes(18).toString('hex');
  secrets.push(value);
  return value;
};
const redact = (text) =>
  secrets.reduce((t, s) => t.split(s).join('[REDACTED]'), String(text ?? ''));

/* --------------------------------------------------------------- docker --- */

function exec(cmd, args, { input, timeoutMs = 600_000, env, cwd = ROOT } = {}) {
  return runCommand(cmd, args, {
    cwd,
    input,
    timeoutMs,
    env: { ...process.env, ...env },
  });
}

async function docker(args, options) {
  const result = await exec('docker', args, options);
  if (result.code !== 0) {
    throw new Error(`docker ${args.slice(0, 3).join(' ')}: ${redact(result.stderr).slice(-1500)}`);
  }
  return result.stdout.trim();
}

async function byDigest(tag) {
  return acquireDrillImage(tag, exec);
}

async function network(id, { internal = false } = {}) {
  await docker(['network', 'create', ...(internal ? ['--internal'] : []), id]);
  created.networks.push(id);
  return id;
}

async function volume(id, owner) {
  await docker(['volume', 'create', id]);
  created.volumes.push(id);
  if (owner) {
    await docker([
      'run',
      '--rm',
      '--user',
      'root',
      '--entrypoint',
      'chown',
      '-v',
      `${id}:/v`,
      images.postgres,
      owner,
      '/v',
    ]);
  }
  return id;
}

async function container(id, args) {
  await docker(['run', '-d', '--name', id, ...args]);
  created.containers.push(id);
  return id;
}

async function hostPort(id, port) {
  const out = await docker(['port', id, `${port}/tcp`]);
  return Number(out.split('\n')[0].split(':').pop());
}

async function until(label, probe, { timeoutMs = 120_000, everyMs = 250 } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      if ((last = await probe())) return last;
    } catch (error) {
      last = error;
    }
    await delay(everyMs);
  }
  throw new Error(`${label} not reached in ${timeoutMs}ms: ${redact(last?.message ?? last)}`);
}

const images = {};

/* ------------------------------------------------------------- postgres --- */

const catalog = JSON.parse(
  readFileSync(path.join(ROOT, 'architecture/service-catalog.json'), 'utf8'),
);
const OWNERS = catalog.services
  .filter((s) => s.database && readdirSafe(path.join(ROOT, s.path, 'prisma/migrations')).length > 0)
  .map((s) => s.id);

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

async function pgClient(port, user, password, database) {
  const { Client } = require('pg');
  const client = observePostgresClient(
    new Client({
      host: '127.0.0.1',
      port,
      user,
      password,
      database,
      connectionTimeoutMillis: 3000,
    }),
  );
  try {
    await client.connect();
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
  return client;
}

async function postgresDrill(report) {
  const bootstrap = secret();
  const passwords = Object.fromEntries(
    OWNERS.map((o) => [o, { app: secret(), migrate: secret() }]),
  );
  const net = await network(name('pg-net'));
  const data = await volume(name('pg-data'));
  const archive = await volume(name('pg-archive'), PG_UID);
  const backup = await volume(name('pg-backup'), PG_UID);
  const env = [
    '--env',
    'POSTGRES_USER=cw_drill_bootstrap',
    '--env',
    `POSTGRES_PASSWORD=${bootstrap}`,
    '--env',
    'POSTGRES_DB=postgres',
    '--env',
    'LANG=C',
    '--env',
    `CW_SERVICES=${OWNERS.join(' ')}`,
  ];
  for (const owner of OWNERS) {
    env.push('--env', `${owner.toUpperCase()}_DB_PASSWORD=${passwords[owner].app}`);
    env.push('--env', `${owner.toUpperCase()}_MIGRATION_PASSWORD=${passwords[owner].migrate}`);
  }
  const primary = await container(name('pg-primary'), [
    '--network',
    net,
    '--publish',
    '127.0.0.1::5432',
    ...env,
    '-v',
    `${data}:/var/lib/postgresql/data`,
    '-v',
    `${archive}:/archive`,
    '-v',
    `${backup}:/backup`,
    '-v',
    `${path.join(ROOT, 'infra/postgres/provision.sh')}:/docker-entrypoint-initdb.d/01-provision.sh:ro`,
    images.postgres,
    'postgres',
    '-c',
    'wal_level=replica',
    '-c',
    'archive_mode=on',
    '-c',
    'archive_command=test ! -f /archive/%f && cp %p /archive/%f',
    '-c',
    'archive_timeout=1',
  ]);
  const port = await hostPort(primary, 5432);
  await until('primary ready', async () => {
    const c = await pgClient(port, 'cw_drill_bootstrap', bootstrap, 'postgres');
    await c.end();
    return true;
  });
  // provision.sh runs before the server accepts TCP; wait for the last owner role.
  await until('owners provisioned', async () => {
    const c = await pgClient(port, 'cw_drill_bootstrap', bootstrap, 'postgres');
    const r = await c.query('SELECT count(*)::int AS n FROM pg_database WHERE datname = ANY($1)', [
      OWNERS.map((o) => `cw_${o}`),
    ]);
    await c.end();
    return r.rows[0].n === OWNERS.length;
  });

  // Every owner's committed migrations, applied by that owner's migration identity.
  for (const owner of OWNERS) {
    const dsn = `postgresql://cw_${owner}_migrate:${passwords[owner].migrate}@127.0.0.1:${port}/cw_${owner}?schema=app`;
    const result = await exec(
      process.execPath,
      [
        path.join(ROOT, 'services', owner, 'node_modules', 'prisma', 'build', 'index.js'),
        'migrate',
        'deploy',
      ],
      {
        cwd: path.join(ROOT, 'services', owner),
        env: { DATABASE_URL: dsn },
        timeoutMs: 300_000,
      },
    );
    assert.equal(
      result.code,
      0,
      `migrate ${owner}: ${redact(result.stdout + result.stderr).slice(-800)}`,
    );
    const policy = await pgClient(port, 'cw_drill_bootstrap', bootstrap, `cw_${owner}`);
    try {
      await policy.query(privilegeHardeningSql(owner));
    } finally {
      await policy.end();
    }
  }

  // Static data + a write ledger in a drill database (owner schemas stay untouched).
  const admin = await pgClient(port, 'cw_drill_bootstrap', bootstrap, 'postgres');
  await admin.query('CREATE DATABASE cw_drill');
  await admin.end();
  const drill = await pgClient(port, 'cw_drill_bootstrap', bootstrap, 'cw_drill');
  await drill.query(
    'CREATE TABLE bulk AS SELECT g AS id, md5(g::text) AS v FROM generate_series(1, 300000) g',
  );
  await drill.query(
    'CREATE TABLE ledger (seq bigint PRIMARY KEY, written_at timestamptz NOT NULL DEFAULT clock_timestamp())',
  );
  const fingerprint = async (client) => {
    const bulk = await client.query(
      "SELECT count(*)::int AS n, md5(string_agg(v, '' ORDER BY id)) AS h FROM bulk",
    );
    return bulk.rows[0];
  };
  const bulkBefore = await fingerprint(drill);
  const history = {};
  for (const owner of OWNERS) {
    const c = await pgClient(port, 'cw_drill_bootstrap', bootstrap, `cw_${owner}`);
    const r = await c.query(
      "SELECT count(*)::int AS n, md5(string_agg(migration_name || ':' || checksum, ',' ORDER BY migration_name)) AS h FROM app._prisma_migrations WHERE finished_at IS NOT NULL",
    );
    const t = await c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app'");
    history[owner] = { migrations: r.rows[0].n, historyHash: r.rows[0].h, tables: t.rows[0].n };
    await c.end();
  }

  // Continuous acknowledged writes: the client-side ack log is the RPO ground truth.
  const writer = startAcknowledgedWrites(drill);
  let backupStarted;
  let backupMs;
  let disasterAt;
  try {
    await delay(2000);
    backupStarted = Date.now();
    await docker([
      'exec',
      '--user',
      'postgres',
      '--env',
      `PGPASSWORD=${bootstrap}`,
      primary,
      'pg_basebackup',
      '-h',
      '127.0.0.1',
      '-U',
      'cw_drill_bootstrap',
      '-D',
      '/backup/base',
      '-Ft',
      '-z',
      '-X',
      'stream',
      '-c',
      'fast',
    ]);
    backupMs = Date.now() - backupStarted;
    await delay(5000); // keep writing after the base backup: recovery must replay archived WAL

    writer.beginDisaster();
    disasterAt = Date.now();
    await docker(['kill', '--signal', 'KILL', primary]);
  } finally {
    try {
      await writer.stop();
    } finally {
      await drill.end().catch(() => {});
    }
  }
  const lastAck = writer.acknowledgements.at(-1);
  assert.ok(lastAck, 'The disaster drill must contain acknowledged writes');

  // Isolated restore: an internal-only network that cannot reach anything else.
  const isolated = await network(name('pg-restore-net'), { internal: true });
  const restored = await volume(name('pg-restored'), PG_UID);
  const restoreStarted = Date.now();
  await docker([
    'run',
    '--rm',
    '--user',
    'postgres',
    '--entrypoint',
    'sh',
    '-v',
    `${restored}:/var/lib/postgresql/data`,
    '-v',
    `${backup}:/backup:ro`,
    images.postgres,
    '-c',
    [
      'set -e',
      'cd /var/lib/postgresql/data',
      'mkdir -p pgdata && chmod 700 pgdata',
      'tar -xzf /backup/base/base.tar.gz -C pgdata',
      'tar -xzf /backup/base/pg_wal.tar.gz -C pgdata/pg_wal',
      'touch pgdata/recovery.signal',
      "printf \"restore_command = 'cp /archive/%%f %%p'\\nrecovery_target_action = 'promote'\\n\" >> pgdata/postgresql.auto.conf",
    ].join('\n'),
  ]);
  const replica = await container(name('pg-restored'), [
    '--network',
    isolated,
    '--env',
    'PGDATA=/var/lib/postgresql/data/pgdata',
    '-v',
    `${restored}:/var/lib/postgresql/data`,
    '-v',
    `${archive}:/archive:ro`,
    images.postgres,
    'postgres',
  ]);
  // The isolated network has no host port and no egress; every probe runs inside.
  const sql = (db, statement, user = 'cw_drill_bootstrap', password = bootstrap) =>
    exec('docker', [
      'exec',
      '--env',
      `PGPASSWORD=${password}`,
      replica,
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      user,
      '-d',
      db,
      '-v',
      'ON_ERROR_STOP=1',
      '-tAc',
      statement,
    ]);
  await until(
    'restored primary promoted',
    async () => {
      const r = await sql('postgres', 'SELECT NOT pg_is_in_recovery()');
      return r.code === 0 && r.stdout.trim() === 't';
    },
    { timeoutMs: 300_000, everyMs: 500 },
  );
  const rtoMs = Date.now() - disasterAt;
  const restoreMs = Date.now() - restoreStarted;

  const ledger = await sql(
    'cw_drill',
    'SELECT max(seq), count(*), max(seq) - count(*), extract(epoch FROM max(written_at)) * 1000 FROM ledger',
  );
  const [maxSeq, count, gaps, lastWrittenMs] = ledger.stdout.trim().split('|').map(Number);
  const bulkAfter = await sql(
    'cw_drill',
    "SELECT count(*), md5(string_agg(v, '' ORDER BY id)) FROM bulk",
  );
  const [bulkN, bulkH] = bulkAfter.stdout.trim().split('|');

  const ownerChecks = {};
  for (const owner of OWNERS) {
    const r = await sql(
      `cw_${owner}`,
      "SELECT count(*), md5(string_agg(migration_name || ':' || checksum, ',' ORDER BY migration_name)) FROM app._prisma_migrations WHERE finished_at IS NOT NULL",
    );
    const t = await sql(`cw_${owner}`, "SELECT count(*) FROM pg_tables WHERE schemaname = 'app'");
    const [n, h] = r.stdout.trim().split('|');
    const ddl = await sql(
      `cw_${owner}`,
      'CREATE TABLE app.cw_restore_probe (i int)',
      `cw_${owner}_app`,
      passwords[owner].app,
    );
    const runtimePolicy = await sql(
      `cw_${owner}`,
      `SELECT current_user = 'cw_${owner}_app',
       NOT has_table_privilege(current_user, 'app._prisma_migrations',
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,
      `cw_${owner}_app`,
      passwords[owner].app,
    );
    let configurationHistoryImmutable = true;
    if (owner === 'configuration') {
      const appendOnly = await sql(
        'cw_configuration',
        `SELECT bool_and(NOT has_table_privilege(current_user, history_table,
           'UPDATE,DELETE,TRUNCATE'))
         FROM unnest(ARRAY['app.config_revision', 'app.config_review', 'app.config_audit'])
           AS history_table`,
        'cw_configuration_app',
        passwords[owner].app,
      );
      configurationHistoryImmutable = appendOnly.code === 0 && appendOnly.stdout.trim() === 't';
    }
    ownerChecks[owner] = {
      history: Number(n) === history[owner].migrations && h === history[owner].historyHash,
      tables: Number(t.stdout.trim()) === history[owner].tables,
      runtimeDdlDenied: ddl.code !== 0 && /permission denied/i.test(ddl.stderr),
      runtimeMigrationHistoryDenied:
        runtimePolicy.code === 0 && runtimePolicy.stdout.trim() === 't|t',
      configurationHistoryImmutable,
    };
  }
  // Egress from the restore network must be impossible (no route out of --internal).
  const reachOut = await exec('docker', ['exec', replica, 'sh', '-c', 'nc -z -w 3 1.1.1.1 443']);

  const checks = {
    ledgerHasNoGaps: gaps === 0,
    restoredWithinAcknowledged: maxSeq <= lastAck.seq,
    replayedPastBaseBackup: lastWrittenMs > backupStarted + backupMs,
    staticDataIdentical: Number(bulkN) === bulkBefore.n && bulkH === bulkBefore.h,
    allOwnersHistoryAndTables: Object.values(ownerChecks).every((c) => c.history && c.tables),
    allOwnersRuntimeDdlDeniedAfterRestore: Object.values(ownerChecks).every(
      (c) => c.runtimeDdlDenied,
    ),
    allOwnersRuntimePoliciesPreserved: Object.values(ownerChecks).every(
      (c) => c.runtimeMigrationHistoryDenied && c.configurationHistoryImmutable,
    ),
    restoreNetworkIsolated: reachOut.code !== 0,
  };
  report.components.postgres = {
    owners: OWNERS.length,
    measured: {
      backupMs,
      restoreMs,
      rtoMs,
      rpoRows: lastAck.seq - maxSeq,
      rpoMs: lastAck.at - lastWrittenMs,
      acknowledgedWrites: lastAck.seq,
      restoredWrites: count,
    },
    method:
      'pg_basebackup (tar, streamed WAL) + archive_command (archive_timeout=1s) + PITR to end of archive',
    checks,
    ownerChecks,
    ok: Object.values(checks).every(Boolean),
  };
}

/* ------------------------------------------------------------- rabbitmq --- */

async function rabbitDrill(report) {
  const brokerIds = [];
  const diagnostics = {
    phase: 'topology setup',
    upstreamLimitation: 'https://github.com/rabbitmq/rabbitmq-server/discussions/17710',
  };
  report.diagnostics ??= {};
  report.diagnostics.rabbitmq = diagnostics;
  try {
    const password = secret();
    const net = await network(name('mq-net'));
    const data = await volume(name('mq-data'));
    const start = async (id, vol) => {
      await container(id, [
        '--network',
        net,
        '--hostname',
        'drill-mq',
        '--publish',
        '127.0.0.1::15672',
        '--publish',
        '127.0.0.1::5672',
        '--env',
        'RABBITMQ_DEFAULT_USER=cw_drill',
        '--env',
        `RABBITMQ_DEFAULT_PASS=${password}`,
        ...(vol ? ['-v', `${vol}:/var/lib/rabbitmq`] : []),
        images.rabbitmq,
      ]);
      brokerIds.push(id);
      return id;
    };
    const api = (mport) => async (method, route, body) => {
      const res = await fetch(`http://127.0.0.1:${mport}/api${route}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`cw_drill:${password}`).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      assert.ok(
        res.ok,
        `RabbitMQ ${method} ${route}: HTTP ${res.status}: ${redact(text).slice(0, 500)}`,
      );
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
    const ready = async (mport) =>
      until('rabbitmq api', async () => (await api(mport)('GET', '/overview')).status === 200, {
        timeoutMs: 180_000,
        everyMs: 1000,
      });

    const first = await start(name('mq-1'), data);
    let call = api(await hostPort(first, 15672));
    await ready(await hostPort(first, 15672));
    await call('PUT', '/vhosts/drill');
    await call('PUT', '/permissions/drill/cw_drill', { configure: '.*', write: '.*', read: '.*' });
    await call('PUT', '/exchanges/drill/drill.events', { type: 'topic', durable: true });
    await call('PUT', '/queues/drill/drill.q', {
      durable: true,
      arguments: { 'x-queue-type': 'quorum' },
    });
    await call('POST', '/bindings/drill/e/drill.events/q/drill.q', { routing_key: 'drill.#' });
    // This drill crashes a data plane with an already durable topology. Ra's
    // delayed new-queue registry sync is a separate upstream lifecycle limitation.
    // Establish that fixture before publishing, without flushing message storage.
    diagnostics.before = await inspectQuorumTopology(docker, first, { persist: true });
    const definitions = (await call('GET', '/definitions')).body;
    const { connect } = require(
      path.join(ROOT, 'packages/platform-messaging/node_modules/amqplib'),
    );
    const connectTo = (port) =>
      connect(
        { hostname: '127.0.0.1', port, username: 'cw_drill', password, vhost: 'drill' },
        { timeout: 5000 },
      );
    const firstAmqpPort = await hostPort(first, 5672);
    diagnostics.phase = 'confirmed publishing';
    const total = 200;
    const digests = new Set();
    for (let i = 0; i < total; i++) {
      const payload = JSON.stringify({ i, nonce: randomUUID() });
      digests.add(createHash('sha256').update(payload).digest('hex'));
      const r = await call('POST', '/exchanges/drill/drill.events/publish', {
        routing_key: `drill.${i}`,
        payload,
        payload_encoding: 'string',
        properties: { delivery_mode: 2 },
      });
      assert.equal(r.body?.routed, true, 'message not routed');
    }
    const beforeCrash = await openRecoveredQueue(() => connectTo(firstAmqpPort), 'drill.q', total);
    diagnostics.initialQueueDepth = beforeCrash.depth;
    await closeRecoveredQueue(beforeCrash);

    diagnostics.phase = 'crash recovery';
    const crashAt = Date.now();
    await docker(['kill', '--signal', 'KILL', first]);
    // Keep the stopped container for bounded failure logs; the replacement still
    // uses a new container and the same named data volume.
    const second = await start(name('mq-2'), data);
    await ready(await hostPort(second, 15672));
    diagnostics.after = await inspectQuorumTopology(docker, second);
    assertSameQuorumTopology(diagnostics.before, diagnostics.after);
    const amqpPort = await hostPort(second, 5672);
    const reader = await until(
      'quorum queue recovered (AMQP)',
      () => openRecoveredQueue(() => connectTo(amqpPort), 'drill.q', total),
      { timeoutMs: 120_000, everyMs: 1000 },
    );
    const crashRtoMs = Date.now() - crashAt;
    let recovered;
    try {
      recovered = await consumeRecoveredQueue(reader.channel, 'drill.q', digests);
    } finally {
      await closeRecoveredQueue(reader);
    }

    // Total loss: an empty broker gets the exported definitions back.
    diagnostics.phase = 'definitions restore';
    await docker(['rm', '-f', second]);
    const lossAt = Date.now();
    const third = await start(name('mq-3'));
    await ready(await hostPort(third, 15672));
    call = api(await hostPort(third, 15672));
    const imported = await call('POST', '/definitions', definitions);
    const queue = await call('GET', '/queues/drill/drill.q');
    const binding = await call('GET', '/bindings/drill/e/drill.events/q/drill.q');
    const definitionsRtoMs = Date.now() - lossAt;

    const checks = {
      topologyRegistryDurableBeforePublishing: diagnostics.before.registrySynced === true,
      originalQueueDepthVerified: diagnostics.initialQueueDepth === total,
      sameQuorumIdentityAfterCrash: true,
      allConfirmedMessagesSurvivedCrash:
        reader.depth === total &&
        recovered.size === total &&
        [...digests].every((d) => recovered.has(d)),
      definitionsImported: imported.status === 204 || imported.status === 201,
      quorumQueueRestored:
        queue.status === 200 && queue.body.arguments?.['x-queue-type'] === 'quorum',
      bindingRestored: binding.status === 200 && binding.body.length === 1,
    };
    report.components.rabbitmq = {
      measured: {
        crashRtoMs,
        crashRpoMessages: total - recovered.size,
        definitionsRtoMs,
        confirmedMessages: total,
        recoveredMessages: recovered.size,
      },
      fixture:
        'Quorum name-to-UID registry synced before publishing; no message-storage sync or sleep after publishing. Newly declared queue crash safety is not claimed.',
      method:
        'quorum queue + confirmed persistent messages, SIGKILL + restart on the same volume; AMQP passive count and exact payload reconciliation; definitions export/import into an empty broker',
      note: 'After total broker loss, unconsumed messages are re-published from owner transactional outboxes; the broker is not a system of record.',
      checks,
      ok: Object.values(checks).every(Boolean),
    };
    diagnostics.phase = 'complete';
  } catch (error) {
    diagnostics.brokers = await Promise.all(
      brokerIds.map(async (id) => {
        const commands = {
          logs: ['logs', '--tail', '160', id],
          mounts: ['inspect', '--format', '{{json .Mounts}}', id],
          quorum: ['exec', id, 'rabbitmq-queues', '--vhost', 'drill', 'quorum_status', 'drill.q'],
        };
        const records = await Promise.all(
          Object.entries(commands).map(async ([key, args]) => {
            const result = await exec('docker', args, { timeoutMs: 10_000 });
            return [
              key,
              { code: result.code, output: redact(result.stdout + result.stderr).slice(-12000) },
            ];
          }),
        );
        return { id, ...Object.fromEntries(records) };
      }),
    );
    throw error;
  }
}

/* ---------------------------------------------------------------- redis --- */

/** Minimal sequential RESP client: one command in flight, reply line returned. */
async function respClient(port, password) {
  const { connect } = await import('node:net');
  const socket = connect(port, '127.0.0.1');
  await new Promise((resolve, reject) => socket.once('connect', resolve).once('error', reject));
  const CRLF = '\r\n';
  let buffer = '';
  const waiting = [];
  socket.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf(CRLF)) >= 0 && waiting.length > 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      waiting.shift()(line);
    }
  });
  const send = (...args) =>
    new Promise((resolve) => {
      waiting.push(resolve);
      const parts = args.map((a) => `$${Buffer.byteLength(a)}${CRLF}${a}${CRLF}`).join('');
      socket.write(`*${args.length}${CRLF}${parts}`);
    });
  assert.equal(await send('AUTH', password), '+OK');
  send.close = () => socket.destroy();
  return send;
}

async function redisDrill(report) {
  const password = secret();
  const net = await network(name('redis-net'));
  const data = await volume(name('redis-data'));
  const start = (id, vol) =>
    container(id, [
      '--network',
      net,
      '--publish',
      '127.0.0.1::6379',
      ...(vol ? ['-v', `${vol}:/data`] : []),
      images.redis,
      'redis-server',
      '--appendonly',
      'yes',
      '--appendfsync',
      'everysec',
      '--requirepass',
      password,
    ]);
  const cli = (id, ...args) =>
    exec('docker', ['exec', '--env', `REDISCLI_AUTH=${password}`, id, 'redis-cli', ...args]);
  const first = await start(name('redis-1'), data);
  await until('redis', async () => (await cli(first, 'PING')).stdout.trim() === 'PONG');
  const acks = [];
  const resp = await respClient(await hostPort(first, 6379), password);
  for (let i = 1; i <= 1500; i++) {
    if ((await resp('SET', `drill:${i}`, String(Date.now()))) === '+OK')
      acks.push({ i, at: Date.now() });
  }
  const snapshot = await cli(first, 'SAVE');
  assert.equal(snapshot.stdout.trim(), 'OK');
  const atSnapshot = Number((await cli(first, 'DBSIZE')).stdout.trim());
  for (let i = 1501; i <= 3000; i++) {
    if ((await resp('SET', `drill:${i}`, String(Date.now()))) === '+OK')
      acks.push({ i, at: Date.now() });
  }
  resp.close();
  const crashAt = Date.now();
  await docker(['kill', '--signal', 'KILL', first]);
  await docker(['rm', '-f', first]);
  const second = await start(name('redis-2'), data);
  await until('redis restarted', async () => (await cli(second, 'PING')).stdout.trim() === 'PONG');
  const crashRtoMs = Date.now() - crashAt;
  const survived = Number((await cli(second, 'DBSIZE')).stdout.trim());

  // Snapshot restore into a FRESH instance (no AOF history): copy dump.rdb only.
  const fresh = await volume(name('redis-fresh'));
  await docker([
    'run',
    '--rm',
    '--user',
    'root',
    '--entrypoint',
    'sh',
    '-v',
    `${data}:/from:ro`,
    '-v',
    `${fresh}:/to`,
    images.redis,
    '-c',
    'cp /from/dump.rdb /to/dump.rdb && chown -R 999:1000 /to',
  ]);
  const restoreAt = Date.now();
  const third = await container(name('redis-3'), [
    '--network',
    net,
    '-v',
    `${fresh}:/data`,
    images.redis,
    'redis-server',
    '--appendonly',
    'no',
    '--requirepass',
    password,
  ]);
  await until(
    'redis snapshot restore',
    async () => (await cli(third, 'PING')).stdout.trim() === 'PONG',
  );
  const restored = Number((await cli(third, 'DBSIZE')).stdout.trim());
  const snapshotRtoMs = Date.now() - restoreAt;
  const lost = acks.length - survived;
  const checks = {
    aofCrashLossWithinOneSecondOfWrites:
      lost >= 0 && (lost === 0 || acks.at(-1).at - acks[survived - 1].at <= 1500),
    snapshotRestoreExact: restored === atSnapshot,
  };
  report.components.redis = {
    measured: {
      crashRtoMs,
      crashRpoKeys: lost,
      snapshotRtoMs,
      acknowledged: acks.length,
      survived,
      snapshotKeys: atSnapshot,
    },
    method: 'AOF appendfsync everysec + SIGKILL; RDB SAVE copied into a fresh instance',
    note: 'Redis holds only identity rate budgets; it is not authoritative for bookings or money.',
    checks,
    ok: Object.values(checks).every(Boolean),
  };
}

/* -------------------------------------------------------------- objects --- */

async function objectDrill(report, work) {
  const access = `cwdrill${randomBytes(4).toString('hex')}`;
  const key = secret();
  const config = path.join(work, 's3.json');
  writeFileSync(
    config,
    JSON.stringify({
      identities: [
        {
          name: 'media-service',
          credentials: [{ accessKey: access, secretKey: key }],
          actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
        },
      ],
    }),
    { mode: 0o644 },
  );
  const start = async (id) => {
    const c = await container(id, [
      '-v',
      `${config}:/etc/seaweedfs/s3.json:ro`,
      '--publish',
      '127.0.0.1::8333',
      SEAWEED,
      'server',
      '-dir=/data',
      '-s3',
      '-s3.port=8333',
      '-s3.config=/etc/seaweedfs/s3.json',
    ]);
    const port = await hostPort(c, 8333);
    const endpoint = `http://127.0.0.1:${port}`;
    await until('s3 up', async () => (await fetch(endpoint)).status > 0, {
      timeoutMs: 120_000,
      everyMs: 1000,
    });
    return { id: c, endpoint };
  };
  const aws = (endpoint, ...args) =>
    exec('aws', ['--endpoint-url', endpoint, '--region', 'us-east-1', ...args], {
      env: {
        AWS_ACCESS_KEY_ID: access,
        AWS_SECRET_ACCESS_KEY: key,
        AWS_EC2_METADATA_DISABLED: 'true',
      },
    });
  const okAws = async (...args) => {
    const r = await aws(...args);
    assert.equal(r.code, 0, `aws ${args.slice(1, 3).join(' ')}: ${redact(r.stderr).slice(-500)}`);
    return r.stdout;
  };
  const primary = await start(name('s3-1'));
  const bucket = 'washgo-media-drill';
  await until(
    'bucket',
    async () => (await aws(primary.endpoint, 's3', 'mb', `s3://${bucket}`)).code === 0,
    { timeoutMs: 60_000, everyMs: 2000 },
  );
  const source = path.join(work, 'objects');
  mkdirSync(source);
  const expected = {};
  const put = async (i) => {
    const body = randomBytes(4096 + i * 97);
    const file = path.join(source, `obj-${i}.bin`);
    writeFileSync(file, body);
    expected[`evidence/${i}.bin`] = createHash('sha256').update(body).digest('hex');
    await okAws(primary.endpoint, 's3', 'cp', file, `s3://${bucket}/evidence/${i}.bin`);
  };
  for (let i = 0; i < 25; i++) await put(i);
  const backupDir = path.join(work, 'object-backup');
  const backupAt = Date.now();
  await okAws(primary.endpoint, 's3', 'sync', `s3://${bucket}`, backupDir);
  const backupMs = Date.now() - backupAt;
  const inBackup = Object.keys(expected);
  for (let i = 25; i < 30; i++) await put(i); // written after the last backup: the RPO window
  const lossAt = Date.now();
  await docker(['rm', '-f', primary.id]); // instance and its data are gone
  const replacement = await start(name('s3-2'));
  await okAws(replacement.endpoint, 's3', 'mb', `s3://${bucket}`);
  await okAws(replacement.endpoint, 's3', 'sync', backupDir, `s3://${bucket}`);
  const rtoMs = Date.now() - lossAt;
  const mismatches = [];
  for (const object of inBackup) {
    const out = path.join(work, 'check.bin');
    await okAws(replacement.endpoint, 's3', 'cp', `s3://${bucket}/${object}`, out);
    if (createHash('sha256').update(readFileSync(out)).digest('hex') !== expected[object])
      mismatches.push(object);
  }
  const anonymous = await fetch(`${replacement.endpoint}/${bucket}/${inBackup[0]}`);
  const checks = {
    allBackedUpObjectsIdentical: mismatches.length === 0,
    bucketPrivateAfterRestore: anonymous.status === 403,
  };
  report.components.objects = {
    measured: {
      backupMs,
      rtoMs,
      rpoObjects: Object.keys(expected).length - inBackup.length,
      restoredObjects: inBackup.length,
    },
    method:
      'S3 logical backup (sync) -> instance and data loss -> fresh instance -> sync restore -> sha256 per object',
    note: 'Production object storage must use provider versioning/replication; objects written after the last backup are lost by design of this method.',
    checks,
    ok: Object.values(checks).every(Boolean),
  };
}

/* --------------------------------------------------------------- alerts --- */

async function alertDrill(report, work) {
  const net = await network(name('obs-net'));
  const target = await container(name('obs-mq'), [
    '--network',
    net,
    '--network-alias',
    'drill-target',
    images.rabbitmq,
  ]);
  const receiverScript = path.join(work, 'receiver.js');
  writeFileSync(
    receiverScript,
    "require('http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(JSON.stringify({at:Date.now(),body:JSON.parse(b||'{}')}));s.end('ok')})}).listen(8080)",
    { mode: 0o644 },
  );
  await container(name('obs-receiver'), [
    '--network',
    net,
    '--network-alias',
    'receiver',
    '-v',
    `${receiverScript}:/r.js:ro`,
    images.node,
    'node',
    '/r.js',
  ]);
  const amConfig = path.join(work, 'alertmanager.yml');
  writeFileSync(
    amConfig,
    [
      'route:',
      '  receiver: oncall',
      '  group_by: [alertname]',
      '  group_wait: 1s',
      '  group_interval: 5s',
      '  repeat_interval: 10s',
      'receivers:',
      '  - name: oncall',
      '    webhook_configs:',
      '      - url: http://receiver:8080/hook',
      '        send_resolved: true',
      '',
    ].join('\n'),
    { mode: 0o644 },
  );
  await container(name('obs-am'), [
    '--network',
    net,
    '--network-alias',
    'alertmanager',
    '--publish',
    '127.0.0.1::9093',
    '-v',
    `${amConfig}:/etc/alertmanager/alertmanager.yml:ro`,
    images.alertmanager,
    '--config.file=/etc/alertmanager/alertmanager.yml',
  ]);
  const promConfig = path.join(work, 'prometheus.yml');
  const rules = path.join(work, 'rules.yml');
  writeFileSync(
    rules,
    [
      'groups:',
      '  - name: drill',
      '    rules:',
      '      - alert: BrokerDown',
      '        expr: up{job="broker"} == 0',
      '        for: 5s',
      '        labels: { severity: page }',
      '        annotations: { summary: "broker scrape target down" }',
      '',
    ].join('\n'),
    { mode: 0o644 },
  );
  writeFileSync(
    promConfig,
    [
      'global: { scrape_interval: 2s, evaluation_interval: 2s }',
      'rule_files: [/etc/prometheus/rules.yml]',
      'alerting:',
      '  alertmanagers:',
      '    - static_configs: [{ targets: ["alertmanager:9093"] }]',
      'scrape_configs:',
      '  - job_name: broker',
      '    static_configs: [{ targets: ["drill-target:15692"] }]',
      '',
    ].join('\n'),
    { mode: 0o644 },
  );
  await container(name('obs-prom'), [
    '--network',
    net,
    '--publish',
    '127.0.0.1::9090',
    '-v',
    `${promConfig}:/etc/prometheus/prometheus.yml:ro`,
    '-v',
    `${rules}:/etc/prometheus/rules.yml:ro`,
    images.prometheus,
    '--config.file=/etc/prometheus/prometheus.yml',
  ]);
  const am = `http://127.0.0.1:${await hostPort(name('obs-am'), 9093)}`;
  const notifications = async () =>
    (await docker(['logs', name('obs-receiver')]))
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));
  // Healthy first: the target must be scraped as up before the failure is injected.
  const prom = `http://127.0.0.1:${await hostPort(name('obs-prom'), 9090)}`;
  await until(
    'broker scraped as up',
    async () => {
      const q = await (
        await fetch(`${prom}/api/v1/query?query=${encodeURIComponent('up{job="broker"}')}`)
      ).json();
      return q.data?.result?.[0]?.value?.[1] === '1';
    },
    { timeoutMs: 180_000, everyMs: 2000 },
  );
  const failAt = Date.now();
  await docker(['stop', '--time', '1', target]);
  const firing = await until(
    'alert delivered',
    async () => {
      const n = (await notifications()).find(
        (x) => x.body.status === 'firing' && x.body.commonLabels?.alertname === 'BrokerDown',
      );
      return n ?? false;
    },
    { timeoutMs: 180_000, everyMs: 1000 },
  );
  const detectMs = firing.at - failAt;
  const ackAt = Date.now();
  const silence = await fetch(`${am}/api/v2/silences`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      matchers: [{ name: 'alertname', value: 'BrokerDown', isRegex: false, isEqual: true }],
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdBy: 'drill-oncall',
      comment: 'P07-E3a drill acknowledgement',
    }),
  });
  const silenceId = (await silence.json()).silenceID;
  await delay(2000);
  const countAtAck = (await notifications()).length;
  await delay(25_000); // > repeat_interval: a non-acknowledged alert would have been re-sent
  const after = (await notifications()).length;
  const state = await (
    await fetch(`${am}/api/v2/alerts?filter=alertname%3D%22BrokerDown%22`)
  ).json();
  const checks = {
    alertDelivered: Boolean(firing),
    acknowledgedBySilence: silence.status === 200 && typeof silenceId === 'string',
    suppressedAfterAck:
      after === countAtAck &&
      state.length > 0 &&
      state.every((a) => a.status?.state === 'suppressed'),
  };
  report.components.alerts = {
    measured: { detectAndDeliverMs: detectMs, ackLatencyMs: ackAt - firing.at },
    method:
      'Prometheus up==0 for 5s -> Alertmanager -> webhook receiver; acknowledgement = Alertmanager silence',
    note: 'The receiver is a drill webhook, not a paging provider or a named on-call person.',
    checks,
    ok: Object.values(checks).every(Boolean),
  };
}

/* ----------------------------------------------------------------- main --- */

export async function main({ argv = process.argv.slice(2), resolveImage = byDigest } = {}) {
  const reportFile = argv[argv.indexOf('--report') + 1];
  assert.ok(argv.includes('--report') && reportFile, '--report <file> is required');
  const work = mkdtempSync(path.join(tmpdir(), 'cw-drill-'));
  const report = {
    kind: 'carwash.recovery-drill',
    schemaVersion: 1,
    runId: run,
    startedAt: new Date().toISOString(),
    sourceSha: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(),
    sourceTree: (await exec('git', ['rev-parse', 'HEAD^{tree}'])).stdout.trim(),
    targets: 'NOT APPROVED: measured values only; RPO/RTO targets are an owner decision',
    images,
    components: {},
    failures: {},
  };
  try {
    for (const [key, tag] of Object.entries(IMAGE_TAGS)) images[key] = await resolveImage(tag);
    images.seaweedfs = SEAWEED;
    for (const [component, drill] of Object.entries({
      postgres: postgresDrill,
      rabbitmq: rabbitDrill,
      redis: redisDrill,
      objects: objectDrill,
      alerts: alertDrill,
    })) {
      const started = Date.now();
      try {
        await drill(report, work);
      } catch (error) {
        report.failures[component] = redact(error.stack ?? error.message).slice(0, 4000);
        report.components[component] = { ok: false };
      }
      report.components[component].durationMs = Date.now() - started;
      console.log(
        `${report.components[component].ok ? 'PASS' : 'FAIL'} ${component} ${JSON.stringify(report.components[component].measured ?? {})}`,
      );
      if (!report.components[component].ok) {
        console.error(
          `${component}: ${report.failures[component] ?? JSON.stringify(report.components[component].checks)}`,
        );
      }
    }
  } catch (error) {
    report.failures.preparation = redact(error.stack ?? error.message).slice(0, 4000);
  } finally {
    if (!argv.includes('--keep')) {
      for (const c of created.containers.reverse()) await exec('docker', ['rm', '-f', c]);
      for (const n of created.networks) await exec('docker', ['network', 'rm', n]);
      for (const v of created.volumes) await exec('docker', ['volume', 'rm', '-f', v]);
      rmSync(work, { recursive: true, force: true });
    }
  }
  report.finishedAt = new Date().toISOString();
  report.accepted = ['postgres', 'rabbitmq', 'redis', 'objects', 'alerts'].every(
    (c) => report.components[c]?.ok === true,
  );
  mkdirSync(path.dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(report.accepted ? 'RECOVERY DRILL PASSED' : 'RECOVERY DRILL FAILED');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((report) => {
      process.exitCode = report.accepted ? 0 : 1;
    })
    .catch((error) => {
      console.error(redact(error.stack ?? error.message));
      process.exitCode = 1;
    });
}
