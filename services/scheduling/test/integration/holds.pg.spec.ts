import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BOOKING,
  NO_SCOPE,
  OPS,
  TestClock,
  defineWindow,
  errorCode,
  holdOf,
  holdRequestFor,
  key,
  meta,
  principal,
  replica,
  type Replica,
} from './support';

/**
 * scheduling.v1 holds on real PostgreSQL 16 with the RUNTIME role, using four
 * independent connection pools as four service replicas. Nothing is mocked;
 * the clock is injected so deadlines are exact.
 */
const clock = new TestClock(new Date('2026-10-20T06:00:00.000Z'));
let replicas: Replica[];

before(() => {
  // The real clock must not matter: windows are defined relative to `clock`.
  replicas = [replica(clock), replica(clock), replica(clock), replica(clock)];
});
after(async () => {
  await Promise.all(replicas.map((r) => r.prisma.client.$disconnect()));
});

const at = (i: number) => replicas[i % replicas.length]!;
const sql = () => replicas[0]!.prisma.client;

async function windowRow(id: string) {
  const [row] = await sql().$queryRawUnsafe<{ capacity: number; held: number; reserved: number }[]>(
    `SELECT capacity, held, reserved FROM app.capacity_window WHERE id = $1::uuid`,
    id,
  );
  return row!;
}

async function statuses(windowId: string) {
  const rows = await sql().$queryRawUnsafe<{ status: string; n: number }[]>(
    `SELECT status, count(*)::int AS n FROM app.capacity_hold WHERE window_id = $1::uuid GROUP BY status`,
    windowId,
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

async function events(holdId: string) {
  const rows = await sql().$queryRawUnsafe<{ payload: string }[]>(
    `SELECT payload FROM app.outbox_message
      WHERE event_type = 'scheduling.hold-changed.v1'
        AND (payload::jsonb -> 'aggregate' ->> 'id') = $1
      ORDER BY created_at, (payload::jsonb -> 'aggregate' ->> 'version')::int`,
    holdId,
  );
  return rows.map(
    (r) => JSON.parse(r.payload) as { data: { state: string; bookingId: string | null } },
  );
}

/** Counters must equal the hold rows: held = ACTIVE units, reserved = CONFIRMED units. */
async function assertCountersMatchRows(windowId: string) {
  const [row] = await sql().$queryRawUnsafe<
    { held: number; reserved: number; capacity: number; active: number; confirmed: number }[]
  >(
    `SELECT w.held, w.reserved, w.capacity,
            COALESCE(SUM(h.units) FILTER (WHERE h.status = 'ACTIVE'), 0)::int AS active,
            COALESCE(SUM(h.units) FILTER (WHERE h.status = 'CONFIRMED'), 0)::int AS confirmed
       FROM app.capacity_window w LEFT JOIN app.capacity_hold h ON h.window_id = w.id
      WHERE w.id = $1::uuid GROUP BY w.id`,
    windowId,
  );
  assert.equal(row!.held, row!.active, 'held = ACTIVE units');
  assert.equal(row!.reserved, row!.confirmed, 'reserved = CONFIRMED units');
  assert.ok(row!.held + row!.reserved <= row!.capacity, 'never oversold');
}

async function held(r: Replica, window: { zoneId: string; startsAt: Date }) {
  const who = principal();
  const response = await r.holds.createHold(meta(who), holdRequestFor(who, window), key());
  return { who, hold: holdOf(response) };
}

test('40 concurrent holds from 40 principals across 4 replicas never oversell 3 units', async () => {
  const window = await defineWindow(at(0).capacity, clock, 3);
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, (_, i) => {
      const who = principal(i % 2 === 0 ? 'guest' : 'account');
      return at(i).holds.createHold(meta(who), holdRequestFor(who, window), key());
    }),
  );
  const refused = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => (r.reason as { code?: string }).code);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
  assert.deepEqual([...new Set(refused)], ['SLOT_UNAVAILABLE']);
  assert.equal((await windowRow(window.id)).held, 3);
  assert.deepEqual(await statuses(window.id), { ACTIVE: 3 });
  await assertCountersMatchRows(window.id);
});

