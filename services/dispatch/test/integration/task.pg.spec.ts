import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TaskDetail } from '../../src/application';
import { positiveMoneyFromWire } from '../../src/domain';
import {
  OPS,
  TestClock,
  deliver,
  deliverEligibility,
  eligibilityEvent,
  errorCode,
  holdChangedEvent,
  key,
  media,
  meta,
  openJob,
  replica,
  technician,
  workforce,
  type Replica,
} from './support';

/**
 * Task execution on real PostgreSQL 16 (lane stack, RUNTIME role), two
 * connection pools as two replicas. Workforce and Media are in-process
 * doubles of their ports (declared in evidence); everything else is real:
 * row locks, partial unique indexes, triggers, outbox and audit rows.
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

async function n(sql: string, ...params: unknown[]): Promise<number> {
  const [row] = await q<{ n: number }>(sql, ...params);
  return Number(row?.n ?? 0);
}

/** Opens a job and offers it to `tech` on `resourceId`. */
async function offered(
  tech: Tech = technician(),
  resourceId: string = randomUUID(),
  startOffsetMs?: number,
) {
  const { assignment, hold } = await openJob(a, clock, startOffsetMs);
  const { value } = await a.service.offer(
    meta(OPS),
    assignment.id,
    { expectedRevision: assignment.version, resourceId, technicianSubject: tech.subject },
    key(),
  );
  return { assignmentId: assignment.id, offerId: value.offer!.id, tech, resourceId, hold };
}

async function accepted(
  tech: Tech = technician(),
  resourceId: string = randomUUID(),
  startOffsetMs?: number,
) {
  const job = await offered(tech, resourceId, startOffsetMs);
  const { value } = await a.service.acceptOffer(meta(tech), job.offerId, key());
  assert.ok(value.task, 'acceptance creates the task');
  return { ...job, taskId: value.task.id };
}

async function step(
  tech: Tech,
  detail: TaskDetail,
  action: 'depart' | 'arrive' | 'start' | 'document' | 'finish',
): Promise<TaskDetail> {
  return (await a.tasks[action](meta(tech), detail.task.id, detail.task.version, key())).value;
}

async function attach(tech: Tech, detail: TaskDetail, phase: 'BEFORE' | 'AFTER', slot: 0 | 1 = 0) {
  const objectId = media.add(tech.subject);
  return (
    await a.tasks.attachEvidence(
      meta(tech),
      detail.task.id,
      phase,
      slot,
      { expectedRevision: detail.task.version, mediaObjectId: objectId },
      key(),
    )
  ).value;
}

async function checkAll(tech: Tech, detail: TaskDetail): Promise<TaskDetail> {
  let current = detail;
  for (const item of current.task.checklist) {
    current = (
      await a.tasks.setCheck(
        meta(tech),
        current.task.id,
        item.code,
        { expectedRevision: current.task.version, checked: true },
        key(),
      )
    ).value;
  }
  return current;
}

/** Walks a fresh task to FINISHED through the real service. */
async function toFinished(tech: Tech = technician()) {
  const job = await accepted(tech);
  let detail = await a.tasks.getMyTask(meta(tech), job.taskId);
  detail = await step(tech, detail, 'depart');
  detail = await step(tech, detail, 'arrive');
  detail = await attach(tech, detail, 'BEFORE');
  detail = await step(tech, detail, 'start');
  detail = await checkAll(tech, detail);
  detail = await step(tech, detail, 'document');
  detail = await attach(tech, detail, 'AFTER');
  detail = await step(tech, detail, 'finish');
  return { ...job, detail };
}

const SYP_15000 = positiveMoneyFromWire(
  { currency: 'SYP', amountMinor: '1500000', scale: 2 },
  'amount',
);

