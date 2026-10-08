import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBooking, newSaga, type Booking } from '../../src/domain';
import { sqlState } from '../../src/infrastructure/persistence/prisma-booking.store';
import type { RequestKey } from '../../src/ports';
import {
  CONTACT,
  addressSnapshot,
  principal,
  quoteSnapshot,
  requestedSlot,
  vehicleSnapshot,
} from '../support/fixtures';
import { owners, replica, type Harness } from './support';

/**
 * Database-level invariants, exercised directly with the RUNTIME role on the
 * real lane PostgreSQL. These hold even if application code is wrong.
 */
const h: Harness = replica(owners());
after(() => h.prisma.client.$disconnect());

const NOW = new Date();

function draft(): Booking {
  const beneficiary = principal();
  return createBooking({
    id: randomUUID(),
    beneficiary,
    paymentMethod: 'SYRIATEL_CASH',
    contact: CONTACT,
    vehicle: vehicleSnapshot(NOW),
    address: addressSnapshot(NOW),
    quote: quoteSnapshot(beneficiary, NOW),
    requestedSlot: requestedSlot(NOW),
    now: NOW,
  });
}

function requestKey(b: Booking): RequestKey {
  return {
    principalKind: b.beneficiary.kind,
    subject: b.beneficiary.subjectId,
    key: `k-${randomUUID()}`,
    fingerprint: 'f'.repeat(64),
  };
}

async function persisted(b: Booking = draft()): Promise<Booking> {
  const key = requestKey(b);
  const claim = await h.store.claimRequest(key, b.id, NOW, 30_000);
  assert.equal(claim.kind, 'NEW');
  if (claim.kind !== 'NEW') throw new Error('unreachable');
  const result = await h.store.insertBooking(
    b,
    newSaga(b.id, NOW),
    { key, fence: claim.fence },
    {
      action: 'booking.created',
      actor: { kind: 'SYSTEM', component: 'test' },
      bookingId: b.id,
      correlationId: randomUUID(),
      details: {},
    },
  );
  assert.equal(result, 'CREATED');
  return b;
}

