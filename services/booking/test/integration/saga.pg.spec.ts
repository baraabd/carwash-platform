import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SAGA_POLICY } from '../../src/domain';
import {
  bookingBody,
  count,
  customer,
  errorCode,
  key,
  owners,
  replica,
  type Harness,
} from './support';

/**
 * Creation saga on the REAL lane PostgreSQL (runtime role), with in-process
 * owner doubles. Each test asserts the database facts, not just return values:
 * exactly one booking row, one saga, one outbox event, one commit effect.
 */
const opened: Harness[] = [];
function open(...args: Parameters<typeof replica>): Harness {
  const h = replica(...args);
  opened.push(h);
  return h;
}
after(async () => {
  await Promise.all(opened.map((h) => h.prisma.client.$disconnect()));
});

const fulfilled = <T>(r: PromiseSettledResult<T>): r is PromiseFulfilledResult<T> =>
  r.status === 'fulfilled';
const failed = <T>(r: PromiseSettledResult<T>): r is PromiseRejectedResult =>
  r.status === 'rejected';

async function outboxFor(h: Harness, bookingId: string): Promise<number> {
  return count(
    h,
    `SELECT count(*)::bigint AS n FROM app.outbox_message WHERE event_type = 'booking.created.v1' AND payload::jsonb #>> '{aggregate,id}' = $1`,
    bookingId,
  );
}

test('happy path: one request confirms one booking, commits the hold once and emits one event', async () => {
  const o = owners();
  const h = open(o);
  const who = customer();
  const result = await h.service.create(who.meta(), key(), bookingBody(o, who.principal));
  assert.equal(result.replayed, false);
  assert.equal(result.view.booking.status, 'CONFIRMED');
  assert.equal(result.view.saga.outcome, 'CONFIRMED');
  assert.ok(result.view.booking.slot);
  assert.equal(o.scheduling.commitsApplied, 1);
  assert.equal(o.billing.obligations.size, 1);
  assert.equal(await outboxFor(h, result.view.booking.id), 1);
  const [event] = await h.prisma.client.$queryRawUnsafe<{ payload: string }[]>(
    `SELECT payload FROM app.outbox_message WHERE payload::jsonb #>> '{aggregate,id}' = $1`,
    result.view.booking.id,
  );
  assert.ok(event);
  for (const secret of ['سارة', '+963912345678', 'قرب الدوار', 'الطابق']) {
    assert.equal(event.payload.includes(secret), false, `outbox payload leaks ${secret}`);
  }
  const audit = await count(
    h,
    `SELECT count(*)::bigint AS n FROM app.audit_entry WHERE target_id = $1::uuid`,
    result.view.booking.id,
  );
  assert.equal(audit, 2, 'created + confirmed');
});

test('guest principals book exactly like accounts and keep their own principal kind', async () => {
  const o = owners();
  const h = open(o);
  const guest = customer('guest');
  const result = await h.service.create(guest.meta(), key(), bookingBody(o, guest.principal));
  assert.equal(result.view.booking.status, 'CONFIRMED');
  assert.deepEqual(result.view.booking.beneficiary, guest.principal);
});

test('duplicate confirmation, same key, 12 concurrent requests on 3 replicas: exactly one booking', async () => {
  const o = owners();
  o.scheduling.commitDelayMs = 50;
  const replicas = [open(o), open(o), open(o)];
  const who = customer();
  const body = bookingBody(o, who.principal);
  const k = key();
  const outcomes = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) => replicas[i % 3]!.service.create(who.meta(), k, body)),
  );
  const ok = outcomes.filter(fulfilled).map((r) => r.value);
  const rejected = outcomes.filter(failed).map((r) => r.reason as { code?: string });
  assert.ok(ok.length >= 1);
  assert.ok(
    rejected.every((e) => e.code === 'IDEMPOTENCY_IN_PROGRESS'),
    JSON.stringify(rejected),
  );
  assert.equal(
    new Set(ok.map((r) => r.view.booking.id)).size,
    1,
    'every success names the same booking',
  );
  assert.equal(ok.filter((r) => !r.replayed).length, 1, 'only one request created it');
  const bookingId = ok[0]!.view.booking.id;
  const h = replicas[0]!;
  assert.equal(
    await count(
      h,
      `SELECT count(*)::bigint AS n FROM app.booking WHERE hold_id = $1::uuid`,
      body.hold.holdId,
    ),
    1,
  );
  assert.equal(o.scheduling.commitsApplied, 1);
  assert.equal(await outboxFor(h, bookingId), 1);
  // A late retry with the same key replays the same booking.
  const replay = await h.service.create(who.meta(), k, body);
  assert.equal(replay.replayed, true);
  assert.equal(replay.view.booking.id, bookingId);
});

