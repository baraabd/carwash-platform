/**
 * Reporting projection primitives on a real PostgreSQL and a real RabbitMQ.
 *
 * Part A drives the compiled application/infrastructure modules against the
 * reporting database with its runtime identity: ledger idempotency, integrity
 * conflicts, concurrent bucket folding, monotonic snapshots, the append-only
 * ledger grant and reconciliation drift.
 *
 * Part B runs the real reporting consumer process and publishes through the
 * real exchange as Catalog (the only accepted producer stream today, the
 * non-financial foundation probe): redelivery, reordering and an integrity
 * conflict that must reach the DLQ instead of being ACKed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  ROOT,
  amqp,
  brokerUrl,
  consumerArgs,
  consumerEnv,
  context,
  ensureSubscriberQueues,
  eventually,
  migrationDsn,
  purgeQueues,
  queueDepth,
  serviceClient,
  spawnWorker,
  sql,
  appDsn,
} from '../../integration/_support.mjs';

const require = createRequire(path.join(ROOT, 'services', 'reporting', 'package.json'));
const dist = (file) => require(path.join(ROOT, 'services', 'reporting', 'dist', file));
const domain = dist('domain/projection.js');
const { ProjectionIngestor, ProjectionQueries } = dist('application/projection.service.js');
const { FOUNDATION_EVENTS_PROJECTION, FOUNDATION_PROBE_METRIC, FOUNDATION_PROBE_SNAPSHOT } = dist(
  'application/foundation-probe.projection.js',
);
const store = dist('infrastructure/persistence/prisma-projection.store.js');

const app = serviceClient('reporting');
const owner = serviceClient('reporting', migrationDsn(context, 'reporting'));
const ingestor = new ProjectionIngestor(store.sha256Hex);
const queries = new ProjectionQueries(new store.PrismaProjectionReader(app));

test.after(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

function source(eventId = randomUUID(), occurredAt = new Date('2026-10-07T10:00:00.000Z')) {
  return domain.sourceEventRef({
    service: 'catalog',
    eventId,
    eventType: 'foundation.probe.created.v1',
    occurredAt,
  });
}

function contribution(projection, src, delta = 1n, metricKey = 'm.count') {
  return domain.metricContribution({ projection, metricKey, delta, source: src });
}

function snapshot(projection, aggregateId, version, state, src = source()) {
  return domain.snapshotUpdate({
    projection,
    aggregateType: 'probe',
    aggregateId,
    version,
    state,
    source: src,
  });
}

/** One unit of work in its own transaction, as one inbox delivery would be. */
function inTx(fn) {
  return app.$transaction((tx) => fn(new store.PrismaProjectionWriter(tx)));
}

/** Broker redelivery modeled for direct calls: a unique race is retried, nothing else. */
async function withRedelivery(fn, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !['P2002', '23505'].includes(error?.code)) throw error;
    }
  }
}

function uniqueProjection() {
  return `t-${randomUUID().slice(0, 8)}`;
}

async function bucket(projection, metricKey = 'm.count', day = '2026-10-07') {
  return app.metricBucket.findUnique({
    where: {
      projection_metricKey_bucketDay: {
        projection,
        metricKey,
        bucketDay: new Date(`${day}T00:00:00.000Z`),
      },
    },
  });
}

/* --------------------------------- Part A --------------------------------- */

test('A1: a source event contributes once; a replay is recognised, not re-counted', async () => {
  const projection = uniqueProjection();
  const src = source();
  assert.equal(await inTx((w) => ingestor.contribute(w, contribution(projection, src))), 'APPLIED');
  assert.equal(
    await inTx((w) => ingestor.contribute(w, contribution(projection, src))),
    'ALREADY_CONTRIBUTED',
  );
  const row = await bucket(projection);
  assert.equal(row.value, 1n);
  assert.equal(row.contributionCount, 1);
});

test('A2: the same source event with a different contribution is an integrity conflict', async () => {
  const projection = uniqueProjection();
  const src = source();
  await inTx((w) => ingestor.contribute(w, contribution(projection, src, 3n)));
  await assert.rejects(
    inTx((w) => ingestor.contribute(w, contribution(projection, src, 4n))),
    (error) =>
      error instanceof store.ProjectionIntegrityError &&
      error.code === 'CONTRIBUTION_FINGERPRINT_CONFLICT',
  );
  assert.equal((await bucket(projection)).value, 3n, 'the conflicting delta was not folded');
});

