import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BOOKING,
  OPS,
  OTHER_SERVICE,
  TestClock,
  defineWindow,
  errorCode,
  key,
  meta,
  replica,
  type Replica,
} from './support';

/**
 * Real PostgreSQL 16, runtime role, several independent connection pools
 * standing in for several service replicas. Nothing here is mocked.
 */
const clock = new TestClock();
let replicas: Replica[];

before(() => {
  replicas = [replica(clock), replica(clock), replica(clock), replica(clock)];
});
after(async () => {
  await Promise.all(replicas.map((r) => r.prisma.client.$disconnect()));
});

const pick = (i: number) => replicas[i % replicas.length]!.service;

async function windowRow(id: string) {
  const [row] = await replicas[0]!.prisma.client.$queryRawUnsafe<
    { capacity: number; held: number; reserved: number; version: number }[]
  >(`SELECT capacity, held, reserved, version FROM app.capacity_window WHERE id = $1::uuid`, id);
  return row!;
}

async function holdCounts(windowId: string) {
  const rows = await replicas[0]!.prisma.client.$queryRawUnsafe<{ status: string; n: number }[]>(
    `SELECT status, count(*)::int AS n FROM app.capacity_hold WHERE window_id = $1::uuid GROUP BY status`,
    windowId,
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

async function outboxCount(eventType: string, holdIds: readonly string[]) {
  const [row] = await replicas[0]!.prisma.client.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM app.outbox_message
      WHERE event_type = $1 AND (payload::jsonb -> 'data' ->> 'holdId') = ANY($2::text[])`,
    eventType,
    holdIds,
  );
  return row!.n;
}

test('40 concurrent acquisitions across 4 replicas never oversell a 3-unit window', async () => {
  const window = await defineWindow(pick(0), clock, 3);
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, (_, i) =>
      pick(i).acquireHold(meta(BOOKING), {
        windowId: window.id,
        holderRef: randomUUID(),
        units: 1,
        idempotencyKey: key(),
      }),
    ),
  );
  const ok = results.filter((r) => r.status === 'fulfilled');
  const refused = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => (r.reason as { code?: string }).code);
  assert.equal(ok.length, 3);
  assert.deepEqual([...new Set(refused)], ['CAPACITY_EXHAUSTED']);
  const row = await windowRow(window.id);
  assert.equal(row.held, 3);
  assert.deepEqual(await holdCounts(window.id), { ACTIVE: 3 });
});

test('the very last unit: 25 concurrent multi-unit requests, exactly the fitting ones win', async () => {
  const window = await defineWindow(pick(1), clock, 4);
  // 2 units each: at most two requests can fit, and only if they are serialised correctly.
  const results = await Promise.allSettled(
    Array.from({ length: 25 }, (_, i) =>
      pick(i).acquireHold(meta(BOOKING), {
        windowId: window.id,
        holderRef: randomUUID(),
        units: 2,
        idempotencyKey: key(),
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  const row = await windowRow(window.id);
  assert.equal(row.held, 4);
  assert.ok(row.held + row.reserved <= row.capacity);
});

test('20 concurrent retries of one idempotency key create exactly one hold', async () => {
  const window = await defineWindow(pick(2), clock, 5);
  const idem = key();
  const holderRef = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      pick(i).acquireHold(meta(BOOKING), {
        windowId: window.id,
        holderRef,
        units: 1,
        idempotencyKey: idem,
      }),
    ),
  );
  assert.equal(new Set(results.map((r) => r.value.id)).size, 1);
  assert.equal(results.filter((r) => !r.replayed).length, 1, 'exactly one request did the work');
  assert.equal((await windowRow(window.id)).held, 1);
  assert.equal(await outboxCount('scheduling.hold-created.v1', [results[0]!.value.id]), 1);
});

test('reusing an idempotency key for a different request is refused, not replayed', async () => {
  const window = await defineWindow(pick(0), clock, 5);
  const idem = key();
  await pick(0).acquireHold(meta(BOOKING), {
    windowId: window.id,
    holderRef: randomUUID(),
    units: 1,
    idempotencyKey: idem,
  });
  assert.equal(
    await errorCode(
      pick(1).acquireHold(meta(BOOKING), {
        windowId: window.id,
        holderRef: randomUUID(),
        units: 1,
        idempotencyKey: idem,
      }),
    ),
    'IDEMPOTENCY_KEY_REUSED',
  );
  // The same key from ANOTHER client is an independent request.
  const other = await pick(2).acquireHold(meta(OTHER_SERVICE), {
    windowId: window.id,
    holderRef: randomUUID(),
    units: 1,
    idempotencyKey: idem,
  });
  assert.equal(other.replayed, false);
});

test('expiry: a due hold cannot be confirmed, frees its unit and emits one event', async () => {
  const local = new TestClock();
  const r = replica(local);
  try {
    const window = await defineWindow(r.service, local, 1);
    const { value: hold } = await r.service.acquireHold(meta(BOOKING), {
      windowId: window.id,
      holderRef: randomUUID(),
      units: 1,
      ttlSeconds: 60,
      idempotencyKey: key(),
    });
    local.advance(59_999);
    assert.equal(
      await errorCode(
        r.service.acquireHold(meta(BOOKING), {
          windowId: window.id,
          holderRef: randomUUID(),
          units: 1,
          idempotencyKey: key(),
        }),
      ),
      'CAPACITY_EXHAUSTED',
      'one millisecond before the deadline the hold still protects the unit',
    );
    local.advance(1);
    assert.equal(await errorCode(r.service.confirmHold(meta(BOOKING), hold.id)), 'HOLD_EXPIRED');
    assert.equal(
      (await r.service.getHold(meta(BOOKING), hold.id)).status,
      'EXPIRED',
      'the expiry was committed',
    );
    assert.equal((await windowRow(window.id)).held, 0);
    assert.equal(await outboxCount('scheduling.hold-expired.v1', [hold.id]), 1);
    // Confirming again stays refused and does not emit a second event.
    assert.equal(await errorCode(r.service.confirmHold(meta(BOOKING), hold.id)), 'HOLD_NOT_ACTIVE');
    assert.equal(await outboxCount('scheduling.hold-expired.v1', [hold.id]), 1);
  } finally {
    await r.prisma.client.$disconnect();
  }
});

test('an unswept expired hold never hides capacity: availability and acquire both reclaim it', async () => {
  const local = new TestClock();
  const r = replica(local);
  try {
    const zoneId = randomUUID();
    const window = await defineWindow(r.service, local, 1, zoneId);
    const { value: first } = await r.service.acquireHold(meta(BOOKING), {
      windowId: window.id,
      holderRef: randomUUID(),
      units: 1,
      ttlSeconds: 60,
      idempotencyKey: key(),
    });
    const range = { zoneId, from: local.now(), to: new Date(local.now().getTime() + 86_400_000) };
    const [busy] = (await r.service.availability(meta(OPS), range)) as { freeUnits: number }[];
    assert.equal(busy!.freeUnits, 0);
    local.advance(60_000);
    const [free] = (await r.service.availability(meta(OPS), range)) as {
      freeUnits: number;
      available: boolean;
    }[];
    assert.equal(free!.freeUnits, 1, 'computed from the deadline, before any sweeper ran');
    assert.equal((await windowRow(window.id)).held, 1, 'the counter is still stale at this point');
    const second = await r.service.acquireHold(meta(BOOKING), {
      windowId: window.id,
      holderRef: randomUUID(),
      units: 1,
      idempotencyKey: key(),
    });
    assert.equal(second.value.status, 'ACTIVE');
    assert.equal((await r.service.getHold(meta(OPS), first.id)).status, 'EXPIRED');
    assert.equal((await windowRow(window.id)).held, 1);
  } finally {
    await r.prisma.client.$disconnect();
  }
});

test('four concurrent sweepers expire 30 holds exactly once each', async () => {
  const local = new TestClock();
  const sweepers = [replica(local), replica(local), replica(local), replica(local)];
  try {
    const holdIds: string[] = [];
    const windows: string[] = [];
    for (let w = 0; w < 3; w += 1) {
      const window = await defineWindow(sweepers[0]!.service, local, 10);
      windows.push(window.id);
      for (let h = 0; h < 10; h += 1) {
        const { value } = await sweepers[h % 4]!.service.acquireHold(meta(BOOKING), {
          windowId: window.id,
          holderRef: randomUUID(),
          units: 1,
          ttlSeconds: 60,
          idempotencyKey: key(),
        });
        holdIds.push(value.id);
      }
    }
    local.advance(61_000);
    const correlation = randomUUID();
    // The lane database is shared with earlier runs, so sweepers also meet other
    // tests' due holds. Assert on THIS test's holds only. Several rounds: SKIP
    // LOCKED lets a busy window be skipped and picked up by a later pass.
    const mine = async () =>
      (
        await replicas[0]!.prisma.client.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM app.capacity_hold WHERE id = ANY($1::uuid[]) AND status = 'EXPIRED'`,
          holdIds,
        )
      )[0]!.n;
    for (let round = 0; round < 20 && (await mine()) < 30; round += 1) {
      await Promise.all(sweepers.map((s) => s.service.expireDue(correlation, 500)));
    }
    assert.equal(await mine(), 30, 'none was missed');
    for (const id of windows) assert.equal((await windowRow(id)).held, 0);
    assert.equal(
      await outboxCount('scheduling.hold-expired.v1', holdIds),
      30,
      'each hold expired exactly once: one event each, no duplicates',
    );
  } finally {
    await Promise.all(sweepers.map((s) => s.prisma.client.$disconnect()));
  }
});

