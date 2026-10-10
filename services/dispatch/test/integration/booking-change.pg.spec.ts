import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../../src/ports';
import {
  BOOKING,
  OPS,
  TestClock,
  deliver,
  errorCode,
  holdChangedEvent,
  holdSpec,
  key,
  meta,
  openJob,
  replica,
  technician,
  type HoldSpec,
  type Replica,
} from './support';

/**
 * P04-C2 booking changes on real PostgreSQL 16 (lane stack, RUNTIME role),
 * two connection pools as two replicas. Workforce and Media are the declared
 * in-process doubles of their ports; row locks, advisory locks, partial
 * unique indexes, CHECKs, outbox and audit rows are real.
 */
const clock = new TestClock();
let a: Replica;
let b: Replica;

before(() => {
  a = replica(clock);
  b = replica(clock);
});

after(async () => {
  await a.prisma.client.$disconnect();
  await b.prisma.client.$disconnect();
});

type Tech = ReturnType<typeof technician>;

async function q<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return a.prisma.client.$queryRawUnsafe<T[]>(sql, ...params);
}

async function assignmentRow(bookingId: string) {
  const [row] = await q<{
    id: string;
    status: string;
    hold_id: string;
    cancel_reason: string | null;
    pending_change_id: string | null;
    version: number;
    starts_at: Date;
  }>(
    `SELECT id::text, status, hold_id::text, cancel_reason, pending_change_id::text, version, starts_at
       FROM app.assignment WHERE booking_id = $1::uuid`,
    bookingId,
  );
  return row ?? null;
}

async function taskRow(taskId: string) {
  const [row] = await q<{ stage: string; end_reason: string | null }>(
    `SELECT stage, end_reason FROM app.task WHERE id = $1::uuid`,
    taskId,
  );
  return row!;
}

async function offerStatus(offerId: string) {
  const [row] = await q<{ status: string; withdraw_reason: string | null }>(
    `SELECT status, withdraw_reason FROM app.dispatch_offer WHERE id = $1::uuid`,
    offerId,
  );
  return row!;
}

async function accepted(tech: Tech = technician(), startOffsetMs?: number) {
  const { assignment, hold } = await openJob(a, clock, startOffsetMs);
  const { value } = await a.service.offer(
    meta(OPS),
    assignment.id,
    {
      expectedRevision: assignment.version,
      resourceId: randomUUID(),
      technicianSubject: tech.subject,
    },
    key(),
  );
  const offerId = value.offer!.id;
  const done = await a.service.acceptOffer(meta(tech), offerId, key());
  return { hold, assignmentId: assignment.id, offerId, task: done.value.task!, tech };
}

function laterSlot(hold: HoldSpec, hours = 3) {
  return {
    holdId: randomUUID(),
    zoneId: hold.zoneId,
    startsAt: new Date(hold.startsAt.getTime() + hours * 3_600_000),
    endsAt: new Date(hold.endsAt.getTime() + hours * 3_600_000),
  };
}

// ------------------------------------------------------------- cancellation

test('cancellation before the job exists leaves a tombstone: a late COMMITTED opens nothing', async () => {
  const hold = holdSpec(clock);
  const changeId = randomUUID();
  const view = await a.changes.cancel(meta(BOOKING), hold.bookingId, { changeId }, key());
  assert.deepEqual(view, {
    bookingId: hold.bookingId,
    changeId,
    outcome: 'NOT_OPENED',
    assignmentRevision: null,
  });
  const late = await deliver(b, holdChangedEvent(hold, 2, 'COMMITTED'));
  assert.equal(late.effect, 'SUPPRESSED_CANCELLED');
  assert.equal(await assignmentRow(hold.bookingId), null, 'no job is ever opened');
});

