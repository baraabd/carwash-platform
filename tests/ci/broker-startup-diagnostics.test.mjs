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
