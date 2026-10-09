import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKFORCE_ELIGIBILITY_CHANGED_V1 } from '@carwash/event-contracts';
import {
  CHECKLIST_V1,
  DispatchError,
  arrive,
  cancelTask,
  cashDeclaredEvent,
  closeTask,
  createTask,
  decideEligibility,
  decideObservation,
  declareLateCash,
  depart,
  document,
  evidencePhaseAllowed,
  evidenceSlot,
  finish,
  flagIneligible,
  positiveMoneyFromWire,
  release,
  setCheck,
  setConditionNote,
  startService,
  taskProgressedEvent,
  withdrawTask,
  type CapacityResource,
  type EvidenceLink,
  type TaskState,
} from '../../src/domain';
import { nameUuid, parseEligibilityChanged } from '../../src/application';
import { parseCapacityPage } from '../../src/infrastructure/workforce/workforce-capacity.client';
import { parseEvidenceObject } from '../../src/infrastructure/media/media-evidence.client';

const T0 = new Date('2026-10-10T08:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const ID = {
  task: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e01',
  assignment: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e02',
  offer: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e03',
  booking: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e04',
  resource: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e05',
  tech: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e06',
  zone: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e07',
  event: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e08',
  object: '9a0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e09',
};

function fresh(): TaskState {
  return createTask({
    id: ID.task,
    assignmentId: ID.assignment,
    offerId: ID.offer,
    bookingId: ID.booking,
    resourceId: ID.resource,
    technicianSubject: ID.tech,
    now: T0,
  });
}

function link(phase: 'BEFORE' | 'AFTER', removedAt: Date | null = null): EvidenceLink {
  return {
    id: nameUuid(`x:${phase}:${String(removedAt)}`),
    taskId: ID.task,
    phase,
    slot: 0,
    mediaObjectId: ID.object,
    attachedAt: T0,
    removedAt,
  };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof DispatchError ? error.code : (error as Error).message;
  }
  return 'OK';
}

function arrived(): TaskState {
  return arrive(depart(fresh(), at(1)), at(2));
}

function documenting(): TaskState {
  let task = startService(arrived(), [link('BEFORE')], at(3));
  for (const item of CHECKLIST_V1) task = setCheck(task, item.code, true, at(4));
  return document(task, at(5));
}

function finished(): TaskState {
  return finish(documenting(), [link('AFTER')], at(6));
}

test('a new task is ACCEPTED with the v1 checklist snapshot, all required and unchecked', () => {
  const task = fresh();
  assert.equal(task.stage, 'ACCEPTED');
  assert.equal(task.version, 1);
  assert.deepEqual(
    task.checklist.map((item) => [item.code, item.required, item.checked]),
    [
      ['exterior', true, false],
      ['wheels', true, false],
      ['interior', true, false],
      ['quality', true, false],
    ],
  );
  // The snapshot is a copy: mutating the policy constant is impossible and the
  // task never shares item objects with it.
  assert.notEqual(task.checklist[0], CHECKLIST_V1[0]);
});

test('stages move strictly forward and each step bumps the revision once', () => {
  const route = depart(fresh(), at(1));
  assert.equal(route.stage, 'EN_ROUTE');
  assert.equal(route.version, 2);
  const there = arrive(route, at(2));
  assert.equal(there.stage, 'ARRIVED');
  assert.equal(there.arrivalMethod, 'MANUAL_CONFIRMATION');
  assert.equal(
    code(() => depart(there, at(3))),
    'TASK_STAGE_INVALID',
  );
  assert.equal(
    code(() => arrive(fresh(), at(3))),
    'TASK_STAGE_INVALID',
  );
  assert.equal(
    code(() => document(there, at(3))),
    'TASK_STAGE_INVALID',
  );
  assert.equal(
    code(() => finish(there, [link('AFTER')], at(3))),
    'TASK_STAGE_INVALID',
  );
});

test('gates: one before photo to start, every check to document, one after photo to finish', () => {
  assert.equal(
    code(() => startService(arrived(), [], at(3))),
    'EVIDENCE_REQUIRED',
  );
  // A removed photo does not count.
  assert.equal(
    code(() => startService(arrived(), [link('BEFORE', at(2))], at(3))),
    'EVIDENCE_REQUIRED',
  );
  // An AFTER photo does not satisfy the BEFORE gate.
  assert.equal(
    code(() => startService(arrived(), [link('AFTER')], at(3))),
    'EVIDENCE_REQUIRED',
  );
  let wash = startService(arrived(), [link('BEFORE')], at(3));
  assert.equal(
    code(() => document(wash, at(4))),
    'CHECKLIST_INCOMPLETE',
  );
  for (const item of CHECKLIST_V1.slice(0, 3)) wash = setCheck(wash, item.code, true, at(4));
  assert.equal(
    code(() => document(wash, at(4))),
    'CHECKLIST_INCOMPLETE',
  );
  wash = setCheck(wash, 'quality', true, at(4));
  const after = document(wash, at(5));
  assert.equal(
    code(() => finish(after, [link('BEFORE')], at(6))),
    'EVIDENCE_REQUIRED',
  );
  assert.equal(finish(after, [link('AFTER')], at(6)).stage, 'FINISHED');
});