test('cancellation of an open job: offer withdrawn, accepted task cancelled, technician refused after', async () => {
  const job = await accepted();
  const changeId = randomUUID();
  const view = await a.changes.cancel(meta(BOOKING), job.hold.bookingId, { changeId }, key());
  assert.equal(view.outcome, 'CANCELLED');
  const row = (await assignmentRow(job.hold.bookingId))!;
  assert.deepEqual([row.status, row.cancel_reason], ['CANCELLED', 'BOOKING_CANCELLED']);
  assert.deepEqual(await offerStatus(job.offerId), {
    status: 'WITHDRAWN',
    withdraw_reason: 'JOB_CANCELLED',
  });
  assert.deepEqual(await taskRow(job.task.id), { stage: 'CANCELLED', end_reason: 'JOB_CANCELLED' });
  assert.equal(
    await errorCode(a.tasks.depart(meta(job.tech), job.task.id, job.task.version, key())),
    'TASK_CLOSED',
  );

  // Lost response: retried with a new key -> the same answer, no new effect.
  const replay = await b.changes.cancel(meta(BOOKING), job.hold.bookingId, { changeId }, key());
  assert.deepEqual(replay, view);
  // A second cancellation id for the same booking answers with the first one.
  const other = await b.changes.cancel(
    meta(BOOKING),
    job.hold.bookingId,
    { changeId: randomUUID() },
    key(),
  );
  assert.equal(other.changeId, changeId);
  const events = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM app.outbox_message
      WHERE event_type = 'dispatch.assignment-changed.v1'
        AND (payload::jsonb -> 'data' ->> 'status') = 'CANCELLED'
        AND (payload::jsonb -> 'aggregate' ->> 'id') = $1`,
    job.assignmentId,
  );
  assert.equal(events[0]!.n, 1, 'one cancellation event');
  // The hold released afterwards is a no-op for an already cancelled job.
  const released = await deliver(a, holdChangedEvent(job.hold, 3, 'RELEASED'));
  assert.equal(released.effect, 'NOTHING_TO_CANCEL');
});

test('work in progress refuses cancellation (WORK_STARTED) and leaves everything unchanged', async () => {
  const job = await accepted();
  await a.tasks.depart(meta(job.tech), job.task.id, job.task.version, key());
  const before = (await assignmentRow(job.hold.bookingId))!;
  assert.equal(
    await errorCode(
      a.changes.cancel(meta(BOOKING), job.hold.bookingId, { changeId: randomUUID() }, key()),
    ),
    'WORK_STARTED',
  );
  assert.equal(
    await errorCode(
      a.changes.rebind(
        meta(BOOKING),
        job.hold.bookingId,
        { changeId: randomUUID(), ...laterSlot(job.hold) },
        key(),
      ),
    ),
    'WORK_STARTED',
  );
  const after_ = (await assignmentRow(job.hold.bookingId))!;
  assert.equal(after_.version, before.version);
  assert.equal(after_.status, 'ASSIGNED');
  assert.equal((await taskRow(job.task.id)).stage, 'EN_ROUTE');
  const [records] = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM app.booking_change WHERE booking_id = $1::uuid`,
    job.hold.bookingId,
  );
  assert.equal(records!.n, 0, 'a refusal records nothing');
});

