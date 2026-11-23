import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLD_LIMITS,
  SchedulingError,
  assertDurationMinutes,
  assertWindowDefinition,
  changeCapacity,
  closeWindow,
  commit,
  convertHeldToReserved,
  expire,
  holdChangedEvent,
  holdUnits,
  isDue,
  localDateOf,
  nextLocalDate,
  releaseByBeneficiary,
  releaseByOperations,
  releaseHeldUnits,
  startOfLocalDay,
  v1State,
  type CapacityWindowState,
  type HoldState,
} from '../../src/domain';

const NOW = new Date('2026-10-07T08:00:00.000Z');
const HOUR = 3_600_000;
const BOOKING = '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0009';
const OTHER_BOOKING = '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a000a';

function window(overrides: Partial<CapacityWindowState> = {}): CapacityWindowState {
  return {
    id: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0001',
    zoneId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0002',
    startsAt: new Date(NOW.getTime() + 2 * HOUR),
    endsAt: new Date(NOW.getTime() + 3 * HOUR),
    capacity: 2,
    held: 0,
    reserved: 0,
    status: 'OPEN',
    version: 1,
    ...overrides,
  };
}

function hold(overrides: Partial<HoldState> = {}): HoldState {
  return {
    id: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0003',
    windowId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0001',
    zoneId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0002',
    beneficiaryKind: 'guest',
    beneficiarySubject: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0004',
    quoteId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0005',
    quoteRevision: 1,
    slotStartsAt: new Date(NOW.getTime() + 2 * HOUR),
    slotEndsAt: new Date(NOW.getTime() + 2 * HOUR + 45 * 60_000),
    units: 1,
    status: 'ACTIVE',
    expiresAt: new Date(NOW.getTime() + 600_000),
    bookingId: null,
    releaseReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SchedulingError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

test('window definition rejects past, too short, too long and oversized windows', () => {
  const ok = { startsAt: window().startsAt, endsAt: window().endsAt, capacity: 3, now: NOW };
  assert.doesNotThrow(() => assertWindowDefinition(ok));
  assert.equal(
    code(() => assertWindowDefinition({ ...ok, startsAt: new Date(NOW.getTime() - 1) })),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => assertWindowDefinition({ ...ok, endsAt: new Date(ok.startsAt.getTime() + 60_000) })),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => assertWindowDefinition({ ...ok, capacity: 501 })),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => assertWindowDefinition({ ...ok, startsAt: new Date(Number.NaN) })),
    'INVALID_INPUT',
  );
});

test('the last unit can be held once and never twice; a started slot is refused', () => {
  const one = holdUnits(window({ capacity: 1 }), 1, NOW);
  assert.equal(one.held, 1);
  assert.equal(
    code(() => holdUnits(one, 1, NOW)),
    'CAPACITY_EXHAUSTED',
  );
  assert.equal(
    code(() => holdUnits(closeWindow(window()), 1, NOW)),
    'WINDOW_CLOSED',
  );
  // A slot later inside the window is judged by ITS start, not the window's.
  const started = window({ startsAt: new Date(NOW.getTime() - HOUR) });
  assert.equal(holdUnits(started, 1, NOW, new Date(NOW.getTime() + HOUR)).held, 1);
  assert.equal(
    code(() => holdUnits(started, 1, NOW, NOW)),
    'WINDOW_STARTED',
  );
});

test('capacity cannot drop below what is held or reserved; counters never go negative', () => {
  const busy = window({ capacity: 5, held: 2, reserved: 2 });
  assert.equal(changeCapacity(busy, 4).capacity, 4);
  assert.equal(
    code(() => changeCapacity(busy, 3)),
    'CAPACITY_BELOW_COMMITTED',
  );
  assert.throws(() => releaseHeldUnits(window({ held: 0 }), 1), /HELD_UNDERFLOW/);
  assert.throws(() => convertHeldToReserved(window({ held: 0 }), 1), /HELD_UNDERFLOW/);
});