test('checklist only during service; unknown codes refused; no-op toggles do not bump', () => {
  assert.equal(
    code(() => setCheck(arrived(), 'exterior', true, at(3))),
    'TASK_STAGE_INVALID',
  );
  const wash = startService(arrived(), [link('BEFORE')], at(3));
  assert.equal(
    code(() => setCheck(wash, 'engine', true, at(4))),
    'CHECK_NOT_FOUND',
  );
  assert.equal(setCheck(wash, 'exterior', false, at(4)), wash);
  const checked = setCheck(wash, 'exterior', true, at(4));
  assert.equal(checked.version, wash.version + 1);
  assert.equal(setCheck(checked, 'exterior', false, at(5)).checklist[0]?.checked, false);
});

test('evidence edits are allowed only in their phase stage', () => {
  assert.equal(
    code(() => evidencePhaseAllowed(fresh(), 'BEFORE')),
    'TASK_STAGE_INVALID',
  );
  assert.equal(
    code(() => evidencePhaseAllowed(arrived(), 'BEFORE')),
    'OK',
  );
  assert.equal(
    code(() => evidencePhaseAllowed(arrived(), 'AFTER')),
    'TASK_STAGE_INVALID',
  );
  assert.equal(
    code(() => evidencePhaseAllowed(documenting(), 'AFTER')),
    'OK',
  );
  assert.equal(
    code(() => evidencePhaseAllowed(documenting(), 'BEFORE')),
    'TASK_STAGE_INVALID',
  );
  assert.equal(evidenceSlot('1'), 1);
  assert.equal(
    code(() => evidenceSlot(2)),
    'INVALID_INPUT',
  );
});

test('condition note: ARRIVED or IN_SERVICE, bounded, empty clears', () => {
  const noted = setConditionNote(arrived(), '  خدش بسيط على الباب  ', at(3));
  assert.equal(noted.conditionNote, 'خدش بسيط على الباب');
  assert.equal(setConditionNote(noted, '', at(4)).conditionNote, null);
  assert.equal(
    code(() => setConditionNote(arrived(), 'x'.repeat(801), at(3))),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => setConditionNote(fresh(), 'note', at(3))),
    'TASK_STAGE_INVALID',
  );
  assert.equal(
    code(() => setConditionNote(arrived(), 'bad\u0000char', at(3))),
    'INVALID_INPUT',
  );
});

test('close records the declaration exactly; late cash only after CASH_NOT_COLLECTED, once', () => {
  const amount = positiveMoneyFromWire({ currency: 'SYP', amountMinor: '1500000', scale: 2 }, 'a');
  const paid = closeTask(finished(), { outcome: 'CASH_COLLECTED', amount }, at(7));
  assert.equal(paid.stage, 'CLOSED');
  assert.equal(paid.collection?.amountMinor, 1_500_000n);
  assert.equal(
    code(() => declareLateCash(paid, amount, at(8))),
    'COLLECTION_NOT_OPEN',
  );
  const unpaid = closeTask(
    finished(),
    { outcome: 'CASH_NOT_COLLECTED', reason: 'العميل سيدفع لاحقًا' },
    at(7),
  );
  assert.equal(unpaid.collection?.currency, null);
  const late = declareLateCash(unpaid, amount, at(9));
  assert.equal(late.stage, 'CLOSED');
  assert.equal(late.collection?.lateAmountMinor, 1_500_000n);
  assert.equal(late.collection?.currency, 'SYP');
  assert.equal(
    code(() => declareLateCash(late, amount, at(10))),
    'COLLECTION_NOT_OPEN',
  );
  assert.equal(
    code(() => closeTask(finished(), { outcome: 'CASH_NOT_COLLECTED', reason: 'no' }, at(7))),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => closeTask(documenting(), { outcome: 'NOT_CASH' }, at(7))),
    'TASK_STAGE_INVALID',
  );
});

