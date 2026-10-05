import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allocateEnvironment,
  claimHeavySlot,
  DEFAULT_STATE_ROOT,
  describeEnvironment,
  releaseEnvironment,
  releaseHeavySlot,
  validateIdentity,
} from './allocate-environment.mjs';
import {
  appDsn,
  childEnv,
  createRunContext,
  migrationDsn,
  ROOT,
} from '../../acceptance/lib/context.mjs';
import { redact, registerSecret, run, runOrThrow } from '../../acceptance/lib/exec.mjs';
import {
  composeDown,
  containerId,
  dockerEnvironment,
  psqlBootstrap,
  waitForPostgresReady,
} from '../../acceptance/lib/infra.mjs';
import { sourceDirty } from '../../ci/runtime.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function assertIsolationObservations({ allocations, markers, observations }) {
  assert.equal(allocations.length, 2, 'Require exactly two allocations');
  assert.equal(observations.length, 2, 'Require two real PostgreSQL observations');
  assert.equal(markers.length, 2);
  assert.notEqual(markers[0], markers[1]);
  for (const marker of markers) assert.match(marker, UUID);
  assert.ok(
    allocations[0].portBlock.last < allocations[1].portBlock.first ||
      allocations[1].portBlock.last < allocations[0].portBlock.first,
    'Host port blocks overlap',
  );
  for (const key of ['composeProject', 'namespace'])
    assert.notEqual(allocations[0][key], allocations[1][key]);
  for (const key of ['containerId', 'volumeName', 'serverIdentifier']) {
    assert.ok(
      observations.every((observation) => typeof observation[key] === 'string' && observation[key]),
      `Missing actual ${key}`,
    );
    assert.notEqual(observations[0][key], observations[1][key], `Shared actual ${key}`);
  }
  for (let index = 0; index < 2; index++) {
    const observation = observations[index];
    const allocation = allocations[index];
    assert.equal(observation.project, allocation.composeProject);
    assert.equal(observation.hostIp, '127.0.0.1');
    assert.equal(observation.postgresPort, allocation.ports.postgres);
    assert.equal(observation.database, allocation.databases.vehicle.database);
    assert.equal(observation.role, allocation.databases.vehicle.runtimeRole);
    assert.equal(observation.internalPort, 5432);
    assert.deepEqual(
      observation.markers,
      [markers[index]],
      'Other stack marker visible or own data missing',
    );
    assert.equal(
      observation.crossCredentialCode,
      '28P01',
      'Cross-stack credentials not rejected by PostgreSQL',
    );
  }
}

export function parseArguments(argv) {
  const options = {
    stateRoot: DEFAULT_STATE_ROOT,
    wave: 'W01',
    run: `isolation-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
  };
  const keys = {
    '--state-root': 'stateRoot',
    '--wave': 'wave',
    '--run': 'run',
    '--slots': 'slots',
    '--evidence-dir': 'evidenceDir',
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const key = keys[flag];
    const value = argv[index + 1];
    if (!key || seen.has(key) || !value || value.startsWith('--'))
      throw new Error('INVALID_ARGUMENTS');
    seen.add(key);
    options[key] = value;
  }
  validateIdentity({ lane: 'E', wave: options.wave, run: options.run });
  if (!isAbsolute(options.stateRoot) || (options.evidenceDir && !isAbsolute(options.evidenceDir))) {
    throw new Error('PATH_MUST_BE_ABSOLUTE');
  }
  options.stateRoot = resolve(options.stateRoot);
  if (options.slots !== undefined) {
    if (!/^[0-9]+,[0-9]+$/.test(options.slots)) throw new Error('INVALID_SLOTS');
    options.slots = options.slots.split(',').map(Number);
    if (options.slots[0] === options.slots[1]) throw new Error('DUPLICATE_SLOTS');
    for (const slot of options.slots) describeEnvironment({ ...options, lane: 'E', slot });
  }
  return options;
}

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

// Absence is checked before mutation, so a stale project created outside this
// invocation is never brought down by our finally block.
async function requireNoProjectResources(context, signal) {
  for (const [kind, args] of [
    [
      'containers',
      ['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${context.project}`],
    ],
    [
      'volumes',
      ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${context.project}`],
    ],
    [
      'networks',
      ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${context.project}`],
    ],
  ]) {
    const result = await runOrThrow('docker', args, { cwd: ROOT, signal, timeoutMs: 60000 });
    assert.equal(result.stdout.trim(), '', `Project ${context.project} still has ${kind}`);
  }
}