test('duplicate confirmation, different keys, same hold: one live booking, the rest refused', async () => {
  const o = owners();
  o.scheduling.commitDelayMs = 30;
  const replicas = [open(o), open(o)];
  const who = customer();
  const body = bookingBody(o, who.principal);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) => replicas[i % 2]!.service.create(who.meta(), key(), body)),
  );
  const ok = outcomes.filter((r) => r.status === 'fulfilled');
  const codes = outcomes.filter(failed).map((r) => (r.reason as { code?: string }).code);
  assert.equal(ok.length, 1, JSON.stringify(codes));
  assert.ok(
    codes.every((c) => c === 'HOLD_ALREADY_BOOKED' || c === 'QUOTE_ALREADY_BOOKED'),
    JSON.stringify(codes),
  );
  const h = replicas[0]!;
  assert.equal(
    await count(
      h,
      `SELECT count(*)::bigint AS n FROM app.booking WHERE hold_id = $1::uuid AND status <> 'REJECTED'`,
      body.hold.holdId,
    ),
    1,
  );
  assert.equal(o.scheduling.commitsApplied, 1);
  // Claims of refused requests were dropped: no orphan CAPTURING rows remain for this principal.
  assert.equal(
    await count(
      h,
      `SELECT count(*)::bigint AS n FROM app.booking_request WHERE principal_subject = $1::uuid AND state = 'CAPTURING'`,
      who.principal.subjectId,
    ),
    0,
  );
});

