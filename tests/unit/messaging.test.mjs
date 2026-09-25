import test from 'node:test';
import assert from 'node:assert/strict';
import { messaging, contracts } from './_load.mjs';

const {
  ConfirmingPublisher,
  PublishError,
  OutboxRelay,
  InboxConsumer,
  brokerDeliveryCount,
  payloadHash,
  subscriberTopology,
  subscriberQueueName,
  producerTopology,
  sharedTopology,
  assertTopology,
  CATALOG_EVENTS_EXCHANGE,
  FOUNDATION_PROBE_ROUTING_KEY,
  FOUNDATION_TRANSIENT_DELIVERY_LIMIT,
} = messaging;

const { parseFoundationProbeCreatedV1 } = contracts;

/* ------------------------------------------------------------------ *
 * Test doubles. These exercise the ADAPTER LOGIC only. They are not a
 * substitute for the real-broker integration tests, which are a separate,
 * mandatory acceptance gate.
 * ------------------------------------------------------------------ */

class FakeConfirmChannel {
  constructor() {
    this.published = [];
    this.acks = [];
    this.nacks = [];
    this.listeners = new Map();
    this.behaviour = 'confirm';
    this.prefetchValue = null;
  }
  on(event, listener) {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }
  emit(event, payload) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
  publish(exchange, routingKey, content, options, callback) {
    this.published.push({ exchange, routingKey, content, options });
    if (this.behaviour === 'confirm') {
      queueMicrotask(() => callback(null, {}));
    } else if (this.behaviour === 'nack') {
      queueMicrotask(() => callback(new Error('broker rejected')));
    } else if (this.behaviour === 'unroutable') {
      queueMicrotask(() => {
        // The broker returns the message BEFORE acking it.
        this.emit('return', {
          properties: { messageId: options.messageId },
          fields: { exchange, routingKey },
        });
        callback(null, {});
      });
    }
    // 'silent' never calls back, which is the timeout case.
    return true;
  }
  async prefetch(count) {
    this.prefetchValue = count;
  }
  async consume(queue, handler) {
    this.queue = queue;
    this.handler = handler;
    return { consumerTag: 'tag-1' };
  }
  async cancel() {}
  ack(message) {
    this.acks.push(message.id);
  }
  nack(message, allUpTo, requeue) {
    this.nacks.push({ id: message.id, requeue });
  }
  async assertExchange(name, type, options) {
    (this.exchanges ??= []).push({ name, type, options });
    return {};
  }
  async assertQueue(name, options) {
    (this.queues ??= []).push({ name, options });
    return {};
  }
  async bindQueue(queue, source, pattern) {
    (this.bindings ??= []).push({ queue, source, pattern });
    return {};
  }
}

const uuid = (n) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

function probeEvent(overrides = {}) {
  return {
    eventId: uuid(1),
    eventType: 'foundation.probe.created.v1',
    schemaVersion: 1,
    producer: 'catalog',
    occurredAt: '2026-09-20T00:00:00.000Z',
    correlationId: uuid(2),
    aggregateVersion: 1,
    data: { probeId: uuid(3), label: 'probe-alpha' },
    ...overrides,
  };
}

/* ------------------------------ publisher ------------------------------ */

test('publisher: a confirmed publish resolves and is persistent + mandatory', async () => {
  const channel = new FakeConfirmChannel();
  const publisher = new ConfirmingPublisher(channel);
  await publisher.publish({
    exchange: 'catalog.events',
    routingKey: 'foundation.probe.created.v1',
    body: '{}',
    messageId: uuid(1),
    eventType: 'foundation.probe.created.v1',
    correlationId: uuid(2),
  });
  const [sent] = channel.published;
  assert.equal(sent.options.persistent, true);
  // Without `mandatory`, an unroutable message would be silently discarded.
  assert.equal(sent.options.mandatory, true);
  assert.equal(sent.options.messageId, uuid(1));
});

