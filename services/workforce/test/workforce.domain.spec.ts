import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkforceError,
  approveVerification,
  createOperator,
  createShift,
  createVerificationCase,
  operationalReadiness,
  setVerificationProjection,
} from '../src/domain';

const ids = {
  operator: '11111111-1111-4111-8111-111111111111',
  subject: '22222222-2222-4222-8222-222222222222',
  zone: '33333333-3333-4333-8333-333333333333',
  evidence: '44444444-4444-4444-8444-444444444444',
  case: '55555555-5555-4555-8555-555555555555',
};
const now = new Date('2026-10-07T10:00:00.000Z');

test('workforce domain: readiness requires active employment, verification and a skill', () => {
  const base = createOperator({
    id: ids.operator,
    identitySubject: ids.subject,
    displayName: 'Operator One',
    homeZoneId: ids.zone,
    now,
  });
  assert.deepEqual(operationalReadiness(base, [], now).reasons, [
    'VERIFICATION_REQUIRED',
    'NO_SKILLS',
  ]);
  const verified = setVerificationProjection(
    base,
    'VERIFIED',
    new Date('2027-10-07T10:00:00.000Z'),
    now,
  );
  assert.deepEqual(operationalReadiness(verified, ['exterior-wash'], now), {
    ready: true,
    reasons: [],
  });
});

test('workforce domain: a reviewer cannot decide their own verification case', () => {
  const operator = createOperator({
    id: ids.operator,
    identitySubject: ids.subject,
    displayName: 'Operator One',
    homeZoneId: ids.zone,
    now,
  });
  const verification = createVerificationCase({
    id: ids.case,
    operator,
    evidenceRefs: [ids.evidence],
    submittedBy: ids.subject,
    requester: `user:${ids.subject}`,
    idempotencyKey: 'verify-key-0001',
    requestFingerprint: 'a'.repeat(64),
    now,
  });
  assert.throws(
    () =>
      approveVerification(
        verification,
        operator,
        ids.subject,
        new Date('2027-01-01T00:00:00.000Z'),
        now,
      ),
    (error: unknown) =>
      error instanceof WorkforceError &&
      error.code === 'SELF_REVIEW_FORBIDDEN',
  );
});

test('workforce domain: a shift is half-open, bounded and starts active', () => {
  const shift = createShift({
    id: '66666666-6666-4666-8666-666666666666',
    operatorId: ids.operator,
    zoneId: ids.zone,
    startsAt: new Date('2026-10-07T11:00:00.000Z'),
    endsAt: new Date('2026-10-07T19:00:00.000Z'),
    requester: `user:${ids.subject}`,
    idempotencyKey: 'shift-key-0001',
    requestFingerprint: 'b'.repeat(64),
    now,
  });
  assert.equal(shift.status, 'ACTIVE');
  assert.equal(shift.version, 1);
});
