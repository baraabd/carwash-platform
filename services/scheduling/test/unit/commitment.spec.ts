import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SchedulingError,
  holdChangedEvent,
  releaseCommitment,
  replaceCommitment,
  type HoldState,
} from '../../src/domain';

/** P04-C1 domain rules for changing a committed booking (pure, no I/O). */
const NOW = new Date('2026-10-11T08:00:00.000Z');
const HOUR = 3_600_000;
const BOOKING = '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0009';
const OTHER_BOOKING = '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a000a';
const SUBJECT = '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0004';

function hold(overrides: Partial<HoldState> = {}): HoldState {
  return {
    id: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0003',
    windowId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0001',
    zoneId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0002',
    beneficiaryKind: 'guest',
    beneficiarySubject: SUBJECT,
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

const committed = (overrides: Partial<HoldState> = {}) =>
  hold({ status: 'CONFIRMED', bookingId: BOOKING, version: 2, ...overrides });
const fresh = (overrides: Partial<HoldState> = {}) =>
  hold({
    id: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0006',
    slotStartsAt: new Date(NOW.getTime() + 5 * HOUR),
    slotEndsAt: new Date(NOW.getTime() + 5 * HOUR + 45 * 60_000),
    ...overrides,
  });

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SchedulingError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

test('releaseCommitment cancels the committed hold of the booking once; a repeat is a replay', () => {
  const first = releaseCommitment(committed(), { bookingId: BOOKING, now: NOW });
  assert.equal(first.replay, false);
  assert.equal(first.hold.status, 'CANCELLED');
  assert.equal(first.hold.releaseReason, 'BOOKING_CANCELLED');
  assert.equal(first.hold.bookingId, BOOKING, 'the booking stays on the row as history');
  assert.equal(first.hold.version, 3);
  const again = releaseCommitment(first.hold, { bookingId: BOOKING, now: NOW });
  assert.equal(again.replay, true);
  assert.equal(again.hold, first.hold, 'nothing changes on replay');
});

test('a commitment already given back by a staff override is a replay, not a second release', () => {
  const overridden = committed({ status: 'CANCELLED', releaseReason: 'OPERATIONS_OVERRIDE' });
  assert.equal(releaseCommitment(overridden, { bookingId: BOOKING, now: NOW }).replay, true);
});

test('releaseCommitment refuses holds that are not committed to this booking', () => {
  const now = NOW;
  assert.equal(
    code(() => releaseCommitment(committed(), { bookingId: OTHER_BOOKING, now })),
    'COMMITMENT_NOT_FOUND',
  );
  for (const status of ['ACTIVE', 'RELEASED', 'EXPIRED'] as const) {
    assert.equal(
      code(() => releaseCommitment(hold({ status }), { bookingId: BOOKING, now })),
      'COMMITMENT_NOT_FOUND',
      status,
    );
  }
});

test('replaceCommitment moves the booking to the new hold in one decision', () => {
  const result = replaceCommitment(committed(), fresh(), {
    bookingId: BOOKING,
    expectedRevision: 1,
    now: NOW,
  });
  assert.equal(result.replay, false);
  assert.equal(result.from.status, 'CANCELLED');
  assert.equal(result.from.releaseReason, 'RESCHEDULED');
  assert.equal(result.from.version, 3);
  assert.equal(result.to.status, 'CONFIRMED');
  assert.equal(result.to.bookingId, BOOKING);
  assert.equal(result.to.version, 2);
  // On the published event, the old hold is RELEASED (no booking), the new one COMMITTED.
  const released = holdChangedEvent({
    eventId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0010',
    correlationId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0011',
    hold: result.from,
    zoneId: result.from.zoneId,
    actor: { kind: 'service', id: 'booking' },
  });
  assert.deepEqual([released.data.state, released.data.bookingId], ['RELEASED', null]);
  const replay = replaceCommitment(result.from, result.to, {
    bookingId: BOOKING,
    expectedRevision: 1,
    now: NOW,
  });
  assert.equal(replay.replay, true);
});

test('replaceCommitment refusals: not committed, other beneficiary, expired, stale revision, same hold', () => {
  const input = { bookingId: BOOKING, expectedRevision: 1, now: NOW };
  assert.equal(
    code(() => replaceCommitment(hold(), fresh(), input)),
    'COMMITMENT_NOT_FOUND',
  );
  assert.equal(
    code(() => replaceCommitment(committed({ bookingId: OTHER_BOOKING }), fresh(), input)),
    'COMMITMENT_NOT_FOUND',
  );
  assert.equal(
    code(() =>
      replaceCommitment(
        committed({ status: 'CANCELLED', releaseReason: 'OPERATIONS_OVERRIDE' }),
        fresh(),
        input,
      ),
    ),
    'COMMITMENT_NOT_FOUND',
    'a booking whose slot operations cancelled cannot be moved',
  );
  assert.equal(
    code(() =>
      replaceCommitment(
        committed(),
        fresh({ beneficiarySubject: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a00ff' }),
        input,
      ),
    ),
    'HOLD_NOT_FOUND',
    "another principal's hold is reported as absent",
  );
  assert.equal(
    code(() => replaceCommitment(committed(), fresh({ beneficiaryKind: 'account' }), input)),
    'HOLD_NOT_FOUND',
  );
  assert.equal(
    code(() => replaceCommitment(committed(), fresh({ expiresAt: NOW }), input)),
    'HOLD_EXPIRED',
  );
  assert.equal(
    code(() => replaceCommitment(committed(), fresh({ status: 'RELEASED' }), input)),
    'HOLD_NOT_ACTIVE',
  );
  assert.equal(
    code(() =>
      replaceCommitment(
        committed(),
        fresh({ status: 'CONFIRMED', bookingId: OTHER_BOOKING }),
        input,
      ),
    ),
    'HOLD_NOT_ACTIVE',
    'a hold committed to another booking is not available',
  );
  assert.equal(
    code(() => replaceCommitment(committed(), fresh({ version: 2 }), input)),
    'VERSION_CONFLICT',
  );
  assert.equal(
    code(() => replaceCommitment(committed(), committed(), input)),
    'INVALID_INPUT',
  );
});

test('the hold a booking was moved away from can no longer be released for it', () => {
  const { from } = replaceCommitment(committed(), fresh(), {
    bookingId: BOOKING,
    expectedRevision: 1,
    now: NOW,
  });
  assert.equal(
    code(() => releaseCommitment(from, { bookingId: BOOKING, now: NOW })),
    'COMMITMENT_NOT_FOUND',
  );
});