test('publisher: a broker nack is surfaced as a failure, never as success', async () => {
  const channel = new FakeConfirmChannel();
  channel.behaviour = 'nack';
  const publisher = new ConfirmingPublisher(channel);
  await assert.rejects(
    () =>
      publisher.publish({
        exchange: 'catalog.events',
        routingKey: 'rk',
        body: '{}',
        messageId: uuid(1),
        eventType: 't',
        correlationId: uuid(2),
      }),
    (error) => error instanceof PublishError && error.reason === 'NACK',
  );
});

test('publisher: an UNROUTABLE message is a failure even though the broker acked it', async () => {
  // This is the subtle one: the broker acks a returned message. Treating that
  // ack as success would mark the outbox row published while the event reached
  // no queue at all.
  const channel = new FakeConfirmChannel();
  channel.behaviour = 'unroutable';
  const publisher = new ConfirmingPublisher(channel);
  await assert.rejects(
    () =>
      publisher.publish({
        exchange: 'catalog.events',
        routingKey: 'nobody.listens',
        body: '{}',
        messageId: uuid(1),
        eventType: 't',
        correlationId: uuid(2),
      }),
    (error) => error instanceof PublishError && error.reason === 'UNROUTABLE',
  );
});

test('publisher: a missing confirm times out instead of hanging forever', async () => {
  const channel = new FakeConfirmChannel();
  channel.behaviour = 'silent';
  const publisher = new ConfirmingPublisher(channel, undefined, 25);
  await assert.rejects(
    () =>
      publisher.publish({
        exchange: 'x',
        routingKey: 'y',
        body: '{}',
        messageId: uuid(1),
        eventType: 't',
        correlationId: uuid(2),
      }),
    (error) => error instanceof PublishError && error.reason === 'TIMEOUT',
  );
});

test('publisher: publishing on a closed channel fails fast', async () => {
  const channel = new FakeConfirmChannel();
  const publisher = new ConfirmingPublisher(channel);
  channel.emit('close');
  await assert.rejects(
    () =>
      publisher.publish({
        exchange: 'x',
        routingKey: 'y',
        body: '{}',
        messageId: uuid(1),
        eventType: 't',
        correlationId: uuid(2),
      }),
    (error) => error instanceof PublishError && error.reason === 'CHANNEL_CLOSED',
  );
});

test('publisher: a stale return from an earlier message does not fail the next one', async () => {
  const channel = new FakeConfirmChannel();
  const publisher = new ConfirmingPublisher(channel);
  channel.emit('return', { properties: { messageId: uuid(9) }, fields: {} });
  await publisher.publish({
    exchange: 'x',
    routingKey: 'y',
    body: '{}',
    messageId: uuid(1),
    eventType: 't',
    correlationId: uuid(2),
  });
});

/* ------------------------------ outbox relay ------------------------------ */

function record(id) {
  return {
    id: uuid(id),
    eventId: uuid(id),
    eventType: 'foundation.probe.created.v1',
    exchange: 'catalog.events',
    routingKey: 'foundation.probe.created.v1',
    payload: '{}',
    correlationId: uuid(2),
    attempts: 0,
  };
}

class FakeOutboxStore {
  constructor(records, { ownsOnWrite = true } = {}) {
    this.records = records;
    this.ownsOnWrite = ownsOnWrite;
    this.published = [];
    this.failed = [];
    this.leases = [];
  }
  async leaseBatch(input) {
    this.leases.push(input);
    return this.records;
  }
  async markPublished(input) {
    this.published.push(input.id);
    return this.ownsOnWrite;
  }
  async markFailed(input) {
    this.failed.push(input);
    return this.ownsOnWrite;
  }
}

