import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BookingError,
  CHANGE_POLICY,
  assertChangeable,
  beginPivot,
  bookingCancelledEvent,
  bookingRescheduledEvent,
  cancelBooking,
  isPivotExit,
  newCancellation,
  newReschedule,
  onCapacityReleased,
  onConfirm,
  onDispatchCancel,
  onRebind,
  onReplace,
  onRevert,
  onSettled,
  rescheduleBooking,
  type Booking,
  type ChangeState,
} from '../../src/domain';

/** P04-C3 change saga decisions (pure). */
const T0 = new Date('2026-10-11T08:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const ID = {
  booking: '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e01',
  change: '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e02',
  hold: '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e03',
  newHold: '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e04',
  zone: '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e05',
  subject: '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e06',
  event: '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e07',
  correlation: '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e08',
};
const from = { holdId: ID.hold, zoneId: ID.zone, startsAt: at(180), endsAt: at(240) };
const to = {
  holdId: ID.newHold,
  zoneId: ID.zone,
  startsAt: at(360),
  endsAt: at(420),
  holdRevision: 1,
  expiresAt: at(10),
};
const requester = { kind: 'account' as const, subjectId: ID.subject };

const cancellation = () =>
  newCancellation({
    changeId: ID.change,
    bookingId: ID.booking,
    reason: 'CUSTOMER_REQUEST',
    requester,
    from,
    now: T0,
  });
const reschedule = () =>
  newReschedule({ changeId: ID.change, bookingId: ID.booking, requester, from, to, now: T0 });

function chain(start: ChangeState, ...steps: ((c: ChangeState) => ChangeState)[]): ChangeState {
  return steps.reduce((c, step) => step(c), start);
}

test('cancellation path: pivot, release, settle; settlement PENDING until Billing answers', () => {
  const done = chain(
    cancellation(),
    (c) => onDispatchCancel(c, { kind: 'CANCELLED' }, at(1), 0),
    (c) => onCapacityReleased(c, { kind: 'RELEASED' }, at(2), 0),
    (c) => {
      assert.equal(c.settlement, 'PENDING');
      return onSettled(c, { kind: 'SETTLED', settlement: 'REFUND_PENDING' }, at(3), 0);
    },
  );
  assert.deepEqual(
    [done.step, done.outcome, done.settlement],
    ['DONE', 'COMPLETED', 'REFUND_PENDING'],
  );
  assert.equal(done.completedAt?.toISOString(), at(3).toISOString());
  assert.equal(
    isPivotExit(cancellation(), onDispatchCancel(cancellation(), { kind: 'NOT_OPENED' }, at(1), 0)),
    true,
  );
});

test('cancellation refused by Dispatch ends REFUSED with no settlement; UNKNOWN only retries', () => {
  const refused = onDispatchCancel(
    cancellation(),
    { kind: 'REFUSED', reason: 'WORK_STARTED' },
    at(1),
    0,
  );
  assert.deepEqual(
    [refused.outcome, refused.refusal, refused.settlement],
    ['REFUSED', 'WORK_STARTED', null],
  );
  let c = cancellation();
  for (let i = 0; i < CHANGE_POLICY.attentionAfterAttempts; i += 1) {
    c = onDispatchCancel(c, { kind: 'UNKNOWN', error: 'TIMEOUT' }, at(i), 0.5);
    assert.equal(c.step, 'DISPATCH_CANCEL');
    assert.equal(c.outcome, null);
    assert.ok(c.nextAttemptAt.getTime() > at(i).getTime(), 'backoff, never a hot loop');
  }
  assert.equal(c.attention, true, 'operations are alerted, nothing is assumed');
  const released = onCapacityReleased(
    onDispatchCancel(c, { kind: 'CANCELLED' }, at(20), 0),
    { kind: 'NOT_COMMITTED' },
    at(21),
    0,
  );
  assert.deepEqual(
    [released.step, released.lastError, released.attention],
    ['SETTLE_BILLING', 'CAPACITY_NOT_COMMITTED', false],
  );
});

test('reschedule path and its compensation', () => {
  const rebound = onRebind(reschedule(), { kind: 'REBOUND' }, at(1), 0);
  assert.equal(rebound.step, 'REPLACE_COMMITMENT');
  assert.throws(
    () => onReplace(rebound, { kind: 'UNKNOWN', error: 'x' }, at(2), 0),
    /PIVOT_NOT_RECORDED/,
  );
  const pivoting = beginPivot(rebound, at(2));
  assert.equal(pivoting.pivotAttempted, true);
  assert.equal(beginPivot(pivoting, at(3)), pivoting);
  const lost = onReplace(pivoting, { kind: 'UNKNOWN', error: 'TIMEOUT' }, at(30), 0);
  assert.equal(lost.step, 'REPLACE_COMMITMENT', 'after the pivot: replay, no deadline');
  const replaced = onReplace(lost, { kind: 'REPLACED', slot: to }, at(31), 0);
  assert.equal(isPivotExit(lost, replaced), true);
  const done = onConfirm(replaced, { kind: 'CONFIRMED' }, at(32), 0);
  assert.deepEqual([done.outcome, done.refusal], ['COMPLETED', null]);

  const refused = onReplace(pivoting, { kind: 'REFUSED', reason: 'HOLD_EXPIRED' }, at(3), 0);
  assert.deepEqual([refused.step, refused.refusal], ['DISPATCH_REVERT', 'HOLD_EXPIRED']);
  const failed = onRevert(
    onRevert(refused, { kind: 'UNKNOWN', error: 'TIMEOUT' }, at(4), 0),
    { kind: 'REVERTED' },
    at(5),
    0,
  );
  assert.deepEqual([failed.outcome, failed.refusal], ['FAILED', 'HOLD_EXPIRED']);
});

