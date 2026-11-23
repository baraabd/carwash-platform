/**
 * Shared regression for the lane-C transactional outboxes: a leased batch is
 * returned (and so published) in commit order `(created_at, id)`.
 *
 * Before the fix the lease used `UPDATE ... WHERE id IN (ordered subquery)
 * RETURNING ...`; PostgreSQL gives RETURNING no defined order, so one batch
 * could publish an aggregate's later event before its earlier one (observed:
 * scheduling-outbox-rabbitmq received COMMITTED before HELD).
 *
 * Real PostgreSQL, the service's RUNTIME role and its compiled outbox store.
 * The rows use an unroutable test exchange name and are marked published by
 * the same lease before the test ends, so no other suite can relay them.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readContext, serviceDist } from '../_support.mjs';

export async function assertLeaseOrder(service) {
  const context = await readContext();
  const { PrismaService } = serviceDist(service, 'infrastructure/persistence/prisma.service.js');
  const { PrismaOutboxStore } = serviceDist(
    service,
    'infrastructure/messaging/prisma-outbox.store.js',
  );
  const prisma = new PrismaService(context.databases[service].appUrl);
  try {
    const store = new PrismaOutboxStore(prisma);
    // Created in commit order, but with ids whose order disagrees, scattered
    // over the heap by interleaved updates.
    const base = Date.UTC(2000, 0, 1);
    const ids = [];
    for (let i = 0; i < 60; i += 1) {
      const id = randomUUID();
      ids.push(id);
      await prisma.client.$executeRawUnsafe(
        `INSERT INTO app.outbox_message (id, event_id, event_type, exchange, routing_key, payload,
           correlation_id, created_at)
         VALUES ($1::uuid, $2::uuid, 'test.order.v1', 'lane-c.outbox-order.test', 'test.order.v1',
           '{}', $3::uuid, $4)`,
        id,
        randomUUID(),
        randomUUID(),
        new Date(base + i),
      );
    }
    for (const id of [...ids].reverse().filter((_, i) => i % 3 === 0)) {
      await prisma.client.$executeRawUnsafe(
        `UPDATE app.outbox_message SET last_error = 'heap-shuffle' WHERE id = $1::uuid`,
        id,
      );
    }
    const workerId = `order-${randomUUID().slice(0, 8)}`;
    // Dated before any real row and leased with limit = their count, so the
    // batch is exactly these rows and no other suite's row is touched.
    const leased = await store.leaseBatch({
      workerId,
      leaseMs: 60_000,
      limit: ids.length,
      maxAttempts: 10,
    });
    const mine = leased.filter((row) => ids.includes(row.id));
    for (const row of mine) await store.markPublished({ id: row.id, workerId });
    assert.equal(mine.length, ids.length, 'every inserted row was leased in one batch');
    assert.deepEqual(
      mine.map((row) => row.id),
      ids,
      'the batch is returned in commit order',
    );
    const times = leased.map((row) => row.createdAtMs);
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b),
      'the whole batch is ordered',
    );
  } finally {
    await prisma.client.$disconnect();
  }
}
