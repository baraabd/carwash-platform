import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEDULING_HOLD_CHANGED_V1 } from '@carwash/event-contracts';
import {
  DispatchError,
  accept,
  assignmentChangedEvent,
  cancel,
  createOffer,
  decideHoldChange,
  decline,
  expire,
  isDue,
  markAssigned,
  markOffered,
  markUnassigned,
  offerTtlSeconds,
  openAssignment,
  uuid,
  withdraw,
  type AssignmentState,
  type OfferState,
} from '../../src/domain';
import { canonicalJson, fingerprint, parseHoldChanged } from '../../src/application';

const T0 = new Date('2026-10-10T08:00:00.000Z');
const ID = {
  assignment: '7d0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e01',
  booking: '7d0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e02',
  hold: '7d0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e03',
  zone: '7d0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e04',
  offer: '7d0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e05',
  resource: '7d0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e06',
  tech: '7d0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e07',
  event: '7d0c0a3e-5f1b-4d6a-8f0e-1a2b3c4d5e08',
};

const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function job(): AssignmentState {
  return openAssignment({
    id: ID.assignment,
    bookingId: ID.booking,
    holdId: ID.hold,
    zoneId: ID.zone,
    startsAt: at(120),
    endsAt: at(180),
    now: T0,
  });
}

function offerFor(assignment: AssignmentState, ttlSeconds = 900, now = T0): OfferState {
  return createOffer({
    id: ID.offer,
    assignmentId: assignment.id,
    resourceId: ID.resource,
    technicianSubject: ID.tech,
    ttlSeconds,
    jobEndsAt: assignment.endsAt,
    createdBy: 'user:ops',
    now,
  });
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DispatchError) return error.code;
    return (error as Error).message;
  }
  return 'OK';
}

test('a new assignment is UNASSIGNED at revision 1 and needs a positive window', () => {
  const a = job();
  assert.equal(a.status, 'UNASSIGNED');
  assert.equal(a.version, 1);
  assert.equal(
    code(() =>
      openAssignment({ ...a, startsAt: at(10), endsAt: at(10), now: T0, holdId: ID.hold }),
    ),
    'INVALID_INPUT',
  );
});

test('offer -> accept assigns the resource; every step advances the revision by one', () => {
  const offered = markOffered(job(), T0);
  assert.equal(offered.status, 'OFFERED');
  assert.equal(offered.version, 2);
  const offer = offerFor(offered);
  const accepted = accept(offer, at(1));
  const assigned = markAssigned(offered, accepted, at(1));
  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal(assigned.status, 'ASSIGNED');
  assert.equal(assigned.resourceId, ID.resource);
  assert.equal(assigned.technicianSubject, ID.tech);
  assert.equal(assigned.version, 3);
});

test('only one live offer: offering an OFFERED or ASSIGNED job is refused', () => {
  const offered = markOffered(job(), T0);
  assert.equal(
    code(() => markOffered(offered, T0)),
    'LIVE_OFFER_EXISTS',
  );
  const assigned = markAssigned(offered, accept(offerFor(offered), T0), T0);
  assert.equal(
    code(() => markOffered(assigned, T0)),
    'ASSIGNMENT_ALREADY_ASSIGNED',
  );
});

test('a job cannot be offered once its window has ended', () => {
  assert.equal(
    code(() => markOffered(job(), at(180))),
    'JOB_WINDOW_PASSED',
  );
  assert.equal(markOffered(job(), at(179)).status, 'OFFERED');
});

test('expiry is decided by the clock: due exactly at expiresAt, live one ms earlier', () => {
  const offer = offerFor(markOffered(job(), T0), 60);
  assert.equal(offer.expiresAt.toISOString(), at(1).toISOString());
  assert.equal(isDue(offer, new Date(at(1).getTime() - 1)), false);
  assert.equal(isDue(offer, at(1)), true);
  assert.equal(
    code(() => accept(offer, at(1))),
    'OFFER_EXPIRED',
  );
  assert.equal(accept(offer, new Date(at(1).getTime() - 1)).status, 'ACCEPTED');
  assert.equal(expire(offer, at(1)).status, 'EXPIRED');
  assert.equal(
    code(() => expire(offer, at(0))),
    'OFFER_NOT_DUE',
  );
});

test('an offer never outlives the job window', () => {
  const offered = markOffered(job(), at(170));
  const offer = offerFor(offered, 3600, at(170));
  assert.equal(offer.expiresAt.toISOString(), at(180).toISOString());
});

test('stale-offer fence: declined, expired or withdrawn offers can never be accepted', () => {
  const offered = markOffered(job(), T0);
  const offer = offerFor(offered);
  for (const terminal of [
    decline(offer, 'TOO_FAR', T0),
    expire(offer, at(16)),
    withdraw(offer, 'REASSIGNED', T0),
  ]) {
    assert.equal(
      code(() => accept(terminal, T0)),
      'OFFER_NOT_LIVE',
    );
  }
  // An accepted offer can still be withdrawn (operations reassigns the job).
  assert.equal(withdraw(accept(offer, T0), 'REASSIGNED', T0).status, 'WITHDRAWN');
  // Withdrawing a terminal offer is a no-op.
  const declined = decline(offer, 'OTHER', T0);
  assert.equal(withdraw(declined, 'JOB_CANCELLED', T0), declined);
});

test('markAssigned refuses an offer of another assignment or a non-OFFERED job', () => {
  const offered = markOffered(job(), T0);
  const foreign = { ...offerFor(offered), assignmentId: ID.booking };
  assert.equal(
    code(() => markAssigned(offered, foreign, T0)),
    'OFFER_NOT_LIVE',
  );
  assert.equal(
    code(() => markAssigned(job(), offerFor(job()), T0)),
    'OFFER_NOT_LIVE',
  );
});