test('confirm racing the sweeper at the deadline: one outcome, one event', async () => {
  const local = new TestClock();
  const a = replica(local);
  const b = replica(local);
  try {
    const window = await defineWindow(a.service, local, 1);
    const { value: hold } = await a.service.acquireHold(meta(BOOKING), {
      windowId: window.id,
      holderRef: randomUUID(),
      units: 1,
      ttlSeconds: 60,
      idempotencyKey: key(),
    });
    local.advance(60_000);
    const [confirmOutcome] = await Promise.all([
      errorCode(a.service.confirmHold(meta(BOOKING), hold.id)),
      b.service.expireDue(randomUUID(), 100),
    ]);
    assert.equal(confirmOutcome === 'HOLD_EXPIRED' || confirmOutcome === 'HOLD_NOT_ACTIVE', true);
    assert.equal(await outboxCount('scheduling.hold-expired.v1', [hold.id]), 1);
    assert.equal((await windowRow(window.id)).held, 0);
  } finally {
    await Promise.all([a.prisma.client.$disconnect(), b.prisma.client.$disconnect()]);
  }
});

test('confirm converts held to reserved; cancel returns it; both are idempotent', async () => {
  const window = await defineWindow(pick(0), clock, 2);
  const { value: hold } = await pick(1).acquireHold(meta(BOOKING), {
    windowId: window.id,
    holderRef: randomUUID(),
    units: 2,
    idempotencyKey: key(),
  });
  const confirmed = await pick(2).confirmHold(meta(BOOKING), hold.id);
  assert.equal(confirmed.value.status, 'CONFIRMED');
  assert.equal((await pick(3).confirmHold(meta(BOOKING), hold.id)).replayed, true);
  assert.deepEqual(await windowRow(window.id).then(({ held, reserved }) => ({ held, reserved })), {
    held: 0,
    reserved: 2,
  });
  assert.equal(
    (await pick(0).releaseHold(meta(BOOKING), hold.id, 'BOOKING_CANCELLED')).status,
    'CANCELLED',
  );
  assert.equal(
    (await pick(1).releaseHold(meta(BOOKING), hold.id, 'BOOKING_CANCELLED')).status,
    'CANCELLED',
  );
  assert.deepEqual(await windowRow(window.id).then(({ held, reserved }) => ({ held, reserved })), {
    held: 0,
    reserved: 0,
  });
});