test('relay: publishes then marks published, in that order', async () => {
  const store = new FakeOutboxStore([record(1)]);
  const channel = new FakeConfirmChannel();
  const relay = new OutboxRelay({
    workerId: 'w1',
    store,
    publisher: new ConfirmingPublisher(channel),
  });
  const pass = await relay.runOnce();
  assert.deepEqual(pass, { leased: 1, published: 1, failed: 0, leaseLost: 0 });
  assert.equal(channel.published.length, 1);
  assert.deepEqual(store.published, [uuid(1)]);
});

test('relay: a failed publish is never marked published', async () => {
  const store = new FakeOutboxStore([record(1)]);
  const channel = new FakeConfirmChannel();
  channel.behaviour = 'nack';
  const relay = new OutboxRelay({
    workerId: 'w1',
    store,
    publisher: new ConfirmingPublisher(channel),
  });
  const pass = await relay.runOnce();
  assert.equal(pass.published, 0);
  assert.equal(pass.failed, 1);
  assert.deepEqual(store.published, []);
  assert.equal(store.failed[0].error, 'NACK');
});

test('relay: an unroutable publication leaves the row pending', async () => {
  const store = new FakeOutboxStore([record(1)]);
  const channel = new FakeConfirmChannel();
  channel.behaviour = 'unroutable';
  const relay = new OutboxRelay({
    workerId: 'w1',
    store,
    publisher: new ConfirmingPublisher(channel),
  });
  const pass = await relay.runOnce();
  assert.equal(pass.failed, 1);
  assert.equal(store.failed[0].error, 'UNROUTABLE');
  assert.deepEqual(store.published, []);
});

test('relay: a lost lease is reported, not silently counted as published', async () => {
  // The stale-worker case: the store refuses the write because another worker
  // now owns the row.
  const store = new FakeOutboxStore([record(1)], { ownsOnWrite: false });
  const relay = new OutboxRelay({
    workerId: 'stale-worker',
    store,
    publisher: new ConfirmingPublisher(new FakeConfirmChannel()),
  });
  const pass = await relay.runOnce();
  assert.equal(pass.published, 0);
  assert.equal(pass.leaseLost, 1);
});

test('relay: lease parameters are passed through to the store', async () => {
  const store = new FakeOutboxStore([]);
  const relay = new OutboxRelay({
    workerId: 'w1',
    store,
    publisher: new ConfirmingPublisher(new FakeConfirmChannel()),
    leaseMs: 1234,
    batchSize: 7,
    maxAttempts: 3,
  });
  await relay.runOnce();
  assert.deepEqual(store.leases[0], {
    workerId: 'w1',
    leaseMs: 1234,
    limit: 7,
    maxAttempts: 3,
  });
});

test('relay: an aborted pass stops before processing the remaining rows', async () => {
  const store = new FakeOutboxStore([record(1), record(2), record(3)]);
  const controller = new AbortController();
  controller.abort();
  const relay = new OutboxRelay({
    workerId: 'w1',
    store,
    publisher: new ConfirmingPublisher(new FakeConfirmChannel()),
  });
  const pass = await relay.runOnce(controller.signal);
  assert.equal(pass.published, 0);
});

/* ------------------------------ inbox consumer ------------------------------ */

class FakeInboxStore {
  constructor(outcome = 'APPLIED') {
    this.outcome = outcome;
    this.calls = [];
    this.effects = 0;
  }
  async applyOnce(record, effect) {
    this.calls.push(record);
    if (typeof this.outcome === 'function') return this.outcome(record, effect, this);
    if (this.outcome === 'APPLIED') {
      await effect({});
      this.effects += 1;
    }
    return this.outcome;
  }
}

function message(id, body, headers = undefined) {
  return {
    id,
    content: Buffer.from(body, 'utf8'),
    properties: headers ? { headers } : {},
    fields: {},
  };
}

async function deliver(channel, msg) {
  await channel.handler(msg);
  // Let the async handler settle before asserting.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function makeConsumer(store, extra = {}) {
  const channel = new FakeConfirmChannel();
  const consumer = new InboxConsumer({
    channel,
    queue: 'reporting.catalog.foundation-probe',
    store,
    parse: parseFoundationProbeCreatedV1,
    effect: async () => {},
    ...extra,
  });
  return { channel, consumer };
}

