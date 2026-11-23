import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  assertSameQuorumTopology,
  closeRecoveredQueue,
  consumeRecoveredQueue,
  inspectQuorumTopology,
  openRecoveredQueue,
} from '../../../scripts/production/E/recovery/rabbitmq-recovery.mjs';

const payloads = ['confirmed payload one', 'confirmed payload two'];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const expected = new Set(payloads.map(digest));
const topology = {
  node: 'rabbit@drill-mq',
  raName: 'drill_drill.q',
  raUid: 'quorum-member-original',
  dataDir: '/var/lib/rabbitmq/mnesia/rabbit@drill-mq/quorum',
  walDir: '/var/lib/rabbitmq/mnesia/rabbit@drill-mq/quorum',
  registryFile: '/var/lib/rabbitmq/mnesia/rabbit@drill-mq/quorum/names.dets',
  registrySynced: false,
};

test('topology setup syncs only the Ra name registry and returns verifiable storage identity', async () => {
  const evidence = { ...topology, registrySynced: true };
  const result = await inspectQuorumTopology(
    async (args, options) => {
      assert.deepEqual(args.slice(0, 7), [
        'exec',
        'broker',
        'rabbitmqctl',
        '-q',
        '--formatter',
        'json',
        'eval',
      ]);
      assert.match(args[7], /dets:sync\(Registry\)/);
      assert.match(args[7], /ra_directory:uid_of\(quorum_queues, RaName\)/);
      assert.doesNotMatch(args[7], /ra_log|file:sync|timer:sleep/);
      assert.equal(options.timeoutMs, 15000);
      return JSON.stringify({ result: 'ok', value: evidence });
    },
    'broker',
    { persist: true },
  );
  assert.deepEqual(result, evidence);
});

test('post-crash topology inspection is read-only and does not sync any storage', async () => {
  const result = await inspectQuorumTopology(async (args) => {
    assert.doesNotMatch(args.at(-1), /dets:sync|file:sync|timer:sleep/);
    return JSON.stringify({ result: 'ok', value: topology });
  }, 'broker');
  assert.deepEqual(result, topology);
  assert.doesNotThrow(() =>
    assertSameQuorumTopology({ ...topology, registrySynced: true }, result),
  );
});

test('a replaced Ra member cannot be reported as recovery of the original queue', () => {
  assert.throws(
    () => assertSameQuorumTopology(topology, { ...topology, raUid: 'new-empty-member' }),
    /raUid changed across the crash/,
  );
});

test('a changed storage path cannot be reported as same-volume recovery', () => {
  assert.throws(
    () => assertSameQuorumTopology(topology, { ...topology, walDir: `${topology.walDir}/other` }),
    /walDir changed across the crash/,
  );
});

test('topology setup fails closed when the registry or WAL is outside the data volume', async () => {
  for (const key of ['dataDir', 'walDir', 'registryFile']) {
    await assert.rejects(
      inspectQuorumTopology(
        async () =>
          JSON.stringify({
            result: 'ok',
            value: { ...topology, [key]: '/tmp/unpersisted' },
          }),
        'broker',
      ),
      /outside the persisted data volume/,
    );
  }
});

test('missing or failed topology evidence cannot substitute for a successful persistence barrier', async () => {
  for (const output of [
    { result: 'error', value: topology },
    { result: 'ok' },
    { result: 'ok', value: { ...topology, registrySynced: false } },
  ]) {
    await assert.rejects(
      inspectQuorumTopology(async () => JSON.stringify(output), 'broker', { persist: true }),
    );
  }
});

