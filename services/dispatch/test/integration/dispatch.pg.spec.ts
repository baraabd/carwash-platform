import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AssignmentView } from '../../src/application';
import {
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
  type Replica,
} from './support';

/**
 * Real PostgreSQL 16 (lane stack), RUNTIME role, two independent connection
 * pools standing in for two service replicas. No doubles in this suite.
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

/** Domain/store error code of a settled rejection. */
function reasonCode(reason: unknown): string {
  const code = (reason as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

async function rows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return a.prisma.client.$queryRawUnsafe<T[]>(sql, ...params);
}

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const [row] = await rows<{ n: number }>(sql, ...params);
  return Number(row?.n ?? 0);
}

async function offerTo(
  assignmentId: string,
  revision: number,
  tech = technician(),
  resourceId: string = randomUUID(),
  ttlSeconds?: number,
): Promise<{ view: AssignmentView; tech: ReturnType<typeof technician>; resourceId: string }> {
  const { value } = await a.service.offer(
    meta(OPS),
    assignmentId,
    {
      expectedRevision: revision,
      resourceId,
      technicianSubject: tech.subject,
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    },
    key(),
  );
  return { view: value, tech, resourceId };
}

// ------------------------------------------------------------------ inbox

test('a COMMITTED hold opens exactly one assignment; redelivery and stale events are no-ops', async () => {
  const hold = holdSpec(clock);
  const event = holdChangedEvent(hold, 2, 'COMMITTED');
  const first = await deliver(a, event);
  assert.deepEqual(first, { outcome: 'APPLIED', effect: 'OPENED' });
  assert.equal((await deliver(b, event)).outcome, 'DUPLICATE', 'same id, same bytes');
  assert.equal(
    (await deliver(b, event, JSON.stringify({ ...event, occurredAt: new Date(0).toISOString() })))
      .outcome,
    'CONFLICT',
    'same id, different bytes is an integrity failure, not a replay',
  );
  const again = await deliver(a, holdChangedEvent(hold, 2, 'COMMITTED'));
  assert.deepEqual(again, { outcome: 'APPLIED', effect: 'STALE' }, 'new id, same revision');

  const assignments = await rows<{ status: string; version: number }>(
    `SELECT status, version FROM app.assignment WHERE booking_id = $1::uuid`,
    hold.bookingId,
  );
  assert.deepEqual(assignments, [{ status: 'UNASSIGNED', version: 1 }]);
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.outbox_message WHERE payload::jsonb -> 'data' ->> 'bookingId' = $1`,
      hold.bookingId,
    ),
    1,
  );
  const [inboxRow] = await rows<{ outcome: string }>(
    `SELECT outcome FROM app.inbox_message WHERE event_id = $1::uuid`,
    event.eventId,
  );
  assert.equal(inboxRow?.outcome, 'OPENED');
});

test('out of order: RELEASED (v3) before COMMITTED (v2) never opens a job', async () => {
  const hold = holdSpec(clock);
  assert.equal(
    (await deliver(a, holdChangedEvent(hold, 3, 'RELEASED'))).effect,
    'NOTHING_TO_CANCEL',
  );
  assert.equal((await deliver(a, holdChangedEvent(hold, 2, 'COMMITTED'))).effect, 'STALE');
  assert.equal((await deliver(a, holdChangedEvent(hold, 1, 'HELD'))).effect, 'STALE');
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.assignment WHERE hold_id = $1::uuid`,
      hold.holdId,
    ),
    0,
  );
});

test('concurrent first deliveries from two replicas: one effect only', async () => {
  for (let i = 0; i < 5; i += 1) {
    const hold = holdSpec(clock);
    const sameId = holdChangedEvent(hold, 2, 'COMMITTED');
    const results = await Promise.all([
      deliver(a, sameId),
      deliver(b, sameId),
      deliver(a, holdChangedEvent(hold, 2, 'COMMITTED')),
      deliver(b, holdChangedEvent(hold, 2, 'COMMITTED')),
    ]);
    assert.equal(results.filter((r) => r.effect === 'OPENED').length, 1, JSON.stringify(results));
    assert.equal(results.filter((r) => r.outcome === 'DUPLICATE').length, 1);
    assert.equal(
      await count(
        `SELECT count(*)::int AS n FROM app.assignment WHERE hold_id = $1::uuid`,
        hold.holdId,
      ),
      1,
    );
  }
});