test('money: integer minor units with the exact scale; floats, negatives and zero refused', () => {
  for (const bad of [
    { currency: 'SYP', amountMinor: 1500, scale: 2 },
    { currency: 'SYP', amountMinor: '15.00', scale: 2 },
    { currency: 'SYP', amountMinor: '0', scale: 2 },
    { currency: 'SYP', amountMinor: '-5', scale: 2 },
    { currency: 'SYP', amountMinor: '100', scale: 0 },
    { currency: 'EUR', amountMinor: '100', scale: 2 },
    { currency: 'SYP', amountMinor: '100', scale: 2, extra: 1 },
    { currency: 'SYP', amountMinor: '1'.repeat(19), scale: 2 },
  ]) {
    assert.equal(
      code(() => positiveMoneyFromWire(bad, 'amount')),
      'INVALID_INPUT',
      JSON.stringify(bad),
    );
  }
  assert.equal(
    positiveMoneyFromWire({ currency: 'USD', amountMinor: '999999999999999999', scale: 2 }, 'a')
      .amountMinor,
    999_999_999_999_999_999n,
  );
});

test('release only before departure; withdraw/cancel never touch a CLOSED task', () => {
  const released = release(fresh(), 'ظرف طارئ', at(1));
  assert.equal(released.stage, 'RELEASED');
  assert.equal(released.endReason, 'RELEASED_BY_TECHNICIAN');
  assert.equal(
    code(() => release(depart(fresh(), at(1)), 'ظرف طارئ', at(2))),
    'TASK_STAGE_INVALID',
  );
  assert.equal(
    code(() => release(fresh(), 'x', at(1))),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => depart(released, at(2))),
    'TASK_CLOSED',
  );
  const closed = closeTask(finished(), { outcome: 'NOT_CASH' }, at(7));
  assert.equal(withdrawTask(closed, 'REASSIGNED', at(8)), closed);
  assert.equal(cancelTask(closed, at(8)), closed);
  assert.equal(withdrawTask(arrived(), 'REASSIGNED', at(8)).stage, 'WITHDRAWN');
  assert.equal(cancelTask(arrived(), at(8)).endReason, 'JOB_CANCELLED');
  const flagged = flagIneligible(arrived(), at(8));
  assert.equal(flagged.attentionReason, 'RESOURCE_INELIGIBLE');
  assert.equal(flagIneligible(flagged, at(9)), flagged);
});

const JOB = { zoneId: ID.zone, startsAt: at(60), endsAt: at(120) };

function resource(overrides: Partial<CapacityResource> = {}): CapacityResource {
  return {
    resourceId: ID.resource,
    revision: 3,
    eligibility: 'ELIGIBLE',
    eligibilityRevision: 4,
    zoneIds: [ID.zone],
    shifts: [{ startsAt: at(0), endsAt: at(240) }],
    ...overrides,
  };
}

test('eligibility: listed, ELIGIBLE, zone and a covering shift; newer INELIGIBLE watermark wins', () => {
  assert.deepEqual(decideEligibility(JOB, resource(), null), {
    eligible: true,
    eligibilityRevision: 4,
  });
  assert.deepEqual(decideEligibility(JOB, null, null), { eligible: false, reason: 'NOT_LISTED' });
  assert.deepEqual(decideEligibility(JOB, resource({ eligibility: 'INELIGIBLE' }), null), {
    eligible: false,
    reason: 'INELIGIBLE',
  });
  assert.deepEqual(decideEligibility(JOB, resource({ zoneIds: [ID.event] }), null), {
    eligible: false,
    reason: 'NOT_LISTED',
  });
  // A shift that ends inside the job window does not cover it.
  assert.deepEqual(
    decideEligibility(JOB, resource({ shifts: [{ startsAt: at(0), endsAt: at(90) }] }), null),
    { eligible: false, reason: 'NO_COVERING_SHIFT' },
  );
  const newer = { resourceId: ID.resource, eligibility: 'INELIGIBLE' as const, revision: 5 };
  assert.deepEqual(decideEligibility(JOB, resource(), newer), {
    eligible: false,
    reason: 'OBSERVED_INELIGIBLE',
  });
  // An older pushed INELIGIBLE does not override a newer ELIGIBLE read.
  const older = { ...newer, revision: 3 };
  assert.equal(decideEligibility(JOB, resource(), older).eligible, true);
  assert.equal(decideObservation(older, newer), 'APPLY');
  assert.equal(decideObservation(newer, newer), 'STALE');
  assert.equal(decideObservation(newer, older), 'STALE');
});