test('full journey: accept -> route -> before -> wash -> after -> handoff (cash), with events and history', async () => {
  const tech = technician();
  const { detail, assignmentId, taskId } = await toFinished(tech);
  assert.equal(detail.task.stage, 'FINISHED');
  const closed = (
    await a.tasks.close(
      meta(tech),
      taskId,
      {
        expectedRevision: detail.task.version,
        collection: { outcome: 'CASH_COLLECTED', amount: SYP_15000 },
      },
      key(),
    )
  ).value;
  assert.equal(closed.task.stage, 'CLOSED');
  assert.equal(closed.task.collection?.amountMinor, 1_500_000n);
  assert.deepEqual(
    closed.history.map((entry) => entry.action),
    [
      'accepted',
      'departed',
      'arrived',
      'evidence.before.attached',
      'started',
      'check.done',
      'check.done',
      'check.done',
      'check.done',
      'documented',
      'evidence.after.attached',
      'finished',
      'closed',
    ],
  );
  assert.deepEqual(
    closed.history.map((entry) => entry.seq),
    closed.history.map((_, i) => i + 1),
  );
  const progressed = await q<{ payload: string }>(
    `SELECT payload FROM app.outbox_message WHERE event_type = 'dispatch.task-progressed.v1'
      AND payload::jsonb #>> '{data,taskId}' = $1 ORDER BY created_at`,
    taskId,
  );
  assert.deepEqual(
    progressed.map((row) => (JSON.parse(row.payload) as { data: { stage: string } }).data.stage),
    ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_SERVICE', 'DOCUMENTING', 'FINISHED', 'CLOSED'],
  );
  const [cash] = await q<{ payload: string }>(
    `SELECT payload FROM app.outbox_message WHERE event_type = 'dispatch.cash-declared.v1'
      AND payload::jsonb #>> '{data,taskId}' = $1`,
    taskId,
  );
  const cashData = (JSON.parse(cash!.payload) as { data: Record<string, unknown> }).data;
  assert.deepEqual(cashData.amount, { currency: 'SYP', amountMinor: '1500000', scale: 2 });
  assert.equal(cashData.late, false);
  // No technician subject, name or phone in any event of this task.
  for (const row of await q<{ payload: string }>(
    `SELECT payload FROM app.outbox_message WHERE payload::jsonb #>> '{data,taskId}' = $1`,
    taskId,
  )) {
    assert.ok(!JSON.stringify(JSON.parse(row.payload).data).includes(tech.subject));
  }
  // Completed work is never taken away by operations.
  const assignment = (await a.store.findAssignment(assignmentId))!;
  assert.equal(
    await errorCode(
      a.service.reassign(
        meta(OPS),
        assignmentId,
        {
          expectedRevision: assignment.version,
          resourceId: randomUUID(),
          technicianSubject: randomUUID(),
        },
        key(),
      ),
    ),
    'TASK_CLOSED',
  );
  assert.equal(
    await n(
      `SELECT count(*)::int AS n FROM app.audit_entry WHERE target_id = $1::uuid AND action = 'task.closed'`,
      taskId,
    ),
    1,
  );
});

test('two technicians race for the same offer: only the addressee can win, exactly once', async () => {
  const owner = technician();
  const intruder = technician();
  const job = await offered(owner);
  const results = await Promise.allSettled([
    a.service.acceptOffer(meta(intruder), job.offerId, key()),
    b.service.acceptOffer(meta(owner), job.offerId, key()),
    a.service.acceptOffer(meta(owner), job.offerId, key()),
    b.service.acceptOffer(meta(intruder), job.offerId, key()),
  ]);
  const intruderCodes = [results[0], results[3]].map((r) =>
    r.status === 'rejected' ? (r.reason as { code: string }).code : 'OK',
  );
  assert.deepEqual(intruderCodes, ['OFFER_NOT_FOUND', 'OFFER_NOT_FOUND']);
  // Both owner requests succeed (the second is a natural replay), one task exists.
  assert.ok(results[1].status === 'fulfilled' && results[2].status === 'fulfilled');
  assert.equal(
    await n(
      `SELECT count(*)::int AS n FROM app.task WHERE assignment_id = $1::uuid`,
      job.assignmentId,
    ),
    1,
  );
  assert.equal(
    await n(
      `SELECT count(*)::int AS n FROM app.dispatch_offer WHERE assignment_id = $1::uuid AND status = 'ACCEPTED'`,
      job.assignmentId,
    ),
    1,
  );
});

