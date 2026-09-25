import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  appDsn,
  consumerArgs,
  consumerEnv,
  context,
  createProbe,
  delay,
  eventually,
  messaging,
  queueDepth,
  relayArgs,
  relayEnv,
  resetSlice,
  serviceClient,
  spawnWorker,
} from './_support.mjs';
import {
  startService,
  stopService,
  waitForRabbitReady,
} from '../../scripts/acceptance/lib/infra.mjs';

/**
 * Outbox/Inbox failure behaviour against real PostgreSQL and real RabbitMQ.
 *
 * Every case here is a situation where a naive implementation silently loses or
 * silently duplicates data, and none of them can be demonstrated with a mock:
 * they are about what the database and the broker actually do when a process
 * dies, a connection drops or a message is delivered twice.
 *
 * What is proved: at-least-once delivery with effectively-once LOCAL EFFECTS,
 * because the inbox row and the effect share one transaction. What is NOT
 * proved, and is not claimed anywhere: end-to-end exactly-once delivery across
 * independent systems.
 */

const { subscriberQueueName } = messaging();

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

async function outboxRow(eventId) {
  return clients.catalog.outboxMessage.findUnique({ where: { eventId } });
}

async function runRelayOnce(workerId, extra = []) {
  const relay = spawnWorker(relayArgs(['--once', '--worker-id', workerId, ...extra]), relayEnv(), {
    label: `relay:${workerId}`,
  });
  await relay.exited;
  return relay;
}

/* ------------------------- producer transactionality ------------------------- */

test('the local change and the outbox row commit together', async () => {
  const created = await createProbe(clients.catalog, { label: 'probe-atomic' });
  const probe = await clients.catalog.foundationProbe.findUnique({
    where: { id: created.probeId },
  });
  const outbox = await outboxRow(created.eventId);
  assert.ok(probe, 'the local row is missing');
  assert.ok(outbox, 'the outbox row is missing');
  assert.equal(outbox.publishedAt, null, 'nothing is published before the relay confirms it');
});

test('the local change and the outbox row roll back together', async () => {
  // The failure this prevents: a committed business change whose event was lost,
  // or a published event for a change that never happened.
  const before = await clients.catalog.foundationProbe.count();
  await assert.rejects(
    () => createProbe(clients.catalog, { label: 'probe-rollback', failAfterWrites: true }),
    /SIMULATED_PRODUCER_FAILURE/,
  );
  assert.equal(await clients.catalog.foundationProbe.count(), before);
  assert.equal(await clients.catalog.outboxMessage.count(), 0);
});

/* --------------------------- Case A: broker outage --------------------------- */

test('Case A: an event committed while the broker is down is published once it returns', async () => {
  await stopService(context, 'rabbitmq', 10);
  let created;
  try {
    // The producer does not touch the broker at all, so this must still succeed.
    created = await createProbe(clients.catalog, { label: 'probe-outage' });
    const pending = await outboxRow(created.eventId);
    assert.equal(pending.publishedAt, null);

    const relay = spawnWorker(
      relayArgs(['--worker-id', 'outage-relay', '--interval-ms', '200']),
      relayEnv(),
      { label: 'relay:outage' },
    );
    // It must report the outage rather than marking anything published.
    await relay.waitFor((l) => l.event === 'relay_broker_unavailable', {
      description: 'broker unavailable report',
    });
    assert.equal((await outboxRow(created.eventId)).publishedAt, null);

    await startService(context, 'rabbitmq');
    await waitForRabbitReady(context);

    // The same worker reconnects and publishes the still-pending row.
    await eventually(async () => (await outboxRow(created.eventId)).publishedAt !== null, {
      description: 'pending event published after the broker returned',
      timeoutMs: 90_000,
    });
    await relay.stop();
  } finally {
    await startService(context, 'rabbitmq').catch(() => {});
    await waitForRabbitReady(context).catch(() => {});
  }

  // And it is genuinely deliverable, not merely marked.
  const consumer = spawnWorker(
    consumerArgs('reporting', ['--stop-after', '1']),
    consumerEnv('reporting'),
    { label: 'consumer:outage' },
  );
  await consumer.exited;
  const projection = await clients.reporting.probeProjection.findUnique({
    where: { probeId: created.probeId },
  });
  assert.equal(projection?.applyCount, 1);
});