test('before the pivot the new hold deadline ends the attempt with a revert', () => {
  const waiting = onRebind(reschedule(), { kind: 'NOT_READY' }, at(5), 0);
  assert.equal(waiting.step, 'DISPATCH_REBIND');
  const late = onRebind(waiting, { kind: 'NOT_READY' }, at(10), 0);
  assert.deepEqual([late.step, late.refusal], ['DISPATCH_REVERT', 'DISPATCH_NOT_READY']);
  const unknown = onRebind(reschedule(), { kind: 'UNKNOWN', error: 'TIMEOUT' }, at(11), 0);
  assert.deepEqual([unknown.step, unknown.refusal], ['DISPATCH_REVERT', 'HOLD_EXPIRED']);
  const refused = onRebind(reschedule(), { kind: 'REFUSED', reason: 'WORK_STARTED' }, at(1), 0);
  assert.deepEqual([refused.outcome, refused.refusal], ['REFUSED', 'WORK_STARTED']);
});

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: ID.booking,
    beneficiary: { kind: 'account', subjectId: ID.subject },
    status: 'CONFIRMED',
    rejectionReason: null,
    paymentMethod: 'SHAM_CASH',
    contact: { name: 'سارة', phone: '+963912345678', notes: null },
    vehicle: {} as Booking['vehicle'],
    address: {} as Booking['address'],
    quote: {} as Booking['quote'],
    requestedSlot: { ...from, holdRevision: 1 },
    slot: from,
    rescheduledSlot: null,
    scheduleRevision: 1,
    cancellation: null,
    total: { currency: 'SYP', amountMinor: 1_500_000n, scale: 2 },
    version: 2,
    createdAt: T0,
    updatedAt: T0,
    confirmedAt: T0,
    ...overrides,
  };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BookingError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

test('booking preconditions and transitions keep the original snapshot', () => {
  const ok = { expectedRevision: 2, changeOpen: false };
  assert.deepEqual(assertChangeable(booking(), ok), from);
  assert.equal(
    code(() => assertChangeable(booking({ status: 'PENDING_CONFIRMATION', slot: null }), ok)),
    'BOOKING_NOT_CONFIRMED',
  );
  assert.equal(
    code(() => assertChangeable(booking({ status: 'CANCELLED' }), ok)),
    'BOOKING_CANCELLED',
  );
  assert.equal(
    code(() => assertChangeable(booking(), { ...ok, changeOpen: true })),
    'CHANGE_IN_PROGRESS',
  );
  assert.equal(
    code(() => assertChangeable(booking(), { ...ok, expectedRevision: 1 })),
    'REVISION_CONFLICT',
  );

  const moved = rescheduleBooking(booking(), to, at(1));
  assert.deepEqual([moved.scheduleRevision, moved.version], [2, 3]);
  assert.deepEqual(moved.slot, from, 'the original slot never changes');
  assert.deepEqual(
    assertChangeable(moved, { expectedRevision: 3, changeOpen: false }).holdId,
    ID.newHold,
  );

  const cancelled = cancelBooking(moved, 'CUSTOMER_REQUEST', at(2));
  assert.deepEqual([cancelled.status, cancelled.version], ['CANCELLED', 4]);
  assert.equal(
    code(() => rescheduleBooking(cancelled, to, at(3))),
    'INVALID_TRANSITION',
  );
});

test('events carry ids, slots and money only; never contact data', () => {
  const cancelled = cancelBooking(booking(), 'CUSTOMER_REQUEST', at(2));
  const event = bookingCancelledEvent({
    eventId: ID.event,
    correlationId: ID.correlation,
    traceparent: null,
    booking: cancelled,
    change: cancellation(),
  });
  assert.equal(event.eventType, 'booking.cancelled.v1');
  assert.deepEqual(event.aggregate, { type: 'booking', id: ID.booking, version: 3 });
  assert.deepEqual(event.data.total, { currency: 'SYP', amountMinor: '1500000', scale: 2 });
  const moved = rescheduleBooking(booking(), to, at(1));
  const rescheduled = bookingRescheduledEvent({
    eventId: ID.event,
    correlationId: ID.correlation,
    traceparent: null,
    booking: moved,
    change: reschedule(),
  });
  assert.deepEqual(rescheduled.data.previous.holdId, ID.hold);
  assert.deepEqual(rescheduled.data.current.holdId, ID.newHold);
  for (const text of [JSON.stringify(event), JSON.stringify(rescheduled)]) {
    assert.equal(text.includes('سارة'), false);
    assert.equal(text.includes('+963912345678'), false);
  }
  assert.throws(() =>
    bookingCancelledEvent({
      eventId: ID.event,
      correlationId: ID.correlation,
      traceparent: null,
      booking: booking(),
      change: cancellation(),
    }),
  );
});