test('same key with a different body is an idempotency conflict and changes nothing', async () => {
  const o = owners();
  const h = open(o);
  const who = customer();
  const k = key();
  await h.service.create(who.meta(), k, bookingBody(o, who.principal));
  assert.equal(
    await errorCode(h.service.create(who.meta(), k, bookingBody(o, who.principal))),
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(
    await count(
      h,
      `SELECT count(*)::bigint AS n FROM app.booking WHERE principal_subject = $1::uuid`,
      who.principal.subjectId,
    ),
    1,
  );
});

test('stale quote at capture is refused before anything is persisted; the key stays usable', async () => {
  const o = owners();
  const h = open(o);
  const who = customer();
  const body = bookingBody(o, who.principal);
  const wire = o.pricing.quotes.get(body.quote.quoteId)!;
  o.pricing.quotes.set(wire.quoteId, { ...wire, status: 'EXPIRED' });
  const k = key();
  assert.equal(await errorCode(h.service.create(who.meta(), k, body)), 'QUOTE_NOT_USABLE');
  assert.equal(
    await count(
      h,
      `SELECT count(*)::bigint AS n FROM app.booking WHERE quote_id = $1::uuid`,
      body.quote.quoteId,
    ),
    0,
  );
  o.pricing.quotes.set(wire.quoteId, wire);
  assert.equal((await h.service.create(who.meta(), k, body)).view.booking.status, 'CONFIRMED');
});

test('stale quote at confirmation (validation says expired) rejects the booking; nothing committed', async () => {
  const o = owners();
  const h = open(o);
  const who = customer();
  o.pricing.validateScript.push(() => ({ kind: 'INVALID', reason: 'QUOTE_EXPIRED' }));
  const result = await h.service.create(who.meta(), key(), bookingBody(o, who.principal));
  assert.equal(result.view.booking.status, 'REJECTED');
  assert.equal(result.view.booking.rejectionReason, 'QUOTE_EXPIRED');
  assert.equal(o.billing.createCalls, 0);
  assert.equal(o.scheduling.commitCalls, 0);
  assert.equal(await outboxFor(h, result.view.booking.id), 0);
});

test('a validated total that differs from the snapshot rejects the booking', async () => {
  const o = owners();
  const h = open(o);
  const who = customer();
  o.pricing.validateScript.push(() => ({
    kind: 'VALID',
    total: { currency: 'SYP', amountMinor: 1n, scale: 2 },
  }));
  const result = await h.service.create(who.meta(), key(), bookingBody(o, who.principal));
  assert.equal(result.view.booking.rejectionReason, 'QUOTE_INVALID');
});

test('stale hold (expired before commit): obligation is voided and the booking rejected', async () => {
  const o = owners();
  const h = open(o);
  const who = customer();
  const body = bookingBody(o, who.principal);
  const hold = o.scheduling.holds.get(body.hold.holdId)!;
  hold.wire = { ...hold.wire, expiresAt: new Date(o.clock.now().getTime() + 1).toISOString() };
  // The hold deadline passes while Billing is answering.
  const createObligation = o.billing.create.bind(o.billing);
  o.billing.create = async (request) => {
    o.clock.advance(5);
    return createObligation(request);
  };
  const result = await h.service.create(who.meta(), key(), body);
  assert.equal(result.view.booking.status, 'REJECTED');
  assert.equal(result.view.booking.rejectionReason, 'HOLD_EXPIRED');
  assert.equal(o.billing.obligations.get(result.view.booking.id)?.state, 'VOIDED');
  assert.equal(o.scheduling.commitsApplied, 0);
  // REJECTED reserved nothing: the same quote can be booked again with a new hold.
  const fresh = o.scheduling.hold(who.principal, hold.wire.zoneId);
  const retry = await h.service.create(who.meta(), key(), {
    ...body,
    hold: { holdId: fresh.holdId, revision: fresh.revision },
  });
  assert.equal(retry.view.booking.status, 'CONFIRMED');
});

test('hold revision changed (stale hold): capture refuses it before persisting', async () => {
  const o = owners();
  const h = open(o);
  const who = customer();
  const body = bookingBody(o, who.principal);
  const hold = o.scheduling.holds.get(body.hold.holdId)!;
  hold.wire = { ...hold.wire, revision: 2 };
  assert.equal(await errorCode(h.service.create(who.meta(), key(), body)), 'HOLD_ALREADY_BOOKED');
});

test('response loss at the pivot: commit happened, answer lost; the replay confirms exactly once', async () => {
  const o = owners();
  const h = open(o);
  const who = customer();
  const body = bookingBody(o, who.principal);
  let bookingId = '';
  const createObligation = o.billing.create.bind(o.billing);
  o.billing.create = async (request) => {
    bookingId = request.bookingId;
    return createObligation(request);
  };
  // First call: the commit takes effect but the response is lost (timeout).
  o.scheduling.commitScript.push(() => {
    o.scheduling.apply({
      holdId: body.hold.holdId,
      expectedRevision: body.hold.revision,
      bookingId,
    });
    return { kind: 'UNKNOWN', error: 'TIMEOUT' };
  });
  const first = await h.service.create(who.meta(), key(), body);
  assert.equal(
    first.view.booking.status,
    'PENDING_CONFIRMATION',
    'unknown outcome is never reported as success',
  );
  assert.equal(first.view.saga.step, 'COMMIT_HOLD');
  assert.equal(first.view.saga.pivotAttempted, true);
  assert.equal(o.scheduling.commitsApplied, 1);
  // Far past the pre-pivot deadline: still not rejected, the worker replays.
  o.clock.advance(SAGA_POLICY.deadlineMs * 2);
  const worker = open(o);
  assert.equal(await worker.saga.drive(first.view.booking.id, 'worker-a', 5_000), 'DONE');
  const after = await worker.store.find(first.view.booking.id);
  assert.equal(after?.booking.status, 'CONFIRMED');
  assert.equal(o.scheduling.commitsApplied, 1, 'the replay did not commit a second time');
  assert.equal(o.scheduling.commitCalls, 2);
  assert.equal(await outboxFor(h, first.view.booking.id), 1);
});

test('billing unavailable until the deadline: rejected DEADLINE_EXCEEDED after a void, never confirmed', async () => {
  const o = owners();
  const h = open(o);
  const who = customer();
  o.billing.create = () => Promise.resolve({ kind: 'UNAVAILABLE', error: 'NOT_CONFIGURED' });
  const first = await h.service.create(who.meta(), key(), bookingBody(o, who.principal));
  assert.equal(first.view.booking.status, 'PENDING_CONFIRMATION');
  assert.equal(first.view.saga.step, 'CREATE_OBLIGATION');
  o.clock.advance(SAGA_POLICY.deadlineMs + 1);
  assert.equal(await h.saga.drive(first.view.booking.id, 'worker-b', 5_000), 'DONE');
  const done = await h.store.find(first.view.booking.id);
  assert.equal(done?.booking.status, 'REJECTED');
  assert.equal(done?.booking.rejectionReason, 'DEADLINE_EXCEEDED');
  assert.ok(
    o.billing.tombstones.has(first.view.booking.id),
    'a possibly-created obligation was voided',
  );
  assert.equal(o.scheduling.commitCalls, 0);
});

test('a committed hold that differs from the request needs reconciliation and is not confirmed', async () => {
  const o = owners();
  const h = open(o);
  const who = customer();
  const body = bookingBody(o, who.principal);
  o.scheduling.commitScript.push(() => {
    const w = o.scheduling.holds.get(body.hold.holdId)!.wire;
    return {
      kind: 'COMMITTED',
      slot: {
        holdId: w.holdId,
        zoneId: w.zoneId,
        startsAt: new Date(Date.parse(w.startsAt) + 3_600_000),
        endsAt: new Date(Date.parse(w.endsAt) + 3_600_000),
      },
    };
  });
  const result = await h.service.create(who.meta(), key(), body);
  assert.equal(result.view.saga.step, 'NEEDS_RECONCILIATION');
  assert.equal(result.view.booking.status, 'PENDING_CONFIRMATION');
  assert.equal(await outboxFor(h, result.view.booking.id), 0);
  assert.equal(
    await count(
      h,
      `SELECT count(*)::bigint AS n FROM app.audit_entry WHERE target_id = $1::uuid AND action = 'booking.saga.reconciliation-required'`,
      result.view.booking.id,
    ),
    1,
  );
});

test('crash after persisting, before the saga ran: another replica resumes it after the lease', async () => {
  const o = owners();
  // Inline budget 0: the API persists the booking and hands the saga over at
  // once, like a process killed right after the insert.
  const api = open(o, { inlineBudgetMs: 0 });
  const who = customer();
  assert.equal(await api.store.leaseSaga(randomUUID(), 'nobody', o.clock.now(), 1_000), null);
  const created = await api.service.create(who.meta(), key(), bookingBody(o, who.principal));
  const id = created.view.booking.id;
  assert.equal(created.view.booking.status, 'PENDING_CONFIRMATION');
  // A crashed owner left a live lease behind.
  const stuck = await api.store.leaseSaga(id, 'api-crashed', o.clock.now(), 2_000);
  assert.ok(stuck);
  const worker = open(o);
  assert.equal(await worker.saga.drive(id, 'worker-c', 5_000), 'BUSY', 'a live lease is respected');
  o.clock.advance(2_001);
  assert.equal(await worker.saga.drive(id, 'worker-c', 5_000), 'DONE');
  assert.equal((await worker.store.find(id))?.booking.status, 'CONFIRMED');
  // The stale owner wakes up: every write it attempts is fenced off.
  assert.equal(await api.store.saveSaga(stuck.record.saga, stuck.lease, true), false);
  assert.equal(await outboxFor(worker, id), 1);
  assert.equal(o.scheduling.commitsApplied, 1);
});

test('two workers race the same due saga: one finishes, the other is fenced; one event', async () => {
  const o = owners();
  o.scheduling.commitDelayMs = 80;
  const api = open(o, { inlineBudgetMs: 0 });
  const who = customer();
  const created = await api.service.create(who.meta(), key(), bookingBody(o, who.principal));
  const id = created.view.booking.id;
  const [a, b] = [open(o, { leaseMs: 50 }), open(o, { leaseMs: 50 })];
  // Lease A, let it expire mid-commit, let B take over: both call the owner.
  await Promise.all([
    a.saga.drive(id, 'worker-a', 5_000),
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      o.clock.advance(100);
      await b.saga.drive(id, 'worker-b', 5_000);
    })(),
  ]);
  const final = await a.store.find(id);
  assert.equal(final?.booking.status, 'CONFIRMED');
  assert.equal(o.scheduling.commitsApplied, 1);
  assert.equal(await outboxFor(a, id), 1);
  assert.equal(
    await count(
      a,
      `SELECT count(*)::bigint AS n FROM app.audit_entry WHERE target_id = $1::uuid AND action = 'booking.confirmed'`,
      id,
    ),
    1,
  );
});