test('a second committed hold for the same booking is recorded as a conflict, never merged', async () => {
  const { hold } = await openJob(a, clock);
  const other = { ...holdSpec(clock), bookingId: hold.bookingId };
  assert.equal(
    (await deliver(a, holdChangedEvent(other, 2, 'COMMITTED'))).effect,
    'BOOKING_CONFLICT',
  );
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.assignment WHERE booking_id = $1::uuid`,
      hold.bookingId,
    ),
    1,
  );
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.audit_entry WHERE action = 'hold.booking-conflict' AND target_id = $1::uuid`,
      other.holdId,
    ),
    1,
  );
});

test('a released slot cancels the job, withdraws the accepted offer and frees the resource', async () => {
  const { hold, assignment } = await openJob(a, clock);
  const { view, tech, resourceId } = await offerTo(assignment.id, 1);
  await a.service.acceptOffer(meta(tech), view.offer!.id, key());
  assert.equal((await deliver(a, holdChangedEvent(hold, 3, 'RELEASED'))).effect, 'CANCELLED');
  const job = await a.store.findAssignment(assignment.id);
  assert.equal(job?.status, 'CANCELLED');
  assert.equal(job?.cancelReason, 'HOLD_RELEASED');
  const offer = await a.store.findOffer(view.offer!.id);
  assert.equal(offer?.status, 'WITHDRAWN');
  assert.equal(offer?.withdrawReason, 'JOB_CANCELLED');
  // The resource can take an overlapping job now.
  const second = await openJob(a, clock);
  const again = await offerTo(second.assignment.id, 1, tech, resourceId);
  const accepted = await a.service.acceptOffer(meta(tech), again.view.offer!.id, key());
  assert.equal(accepted.value.assignment.status, 'ASSIGNED');
  // Commands on the cancelled job are refused.
  assert.equal(
    await errorCode(
      a.service.offer(
        meta(OPS),
        assignment.id,
        { expectedRevision: job.version, resourceId, technicianSubject: tech.subject },
        key(),
      ),
    ),
    'ASSIGNMENT_CANCELLED',
  );
});

// ------------------------------------------------------- offers and accept

test('offer -> accept; another technician sees 404; stale revision is refused', async () => {
  const { assignment } = await openJob(a, clock);
  const { view, tech, resourceId } = await offerTo(assignment.id, 1);
  assert.equal(view.assignment.status, 'OFFERED');
  assert.equal(view.assignment.version, 2);
  assert.equal(view.offer?.status, 'OFFERED');

  assert.equal(
    await errorCode(a.service.acceptOffer(meta(technician()), view.offer.id, key())),
    'OFFER_NOT_FOUND',
  );
  assert.equal(
    await errorCode(
      a.service.offer(
        meta(OPS),
        assignment.id,
        { expectedRevision: 1, resourceId, technicianSubject: tech.subject },
        key(),
      ),
    ),
    'REVISION_CONFLICT',
  );
  const accepted = await a.service.acceptOffer(meta(tech), view.offer.id, key());
  assert.equal(accepted.value.offer?.status, 'ACCEPTED');
  assert.equal(accepted.value.assignment.status, 'ASSIGNED');
  assert.equal(accepted.value.assignment.resourceId, resourceId);

  const mine = await a.service.listMyOffers(meta(tech));
  assert.deepEqual(
    mine.map((m) => [m.offer.id, m.offer.status]),
    [[view.offer.id, 'ACCEPTED']],
  );
  assert.deepEqual(await a.service.listMyOffers(meta(technician())), []);
});

test('race: N concurrent accepts of one offer make exactly one transition', async () => {
  const { assignment } = await openJob(a, clock);
  const { view, tech } = await offerTo(assignment.id, 1);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? a : b).service.acceptOffer(meta(tech), view.offer!.id, key()),
    ),
  );
  assert.ok(
    results.every((r) => r.status === 'fulfilled'),
    JSON.stringify(results),
  );
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.audit_entry WHERE action = 'offer.accepted' AND target_id = $1::uuid`,
      view.offer!.id,
    ),
    1,
  );
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.outbox_message
        WHERE payload::jsonb -> 'aggregate' ->> 'id' = $1 AND payload::jsonb -> 'data' ->> 'status' = 'ASSIGNED'`,
      assignment.id,
    ),
    1,
  );
});

