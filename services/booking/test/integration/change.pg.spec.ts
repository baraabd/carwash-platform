import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CHANGE_POLICY } from '../../src/domain';
import type { Actor, RequestMeta } from '../../src/ports';
import { UserCredential } from '../../src/ports';
import {
  changeOwners,
  changeReplica,
  newHold,
  type ChangeHarness,
  type ChangeOwners,
} from './change-support';
import {
  bookingBody,
  count,
  customer,
  errorCode,
  key,
  owners,
  replica,
  type Harness,
  type Owners,
} from './support';

/**
 * P04-C3 change saga on the REAL lane PostgreSQL (runtime role): the booking,
 * change, schedule, outbox and audit rows, the triggers and the partial unique
 * indexes are real. Dispatch, Scheduling and Billing are in-process doubles of
 * the ports with scripted faults (declared); the real providers are proven in
 * P04-C1/C2 and together in the P04-C merge candidate.
 */
const opened: Harness[] = [];
after(async () => {
  await Promise.all(opened.map((h) => h.prisma.client.$disconnect()));
});

interface World {
  readonly o: Owners;
  readonly c: ChangeOwners;
  readonly h: Harness;
  readonly x: ChangeHarness;
}

function world(options: { inlineBudgetMs?: number } = {}): World {
  const o = owners();
  const c = changeOwners(o);
  const h = replica(o);
  opened.push(h);
  return { o, c, h, x: changeReplica(h, o, c, options) };
}

/** A confirmed booking and the customer who owns it. */
async function confirmed(w: World, kind: 'account' | 'guest' = 'account') {
  const who = customer(kind);
  const created = await w.h.service.create(who.meta(), key(), bookingBody(w.o, who.principal));
  assert.equal(created.view.booking.status, 'CONFIRMED');
  const booking = created.view.booking;
  w.c.dispatch.jobs.set(booking.id, {
    status: 'OPEN',
    work: 'NOT_STARTED',
    holdId: booking.slot!.holdId,
    pending: null,
    original: null,
  });
  return { who, booking };
}

const STAFF: Actor = {
  kind: 'USER',
  principalKind: 'account',
  subject: '5c1d9a7e-2222-4a2b-8c3d-000000000001',
  permissions: ['operations.dispatch'],
};
const staff = (): RequestMeta => ({ actor: STAFF, correlationId: randomUUID(), credential: null });

async function events(w: World, bookingId: string, type: string): Promise<number> {
  return count(
    w.h,
    `SELECT count(*)::bigint AS n FROM app.outbox_message
      WHERE event_type = $2 AND payload::jsonb #>> '{aggregate,id}' = $1`,
    bookingId,
    type,
  );
}

/**
 * Worker passes for ONE change (the database is shared with other tests, so a
 * global runDue would drive their changes against this test's doubles).
 */
async function drain(
  w: World,
  changeId: string,
  x: ChangeHarness = w.x,
  passes = 40,
): Promise<void> {
  for (let i = 0; i < passes; i += 1) {
    w.o.clock.advance(6 * 60_000);
    await x.manager.drive(changeId, `worker-${i}`, 5_000);
  }
}

// ---------------------------------------------------------------- cancellation