test('restart: a fresh replica (new pool, new process state) reads and finishes persisted work', async () => {
  const o = owners();
  const first = open(o);
  const who = customer();
  o.pricing.validateScript.push(() => ({ kind: 'UNAVAILABLE', error: 'HTTP_503' }));
  const created = await first.service.create(who.meta(), key(), bookingBody(o, who.principal));
  await first.prisma.client.$disconnect();
  const fresh = open(o);
  o.clock.advance(60_000);
  assert.equal(await fresh.saga.drive(created.view.booking.id, 'worker-restart', 5_000), 'DONE');
  assert.equal((await fresh.store.find(created.view.booking.id))?.booking.status, 'CONFIRMED');
});

test('worker passes: two replicas lease due sagas with SKIP LOCKED; each saga finishes exactly once', async () => {
  const o = owners();
  o.scheduling.commitDelayMs = 20;
  const api = open(o, { inlineBudgetMs: 0 });
  const ids: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const who = customer();
    ids.push(
      (await api.service.create(who.meta(), key(), bookingBody(o, who.principal))).view.booking.id,
    );
  }
  const [a, b] = [open(o), open(o)];
  // Other suites' unfinished sagas in the shared database may be leased too;
  // the assertions below concern this test's sagas only.
  await Promise.all([a.saga.runDue('pass-a', 500, 5_000), b.saga.runDue('pass-b', 500, 5_000)]);
  for (const id of ids) {
    assert.equal((await a.store.find(id))?.booking.status, 'CONFIRMED', id);
    assert.equal(await outboxFor(a, id), 1, id);
  }
  assert.equal(o.scheduling.commitsApplied, ids.length);
});