test('A3: concurrent distinct contributions to one bucket all fold, exactly', async () => {
  const projection = uniqueProjection();
  const deltas = Array.from({ length: 24 }, (_, i) => BigInt(i + 1) * 40_000_003n);
  const outcomes = await Promise.all(
    deltas.map((delta) =>
      // No retry wrapper: the bucket upsert is a native ON CONFLICT DO UPDATE, so
      // concurrent contributions to one hot bucket must never raise a unique race.
      inTx((w) => ingestor.contribute(w, contribution(projection, source(), delta))),
    ),
  );
  assert.ok(outcomes.every((outcome) => outcome === 'APPLIED'));
  const row = await bucket(projection);
  assert.equal(
    row.value,
    deltas.reduce((a, b) => a + b, 0n),
    'exact integer sum, no float rounding',
  );
  assert.equal(row.contributionCount, deltas.length);
  assert.deepEqual(await queries.drift(projection), []);
});

test('A4: concurrent replays of one source event fold once', async () => {
  const projection = uniqueProjection();
  const src = source();
  const outcomes = await Promise.all(
    Array.from({ length: 6 }, () =>
      withRedelivery(() => inTx((w) => ingestor.contribute(w, contribution(projection, src)))),
    ),
  );
  assert.equal(outcomes.filter((o) => o === 'APPLIED').length, 1);
  assert.equal(outcomes.filter((o) => o === 'ALREADY_CONTRIBUTED').length, 5);
  assert.equal((await bucket(projection)).value, 1n);
});

test('A5: snapshots never regress and a version cannot carry two contents', async () => {
  const projection = uniqueProjection();
  const id = randomUUID();
  const v2 = snapshot(projection, id, 2, { label: 'two' });
  assert.equal(await inTx((w) => ingestor.snapshot(w, v2)), 'APPLIED');
  assert.equal(
    await inTx((w) => ingestor.snapshot(w, snapshot(projection, id, 1, { label: 'one' }))),
    'STALE',
  );
  assert.equal(await inTx((w) => ingestor.snapshot(w, v2)), 'SAME');
  await assert.rejects(
    inTx((w) => ingestor.snapshot(w, snapshot(projection, id, 2, { label: 'other' }))),
    (error) =>
      error instanceof store.ProjectionIntegrityError && error.code === 'SNAPSHOT_VERSION_CONFLICT',
  );
  assert.equal(
    await inTx((w) => ingestor.snapshot(w, snapshot(projection, id, 5, { label: 'five' }))),
    'APPLIED',
  );
  const row = await app.aggregateSnapshot.findUnique({
    where: {
      projection_aggregateType_aggregateId: { projection, aggregateType: 'probe', aggregateId: id },
    },
  });
  assert.equal(row.version, 5);
  assert.deepEqual(row.state, { label: 'five' });
});

test('A6: concurrent out-of-order versions converge on the highest version', async () => {
  const projection = uniqueProjection();
  const id = randomUUID();
  const versions = [7, 3, 10, 1, 9, 4, 2, 8, 6, 5];
  await Promise.all(
    versions.map((version) =>
      withRedelivery(() =>
        inTx((w) => ingestor.snapshot(w, snapshot(projection, id, version, { v: version }))),
      ),
    ),
  );
  const row = await app.aggregateSnapshot.findUnique({
    where: {
      projection_aggregateType_aggregateId: { projection, aggregateType: 'probe', aggregateId: id },
    },
  });
  assert.equal(row.version, 10);
  assert.deepEqual(row.state, { v: 10 });
});