async function sqlError(
  sql: string,
  ...params: unknown[]
): Promise<{ state: string | undefined; message: string }> {
  try {
    await h.prisma.client.$executeRawUnsafe(sql, ...params);
  } catch (error) {
    return {
      state: sqlState(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { state: 'OK', message: '' };
}

test('snapshots are immutable: contact, vehicle, address, quote, money and slot cannot be updated', async () => {
  const b = await persisted();
  for (const [column, value] of [
    ['contact', '{"name":"x","phone":"+963900000000","notes":null}'],
    ['vehicle_snapshot', '{}'],
    ['address_snapshot', '{}'],
    ['quote_snapshot', '{}'],
  ] as const) {
    const error = await sqlError(
      `UPDATE app.booking SET ${column} = $2::jsonb, version = version + 1 WHERE id = $1::uuid`,
      b.id,
      value,
    );
    assert.match(error.message, /BOOKING_SNAPSHOT_IMMUTABLE/, column);
  }
  for (const set of [
    'total_minor = 1',
    "payment_method = 'SHAM_CASH'",
    `hold_id = '${randomUUID()}'`,
    `principal_subject = '${randomUUID()}'`,
    'requested_starts_at = now()',
  ]) {
    const error = await sqlError(
      `UPDATE app.booking SET ${set}, version = version + 1 WHERE id = $1::uuid`,
      b.id,
    );
    assert.match(error.message, /BOOKING_SNAPSHOT_IMMUTABLE/, set);
  }
});

test('the version moves by exactly one, and bookings are never deleted', async () => {
  const b = await persisted();
  assert.match(
    (await sqlError(`UPDATE app.booking SET updated_at = now() WHERE id = $1::uuid`, b.id)).message,
    /BOOKING_VERSION_NOT_INCREMENTED/,
  );
  assert.match(
    (await sqlError(`UPDATE app.booking SET version = version + 2 WHERE id = $1::uuid`, b.id))
      .message,
    /BOOKING_VERSION_NOT_INCREMENTED/,
  );
  assert.match(
    (await sqlError(`DELETE FROM app.booking WHERE id = $1::uuid`, b.id)).message,
    /BOOKING_DELETE_FORBIDDEN/,
  );
});

test('status/slot/money/reason consistency is enforced by CHECK constraints', async () => {
  const b = await persisted();
  // CONFIRMED without the committed slot.
  assert.equal(
    (
      await sqlError(
        `UPDATE app.booking SET status = 'CONFIRMED', version = version + 1 WHERE id = $1::uuid`,
        b.id,
      )
    ).state,
    '23514',
  );
  // REJECTED without a reason, or with an unknown one.
  assert.equal(
    (
      await sqlError(
        `UPDATE app.booking SET status = 'REJECTED', version = version + 1 WHERE id = $1::uuid`,
        b.id,
      )
    ).state,
    '23514',
  );
  assert.equal(
    (
      await sqlError(
        `UPDATE app.booking SET status = 'REJECTED', rejection_reason = 'BECAUSE', version = version + 1 WHERE id = $1::uuid`,
        b.id,
      )
    ).state,
    '23514',
  );
  // A committed slot that differs from the requested one.
  assert.equal(
    (
      await sqlError(
        `UPDATE app.booking SET status = 'CONFIRMED', slot_starts_at = requested_starts_at + interval '1 hour',
           slot_ends_at = requested_ends_at + interval '1 hour', confirmed_at = now(), version = version + 1 WHERE id = $1::uuid`,
        b.id,
      )
    ).state,
    '23514',
  );
  // Saga: the pivot cannot be un-attempted by stepping back.
  assert.equal(
    (
      await sqlError(
        `UPDATE app.booking_saga SET pivot_attempted = true, step = 'VALIDATE_QUOTE' WHERE booking_id = $1::uuid`,
        b.id,
      )
    ).state,
    '23514',
  );
  assert.equal(
    (await sqlError(`UPDATE app.booking_saga SET step = 'DONE' WHERE booking_id = $1::uuid`, b.id))
      .state,
    '23514',
  );
});

test('one live booking per hold: a refused insert writes nothing', async () => {
  const a = await persisted();
  const sameHold = { ...draft(), requestedSlot: a.requestedSlot };
  const key = requestKey(sameHold);
  const claim = await h.store.claimRequest(key, sameHold.id, NOW, 30_000);
  if (claim.kind !== 'NEW') throw new Error('claim');
  const result = await h.store.insertBooking(
    sameHold,
    newSaga(sameHold.id, NOW),
    { key, fence: claim.fence },
    {
      action: 'booking.created',
      actor: { kind: 'SYSTEM', component: 'test' },
      bookingId: sameHold.id,
      correlationId: randomUUID(),
      details: {},
    },
  );
  assert.equal(result, 'HOLD_TAKEN');
  assert.equal(
    await h.store.find(sameHold.id),
    null,
    'nothing was written for the refused booking',
  );
});

test('runtime role: no DDL, cannot disable the guards, cannot read migration history', async () => {
  assert.equal(
    (await sqlError(`ALTER TABLE app.booking DISABLE TRIGGER booking_guard_immutable_update`))
      .state,
    '42501',
  );
  assert.equal(
    (await sqlError(`DROP TRIGGER booking_guard_immutable_delete ON app.booking`)).state,
    '42501',
  );
  assert.equal((await sqlError(`CREATE TABLE app.sneaky (id int)`)).state, '42501');
  assert.equal((await sqlError(`SELECT 1 FROM app._prisma_migrations`)).state, '42501');
});

test('idempotency claim: 20 concurrent claims of one key give one owner; a crashed owner is taken over and fenced off', async () => {
  const b = draft();
  const key = requestKey(b);
  const claims = await Promise.all(
    Array.from({ length: 20 }, () => h.store.claimRequest(key, randomUUID(), NOW, 1_000)),
  );
  const owner = claims.filter((c) => c.kind === 'NEW');
  assert.equal(owner.length, 1);
  assert.ok(claims.every((c) => c.kind === 'NEW' || c.kind === 'IN_PROGRESS'));
  const first = owner[0]!;
  if (first.kind !== 'NEW') throw new Error('unreachable');
  // The owner "crashes"; after its lease another request takes the claim over.
  const later = new Date(NOW.getTime() + 1_001);
  const taken = await h.store.claimRequest(key, randomUUID(), later, 1_000);
  assert.equal(taken.kind, 'TAKEN_OVER');
  if (taken.kind !== 'TAKEN_OVER') throw new Error('unreachable');
  assert.equal(taken.bookingId, first.bookingId, 'the booking id is stable across takeover');
  assert.equal(taken.fence, first.fence + 1);
  const booking = { ...b, id: first.bookingId };
  const audit = {
    action: 'booking.created',
    actor: { kind: 'SYSTEM', component: 'test' } as const,
    bookingId: booking.id,
    correlationId: randomUUID(),
    details: {},
  };
  // The crashed owner wakes up: its stale fence can no longer bind a booking.
  assert.equal(
    await h.store.insertBooking(
      booking,
      newSaga(booking.id, NOW),
      { key, fence: first.fence },
      audit,
    ),
    'CLAIM_LOST',
  );
  assert.equal(
    await h.store.insertBooking(
      booking,
      newSaga(booking.id, NOW),
      { key, fence: taken.fence },
      audit,
    ),
    'CREATED',
  );
  const replay = await h.store.claimRequest(key, randomUUID(), later, 1_000);
  assert.deepEqual(replay, { kind: 'BOUND', bookingId: booking.id });
  assert.equal(
    (
      await h.store.claimRequest(
        { ...key, fingerprint: 'e'.repeat(64) },
        randomUUID(),
        later,
        1_000,
      )
    ).kind,
    'CONFLICT',
  );
});

test('exact money and snapshots survive the round trip byte for byte', async () => {
  const b = draft();
  const big = {
    ...b,
    quote: {
      ...b.quote,
      total: { ...b.quote.total, amountMinor: 999_999_999_999_999_999n },
      lines: b.quote.lines.map((l) => ({
        ...l,
        unitPrice: { ...l.unitPrice, amountMinor: 999_999_999_999_999_999n },
        amount: { ...l.amount, amountMinor: 999_999_999_999_999_999n },
      })),
    },
  };
  const stored = await persisted({ ...big, total: big.quote.total });
  const found = await h.store.find(stored.id);
  assert.ok(found);
  assert.equal(found.booking.total.amountMinor, 999_999_999_999_999_999n);
  assert.equal(found.booking.quote.lines[0]?.amount.amountMinor, 999_999_999_999_999_999n);
  assert.deepEqual(found.booking.contact, CONTACT);
  assert.deepEqual(found.booking.vehicle, stored.vehicle);
  assert.deepEqual(found.booking.address, stored.address);
  assert.equal(found.saga.version, 1);
  assert.equal(found.booking.version, 1);
});