test('cancellation: Dispatch gate, booking CANCELLED + one event, capacity freed, obligation voided', async () => {
  const w = world();
  const { who, booking } = await confirmed(w);
  const result = await w.x.service.cancel(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    reason: 'CUSTOMER_REQUEST',
  });
  assert.equal(result.replayed, false);
  assert.equal(result.change.outcome, 'COMPLETED');
  assert.equal(result.change.settlement, 'VOIDED');
  const record = (await w.h.store.find(booking.id))!;
  assert.equal(record.booking.status, 'CANCELLED');
  assert.equal(record.booking.cancellation?.reason, 'CUSTOMER_REQUEST');
  assert.deepEqual(record.booking.slot, booking.slot, 'the original slot snapshot is untouched');
  assert.deepEqual(record.booking.quote, booking.quote, 'the price snapshot is untouched');
  assert.equal(await events(w, booking.id, 'booking.cancelled.v1'), 1);
  assert.deepEqual(w.c.dispatch.effects.cancelled, 1);
  assert.equal(w.c.commitments.effects.released, 1);
  assert.equal(w.o.scheduling.holds.get(booking.slot!.holdId)!.wire.state, 'RELEASED');
  const [payload] = await w.h.prisma.client.$queryRawUnsafe<{ payload: string }[]>(
    `SELECT payload FROM app.outbox_message WHERE event_type = 'booking.cancelled.v1'
      AND payload::jsonb #>> '{aggregate,id}' = $1`,
    booking.id,
  );
  for (const secret of ['سارة', '0912345678', '+963912345678']) {
    assert.equal(payload!.payload.includes(secret), false, `event leaks ${secret}`);
  }
  // History: newest first, nothing open.
  const history = await w.x.service.list(who.meta(), booking.id);
  assert.deepEqual(
    history.map((c) => [c.kind, c.outcome]),
    [['CANCELLATION', 'COMPLETED']],
  );
  assert.equal(await w.x.service.openChange(booking.id), null);
  // A second cancellation is refused by Booking itself.
  assert.equal(
    await errorCode(
      w.x.service.cancel(who.meta(), booking.id, key(), {
        expectedRevision: record.booking.version,
        reason: 'CUSTOMER_REQUEST',
      }),
    ),
    'BOOKING_CANCELLED',
  );
});

test('work already started: REFUSED by Dispatch; booking, capacity and money untouched', async () => {
  const w = world();
  const { who, booking } = await confirmed(w);
  w.c.dispatch.setWork(booking.id, 'STARTED');
  const result = await w.x.service.cancel(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    reason: 'CUSTOMER_REQUEST',
  });
  assert.equal(result.change.outcome, 'REFUSED');
  assert.equal(result.change.refusal, 'WORK_STARTED');
  assert.equal(result.change.settlement, null);
  const after_ = (await w.h.store.find(booking.id))!.booking;
  assert.equal(after_.status, 'CONFIRMED');
  assert.equal(after_.version, booking.version);
  assert.equal(await events(w, booking.id, 'booking.cancelled.v1'), 0);
  assert.equal(w.c.commitments.effects.released, 0);
  assert.equal(w.c.billing.calls, 0);
  w.c.dispatch.setWork(booking.id, 'COMPLETED');
  const done = await w.x.service.cancel(staff(), booking.id, key(), {
    expectedRevision: booking.version,
    reason: 'OPERATIONS_REQUEST',
  });
  assert.equal(done.change.refusal, 'WORK_COMPLETED');
});

test('response lost after every step: each owner effect happens exactly once', async () => {
  const w = world({ inlineBudgetMs: 1 });
  const { who, booking } = await confirmed(w);
  w.c.dispatch.cancelScript.push('LOSE', 'FAIL');
  w.c.commitments.releaseScript.push('LOSE', 'LOSE');
  w.c.billing.script.push('LOSE', 'FAIL');
  const first = await w.x.service.cancel(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    reason: 'CUSTOMER_REQUEST',
  });
  assert.equal(first.change.outcome, null, 'UNKNOWN is never success: still running');
  await drain(w, first.change.changeId);
  const change = (await w.x.store.findChange(first.change.changeId))!.change;
  assert.equal(change.outcome, 'COMPLETED');
  assert.equal(change.settlement, 'VOIDED');
  assert.equal(w.c.dispatch.effects.cancelled, 1);
  assert.equal(w.c.commitments.effects.released, 1);
  assert.equal(w.c.billing.settled.size, 1);
  assert.equal(await events(w, booking.id, 'booking.cancelled.v1'), 1);
});

test('Billing route absent: booking cancelled, settlement PENDING with attention, never COMPLETED', async () => {
  const w = world({ inlineBudgetMs: 1 });
  const { who, booking } = await confirmed(w);
  w.c.billing.available = false;
  const requested = await w.x.service.cancel(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    reason: 'CUSTOMER_REQUEST',
  });
  await drain(w, requested.change.changeId, w.x, CHANGE_POLICY.attentionAfterAttempts + 6);
  let change = (await w.x.store.findChange(requested.change.changeId))!.change;
  assert.equal(change.step, 'SETTLE_BILLING');
  assert.equal(change.outcome, null);
  assert.equal(change.settlement, 'PENDING');
  assert.equal(change.attention, true, 'operations are alerted');
  assert.equal(change.lastError, 'HTTP_404');
  assert.equal((await w.h.store.find(booking.id))!.booking.status, 'CANCELLED');
  // Lane B ships the route: the same saga finishes.
  w.c.billing.available = true;
  await drain(w, requested.change.changeId, w.x, 3);
  change = (await w.x.store.findChange(requested.change.changeId))!.change;
  assert.deepEqual(
    [change.outcome, change.settlement, change.attention],
    ['COMPLETED', 'VOIDED', false],
  );
});