test('consumer: acks only after the store reports a committed apply', async () => {
  const store = new FakeInboxStore('APPLIED');
  const { channel, consumer } = makeConsumer(store);
  await consumer.start();
  await deliver(channel, message('m1', JSON.stringify(probeEvent())));
  assert.deepEqual(channel.acks, ['m1']);
  assert.equal(consumer.stats.applied, 1);
  assert.equal(store.effects, 1);
});

test('consumer: a duplicate is acked but applies no second effect', async () => {
  const store = new FakeInboxStore('DUPLICATE');
  const { channel, consumer } = makeConsumer(store);
  await consumer.start();
  await deliver(channel, message('m1', JSON.stringify(probeEvent())));
  assert.deepEqual(channel.acks, ['m1']);
  assert.equal(consumer.stats.duplicates, 1);
  assert.equal(store.effects, 0);
});

test('consumer: same eventId with different bytes is dead-lettered, never applied', async () => {
  const store = new FakeInboxStore('CONFLICT');
  const { channel, consumer } = makeConsumer(store);
  await consumer.start();
  await deliver(channel, message('m1', JSON.stringify(probeEvent())));
  assert.deepEqual(channel.acks, []);
  assert.deepEqual(channel.nacks, [{ id: 'm1', requeue: false }]);
  assert.equal(consumer.stats.conflicts, 1);
});

test('consumer: an unparseable message goes straight to the dead-letter exchange', async () => {
  const store = new FakeInboxStore('APPLIED');
  const { channel, consumer } = makeConsumer(store);
  await consumer.start();
  await deliver(channel, message('m1', 'not json at all'));
  assert.deepEqual(channel.nacks, [{ id: 'm1', requeue: false }]);
  assert.equal(store.calls.length, 0);
});

test('consumer: a contract violation is dead-lettered rather than retried forever', async () => {
  const store = new FakeInboxStore('APPLIED');
  const { channel, consumer } = makeConsumer(store);
  await consumer.start();
  // Label outside the allowed alphabet: retrying can never make it valid.
  await deliver(
    channel,
    message(
      'm1',
      JSON.stringify(probeEvent({ data: { probeId: uuid(3), label: 'contains pii' } })),
    ),
  );
  assert.deepEqual(channel.nacks, [{ id: 'm1', requeue: false }]);
});

test('consumer: a database failure requeues, it never acks the message away', async () => {
  const store = new FakeInboxStore(() => {
    throw Object.assign(new Error('connection terminated'), { name: 'DbError' });
  });
  const { channel, consumer } = makeConsumer(store);
  await consumer.start();
  await deliver(channel, message('m1', JSON.stringify(probeEvent())));
  assert.deepEqual(channel.acks, []);
  assert.deepEqual(channel.nacks, [{ id: 'm1', requeue: true }]);
});

test('consumer: transient failures always requeue and let RabbitMQ own the durable limit', async () => {
  const store = new FakeInboxStore(() => {
    throw new Error('still broken');
  });
  const { channel, consumer } = makeConsumer(store);
  await consumer.start();
  await deliver(
    channel,
    message('m1', JSON.stringify(probeEvent()), { 'x-delivery-count': 2 }),
  );
  assert.deepEqual(channel.acks, []);
  assert.deepEqual(channel.nacks, [{ id: 'm1', requeue: true }]);
  assert.equal(consumer.stats.transientFailures, 1);
});

test('consumer: quorum delivery count is observable without process-local state', () => {
  assert.equal(
    brokerDeliveryCount(
      message('m1', '{}', { 'x-delivery-count': FOUNDATION_TRANSIENT_DELIVERY_LIMIT - 1 }),
    ),
    FOUNDATION_TRANSIENT_DELIVERY_LIMIT - 1,
  );
  assert.equal(brokerDeliveryCount(message('m2', '{}')), 0);
});

