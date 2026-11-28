import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { messaging } from './_load.mjs';

function channel() {
  return {
    acks: [],
    nacks: [],
    prefetch: async () => {},
    cancel: async () => {},
    consume: async function (_queue, handler) {
      this.handler = handler;
      return { consumerTag: 'prepared' };
    },
    ack(message) {
      this.acks.push(message);
    },
    nack(message, _all, requeue) {
      this.nacks.push({ message, requeue });
    },
  };
}
function event() {
  return { eventId: randomUUID(), eventType: 'source.changed.v1', correlationId: randomUUID() };
}
async function deliver(c, e) {
  c.handler({ content: Buffer.from(JSON.stringify(e)), properties: { headers: {} }, fields: {} });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

test('inbox preparation reads externally before opening the transaction; ACK waits for local effect commit', async () => {
  const c = channel();
  const log = [];
  const prepared = { revision: 3 };
  const consumer = new messaging.InboxConsumer({
    channel: c,
    queue: 'consumer.owner',
    parse: (x) => x,
    prepare: async () => {
      log.push('external-read');
      assert.equal(c.acks.length, 0);
      return prepared;
    },
    store: {
      applyOnce: async (_r, effect) => {
        log.push('begin');
        await effect('tx');
        log.push('commit');
        return 'APPLIED';
      },
    },
    effect: async (_event, tx, source) => {
      assert.equal(tx, 'tx');
      assert.equal(source, prepared);
      log.push('effect');
      assert.equal(c.acks.length, 0);
    },
  });
  await consumer.start();
  await deliver(c, event());
  assert.deepEqual(log, ['external-read', 'begin', 'effect', 'commit']);
  assert.equal(c.acks.length, 1);
  await consumer.stop();
});

test('failed preparation creates no inbox row and requeues without ACK, so owner outage cannot invent completion', async () => {
  const c = channel();
  let transactions = 0;
  const consumer = new messaging.InboxConsumer({
    channel: c,
    queue: 'consumer.owner',
    parse: (x) => x,
    prepare: async () => {
      throw Error('owner unavailable');
    },
    store: {
      applyOnce: async () => {
        transactions++;
        return 'APPLIED';
      },
    },
    effect: async () => {
      throw Error('must not run');
    },
  });
  await consumer.start();
  await deliver(c, event());
  assert.equal(transactions, 0);
  assert.equal(c.acks.length, 0);
  assert.equal(c.nacks[0].requeue, true);
  await consumer.stop();
});

test('local projection failure rolls back and keeps the broker delivery retryable', async () => {
  const c = channel();
  let committed = false;
  const consumer = new messaging.InboxConsumer({
    channel: c,
    queue: 'consumer.owner',
    parse: (x) => x,
    prepare: async () => ({ revision: 2 }),
    store: {
      applyOnce: async (_r, effect) => {
        await effect({});
        committed = true;
        return 'APPLIED';
      },
    },
    effect: async () => {
      throw Error('SCHEDULE_NOT_SYNCHRONIZED');
    },
  });
  await consumer.start();
  await deliver(c, event());
  assert.equal(committed, false);
  assert.equal(c.acks.length, 0);
  assert.equal(c.nacks[0].requeue, true);
  await consumer.stop();
});

test('outbox production loop rejects a lease that cannot cover its sequential confirm budget', async () => {
  await assert.rejects(
    () =>
      messaging.runReconnectingOutboxLoop({
        signal: new AbortController().signal,
        broker: { url: 'amqp://unused', connectionName: 'unused' },
        workerId: 'unused',
        store: {},
        topology: { exchanges: [], queues: [], bindings: [] },
        batchSize: 20,
        confirmTimeoutMs: 5_000,
        leaseMs: 30_000,
      }),
    /INVALID_OUTBOX_LOOP_BUDGET/,
  );
});