test('payment reported before or after the cancellation: Billing opens a refund case', async () => {
  const w = world();
  const { booking } = await confirmed(w, 'guest');
  w.c.billing.paid.add(booking.id);
  const result = await w.x.service.cancel(staff(), booking.id, key(), {
    expectedRevision: booking.version,
    reason: 'CUSTOMER_REQUEST_BY_PHONE',
  });
  assert.equal(result.change.outcome, 'COMPLETED');
  assert.equal(result.change.settlement, 'REFUND_PENDING');
  assert.equal(result.change.requester.kind, 'staff');
  const audits = await count(
    w.h,
    `SELECT count(*)::bigint AS n FROM app.audit_entry
      WHERE target_id = $1::uuid AND action IN ('booking.cancellation.requested', 'booking.cancelled', 'booking.change.finished')`,
    booking.id,
  );
  assert.equal(audits, 3);
});

test('the job was not opened yet: NOT_OPENED tombstone counts as the pivot', async () => {
  const w = world();
  const { who, booking } = await confirmed(w);
  w.c.dispatch.jobs.delete(booking.id);
  w.c.dispatch.notOpened.add(booking.id);
  const result = await w.x.service.cancel(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    reason: 'CUSTOMER_REQUEST',
  });
  assert.equal(result.change.outcome, 'COMPLETED');
  assert.equal(w.c.dispatch.jobs.get(booking.id)!.status, 'TOMBSTONE');
});

// ------------------------------------------------------------------ reschedule

test('reschedule: rebind -> replace -> confirm; new schedule revision, original kept, no Billing call', async () => {
  const w = world();
  const { who, booking } = await confirmed(w);
  const target = newHold(w.o, who.principal, booking.slot!.zoneId);
  const result = await w.x.service.reschedule(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    holdId: target.holdId,
    holdRevision: target.revision,
  });
  assert.equal(result.change.outcome, 'COMPLETED', JSON.stringify(result.change));
  const after_ = (await w.h.store.find(booking.id))!.booking;
  assert.equal(after_.status, 'CONFIRMED');
  assert.equal(after_.scheduleRevision, 2);
  assert.equal(after_.rescheduledSlot?.holdId, target.holdId);
  assert.deepEqual(after_.slot, booking.slot, 'the original slot snapshot never changes');
  assert.deepEqual(after_.total, booking.total, 'the price is unchanged');
  assert.equal(w.c.dispatch.effects.rebound, 1);
  assert.equal(w.c.commitments.effects.replaced, 1);
  assert.equal(w.c.dispatch.effects.confirmed, 1);
  assert.equal(
    w.c.billing.calls,
    0,
    'a reschedule never touches the obligation or a payment in flight',
  );
  assert.equal(await events(w, booking.id, 'booking.rescheduled.v1'), 1);
  const [history] = await w.h.prisma.client.$queryRawUnsafe<
    { revision: number; previous_hold_id: string; hold_id: string }[]
  >(
    `SELECT revision, previous_hold_id::text, hold_id::text FROM app.booking_schedule WHERE booking_id = $1::uuid`,
    booking.id,
  );
  assert.deepEqual(history, {
    revision: 2,
    previous_hold_id: booking.slot!.holdId,
    hold_id: target.holdId,
  });

  // A second reschedule moves on from the new slot and keeps the whole history.
  const again = newHold(w.o, who.principal, booking.slot!.zoneId, 9);
  const second = await w.x.service.reschedule(who.meta(), booking.id, key(), {
    expectedRevision: after_.version,
    holdId: again.holdId,
    holdRevision: again.revision,
  });
  assert.equal(second.change.outcome, 'COMPLETED');
  assert.equal(second.change.from.holdId, target.holdId);
  assert.equal((await w.h.store.find(booking.id))!.booking.scheduleRevision, 3);
  // And a cancellation now releases the CURRENT commitment, not the original one.
  const latest = (await w.h.store.find(booking.id))!.booking;
  await w.x.service.cancel(who.meta(), booking.id, key(), {
    expectedRevision: latest.version,
    reason: 'CUSTOMER_REQUEST',
  });
  assert.equal(w.o.scheduling.holds.get(again.holdId)!.wire.state, 'RELEASED');
});