test('accept racing a reassignment: one consistent winner, never two live tasks', async () => {
  for (let round = 0; round < 6; round += 1) {
    const first = technician();
    const second = technician();
    const job = await offered(first);
    const revision = (await a.store.findAssignment(job.assignmentId))!.version;
    const [acceptResult, reassignResult] = await Promise.allSettled([
      a.service.acceptOffer(meta(first), job.offerId, key()),
      b.service.reassign(
        meta(OPS),
        job.assignmentId,
        { expectedRevision: revision, resourceId: randomUUID(), technicianSubject: second.subject },
        key(),
      ),
    ]);
    const live = await n(
      `SELECT count(*)::int AS n FROM app.task WHERE assignment_id = $1::uuid
        AND stage NOT IN ('RELEASED','WITHDRAWN','CANCELLED')`,
      job.assignmentId,
    );
    assert.ok(live <= 1, 'never two live tasks');
    if (acceptResult.status === 'fulfilled') {
      // Accept won the lock; the reassignment then saw a new revision (412) or ran after it.
      if (reassignResult.status === 'rejected') {
        assert.equal((reassignResult.reason as { code: string }).code, 'REVISION_CONFLICT');
        assert.equal(live, 1);
        continue;
      }
      assert.equal(live, 0, 'the reassignment withdrew the accepted task');
      const task = (await a.store.findTask(acceptResult.value.value.task!.id))!;
      assert.equal(task.stage, 'WITHDRAWN');
      assert.equal(task.endReason, 'REASSIGNED');
      assert.equal(
        await errorCode(a.tasks.depart(meta(first), task.id, task.version, key())),
        'TASK_CLOSED',
      );
    } else {
      assert.equal(reassignResult.status, 'fulfilled');
      assert.equal(live, 0);
      assert.equal((acceptResult.reason as { code: string }).code, 'OFFER_NOT_LIVE');
    }
  }
});

test('accept wins, stale reassignment is refused with 412, the accepted task stays live', async () => {
  const first = technician();
  const job = await offered(first);
  const before = (await a.store.findAssignment(job.assignmentId))!.version;
  await a.service.acceptOffer(meta(first), job.offerId, key());
  assert.equal(
    await errorCode(
      b.service.reassign(
        meta(OPS),
        job.assignmentId,
        { expectedRevision: before, resourceId: randomUUID(), technicianSubject: randomUUID() },
        key(),
      ),
    ),
    'REVISION_CONFLICT',
  );
  assert.equal(
    await n(
      `SELECT count(*)::int AS n FROM app.task WHERE assignment_id = $1::uuid AND stage = 'ACCEPTED'`,
      job.assignmentId,
    ),
    1,
  );
});

test('reassignment fences the previous technician mid-job and the new one starts clean', async () => {
  const first = technician();
  const second = technician();
  const job = await accepted(first);
  let detail = await a.tasks.getMyTask(meta(first), job.taskId);
  detail = await step(first, detail, 'depart');
  const assignment = (await a.store.findAssignment(job.assignmentId))!;
  await a.service.reassign(
    meta(OPS),
    job.assignmentId,
    {
      expectedRevision: assignment.version,
      resourceId: randomUUID(),
      technicianSubject: second.subject,
    },
    key(),
  );
  const old = (await a.store.findTask(job.taskId))!;
  assert.equal(old.stage, 'WITHDRAWN');
  assert.equal(
    await errorCode(a.tasks.arrive(meta(first), job.taskId, old.version, key())),
    'TASK_CLOSED',
  );
  assert.equal(
    await errorCode(a.tasks.arrive(meta(first), job.taskId, detail.task.version, key())),
    'TASK_CLOSED',
  );
  // The old technician can still read their own ended task (shown as removed), nobody else can.
  assert.equal((await a.tasks.getMyTask(meta(first), job.taskId)).task.stage, 'WITHDRAWN');
  assert.equal(await errorCode(a.tasks.getMyTask(meta(second), job.taskId)), 'TASK_NOT_FOUND');
  const jobs = await a.tasks.listMyJobs(meta(second));
  const newOffer = jobs.offers.find((entry) => entry.assignment.id === job.assignmentId)!;
  const { value } = await b.service.acceptOffer(meta(second), newOffer.offer.id, key());
  assert.equal(value.task?.stage, 'ACCEPTED');
  assert.notEqual(value.task?.id, job.taskId);
});