test('published eligibility-changed.v1 parses through the published parser only', () => {
  const raw = {
    eventId: ID.event,
    eventType: 'workforce.eligibility-changed.v1',
    envelopeVersion: 2,
    producer: 'workforce',
    occurredAt: T0.toISOString(),
    correlationId: ID.event,
    causationId: null,
    traceparent: null,
    aggregate: { type: 'capacity-resource', id: ID.resource.toUpperCase(), version: 7 },
    actor: { kind: 'system', id: null },
    data: { eligibility: 'INELIGIBLE' },
  };
  assert.doesNotThrow(() => WORKFORCE_ELIGIBILITY_CHANGED_V1.parse(raw));
  const parsed = parseEligibilityChanged(raw);
  assert.equal(parsed.resourceId, ID.resource);
  assert.equal(parsed.revision, 7);
  assert.throws(() => parseEligibilityChanged({ ...raw, data: { eligibility: 'MAYBE' } }));
  assert.throws(() => parseEligibilityChanged({ ...raw, data: { eligibility: 'ELIGIBLE', x: 1 } }));
});

test('local capacity parser is closed like the published one', () => {
  const good = {
    items: [
      {
        resourceId: ID.resource,
        revision: 1,
        eligibility: 'ELIGIBLE',
        eligibilityRevision: 2,
        zoneIds: [ID.zone],
        shifts: [{ startsAt: at(0).toISOString(), endsAt: at(60).toISOString() }],
      },
    ],
    nextCursor: null,
    asOf: T0.toISOString(),
  };
  assert.equal(parseCapacityPage(good).items.length, 1);
  const item = good.items[0]!;
  for (const bad of [
    { ...good, extra: true },
    { ...good, items: [{ ...item, name: 'x' }] },
    { ...good, items: [{ ...item, zoneIds: [] }] },
    { ...good, items: [{ ...item, eligibility: 'eligible' }] },
    {
      ...good,
      items: [
        { ...item, shifts: [{ startsAt: '2026-10-10T08:00:00Z', endsAt: at(60).toISOString() }] },
      ],
    },
    { ...good, nextCursor: 'bad cursor!' },
  ]) {
    assert.throws(() => parseCapacityPage(bad));
  }
});

test('media object view parsing fails closed', () => {
  const ok = parseEvidenceObject({
    objectId: ID.object,
    status: 'AVAILABLE',
    purpose: 'WORK_EVIDENCE',
    contentType: 'image/jpeg',
    ownerSubjectId: ID.tech.toUpperCase(),
    byteLength: 1,
  });
  assert.equal(ok.ownerSubjectId, ID.tech);
  assert.equal(
    code(() => parseEvidenceObject({ objectId: ID.object })),
    'EVIDENCE_UNAVAILABLE',
  );
});

test('nameUuid is a deterministic RFC 9562 version-8 UUID', () => {
  const a = nameUuid('dispatch.task-evidence:a:b');
  assert.equal(a, nameUuid('dispatch.task-evidence:a:b'));
  assert.notEqual(a, nameUuid('dispatch.task-evidence:a:c'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('task events carry opaque ids and the stage only; cash event amount is exact', () => {
  const task = depart(fresh(), at(1));
  const event = taskProgressedEvent({
    eventId: ID.event,
    correlationId: ID.event,
    causationId: null,
    actor: { kind: 'account', id: ID.tech },
    task,
  });
  assert.deepEqual(Object.keys(event.data).sort(), [
    'assignmentId',
    'bookingId',
    'stage',
    'taskId',
  ]);
  assert.equal(event.aggregate.version, task.version);
  const amount = positiveMoneyFromWire({ currency: 'SYP', amountMinor: '1500000', scale: 2 }, 'a');
  const closed = closeTask(finished(), { outcome: 'CASH_COLLECTED', amount }, at(7));
  const cash = cashDeclaredEvent({
    eventId: ID.event,
    correlationId: ID.event,
    causationId: null,
    actor: { kind: 'account', id: ID.tech },
    task: closed,
    late: false,
  });
  assert.deepEqual(cash.data.amount, { currency: 'SYP', amountMinor: '1500000', scale: 2 });
  const unpaid = closeTask(
    finished(),
    { outcome: 'CASH_NOT_COLLECTED', reason: 'لاحقًا جدًا' },
    at(7),
  );
  assert.equal(
    cashDeclaredEvent({
      ...{ eventId: ID.event, correlationId: ID.event, causationId: null },
      actor: { kind: 'system', id: null },
      task: unpaid,
      late: false,
    }).data.amount,
    null,
  );
  assert.throws(() =>
    cashDeclaredEvent({
      eventId: ID.event,
      correlationId: ID.event,
      causationId: null,
      actor: { kind: 'system', id: null },
      task: unpaid,
      late: true,
    }),
  );
});