function broker(values = payloads, { count = values.length, consumers = 0, probeError } = {}) {
  const messages = values.map((value) => ({
    content: Buffer.from(value),
    properties: { deliveryMode: 2 },
  }));
  const acknowledged = [];
  const calls = [];
  const channel = Object.assign(new EventEmitter(), {
    async checkQueue(queue) {
      calls.push(['passive', queue]);
      if (probeError) {
        this.emit('error', probeError);
        throw probeError;
      }
      return { queue, messageCount: count, consumerCount: consumers };
    },
    async get(queue, options) {
      calls.push(['get', queue, options]);
      return messages.shift() ?? false;
    },
    ack(message) {
      acknowledged.push(message);
    },
    async close() {
      calls.push(['close channel']);
    },
  });
  const connection = Object.assign(new EventEmitter(), {
    async createChannel() {
      return channel;
    },
    async close() {
      calls.push(['close connection']);
    },
  });
  return { connection, channel, messages, acknowledged, calls };
}

test('recovery uses the passive AMQP count even without management statistics', async () => {
  const b = broker();
  const reader = await openRecoveredQueue(async () => b.connection, 'drill.q', expected.size);
  assert.equal(reader.depth, 2);
  assert.deepEqual(b.calls, [['passive', 'drill.q']]);
  assert.equal(b.messages.length, 2, 'readiness must not consume or requeue messages');
  assert.deepEqual(await consumeRecoveredQueue(reader.channel, 'drill.q', expected), expected);
  assert.equal(b.acknowledged.length, 2);
  assert.ok(
    b.calls.filter(([operation]) => operation === 'get').every((c) => c[2].noAck === false),
  );
  await closeRecoveredQueue(reader);
  assert.deepEqual(b.calls.slice(-2), [['close channel'], ['close connection']]);
});

test('wrong queue depth fails with the observed count and closes the probe without consuming', async () => {
  const b = broker([payloads[0]]);
  await assert.rejects(
    openRecoveredQueue(async () => b.connection, 'drill.q', expected.size),
    /expected 2 ready messages, observed 1; consumers=0/,
  );
  assert.equal(b.messages.length, 1);
  assert.deepEqual(b.calls, [['passive', 'drill.q'], ['close channel'], ['close connection']]);
});

test('an AMQP queue refusal is observed, preserved and closes the failed probe', async () => {
  const error = new Error('NOT_FOUND: drill.q has not recovered');
  const b = broker([], { probeError: error });
  await assert.rejects(
    openRecoveredQueue(async () => b.connection, 'drill.q', expected.size),
    error,
  );
  assert.deepEqual(b.calls.slice(-2), [['close channel'], ['close connection']]);
});

test('connection failure before channel creation preserves the original cause', async () => {
  const b = broker();
  b.connection.createChannel = async () => {
    throw new Error('broker connection closed during recovery');
  };
  b.connection.close = async () => {
    throw new Error('already closed');
  };
  await assert.rejects(
    openRecoveredQueue(async () => b.connection, 'drill.q', expected.size),
    /broker connection closed during recovery/,
  );
});

test('a concurrent consumer cannot make the isolated recovery evidence pass', async () => {
  const b = broker(payloads, { consumers: 1 });
  await assert.rejects(
    openRecoveredQueue(async () => b.connection, 'drill.q', expected.size),
    /unexpected consumer/,
  );
  assert.equal(b.messages.length, 2);
});

for (const [name, values, reason, acknowledged] of [
  ['missing payload', [payloads[0]], /recovered 1 of 2 confirmed messages/, 1],
  ['duplicate payload', [payloads[0], payloads[0]], /duplicate payload/, 1],
  ['corrupted payload', [payloads[0], 'corrupted'], /unknown or corrupted payload/, 1],
  ['extra payload', [...payloads, 'unexpected'], /unexpected additional message/, 2],
]) {
  test(`reconciliation rejects ${name} without acknowledging unverified messages`, async () => {
    const b = broker(values);
    await assert.rejects(consumeRecoveredQueue(b.channel, 'drill.q', expected), reason);
    assert.equal(b.acknowledged.length, acknowledged);
  });
}

test('reconciliation rejects messages that were not marked persistent', async () => {
  const b = broker();
  b.messages[0].properties.deliveryMode = 1;
  await assert.rejects(consumeRecoveredQueue(b.channel, 'drill.q', expected), /non-persistent/);
  assert.equal(b.acknowledged.length, 0);
});
