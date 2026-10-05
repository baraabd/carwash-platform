import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, lstat, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readRegularFile } from '../../lib/read-regular-file.mjs';

// All worktrees on a workstation must use this SAME root. A filesystem lease
// does not reserve a listening socket or provision any database/broker resource.
export const DEFAULT_STATE_ROOT = join(tmpdir(), 'carwash-parallel-v1');
export const PORT_BLOCK_SIZE = 64;
export const SLOT_COUNT = 256;
export const DEFAULT_BASE_PORT = 20000;
export const SERVICE_IDS = Object.freeze([
  'identity',
  'customer',
  'vehicle',
  'catalog',
  'pricing',
  'geo',
  'media',
  'workforce',
  'scheduling',
  'booking',
  'dispatch',
  'billing',
  'wallet',
  'subscription',
  'communications',
  'reviews',
  'support',
  'reporting',
  'configuration',
]);

function fail(code) {
  throw new Error(code);
}

export function validateIdentity({ lane, wave, run } = {}) {
  if (typeof lane !== 'string' || !/^[A-E]$/.test(lane)) fail('INVALID_LANE');
  if (typeof wave !== 'string' || !/^W[0-9]{2}$/.test(wave)) fail('INVALID_WAVE');
  if (typeof run !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(run)) {
    fail('INVALID_RUN');
  }
  return { lane, wave, run };
}

function statePath(value = DEFAULT_STATE_ROOT) {
  if (typeof value !== 'string' || !isAbsolute(value)) fail('STATE_ROOT_MUST_BE_ABSOLUTE');
  return resolve(value);
}

function identityKey(identity) {
  const { lane, wave, run } = validateIdentity(identity);
  const digest = createHash('sha256').update(`${wave}:${lane}:${run}`).digest('hex').slice(0, 16);
  return `cw_${wave.toLowerCase()}_${lane.toLowerCase()}_${digest}`;
}

function slotName(slot) {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= SLOT_COUNT) fail('INVALID_SLOT');
  return String(slot).padStart(3, '0');
}

export function describeEnvironment(options) {
  const { lane, wave, run } = validateIdentity(options);
  const stateRoot = statePath(options.stateRoot);
  const slot = options.slot;
  slotName(slot);
  const basePort = options.basePort ?? DEFAULT_BASE_PORT;
  if (!Number.isSafeInteger(basePort) || basePort < 1024) fail('INVALID_BASE_PORT');
  const first = basePort + slot * PORT_BLOCK_SIZE;
  const last = first + PORT_BLOCK_SIZE - 1;
  if (last > 65535) fail('PORT_BLOCK_OVERFLOW');
  const namespace = identityKey({ lane, wave, run });
  const composeProject = `cw-${wave.toLowerCase()}-${lane.toLowerCase()}-${run}`;
  const runRoot = join(stateRoot, 'runs', namespace);
  const portNames = [
    'postgres',
    'redis',
    'rabbitmq',
    'rabbitmqManagement',
    'objectStore',
    'objectStoreConsole',
    'smtp',
    'mailbox',
    'gateway',
    'customerWeb',
    'operatorWeb',
    'adminWeb',
    ...SERVICE_IDS,
  ];
  if (portNames.length > PORT_BLOCK_SIZE) fail('PORT_BLOCK_CAPACITY_EXCEEDED');
  const ports = Object.fromEntries(portNames.map((name, index) => [name, first + index]));
  const databases = Object.fromEntries(
    SERVICE_IDS.map((service) => [
      service,
      {
        // Existing provisioning owns catalog identities. Their isolation boundary
        // is this run's private Compose PostgreSQL container, never a shared DB.
        scope: composeProject,
        database: `cw_${service}`,
        runtimeRole: `cw_${service}_app`,
        migrationRole: `cw_${service}_migrate`,
        testDatabase: `${namespace}_${service}_test`,
        testRuntimeRole: `${namespace}_${service}_test_app`,
        testMigrationRole: `${namespace}_${service}_test_migrate`,
      },
    ]),
  );
  return {
    schemaVersion: 1,
    lane,
    wave,
    run,
    namespace,
    composeProject,
    slot,
    basePort,
    stateRoot,
    portBlock: { first, last, size: PORT_BLOCK_SIZE },
    ports,
    databases,
    databaseIsolation: {
      mode: 'disposable-stack',
      scope: composeProject,
      testIdentities: 'allocated-names-only; separately provision before use',
      runtimeProof: 'pending-real-two-stack-data-isolation-acceptance',
    },
    broker: {
      vhost: `/${namespace}`,
      queuePrefix: `${namespace}.`,
      exchangePrefix: `${namespace}.`,
      consumerPrefix: `${namespace}.`,
    },
    objectStore: { bucket: 'carwash-disposable-tests', prefix: `${namespace}/` },
    redis: { keyPrefix: `${namespace}:` },
    testDataPrefix: `${namespace}:`,
    paths: {
      runRoot,
      manifest: join(runRoot, 'allocation.json'),
      browserProfile: join(runRoot, 'browser-profile'),
      temporary: join(runRoot, 'tmp'),
      artifacts: join(runRoot, 'artifacts'),
    },
    ownedProcesses: [],
    evidenceScope:
      'resource-allocation-only; runtime/data isolation requires real stack acceptance',
  };
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('STATE_DIRECTORY_UNSAFE');
}

