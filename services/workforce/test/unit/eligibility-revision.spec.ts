import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkforceService } from '../../src/application';
import {
  ELIGIBILITY_CHANGED_V1,
  changeProfile,
  createOperator,
  eligibilityChangedEvent,
  recordSkillChange,
  setEmployment,
  setSuspension,
  setVerificationProjection,
  type OperatorState,
} from '../../src/domain';
import type { Actor, RequestMeta } from '../../src/ports';
import { MemoryStore } from './memory-store';

const now = new Date('2026-10-07T10:00:00.000Z');
const later = new Date('2026-10-07T11:00:00.000Z');
const OPERATOR = '11111111-1111-4111-8111-111111111111';
const SUBJECT = '22222222-2222-4222-8222-222222222222';
const ZONE = '33333333-3333-4333-8333-333333333333';
const CORRELATION = '44444444-4444-4444-8444-444444444444';

function operator(): OperatorState {
  return createOperator({
    id: OPERATOR,
    identitySubject: SUBJECT,
    displayName: 'Operator One',
    homeZoneId: ZONE,
    now,
  });
}

test('a new operator starts at version 1 and eligibility revision 1', () => {
  const state = operator();
  assert.equal(state.version, 1);
  assert.equal(state.eligibilityRevision, 1);
});

test('every eligibility input change bumps both version and eligibility revision', () => {
  const base = operator();
  const cases: Array<[string, OperatorState]> = [
    ['employment', setEmployment(base, 'INACTIVE', later)],
    ['suspension', setSuspension(base, 'SAFETY', later)],
    ['verification status', setVerificationProjection(base, 'PENDING', null, later)],
    ['skills', recordSkillChange(base, later)],
  ];
  for (const [label, next] of cases) {
    assert.equal(next.version, 2, label);
    assert.equal(next.eligibilityRevision, 2, label);
    assert.equal(next.updatedAt, later, label);
  }
});

test('verification validity alone is an eligibility input', () => {
  const verified = setVerificationProjection(
    operator(),
    'VERIFIED',
    new Date('2027-01-01T00:00:00.000Z'),
    now,
  );
  const extended = setVerificationProjection(
    verified,
    'VERIFIED',
    new Date('2028-01-01T00:00:00.000Z'),
    later,
  );
  assert.equal(extended.eligibilityRevision, verified.eligibilityRevision + 1);
  const same = setVerificationProjection(
    extended,
    'VERIFIED',
    new Date('2028-01-01T00:00:00.000Z'),
    later,
  );
  assert.equal(same.version, extended.version + 1, 'the projection still records a version');
  assert.equal(same.eligibilityRevision, extended.eligibilityRevision, 'no input changed');
});

test('no-op inputs and profile changes never move the eligibility revision', () => {
  const base = operator();
  assert.equal(setEmployment(base, 'ACTIVE', later), base);
  assert.equal(setSuspension(base, null, later), base);
  const renamed = changeProfile(base, { displayName: 'Operator Renamed' }, later);
  assert.equal(renamed.version, 2);
  assert.equal(renamed.eligibilityRevision, 1);
});

test('the event is envelope v2 on aggregate capacity-resource at the eligibility revision', () => {
  const next = setSuspension(operator(), 'OPERATIONS', later);
  const event = eligibilityChangedEvent({
    eventId: '55555555-5555-4555-8555-555555555555',
    correlationId: CORRELATION,
    actor: { kind: 'account', id: SUBJECT },
    operator: next,
    eligibility: 'INELIGIBLE',
  });
  assert.deepEqual(event, {
    eventId: '55555555-5555-4555-8555-555555555555',
    eventType: ELIGIBILITY_CHANGED_V1,
    envelopeVersion: 2,
    producer: 'workforce',
    occurredAt: later.toISOString(),
    correlationId: CORRELATION,
    causationId: null,
    traceparent: null,
    aggregate: { type: 'capacity-resource', id: OPERATOR, version: 2 },
    actor: { kind: 'account', id: SUBJECT },
    data: { eligibility: 'INELIGIBLE' },
  });
});

const OPS: Actor = { kind: 'USER', subject: CORRELATION, permissions: ['operations.dispatch'] };
const meta = (actor: Actor): RequestMeta => ({ actor, correlationId: CORRELATION });

function harness() {
  const store = new MemoryStore();
  store.operators.set(OPERATOR, operator());
  let n = 0;
  const service = new WorkforceService(
    store,
    store,
    { now: () => later },
    { next: () => `66666666-6666-4666-8666-${String(++n).padStart(12, '0')}` },
  );
  return { store, service };
}

test('service: one event per eligibility revision, none for no-ops or profile edits', async () => {
  const { store, service } = harness();
  await service.setOperatorState(meta(OPS), OPERATOR, { suspensionReason: 'SAFETY' });
  await service.setOperatorState(meta(OPS), OPERATOR, { suspensionReason: 'SAFETY' });
  await service.grantSkill(meta(OPS), OPERATOR, 'exterior-wash');
  await service.revokeSkill(meta(OPS), OPERATOR, 'exterior-wash');
  await service.setOperatorState(meta(OPS), OPERATOR, {
    employmentStatus: 'INACTIVE',
    suspensionReason: null,
  });
  const events = store.outbox.map((entry) => entry.event);
  assert.ok(events.every((event) => event.eventType === ELIGIBILITY_CHANGED_V1));
  // suspension(2), grant(3), revoke(4), employment+unsuspend in one command (6)
  assert.deepEqual(
    events.map((event) => ('aggregate' in event ? event.aggregate.version : -1)),
    [2, 3, 4, 6],
  );
  const state = store.operators.get(OPERATOR);
  assert.equal(state?.eligibilityRevision, 6);
  assert.equal(state?.version, 6);
  assert.ok(
    store.outbox.every((entry) => entry.routingKey === ELIGIBILITY_CHANGED_V1),
    'routing key = event type',
  );
});

test('service: the event data is only the eligibility state; no subject or profile data', async () => {
  const { store, service } = harness();
  await service.setOperatorState(meta(OPS), OPERATOR, { suspensionReason: 'COMPLIANCE' });
  const [entry] = store.outbox;
  assert.ok(entry);
  const raw = JSON.stringify(entry.event.data);
  assert.equal(raw, '{"eligibility":"INELIGIBLE"}');
  assert.ok(!JSON.stringify(entry.event).includes('Operator One'));
  assert.ok(!JSON.stringify(entry.event).includes(SUBJECT), 'technician subject never leaks');
});