test('A7: the contribution ledger is append-only, independent of role grants', async () => {
  const projection = uniqueProjection();
  // INSERT, the only intended write, still works.
  await inTx((w) => ingestor.contribute(w, contribution(projection, source())));
  const where = `WHERE projection = '${projection}'`;
  const rewrites = [
    `UPDATE app.projection_contribution SET delta = 99 ${where}`,
    `DELETE FROM app.projection_contribution ${where}`,
  ];
  // The trigger rejects rewrites even though provisioning grants the runtime
  // role generic DML, and even for the owning migration identity.
  for (const url of [appDsn(context, 'reporting'), migrationDsn(context, 'reporting')]) {
    for (const statement of rewrites) {
      const result = await sql(url, statement);
      assert.equal(result.ok, false, `${statement} must be refused`);
      assert.equal(result.code, 'P0001', `refused by the ledger trigger: ${result.message}`);
      assert.match(result.message ?? '', /REPORTING_LEDGER_IMMUTABLE/);
    }
  }
  // TRUNCATE skips row triggers, so it must stay denied by privilege.
  const truncate = await sql(appDsn(context, 'reporting'), 'TRUNCATE app.projection_contribution');
  assert.equal(truncate.ok, false, 'TRUNCATE must be refused');
  assert.equal(truncate.code, '42501', `refused for lack of privilege: ${truncate.message}`);
  // Nobody but the owner may invoke the trigger function directly.
  const execute = await sql(
    appDsn(context, 'reporting'),
    "SELECT has_function_privilege('cw_reporting_app', 'app.reporting_reject_mutation()', 'EXECUTE') AS app_exec, has_function_privilege('public', 'app.reporting_reject_mutation()', 'EXECUTE') AS public_exec",
  );
  assert.equal(execute.ok, true, execute.message ?? '');
  assert.deepEqual(execute.rows[0], { app_exec: false, public_exec: false });
  assert.equal(await app.projectionContribution.count({ where: { projection } }), 1);
});

test('A8: reconciliation reports a bucket that disagrees with its ledger', async () => {
  const projection = uniqueProjection();
  await inTx((w) => ingestor.contribute(w, contribution(projection, source(), 5n)));
  await inTx((w) => ingestor.contribute(w, contribution(projection, source(), 7n)));
  assert.deepEqual(await queries.drift(projection), []);
  // Corruption introduced out of band by the owning (migration) identity.
  await owner.metricBucket.updateMany({ where: { projection }, data: { value: 13n } });
  const drift = await queries.drift(projection);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].bucketValue, 13n);
  assert.equal(drift[0].ledgerValue, 12n);
  assert.equal(drift[0].ledgerCount, 2);
});

test('A9: the series read returns ordered exact buckets inside the requested range', async () => {
  const projection = uniqueProjection();
  for (const [day, delta] of [
    ['2026-10-05', 2n],
    ['2026-10-06', 3n],
    ['2026-10-09', 4n],
  ])
    await inTx((w) =>
      ingestor.contribute(
        w,
        contribution(projection, source(randomUUID(), new Date(`${day}T12:00:00.000Z`)), delta),
      ),
    );
  const series = await queries.metricSeries({
    projection,
    metricKey: 'm.count',
    fromDay: '2026-10-05',
    toDay: '2026-10-08',
  });
  assert.deepEqual(
    series.map((p) => [p.bucketDay, p.value]),
    [
      ['2026-10-05', 2n],
      ['2026-10-06', 3n],
    ],
  );
});

/* --------------------------------- Part B --------------------------------- */

const EXCHANGE = 'catalog.events';
const ROUTING_KEY = 'foundation.probe.created.v1';

function probeEvent({ probeId, version, eventId = randomUUID(), label = 'probe-d1' }) {
  return {
    eventId,
    eventType: 'foundation.probe.created.v1',
    schemaVersion: 1,
    producer: 'catalog',
    occurredAt: '2026-10-07T08:00:00.000Z',
    correlationId: randomUUID(),
    aggregateVersion: version,
    data: { probeId, label },
  };
}

/** Publish exact bytes through the real exchange as the Catalog producer identity. */
async function publish(bodies) {
  const { connect } = amqp();
  const connection = await connect(brokerUrl(context, 'catalog'));
  connection.on('error', () => {});
  try {
    const channel = await connection.createConfirmChannel();
    for (const body of bodies)
      await new Promise((resolve, reject) => {
        channel.publish(
          EXCHANGE,
          ROUTING_KEY,
          Buffer.from(body, 'utf8'),
          { persistent: true, mandatory: true, contentType: 'application/json' },
          (error) => (error ? reject(error) : resolve()),
        );
      });
    await channel.close();
  } finally {
    await connection.close();
  }
}

