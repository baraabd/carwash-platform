import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../../src/ports';
import {
  BOOKING,
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
 * P04-C1 booking commitment changes on real PostgreSQL 16 (RUNTIME role), with
 * four connection pools as four replicas. Nothing is mocked; the clock is
 * injected so hold deadlines are exact.
 */
const clock = new TestClock(new Date('2026-10-22T06:00:00.000Z'));
let replicas: Replica[];

before(() => {
  replicas = [replica(clock), replica(clock), replica(clock), replica(clock)];
});
after(async () => {
  await Promise.all(replicas.map((r) => r.prisma.client.$disconnect()));
});

const at = (i: number) => replicas[i % replicas.length]!;
const sql = () => replicas[0]!.prisma.client;
const COMMIT_ONLY: Actor = {
  kind: 'SERVICE',
  clientId: 'booking',
  scopes: ['scheduling.hold.commit'],
};

async function counters(windowId: string) {
  const [row] = await sql().$queryRawUnsafe<{ held: number; reserved: number }[]>(
    `SELECT held, reserved FROM app.capacity_window WHERE id = $1::uuid`,
    windowId,
  );
  return row!;
}

/** held = ACTIVE units and reserved = CONFIRMED units, for every given window. */
async function assertCountersMatchRows(...windowIds: string[]) {
  for (const windowId of windowIds) {
    const [row] = await sql().$queryRawUnsafe<
      { held: number; reserved: number; active: number; confirmed: number }[]
    >(
      `SELECT w.held, w.reserved,
              COALESCE(SUM(h.units) FILTER (WHERE h.status = 'ACTIVE'), 0)::int AS active,
              COALESCE(SUM(h.units) FILTER (WHERE h.status = 'CONFIRMED'), 0)::int AS confirmed
         FROM app.capacity_window w LEFT JOIN app.capacity_hold h ON h.window_id = w.id
        WHERE w.id = $1::uuid GROUP BY w.id`,
      windowId,
    );
    assert.equal(row!.held, row!.active, 'held = ACTIVE units');
    assert.equal(row!.reserved, row!.confirmed, 'reserved = CONFIRMED units');
  }
}

async function eventStates(holdId: string) {
  const rows = await sql().$queryRawUnsafe<{ payload: string }[]>(
    `SELECT payload FROM app.outbox_message
      WHERE event_type = 'scheduling.hold-changed.v1'
        AND (payload::jsonb -> 'aggregate' ->> 'id') = $1
      ORDER BY (payload::jsonb -> 'aggregate' ->> 'version')::int`,
    holdId,
  );
  return rows.map((r) => {
    const event = JSON.parse(r.payload) as {
      aggregate: { version: number };
      data: { state: string; bookingId: string | null };
    };
    return `${event.aggregate.version}:${event.data.state}:${event.data.bookingId ?? '-'}`;
  });
}

async function holdRow(id: string) {
  const [row] = await sql().$queryRawUnsafe<
    { status: string; release_reason: string | null; booking_id: string | null; version: number }[]
  >(
    `SELECT status, release_reason, booking_id::text, version FROM app.capacity_hold WHERE id = $1::uuid`,
    id,
  );
  return row!;
}

/** A committed booking: one principal, one hold, committed by Booking. */
async function committedBooking(window: { zoneId: string; startsAt: Date }, offsetMinutes = 0) {
  const who = principal();
  const created = holdOf(
    await at(0).holds.createHold(meta(who), holdRequestFor(who, window, 30, offsetMinutes), key()),
  );
  const bookingId = randomUUID();
  await at(1).holds.commitHold(
    meta(BOOKING),
    created.holdId,
    { expectedRevision: created.revision, bookingId },
    key(),
  );
  return { who, bookingId, holdId: created.holdId };
}

async function newHold(
  who: Extract<Actor, { kind: 'USER' }>,
  window: { zoneId: string; startsAt: Date },
  offsetMinutes = 0,
) {
  return holdOf(
    await at(2).holds.createHold(meta(who), holdRequestFor(who, window, 30, offsetMinutes), key()),
  );
}

test('cancellation gives the reserved unit back once, emits RELEASED, and replays by booking', async () => {
  const window = await defineWindow(at(0).capacity, clock, 2);
  const { bookingId, holdId } = await committedBooking(window);
  assert.deepEqual(await counters(window.id), { held: 0, reserved: 1 });

  const first = await at(0).commitments.releaseCommitment(
    meta(BOOKING),
    bookingId,
    { holdId },
    key(),
  );
  assert.equal(first.status, 200);
  assert.equal(holdOf(first).state, 'RELEASED');
  assert.equal(holdOf(first).bookingId, null, 'v1 view: bookingId only while COMMITTED');
  assert.deepEqual(await counters(window.id), { held: 0, reserved: 0 });
  const row = await holdRow(holdId);
  assert.deepEqual(
    [row.status, row.release_reason, row.booking_id],
    ['CANCELLED', 'BOOKING_CANCELLED', bookingId],
  );

  // Lost response, retried with a NEW key (record purged): a replay by booking.
  const again = await at(3).commitments.releaseCommitment(
    meta(BOOKING),
    bookingId,
    { holdId },
    key(),
  );
  assert.equal(holdOf(again).revision, holdOf(first).revision);
  assert.deepEqual(await counters(window.id), { held: 0, reserved: 0 }, 'freed exactly once');
  assert.deepEqual(await eventStates(holdId), [
    `1:HELD:-`,
    `2:COMMITTED:${bookingId}`,
    `3:RELEASED:-`,
  ]);
  await assertCountersMatchRows(window.id);
});

test('20 concurrent cancellations across 4 replicas free one unit and emit one event', async () => {
  const window = await defineWindow(at(0).capacity, clock, 3);
  const { bookingId, holdId } = await committedBooking(window);
  const shared = key();
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      at(i).commitments.releaseCommitment(
        meta(BOOKING),
        bookingId,
        { holdId },
        i % 2 ? shared : key(),
      ),
    ),
  );
  assert.ok(
    results.every((r) => r.status === 'fulfilled'),
    'every caller sees the released hold',
  );
  assert.deepEqual(await counters(window.id), { held: 0, reserved: 0 });
  assert.equal((await eventStates(holdId)).length, 3);
  await assertCountersMatchRows(window.id);
});