test('slot duration follows scheduling.v1 bounds (5..480 minutes)', () => {
  assert.doesNotThrow(() => assertDurationMinutes(5));
  assert.doesNotThrow(() => assertDurationMinutes(480));
  for (const bad of [4, 481, 30.5, Number.NaN]) {
    assert.equal(
      code(() => assertDurationMinutes(bad)),
      'INVALID_INPUT',
    );
  }
  assert.equal(HOLD_LIMITS.ttlSeconds, 600);
});

test('internal status maps onto the four published v1 states', () => {
  assert.equal(v1State(hold()), 'HELD');
  assert.equal(v1State(hold({ status: 'CONFIRMED', bookingId: BOOKING })), 'COMMITTED');
  assert.equal(v1State(hold({ status: 'EXPIRED' })), 'EXPIRED');
  assert.equal(
    v1State(hold({ status: 'RELEASED', releaseReason: 'CUSTOMER_CHANGED' })),
    'RELEASED',
  );
  assert.equal(
    v1State(
      hold({ status: 'CANCELLED', bookingId: BOOKING, releaseReason: 'OPERATIONS_OVERRIDE' }),
    ),
    'RELEASED',
  );
});

test('a hold is due exactly at its deadline, by the injected clock', () => {
  const h = hold();
  assert.equal(isDue(h, new Date(h.expiresAt.getTime() - 1)), false);
  assert.equal(isDue(h, h.expiresAt), true);
  assert.equal(expire(h, h.expiresAt).status, 'EXPIRED');
  assert.throws(() => expire(h, NOW), /HOLD_NOT_DUE/);
});

test('commit: revision-checked once, then a replay for the same booking only', () => {
  const first = commit(hold(), { bookingId: BOOKING, expectedRevision: 1, now: NOW });
  assert.equal(first.replay, false);
  assert.equal(first.hold.status, 'CONFIRMED');
  assert.equal(first.hold.bookingId, BOOKING);
  assert.equal(first.hold.version, 2);
  // Same booking again, even with the old revision: the same answer, no change.
  const again = commit(first.hold, { bookingId: BOOKING, expectedRevision: 1, now: NOW });
  assert.equal(again.replay, true);
  assert.equal(again.hold, first.hold);
  assert.equal(
    code(() => commit(first.hold, { bookingId: OTHER_BOOKING, expectedRevision: 2, now: NOW })),
    'HOLD_NOT_ACTIVE',
  );
  assert.equal(
    code(() => commit(hold(), { bookingId: BOOKING, expectedRevision: 2, now: NOW })),
    'VERSION_CONFLICT',
  );
});

test('commit reports HOLD_EXPIRED at the deadline and for an already expired hold', () => {
  const h = hold();
  assert.equal(
    code(() => commit(h, { bookingId: BOOKING, expectedRevision: 1, now: h.expiresAt })),
    'HOLD_EXPIRED',
  );
  assert.equal(
    code(() =>
      commit(hold({ status: 'EXPIRED', version: 2 }), {
        bookingId: BOOKING,
        expectedRevision: 2,
        now: NOW,
      }),
    ),
    'HOLD_EXPIRED',
  );
  assert.equal(
    code(() =>
      commit(hold({ status: 'RELEASED', releaseReason: 'CUSTOMER_CHANGED', version: 2 }), {
        bookingId: BOOKING,
        expectedRevision: 2,
        now: NOW,
      }),
    ),
    'HOLD_NOT_ACTIVE',
  );
  // One millisecond before the deadline the hold still commits.
  const edge = new Date(h.expiresAt.getTime() - 1);
  assert.equal(
    commit(h, { bookingId: BOOKING, expectedRevision: 1, now: edge }).hold.status,
    'CONFIRMED',
  );
});