test('race: accept vs operations unassign — exactly one wins, state stays consistent', async () => {
  for (let i = 0; i < 10; i += 1) {
    const { assignment } = await openJob(a, clock);
    const { view, tech } = await offerTo(assignment.id, 1);
    const [accepted, unassigned] = await Promise.allSettled([
      a.service.acceptOffer(meta(tech), view.offer!.id, key()),
      b.service.unassign(meta(OPS), assignment.id, { expectedRevision: 2 }, key()),
    ]);
    const wins = [accepted, unassigned].filter((r) => r.status === 'fulfilled').length;
    assert.equal(wins, 1, `iteration ${i}: ${JSON.stringify([accepted, unassigned])}`);
    const job = await a.store.findAssignment(assignment.id);
    const offer = await a.store.findOffer(view.offer!.id);
    if (accepted.status === 'fulfilled') {
      assert.equal(job?.status, 'ASSIGNED');
      assert.equal(offer?.status, 'ACCEPTED');
      assert.equal(
        reasonCode(unassigned.status === 'rejected' ? unassigned.reason : null),
        'REVISION_CONFLICT',
      );
    } else {
      assert.equal(job?.status, 'UNASSIGNED');
      assert.equal(offer?.status, 'WITHDRAWN');
      assert.equal(reasonCode(accepted.reason), 'OFFER_NOT_LIVE');
    }
  }
});