test('technician accept racing a cancellation: exactly one consistent outcome, never a live job', async () => {
  for (let i = 0; i < 10; i += 1) {
    const tech = technician();
    const { assignment, hold } = await openJob(a, clock, (3 + i) * 3_600_000);
    const offered = await a.service.offer(
      meta(OPS),
      assignment.id,
      {
        expectedRevision: assignment.version,
        resourceId: randomUUID(),
        technicianSubject: tech.subject,
      },
      key(),
    );
    const [acceptResult, cancelResult] = await Promise.allSettled([
      b.service.acceptOffer(meta(tech), offered.value.offer!.id, key()),
      a.changes.cancel(meta(BOOKING), hold.bookingId, { changeId: randomUUID() }, key()),
    ]);
    assert.equal(cancelResult.status, 'fulfilled', 'not-started work never blocks cancellation');
    const row = (await assignmentRow(hold.bookingId))!;
    assert.equal(row.status, 'CANCELLED');
    const live = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.task
        WHERE assignment_id = $1::uuid AND stage NOT IN ('RELEASED', 'WITHDRAWN', 'CANCELLED')`,
      row.id,
    );
    assert.equal(live[0]!.n, 0, 'no live task survives the cancellation');
    if (acceptResult.status === 'rejected') {
      assert.ok(
        ['OFFER_NOT_LIVE', 'ASSIGNMENT_CANCELLED', 'OFFER_NOT_FOUND'].includes(
          (acceptResult.reason as { code?: string }).code ?? '',
        ),
        String((acceptResult.reason as { code?: string }).code),
      );
    }
  }
});

test('technician depart racing a cancellation: one winner, the loser is refused', async () => {
  let departed = 0;
  let cancelled = 0;
  for (let i = 0; i < 10; i += 1) {
    const job = await accepted(technician(), (15 + i) * 3_600_000);
    const [depart, cancelResult] = await Promise.allSettled([
      b.tasks.depart(meta(job.tech), job.task.id, job.task.version, key()),
      a.changes.cancel(meta(BOOKING), job.hold.bookingId, { changeId: randomUUID() }, key()),
    ]);
    const row = (await assignmentRow(job.hold.bookingId))!;
    const task = await taskRow(job.task.id);
    if (cancelResult.status === 'fulfilled') {
      cancelled += 1;
      assert.equal(depart.status, 'rejected');
      assert.equal(row.status, 'CANCELLED');
      assert.equal(task.stage, 'CANCELLED');
    } else {
      departed += 1;
      assert.equal((cancelResult.reason as { code?: string }).code, 'WORK_STARTED');
      assert.equal(depart.status, 'fulfilled');
      assert.equal(row.status, 'ASSIGNED');
      assert.equal(task.stage, 'EN_ROUTE');
    }
  }
  assert.equal(departed + cancelled, 10);
});

test('20 concurrent cancellations of one booking on two replicas cancel once', async () => {
  const job = await accepted(technician(), 30 * 3_600_000);
  const changeId = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? a : b).changes.cancel(meta(BOOKING), job.hold.bookingId, { changeId }, key()),
    ),
  );
  assert.ok(results.every((r) => r.outcome === 'CANCELLED' && r.changeId === changeId));
  const [audits] = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM app.audit_entry
      WHERE action = 'assignment.cancelled-by-booking' AND target_id = $1::uuid`,
    job.assignmentId,
  );
  assert.equal(audits!.n, 1);
});

// --------------------------------------------------------------- reschedule

test('rebind -> confirm: job moves, technician must re-accept, offers blocked until final', async () => {
  const job = await accepted(technician(), 40 * 3_600_000);
  const to = laterSlot(job.hold);
  const changeId = randomUUID();
  const rebound = await a.changes.rebind(
    meta(BOOKING),
    job.hold.bookingId,
    { changeId, ...to },
    key(),
  );
  assert.equal(rebound.outcome, 'REBOUND');
  let row = (await assignmentRow(job.hold.bookingId))!;
  assert.deepEqual(
    [row.status, row.hold_id, row.pending_change_id, row.starts_at.toISOString()],
    ['UNASSIGNED', to.holdId, changeId, to.startsAt.toISOString()],
  );
  assert.deepEqual(await taskRow(job.task.id), {
    stage: 'WITHDRAWN',
    end_reason: 'JOB_RESCHEDULED',
  });
  assert.deepEqual(await offerStatus(job.offerId), {
    status: 'WITHDRAWN',
    withdraw_reason: 'JOB_RESCHEDULED',
  });
  assert.equal(
    await errorCode(
      a.service.offer(
        meta(OPS),
        row.id,
        {
          expectedRevision: row.version,
          resourceId: randomUUID(),
          technicianSubject: randomUUID(),
        },
        key(),
      ),
    ),
    'RESCHEDULE_PENDING',
  );
  // The old hold is released by Scheduling's replace: nothing bound to it any more.
  const releasedOld = await deliver(a, holdChangedEvent(job.hold, 3, 'RELEASED'));
  assert.equal(releasedOld.effect, 'NOTHING_TO_CANCEL');

  const confirmed = await b.changes.confirm(meta(BOOKING), job.hold.bookingId, { changeId }, key());
  assert.equal(confirmed.outcome, 'CONFIRMED');
  row = (await assignmentRow(job.hold.bookingId))!;
  assert.equal(row.pending_change_id, null);
  // The new hold's COMMITTED event arrives later: already open, nothing changes.
  const newHold: HoldSpec = { ...to, bookingId: job.hold.bookingId };
  const late = await deliver(a, holdChangedEvent(newHold, 2, 'COMMITTED'));
  assert.equal(late.effect, 'ALREADY_OPEN');
  assert.equal((await assignmentRow(job.hold.bookingId))!.version, row.version);
  // And the job can now be offered again for the new time.
  await a.service.offer(
    meta(OPS),
    row.id,
    { expectedRevision: row.version, resourceId: randomUUID(), technicianSubject: randomUUID() },
    key(),
  );
});