/* ------------------------- Case B: duplicate delivery ------------------------- */

test('Case B: the same event delivered twice applies its effect once', async () => {
  const created = await createProbe(clients.catalog, { label: 'probe-duplicate' });

  await runRelayOnce('dup-relay-1');
  assert.notEqual((await outboxRow(created.eventId)).publishedAt, null);

  // Exactly the real at-least-once case: the relay published and then died
  // before it could record that fact, so the row is retried and published again.
  await clients.catalog.$executeRawUnsafe(
    'UPDATE app.outbox_message SET published_at = NULL, locked_by = NULL, locked_until = NULL WHERE event_id = $1::uuid',
    created.eventId,
  );
  await runRelayOnce('dup-relay-2');

  assert.equal(
    await queueDepth('reporting', subscriberQueueName('reporting')),
    2,
    'the broker really is holding two copies',
  );

  const consumer = spawnWorker(
    consumerArgs('reporting', ['--stop-after', '2']),
    consumerEnv('reporting'),
    { label: 'consumer:duplicate' },
  );
  await consumer.exited;

  const outcomes = consumer.lines
    .filter((l) => l.event === 'consumer_committed')
    .map((l) => l.outcome);
  assert.deepEqual(outcomes, ['APPLIED', 'DUPLICATE'], `outcomes were ${JSON.stringify(outcomes)}`);

  const projection = await clients.reporting.probeProjection.findUnique({
    where: { probeId: created.probeId },
  });
  assert.equal(projection.applyCount, 1, 'the side effect was applied more than once');
  assert.equal(await clients.reporting.inboxMessage.count(), 1);
  assert.equal(await queueDepth('reporting', subscriberQueueName('reporting')), 0);
});

/* ------------------ Case C: crash after commit, before ACK ------------------ */

test('Case C: a crash between commit and ACK redelivers without duplicating the effect', async () => {
  const created = await createProbe(clients.catalog, { label: 'probe-crash' });
  await runRelayOnce('crash-relay');

  const crashing = spawnWorker(
    consumerArgs('reporting', ['--crash-before-ack-after', '1']),
    consumerEnv('reporting'),
    { label: 'consumer:crashing' },
  );
  await crashing.waitFor((l) => l.event === 'consumer_crash_before_ack', {
    description: 'crash between commit and ack',
  });
  const exit = await crashing.exited;
  assert.equal(exit.code, 9, 'the worker must have died abruptly, not shut down cleanly');

  // The effect is committed, but the broker was never told.
  const afterCrash = await clients.reporting.probeProjection.findUnique({
    where: { probeId: created.probeId },
  });
  assert.equal(afterCrash.applyCount, 1);

  // The unacked message returns to the queue when the connection drops.
  await eventually(
    async () => (await queueDepth('reporting', subscriberQueueName('reporting'))) === 1,
    { description: 'unacked message requeued' },
  );

  const recovering = spawnWorker(
    consumerArgs('reporting', ['--stop-after', '1']),
    consumerEnv('reporting'),
    { label: 'consumer:recovering' },
  );
  await recovering.exited;

  const committed = recovering.lines.find((l) => l.event === 'consumer_committed');
  assert.equal(
    committed.outcome,
    'DUPLICATE',
    'the redelivery should be recognised as a duplicate',
  );
  const final = await clients.reporting.probeProjection.findUnique({
    where: { probeId: created.probeId },
  });
  assert.equal(final.applyCount, 1, 'redelivery duplicated the local effect');
  assert.equal(await queueDepth('reporting', subscriberQueueName('reporting')), 0);
});

/* --------------------- Case D: relay restart / stale lease --------------------- */