test('beneficiary release: only a live held hold, only principal reasons', () => {
  const released = releaseByBeneficiary(hold(), {
    reason: 'CUSTOMER_CHANGED',
    expectedRevision: 1,
    now: NOW,
  });
  assert.equal(released.freed, 'HELD');
  assert.equal(released.hold.status, 'RELEASED');
  assert.equal(released.hold.releaseReason, 'CUSTOMER_CHANGED');
  assert.equal(
    code(() =>
      releaseByBeneficiary(hold(), {
        reason: 'OPERATIONS_OVERRIDE',
        expectedRevision: 1,
        now: NOW,
      }),
    ),
    'INVALID_INPUT',
  );
  const committed = hold({ status: 'CONFIRMED', bookingId: BOOKING, version: 2 });
  assert.equal(
    code(() =>
      releaseByBeneficiary(committed, { reason: 'BOOKING_FAILED', expectedRevision: 2, now: NOW }),
    ),
    'HOLD_NOT_ACTIVE',
    'a committed hold belongs to its booking now',
  );
  assert.equal(
    code(() =>
      releaseByBeneficiary(hold(), {
        reason: 'BOOKING_FAILED',
        expectedRevision: 1,
        now: hold().expiresAt,
      }),
    ),
    'HOLD_EXPIRED',
  );
  assert.equal(
    code(() =>
      releaseByBeneficiary(hold(), { reason: 'BOOKING_FAILED', expectedRevision: 9, now: NOW }),
    ),
    'VERSION_CONFLICT',
  );
});

test('operations override frees held or reserved units; terminal holds are untouched', () => {
  assert.equal(releaseByOperations(hold(), NOW)?.freed, 'HELD');
  const cancelled = releaseByOperations(
    hold({ status: 'CONFIRMED', bookingId: BOOKING, version: 2 }),
    NOW,
  );
  assert.equal(cancelled?.freed, 'RESERVED');
  assert.equal(cancelled?.hold.status, 'CANCELLED');
  assert.equal(cancelled?.hold.bookingId, BOOKING, 'the booking reference is kept for audit');
  assert.equal(releaseByOperations(hold({ status: 'EXPIRED' }), NOW), null);
});

test('hold-changed events follow envelope v2 and bind bookingId to COMMITTED only', () => {
  const ids = {
    eventId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0010',
    correlationId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0011',
  };
  const committed = commit(hold(), { bookingId: BOOKING, expectedRevision: 1, now: NOW }).hold;
  const event = holdChangedEvent({
    ...ids,
    hold: committed,
    zoneId: committed.zoneId,
    actor: { kind: 'service', id: 'booking' },
  });
  assert.deepEqual(Object.keys(event).sort(), [
    'actor',
    'aggregate',
    'causationId',
    'correlationId',
    'data',
    'envelopeVersion',
    'eventId',
    'eventType',
    'occurredAt',
    'producer',
    'traceparent',
  ]);
  assert.deepEqual(event.aggregate, { type: 'hold', id: committed.id, version: 2 });
  assert.deepEqual(event.data, {
    state: 'COMMITTED',
    zoneId: committed.zoneId,
    startsAt: committed.slotStartsAt.toISOString(),
    endsAt: committed.slotEndsAt.toISOString(),
    bookingId: BOOKING,
  });
  const cancelled = releaseByOperations(committed, NOW)!.hold;
  const released = holdChangedEvent({
    ...ids,
    hold: cancelled,
    zoneId: cancelled.zoneId,
    actor: { kind: 'system', id: null },
  });
  assert.equal(released.data.state, 'RELEASED');
  assert.equal(released.data.bookingId, null);
  assert.throws(
    () =>
      holdChangedEvent({
        ...ids,
        eventId: 'nope',
        hold: committed,
        zoneId: committed.zoneId,
        actor: { kind: 'system', id: null },
      }),
    /INVALID_EVENT_UUID/,
  );
});

test('civil days are computed in Asia/Damascus from the IANA database', () => {
  // Syria observes UTC+3 all year since 2022.
  assert.equal(startOfLocalDay('2026-10-08').toISOString(), '2026-10-07T21:00:00.000Z');
  assert.equal(localDateOf(new Date('2026-10-07T20:59:59.999Z')), '2026-10-07');
  assert.equal(localDateOf(new Date('2026-10-07T21:00:00.000Z')), '2026-10-08');
  assert.equal(nextLocalDate('2026-12-31'), '2027-01-01');
  assert.equal(
    code(() => startOfLocalDay('2026-02-30')),
    'INVALID_INPUT',
  );
});
