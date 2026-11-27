import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBrokerContainerNotExited,
  brokerContainerDiagnostics,
  ownedBrokerContainer,
} from '../../scripts/production/B/broker-diagnostics.mjs';

const name = 'cw-p05b-wallet-mq-ae201ee312ea';
const owner = 'current-owned-run';
const id = 'a'.repeat(64);
const success = (stdout, stderr = '') => ({
  code: 0,
  signal: null,
  outcome: 'exited',
  stdout,
  stderr,
});
const inspect = (overrides = {}) =>
  JSON.stringify({
    id,
    owner,
    state: { Status: 'exited', Running: false, ExitCode: 137, OOMKilled: true, ...overrides },
  });

test('startup diagnostics retain exit and OOM evidence plus redacted logs before removal', async () => {
  const commands = [];
  const docker = (args) => {
    commands.push(args);
    return Promise.resolve(
      args[0] === 'inspect'
        ? success(inspect({ Error: 'SensitivePassword' }))
        : success('boot failed SensitivePassword', 'stderr cause'),
    );
  };
  const result = await brokerContainerDiagnostics(docker, name, owner, (text) =>
    text.replaceAll('SensitivePassword', '[REDACTED]'),
  );
  assert.match(result, /"exitCode":137/);
  assert.match(result, /"oomKilled":true/);
  assert.match(result, /boot failed \[REDACTED\]/);
  assert.match(result, /stderr cause/);
  assert.doesNotMatch(result, /SensitivePassword/);
  assert.deepEqual(commands[1], ['logs', '--tail', '120', id]);
  assert.doesNotMatch(commands[0][2], /Config.Env/);
});

test('exited broker stops readiness retries immediately while startup states can proceed', async () => {
  const container = await ownedBrokerContainer(
    () => Promise.resolve(success(inspect())),
    name,
    owner,
  );
  assert.throws(() => assertBrokerContainerNotExited(container), {
    code: 'ACCEPTANCE_CONTAINER_EXITED',
  });
  for (const status of ['created', 'running', 'restarting'])
    assert.doesNotThrow(() =>
      assertBrokerContainerNotExited({ ...container, state: { ...container.state, status } }),
    );
});

test('diagnostics refuse foreign containers without reading any logs', async () => {
  const commands = [];
  const docker = (args) => {
    commands.push(args);
    return Promise.resolve(success(inspect()));
  };
  await assert.rejects(
    brokerContainerDiagnostics(docker, name, 'another-run', (text) => text),
    /ownership mismatch/,
  );
  assert.equal(commands.length, 1);
  await assert.rejects(
    brokerContainerDiagnostics(docker, 'unrelated-container', owner, (text) => text),
  );
  assert.equal(commands.length, 1);
});

test('retained startup evidence is bounded and excludes Docker health-command metadata', async () => {
  const docker = (args) =>
    Promise.resolve(
      args[0] === 'inspect'
        ? success(inspect({ Health: { Log: [{ Output: 'private health metadata' }] } }))
        : success('boot failed\n'.repeat(3000)),
    );
  const result = await brokerContainerDiagnostics(docker, name, owner, (text) => text);
  assert.ok(result.length <= 16000);
  assert.match(result, /"exitCode":137/);
  assert.doesNotMatch(result, /private health metadata/);
});

test('both finance suites inspect their PostgreSQL and broker containers and pin log reads to the inspected ID', async () => {
  for (const consumer of ['wallet', 'reporting']) {
    for (const resource of ['pg', 'mq']) {
      const containerName = `cw-p05b-${consumer}-${resource}-ae201ee312ea`;
      const commands = [];
      const docker = (args) => {
        commands.push(args);
        return Promise.resolve(args[0] === 'inspect' ? success(inspect()) : success('started'));
      };
      const result = await brokerContainerDiagnostics(docker, containerName, owner, (text) => text);
      assert.match(result, /started/);
      assert.equal(commands[0][3], containerName);
      assert.doesNotMatch(commands[0][2], /Config.Env/);
      assert.deepEqual(commands[1], ['logs', '--tail', '120', id]);
    }
  }
});

test('finance namespace extension retains exact names, owner labels and full container IDs', async () => {
  const commands = [];
  const docker = (args) => {
    commands.push(args);
    return Promise.resolve(success(inspect()));
  };
  for (const invalidName of [
    'cw-p05b-other-mq-ae201ee312ea',
    'cw-p05b-reporting-web-ae201ee312ea',
    'cw-p05b-reporting-mq-ae201ee312e',
    'cw-p05b-reporting-mq-ae201ee312eaa',
    'cw-p05b-reporting-mq-ae201ee312eg',
    'cw-p05b-reporting-mq-ae201ee312ea-suffix',
  ])
    await assert.rejects(brokerContainerDiagnostics(docker, invalidName, owner, (text) => text));
  assert.equal(commands.length, 0, 'invalid names must not reach Docker');

  for (const consumer of ['wallet', 'reporting']) {
    const containerName = `cw-p05b-${consumer}-mq-ae201ee312ea`;
    for (const patch of [
      { owner: 'another-run' },
      { id: 'a'.repeat(63) },
      { id: 'z'.repeat(64) },
    ]) {
      const before = commands.length;
      const invalidInspect = (args) => {
        commands.push(args);
        return Promise.resolve(success(JSON.stringify({ ...JSON.parse(inspect()), ...patch })));
      };
      await assert.rejects(
        brokerContainerDiagnostics(invalidInspect, containerName, owner, (text) => text),
      );
      assert.equal(commands.length, before + 1);
      assert.equal(commands.at(-1)[0], 'inspect', 'unowned or unpinned IDs must not reach logs');
    }
  }
});