test('Case D: a row leased by a worker that died is republished by a new worker', async () => {
  const created = await createProbe(clients.catalog, { label: 'probe-lease' });

  // Model a worker that took the row and then died holding the lease.
  await clients.catalog.$executeRawUnsafe(
    `UPDATE app.outbox_message
        SET locked_by = 'dead-worker', locked_until = now() + interval '2 seconds', attempts = 1
      WHERE event_id = $1::uuid`,
    created.eventId,
  );

  const relay = spawnWorker(
    relayArgs(['--worker-id', 'recovery-relay', '--interval-ms', '200']),
    relayEnv(),
    { label: 'relay:recovery' },
  );
  await relay.waitFor((l) => l.event === 'relay_connected', { description: 'relay connected' });

  // Nothing may be taken while the lease is still valid.
  await delay(500);
  assert.equal((await outboxRow(created.eventId)).lockedBy, 'dead-worker');

  await eventually(async () => (await outboxRow(created.eventId)).publishedAt !== null, {
    description: 'expired lease reclaimed and published',
  });
  await relay.stop();

  const row = await outboxRow(created.eventId);
  assert.equal(row.lockedBy, null, 'the lease is released once the row is published');
  assert.equal(await queueDepth('reporting', subscriberQueueName('reporting')), 1);
});

test('Case D: a stale worker cannot overwrite the state of the worker that took over', async () => {
  // The lost-update bug the lease exists to prevent: a worker that resumes after
  // its lease expired must not be able to finalise a row it no longer owns.
  const catalogRequire = (await import('node:module')).createRequire(
    `${context.root}/services/catalog/package.json`,
  );
  const { PrismaOutboxStore } = catalogRequire(
    `${context.root}/services/catalog/dist/outbox/prisma-outbox.store.js`,
  );
  const store = new PrismaOutboxStore({ client: clients.catalog });

  const created = await createProbe(clients.catalog, { label: 'probe-stale' });

  const leasedByFirst = await store.leaseBatch({
    workerId: 'worker-one',
    leaseMs: 50,
    limit: 10,
    maxAttempts: 5,
  });
  assert.equal(leasedByFirst.length, 1);

  await delay(120); // the lease expires

  const leasedBySecond = await store.leaseBatch({
    workerId: 'worker-two',
    leaseMs: 30_000,
    limit: 10,
    maxAttempts: 5,
  });
  assert.equal(leasedBySecond.length, 1, 'the expired lease must be reclaimable');

  const staleWrite = await store.markPublished({ id: leasedByFirst[0].id, workerId: 'worker-one' });
  assert.equal(staleWrite, false, 'the stale worker must not be able to mark the row published');

  const staleFailure = await store.markFailed({
    id: leasedByFirst[0].id,
    workerId: 'worker-one',
    error: 'STALE',
    maxAttempts: 5,
  });
  assert.equal(staleFailure, false, 'the stale worker must not be able to fail the row either');

  const ownerWrite = await store.markPublished({
    id: leasedBySecond[0].id,
    workerId: 'worker-two',
  });
  assert.equal(ownerWrite, true, 'the current owner must still be able to finalise the row');

  const row = await outboxRow(created.eventId);
  assert.notEqual(row.publishedAt, null);
  assert.equal(row.lastError, null, 'the stale failure must not have been recorded');
});

test('competing relay workers publish each row exactly once', async () => {
  const total = 8;
  for (let i = 0; i < total; i += 1) {
    await createProbe(clients.catalog, { label: `probe-compete-${i}` });
  }

  const relays = ['relay-a', 'relay-b'].map((id) =>
    spawnWorker(
      relayArgs(['--worker-id', id, '--interval-ms', '50', '--batch-size', '3']),
      relayEnv(),
      {
        label: `relay:${id}`,
      },
    ),
  );
  await Promise.all(
    relays.map((r) =>
      r.waitFor((l) => l.event === 'relay_connected', { description: 'relay connected' }),
    ),
  );
  await eventually(
    async () => (await clients.catalog.outboxMessage.count({ where: { publishedAt: null } })) === 0,
    { description: 'all rows published' },
  );
  await Promise.all(relays.map((r) => r.stop()));

  // Exactly `total` messages in each subscriber queue: no row was published twice.
  assert.equal(await queueDepth('reporting', subscriberQueueName('reporting')), total);
  assert.equal(await queueDepth('communications', subscriberQueueName('communications')), total);

  const published = relays
    .flatMap((r) => r.lines.filter((l) => l.event === 'relay_pass'))
    .reduce((sum, l) => sum + l.published, 0);
  assert.equal(published, total, 'the workers together published every row exactly once');

  const rows = await clients.catalog.outboxMessage.findMany();
  for (const row of rows) assert.equal(row.attempts, 1, 'a row was leased more than once');
});

/* ------------------------ Case E: unroutable publication ------------------------ */