test('consumer: the before-ack hook runs after commit and can suppress the ack', async () => {
  // This models a crash in the commit/ack gap: the effect is committed but the
  // broker never hears about it, so it will redeliver.
  const store = new FakeInboxStore('APPLIED');
  const { channel, consumer } = makeConsumer(store, {
    onBeforeAck: () => {
      throw new Error('simulated crash before ack');
    },
  });
  await consumer.start();
  await deliver(channel, message('m1', JSON.stringify(probeEvent())));
  assert.equal(store.effects, 1, 'the local effect committed');
  assert.deepEqual(channel.acks, [], 'but nothing was acknowledged');
});

test('consumer: prefetch is applied so one worker cannot hoard the queue', async () => {
  const store = new FakeInboxStore('APPLIED');
  const { channel, consumer } = makeConsumer(store, { prefetch: 5 });
  await consumer.start();
  assert.equal(channel.prefetchValue, 5);
});

test('consumer: payload hash is stable and content-sensitive', () => {
  assert.equal(payloadHash('{"a":1}'), payloadHash('{"a":1}'));
  assert.notEqual(payloadHash('{"a":1}'), payloadHash('{"a":2}'));
});

/* ------------------------------ topology ------------------------------ */

test('topology: the queue is named per SUBSCRIBER, not per replica', () => {
  // Naming a queue per replica would turn one subscriber into N subscribers and
  // silently multiply the work instead of sharing it.
  assert.equal(subscriberQueueName('reporting'), 'reporting.catalog.foundation-probe');
  assert.equal(subscriberQueueName('communications'), 'communications.catalog.foundation-probe');
});

test('topology: two subscribers get two different queues on the same exchange', () => {
  const a = subscriberTopology('communications');
  const b = subscriberTopology('reporting');
  const queueA = a.bindings.find((x) => x.exchange === CATALOG_EVENTS_EXCHANGE);
  const queueB = b.bindings.find((x) => x.exchange === CATALOG_EVENTS_EXCHANGE);
  assert.notEqual(queueA.queue, queueB.queue);
  assert.equal(queueA.routingKey, FOUNDATION_PROBE_ROUTING_KEY);
  assert.equal(queueB.routingKey, FOUNDATION_PROBE_ROUTING_KEY);
});

test('topology: a subscriber never declares the producer exchange it does not own', () => {
  const spec = subscriberTopology('reporting');
  assert.ok(
    !spec.exchanges.some((e) => e.name === CATALOG_EVENTS_EXCHANGE),
    'declaring it would be refused by the broker ACL, and rightly so',
  );
  assert.ok(spec.exchanges.some((e) => e.name === 'reporting.dlx'));
});

test('topology: the producer declares exactly its own exchange', () => {
  assert.deepEqual(producerTopology.exchanges, [{ name: CATALOG_EVENTS_EXCHANGE, type: 'topic' }]);
  assert.deepEqual(producerTopology.queues, []);
  assert.deepEqual(sharedTopology.exchanges, [{ name: CATALOG_EVENTS_EXCHANGE, type: 'topic' }]);
});

test('topology: queues are durable and dead-lettered', async () => {
  const channel = new FakeConfirmChannel();
  await assertTopology(channel, subscriberTopology('reporting'));
  const main = channel.queues.find((q) => q.name === 'reporting.catalog.foundation-probe');
  assert.equal(main.options.durable, true);
  assert.equal(main.options.arguments['x-dead-letter-exchange'], 'reporting.dlx');
  assert.equal(main.options.arguments['x-queue-type'], 'quorum');
  assert.equal(
    main.options.arguments['x-delivery-limit'],
    FOUNDATION_TRANSIENT_DELIVERY_LIMIT,
  );
  assert.equal(channel.exchanges[0].options.durable, true);
});