test('20 concurrent retries of one key create one hold and one event; all see the same hold', async () => {
  const window = await defineWindow(at(0).capacity, clock, 5);
  const who = principal();
  const request = holdRequestFor(who, window);
  const idem = key();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => at(i).holds.createHold(meta(who), request, idem)),
  );
  const ids = new Set(results.map((r) => holdOf(r).holdId));
  assert.equal(ids.size, 1);
  assert.ok(
    results.every((r) => r.status === 201),
    'a replay returns the stored status',
  );
  assert.equal((await windowRow(window.id)).held, 1);
  assert.equal((await events([...ids][0]!)).length, 1);
});

test('a key reused for a different body is a conflict; keys are scoped per principal', async () => {
  const window = await defineWindow(at(0).capacity, clock, 5);
  const who = principal();
  const idem = key();
  await at(0).holds.createHold(meta(who), holdRequestFor(who, window, 30), idem);
  assert.equal(
    await errorCode(at(1).holds.createHold(meta(who), holdRequestFor(who, window, 45), idem)),
    'IDEMPOTENCY_KEY_REUSED',
  );
  const other = principal();
  const response = await at(2).holds.createHold(meta(other), holdRequestFor(other, window), idem);
  assert.equal(response.status, 201, 'the same key from another principal is a new request');
});

test('a principal holds only for itself and at most 3 live holds, even when racing', async () => {
  const window = await defineWindow(at(0).capacity, clock, 50);
  const who = principal('account');
  const someoneElse = principal('account');
  assert.equal(
    await errorCode(at(0).holds.createHold(meta(who), holdRequestFor(someoneElse, window), key())),
    'FORBIDDEN',
  );
  assert.equal(
    await errorCode(
      at(0).holds.createHold(
        meta(who),
        { ...holdRequestFor(who, window), beneficiary: { kind: 'guest', subjectId: who.subject } },
        key(),
      ),
    ),
    'FORBIDDEN',
    'an account cannot hold as a guest of the same subject id',
  );
  assert.equal(
    await errorCode(at(0).holds.createHold(meta(BOOKING), holdRequestFor(who, window), key())),
    'FORBIDDEN',
  );
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      at(i).holds.createHold(meta(who), holdRequestFor(who, window), key()),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
  const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.ok(refused.every((r) => (r.reason as { code?: string }).code === 'HOLD_LIMIT_REACHED'));
});

test('slots outside any window, already started or beyond the horizon are refused', async () => {
  const window = await defineWindow(at(0).capacity, clock, 2);
  const who = principal();
  assert.equal(
    await errorCode(at(0).holds.createHold(meta(who), holdRequestFor(who, window, 30, 45), key())),
    'SLOT_UNAVAILABLE',
    'a 30 min slot starting 45 min into a 60 min window does not fit',
  );
  assert.equal(
    await errorCode(
      at(0).holds.createHold(
        meta(who),
        { ...holdRequestFor(who, window), zoneId: randomUUID() },
        key(),
      ),
    ),
    'SLOT_UNAVAILABLE',
  );
  assert.equal(
    await errorCode(
      at(0).holds.createHold(
        meta(who),
        {
          ...holdRequestFor(who, window),
          startsAt: new Date(clock.now().getTime() + 31 * 86_400_000),
        },
        key(),
      ),
    ),
    'OUTSIDE_HORIZON',
  );
  await at(0).capacity.closeWindow(meta(OPS), window.id, window.version);
  assert.equal(
    await errorCode(at(0).holds.createHold(meta(who), holdRequestFor(who, window), key())),
    'SLOT_UNAVAILABLE',
  );
});

