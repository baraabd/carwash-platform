import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { cashCollectedEvent } from '../../src/application';
import { PrismaCustodyOutboxStore } from '../../src/outbox/prisma-outbox.store';
import { validateCustodyOutbox } from '../../src/outbox/custody-events';

const url = process.env.BILLING_TEST_DATABASE_URL;
if (!url) throw new Error('BILLING_TEST_DATABASE_URL_REQUIRED');
let prisma: PrismaService;
let store: PrismaCustodyOutboxStore;
before(() => {
  prisma = new PrismaService(url);
  store = new PrismaCustodyOutboxStore(prisma);
});
after(async () => prisma.onModuleDestroy());

/** Synthetic transport rows; financial command production is proved in broker acceptance. */
async function row(type = 'billing.cash-collected.v1') {
  const event = cashCollectedEvent(
    {
      obligationId: randomUUID(),
      bookingId: randomUUID(),
      assignmentId: randomUUID(),
      amount: { currency: 'SYP', amountMinor: '12000', scale: 2 },
      custodyStatus: 'HELD',
    },
    {
      eventId: randomUUID(),
      correlationId: randomUUID(),
      aggregateId: randomUUID(),
      revision: 1,
      actor: { kind: 'account', subjectId: randomUUID() },
      occurredAt: new Date('2000-01-01T00:00:00.000Z'),
    },
  );
  await prisma.client.outboxMessage.create({
    data: { id: event.eventId, ...event, eventType: type },
  });
  return event.eventId;
}
const lease = (workerId: string, limit = 1, maxAttempts = 10) =>
  store.leaseBatch({ workerId, limit, maxAttempts, leaseMs: 60_000 });

test('relay store: competing runtime leases are disjoint; unrelated event types remain untouched', async () => {
  const ids = await Promise.all([row(), row(), row(), row()]);
  const excluded = await row('billing.refund-changed.v1');
  const [a, b] = await Promise.all([lease('replica-a', 2), lease('replica-b', 2)]);
  assert.equal(a.length, 2);
  assert.equal(b.length, 2);
  assert.deepEqual([...a, ...b].map((r) => r.id).sort(), ids.sort());
  for (const record of [...a, ...b]) validateCustodyOutbox(record);
  for (const [records, workerId] of [
    [a, 'replica-a'],
    [b, 'replica-b'],
  ] as const) {
    for (const record of records)
      assert.equal(await store.markPublished({ id: record.id, workerId }), true);
  }
  const pending = await prisma.client.outboxMessage.findUniqueOrThrow({ where: { id: excluded } });
  assert.equal(pending.attempts, 0);
  assert.equal(pending.publishedAt, null);
  assert.equal(pending.deadAt, null);
});

test('relay store: expired lease and old worker cannot finalise another replica publication', async () => {
  const id = await row();
  assert.equal((await lease('stale'))[0]?.id, id);
  await prisma.client
    .$executeRaw`UPDATE app.outbox_message SET locked_until = now() - interval '1 second' WHERE id = ${id}::uuid`;
  assert.equal(await store.markPublished({ id, workerId: 'stale' }), false);
  assert.equal((await lease('current'))[0]?.id, id);
  assert.equal(
    await store.markFailed({ id, workerId: 'stale', error: 'FAIL', maxAttempts: 10 }),
    false,
  );
  assert.equal(await store.markPublished({ id, workerId: 'current' }), true);
});

test('relay store: failed or crashed final attempt is parked without fabricated publication', async () => {
  const failed = await row();
  assert.equal((await lease('failed', 1, 1))[0]?.id, failed);
  assert.equal(
    await store.markFailed({ id: failed, workerId: 'failed', error: 'UNROUTABLE', maxAttempts: 1 }),
    true,
  );
  const crashed = await row();
  assert.equal((await lease('crashed', 1, 1))[0]?.id, crashed);
  await prisma.client
    .$executeRaw`UPDATE app.outbox_message SET locked_until = now() - interval '1 second' WHERE id = ${crashed}::uuid`;
  const next = await row();
  assert.equal((await lease('recovery', 1, 1))[0]?.id, next);
  assert.equal(await store.markPublished({ id: next, workerId: 'recovery' }), true);
  for (const id of [failed, crashed]) {
    const record = await prisma.client.outboxMessage.findUniqueOrThrow({ where: { id } });
    assert.equal(record.publishedAt, null);
    assert.ok(record.deadAt);
    assert.equal(record.lockedBy, null);
  }
});
