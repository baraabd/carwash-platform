import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  amqp,
  brokerUrl,
  consumerArgs,
  consumerEnv,
  context,
  createProbe,
  eventually,
  infraBrokerUrl,
  messaging,
  queueDepth,
  relayArgs,
  relayEnv,
  resetSlice,
  serviceClient,
  spawnWorker,
} from './_support.mjs';

/**
 * Delivery semantics against a real broker.
 *
 * The two patterns proved here are routinely confused, and confusing them is a
 * data-loss bug rather than a style choice:
 *
 *   fan-out             two DIFFERENT services each get their own copy,
 *   competing consumers two REPLICAS of ONE service share the work.
 *
 * The difference is entirely in queue ownership: one queue per subscribing
 * SERVICE. A queue per replica would turn shared work into duplicated work.
 */

const { CATALOG_EVENTS_EXCHANGE, subscriberQueueName } = messaging();

const clients = {};

before(() => {
  clients.catalog = serviceClient('catalog');
  clients.communications = serviceClient('communications');
  clients.reporting = serviceClient('reporting');
});

after(async () => {
  await Promise.all(Object.values(clients).map((c) => c.$disconnect()));
});

beforeEach(async () => {
  await resetSlice(clients);
});

/** Run the relay until every pending row has been published. */
async function drainOutbox(workerId = 'test-relay') {
  const relay = spawnWorker(
    relayArgs(['--worker-id', workerId, '--interval-ms', '100']),
    relayEnv(),
    { label: `relay:${workerId}` },
  );
  await relay.waitFor((l) => l.event === 'relay_connected', { description: 'relay connection' });
  await eventually(
    async () => {
      const pending = await clients.catalog.outboxMessage.count({
        where: { publishedAt: null, deadAt: null },
      });
      return pending === 0;
    },
    { description: 'outbox drained' },
  );
  await relay.stop();
  return relay;
}

test('one event reaches BOTH subscriber queues independently', async () => {
  // No consumers running: the messages stay queued, which lets the test observe
  // the routing result directly instead of inferring it from side effects.
  const created = await createProbe(clients.catalog, { label: 'probe-fanout' });
  await drainOutbox('fanout-relay');

  assert.equal(await queueDepth('communications', subscriberQueueName('communications')), 1);
  assert.equal(await queueDepth('reporting', subscriberQueueName('reporting')), 1);

  // And both, when consumed, apply the same event to their own local store.
  const consumers = ['communications', 'reporting'].map((service) =>
    spawnWorker(consumerArgs(service, ['--stop-after', '1']), consumerEnv(service), {
      label: `consumer:${service}`,
    }),
  );
  await Promise.all(consumers.map((c) => c.exited));

  const notification = await clients.communications.probeNotification.findUnique({
    where: { probeId: created.probeId },
  });
  const projection = await clients.reporting.probeProjection.findUnique({
    where: { probeId: created.probeId },
  });
  assert.equal(notification?.applyCount, 1);
  assert.equal(projection?.applyCount, 1);
});

test('two replicas of ONE service share its queue instead of duplicating work', async () => {
  const total = 6;
  const created = [];
  for (let i = 0; i < total; i += 1) {
    created.push(await createProbe(clients.catalog, { label: `probe-share-${i}` }));
  }

  const replicas = [0, 1].map((n) =>
    spawnWorker(consumerArgs('reporting'), consumerEnv('reporting'), {
      label: `reporting-replica-${n}`,
    }),
  );
  await Promise.all(
    replicas.map((r) =>
      r.waitFor((l) => l.event === 'consumer_started', { description: 'consumer start' }),
    ),
  );

  await drainOutbox('share-relay');

  await eventually(async () => (await clients.reporting.probeProjection.count()) === total, {
    description: `all ${total} probes projected`,
  });
  await Promise.all(replicas.map((r) => r.stop()));

  const commits = replicas.map(
    (r) => r.lines.filter((l) => l.event === 'consumer_committed').length,
  );
  assert.equal(
    commits[0] + commits[1],
    total,
    'the replicas together handled every message exactly once',
  );
  assert.ok(
    commits[0] > 0 && commits[1] > 0,
    `work was not shared between replicas: ${JSON.stringify(commits)}`,
  );

  // Sharing must not come at the cost of correctness.
  const rows = await clients.reporting.probeProjection.findMany();
  assert.equal(rows.length, total);
  for (const row of rows) assert.equal(row.applyCount, 1, 'a probe was applied more than once');

  // The other subscriber is unaffected by how reporting scaled.
  assert.equal(await queueDepth('communications', subscriberQueueName('communications')), total);
  assert.equal(created.length, total);
});

test('a message that no binding matches is returned, not silently dropped', async () => {
  // `mandatory` + publisher confirms is the only way to learn this; without it
  // the broker acks and the event disappears.
  const { connect } = amqp();
  const connection = await connect(brokerUrl(context, 'catalog'));
  connection.on('error', () => {});
  try {
    const channel = await connection.createConfirmChannel();
    const returned = [];
    channel.on('return', (message) => returned.push(message.fields.routingKey));
    await new Promise((resolve, reject) => {
      channel.publish(
        CATALOG_EVENTS_EXCHANGE,
        'foundation.probe.nobody.binds.this',
        Buffer.from('{}'),
        { persistent: true, mandatory: true, messageId: 'unroutable-1' },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(returned, ['foundation.probe.nobody.binds.this']);
    await channel.close();
  } finally {
    await connection.close();
  }
});

test('a poison message ends up on the dead-letter queue, not in an endless retry loop', async () => {
  // Injected through the real exchange and routing key, which is how a poison
  // message actually arrives. It cannot be produced through ProbeService (the
  // contract refuses to emit invalid bytes) and it cannot be pushed straight
  // onto the queue either, because the default exchange is denied to every
  // identity. The infrastructure identity publishes it instead.
  const { connect } = amqp();
  const connection = await connect(infraBrokerUrl(context));
  connection.on('error', () => {});
  try {
    const channel = await connection.createConfirmChannel();
    await new Promise((resolve, reject) => {
      channel.publish(
        CATALOG_EVENTS_EXCHANGE,
        'foundation.probe.created.v1',
        Buffer.from('this is not a valid event envelope'),
        { persistent: true, mandatory: true },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    await channel.close();
  } finally {
    await connection.close();
  }

  const consumer = spawnWorker(consumerArgs('reporting'), consumerEnv('reporting'), {
    label: 'reporting-poison',
  });
  await consumer.waitFor((l) => l.event === 'consumer_started', { description: 'consumer start' });

  await eventually(async () => (await queueDepth('reporting', 'reporting.dlq')) === 1, {
    description: 'poison message dead-lettered',
  });
  await consumer.stop();

  // It must not have been applied anywhere, and it must not still be pending.
  assert.equal(await clients.reporting.probeProjection.count(), 0);
  assert.equal(await queueDepth('reporting', subscriberQueueName('reporting')), 0);
});

test('queues and messages are durable: they survive with no consumer attached', async () => {
  await createProbe(clients.catalog, { label: 'probe-durable' });
  await drainOutbox('durable-relay');

  const { connect } = amqp();
  const connection = await connect(brokerUrl(context, 'reporting'));
  try {
    const channel = await connection.createChannel();
    // Passive check: fails if the queue is not durable with these arguments.
    const info = await channel.checkQueue(subscriberQueueName('reporting'));
    assert.equal(info.messageCount, 1);
    await channel.close();
  } finally {
    await connection.close();
  }
});