test('stale eligibility: an offer is refused for an ineligible resource and re-checked at acceptance', async () => {
  const tech = technician();
  const resourceId = randomUUID();
  const { assignment } = await openJob(a, clock);
  workforce.set(resourceId, 'INELIGIBLE', 2);
  assert.equal(
    await errorCode(
      a.service.offer(
        meta(OPS),
        assignment.id,
        { expectedRevision: assignment.version, resourceId, technicianSubject: tech.subject },
        key(),
      ),
    ),
    'RESOURCE_INELIGIBLE',
  );
  workforce.set(resourceId, 'UNLISTED', 3);
  assert.equal(
    await errorCode(
      a.service.offer(
        meta(OPS),
        assignment.id,
        { expectedRevision: assignment.version, resourceId, technicianSubject: tech.subject },
        key(),
      ),
    ),
    'RESOURCE_INELIGIBLE',
  );
  assert.equal((await a.store.findAssignment(assignment.id))!.status, 'UNASSIGNED');
  // Eligible when offered, ineligible by the time the technician accepts.
  workforce.set(resourceId, 'ELIGIBLE', 4);
  const { value } = await a.service.offer(
    meta(OPS),
    assignment.id,
    { expectedRevision: assignment.version, resourceId, technicianSubject: tech.subject },
    key(),
  );
  workforce.set(resourceId, 'INELIGIBLE', 5);
  assert.equal(
    await errorCode(a.service.acceptOffer(meta(tech), value.offer!.id, key())),
    'RESOURCE_INELIGIBLE',
  );
  const offer = (await a.store.findOffer(value.offer!.id))!;
  assert.equal(offer.status, 'WITHDRAWN');
  assert.equal(offer.withdrawReason, 'RESOURCE_INELIGIBLE');
  assert.equal((await a.store.findAssignment(assignment.id))!.status, 'UNASSIGNED');
  assert.equal(
    await n(
      `SELECT count(*)::int AS n FROM app.task WHERE assignment_id = $1::uuid`,
      assignment.id,
    ),
    0,
  );
});

test('Workforce unavailable: no offer, no acceptance, no state change (fail closed)', async () => {
  const tech = technician();
  const job = await offered(tech);
  const before = (await a.store.findAssignment(job.assignmentId))!;
  workforce.unavailable = true;
  try {
    assert.equal(
      await errorCode(a.service.acceptOffer(meta(tech), job.offerId, key())),
      'ELIGIBILITY_UNAVAILABLE',
    );
    const { assignment } = await openJob(a, clock);
    assert.equal(
      await errorCode(
        a.service.offer(
          meta(OPS),
          assignment.id,
          { expectedRevision: 1, resourceId: randomUUID(), technicianSubject: tech.subject },
          key(),
        ),
      ),
      'ELIGIBILITY_UNAVAILABLE',
    );
    assert.equal((await a.store.findAssignment(assignment.id))!.version, 1);
  } finally {
    workforce.unavailable = false;
  }
  assert.equal((await a.store.findAssignment(job.assignmentId))!.version, before.version);
  assert.equal((await a.store.findOffer(job.offerId))!.status, 'OFFERED');
});

test('eligibility-changed.v1: withdraws live offers and unstarted tasks, flags field work, ignores stale', async () => {
  const resourceId = randomUUID();
  // One resource, three non-overlapping jobs (the exclusion constraint forbids overlap).
  const HOUR = 3_600_000;
  const live = await offered(technician(), resourceId, 2 * HOUR);
  const unstarted = await accepted(technician(), resourceId, 5 * HOUR);
  const fieldTech = technician();
  const inField = await accepted(fieldTech, resourceId, 8 * HOUR);
  const fieldDetail = await a.tasks.getMyTask(meta(fieldTech), inField.taskId);
  await step(fieldTech, fieldDetail, 'depart');

  assert.equal(
    (await deliverEligibility(a, eligibilityEvent(resourceId, 3, 'ELIGIBLE'))).effect,
    'NOTED',
  );
  const ineligible = eligibilityEvent(resourceId, 4, 'INELIGIBLE');
  assert.equal((await deliverEligibility(b, ineligible)).effect, 'WITHDREW');
  assert.equal((await deliverEligibility(a, ineligible)).outcome, 'DUPLICATE');
  assert.equal(
    (await deliverEligibility(a, eligibilityEvent(resourceId, 2, 'ELIGIBLE'))).effect,
    'STALE',
  );

  assert.equal((await a.store.findOffer(live.offerId))!.withdrawReason, 'RESOURCE_INELIGIBLE');
  assert.equal((await a.store.findAssignment(live.assignmentId))!.status, 'UNASSIGNED');
  const withdrawn = (await a.store.findTask(unstarted.taskId))!;
  assert.equal(withdrawn.stage, 'WITHDRAWN');
  assert.equal(withdrawn.endReason, 'RESOURCE_INELIGIBLE');
  assert.equal((await a.store.findAssignment(unstarted.assignmentId))!.status, 'UNASSIGNED');
  const flagged = (await a.store.findTask(inField.taskId))!;
  assert.equal(flagged.stage, 'EN_ROUTE', 'field work is never cancelled behind the technician');
  assert.equal(flagged.attentionReason, 'RESOURCE_INELIGIBLE');
  // The newer pushed INELIGIBLE overrides an older ELIGIBLE read at offer time.
  const { assignment } = await openJob(a, clock);
  workforce.set(resourceId, 'ELIGIBLE', 3);
  assert.equal(
    await errorCode(
      a.service.offer(
        meta(OPS),
        assignment.id,
        { expectedRevision: 1, resourceId, technicianSubject: randomUUID() },
        key(),
      ),
    ),
    'RESOURCE_INELIGIBLE',
  );
  workforce.set(resourceId, 'ELIGIBLE', 5);
  await a.service.offer(
    meta(OPS),
    assignment.id,
    { expectedRevision: 1, resourceId, technicianSubject: randomUUID() },
    key(),
  );
});