async function readJson(path) {
  // One bounded descriptor keeps the checked object and the bytes identical.
  // The shared reader rejects final symlinks and replaced pathname identities;
  // state directories remain caller-owned, private workstation resources.
  return JSON.parse(readRegularFile(path, 1024 * 1024).toString('utf8'));
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function replaceJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, json(value), { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function withRegistryLock(root, operation, lockTimeoutMs = 3000) {
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 0 || lockTimeoutMs > 60000) {
    fail('INVALID_LOCK_TIMEOUT');
  }
  await ensureDirectory(root);
  const lock = join(root, 'registry.lock');
  const ownerFile = join(lock, 'owner.json');
  const owner = { token: randomUUID(), pid: process.pid };
  const deadline = Date.now() + lockTimeoutMs;
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline)
        fail('REGISTRY_BUSY; stale leases are never removed automatically');
      await new Promise((done) =>
        setTimeout(done, Math.min(25, Math.max(1, deadline - Date.now()))),
      );
    }
  }
  await writeFile(ownerFile, json(owner), { flag: 'wx', mode: 0o600 });
  try {
    await ensureDirectory(join(root, 'slots'));
    await ensureDirectory(join(root, 'runs'));
    return await operation();
  } finally {
    const current = await readJson(ownerFile);
    if (current.token !== owner.token) fail('REGISTRY_OWNERSHIP_CHANGED');
    await unlink(ownerFile);
    await rmdir(lock);
  }
}

async function activeAllocations(root) {
  const records = [];
  for (const name of await readdir(join(root, 'slots'))) {
    if (!/^[0-9]{3}$/.test(name)) fail('INVALID_SLOT_REGISTRY');
    const directory = join(root, 'slots', name);
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('INVALID_SLOT_REGISTRY');
    const record = await readJson(join(directory, 'allocation.json'));
    if (record.status !== 'allocated' || record.slot !== Number(name))
      fail('INVALID_SLOT_REGISTRY');
    records.push(record);
  }
  return records;
}

// Reusing a released run is refused: preserved evidence and browser state must
// never become another invocation's output. Resume by reading its manifest.
export async function allocateEnvironment(options = {}) {
  validateIdentity(options);
  const root = statePath(options.stateRoot);
  return withRegistryLock(
    root,
    async () => {
      const active = await activeAllocations(root);
      const slot =
        options.slot ??
        Array.from({ length: SLOT_COUNT }, (_, n) => n).find(
          (candidate) => !active.some((record) => record.slot === candidate),
        );
      if (slot === undefined) fail('NO_FREE_SLOT');
      const environment = describeEnvironment({ ...options, stateRoot: root, slot });
      if (active.some((record) => record.slot === slot)) fail('SLOT_COLLISION');
      if (
        active.some(
          (record) =>
            record.portBlock.first <= environment.portBlock.last &&
            record.portBlock.last >= environment.portBlock.first,
        )
      )
        fail('PORT_BLOCK_COLLISION');
      if (
        active.some(
          (record) =>
            record.namespace === environment.namespace ||
            record.composeProject === environment.composeProject,
        )
      )
        fail('RUN_COLLISION');
      const slotDirectory = join(root, 'slots', slotName(slot));
      try {
        await mkdir(environment.paths.runRoot, { mode: 0o700 });
      } catch (error) {
        if (error.code === 'EEXIST') fail('RUN_ALREADY_USED');
        throw error;
      }
      const allocation = {
        ...environment,
        token: randomUUID(),
        status: 'allocated',
        allocatedAt: new Date().toISOString(),
        allocatorPid: process.pid,
      };
      // A crash during allocation intentionally leaves a visible reservation;
      // never infer that a process/stack stopped from an old PID or timestamp.
      await mkdir(slotDirectory, { mode: 0o700 });
      await writeFile(join(slotDirectory, 'allocation.json'), json(allocation), {
        flag: 'wx',
        mode: 0o600,
      });
      await writeFile(environment.paths.manifest, json(allocation), { flag: 'wx', mode: 0o600 });
      for (const path of ['browserProfile', 'temporary', 'artifacts']) {
        await mkdir(environment.paths[path], { mode: 0o700 });
      }
      return allocation;
    },
    options.lockTimeoutMs,
  );
}