test('the new hold COMMITTED event confirms a pending rebind on its own', async () => {
  const { hold } = await openJob(a, clock, 50 * 3_600_000);
  const to = laterSlot(hold);
  const changeId = randomUUID();
  await a.changes.rebind(meta(BOOKING), hold.bookingId, { changeId, ...to }, key());
  const committed = await deliver(
    b,
    holdChangedEvent({ ...to, bookingId: hold.bookingId }, 2, 'COMMITTED'),
  );
  assert.equal(committed.effect, 'BINDING_CONFIRMED');
  assert.equal((await assignmentRow(hold.bookingId))!.pending_change_id, null);
  const again = await a.changes.confirm(meta(BOOKING), hold.bookingId, { changeId }, key());
  assert.equal(again.outcome, 'CONFIRMED', 'Booking confirm afterwards is a replay');
});

test('rebind -> new hold expires -> job kept -> revert restores the original slot', async () => {
  const { hold } = await openJob(a, clock, 60 * 3_600_000);
  const to = laterSlot(hold);
  const changeId = randomUUID();
  await a.changes.rebind(meta(BOOKING), hold.bookingId, { changeId, ...to }, key());
  const expired = await deliver(
    a,
    holdChangedEvent({ ...to, bookingId: hold.bookingId }, 2, 'EXPIRED'),
  );
  assert.equal(expired.effect, 'PENDING_BINDING_KEPT', 'an uncommitted hold never cancels the job');
  assert.equal((await assignmentRow(hold.bookingId))!.status, 'UNASSIGNED');

  const reverted = await b.changes.revert(meta(BOOKING), hold.bookingId, { changeId }, key());
  assert.equal(reverted.outcome, 'REVERTED');
  const row = (await assignmentRow(hold.bookingId))!;
  assert.deepEqual(
    [row.hold_id, row.pending_change_id, row.starts_at.toISOString()],
    [hold.holdId, null, hold.startsAt.toISOString()],
  );
  assert.equal(
    await errorCode(a.changes.confirm(meta(BOOKING), hold.bookingId, { changeId }, key())),
    'CHANGE_REVERTED',
  );
  assert.equal(
    await errorCode(a.changes.rebind(meta(BOOKING), hold.bookingId, { changeId, ...to }, key())),
    'CHANGE_REVERTED',
    'a lost rebind replayed after its revert is refused',
  );
  // The original hold is still the job's: its release cancels the job as before.
  const released = await deliver(a, holdChangedEvent(hold, 3, 'RELEASED'));
  assert.equal(released.effect, 'CANCELLED');
});

test('a revert that arrives before its rebind leaves a tombstone; confirmed rebinds cannot be reverted', async () => {
  const { hold } = await openJob(a, clock, 70 * 3_600_000);
  const to = laterSlot(hold);
  const lost = randomUUID();
  const first = await a.changes.revert(meta(BOOKING), hold.bookingId, { changeId: lost }, key());
  assert.equal(first.outcome, 'NOTHING_TO_REVERT');
  assert.equal(
    await errorCode(
      a.changes.rebind(meta(BOOKING), hold.bookingId, { changeId: lost, ...to }, key()),
    ),
    'CHANGE_REVERTED',
  );
  assert.equal((await assignmentRow(hold.bookingId))!.hold_id, hold.holdId);

  const changeId = randomUUID();
  await a.changes.rebind(meta(BOOKING), hold.bookingId, { changeId, ...to }, key());
  await a.changes.confirm(meta(BOOKING), hold.bookingId, { changeId }, key());
  assert.equal(
    await errorCode(a.changes.revert(meta(BOOKING), hold.bookingId, { changeId }, key())),
    'CHANGE_CONFIRMED',
  );
});