test('reschedule refused by Scheduling (hold expired): compensation reverts Dispatch, booking keeps its slot', async () => {
  const w = world();
  const { who, booking } = await confirmed(w);
  const target = newHold(w.o, who.principal, booking.slot!.zoneId);
  w.c.commitments.replaceScript.push(() => ({ kind: 'REFUSED', reason: 'HOLD_EXPIRED' }));
  const result = await w.x.service.reschedule(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    holdId: target.holdId,
    holdRevision: target.revision,
  });
  assert.equal(result.change.outcome, 'FAILED');
  assert.equal(result.change.refusal, 'HOLD_EXPIRED');
  assert.equal(w.c.dispatch.effects.reverted, 1);
  assert.equal(w.c.dispatch.jobs.get(booking.id)!.holdId, booking.slot!.holdId);
  const after_ = (await w.h.store.find(booking.id))!.booking;
  assert.deepEqual([after_.scheduleRevision, after_.version], [1, booking.version]);
  assert.equal(await events(w, booking.id, 'booking.rescheduled.v1'), 0);
});

test('Dispatch never ready before the new hold expires: revert (tombstone) and FAILED', async () => {
  const w = world({ inlineBudgetMs: 1 });
  const { who, booking } = await confirmed(w);
  w.c.dispatch.notOpened.add(booking.id);
  const target = newHold(w.o, who.principal, booking.slot!.zoneId);
  const requested = await w.x.service.reschedule(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    holdId: target.holdId,
    holdRevision: target.revision,
  });
  await drain(w, requested.change.changeId, w.x, 6);
  const change = (await w.x.store.findChange(requested.change.changeId))!.change;
  assert.deepEqual([change.outcome, change.refusal], ['FAILED', 'DISPATCH_NOT_READY']);
  assert.equal(w.c.dispatch.changes.get(change.changeId), 'REVERTED');
  assert.equal(w.c.commitments.effects.replaced, 0, 'the pivot was never attempted');
});

test('replace applied but its response lost: replayed by booking, one effect, completed', async () => {
  const w = world({ inlineBudgetMs: 1 });
  const { who, booking } = await confirmed(w);
  const target = newHold(w.o, who.principal, booking.slot!.zoneId);
  w.c.commitments.replaceScript.push('LOSE');
  w.c.dispatch.confirmScript.push('FAIL', 'LOSE');
  const requested = await w.x.service.reschedule(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    holdId: target.holdId,
    holdRevision: target.revision,
  });
  await drain(w, requested.change.changeId, w.x, 8);
  const change = (await w.x.store.findChange(requested.change.changeId))!.change;
  assert.equal(change.outcome, 'COMPLETED');
  assert.equal(change.pivotAttempted, true);
  assert.equal(w.c.commitments.effects.replaced, 1);
  assert.equal(w.c.dispatch.effects.confirmed, 1);
  assert.equal(await events(w, booking.id, 'booking.rescheduled.v1'), 1);
});

test('a worker that stalls after the pivot is fenced; another replica finishes the change', async () => {
  const w = world({ inlineBudgetMs: 1 });
  const { who, booking } = await confirmed(w);
  const target = newHold(w.o, who.principal, booking.slot!.zoneId);
  w.c.dispatch.confirmScript.push('FAIL');
  const requested = await w.x.service.reschedule(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    holdId: target.holdId,
    holdRevision: target.revision,
  });
  const other = replica(w.o);
  opened.push(other);
  const replicaB = changeReplica(other, w.o, w.c);
  // Two workers race on the same due change: one lease wins at a time.
  for (let i = 0; i < 4; i += 1) {
    w.o.clock.advance(6 * 60_000);
    await Promise.all([
      w.x.manager.drive(requested.change.changeId, `a-${i}`, 5_000),
      replicaB.manager.drive(requested.change.changeId, `b-${i}`, 5_000),
    ]);
  }
  const change = (await w.x.store.findChange(requested.change.changeId))!.change;
  assert.equal(change.outcome, 'COMPLETED');
  assert.equal(w.c.commitments.effects.replaced, 1);
  assert.equal(await events(w, booking.id, 'booking.rescheduled.v1'), 1);
});