test('Case E: an unroutable publication is never marked as published', async () => {
  // A broker ack for a returned message is not delivery. Treating it as success
  // is the classic silent-loss bug.
  const eventId = randomUUID();
  await clients.catalog.outboxMessage.create({
    data: {
      id: randomUUID(),
      eventId,
      eventType: 'foundation.probe.created.v1',
      exchange: 'catalog.events',
      routingKey: 'foundation.probe.no.binding.exists',
      payload: JSON.stringify({ unroutable: true }),
      correlationId: randomUUID(),
    },
  });

  const relay = await runRelayOnce('unroutable-relay');
  const pass = relay.lines.find((l) => l.event === 'relay_pass');
  assert.equal(pass.published, 0);
  assert.equal(pass.failed, 1);

  const row = await outboxRow(eventId);
  assert.equal(row.publishedAt, null, 'an unroutable message must stay pending');
  assert.equal(row.lastError, 'UNROUTABLE');
  assert.equal(row.attempts, 1);
});

/* --------------------- Case F: bounded retries, terminal state --------------------- */

test('Case F: a permanently unroutable row is parked as dead instead of retried forever', async () => {
  const eventId = randomUUID();
  await clients.catalog.outboxMessage.create({
    data: {
      id: randomUUID(),
      eventId,
      eventType: 'foundation.probe.created.v1',
      exchange: 'catalog.events',
      routingKey: 'foundation.probe.permanently.unroutable',
      payload: JSON.stringify({ unroutable: true }),
      correlationId: randomUUID(),
    },
  });

  const relay = spawnWorker(
    relayArgs(['--worker-id', 'dead-letter-relay', '--interval-ms', '50', '--max-attempts', '3']),
    relayEnv(),
    { label: 'relay:dead-letter' },
  );
  await relay.waitFor((l) => l.event === 'relay_connected', { description: 'relay connected' });

  await eventually(async () => (await outboxRow(eventId)).deadAt !== null, {
    description: 'row parked as dead after its attempts were exhausted',
  });
  await relay.stop();

  const row = await outboxRow(eventId);
  assert.equal(row.publishedAt, null);
  assert.equal(
    row.attempts,
    3,
    `attempts should stop at the configured maximum, got ${row.attempts}`,
  );
  assert.equal(row.lastError, 'UNROUTABLE');

  // And a dead row is not picked up again.
  const after = await runRelayOnce('post-dead-relay', ['--max-attempts', '3']);
  const pass = after.lines.find((l) => l.event === 'relay_pass');
  assert.equal(pass.leased, 0, 'a dead row must not be leased again');
});

/* ------------------------------ contract hygiene ------------------------------ */

test('the event payload carries no personal data and a closed label alphabet', async () => {
  const created = await createProbe(clients.catalog, { label: 'probe-contract' });
  const row = await outboxRow(created.eventId);
  const payload = JSON.parse(row.payload);
  assert.deepEqual(Object.keys(payload.data).sort(), ['label', 'probeId']);
  assert.match(payload.data.label, /^probe-[a-z0-9-]{1,32}$/);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.eventType, 'foundation.probe.created.v1');
  // Routing keys and queue names are structural, never derived from user data.
  assert.equal(row.routingKey, 'foundation.probe.created.v1');
});

test('an event whose label could carry free text is refused by the contract', async () => {
  await assert.rejects(
    () => createProbe(clients.catalog, { label: 'customer Jane Doe +1 555 0100' }),
    /INVALID_LABEL/,
  );
  assert.equal(await clients.catalog.outboxMessage.count(), 0, 'nothing may reach the outbox');
});

test('the application connection string never reaches the worker output', async () => {
  const created = await createProbe(clients.catalog, { label: 'probe-redaction' });
  const relay = await runRelayOnce('redaction-relay');
  const password = context.credentials.catalog_db;
  const combined = `${relay.lines.map((l) => JSON.stringify(l)).join('\n')}\n${relay.stderr}`;
  assert.ok(!combined.includes(password), 'the database password appeared in worker output');
  assert.ok(!combined.includes(context.credentials.catalog_broker), 'the broker password appeared');
  assert.ok(created.eventId.length > 0);
  assert.ok(!combined.includes(appDsn(context, 'catalog')));
});