test('race: one resource accepting two overlapping jobs at once — the database admits one', async () => {
  for (let i = 0; i < 5; i += 1) {
    const tech = technician();
    const resourceId = randomUUID();
    const first = await openJob(a, clock);
    const second = await openJob(a, clock, 2 * 3_600_000 + 30 * 60_000); // overlaps by 30 min
    const o1 = await offerTo(first.assignment.id, 1, tech, resourceId);
    const o2 = await offerTo(second.assignment.id, 1, tech, resourceId);
    const results = await Promise.allSettled([
      a.service.acceptOffer(meta(tech), o1.view.offer!.id, key()),
      b.service.acceptOffer(meta(tech), o2.view.offer!.id, key()),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, JSON.stringify(results));
    assert.equal(reasonCode(rejected[0]?.reason), 'RESOURCE_BUSY');
    assert.equal(
      await count(
        `SELECT count(*)::int AS n FROM app.assignment WHERE resource_id = $1::uuid AND status = 'ASSIGNED'`,
        resourceId,
      ),
      1,
    );
  }
});

test('adjacent windows [) do not overlap: the same resource may take back-to-back jobs', async () => {
  const tech = technician();
  const resourceId = randomUUID();
  const first = await openJob(a, clock, 10 * 3_600_000);
  const second = await openJob(a, clock, 11 * 3_600_000);
  const o1 = await offerTo(first.assignment.id, 1, tech, resourceId);
  const o2 = await offerTo(second.assignment.id, 1, tech, resourceId);
  await a.service.acceptOffer(meta(tech), o1.view.offer!.id, key());
  const result = await a.service.acceptOffer(meta(tech), o2.view.offer!.id, key());
  assert.equal(result.value.assignment.status, 'ASSIGNED');
});

test('decline returns the job to UNASSIGNED; reassign withdraws an accepted offer', async () => {
  const { assignment } = await openJob(a, clock);
  const first = await offerTo(assignment.id, 1);
  const declined = await a.service.declineOffer(
    meta(first.tech),
    first.view.offer!.id,
    'TOO_FAR',
    null,
    key(),
  );
  assert.equal(declined.value.offer?.status, 'DECLINED');
  assert.equal(declined.value.assignment.status, 'UNASSIGNED');
  assert.equal(declined.value.assignment.version, 3);

  const second = await offerTo(assignment.id, 3);
  await a.service.acceptOffer(meta(second.tech), second.view.offer!.id, key());
  const third = technician();
  const reassigned = await a.service.reassign(
    meta(OPS),
    assignment.id,
    { expectedRevision: 5, resourceId: randomUUID(), technicianSubject: third.subject },
    key(),
  );
  assert.equal(reassigned.value.assignment.status, 'OFFERED');
  assert.equal(reassigned.value.offer?.technicianSubject, third.subject);
  assert.equal((await a.store.findOffer(second.view.offer!.id))?.withdrawReason, 'REASSIGNED');
  // The withdrawn technician can no longer act on their old offer.
  assert.equal(
    await errorCode(a.service.acceptOffer(meta(second.tech), second.view.offer!.id, key())),
    'OFFER_NOT_LIVE',
  );
});

// ----------------------------------------------------------- idempotency

test('idempotency: replay returns the same result, a different body conflicts, racing keys create once', async () => {
  const { assignment } = await openJob(a, clock);
  const tech = technician();
  const body = { expectedRevision: 1, resourceId: randomUUID(), technicianSubject: tech.subject };
  const k = key();
  const first = await a.service.offer(meta(OPS), assignment.id, body, k);
  const replay = await b.service.offer(meta(OPS), assignment.id, body, k);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.offer?.id, first.value.offer?.id);
  assert.equal(
    await errorCode(
      a.service.offer(meta(OPS), assignment.id, { ...body, resourceId: randomUUID() }, k),
    ),
    'IDEMPOTENCY_CONFLICT',
  );
  // Same key from another operator is a different scope.
  const otherOps = { ...OPS, subject: randomUUID() };
  assert.equal(
    await errorCode(a.service.offer(meta(otherOps), assignment.id, body, k)),
    'REVISION_CONFLICT',
  );

  const second = await openJob(a, clock);
  const shared = key();
  const racing = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      (i % 2 ? a : b).service.offer(meta(OPS), second.assignment.id, body, shared),
    ),
  );
  assert.ok(
    racing.every((r) => r.status === 'fulfilled'),
    JSON.stringify(racing),
  );
  const values = racing.map((r) => (r as PromiseFulfilledResult<{ replayed: boolean }>).value);
  assert.equal(values.filter((v) => !v.replayed).length, 1);
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.dispatch_offer WHERE assignment_id = $1::uuid`,
      second.assignment.id,
    ),
    1,
  );
});

test('a refused command leaves no idempotency record: the retry is evaluated afresh', async () => {
  const { assignment } = await openJob(a, clock);
  const tech = technician();
  const k = key();
  const body = { expectedRevision: 9, resourceId: randomUUID(), technicianSubject: tech.subject };
  assert.equal(
    await errorCode(a.service.offer(meta(OPS), assignment.id, body, k)),
    'REVISION_CONFLICT',
  );
  const ok = await a.service.offer(meta(OPS), assignment.id, { ...body, expectedRevision: 1 }, k);
  assert.equal(ok.replayed, false);
});

// ---------------------------------------------------------------- expiry

test('expiry is decided by the clock: accepting at the deadline records the expiry and fails', async () => {
  const local = new TestClock();
  const r = replica(local);
  try {
    const { assignment } = await openJob(r, local);
    const { view, tech } = await (async () => {
      const t = technician();
      const { value } = await r.service.offer(
        meta(OPS),
        assignment.id,
        {
          expectedRevision: 1,
          resourceId: randomUUID(),
          technicianSubject: t.subject,
          ttlSeconds: 60,
        },
        key(),
      );
      return { view: value, tech: t };
    })();
    local.advance(60_000);
    assert.equal(
      await errorCode(r.service.acceptOffer(meta(tech), view.offer!.id, key())),
      'OFFER_EXPIRED',
    );
    const offer = await r.store.findOffer(view.offer!.id);
    assert.equal(offer?.status, 'EXPIRED', 'the expiry was committed although the accept failed');
    assert.equal((await r.store.findAssignment(assignment.id))?.status, 'UNASSIGNED');
    assert.equal(
      await errorCode(r.service.acceptOffer(meta(tech), view.offer!.id, key())),
      'OFFER_NOT_LIVE',
    );
  } finally {
    await r.prisma.client.$disconnect();
  }
});

test('expiry sweep from two replicas expires every due offer exactly once', async () => {
  const local = new TestClock();
  const r1 = replica(local);
  const r2 = replica(local);
  try {
    const offers: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const { assignment } = await openJob(r1, local);
      const { value } = await r1.service.offer(
        meta(OPS),
        assignment.id,
        {
          expectedRevision: 1,
          resourceId: randomUUID(),
          technicianSubject: randomUUID(),
          ttlSeconds: 60,
        },
        key(),
      );
      offers.push(value.offer!.id);
    }
    local.advance(61_000);
    const [x, y] = await Promise.all([
      r1.service.expireDue(randomUUID(), 500),
      r2.service.expireDue(randomUUID(), 500),
    ]);
    assert.ok(x.offers + y.offers >= offers.length);
    for (const id of offers) {
      assert.equal((await r1.store.findOffer(id))?.status, 'EXPIRED');
      assert.equal(
        await count(
          `SELECT count(*)::int AS n FROM app.audit_entry WHERE action = 'offer.expired' AND target_id = $1::uuid`,
          id,
        ),
        1,
      );
    }
  } finally {
    await r1.prisma.client.$disconnect();
    await r2.prisma.client.$disconnect();
  }
});

test('idempotency retention purge removes only records older than the cutoff', async () => {
  const { assignment } = await openJob(a, clock);
  await offerTo(assignment.id, 1);
  const before = await count(`SELECT count(*)::int AS n FROM app.idempotency_record`);
  assert.equal(await a.store.purgeIdempotencyBefore(new Date(Date.now() - 86_400_000), 1000), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM app.idempotency_record`), before);
});