test('eligibility event racing an acceptance never leaves an ineligible resource with a fresh task', async () => {
  for (let round = 0; round < 5; round += 1) {
    const resourceId = randomUUID();
    const tech = technician();
    workforce.set(resourceId, 'ELIGIBLE', 10);
    const job = await offered(tech, resourceId);
    await Promise.allSettled([
      a.service.acceptOffer(meta(tech), job.offerId, key()),
      deliverEligibility(b, eligibilityEvent(resourceId, 11, 'INELIGIBLE')),
    ]);
    const unstartedLive = await n(
      `SELECT count(*)::int AS n FROM app.task WHERE resource_id = $1::uuid AND stage = 'ACCEPTED'`,
      resourceId,
    );
    const liveOffers = await n(
      `SELECT count(*)::int AS n FROM app.dispatch_offer WHERE resource_id = $1::uuid AND status IN ('OFFERED','ACCEPTED')`,
      resourceId,
    );
    assert.equal(unstartedLive, 0);
    assert.equal(liveOffers, 0);
  }
});

test('one job in the field per technician (database partial unique index)', async () => {
  const tech = technician();
  const one = await accepted(tech);
  const two = await accepted(tech);
  const d1 = await a.tasks.getMyTask(meta(tech), one.taskId);
  const d2 = await a.tasks.getMyTask(meta(tech), two.taskId);
  const results = await Promise.allSettled([
    a.tasks.depart(meta(tech), d1.task.id, d1.task.version, key()),
    b.tasks.depart(meta(tech), d2.task.id, d2.task.version, key()),
  ]);
  const codes = results
    .map((r) => (r.status === 'fulfilled' ? 'OK' : (r.reason as { code: string }).code))
    .sort();
  assert.deepEqual(codes, ['OK', 'TECHNICIAN_BUSY']);
});

test('evidence: ownership, state and stage checked; slot replacement keeps history; one object one slot', async () => {
  const tech = technician();
  const other = technician();
  const job = await accepted(tech);
  let detail = await a.tasks.getMyTask(meta(tech), job.taskId);
  const early = media.add(tech.subject);
  assert.equal(
    await errorCode(
      a.tasks.attachEvidence(
        meta(tech),
        job.taskId,
        'BEFORE',
        0,
        { expectedRevision: detail.task.version, mediaObjectId: early },
        key(),
      ),
    ),
    'TASK_STAGE_INVALID',
  );
  detail = await step(tech, detail, 'depart');
  detail = await step(tech, detail, 'arrive');
  for (const [object, expected] of [
    [media.add(other.subject), 'EVIDENCE_INVALID'],
    [media.add(tech.subject, { status: 'RESERVED' }), 'EVIDENCE_INVALID'],
    [media.add(tech.subject, { contentType: 'image/svg+xml' }), 'EVIDENCE_INVALID'],
    [media.add(tech.subject, { purpose: 'PROFILE' }), 'EVIDENCE_INVALID'],
    [randomUUID(), 'EVIDENCE_INVALID'],
  ] as const) {
    assert.equal(
      await errorCode(
        a.tasks.attachEvidence(
          meta(tech),
          job.taskId,
          'BEFORE',
          0,
          { expectedRevision: detail.task.version, mediaObjectId: object },
          key(),
        ),
      ),
      expected,
    );
  }
  assert.equal(
    await errorCode(a.tasks.start(meta(tech), job.taskId, detail.task.version, key())),
    'EVIDENCE_REQUIRED',
  );
  detail = await attach(tech, detail, 'BEFORE', 0);
  const firstObject = detail.evidence.find((e) => e.removedAt === null)!.mediaObjectId;
  detail = await attach(tech, detail, 'BEFORE', 0);
  assert.equal(detail.evidence.length, 2);
  assert.equal(detail.evidence.filter((e) => e.removedAt === null).length, 1);
  // The replaced object can never be linked again, here or to another task.
  const otherJob = await accepted(tech);
  assert.equal(
    await errorCode(
      a.tasks.attachEvidence(
        meta(tech),
        job.taskId,
        'BEFORE',
        1,
        { expectedRevision: detail.task.version, mediaObjectId: firstObject },
        key(),
      ),
    ),
    'EVIDENCE_IN_USE',
  );
  const otherDetail = await a.tasks.getMyTask(meta(tech), otherJob.taskId);
  assert.equal(otherDetail.evidence.length, 0);
  // Removal leaves an audit trail and re-blocks the start gate.
  detail = (
    await a.tasks.removeEvidence(
      meta(tech),
      job.taskId,
      'BEFORE',
      0,
      { expectedRevision: detail.task.version },
      key(),
    )
  ).value;
  assert.equal(
    await errorCode(a.tasks.start(meta(tech), job.taskId, detail.task.version, key())),
    'EVIDENCE_REQUIRED',
  );
  assert.equal(
    await n(
      `SELECT count(*)::int AS n FROM app.audit_entry WHERE target_id = $1::uuid AND action LIKE 'task.evidence-%'`,
      job.taskId,
    ),
    3,
  );
});