async function sql(context, url, statement, signal) {
  signal?.throwIfAborted();
  const result = await run(
    process.execPath,
    [join(ROOT, 'scripts', 'acceptance', 'lib', 'psql-runner.mjs')],
    {
      cwd: ROOT,
      env: childEnv(context, { CW_PSQL_URL: url, CW_PSQL_SQL: statement }),
      signal,
      timeoutMs: 60000,
    },
  );
  assert.equal(result.outcome, 'exited', 'SQL probe timed out, cancelled or failed to spawn');
  const raw = result.code === 0 ? result.stdout : result.stderr;
  let parsed;
  try {
    parsed = JSON.parse(raw.trim().split('\n').at(-1));
  } catch {
    throw new Error(`SQL_DRIVER_OUTPUT_INVALID: ${redact(raw)}`);
  }
  return { exitCode: result.code, ...parsed };
}

async function checkedSql(context, url, statement, signal) {
  const result = await sql(context, url, statement, signal);
  assert.equal(result.exitCode, 0, redact(result.message ?? 'SQL command failed'));
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.rows), 'Missing real SQL rows');
  return result.rows;
}

async function observeContainer(context, allocation, signal) {
  const id = await containerId(context, 'postgres');
  assert.match(id ?? '', /^[a-f0-9]{64}$/, 'Missing real PostgreSQL container');
  const inspected = await runOrThrow(
    'docker',
    [
      'inspect',
      '--format',
      '{{json .Config.Labels}}|{{json .Mounts}}|{{json .NetworkSettings.Ports}}|{{json .Image}}|{{json .Config.Image}}',
      id,
    ],
    { cwd: ROOT, timeoutMs: 60000, signal },
  );
  const [labels, mounts, ports, imageId, imageReference] = inspected.stdout
    .trim()
    .split('|')
    .map((part) => JSON.parse(part));
  assert.equal(labels['com.docker.compose.project'], context.project);
  assert.equal(labels['com.docker.compose.service'], 'postgres');
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(imageReference, context.images.postgres);
  const volumes = mounts.filter(
    (mount) => mount.Destination === '/var/lib/postgresql/data' && mount.Type === 'volume',
  );
  assert.equal(volumes.length, 1, 'Require exactly one private PostgreSQL data volume');
  assert.ok(
    volumes[0].Name.startsWith(`${context.project}_`),
    'Volume not scoped to owned project',
  );
  const bindings = ports['5432/tcp'];
  assert.equal(bindings?.length, 1, 'Require one loopback port binding');
  assert.equal(bindings[0].HostIp, '127.0.0.1');
  assert.equal(Number(bindings[0].HostPort), allocation.ports.postgres);
  const cluster = await psqlBootstrap(
    context,
    'postgres',
    'SELECT system_identifier::text FROM pg_control_system();',
    { signal },
  );
  assert.equal(cluster.code, 0, 'Cannot observe actual PostgreSQL cluster identity');
  assert.equal(cluster.outcome, 'exited');
  assert.match(cluster.stdout.trim(), /^[0-9]+$/);
  return {
    project: context.project,
    containerId: id,
    volumeName: volumes[0].Name,
    imageId,
    imageReference,
    hostIp: bindings[0].HostIp,
    postgresPort: Number(bindings[0].HostPort),
    serverIdentifier: cluster.stdout.trim(),
  };
}