test('commit: Booking only; revision-checked; held unit becomes reserved; event carries bookingId', async () => {
  const window = await defineWindow(at(0).capacity, clock, 2);
  const { who, hold } = await held(at(0), window);
  const bookingId = randomUUID();
  assert.equal(
    await errorCode(
      at(0).holds.commitHold(meta(who), hold.holdId, { expectedRevision: 1, bookingId }, key()),
    ),
    'FORBIDDEN',
  );
  assert.equal(
    await errorCode(
      at(0).holds.commitHold(
        meta(NO_SCOPE),
        hold.holdId,
        { expectedRevision: 1, bookingId },
        key(),
      ),
    ),
    'FORBIDDEN',
  );
  assert.equal(
    await errorCode(
      at(0).holds.commitHold(meta(BOOKING), hold.holdId, { expectedRevision: 2, bookingId }, key()),
    ),
    'VERSION_CONFLICT',
  );
  assert.equal(
    await errorCode(
      at(0).holds.commitHold(
        meta(BOOKING),
        randomUUID(),
        { expectedRevision: 1, bookingId },
        key(),
      ),
    ),
    'HOLD_NOT_FOUND',
  );
  const committed = await at(1).holds.commitHold(
    meta(BOOKING),
    hold.holdId,
    { expectedRevision: 1, bookingId },
    key(),
  );
  assert.equal(committed.status, 200);
  assert.equal(holdOf(committed).state, 'COMMITTED');
  assert.equal(holdOf(committed).bookingId, bookingId);
  assert.equal(holdOf(committed).revision, 2);
  const row = await windowRow(window.id);
  assert.equal(row.held, 0);
  assert.equal(row.reserved, 1);
  assert.deepEqual(
    (await events(hold.holdId)).map((e) => [e.data.state, e.data.bookingId]),
    [
      ['HELD', null],
      ['COMMITTED', bookingId],
    ],
  );
  // Response loss: Booking retries with a NEW key and the old revision -> same answer.
  const replay = await at(2).holds.commitHold(
    meta(BOOKING),
    hold.holdId,
    { expectedRevision: 1, bookingId },
    key(),
  );
  assert.deepEqual(replay, committed);
  assert.equal(
    await errorCode(
      at(3).holds.commitHold(
        meta(BOOKING),
        hold.holdId,
        { expectedRevision: 2, bookingId: randomUUID() },
        key(),
      ),
    ),
    'HOLD_NOT_ACTIVE',
  );
  assert.equal((await events(hold.holdId)).length, 2, 'replays emit nothing');
  await assertCountersMatchRows(window.id);
});

test('racing commits: same booking on 4 replicas converge; two bookings -> exactly one wins', async () => {
  const window = await defineWindow(at(0).capacity, clock, 3);
  const first = await held(at(0), window);
  const bookingId = randomUUID();
  const same = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      at(i).holds.commitHold(
        meta(BOOKING),
        first.hold.holdId,
        { expectedRevision: 1, bookingId },
        key(),
      ),
    ),
  );
  assert.ok(same.every((r) => r.status === 200 && holdOf(r).bookingId === bookingId));
  assert.equal(
    (await events(first.hold.holdId)).filter((e) => e.data.state === 'COMMITTED').length,
    1,
  );

  const second = await held(at(1), window);
  const rivals = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      at(i).holds.commitHold(
        meta(BOOKING),
        second.hold.holdId,
        { expectedRevision: 1, bookingId: randomUUID() },
        key(),
      ),
    ),
  );
  assert.equal(rivals.filter((r) => r.status === 'fulfilled').length, 1);
  const losers = rivals.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.ok(losers.every((r) => (r.reason as { code?: string }).code === 'HOLD_NOT_ACTIVE'));
  assert.equal((await windowRow(window.id)).reserved, 2);
  await assertCountersMatchRows(window.id);
});

test('one booking commits at most one hold (enforced by a unique index)', async () => {
  const window = await defineWindow(at(0).capacity, clock, 3);
  const a = await held(at(0), window);
  const b = await held(at(0), window);
  const bookingId = randomUUID();
  await at(0).holds.commitHold(
    meta(BOOKING),
    a.hold.holdId,
    { expectedRevision: 1, bookingId },
    key(),
  );
  assert.equal(
    await errorCode(
      at(1).holds.commitHold(
        meta(BOOKING),
        b.hold.holdId,
        { expectedRevision: 1, bookingId },
        key(),
      ),
    ),
    'BOOKING_ALREADY_COMMITTED',
  );
  assert.deepEqual(await statuses(window.id), { ACTIVE: 1, CONFIRMED: 1 });
  await assertCountersMatchRows(window.id);
});

