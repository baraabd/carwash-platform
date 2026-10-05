import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { readRegularFile } from '../../../scripts/lib/read-regular-file.mjs';
import {
  allocateEnvironment,
  claimHeavySlot,
  describeEnvironment,
  releaseEnvironment,
  releaseHeavySlot,
  runHeavyCommand,
  SERVICE_IDS,
  validateActiveAllocation,
  validateIdentity,
} from '../../../scripts/parallel/E/allocate-environment.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(
  new URL('../../../scripts/parallel/E/allocate-environment.mjs', import.meta.url),
);
const identity = { lane: 'E', wave: 'W01', run: 'acceptance-01' };

async function isolated(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'cw-allocation-test-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  return { ...identity, stateRoot };
}

const names = (allocation) => [
  allocation.namespace,
  allocation.composeProject,
  allocation.broker.vhost,
  allocation.broker.queuePrefix,
  allocation.objectStore.prefix,
  allocation.redis.keyPrefix,
  ...Object.values(allocation.databases).flatMap((item) =>
    Object.entries(item).map(([key, value]) =>
      key === 'scope' ? value : `${item.scope}/${value}`,
    ),
  ),
  ...Object.values(allocation.paths),
];

test('two concurrent lane allocations have disjoint names and complete port blocks', async (t) => {
  const options = await isolated(t);
  const [first, second] = await Promise.all([
    allocateEnvironment({ ...options, lane: 'A' }),
    allocateEnvironment({ ...options, lane: 'B' }),
  ]);
  assert.notEqual(first.slot, second.slot);
  assert.equal(Object.keys(first.ports).length, 31);
  assert.ok(
    first.portBlock.last < second.portBlock.first || second.portBlock.last < first.portBlock.first,
  );
  assert.equal(new Set(Object.values(first.ports)).size, 31);
  assert.ok(names(first).every((name) => !names(second).includes(name)));
  for (const entry of Object.values(first.databases)) {
    for (const name of Object.values(entry)) assert.ok(name.length <= 63);
  }
  assert.match(first.evidenceScope, /resource-allocation-only/);
  assert.deepEqual(first.ownedProcesses, []);
  const catalog = JSON.parse(
    await readFile(new URL('../../../architecture/service-catalog.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual([...SERVICE_IDS].sort(), catalog.services.map((service) => service.id).sort());
  for (const service of catalog.services) {
    assert.equal(first.databases[service.id].database, service.database);
    assert.equal(first.databases[service.id].runtimeRole, service.runtimeRole);
    assert.equal(first.databases[service.id].migrationRole, service.migrationRole);
    assert.notEqual(first.databases[service.id].scope, second.databases[service.id].scope);
    assert.notEqual(
      first.databases[service.id].testDatabase,
      second.databases[service.id].testDatabase,
    );
  }
});

test('explicit slots are deterministic but an occupied slot or port range is rejected', async (t) => {
  const options = await isolated(t);
  const first = await allocateEnvironment({ ...options, slot: 4 });
  const expected = describeEnvironment({ ...options, slot: 4 });
  assert.deepEqual(first.ports, expected.ports);
  assert.equal(first.composeProject, expected.composeProject);
  await assert.rejects(allocateEnvironment({ ...options, lane: 'A', slot: 4 }), /SLOT_COLLISION/);
  await assert.rejects(
    allocateEnvironment({ ...options, lane: 'B', slot: 3, basePort: 20064 }),
    /PORT_BLOCK_COLLISION/,
  );
  await assert.rejects(allocateEnvironment({ ...options, slot: 5 }), /RUN_COLLISION/);
  assert.equal(JSON.parse(await readFile(first.paths.manifest, 'utf8')).token, first.token);
});

test('different processes serialize allocation without colliding or overwriting reservations', async (t) => {
  const options = await isolated(t);
  const invoke = (lane) =>
    exec(process.execPath, [
      script,
      'allocate',
      '--lane',
      lane,
      '--wave',
      options.wave,
      '--run',
      options.run,
      '--state-root',
      options.stateRoot,
    ]);
  const output = await Promise.all([invoke('A'), invoke('B'), invoke('C')]);
  const allocations = output.map((item) => JSON.parse(item.stdout));
  assert.equal(new Set(allocations.map((item) => item.slot)).size, 3);
  assert.equal(new Set(allocations.flatMap((item) => Object.values(item.ports))).size, 93);
});

test('one heavy slot spans lanes and release requires both ownership tokens', async (t) => {
  const options = await isolated(t);
  const first = await allocateEnvironment(options);
  const other = await allocateEnvironment({ ...options, lane: 'A' });
  const [a, b] = await Promise.allSettled([
    claimHeavySlot({ ...options, token: first.token }),
    claimHeavySlot({ ...options, lane: 'A', token: other.token }),
  ]);
  const results = [a, b];
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.match(
    results.find((result) => result.status === 'rejected').reason.message,
    /HEAVY_SLOT_BUSY/,
  );
  const owner =
    a.status === 'fulfilled'
      ? { ...options, token: first.token }
      : { ...options, lane: 'A', token: other.token };
  const otherOwner =
    a.status === 'fulfilled'
      ? { ...options, lane: 'A', token: other.token }
      : { ...options, token: first.token };
  const heavy = results.find((result) => result.status === 'fulfilled').value;
  await assert.rejects(
    releaseHeavySlot({ ...otherOwner, heavyToken: heavy.token }),
    /NOT_HEAVY_SLOT_OWNER/,
  );
  await assert.rejects(
    releaseHeavySlot({ ...owner, heavyToken: 'wrong-token' }),
    /NOT_HEAVY_SLOT_OWNER/,
  );
  await assert.rejects(releaseEnvironment(owner), /RELEASE_HEAVY_SLOT_FIRST/);
  await releaseHeavySlot({ ...owner, heavyToken: heavy.token });
  const next = await claimHeavySlot(otherOwner);
  await releaseHeavySlot({ ...otherOwner, heavyToken: next.token });
});

test('separate CLI processes cannot hold the workstation heavy slot concurrently', async (t) => {
  const options = await isolated(t);
  const first = await allocateEnvironment(options);
  const other = await allocateEnvironment({ ...options, lane: 'A' });
  const claim = (allocation) =>
    exec(process.execPath, [
      script,
      'claim-heavy',
      '--lane',
      allocation.lane,
      '--wave',
      allocation.wave,
      '--run',
      allocation.run,
      '--state-root',
      options.stateRoot,
      '--token',
      allocation.token,
    ]);
  const results = await Promise.allSettled([claim(first), claim(other)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.match(
    results.find((result) => result.status === 'rejected').reason.stderr,
    /HEAVY_SLOT_BUSY/,
  );
  const owner = results[0].status === 'fulfilled' ? first : other;
  const heavy = JSON.parse(results.find((result) => result.status === 'fulfilled').value.stdout);
  await releaseHeavySlot({ ...owner, heavyToken: heavy.token });
});

test('release preserves artifacts, refuses a foreign token, and never reuses a run', async (t) => {
  const options = await isolated(t);
  const first = await allocateEnvironment(options);
  const evidence = join(first.paths.artifacts, 'evidence.txt');
  await writeFile(evidence, 'owned evidence');
  await assert.rejects(
    releaseEnvironment({ ...options, token: 'foreign' }),
    /NOT_ALLOCATION_OWNER/,
  );
  const released = await releaseEnvironment({ ...options, token: first.token });
  assert.equal(released.status, 'released');
  assert.equal(await readFile(evidence, 'utf8'), 'owned evidence');
  await assert.rejects(allocateEnvironment(options), /RUN_ALREADY_USED/);
  const next = await allocateEnvironment({ ...options, run: 'next-run' });
  assert.equal(next.slot, first.slot);
  await assert.rejects(
    releaseEnvironment({ ...options, token: first.token }),
    /ALLOCATION_NOT_ACTIVE/,
  );
  assert.equal(JSON.parse(await readFile(next.paths.manifest, 'utf8')).token, next.token);
});

test('invalid identifiers, traversal, relative roots, slots and port overflow fail before resource writes', async (t) => {
  const options = await isolated(t);
  for (const run of ['../escape', '..', '/tmp/x', 'x\\y', 'UPPER', '', 'x'.repeat(33), 'x:y']) {
    assert.throws(() => validateIdentity({ ...options, run }), /INVALID_RUN/);
  }
  for (const lane of ['F', 'e', '../A', undefined]) {
    assert.throws(() => validateIdentity({ ...options, lane }), /INVALID_LANE/);
  }
  for (const wave of ['W1', 'w01', 'W001', '../W01']) {
    assert.throws(() => validateIdentity({ ...options, wave }), /INVALID_WAVE/);
  }
  assert.throws(
    () => describeEnvironment({ ...options, slot: 0, stateRoot: '../relative' }),
    /ABSOLUTE/,
  );
  for (const slot of [-1, 0.1, 256, NaN]) {
    assert.throws(() => describeEnvironment({ ...options, slot }), /INVALID_SLOT/);
  }
  assert.throws(
    () => describeEnvironment({ ...options, slot: 255, basePort: 65000 }),
    /PORT_BLOCK_OVERFLOW/,
  );
  assert.throws(
    () => describeEnvironment({ ...options, slot: 0, basePort: 1000 }),
    /INVALID_BASE_PORT/,
  );
  const result = await exec(process.execPath, [
    script,
    'allocate',
    '--lane',
    'E',
    '--wave',
    'W01',
    '--run',
    'cli-01',
    '--slot',
    '1e2',
    '--state-root',
    options.stateRoot,
  ]).catch((error) => error);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /INVALID_SLOT/);
});

test('stale registry/heavy locks are never guessed dead or removed', async (t) => {
  const options = await isolated(t);
  const first = await allocateEnvironment(options);
  const registryLock = join(options.stateRoot, 'registry.lock');
  await mkdir(registryLock);
  await writeFile(
    join(registryLock, 'owner.json'),
    JSON.stringify({ token: 'foreign', pid: 99999999 }),
  );
  await assert.rejects(
    allocateEnvironment({ ...options, run: 'second', lockTimeoutMs: 0 }),
    /REGISTRY_BUSY/,
  );
  assert.equal(
    JSON.parse(await readFile(join(registryLock, 'owner.json'), 'utf8')).token,
    'foreign',
  );
  await rm(registryLock, { recursive: true }); // This test created the fixture.
  await mkdir(join(options.stateRoot, 'heavy.lock'));
  await assert.rejects(claimHeavySlot({ ...options, token: first.token }), /HEAVY_SLOT_INCOMPLETE/);
});

test('read-only validation rejects revoked, foreign, copied and forged allocation resources', async (t) => {
  const options = await isolated(t);
  const allocation = await allocateEnvironment(options);
  assert.equal(
    (await validateActiveAllocation(allocation.paths.manifest, options)).token,
    allocation.token,
  );
  await assert.rejects(
    validateActiveAllocation(allocation.paths.manifest, { lane: 'A' }),
    /IDENTITY_MISMATCH/,
  );
  const copied = join(options.stateRoot, 'copied.json');
  await writeFile(copied, JSON.stringify(allocation));
  await assert.rejects(validateActiveAllocation(copied), /MANIFEST_PATH_MISMATCH/);
  await writeFile(
    allocation.paths.manifest,
    JSON.stringify({ ...allocation, ports: { ...allocation.ports, postgres: 5432 } }),
  );
  await assert.rejects(
    validateActiveAllocation(allocation.paths.manifest),
    /RESOURCE_MISMATCH:ports/,
  );
  await writeFile(allocation.paths.manifest, JSON.stringify(allocation));
  const slotRecord = join(
    options.stateRoot,
    'slots',
    String(allocation.slot).padStart(3, '0'),
    'allocation.json',
  );
  await writeFile(slotRecord, JSON.stringify({ ...allocation, token: 'foreign' }));
  await assert.rejects(validateActiveAllocation(allocation.paths.manifest), /REGISTRY_MISMATCH/);
  await writeFile(slotRecord, JSON.stringify(allocation));
  await releaseEnvironment({ ...options, token: allocation.token });
  await assert.rejects(
    validateActiveAllocation(allocation.paths.manifest),
    /ALLOCATION_NOT_ACTIVE/,
  );
  await assert.rejects(validateActiveAllocation('relative.json'), /ABSOLUTE/);
});

test('descriptor reader neither creates missing files nor changes existing permissions', async (t) => {
  const options = await isolated(t);
  const missingFile = join(options.stateRoot, 'missing-read-only.json');
  assert.throws(() => readRegularFile(missingFile, 1024), /ENOENT/);
  assert.equal(fs.existsSync(missingFile), false, 'A read cannot create an allocation file');
  const file = join(options.stateRoot, 'existing-read-only.json');
  await writeFile(file, 'existing state', { flag: 'wx', mode: 0o640 });
  const permissions = fs.statSync(file).mode;
  assert.equal(readRegularFile(file, 1024).toString('utf8'), 'existing state');
  assert.equal(fs.statSync(file).mode, permissions, 'A read cannot rewrite permissions');
});

test('allocation reader rejects symlinks, nonregular files and oversized manifests', async (t) => {
  const options = await isolated(t);
  const allocation = await allocateEnvironment(options);
  const original = join(allocation.paths.runRoot, 'original.json');
  await rename(allocation.paths.manifest, original);
  await symlink(original, allocation.paths.manifest);
  await assert.rejects(
    validateActiveAllocation(allocation.paths.manifest),
    /ELOOP|FILE_IDENTITY_CHANGED/,
  );
  await rm(allocation.paths.manifest);
  await mkdir(allocation.paths.manifest);
  await assert.rejects(validateActiveAllocation(allocation.paths.manifest), /NOT_A_REGULAR_FILE/);
  await rm(allocation.paths.manifest, { recursive: true });
  await writeFile(allocation.paths.manifest, ' '.repeat(1024 * 1024 + 1));
  await assert.rejects(validateActiveAllocation(allocation.paths.manifest), /FILE_LIMIT_EXCEEDED/);
  await rm(allocation.paths.manifest);
  await rename(original, allocation.paths.manifest);
  assert.equal((await validateActiveAllocation(allocation.paths.manifest)).token, allocation.token);
});

test('manifest replacement after open is refused before any descriptor content is read', async (t) => {
  const options = await isolated(t);
  const allocation = await allocateEnvironment(options);
  const original = join(allocation.paths.runRoot, 'retained.json');
  const replacement = join(allocation.paths.runRoot, 'replacement.json');
  await writeFile(replacement, JSON.stringify({ foreign: 'must-never-be-read' }));
  const originalFstat = fs.fstatSync;
  const originalRead = fs.readSync;
  let replaced = false;
  let readCount = 0;
  const statMock = t.mock.method(fs, 'fstatSync', (descriptor) => {
    const stat = originalFstat(descriptor);
    if (!replaced) {
      replaced = true;
      fs.renameSync(allocation.paths.manifest, original);
      fs.renameSync(replacement, allocation.paths.manifest);
    }
    return stat;
  });
  const readMock = t.mock.method(fs, 'readSync', (...args) => {
    readCount++;
    return originalRead(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      validateActiveAllocation(allocation.paths.manifest),
      /FILE_IDENTITY_CHANGED/,
    );
    assert.equal(replaced, true);
    assert.equal(readCount, 0, 'Changed pathname must never trigger content reading');
  } finally {
    statMock.mock.restore();
    readMock.mock.restore();
    syncBuiltinESMExports();
  }
  await rm(allocation.paths.manifest);
  await rename(original, allocation.paths.manifest);
  assert.equal((await validateActiveAllocation(allocation.paths.manifest)).token, allocation.token);
});

test(
  'Linux FIFO substitution fails promptly instead of blocking before fstat',
  {
    skip:
      process.platform !== 'linux' &&
      'Linux FIFO behavior requires Linux; Windows runtime acceptance remains separate',
  },
  async (t) => {
    const options = await isolated(t);
    const allocation = await allocateEnvironment(options);
    await rm(allocation.paths.manifest);
    await exec('mkfifo', [allocation.paths.manifest]);
    const outcome = await exec(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'const module = await import(process.argv[1]); await module.validateActiveAllocation(process.argv[2]);',
        pathToFileURL(script).href,
        allocation.paths.manifest,
      ],
      { timeout: 2000 },
    ).then(
      () => null,
      (error) => error,
    );
    assert.ok(outcome, 'A FIFO is not an allocation manifest');
    assert.equal(outcome.killed, false, 'FIFO open hung until the subprocess deadline');
    assert.match(outcome.stderr, /NOT_A_REGULAR_FILE/);
  },
);

test('heavy runner records its direct child and retains the slot until that child closes', async (t) => {
  const options = await isolated(t);
  const allocation = await allocateEnvironment(options);
  const readyPath = join(allocation.paths.temporary, 'ready');
  const continuePath = join(allocation.paths.temporary, 'continue');
  const childCode = `const fs=require('node:fs'); fs.writeFileSync(process.argv[1], process.env.CW_PARALLEL_ALLOCATION);
    const id=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(id);process.exit(7)}}, 10);`;
  const running = runHeavyCommand({ ...options, token: allocation.token }, process.execPath, [
    '-e',
    childCode,
    readyPath,
    continuePath,
  ]);
  const deadline = Date.now() + 5000;
  let current;
  for (;;) {
    current = JSON.parse(await readFile(allocation.paths.manifest, 'utf8'));
    if (current.ownedProcesses.length) break;
    if (Date.now() > deadline) throw new Error('CHILD_RECORD_TIMEOUT');
    await new Promise((done) => setTimeout(done, 10));
  }
  assert.equal(current.ownedProcesses[0].launcherPid, process.pid);
  assert.notEqual(current.ownedProcesses[0].pid, process.pid);
  while (!(await readFile(readyPath, 'utf8').catch(() => ''))) {
    if (Date.now() > deadline) throw new Error('CHILD_READY_TIMEOUT');
    await new Promise((done) => setTimeout(done, 10));
  }
  assert.equal(await readFile(readyPath, 'utf8'), allocation.paths.manifest);
  await assert.rejects(
    releaseEnvironment({ ...options, token: allocation.token }),
    /RELEASE_HEAVY_SLOT_FIRST/,
  );
  await assert.rejects(
    releaseHeavySlot({
      ...options,
      token: allocation.token,
      heavyToken: current.ownedProcesses[0].heavyToken,
    }),
    /OWNED_PROCESSES_STILL_RUNNING/,
  );
  await writeFile(continuePath, 'continue');
  assert.equal((await running).exitCode, 7);
  assert.deepEqual(
    JSON.parse(await readFile(allocation.paths.manifest, 'utf8')).ownedProcesses,
    [],
  );
  await releaseEnvironment({ ...options, token: allocation.token });
});

test('failed heavy executable releases only its own heavy slot', async (t) => {
  const options = await isolated(t);
  const allocation = await allocateEnvironment(options);
  await assert.rejects(
    runHeavyCommand(
      { ...options, token: allocation.token },
      join(options.stateRoot, 'executable-does-not-exist'),
    ),
    /ENOENT/,
  );
  const heavy = await claimHeavySlot({ ...options, token: allocation.token });
  await releaseHeavySlot({ ...options, token: allocation.token, heavyToken: heavy.token });
});

test('a foreign direct child is untouched when another allocation is released', async (t) => {
  const options = await isolated(t);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => child.kill()); // This test owns the child handle.
  const allocation = await allocateEnvironment(options);
  await releaseEnvironment({ ...options, token: allocation.token });
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
});