test('cancellation is terminal and clears the resource; unassign of a cancelled job fails', () => {
  const offered = markOffered(job(), T0);
  const assigned = markAssigned(offered, accept(offerFor(offered), T0), T0);
  const cancelled = cancel(assigned, 'HOLD_RELEASED', at(5));
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.resourceId, null);
  assert.equal(cancelled.cancelReason, 'HOLD_RELEASED');
  assert.equal(cancel(cancelled, 'HOLD_EXPIRED', at(6)), cancelled);
  assert.equal(
    code(() => markUnassigned(cancelled, at(6))),
    'ASSIGNMENT_CANCELLED',
  );
  assert.equal(
    code(() => markOffered(cancelled, at(6))),
    'ASSIGNMENT_CANCELLED',
  );
});

test('offer TTL bounds are enforced', () => {
  assert.equal(offerTtlSeconds(undefined), 900);
  assert.equal(offerTtlSeconds(60), 60);
  assert.equal(offerTtlSeconds(3600), 3600);
  for (const bad of [59, 3601, 1.5, Number.NaN]) {
    assert.equal(
      code(() => offerTtlSeconds(bad)),
      'INVALID_INPUT',
    );
  }
});

test('hold watermark: only strictly newer revisions are applied', () => {
  assert.equal(decideHoldChange(null, { version: 2, state: 'COMMITTED' }), 'OPEN');
  assert.equal(decideHoldChange(null, { version: 1, state: 'HELD' }), 'NOTE');
  assert.equal(decideHoldChange(null, { version: 3, state: 'RELEASED' }), 'CANCEL');
  assert.equal(decideHoldChange(null, { version: 3, state: 'EXPIRED' }), 'CANCEL');
  const released = { holdId: ID.hold, version: 3, state: 'RELEASED' as const };
  // A late COMMITTED (v2) after RELEASED (v3) must never reopen the job.
  assert.equal(decideHoldChange(released, { version: 2, state: 'COMMITTED' }), 'STALE');
  assert.equal(decideHoldChange(released, { version: 3, state: 'RELEASED' }), 'STALE');
  assert.equal(
    decideHoldChange(
      { ...released, version: 1, state: 'HELD' },
      { version: 2, state: 'COMMITTED' },
    ),
    'OPEN',
  );
});

test('assignment-changed event: envelope v2, opaque ids, resource only when ASSIGNED', () => {
  const offered = markOffered(job(), T0);
  const assigned = markAssigned(offered, accept(offerFor(offered), T0), T0);
  const event = assignmentChangedEvent({
    eventId: ID.event,
    correlationId: ID.event,
    causationId: null,
    actor: { kind: 'account', id: ID.tech },
    assignment: assigned,
  });
  assert.equal(event.envelopeVersion, 2);
  assert.equal(event.producer, 'dispatch');
  assert.deepEqual(event.aggregate, { type: 'assignment', id: ID.assignment, version: 3 });
  assert.deepEqual(Object.keys(event.data).sort(), [
    'bookingId',
    'endsAt',
    'resourceId',
    'startsAt',
    'status',
    'zoneId',
  ]);
  assert.equal(event.data.resourceId, ID.resource);
  assert.equal(
    code(() =>
      assignmentChangedEvent({
        eventId: ID.event,
        correlationId: ID.event,
        causationId: null,
        actor: { kind: 'system', id: null },
        assignment: { ...assigned, resourceId: null },
      }),
    ),
    'INCONSISTENT_ASSIGNMENT_RESOURCE',
  );
  assert.equal(
    code(() =>
      assignmentChangedEvent({
        eventId: 'nope',
        correlationId: ID.event,
        causationId: null,
        actor: { kind: 'system', id: null },
        assignment: assigned,
      }),
    ),
    'INVALID_EVENT_UUID',
  );
});

function holdChanged(overrides: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return {
    eventId: ID.event,
    eventType: SCHEDULING_HOLD_CHANGED_V1.eventType,
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: T0.toISOString(),
    correlationId: ID.event,
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: ID.hold, version: 2 },
    actor: { kind: 'service', id: 'booking' },
    data: {
      state: 'COMMITTED',
      zoneId: ID.zone,
      startsAt: at(120).toISOString(),
      endsAt: at(180).toISOString(),
      bookingId: ID.booking,
      ...data,
    },
    ...overrides,
  };
}

test('hold-changed is parsed by the PUBLISHED contract parser', () => {
  const parsed = parseHoldChanged(holdChanged());
  assert.equal(parsed.holdId, ID.hold);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.bookingId, ID.booking);
  assert.equal(parsed.startsAt.toISOString(), at(120).toISOString());
  const rejects = [
    holdChanged({ producer: 'booking' }),
    holdChanged({ extra: 1 }),
    holdChanged({}, { bookingId: null }),
    holdChanged({}, { state: 'RELEASED' }),
    holdChanged({}, { endsAt: at(120).toISOString() }),
    holdChanged({ aggregate: { type: 'hold', id: ID.hold, version: 0 } }),
    holdChanged({}, { customerPhone: '0999' }),
  ];
  for (const raw of rejects) assert.throws(() => parseHoldChanged(raw));
});

test('idempotency fingerprint is canonical: key order and Unicode composition do not matter', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(fingerprint({ a: 1, b: 'é' }), fingerprint({ b: 'é', a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
});

test('uuid() normalises case and rejects anything else', () => {
  assert.equal(uuid(ID.hold.toUpperCase(), 'x'), ID.hold);
  assert.equal(
    code(() => uuid('not-a-uuid', 'x')),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => uuid(42, 'x')),
    'INVALID_INPUT',
  );
});