test('rebind refusals: no job yet (retryable), cancelled booking, other zone, same hold, pending rebind', async () => {
  const fresh = holdSpec(clock);
  assert.equal(
    await errorCode(
      a.changes.rebind(
        meta(BOOKING),
        fresh.bookingId,
        { changeId: randomUUID(), ...laterSlot(fresh) },
        key(),
      ),
    ),
    'ASSIGNMENT_NOT_OPEN',
  );
  const { hold } = await openJob(a, clock, 80 * 3_600_000);
  const to = laterSlot(hold);
  assert.equal(
    await errorCode(
      a.changes.rebind(
        meta(BOOKING),
        hold.bookingId,
        { changeId: randomUUID(), ...to, zoneId: randomUUID() },
        key(),
      ),
    ),
    'INVALID_INPUT',
  );
  assert.equal(
    await errorCode(
      a.changes.rebind(
        meta(BOOKING),
        hold.bookingId,
        { changeId: randomUUID(), ...to, holdId: hold.holdId },
        key(),
      ),
    ),
    'INVALID_INPUT',
  );
  await a.changes.rebind(meta(BOOKING), hold.bookingId, { changeId: randomUUID(), ...to }, key());
  assert.equal(
    await errorCode(
      a.changes.rebind(
        meta(BOOKING),
        hold.bookingId,
        { changeId: randomUUID(), ...laterSlot(hold, 5) },
        key(),
      ),
    ),
    'RESCHEDULE_PENDING',
  );
  const cancelled = await a.changes.cancel(
    meta(BOOKING),
    hold.bookingId,
    { changeId: randomUUID() },
    key(),
  );
  assert.equal(cancelled.outcome, 'CANCELLED', 'a cancellation also ends a pending rebind');
  const [pending] = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM app.booking_change
      WHERE booking_id = $1::uuid AND kind = 'REBIND' AND state = 'REBOUND'`,
    hold.bookingId,
  );
  assert.equal(pending!.n, 0);
  assert.equal(
    await errorCode(
      a.changes.rebind(
        meta(BOOKING),
        hold.bookingId,
        { changeId: randomUUID(), ...laterSlot(hold, 7) },
        key(),
      ),
    ),
    'BOOKING_CANCELLED',
  );
});

test('only the dispatch.booking.change scope may change a booking; keys are required', async () => {
  const { hold } = await openJob(a, clock, 90 * 3_600_000);
  const readOnly: Actor = {
    kind: 'SERVICE',
    clientId: 'booking',
    scopes: ['dispatch.assignment.read'],
  };
  for (const actor of [OPS, technician(), readOnly]) {
    assert.equal(
      await errorCode(
        a.changes.cancel(meta(actor), hold.bookingId, { changeId: randomUUID() }, key()),
      ),
      'FORBIDDEN',
    );
    assert.equal(
      await errorCode(
        a.changes.rebind(
          meta(actor),
          hold.bookingId,
          { changeId: randomUUID(), ...laterSlot(hold) },
          key(),
        ),
      ),
      'FORBIDDEN',
    );
  }
  assert.equal(
    await errorCode(
      a.changes.cancel(meta(BOOKING), hold.bookingId, { changeId: randomUUID() }, undefined),
    ),
    'IDEMPOTENCY_KEY_REQUIRED',
  );
  assert.equal(
    await errorCode(
      a.changes.cancel(meta(BOOKING), hold.bookingId, { changeId: 'not-a-uuid' }, key()),
    ),
    'INVALID_INPUT',
  );
  assert.equal((await assignmentRow(hold.bookingId))!.status, 'UNASSIGNED', 'nothing changed');
});

test('the database refuses a second cancellation record and a pending rebind on a cancelled job', async () => {
  const { hold, assignment } = await openJob(a, clock, 100 * 3_600_000);
  await a.changes.cancel(meta(BOOKING), hold.bookingId, { changeId: randomUUID() }, key());
  await assert.rejects(
    a.prisma.client.$executeRawUnsafe(
      `INSERT INTO app.booking_change (change_id, booking_id, kind, state, assignment_id, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, 'CANCELLATION', 'CANCELLED', $3::uuid, now(), now())`,
      randomUUID(),
      hold.bookingId,
      assignment.id,
    ),
    /booking_change_one_cancellation_key|23505|unique/i,
  );
  await assert.rejects(
    a.prisma.client.$executeRawUnsafe(
      `UPDATE app.assignment SET pending_change_id = $2::uuid, version = version + 1 WHERE id = $1::uuid`,
      assignment.id,
      randomUUID(),
    ),
    /assignment_pending_change_ck|23514|check/i,
  );
});