async function authenticatedAllocation(root, options) {
  const namespace = identityKey(options);
  const manifestPath = join(root, 'runs', namespace, 'allocation.json');
  const allocation = await readJson(manifestPath);
  if (
    allocation.schemaVersion !== 1 ||
    allocation.namespace !== namespace ||
    allocation.status !== 'allocated'
  )
    fail('ALLOCATION_NOT_ACTIVE');
  if (typeof options.token !== 'string' || options.token !== allocation.token)
    fail('NOT_ALLOCATION_OWNER');
  const slotRecord = await readJson(
    join(root, 'slots', slotName(allocation.slot), 'allocation.json'),
  );
  if (slotRecord.token !== allocation.token || slotRecord.namespace !== namespace)
    fail('ALLOCATION_REGISTRY_MISMATCH');
  return allocation;
}

// Read-only acceptance consumers must check the current reservation, not merely
// trust copied JSON. Validation is a point-in-time observation; runtime users
// must keep the allocation active until all owned resources have stopped.
export async function validateActiveAllocation(manifestPath, expectedIdentity = {}) {
  if (typeof manifestPath !== 'string' || !isAbsolute(manifestPath))
    fail('MANIFEST_PATH_MUST_BE_ABSOLUTE');
  const allocation = await readJson(manifestPath);
  const expected = describeEnvironment(allocation);
  if (allocation.status !== 'allocated') fail('ALLOCATION_NOT_ACTIVE');
  if (resolve(manifestPath) !== expected.paths.manifest) fail('ALLOCATION_MANIFEST_PATH_MISMATCH');
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      allocation.token ?? '',
    )
  ) {
    fail('INVALID_ALLOCATION_TOKEN');
  }
  for (const key of ['lane', 'wave', 'run', 'stateRoot']) {
    if (expectedIdentity[key] !== undefined && expectedIdentity[key] !== allocation[key]) {
      fail('ALLOCATION_IDENTITY_MISMATCH');
    }
  }
  const keys = Object.keys(expected).filter((key) => key !== 'ownedProcesses');
  for (const key of keys) {
    if (!isDeepStrictEqual(allocation[key], expected[key]))
      fail(`ALLOCATION_RESOURCE_MISMATCH:${key}`);
  }
  const root = expected.stateRoot;
  for (const path of [
    root,
    join(root, 'runs'),
    expected.paths.runRoot,
    join(root, 'slots'),
    join(root, 'slots', slotName(allocation.slot)),
    expected.paths.browserProfile,
    expected.paths.temporary,
    expected.paths.artifacts,
  ]) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('STATE_DIRECTORY_UNSAFE');
  }
  const current = await readJson(join(root, 'slots', slotName(allocation.slot), 'allocation.json'));
  if (current.token !== allocation.token || current.status !== 'allocated')
    fail('ALLOCATION_REGISTRY_MISMATCH');
  for (const key of keys) {
    if (!isDeepStrictEqual(current[key], expected[key]))
      fail(`ALLOCATION_REGISTRY_MISMATCH:${key}`);
  }
  if (
    !Array.isArray(allocation.ownedProcesses) ||
    allocation.ownedProcesses.some(
      (entry) =>
        !Number.isSafeInteger(entry.pid) ||
        entry.pid <= 0 ||
        !Number.isSafeInteger(entry.launcherPid) ||
        entry.launcherPid <= 0 ||
        typeof entry.heavyToken !== 'string' ||
        typeof entry.executable !== 'string',
    )
  ) {
    fail('INVALID_OWNED_PROCESS_RECORD');
  }
  // Observe release/replacement that occurred while the two files were read.
  const latest = await readJson(manifestPath);
  if (latest.status !== 'allocated' || latest.token !== allocation.token)
    fail('ALLOCATION_NOT_ACTIVE');
  return allocation;
}