// --------------------------------------------- database is the last line

test('the database rejects invariant breaks even from the runtime role directly', async () => {
  const { assignment } = await openJob(a, clock);
  const { view } = await offerTo(assignment.id, 1);
  const state = async (sql: string, ...params: unknown[]) => {
    try {
      await a.prisma.client.$executeRawUnsafe(sql, ...params);
      return 'OK';
    } catch (error) {
      const cause = (
        error as {
          meta?: { driverAdapterError?: { cause?: { code?: string; originalCode?: string } } };
        }
      ).meta?.driverAdapterError?.cause;
      return cause?.code ?? cause?.originalCode ?? (error as Error).message;
    }
  };
  // A second OFFERED offer for the same assignment.
  assert.equal(
    await state(
      `INSERT INTO app.dispatch_offer (id, assignment_id, resource_id, technician_subject, status, expires_at,
         created_by, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'OFFERED', now() + interval '1 hour', 'x', now(), now())`,
      randomUUID(),
      assignment.id,
      randomUUID(),
      randomUUID(),
    ),
    '23505',
  );
  // ASSIGNED without a resource.
  assert.equal(
    await state(`UPDATE app.assignment SET status = 'ASSIGNED' WHERE id = $1::uuid`, assignment.id),
    '23514',
  );
  // A second assignment for the same booking.
  assert.equal(
    await state(
      `INSERT INTO app.assignment (id, booking_id, hold_id, zone_id, starts_at, ends_at, status, created_at, updated_at)
       SELECT $1::uuid, booking_id, $2::uuid, zone_id, starts_at, ends_at, 'UNASSIGNED', now(), now()
         FROM app.assignment WHERE id = $3::uuid`,
      randomUUID(),
      randomUUID(),
      assignment.id,
    ),
    '23505',
  );
  // Two ASSIGNED overlapping jobs for one resource.
  const resource = randomUUID();
  const other = await openJob(a, clock);
  const assign = (id: string) =>
    state(
      `UPDATE app.assignment SET status = 'ASSIGNED', resource_id = $2::uuid, technician_subject = $2::uuid
        WHERE id = $1::uuid`,
      id,
      resource,
    );
  assert.equal(await assign(other.assignment.id), 'OK');
  assert.equal(await assign(view.assignment.id), '23P01');
  // The runtime role has no DDL and no access to migration history.
  assert.equal(await state(`CREATE TABLE app.sneaky (id int)`), '42501');
  assert.equal(await state(`SELECT 1 FROM app._prisma_migrations`), '42501');
});

test('pool pressure: more concurrent technician commands than pool connections all complete', async () => {
  // One replica (pg pool max 10) and 16 accepts at once. A unit of work that
  // reads through the pool while holding its transaction connection starves
  // the pool here; found by the SIGKILL restart suite and fixed with readOffer.
  const jobs = [];
  for (let i = 0; i < 16; i += 1) {
    const { assignment } = await openJob(a, clock, (40 + i * 2) * 3_600_000);
    const tech = technician();
    const { view } = await offerTo(assignment.id, 1, tech);
    jobs.push({ tech, offerId: view.offer!.id });
  }
  const results = await Promise.allSettled(
    jobs.map((job) => a.service.acceptOffer(meta(job.tech), job.offerId, key())),
  );
  assert.ok(
    results.every((r) => r.status === 'fulfilled'),
    JSON.stringify(results.filter((r) => r.status === 'rejected')).slice(0, 400),
  );
});
