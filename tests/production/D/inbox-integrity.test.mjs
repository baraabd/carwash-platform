/**
 * INT-D-01 on a real PostgreSQL: inbox deduplication versus unrelated conflicts.
 *
 * Runs the compiled service-local PrismaInboxStore of BOTH subscribers against
 * their own databases with their own runtime identities. Races are forced, not
 * hoped for: delivery B starts only after delivery A has inserted its inbox row
 * and while A's transaction is still open, so B genuinely reads "absent" and
 * then collides on the primary key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, context, serviceClient } from '../../integration/_support.mjs';

const SERVICES = [
  { service: 'communications', effectTable: 'probeNotification' },
  { service: 'reporting', effectTable: 'probeProjection' },
];

function loadStore(service) {
  const require = createRequire(path.join(ROOT, 'services', service, 'package.json'));
  return require(path.join(ROOT, 'services', service, 'dist', 'inbox', 'prisma-inbox.store.js'));
}

function record(eventId, payloadHash = 'a'.repeat(64)) {
  return {
    eventId,
    eventType: 'foundation.probe.created.v1',
    payloadHash,
    correlationId: randomUUID(),
  };
}

/** A latch the first transaction opens once its inbox row exists but is uncommitted. */
function latch() {
  let open;
  const opened = new Promise((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

for (const { service, effectTable } of SERVICES) {
  test(`${service}: real PostgreSQL inbox integrity (INT-D-01)`, async (t) => {
    assert.ok(context.runId, 'an acceptance context is required');
    const client = serviceClient(service);
    const { PrismaInboxStore, InboxEffectConflictError } = loadStore(service);
    const store = new PrismaInboxStore({ client });
    const effects = (probeId) =>
      client[effectTable].findUnique({ where: { probeId }, select: { applyCount: true } });
    const inboxRow = (eventId) => client.inboxMessage.findUnique({ where: { eventId } });

    /** Effect that holds its transaction open after the inbox insert. */
    const slowEffect = (probeId, gate) => async (tx) => {
      await tx[effectTable].upsert({
        where: { probeId },
        create: { probeId, label: 'probe-int-d-01', applyCount: 1 },
        update: { applyCount: { increment: 1 } },
      });
      gate?.open();
      await tx.$executeRawUnsafe('SELECT pg_sleep(0.6)');
    };
    const effect = (probeId) => async (tx) => {
      await tx[effectTable].upsert({
        where: { probeId },
        create: { probeId, label: 'probe-int-d-01', applyCount: 1 },
        update: { applyCount: { increment: 1 } },
      });
    };

    t.after(() => client.$disconnect());

    await t.test(
      'sequential redelivery of identical bytes is a duplicate with one effect',
      async () => {
        const eventId = randomUUID();
        const probeId = randomUUID();
        assert.equal(await store.applyOnce(record(eventId), effect(probeId)), 'APPLIED');
        assert.equal(await store.applyOnce(record(eventId), effect(probeId)), 'DUPLICATE');
        assert.equal((await effects(probeId)).applyCount, 1);
      },
    );

    await t.test('sequential same id with changed bytes is an integrity conflict', async () => {
      const eventId = randomUUID();
      const probeId = randomUUID();
      assert.equal(await store.applyOnce(record(eventId), effect(probeId)), 'APPLIED');
      assert.equal(
        await store.applyOnce(record(eventId, 'b'.repeat(64)), effect(probeId)),
        'CONFLICT',
      );
      assert.equal((await effects(probeId)).applyCount, 1);
    });

    await t.test(
      'concurrent same id and same bytes: one effect, the loser is a proven duplicate',
      async () => {
        const eventId = randomUUID();
        const probeId = randomUUID();
        const gate = latch();
        const first = store.applyOnce(record(eventId), slowEffect(probeId, gate));
        await gate.opened;
        const second = store.applyOnce(record(eventId), effect(probeId));
        const outcomes = (await Promise.all([first, second])).sort();
        assert.deepEqual(outcomes, ['APPLIED', 'DUPLICATE']);
        assert.equal((await effects(probeId)).applyCount, 1, 'the losing delivery added no effect');
      },
    );

    await t.test(
      'concurrent same id and different bytes: one effect and one conflict',
      async () => {
        const eventId = randomUUID();
        const probeId = randomUUID();
        const gate = latch();
        const first = store.applyOnce(record(eventId), slowEffect(probeId, gate));
        await gate.opened;
        const second = store.applyOnce(record(eventId, 'c'.repeat(64)), effect(probeId));
        const outcomes = (await Promise.all([first, second])).sort();
        assert.deepEqual(outcomes, ['APPLIED', 'CONFLICT']);
        assert.equal((await effects(probeId)).applyCount, 1);
      },
    );

    await t.test(
      'an unrelated unique violation in the effect is an error, never a duplicate',
      async () => {
        // A business row that already exists: creating it again violates the
        // effect table's own primary key, which has nothing to do with the inbox.
        const takenProbe = randomUUID();
        await client[effectTable].create({
          data: { probeId: takenProbe, label: 'probe-taken', applyCount: 1 },
        });
        const eventId = randomUUID();
        await assert.rejects(
          store.applyOnce(record(eventId), async (tx) => {
            await tx[effectTable].create({
              data: { probeId: takenProbe, label: 'probe-taken', applyCount: 1 },
            });
          }),
          (error) => {
            assert.ok(error instanceof InboxEffectConflictError, `got ${error?.name}`);
            assert.equal(error.eventId, eventId);
            return true;
          },
        );
        assert.equal(await inboxRow(eventId), null, 'the inbox row rolled back with the effect');
        assert.equal((await effects(takenProbe)).applyCount, 1, 'the existing row is untouched');

        // The delivery is still pending work: a later attempt whose effect can
        // succeed is applied, which a falsely ACKed "duplicate" would have lost.
        assert.equal(await store.applyOnce(record(eventId), effect(randomUUID())), 'APPLIED');
      },
    );

    await t.test('a non-unique failure in the effect rolls back the inbox row', async () => {
      const eventId = randomUUID();
      await assert.rejects(
        store.applyOnce(record(eventId), async () => {
          throw new Error('SIMULATED_EFFECT_FAILURE');
        }),
        /SIMULATED_EFFECT_FAILURE/,
      );
      assert.equal(await inboxRow(eventId), null);
    });
  });
}