async function readHeavy(root) {
  try {
    return await readJson(join(root, 'heavy.lock', 'owner.json'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      // An existing lock without metadata may belong to a crashed writer.
      try {
        await lstat(join(root, 'heavy.lock'));
      } catch (missing) {
        if (missing.code === 'ENOENT') return null;
        throw missing;
      }
      fail('HEAVY_SLOT_INCOMPLETE; never remove another process lock');
    }
    throw error;
  }
}

export async function claimHeavySlot(options = {}) {
  const root = statePath(options.stateRoot);
  return withRegistryLock(
    root,
    async () => {
      const allocation = await authenticatedAllocation(root, options);
      if (await readHeavy(root)) fail('HEAVY_SLOT_BUSY');
      const directory = join(root, 'heavy.lock');
      const heavy = {
        schemaVersion: 1,
        namespace: allocation.namespace,
        allocationToken: allocation.token,
        token: randomUUID(),
        launcherPid: process.pid,
        claimedAt: new Date().toISOString(),
      };
      await mkdir(directory, { mode: 0o700 });
      await writeFile(join(directory, 'owner.json'), json(heavy), { flag: 'wx', mode: 0o600 });
      return heavy;
    },
    options.lockTimeoutMs,
  );
}

export async function releaseHeavySlot(options = {}) {
  const root = statePath(options.stateRoot);
  return withRegistryLock(
    root,
    async () => {
      const allocation = await authenticatedAllocation(root, options);
      const heavy = await readHeavy(root);
      if (
        !heavy ||
        heavy.namespace !== allocation.namespace ||
        heavy.allocationToken !== allocation.token ||
        heavy.token !== options.heavyToken
      ) {
        fail('NOT_HEAVY_SLOT_OWNER');
      }
      if (allocation.ownedProcesses.length) fail('OWNED_PROCESSES_STILL_RUNNING');
      await unlink(join(root, 'heavy.lock', 'owner.json'));
      await rmdir(join(root, 'heavy.lock'));
      return { released: true, namespace: allocation.namespace };
    },
    options.lockTimeoutMs,
  );
}

export async function releaseEnvironment(options = {}) {
  const root = statePath(options.stateRoot);
  return withRegistryLock(
    root,
    async () => {
      const allocation = await authenticatedAllocation(root, options);
      const heavy = await readHeavy(root);
      if (heavy?.namespace === allocation.namespace) fail('RELEASE_HEAVY_SLOT_FIRST');
      if (allocation.ownedProcesses.length) fail('OWNED_PROCESSES_STILL_RUNNING');
      const directory = join(root, 'slots', slotName(allocation.slot));
      const released = { ...allocation, status: 'released', releasedAt: new Date().toISOString() };
      await replaceJson(allocation.paths.manifest, released);
      await unlink(join(directory, 'allocation.json'));
      await rmdir(directory);
      // Preserve output, database/broker state, and process trees. Teardown must
      // explicitly target this allocation's resources before releasing its ports.
      return released;
    },
    options.lockTimeoutMs,
  );
}

async function recordChild(options, entry) {
  const root = statePath(options.stateRoot);
  await withRegistryLock(
    root,
    async () => {
      const allocation = await authenticatedAllocation(root, options);
      const processes = entry
        ? [...allocation.ownedProcesses, entry]
        : allocation.ownedProcesses.filter((item) => item.heavyToken !== options.heavyToken);
      const updated = { ...allocation, ownedProcesses: processes };
      await replaceJson(allocation.paths.manifest, updated);
      await replaceJson(join(root, 'slots', slotName(allocation.slot), 'allocation.json'), updated);
    },
    options.lockTimeoutMs,
  );
}

// Only this spawned direct-child handle receives signals. No PID-only kills,
// process-group kills, Docker teardown or cross-worktree output cleanup exists.
export async function runHeavyCommand(options, command, args = []) {
  if (
    typeof command !== 'string' ||
    !command ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== 'string')
  )
    fail('INVALID_COMMAND');
  const heavy = await claimHeavySlot(options);
  const scoped = { ...options, heavyToken: heavy.token };
  let child;
  let completion;
  let recorded = false;
  const listeners = [];
  try {
    const manifest = join(
      statePath(options.stateRoot),
      'runs',
      identityKey(options),
      'allocation.json',
    );
    child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, CW_PARALLEL_ALLOCATION: manifest },
    });
    completion = new Promise((done, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => done({ exitCode: code ?? 1, signal }));
    });
    // Install the rejection handler before the async registry update.
    void completion.catch(() => {});
    if (child.pid) {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        const listener = () => {
          if (child.exitCode === null && child.signalCode === null) child.kill(signal);
        };
        process.on(signal, listener);
        listeners.push([signal, listener]);
      }
      await recordChild(scoped, {
        pid: child.pid,
        launcherPid: process.pid,
        heavyToken: heavy.token,
        executable: command,
        startedAt: new Date().toISOString(),
      });
      recorded = true;
    }
    return await completion;
  } catch (error) {
    // A failed metadata write must not free the heavy slot while its child is
    // running. Stop only our direct child and wait for its handle to close.
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await completion.catch(() => {});
    }
    throw error;
  } finally {
    for (const [signal, listener] of listeners) process.removeListener(signal, listener);
    if (recorded) await recordChild(scoped, null);
    await releaseHeavySlot(scoped);
  }
}