test('media retry: Media down is 503 with nothing written; the retry re-uses the same claim', async () => {
  const tech = technician();
  const job = await accepted(tech);
  let detail = await a.tasks.getMyTask(meta(tech), job.taskId);
  detail = await step(tech, detail, 'depart');
  detail = await step(tech, detail, 'arrive');
  const objectId = media.add(tech.subject);
  const idem = key();
  media.unavailable = true;
  try {
    assert.equal(
      await errorCode(
        a.tasks.attachEvidence(
          meta(tech),
          job.taskId,
          'BEFORE',
          0,
          { expectedRevision: detail.task.version, mediaObjectId: objectId },
          idem,
        ),
      ),
      'EVIDENCE_UNAVAILABLE',
    );
  } finally {
    media.unavailable = false;
  }
  assert.equal((await a.store.findTask(job.taskId))!.version, detail.task.version);
  const body = { expectedRevision: detail.task.version, mediaObjectId: objectId };
  const first = await a.tasks.attachEvidence(meta(tech), job.taskId, 'BEFORE', 0, body, idem);
  const replay = await b.tasks.attachEvidence(meta(tech), job.taskId, 'BEFORE', 0, body, idem);
  assert.equal(replay.replayed, true);
  assert.equal(first.value.task.version, replay.value.task.version);
  assert.equal(media.claims.get(objectId)?.size, 1, 'one deterministic claim reference');
});

test('stale screens: wrong revision 412, same key different body 409, refresh from another replica', async () => {
  const tech = technician();
  const job = await accepted(tech);
  const detail = await a.tasks.getMyTask(meta(tech), job.taskId);
  const idem = key();
  await a.tasks.depart(meta(tech), job.taskId, detail.task.version, idem);
  // Reconnect: the same request replays from the other replica.
  const replay = await b.tasks.depart(meta(tech), job.taskId, detail.task.version, idem);
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.task.stage, 'EN_ROUTE');
  assert.equal(
    await errorCode(b.tasks.depart(meta(tech), job.taskId, detail.task.version, key())),
    'REVISION_CONFLICT',
  );
  assert.equal(
    await errorCode(b.tasks.depart(meta(tech), job.taskId, replay.value.task.version, key())),
    'TASK_STAGE_INVALID',
  );
  assert.equal(
    await errorCode(b.tasks.arrive(meta(tech), job.taskId, detail.task.version, key())),
    'REVISION_CONFLICT',
  );
  // Same key, same operation, different body: a conflict, never a silent replay.
  assert.equal(
    await errorCode(b.tasks.depart(meta(tech), job.taskId, replay.value.task.version, idem)),
    'IDEMPOTENCY_CONFLICT',
  );
  const refreshed = await b.tasks.getMyTask(meta(tech), job.taskId);
  assert.equal(refreshed.task.stage, 'EN_ROUTE');
  const jobs = await b.tasks.listMyJobs(meta(tech));
  assert.ok(jobs.tasks.some((task) => task.id === job.taskId));
});