test('commit at the deadline: HOLD_EXPIRED, the expiry is committed, a retry never turns into success', async () => {
  const window = await defineWindow(at(0).capacity, clock, 1);
  const { hold } = await held(at(0), window);
  const [row] = await sql().$queryRawUnsafe<{ expires_at: Date }[]>(
    `SELECT expires_at FROM app.capacity_hold WHERE id = $1::uuid`,
    hold.holdId,
  );
  const late = new TestClock(row!.expires_at);
  const lateReplica = replica(late);
  try {
    const idem = key();
    const body = { expectedRevision: 1, bookingId: randomUUID() };
    assert.equal(
      await errorCode(lateReplica.holds.commitHold(meta(BOOKING), hold.holdId, body, idem)),
      'HOLD_EXPIRED',
    );
    assert.deepEqual(await statuses(window.id), { EXPIRED: 1 });
    assert.equal((await windowRow(window.id)).held, 0, 'the unit went back to the window');
    assert.equal(
      await errorCode(lateReplica.holds.commitHold(meta(BOOKING), hold.holdId, body, idem)),
      'HOLD_EXPIRED',
    );
    const [claims] = await sql().$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM app.idempotency_record WHERE key = $1`,
      idem,
    );
    assert.equal(claims!.n, 0, 'a refusal is never stored as a replayable outcome');
    assert.deepEqual(
      (await events(hold.holdId)).map((e) => e.data.state),
      ['HELD', 'EXPIRED'],
    );
  } finally {
    await lateReplica.prisma.client.$disconnect();
  }
});

test('release: beneficiary only, held only, units return; another principal sees 404', async () => {
  const window = await defineWindow(at(0).capacity, clock, 1);
  const { who, hold } = await held(at(0), window);
  const stranger = principal();
  assert.equal(
    await errorCode(
      at(0).holds.releaseHold(
        meta(stranger),
        hold.holdId,
        { expectedRevision: 1, reason: 'CUSTOMER_CHANGED' },
        key(),
      ),
    ),
    'HOLD_NOT_FOUND',
  );
  assert.equal(await errorCode(at(0).holds.getHold(meta(stranger), hold.holdId)), 'HOLD_NOT_FOUND');
  assert.equal((await at(0).holds.getHold(meta(OPS), hold.holdId)).holdId, hold.holdId);
  const idem = key();
  const released = await at(1).holds.releaseHold(
    meta(who),
    hold.holdId,
    { expectedRevision: 1, reason: 'CUSTOMER_CHANGED' },
    idem,
  );
  assert.equal(holdOf(released).state, 'RELEASED');
  assert.equal((await windowRow(window.id)).held, 0);
  const again = await at(2).holds.releaseHold(
    meta(who),
    hold.holdId,
    { expectedRevision: 1, reason: 'CUSTOMER_CHANGED' },
    idem,
  );
  assert.deepEqual(again, released, 'same key replays');
  assert.equal(
    await errorCode(
      at(3).holds.releaseHold(
        meta(who),
        hold.holdId,
        { expectedRevision: 2, reason: 'CUSTOMER_CHANGED' },
        key(),
      ),
    ),
    'HOLD_NOT_ACTIVE',
  );
  // Freed capacity is immediately holdable by someone else.
  await held(at(0), window);
  const committedHold = await held(at(0), await defineWindow(at(0).capacity, clock, 1));
  await at(0).holds.commitHold(
    meta(BOOKING),
    committedHold.hold.holdId,
    { expectedRevision: 1, bookingId: randomUUID() },
    key(),
  );
  assert.equal(
    await errorCode(
      at(0).holds.releaseHold(
        meta(committedHold.who),
        committedHold.hold.holdId,
        { expectedRevision: 2, reason: 'BOOKING_FAILED' },
        key(),
      ),
    ),
    'HOLD_NOT_ACTIVE',
    'a committed hold is not released through the principal surface',
  );
});

test('expiry sweep on 4 replicas at once: every due hold expires exactly once', async () => {
  const windows = await Promise.all(
    Array.from({ length: 3 }, (_, i) =>
      defineWindow(at(0).capacity, clock, 4, randomUUID(), (3 + i) * 3_600_000),
    ),
  );
  const holdIds: string[] = [];
  for (const window of windows) {
    for (let i = 0; i < 4; i += 1) holdIds.push((await held(at(i), window)).hold.holdId);
  }
  const later = new TestClock(new Date(clock.now().getTime() + 601_000));
  const sweepers = [replica(later), replica(later), replica(later), replica(later)];
  try {
    const passes = await Promise.all(sweepers.map((s) => s.capacity.expireDue(randomUUID(), 50)));
    // Other suites' holds may be due too; this test's 12 must be among the freed units.
    assert.ok(passes.reduce((sum, p) => sum + p.units, 0) >= 12);
    const again = await sweepers[0]!.capacity.expireDue(randomUUID(), 50);
    assert.equal(again.units, 0);
  } finally {
    await Promise.all(sweepers.map((s) => s.prisma.client.$disconnect()));
  }
  for (const id of holdIds) {
    assert.deepEqual(
      (await events(id)).map((e) => e.data.state),
      ['HELD', 'EXPIRED'],
    );
  }
  for (const window of windows) {
    assert.equal((await windowRow(window.id)).held, 0);
    await assertCountersMatchRows(window.id);
  }
});

test('availability: Damascus civil day, live capacity, due-but-unswept holds do not hide slots', async () => {
  const zoneId = randomUUID();
  // 2026-10-21 09:00-11:00 in Damascus (UTC+3).
  const startsAt = new Date('2026-10-21T06:00:00.000Z');
  const window = (
    await at(0).capacity.defineWindow(meta(OPS), {
      zoneId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
      capacity: 2,
    })
  ).value;
  const view = await at(1).holds.availability({ zoneId, date: '2026-10-21', durationMinutes: 45 });
  assert.equal(view.timezone, 'Asia/Damascus');
  assert.deepEqual(
    view.slots.map((s) => [s.startsAt, s.availability]),
    [
      ['2026-10-21T06:00:00.000Z', 'AVAILABLE'],
      ['2026-10-21T06:45:00.000Z', 'AVAILABLE'],
    ],
  );
  assert.deepEqual(view.earliest, {
    startsAt: '2026-10-21T06:00:00.000Z',
    endsAt: '2026-10-21T06:45:00.000Z',
  });
  const { who, hold } = await held(at(0), window);
  assert.ok(
    (
      await at(1).holds.availability({ zoneId, date: '2026-10-21', durationMinutes: 45 })
    ).slots.every((s) => s.availability === 'LIMITED'),
  );
  await at(0).holds.commitHold(
    meta(BOOKING),
    hold.holdId,
    { expectedRevision: 1, bookingId: randomUUID() },
    key(),
  );
  const other = await held(at(0), window);
  assert.deepEqual(
    (await at(1).holds.availability({ zoneId, date: '2026-10-21', durationMinutes: 45 })).slots,
    [],
    'one reserved + one held = full',
  );
  // After the held one's deadline (not yet swept) the unit is visible again.
  const later = replica(new TestClock(new Date(clock.now().getTime() + 600_000)));
  try {
    const view2 = await later.holds.availability({
      zoneId,
      date: '2026-10-21',
      durationMinutes: 45,
    });
    assert.equal(view2.slots.length, 2);
    assert.equal(view2.slots[0]!.availability, 'LIMITED');
    const earliest = await later.holds.earliest({ zoneId, durationMinutes: 45 });
    assert.equal(earliest.date, '2026-10-21');
    assert.equal(earliest.earliest?.startsAt, '2026-10-21T06:00:00.000Z');
  } finally {
    await later.prisma.client.$disconnect();
  }
  assert.ok(who && other);
  const empty = await at(0).holds.availability({ zoneId, date: '2026-10-22', durationMinutes: 45 });
  assert.deepEqual(empty.slots, []);
  assert.equal(empty.earliest, null);
});

test('pre-v1 (C1) hold rows are invisible to v1 and still expire, returning their units', async () => {
  const window = await defineWindow(at(0).capacity, clock, 4);
  const legacyId = randomUUID();
  await sql().$transaction([
    sql().$executeRawUnsafe(
      `INSERT INTO app.capacity_hold (id, window_id, client_id, holder_ref, units, status, expires_at,
         idempotency_key, request_fingerprint, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, 'booking', $3::uuid, 2, 'ACTIVE', $4, $5, $6, 1, $7, $7)`,
      legacyId,
      window.id,
      randomUUID(),
      new Date(clock.now().getTime() + 60_000),
      key(),
      'f'.repeat(64),
      clock.now(),
    ),
    sql().$executeRawUnsafe(
      `UPDATE app.capacity_window SET held = held + 2, version = version + 1 WHERE id = $1::uuid`,
      window.id,
    ),
  ]);
  assert.equal(await errorCode(at(0).holds.getHold(meta(OPS), legacyId)), 'HOLD_NOT_FOUND');
  const later = replica(new TestClock(new Date(clock.now().getTime() + 61_000)));
  try {
    const pass = await later.capacity.expireDue(randomUUID(), 500);
    assert.ok(pass.units >= 2);
  } finally {
    await later.prisma.client.$disconnect();
  }
  assert.deepEqual(await statuses(window.id), { EXPIRED: 1 });
  assert.equal((await windowRow(window.id)).held, 0);
});

test('database constraints reject incomplete or inconsistent hold rows on their own', async () => {
  const window = await defineWindow(at(0).capacity, clock, 2);
  const insert = (status: string, bookingId: string | null, kind: string | null) =>
    sql().$executeRawUnsafe(
      `INSERT INTO app.capacity_hold (id, window_id, zone_id, beneficiary_kind, beneficiary_subject,
         quote_id, quote_revision, slot_starts_at, slot_ends_at, units, status, expires_at,
         booking_id, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $5::uuid, 1, $6, $7, 1, $8, $6, $9::uuid, 1, $6, $6)`,
      randomUUID(),
      window.id,
      window.zoneId,
      kind,
      randomUUID(),
      window.startsAt,
      new Date(window.startsAt.getTime() + 30 * 60_000),
      status,
      bookingId,
    );
  await assert.rejects(
    insert('ACTIVE', randomUUID(), 'guest'),
    /capacity_hold_shape_ck|23514|violates check/,
  );
  await assert.rejects(
    insert('CONFIRMED', null, 'guest'),
    /capacity_hold_shape_ck|23514|violates check/,
  );
  await assert.rejects(
    insert('ACTIVE', null, 'staff'),
    /capacity_hold_shape_ck|23514|violates check/,
  );
  await assert.rejects(
    sql().$executeRawUnsafe(
      `UPDATE app.capacity_window SET held = capacity + 1 WHERE id = $1::uuid`,
      window.id,
    ),
    /capacity_window_no_oversell_ck|23514|violates check/,
  );
});

test('a concurrent holder of the same key is reported as in progress, never duplicated', async () => {
  const window = await defineWindow(at(0).capacity, clock, 2);
  const who = principal();
  const idem = key();
  const scope = `scheduling.v1:createHold:${who.principalKind}:${who.subject}`;
  let release!: () => void;
  const holding = new Promise<void>((resolve) => (release = resolve));
  let claimed!: () => void;
  const claimedP = new Promise<void>((resolve) => (claimed = resolve));
  const blocker = sql().$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO app.idempotency_record (scope, key, fingerprint) VALUES ($1, $2, $3)`,
        scope,
        idem,
        'a'.repeat(64),
      );
      claimed();
      await holding;
      throw new Error('ROLLBACK_ON_PURPOSE');
    },
    { timeout: 20_000 },
  );
  await claimedP;
  try {
    assert.equal(
      await errorCode(at(1).holds.createHold(meta(who), holdRequestFor(who, window), idem)),
      'IDEMPOTENCY_IN_PROGRESS',
    );
  } finally {
    release();
    await assert.rejects(blocker, /ROLLBACK_ON_PURPOSE/);
  }
  // The holder rolled back, so the key is free and the request now succeeds once.
  const response = await at(2).holds.createHold(meta(who), holdRequestFor(who, window), idem);
  assert.equal(response.status, 201);
});

test('completed idempotency records are purged after retention only', async () => {
  const window = await defineWindow(at(0).capacity, clock, 2);
  const who = principal();
  const idem = key();
  await at(0).holds.createHold(meta(who), holdRequestFor(who, window), idem);
  const count = async () => {
    const [row] = await sql().$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM app.idempotency_record WHERE key = $1`,
      idem,
    );
    return row!.n;
  };
  await at(0).capacity.purgeIdempotency(7 * 86_400_000);
  assert.equal(await count(), 1, 'a fresh record stays');
  // Age the record by the database clock that stamped it (fixture shortcut for 8 days).
  await sql().$executeRawUnsafe(
    `UPDATE app.idempotency_record SET completed_at = now() - interval '8 days' WHERE key = $1`,
    idem,
  );
  assert.ok((await at(0).capacity.purgeIdempotency(7 * 86_400_000, 10_000)) >= 1);
  assert.equal(await count(), 0);
});