export async function twoStackAcceptance(options = {}) {
  const started = Date.now();
  const report = {
    schemaVersion: 1,
    gate: 'real-two-disposable-postgres-stack-isolation',
    accepted: false,
    startedAt: new Date().toISOString(),
    phases: [],
    observations: [],
    ownedDockerHandles: [],
    scope:
      'PostgreSQL port/container/volume/credential/data isolation; no RabbitMQ/object/browser acceptance',
  };
  const allocations = [];
  const contexts = [];
  const startedProjects = new Set();
  const controller = new AbortController();
  const onSignal = () => controller.abort(new Error('ACCEPTANCE_INTERRUPTED'));
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  let heavy;
  let error;
  let cleanupSafe = true;
  async function phase(name, operation) {
    try {
      const detail = await operation();
      report.phases.push({ name, status: 'PASS', ...(detail ?? {}) });
      process.stdout.write(`[PASS] ${name}\n`);
      return detail;
    } catch (cause) {
      report.phases.push({ name, status: 'FAIL', error: redact(cause.message) });
      throw cause;
    }
  }
  try {
    await phase('pinned-toolchain-and-source', async () => {
      const pinned = (await readFile(join(ROOT, '.nvmrc'), 'utf8')).trim();
      assert.equal(process.versions.node, pinned, 'Use the exact repository-pinned Node version');
      const head = await runOrThrow('git', ['rev-parse', 'HEAD', 'HEAD^{tree}'], { cwd: ROOT });
      [report.sourceSha, report.sourceTree] = head.stdout.trim().split('\n');
      report.sourceDirty = sourceDirty();
      assert.equal(
        report.sourceDirty,
        false,
        'Runtime acceptance requires committed, clean source',
      );
      return {
        node: process.versions.node,
        sourceSha: report.sourceSha,
        sourceTree: report.sourceTree,
      };
    });
    await phase('allocate-two-owned-run-environments', async () => {
      for (const [index, lane] of ['A', 'B'].entries()) {
        const allocation = await allocateEnvironment({
          ...options,
          lane,
          slot: options.slots?.[index],
        });
        registerSecret(allocation.token);
        allocations.push(allocation);
        contexts.push(
          await createRunContext({
            parallelAllocation: allocation.paths.manifest,
            parallelIdentity: { lane, wave: allocation.wave, run: allocation.run },
          }),
        );
      }
      assert.notEqual(contexts[0].ports.postgres, contexts[1].ports.postgres);
      assert.notEqual(contexts[0].credentials.vehicle_db, contexts[1].credentials.vehicle_db);
      heavy = await claimHeavySlot(allocations[0]);
      registerSecret(heavy.token);
      report.allocations = allocations.map((allocation) => ({
        lane: allocation.lane,
        wave: allocation.wave,
        run: allocation.run,
        project: allocation.composeProject,
        manifest: allocation.paths.manifest,
        ports: allocation.portBlock,
      }));
    });
    await phase('docker-daemon-and-owned-project-absence', async () => {
      report.environment = await dockerEnvironment(contexts[0]);
      for (const context of contexts) await requireNoProjectResources(context, controller.signal);
    });
    await phase('two-simultaneous-private-postgres-containers', async () => {
      for (const context of contexts) {
        controller.signal.throwIfAborted();
        // composeUp currently has no service selector. Use the same canonical
        // compose file, explicitly selecting PostgreSQL instead of two brokers.
        startedProjects.add(context.project);
        await runOrThrow(
          'docker',
          [...composeArgs(context), 'up', '-d', '--wait', '--wait-timeout', '180', 'postgres'],
          { cwd: ROOT, env: childEnv(context), signal: controller.signal, timeoutMs: 600000 },
        );
        await waitForPostgresReady(context, controller.signal);
      }
      for (const [index, context] of contexts.entries()) {
        const observation = await observeContainer(context, allocations[index], controller.signal);
        report.observations.push(observation);
        report.ownedDockerHandles.push({
          project: observation.project,
          containerId: observation.containerId,
          volumeName: observation.volumeName,
        });
      }
    });
    const markers = [randomUUID(), randomUUID()];
    await phase('same-owner-schema-distinct-sentinel-data', async () => {
      for (const [index, context] of contexts.entries()) {
        assert.ok(
          context.services.includes('vehicle'),
          'Vehicle runtime must be provisioned before W01 isolation gate',
        );
        await checkedSql(
          context,
          migrationDsn(context, 'vehicle'),
          `CREATE TABLE app.w01_lane_isolation_sentinel (marker text PRIMARY KEY);
           INSERT INTO app.w01_lane_isolation_sentinel (marker) VALUES ('${markers[index]}');`,
          controller.signal,
        );
      }
      for (const [index, context] of contexts.entries()) {
        const rows = await checkedSql(
          context,
          appDsn(context, 'vehicle'),
          `SELECT current_database() AS database, current_user AS role,
           inet_server_port() AS "internalPort",
           (SELECT array_agg(marker ORDER BY marker) FROM app.w01_lane_isolation_sentinel) AS markers;`,
          controller.signal,
        );
        assert.equal(rows.length, 1);
        Object.assign(report.observations[index], rows[0]);
      }
    });
    await phase('cross-stack-credentials-denied-for-the-right-reason', async () => {
      for (const [index, context] of contexts.entries()) {
        const foreignUrl = new URL(appDsn(contexts[1 - index], 'vehicle'));
        foreignUrl.port = String(context.ports.postgres);
        const denied = await sql(
          context,
          foreignUrl.toString(),
          'SELECT current_database();',
          controller.signal,
        );
        assert.notEqual(denied.exitCode, 0, 'Foreign stack password authenticated');
        assert.equal(denied.ok, false);
        assert.equal(
          denied.code,
          '28P01',
          'Expected password failure, not a transport/setup failure',
        );
        report.observations[index].crossCredentialCode = denied.code;
      }
      assertIsolationObservations({ allocations, markers, observations: report.observations });
    });
    await phase('source-unchanged-after-real-isolation-probes', async () => {
      const final = await runOrThrow('git', ['rev-parse', 'HEAD', 'HEAD^{tree}'], { cwd: ROOT });
      assert.deepEqual(final.stdout.trim().split('\n'), [report.sourceSha, report.sourceTree]);
      report.sourceDirty = sourceDirty();
      assert.equal(report.sourceDirty, false, 'Source changed during runtime isolation acceptance');
    });
  } catch (cause) {
    error = cause;
    report.error = redact(cause.message);
  } finally {
    // Deliberately omit the aborted signal: cleanup must run after interruption.
    for (const context of contexts.toReversed()) {
      if (!startedProjects.has(context.project)) continue;
      try {
        await phase(`cleanup-owned-project:${context.project}`, async () => {
          const down = await composeDown(context);
          assert.equal(down.code, 0, redact(down.stderr ?? 'Compose cleanup failed'));
          assert.equal(down.outcome, 'exited');
          await requireNoProjectResources(context);
        });
      } catch (cause) {
        cleanupSafe = false;
        error ??= cause;
      }
    }
    if (cleanupSafe) {
      try {
        await phase('release-only-owned-heavy-and-allocation-leases', async () => {
          if (heavy) await releaseHeavySlot({ ...allocations[0], heavyToken: heavy.token });
          for (const allocation of allocations.toReversed()) await releaseEnvironment(allocation);
        });
      } catch (cause) {
        error ??= cause;
        cleanupSafe = false;
      }
    }
    report.leasesRetained = !cleanupSafe;
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - started;
    report.accepted =
      !error && report.phases.length > 0 && report.phases.every((item) => item.status === 'PASS');
    report.error ??= error ? redact(error.message) : undefined;
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    const directories = new Set([
      ...(options.evidenceDir ? [options.evidenceDir] : []),
      ...allocations.map((allocation) => allocation.paths.artifacts),
    ]);
    for (const directory of directories) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        join(directory, 'two-stack-isolation.json'),
        `${redact(JSON.stringify(report, null, 2))}\n`,
        { flag: 'wx', mode: 0o600 },
      );
    }
  }
  process.stdout.write(`${redact(JSON.stringify(report))}\n`);
  return report;
}

const USAGE = `Usage: node scripts/parallel/E/two-stack-acceptance.mjs [--run UNIQUE_RUN] [--wave W01]
  [--state-root ABSOLUTE_SHARED_WORKSTATION_ROOT] [--slots 0,1] [--evidence-dir ABSOLUTE_PATH]
Starts two simultaneous disposable PostgreSQL stacks under one heavy lease, writes
sentinels through Vehicle migration roles, verifies isolated data/credentials/volumes,
then removes only its owned Compose projects. No Docker means FAIL, never mocked PASS.
Requires clean committed source, exact pinned Node, frozen dependencies and Docker.
Do not wrap in with-heavy: this gate acquires and releases its own single heavy slot.`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).includes('--help')) process.stdout.write(`${USAGE}\n`);
  else {
    twoStackAcceptance(parseArguments(process.argv.slice(2)))
      .then((report) => {
        process.exitCode = report.accepted ? 0 : 1;
      })
      .catch((error) => {
        process.stderr.write(`${redact(error.message)}\n`);
        process.exitCode = 1;
      });
  }
}