test('cash handoff: not collected then one late declaration; amounts exact; never reopens', async () => {
  const tech = technician();
  const { taskId, detail } = await toFinished(tech);
  const idem = key();
  const body = {
    expectedRevision: detail.task.version,
    collection: { outcome: 'CASH_NOT_COLLECTED' as const, reason: 'العميل غير موجود' },
  };
  const closed = (await a.tasks.close(meta(tech), taskId, body, idem)).value;
  assert.equal((await b.tasks.close(meta(tech), taskId, body, idem)).replayed, true);
  assert.equal(closed.task.collection?.outcome, 'CASH_NOT_COLLECTED');
  assert.equal(
    await errorCode(a.tasks.close(meta(tech), taskId, body, key())),
    'TASK_STAGE_INVALID',
  );
  const late = (
    await a.tasks.declareLateCash(
      meta(tech),
      taskId,
      { expectedRevision: closed.task.version, amount: SYP_15000 },
      key(),
    )
  ).value;
  assert.equal(late.task.stage, 'CLOSED');
  assert.equal(late.task.collection?.lateAmountMinor, 1_500_000n);
  assert.equal(
    await errorCode(
      a.tasks.declareLateCash(
        meta(tech),
        taskId,
        { expectedRevision: late.task.version, amount: SYP_15000 },
        key(),
      ),
    ),
    'COLLECTION_NOT_OPEN',
  );
  assert.equal(
    await errorCode(a.tasks.depart(meta(tech), taskId, late.task.version, key())),
    'TASK_STAGE_INVALID',
  );
  const [row] = await q<{
    collection_amount_minor: string | null;
    late_amount_minor: string;
    collection_currency: string;
  }>(
    `SELECT collection_amount_minor::text, late_amount_minor::text, collection_currency FROM app.task WHERE id = $1::uuid`,
    taskId,
  );
  assert.deepEqual(row, {
    collection_amount_minor: null,
    late_amount_minor: '1500000',
    collection_currency: 'SYP',
  });
  const declared = await q<{ payload: string }>(
    `SELECT payload FROM app.outbox_message WHERE event_type = 'dispatch.cash-declared.v1'
      AND payload::jsonb #>> '{data,taskId}' = $1 ORDER BY created_at`,
    taskId,
  );
  assert.deepEqual(
    declared.map(
      (r) => (JSON.parse(r.payload) as { data: { late: boolean; amount: unknown } }).data,
    ),
    [
      {
        bookingId: closed.task.bookingId,
        taskId,
        outcome: 'CASH_NOT_COLLECTED',
        amount: null,
        late: false,
      },
      {
        bookingId: closed.task.bookingId,
        taskId,
        outcome: 'CASH_NOT_COLLECTED',
        amount: { currency: 'SYP', amountMinor: '1500000', scale: 2 },
        late: true,
      },
    ],
  );
});

test('release before departure returns the job to operations; notes are append-only', async () => {
  const tech = technician();
  const job = await accepted(tech);
  const detail = await a.tasks.getMyTask(meta(tech), job.taskId);
  await a.tasks.addNote(meta(tech), job.taskId, { kind: 'HELP', text: 'لا أجد المدخل' }, key());
  const released = (
    await a.tasks.release(
      meta(tech),
      job.taskId,
      { expectedRevision: detail.task.version, reason: 'ظرف طارئ في الطريق' },
      key(),
    )
  ).value;
  assert.equal(released.task.stage, 'RELEASED');
  assert.equal(released.notes.length, 1);
  const offer = (await a.store.findOffer(job.offerId))!;
  assert.equal(offer.withdrawReason, 'RELEASED_BY_TECHNICIAN');
  const assignment = (await a.store.findAssignment(job.assignmentId))!;
  assert.equal(assignment.status, 'UNASSIGNED');
  await a.service.offer(
    meta(OPS),
    job.assignmentId,
    {
      expectedRevision: assignment.version,
      resourceId: randomUUID(),
      technicianSubject: randomUUID(),
    },
    key(),
  );
  assert.equal(
    await errorCode(
      a.tasks.addNote(meta(tech), job.taskId, { kind: 'HELP', text: 'مرة أخرى' }, key()),
    ),
    'TASK_CLOSED',
  );
  await assert.rejects(
    a.prisma.client.$executeRawUnsafe(
      `DELETE FROM app.task_note WHERE task_id = $1::uuid`,
      job.taskId,
    ),
  );
});