// -------------------------------------------------------- requests and races

test('ten concurrent cancellations with different keys: one change, one cancellation', async () => {
  const w = world();
  const { who, booking } = await confirmed(w);
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      w.x.service.cancel(who.meta(), booking.id, key(), {
        expectedRevision: booking.version,
        reason: 'CUSTOMER_REQUEST',
      }),
    ),
  );
  const ok = results.filter((r) => r.status === 'fulfilled');
  assert.equal(ok.length, 1);
  const codes = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => (r.reason as { code?: string }).code);
  assert.ok(
    codes.every((c) =>
      ['CHANGE_IN_PROGRESS', 'BOOKING_CANCELLED', 'REVISION_CONFLICT'].includes(c ?? ''),
    ),
    String(codes),
  );
  assert.equal(
    await count(
      w.h,
      `SELECT count(*)::bigint AS n FROM app.booking_change WHERE booking_id = $1::uuid`,
      booking.id,
    ),
    1,
  );
  assert.equal(w.c.dispatch.effects.cancelled, 1);
  assert.equal(await events(w, booking.id, 'booking.cancelled.v1'), 1);
});

test('ten concurrent retries of one key: one change; a replay after completion still answers it', async () => {
  const w = world();
  const { who, booking } = await confirmed(w);
  const idem = key();
  const body = { expectedRevision: booking.version, reason: 'CUSTOMER_REQUEST' };
  const results = await Promise.all(
    Array.from({ length: 10 }, () => w.x.service.cancel(who.meta(), booking.id, idem, body)),
  );
  assert.equal(new Set(results.map((r) => r.change.changeId)).size, 1);
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  const late = await w.x.service.cancel(who.meta(), booking.id, idem, body);
  assert.equal(late.replayed, true);
  assert.equal(late.change.outcome, 'COMPLETED');
  assert.equal(
    await errorCode(
      w.x.service.cancel(who.meta(), booking.id, idem, { ...body, expectedRevision: 99 }),
    ),
    'IDEMPOTENCY_CONFLICT',
  );
});

test('request refusals: authorization, reasons, revision, open change, pending booking, unusable holds', async () => {
  const w = world({ inlineBudgetMs: 1 });
  const { who, booking } = await confirmed(w);
  const stranger = customer();
  const cancelBody = { expectedRevision: booking.version, reason: 'CUSTOMER_REQUEST' };
  assert.equal(
    await errorCode(w.x.service.cancel(stranger.meta(), booking.id, key(), cancelBody)),
    'BOOKING_NOT_FOUND',
  );
  assert.equal(
    await errorCode(
      w.x.service.cancel(who.meta(), booking.id, key(), {
        ...cancelBody,
        reason: 'OPERATIONS_REQUEST',
      }),
    ),
    'INVALID_INPUT',
  );
  assert.equal(
    await errorCode(w.x.service.cancel(staff(), booking.id, key(), cancelBody)),
    'INVALID_INPUT',
    'staff must give a staff reason',
  );
  assert.equal(
    await errorCode(
      w.x.service.cancel(who.meta(), booking.id, key(), { ...cancelBody, expectedRevision: 9 }),
    ),
    'REVISION_CONFLICT',
  );
  assert.equal(
    await errorCode(w.x.service.cancel(who.meta(), booking.id, undefined, cancelBody)),
    'IDEMPOTENCY_KEY_REQUIRED',
  );
  assert.equal(
    await errorCode(
      w.x.service.cancel(who.meta(), booking.id, key(), { ...cancelBody, extra: true }),
    ),
    'INVALID_INPUT',
  );

  const zone = booking.slot!.zoneId;
  const reschedule = (holdId: string, holdRevision = 1, meta: RequestMeta = who.meta()) =>
    w.x.service.reschedule(meta, booking.id, key(), {
      expectedRevision: booking.version,
      holdId,
      holdRevision,
    });
  const theirs = newHold(w.o, stranger.principal, zone);
  assert.equal(await errorCode(reschedule(theirs.holdId)), 'HOLD_NOT_USABLE');
  const elsewhere = newHold(w.o, who.principal, randomUUID());
  assert.equal(await errorCode(reschedule(elsewhere.holdId)), 'HOLD_NOT_USABLE');
  const longer = newHold(w.o, who.principal, zone);
  w.o.scheduling.holds.get(longer.holdId)!.wire = {
    ...longer,
    endsAt: new Date(Date.parse(longer.startsAt) + 2 * 3_600_000).toISOString(),
  };
  assert.equal(await errorCode(reschedule(longer.holdId)), 'HOLD_NOT_USABLE');
  const fine = newHold(w.o, who.principal, zone);
  assert.equal(
    await errorCode(reschedule(fine.holdId, 2)),
    'HOLD_NOT_USABLE',
    'stale hold revision',
  );
  assert.equal(await errorCode(reschedule(booking.slot!.holdId)), 'HOLD_NOT_USABLE');
  assert.equal(await errorCode(reschedule(fine.holdId, 1, staff())), 'FORBIDDEN');

  // An open change blocks a second one.
  w.c.dispatch.cancelScript.push('FAIL');
  const running = await w.x.service.cancel(who.meta(), booking.id, key(), cancelBody);
  assert.equal(running.change.outcome, null);
  assert.equal(await errorCode(reschedule(fine.holdId)), 'CHANGE_IN_PROGRESS');
});

