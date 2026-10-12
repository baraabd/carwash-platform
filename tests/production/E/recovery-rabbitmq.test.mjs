import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  closeRecoveredQueue,
  consumeRecoveredQueue,
  openRecoveredQueue,
} from '../../../scripts/production/E/recovery/rabbitmq-recovery.mjs';

const payloads = ['confirmed payload one', 'confirmed payload two'];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const expected = new Set(payloads.map(digest));

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