test('slot released by Scheduling: an open task is cancelled, a completed one is kept', async () => {
  const tech = technician();
  const open = await accepted(tech);
  await deliver(a, holdChangedEvent(open.hold, 3, 'RELEASED'));
  assert.equal((await a.store.findTask(open.taskId))!.stage, 'CANCELLED');
  const done = await toFinished(technician());
  await a.tasks.close(
    meta(done.tech),
    done.taskId,
    { expectedRevision: done.detail.task.version, collection: { outcome: 'NOT_CASH' } },
    key(),
  );
  const result = await deliver(a, holdChangedEvent(done.hold, 3, 'RELEASED'));
  assert.equal(result.effect, 'COMPLETED_KEPT');
  assert.equal((await a.store.findTask(done.taskId))!.stage, 'CLOSED');
  assert.equal((await a.store.findAssignment(done.assignmentId))!.status, 'ASSIGNED');
});

test('database refuses impossible tasks even from a defective writer', async () => {
  const tech = technician();
  const job = await accepted(tech);
  const exec = (sql: string) => a.prisma.client.$executeRawUnsafe(sql, job.taskId);
  // Skipping stages.
  await assert.rejects(
    exec(
      `UPDATE app.task SET stage = 'IN_SERVICE', departed_at = now(), arrived_at = now(), arrival_method = 'MANUAL_CONFIRMATION', started_at = now(), version = version + 1 WHERE id = $1::uuid`,
    ),
  );
  // Starting without a before photo, even with consistent timestamps.
  await exec(
    `UPDATE app.task SET stage = 'EN_ROUTE', departed_at = now(), version = version + 1 WHERE id = $1::uuid`,
  );
  await exec(
    `UPDATE app.task SET stage = 'ARRIVED', arrived_at = now(), arrival_method = 'MANUAL_CONFIRMATION', version = version + 1 WHERE id = $1::uuid`,
  );
  await assert.rejects(
    exec(
      `UPDATE app.task SET stage = 'IN_SERVICE', started_at = now(), version = version + 1 WHERE id = $1::uuid`,
    ),
    /TASK_BEFORE_EVIDENCE_REQUIRED/,
  );
  // Version must step by exactly one; identity columns are immutable.
  await assert.rejects(
    exec(`UPDATE app.task SET condition_note = 'x', version = version + 5 WHERE id = $1::uuid`),
    /TASK_VERSION_STEP/,
  );
  await assert.rejects(
    exec(
      `UPDATE app.task SET technician_subject = gen_random_uuid(), version = version + 1 WHERE id = $1::uuid`,
    ),
    /TASK_IMMUTABLE_FIELD/,
  );
  // Money without currency, negative money.
  const done = await toFinished(technician());
  const execDone = (sql: string) => a.prisma.client.$executeRawUnsafe(sql, done.taskId);
  await assert.rejects(
    execDone(
      `UPDATE app.task SET stage = 'CLOSED', closed_at = now(), collection_outcome = 'CASH_COLLECTED', collection_amount_minor = 100, collection_declared_at = now(), version = version + 1 WHERE id = $1::uuid`,
    ),
  );
  await assert.rejects(
    execDone(
      `UPDATE app.task SET stage = 'CLOSED', closed_at = now(), collection_outcome = 'CASH_COLLECTED', collection_currency = 'SYP', collection_scale = 2, collection_amount_minor = -1, collection_declared_at = now(), version = version + 1 WHERE id = $1::uuid`,
    ),
  );
  await a.tasks.close(
    meta(done.tech),
    done.taskId,
    { expectedRevision: done.detail.task.version, collection: { outcome: 'NOT_CASH' } },
    key(),
  );
  // A CLOSED task cannot be edited or withdrawn; evidence links cannot be deleted.
  await assert.rejects(
    execDone(
      `UPDATE app.task SET condition_note = 'edited', version = version + 1 WHERE id = $1::uuid`,
    ),
    /TASK_CLOSED_IMMUTABLE/,
  );
  await assert.rejects(
    execDone(
      `UPDATE app.task SET stage = 'WITHDRAWN', ended_at = now(), end_reason = 'REASSIGNED', version = version + 1 WHERE id = $1::uuid`,
    ),
    /TASK_CLOSED_IMMUTABLE/,
  );
  await assert.rejects(
    execDone(`DELETE FROM app.task_evidence WHERE task_id = $1::uuid`),
    /TASK_EVIDENCE_APPEND_ONLY/,
  );
});