export const USAGE = `Usage: node scripts/parallel/E/allocate-environment.mjs COMMAND --lane E --wave W01 --run smoke [options]
Commands: allocate, inspect, release, claim-heavy, release-heavy, with-heavy
Options: --state-root ABSOLUTE_PATH (same path for every workstation worktree)
         --slot 0 (allocate only; omitted selects first free slot)
         --base-port 20000 (allocate only), --token OWNER_TOKEN (other commands)
         --heavy-token HEAVY_TOKEN (release-heavy only)
with-heavy: append -- node path/to/acceptance.mjs (direct executable, no shell)
release: FIRST explicitly stop your own stack/processes; resource teardown is not automatic.
Allocation tests do not prove PostgreSQL, broker, container or browser isolation.
Stale reservations/locks fail closed and require owner reconciliation, never automatic reaping.`;

async function main(argv) {
  if (!argv.length || argv.includes('--help')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const [command, ...rest] = argv;
  const options = {};
  let executable = [];
  const names = {
    '--lane': 'lane',
    '--wave': 'wave',
    '--run': 'run',
    '--state-root': 'stateRoot',
    '--slot': 'slot',
    '--base-port': 'basePort',
    '--token': 'token',
    '--heavy-token': 'heavyToken',
  };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (flag === '--') {
      executable = rest.slice(index + 1);
      break;
    }
    const key = names[flag];
    if (
      !key ||
      options[key] !== undefined ||
      rest[index + 1] === undefined ||
      rest[index + 1].startsWith('--')
    )
      fail('INVALID_ARGUMENTS');
    const value = rest[index + 1];
    options[key] = ['slot', 'basePort'].includes(key)
      ? /^[0-9]+$/.test(value)
        ? Number(value)
        : NaN
      : value;
  }
  validateIdentity(options);
  if (command !== 'allocate' && (options.slot !== undefined || options.basePort !== undefined))
    fail('INVALID_ARGUMENTS');
  if (command !== 'with-heavy' && executable.length) fail('INVALID_ARGUMENTS');
  let result;
  if (command === 'allocate') result = await allocateEnvironment(options);
  else if (command === 'inspect') {
    const manifest = join(
      statePath(options.stateRoot),
      'runs',
      identityKey(options),
      'allocation.json',
    );
    result = await validateActiveAllocation(manifest, options);
    if (result.token !== options.token) fail('NOT_ALLOCATION_OWNER');
  } else if (command === 'release') result = await releaseEnvironment(options);
  else if (command === 'claim-heavy') result = await claimHeavySlot(options);
  else if (command === 'release-heavy') result = await releaseHeavySlot(options);
  else if (command === 'with-heavy') {
    if (!executable.length) fail('COMMAND_REQUIRED');
    result = await runHeavyCommand(options, executable[0], executable.slice(1));
    process.exitCode = result.exitCode;
  } else fail('UNKNOWN_COMMAND');
  process.stdout.write(json(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
