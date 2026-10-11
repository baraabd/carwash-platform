import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DispatchError,
  arrive,
  assertChangeable,
  assertSameChange,
  cancel,
  confirmBinding,
  createTask,
  decideHoldChange,
  depart,
  markOffered,
  openAssignment,
  rebind,
  revertBinding,
  withdrawTask,
  workProgress,
  type BookingChange,
} from '../../src/domain';

/** P04-C2 domain rules: the work-progress gate and the rebind lifecycle. */
const T0 = new Date('2026-10-11T08:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const ID = {
  assignment: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e12',
  booking: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e14',
  hold: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e15',
  newHold: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e16',
  zone: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e17',
  change: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e18',
  other: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e19',
};

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DispatchError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

const job = () =>
  openAssignment({
    id: ID.assignment,
    bookingId: ID.booking,
    holdId: ID.hold,
    zoneId: ID.zone,
    startsAt: at(120),
    endsAt: at(180),
    now: T0,
  });

const task = () =>
  createTask({
    id: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e1a',
    assignmentId: ID.assignment,
    offerId: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e1b',
    bookingId: ID.booking,
    resourceId: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e1c',
    technicianSubject: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e1d',
    now: T0,
  });

test('work progress: no task or ACCEPTED is changeable; in the field or CLOSED is not', () => {
  assert.equal(workProgress(null), 'NOT_STARTED');
  assert.equal(workProgress(task()), 'NOT_STARTED');
  const enRoute = depart(task(), at(1));
  assert.equal(workProgress(enRoute), 'STARTED');
  assert.equal(workProgress(arrive(enRoute, at(2))), 'STARTED');
  assert.equal(
    code(() => assertChangeable(null)),
    'NO_ERROR',
  );
  assert.equal(
    code(() => assertChangeable(task())),
    'NO_ERROR',
  );
  assert.equal(
    code(() => assertChangeable(enRoute)),
    'WORK_STARTED',
  );
  const closed = { ...task(), stage: 'CLOSED' as const };
  assert.equal(
    code(() => assertChangeable(closed)),
    'WORK_COMPLETED',
  );
  assert.equal(
    withdrawTask(task(), 'JOB_RESCHEDULED', at(3)).endReason,
    'JOB_RESCHEDULED',
    'a not-started task ends as rescheduled',
  );
});

test('rebind moves the job to the new slot, unassigned and pending; offers are blocked', () => {
  const rebound = rebind(job(), {
    changeId: ID.change,
    holdId: ID.newHold,
    startsAt: at(300),
    endsAt: at(360),
    now: at(5),
  });
  assert.equal(rebound.status, 'UNASSIGNED');
  assert.equal(rebound.holdId, ID.newHold);
  assert.equal(rebound.pendingChangeId, ID.change);
  assert.equal(rebound.version, 2);
  assert.equal(
    code(() => markOffered(rebound, at(6))),
    'RESCHEDULE_PENDING',
  );
  assert.equal(
    code(() =>
      rebind(rebound, {
        changeId: ID.other,
        holdId: ID.hold,
        startsAt: at(400),
        endsAt: at(460),
        now: at(7),
      }),
    ),
    'RESCHEDULE_PENDING',
  );
  const confirmed = confirmBinding(rebound, ID.change, at(8));
  assert.equal(confirmed.pendingChangeId, null);
  assert.equal(confirmed.version, 3);
  assert.equal(confirmBinding(confirmed, ID.change, at(9)), confirmed, 'confirm is idempotent');
  assert.equal(markOffered(confirmed, at(10)).status, 'OFFERED');
});

test('revert restores the original slot; a foreign change id is a no-op; cancel clears pending', () => {
  const original = job();
  const rebound = rebind(original, {
    changeId: ID.change,
    holdId: ID.newHold,
    startsAt: at(300),
    endsAt: at(360),
    now: at(5),
  });
  const slot = { holdId: original.holdId, startsAt: original.startsAt, endsAt: original.endsAt };
  assert.equal(revertBinding(rebound, ID.other, slot, at(6)), rebound);
  const reverted = revertBinding(rebound, ID.change, slot, at(6));
  assert.deepEqual(
    [reverted.holdId, reverted.startsAt, reverted.endsAt, reverted.pendingChangeId],
    [original.holdId, original.startsAt, original.endsAt, null],
  );
  const cancelled = cancel(rebound, 'BOOKING_CANCELLED', at(7));
  assert.deepEqual(
    [cancelled.status, cancelled.cancelReason, cancelled.pendingChangeId],
    ['CANCELLED', 'BOOKING_CANCELLED', null],
  );
  assert.equal(
    code(() =>
      rebind(cancelled, {
        changeId: ID.other,
        holdId: ID.newHold,
        startsAt: at(300),
        endsAt: at(360),
        now: at(8),
      }),
    ),
    'ASSIGNMENT_CANCELLED',
  );
});

test('a change id is bound to one booking and one kind', () => {
  const change: BookingChange = {
    changeId: ID.change,
    bookingId: ID.booking,
    kind: 'CANCELLATION',
    state: 'CANCELLED',
    assignmentId: ID.assignment,
    from: null,
    to: null,
    createdAt: T0,
    updatedAt: T0,
  };
  assert.equal(
    code(() => assertSameChange(change, ID.booking, 'CANCELLATION')),
    'NO_ERROR',
  );
  assert.equal(
    code(() => assertSameChange(change, ID.other, 'CANCELLATION')),
    'CHANGE_MISMATCH',
  );
  assert.equal(
    code(() => assertSameChange(change, ID.booking, 'REBIND')),
    'CHANGE_MISMATCH',
  );
});

test('hold decisions are unchanged: the binding check lives in the handler', () => {
  assert.equal(decideHoldChange(null, { version: 2, state: 'COMMITTED' }), 'OPEN');
  assert.equal(decideHoldChange(null, { version: 2, state: 'EXPIRED' }), 'CANCEL');
  assert.equal(
    decideHoldChange(
      { holdId: ID.hold, version: 3, state: 'RELEASED' },
      { version: 2, state: 'COMMITTED' },
    ),
    'STALE',
  );
});
