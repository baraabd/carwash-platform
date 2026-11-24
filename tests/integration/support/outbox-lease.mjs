import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Exercise real owner storage, including a restarted worker reusing its ID. */
export async function assertOutboxLeaseFencing({ store, client }) {
  const ids = [];
  const workerId = `p07-lease-${randomUUID()}`;
  const insert = async () => {
    const id = randomUUID();
    ids.push(id);
    await client.$executeRawUnsafe(
      `INSERT INTO app.outbox_message
        (id, event_id, event_type, exchange, routing_key, payload, correlation_id, created_at)
       VALUES ($1::uuid, $2::uuid, 'test.lease.v1', 'p07.lease.test', 'test.lease.v1',
               '{}', $3::uuid, $4)`,
      id,
      randomUUID(),
      randomUUID(),
      new Date('1990-01-01T00:00:00.000Z'),
    );
    return id;
  };
  const lease = async (id, maxAttempts = 5) => {
    const rows = await store.leaseBatch({ workerId, leaseMs: 60_000, limit: 1, maxAttempts });
    assert.equal(rows.length, 1, 'the isolated test row must be leased');
    assert.equal(rows[0].id, id);
    return { id, workerId, leaseAttempt: rows[0].attempts };
  };
  const expire = (id) =>
    client.$executeRawUnsafe(
      `UPDATE app.outbox_message SET locked_until = now() - interval '1 second'
       WHERE id = $1::uuid`,
      id,
    );
  const reject = async (fence) => {
    assert.equal(await store.markPublished(fence), false, 'stale success is fenced');
    assert.equal(
      await store.markFailed({ ...fence, error: 'STALE', maxAttempts: 5 }),
      false,
      'stale failure cannot release or park the current lease',
    );
  };

  try {
    const id = await insert();
    const first = await lease(id);
    await reject({ ...first, leaseAttempt: first.leaseAttempt + 1 });
    await expire(id);
    await reject(first);

    const second = await lease(id);
    assert.equal(second.leaseAttempt, first.leaseAttempt + 1);
    await reject(first);
    assert.equal(
      await store.markFailed({ ...second, error: 'RETRY', maxAttempts: 5 }),
      true,
      'the actual owner can still record a failed publication',
    );
    const third = await lease(id);
    await reject(second);
    assert.equal(await store.markPublished(third), true);
    const [published] = await client.$queryRawUnsafe(
      'SELECT published_at, last_error, locked_by FROM app.outbox_message WHERE id = $1::uuid',
      id,
    );
    assert.ok(published.published_at);
    assert.equal(published.last_error, null);
    assert.equal(published.locked_by, null);

    const crashedId = await insert();
    await client.$executeRawUnsafe(
      'UPDATE app.outbox_message SET attempts = 4 WHERE id = $1::uuid',
      crashedId,
    );
    const finalLease = await lease(crashedId);
    await expire(crashedId);
    await store.leaseBatch({ workerId, leaseMs: 60_000, limit: 0, maxAttempts: 5 });
    const [parked] = await client.$queryRawUnsafe(
      `SELECT dead_at, last_error, locked_by, attempts FROM app.outbox_message
       WHERE id = $1::uuid`,
      crashedId,
    );
    assert.ok(parked.dead_at, 'a crashed final attempt must be visible as dead');
    assert.equal(parked.last_error, 'LEASE_EXHAUSTED');
    assert.equal(parked.locked_by, null);
    assert.equal(parked.attempts, finalLease.leaseAttempt);
    await reject(finalLease);
  } finally {
    // No other suite may publish these deliberately non-business test events.
    for (const id of ids)
      await client.$executeRawUnsafe(
        `UPDATE app.outbox_message SET dead_at = COALESCE(dead_at, now()),
                locked_by = NULL, locked_until = NULL WHERE id = $1::uuid`,
        id,
      );
  }
}