test('object access: another client cannot see, confirm or release a hold', async () => {
  const window = await defineWindow(pick(0), clock, 1);
  const { value: hold } = await pick(0).acquireHold(meta(BOOKING), {
    windowId: window.id,
    holderRef: randomUUID(),
    units: 1,
    idempotencyKey: key(),
  });
  assert.equal(await errorCode(pick(1).getHold(meta(OTHER_SERVICE), hold.id)), 'HOLD_NOT_FOUND');
  assert.equal(
    await errorCode(pick(1).confirmHold(meta(OTHER_SERVICE), hold.id)),
    'HOLD_NOT_FOUND',
  );
  assert.equal(
    await errorCode(pick(1).releaseHold(meta(OTHER_SERVICE), hold.id, 'BOOKING_FAILED')),
    'HOLD_NOT_FOUND',
  );
  // Operations may intervene, only with the reserved reason, and it is audited.
  assert.equal(
    await errorCode(pick(2).releaseHold(meta(OPS), hold.id, 'BOOKING_FAILED')),
    'INVALID_INPUT',
  );
  assert.equal(
    (await pick(2).releaseHold(meta(OPS), hold.id, 'OPERATIONS_OVERRIDE')).status,
    'RELEASED',
  );
  const [audit] = await replicas[0]!.prisma.client.$queryRawUnsafe<
    { actor_kind: string; action: string }[]
  >(
    `SELECT actor_kind, action FROM app.audit_entry WHERE target_id = $1::uuid AND action = 'hold.released'`,
    hold.id,
  );
  assert.deepEqual(audit, { actor_kind: 'USER', action: 'hold.released' });
});