test('cancellation refuses a hold of another booking and a hold that was never committed', async () => {
  const window = await defineWindow(at(0).capacity, clock, 3);
  const { holdId } = await committedBooking(window);
  assert.equal(
    await errorCode(
      at(0).commitments.releaseCommitment(meta(BOOKING), randomUUID(), { holdId }, key()),
    ),
    'COMMITMENT_NOT_FOUND',
  );
  const who = principal();
  const loose = await newHold(who, window);
  assert.equal(
    await errorCode(
      at(0).commitments.releaseCommitment(
        meta(BOOKING),
        randomUUID(),
        { holdId: loose.holdId },
        key(),
      ),
    ),
    'COMMITMENT_NOT_FOUND',
  );
  assert.deepEqual(await counters(window.id), { held: 1, reserved: 1 }, 'nothing moved');
});

test('reschedule across windows moves exactly one unit: new held->reserved, old reserved freed', async () => {
  const zoneId = randomUUID();
  const early = await defineWindow(at(0).capacity, clock, 1, zoneId, 2 * 3_600_000);
  const late = await defineWindow(at(0).capacity, clock, 1, zoneId, 5 * 3_600_000);
  const { who, bookingId, holdId } = await committedBooking(early);
  const target = await newHold(who, late);
  assert.deepEqual(await counters(late.id), { held: 1, reserved: 0 });

  const response = await at(3).commitments.replaceCommitment(
    meta(BOOKING),
    bookingId,
    { fromHoldId: holdId, toHoldId: target.holdId, toExpectedRevision: target.revision },
    key(),
  );
  const body = response.body as {
    bookingId: string;
    released: { state: string; holdId: string };
    committed: { state: string; holdId: string; bookingId: string };
  };
  assert.equal(body.released.state, 'RELEASED');
  assert.equal(body.committed.state, 'COMMITTED');
  assert.equal(body.committed.bookingId, bookingId);
  assert.deepEqual(await counters(early.id), { held: 0, reserved: 0 });
  assert.deepEqual(await counters(late.id), { held: 0, reserved: 1 });
  assert.deepEqual((await holdRow(holdId)).release_reason, 'RESCHEDULED');
  assert.deepEqual(await eventStates(holdId), [
    '1:HELD:-',
    `2:COMMITTED:${bookingId}`,
    '3:RELEASED:-',
  ]);
  assert.deepEqual(await eventStates(target.holdId), ['1:HELD:-', `2:COMMITTED:${bookingId}`]);

  // The early slot's unit is genuinely free again for someone else.
  const other = principal();
  await at(1).holds.createHold(meta(other), holdRequestFor(other, early), key());
  await assertCountersMatchRows(early.id, late.id);

  // Lost response, replayed with a new key: the same answer, nothing moves again.
  const replay = await at(0).commitments.replaceCommitment(
    meta(BOOKING),
    bookingId,
    { fromHoldId: holdId, toHoldId: target.holdId, toExpectedRevision: target.revision },
    key(),
  );
  assert.deepEqual(replay.body, response.body);
  assert.deepEqual(await counters(late.id), { held: 0, reserved: 1 });
  assert.equal((await eventStates(target.holdId)).length, 2);
});