async function foundationBucketValue() {
  const row = await bucket(FOUNDATION_EVENTS_PROJECTION, FOUNDATION_PROBE_METRIC);
  return row?.value ?? 0n;
}

async function probeSnapshot(probeId) {
  return app.aggregateSnapshot.findUnique({
    where: {
      projection_aggregateType_aggregateId: {
        projection: FOUNDATION_PROBE_SNAPSHOT,
        aggregateType: 'probe',
        aggregateId: probeId,
      },
    },
  });
}

test('B1: real consumer — redelivery, reordering and a DLQ-bound integrity conflict', async (t) => {
  await ensureSubscriberQueues();
  await purgeQueues();
  const before = await foundationBucketValue();
  const dlqBefore = await queueDepth('reporting', 'reporting.dlq');

  const consumer = spawnWorker(consumerArgs('reporting'), consumerEnv('reporting'), {
    label: 'reporting-projection',
  });
  t.after(() => consumer.stop());
  await consumer.waitFor((l) => l.event === 'consumer_started', { description: 'consumer start' });
  const committed = (eventId) =>
    consumer.lines.filter((l) => l.event === 'consumer_committed' && l.eventId === eventId);

  // 1. One event delivered three times with identical bytes.
  const probe = randomUUID();
  const first = JSON.stringify(probeEvent({ probeId: probe, version: 1 }));
  const firstId = JSON.parse(first).eventId;
  await publish([first, first, first]);
  await eventually(() => committed(firstId).length === 3, { description: 'three deliveries' });
  assert.deepEqual(
    committed(firstId)
      .map((l) => l.outcome)
      .sort(),
    ['APPLIED', 'DUPLICATE', 'DUPLICATE'],
  );

  // 2. A newer version, then an older one that arrives late.
  const newer = probeEvent({ probeId: probe, version: 3, label: 'probe-d1-v3' });
  const older = probeEvent({ probeId: probe, version: 2, label: 'probe-d1-v2' });
  await publish([JSON.stringify(newer), JSON.stringify(older)]);
  await eventually(() => committed(older.eventId).length === 1, { description: 'late event' });

  const snap = await probeSnapshot(probe);
  assert.equal(snap.version, 3, 'the late older version did not regress the snapshot');
  assert.deepEqual(snap.state, { label: 'probe-d1-v3' });
  assert.equal(
    await foundationBucketValue(),
    before + 3n,
    'three distinct source events, counted once each',
  );
  assert.equal(
    await app.projectionContribution.count({
      where: { projection: FOUNDATION_EVENTS_PROJECTION, sourceEventId: firstId },
    }),
    1,
  );

  // 3. A second fact claiming an already-held version: integrity conflict.
  //    It must be NACKed until the broker's delivery limit dead-letters it.
  const contested = randomUUID();
  const original = probeEvent({ probeId: contested, version: 1, label: 'probe-original' });
  await publish([JSON.stringify(original)]);
  await eventually(() => committed(original.eventId).length === 1, { description: 'original' });
  const rival = probeEvent({ probeId: contested, version: 1, label: 'probe-rival' });
  await publish([JSON.stringify(rival)]);
  await eventually(async () => (await queueDepth('reporting', 'reporting.dlq')) === dlqBefore + 1, {
    description: 'rival dead-lettered',
    timeoutMs: 60_000,
  });
  assert.equal(committed(rival.eventId).length, 0, 'the conflicting event was never ACKed');
  assert.equal(
    await app.inboxMessage.findUnique({ where: { eventId: rival.eventId } }),
    null,
    'no inbox row claims an effect that never happened',
  );
  assert.deepEqual((await probeSnapshot(contested)).state, { label: 'probe-original' });
  assert.equal(await foundationBucketValue(), before + 4n, 'the rival contributed nothing');
  assert.deepEqual(await queries.drift(FOUNDATION_EVENTS_PROJECTION), []);
});