test('capacity management: optimistic version, no drop below committed, close stops new holds', async () => {
  const window = await defineWindow(pick(0), clock, 3);
  await pick(0).acquireHold(meta(BOOKING), {
    windowId: window.id,
    holderRef: randomUUID(),
    units: 2,
    idempotencyKey: key(),
  });
  const current = await windowRow(window.id);
  assert.equal(
    await errorCode(
      pick(1).changeCapacity(meta(OPS), window.id, {
        capacity: 1,
        expectedVersion: current.version,
      }),
    ),
    'CAPACITY_BELOW_COMMITTED',
  );
  assert.equal(
    await errorCode(
      pick(1).changeCapacity(meta(OPS), window.id, {
        capacity: 5,
        expectedVersion: current.version - 1,
      }),
    ),
    'VERSION_CONFLICT',
  );
  const grown = await pick(2).changeCapacity(meta(OPS), window.id, {
    capacity: 5,
    expectedVersion: current.version,
  });
  assert.equal(grown.capacity, 5);
  const closed = await pick(3).closeWindow(meta(OPS), window.id, grown.version);
  assert.equal(closed.status, 'CLOSED');
  assert.equal(
    await errorCode(
      pick(0).acquireHold(meta(BOOKING), {
        windowId: window.id,
        holderRef: randomUUID(),
        units: 1,
        idempotencyKey: key(),
      }),
    ),
    'WINDOW_CLOSED',
  );
  assert.equal(
    await errorCode(
      pick(0).changeCapacity(meta(BOOKING), window.id, { capacity: 9, expectedVersion: 1 }),
    ),
    'FORBIDDEN',
  );
});

test('windows: identical redefinition replays, overlap and conflicting start are refused by the database', async () => {
  const zoneId = randomUUID();
  const startsAt = new Date(clock.now().getTime() + 5 * 3_600_000);
  const endsAt = new Date(startsAt.getTime() + 3_600_000);
  const created = await pick(0).defineWindow(meta(OPS), { zoneId, startsAt, endsAt, capacity: 2 });
  const replayed = await pick(1).defineWindow(meta(OPS), { zoneId, startsAt, endsAt, capacity: 2 });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.value.id, created.value.id);
  assert.equal(
    await errorCode(pick(2).defineWindow(meta(OPS), { zoneId, startsAt, endsAt, capacity: 3 })),
    'WINDOW_EXISTS',
  );
  const overlapping = {
    zoneId,
    startsAt: new Date(startsAt.getTime() + 1_800_000),
    endsAt: new Date(endsAt.getTime() + 1_800_000),
    capacity: 2,
  };
  assert.equal(await errorCode(pick(3).defineWindow(meta(OPS), overlapping)), 'WINDOW_OVERLAPS');
  // Adjacent (half-open) windows are allowed.
  const adjacent = await pick(0).defineWindow(meta(OPS), {
    zoneId,
    startsAt: endsAt,
    endsAt: new Date(endsAt.getTime() + 3_600_000),
    capacity: 2,
  });
  assert.equal(adjacent.replayed, false);
  // Concurrent overlapping definitions: the exclusion constraint lets exactly one in.
  const raceZone = randomUUID();
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      errorCode(
        pick(i).defineWindow(meta(OPS), {
          zoneId: raceZone,
          startsAt: new Date(startsAt.getTime() + i * 60_000),
          endsAt: new Date(endsAt.getTime() + i * 60_000),
          capacity: 1,
        }),
      ),
    ),
  );
  assert.equal(outcomes.filter((o) => o === 'OK').length, 1);
  assert.deepEqual([...new Set(outcomes.filter((o) => o !== 'OK'))], ['WINDOW_OVERLAPS']);
});

test('database backstops: CHECK rejects an oversell even from raw SQL; the runtime role has no DDL', async () => {
  const window = await defineWindow(pick(0), clock, 2);
  const client = replicas[0]!.prisma.client;
  await assert.rejects(
    client.$executeRawUnsafe(
      `UPDATE app.capacity_window SET held = capacity + 1 WHERE id = $1::uuid`,
      window.id,
    ),
    (error: unknown) => JSON.stringify((error as { meta?: unknown }).meta ?? '').includes('23514'),
  );
  await assert.rejects(
    client.$executeRawUnsafe(`CREATE TABLE app.should_not_exist (id int)`),
    (error: unknown) => JSON.stringify((error as { meta?: unknown }).meta ?? '').includes('42501'),
  );
  await assert.rejects(
    client.$queryRawUnsafe(`SELECT count(*) FROM app._prisma_migrations`),
    (error: unknown) => JSON.stringify((error as { meta?: unknown }).meta ?? '').includes('42501'),
  );
});