test('reschedule inside one window keeps capacity exact', async () => {
  const window = await defineWindow(at(0).capacity, clock, 2);
  const { who, bookingId, holdId } = await committedBooking(window, 0);
  const target = await newHold(who, window, 30);
  assert.deepEqual(await counters(window.id), { held: 1, reserved: 1 });
  await at(1).commitments.replaceCommitment(
    meta(BOOKING),
    bookingId,
    { fromHoldId: holdId, toHoldId: target.holdId, toExpectedRevision: target.revision },
    key(),
  );
  assert.deepEqual(await counters(window.id), { held: 0, reserved: 1 });
  await assertCountersMatchRows(window.id);
});

test('two concurrent reschedules of one booking to different holds: exactly one wins', async () => {
  const zoneId = randomUUID();
  const origin = await defineWindow(at(0).capacity, clock, 1, zoneId, 2 * 3_600_000);
  const a = await defineWindow(at(0).capacity, clock, 1, zoneId, 5 * 3_600_000);
  const b = await defineWindow(at(0).capacity, clock, 1, zoneId, 8 * 3_600_000);
  const { who, bookingId, holdId } = await committedBooking(origin);
  const toA = await newHold(who, a);
  const toB = await newHold(who, b);
  const results = await Promise.allSettled(
    [toA, toB].flatMap((target, i) =>
      Array.from({ length: 5 }, (_, j) =>
        at(i + j).commitments.replaceCommitment(
          meta(BOOKING),
          bookingId,
          { fromHoldId: holdId, toHoldId: target.holdId, toExpectedRevision: target.revision },
          key(),
        ),
      ),
    ),
  );
  const winners = new Set(
    results
      .filter(
        (r): r is PromiseFulfilledResult<{ status: number; body: unknown }> =>
          r.status === 'fulfilled',
      )
      .map((r) => (r.value.body as { committed: { holdId: string } }).committed.holdId),
  );
  assert.equal(winners.size, 1, 'one target wins; its own retries replay');
  const refused = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => (r.reason as { code?: string }).code);
  assert.ok(
    refused.length >= 5 && refused.every((c) => c === 'COMMITMENT_NOT_FOUND'),
    String(refused),
  );
  const [confirmed] = await sql().$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM app.capacity_hold WHERE booking_id = $1::uuid AND status = 'CONFIRMED'`,
    bookingId,
  );
  assert.equal(confirmed!.n, 1, 'one live commitment per booking');
  const loser = winners.has(toA.holdId) ? toB : toA;
  assert.equal((await holdRow(loser.holdId)).status, 'ACTIVE', "the loser's hold is untouched");
  await assertCountersMatchRows(origin.id, a.id, b.id);
});

test('reschedule racing a staff override of the old hold never leaves two commitments or a lost unit', async () => {
  const zoneId = randomUUID();
  const origin = await defineWindow(at(0).capacity, clock, 1, zoneId, 2 * 3_600_000);
  const later = await defineWindow(at(0).capacity, clock, 1, zoneId, 5 * 3_600_000);
  const { who, bookingId, holdId } = await committedBooking(origin);
  const target = await newHold(who, later);
  const [moved, overridden] = await Promise.allSettled([
    at(1).commitments.replaceCommitment(
      meta(BOOKING),
      bookingId,
      { fromHoldId: holdId, toHoldId: target.holdId, toExpectedRevision: target.revision },
      key(),
    ),
    at(2).capacity.overrideRelease(meta(OPS), holdId),
  ]);
  assert.equal(overridden.status, 'fulfilled');
  const origin_ = await holdRow(holdId);
  assert.equal(origin_.status, 'CANCELLED');
  if (moved.status === 'fulfilled') {
    assert.equal(
      origin_.release_reason,
      'RESCHEDULED',
      'the override found it already moved (no-op)',
    );
    assert.equal((await holdRow(target.holdId)).status, 'CONFIRMED');
  } else {
    assert.equal((moved.reason as { code?: string }).code, 'COMMITMENT_NOT_FOUND');
    assert.equal(origin_.release_reason, 'OPERATIONS_OVERRIDE');
    assert.equal((await holdRow(target.holdId)).status, 'ACTIVE');
  }
  await assertCountersMatchRows(origin.id, later.id);
});

test('an expired target hold: expiry is committed, HOLD_EXPIRED, the old commitment stays', async () => {
  const zoneId = randomUUID();
  const origin = await defineWindow(at(0).capacity, clock, 1, zoneId, 2 * 3_600_000);
  const later = await defineWindow(at(0).capacity, clock, 1, zoneId, 5 * 3_600_000);
  const { who, bookingId, holdId } = await committedBooking(origin);
  const target = await newHold(who, later);
  clock.advance(10 * 60_000);
  const idem = key();
  assert.equal(
    await errorCode(
      at(0).commitments.replaceCommitment(
        meta(BOOKING),
        bookingId,
        { fromHoldId: holdId, toHoldId: target.holdId, toExpectedRevision: target.revision },
        idem,
      ),
    ),
    'HOLD_EXPIRED',
  );
  assert.equal((await holdRow(target.holdId)).status, 'EXPIRED');
  assert.equal((await holdRow(holdId)).status, 'CONFIRMED', 'the booking keeps its slot');
  assert.deepEqual(await counters(later.id), { held: 0, reserved: 0 });
  assert.deepEqual(await counters(origin.id), { held: 0, reserved: 1 });
  // The failure is not cached: the same key is evaluated again and still refused.
  assert.equal(
    await errorCode(
      at(1).commitments.replaceCommitment(
        meta(BOOKING),
        bookingId,
        { fromHoldId: holdId, toHoldId: target.holdId, toExpectedRevision: target.revision },
        idem,
      ),
    ),
    'HOLD_EXPIRED',
  );
});

test('only the commitment-change scope may cancel or move a commitment', async () => {
  const window = await defineWindow(at(0).capacity, clock, 2);
  const { who, bookingId, holdId } = await committedBooking(window);
  const target = await newHold(who, window, 30);
  for (const actor of [COMMIT_ONLY, OPS, who] as const) {
    assert.equal(
      await errorCode(
        at(0).commitments.releaseCommitment(meta(actor), bookingId, { holdId }, key()),
      ),
      'FORBIDDEN',
    );
    assert.equal(
      await errorCode(
        at(0).commitments.replaceCommitment(
          meta(actor),
          bookingId,
          { fromHoldId: holdId, toHoldId: target.holdId, toExpectedRevision: target.revision },
          key(),
        ),
      ),
      'FORBIDDEN',
    );
  }
  assert.equal(
    await errorCode(
      at(0).commitments.releaseCommitment(meta(BOOKING), bookingId, { holdId }, undefined),
    ),
    'IDEMPOTENCY_KEY_REQUIRED',
  );
});

test('the database itself refuses a second CONFIRMED hold for one booking (runtime role)', async () => {
  const window = await defineWindow(at(0).capacity, clock, 3);
  const { who, bookingId } = await committedBooking(window);
  const other = await newHold(who, window, 30);
  await assert.rejects(
    sql().$executeRawUnsafe(
      `UPDATE app.capacity_hold SET status = 'CONFIRMED', booking_id = $2::uuid, version = version + 1
        WHERE id = $1::uuid`,
      other.holdId,
      bookingId,
    ),
    /capacity_hold_booking_confirmed_key|23505|unique/i,
  );
});