test('the database keeps cancellations final, schedules append-only and change requests immutable', async () => {
  const w = world();
  const { who, booking } = await confirmed(w);
  const target = newHold(w.o, who.principal, booking.slot!.zoneId);
  const moved = await w.x.service.reschedule(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    holdId: target.holdId,
    holdRevision: target.revision,
  });
  const current = (await w.h.store.find(booking.id))!.booking;
  await w.x.service.cancel(who.meta(), booking.id, key(), {
    expectedRevision: current.version,
    reason: 'CUSTOMER_REQUEST',
  });
  const sql = (text: string, ...params: unknown[]) =>
    w.h.prisma.client.$executeRawUnsafe(text, ...params);
  await assert.rejects(
    sql(
      `UPDATE app.booking SET status = 'CONFIRMED', cancelled_at = NULL, cancellation_reason = NULL, version = version + 1 WHERE id = $1::uuid`,
      booking.id,
    ),
    /BOOKING_CANCELLATION_FINAL|55000/,
  );
  await assert.rejects(
    sql(`DELETE FROM app.booking_schedule WHERE booking_id = $1::uuid`, booking.id),
    /APPEND_ONLY|55000/,
  );
  await assert.rejects(
    sql(
      `UPDATE app.booking_change SET to_hold_id = $2::uuid WHERE change_id = $1::uuid`,
      moved.change.changeId,
      randomUUID(),
    ),
    /BOOKING_CHANGE_IMMUTABLE|55000/,
  );
  await assert.rejects(
    sql(
      `UPDATE app.booking_change SET outcome = 'FAILED', refusal = 'HOLD_EXPIRED' WHERE change_id = $1::uuid`,
      moved.change.changeId,
    ),
    /BOOKING_CHANGE_IMMUTABLE|55000/,
  );
  await assert.rejects(
    sql(`DELETE FROM app.booking_change WHERE change_id = $1::uuid`, moved.change.changeId),
    /DELETE_FORBIDDEN|55000/,
  );
});

test('UserCredential stays out of every change row and event', async () => {
  const w = world();
  const { who, booking } = await confirmed(w);
  await w.x.service.cancel(who.meta(), booking.id, key(), {
    expectedRevision: booking.version,
    reason: 'CUSTOMER_REQUEST',
  });
  const leaks = await count(
    w.h,
    `SELECT count(*)::bigint AS n FROM app.outbox_message WHERE payload LIKE '%test-token%'`,
  );
  assert.equal(leaks, 0);
  assert.equal(JSON.stringify(new UserCredential('Bearer x')), '"[redacted]"');
});
