import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  Money,
  PlanRuleError,
  SubscriptionRuleError,
  applyMovement,
  available,
  newPeriod,
  nextReservationStatus,
  normalizePlanTerms,
  planActivation,
  planCancel,
  planFreeze,
  planRenewal,
  planReservation,
  planRevision,
  planUnfreeze,
  revisionInForce,
  viewStatus,
  type PlanTerms,
  type SubscriptionState,
} from '../src/domain';
import {
  entitlementChangedEvent,
  entitlementReservedEvent,
  subscriptionChangedEvent,
} from '../src/application';
import { DAY, termsFixture } from './support/subscription-fixtures';

const T0 = new Date('2026-10-11T08:00:00.000Z');
const terms: PlanTerms = normalizePlanTerms(termsFixture());

function rule(code: string) {
  return (error: unknown) => error instanceof SubscriptionRuleError && error.code === code;
}

function active(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    status: 'ACTIVE',
    version: 2,
    terms,
    currentPeriod: newPeriod(terms, 1, T0),
    ...overrides,
  };
}

test('plan terms: strict parse, canonical package order, exact money', () => {
  const parsed = normalizePlanTerms(termsFixture({ coveredPackageIds: ['interior', 'exterior'] }));
  assert.deepEqual(parsed.coveredPackageIds, ['exterior', 'interior']);
  assert.ok(parsed.price.equals(Money.of('SYP', 4_500_000n)));
  const bad = (overrides: Record<string, unknown>, code: string) =>
    assert.throws(
      () => normalizePlanTerms(termsFixture(overrides)),
      (error: unknown) => error instanceof PlanRuleError && error.code === code,
    );
  bad({ washUnits: 0 }, 'TERMS_MALFORMED');
  bad({ washUnits: 101 }, 'TERMS_MALFORMED');
  bad({ washUnits: 1.5 }, 'TERMS_MALFORMED');
  bad({ periodDays: 367 }, 'TERMS_MALFORMED');
  bad({ coveredPackageIds: [] }, 'TERMS_MALFORMED');
  bad({ coveredPackageIds: ['exterior', 'exterior'] }, 'TERMS_MALFORMED');
  bad({ coveredPackageIds: ['Exterior'] }, 'TERMS_MALFORMED');
  bad({ displayName: ' padded' }, 'TERMS_MALFORMED');
  bad({ displayName: 'line\nbreak' }, 'TERMS_MALFORMED');
  bad({ displayName: 'x'.repeat(81) }, 'TERMS_MALFORMED');
  bad({ price: { currency: 'EUR', amountMinor: '100', scale: 2 } }, 'CURRENCY_UNSUPPORTED');
  bad({ price: { currency: 'SYP', amountMinor: '100', scale: 0 } }, 'CURRENCY_UNSUPPORTED');
  bad({ price: { currency: 'SYP', amountMinor: '1.5', scale: 2 } }, 'TERMS_MALFORMED');
  bad({ price: { currency: 'SYP', amountMinor: '0', scale: 2 } }, 'PRICE_INVALID');
  bad({ extra: true }, 'TERMS_MALFORMED');
  assert.equal(
    normalizePlanTerms(termsFixture({ displayName: 'خطة الغسيل الشهرية' })).displayName,
    'خطة الغسيل الشهرية',
  );
});

test('plan revisions: one linear chain with strictly increasing effective times', () => {
  assert.deepEqual(
    planRevision({ head: null, expectedRevision: 0, effectiveFrom: null, now: T0 }),
    {
      accepted: true,
      revision: 1,
      effectiveFrom: T0,
    },
  );
  const head = { revision: 1, effectiveFrom: T0 };
  const later = new Date(T0.getTime() + DAY);
  assert.equal(
    planRevision({ head, expectedRevision: 0, effectiveFrom: later, now: T0 }).accepted,
    false,
  );
  assert.deepEqual(planRevision({ head, expectedRevision: 1, effectiveFrom: T0, now: T0 }), {
    accepted: false,
    reason: 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS',
  });
  assert.deepEqual(
    planRevision({ head, expectedRevision: 1, effectiveFrom: new Date(T0.getTime() - 1), now: T0 }),
    {
      accepted: false,
      reason: 'EFFECTIVE_FROM_IN_PAST',
    },
  );
  assert.deepEqual(
    planRevision({
      head,
      expectedRevision: 1,
      effectiveFrom: new Date(T0.getTime() + 367 * DAY),
      now: T0,
    }),
    {
      accepted: false,
      reason: 'EFFECTIVE_FROM_TOO_FAR',
    },
  );
  const revisions = [
    { revision: 1, effectiveFrom: T0 },
    { revision: 2, effectiveFrom: later },
  ];
  assert.equal(revisionInForce(revisions, new Date(T0.getTime() - 1)), null);
  assert.equal(revisionInForce(revisions, T0)?.revision, 1);
  assert.equal(revisionInForce(revisions, later)?.revision, 2);
});

test('lifecycle: activation, freeze, unfreeze, cancel and derived expiry', () => {
  const pending: SubscriptionState = {
    status: 'PENDING_ACTIVATION',
    version: 1,
    terms,
    currentPeriod: null,
  };
  const period = planActivation(pending, 1, T0);
  assert.deepEqual(
    {
      no: period.periodNo,
      ends: period.endsAt.toISOString(),
      granted: period.granted,
      used: period.reserved + period.consumed,
    },
    { no: 1, ends: new Date(T0.getTime() + 30 * DAY).toISOString(), granted: 2, used: 0 },
  );
  assert.throws(() => planActivation(pending, 2, T0), rule('VERSION_CONFLICT'));
  assert.throws(() => planActivation(active(), 2, T0), rule('SUBSCRIPTION_NOT_PENDING'));

  planFreeze(active(), 2, T0);
  assert.throws(
    () => planFreeze(active({ status: 'FROZEN' }), 2, T0),
    rule('SUBSCRIPTION_NOT_ACTIVE'),
  );
  assert.throws(
    () => planFreeze(active(), 2, new Date(T0.getTime() + 30 * DAY)),
    rule('PERIOD_ENDED'),
  );
  planUnfreeze(active({ status: 'FROZEN' }), 2);
  assert.throws(() => planUnfreeze(active(), 2), rule('SUBSCRIPTION_NOT_FROZEN'));

  planCancel(pending, 1, true);
  planCancel(active(), 2, false);
  assert.throws(() => planCancel(active(), 2, true), rule('CUSTOMER_MAY_ONLY_CANCEL_PENDING'));
  assert.throws(
    () => planCancel(active({ status: 'CANCELLED' }), 2, false),
    rule('SUBSCRIPTION_CLOSED'),
  );

  assert.equal(viewStatus(active(), new Date(T0.getTime() + 30 * DAY - 1)), 'ACTIVE');
  assert.equal(viewStatus(active(), new Date(T0.getTime() + 30 * DAY)), 'EXPIRED');
  assert.equal(viewStatus(pending, new Date(T0.getTime() + 400 * DAY)), 'PENDING_ACTIVATION');
});

test('renewal: only after the period ended, never overlapping, with the current terms', () => {
  const ended = new Date(T0.getTime() + 30 * DAY);
  assert.throws(
    () => planRenewal(active(), 2, terms, new Date(ended.getTime() - 1)),
    rule('PERIOD_NOT_ENDED'),
  );
  const richer = normalizePlanTerms(termsFixture({ washUnits: 4, periodDays: 7 }));
  const next = planRenewal(active(), 2, richer, ended);
  assert.equal(next.periodNo, 2);
  assert.equal(next.granted, 4);
  assert.equal(next.startsAt.getTime(), ended.getTime());
  assert.equal(next.endsAt.getTime(), ended.getTime() + 7 * DAY);
  assert.throws(
    () => planRenewal(active({ status: 'FROZEN' }), 2, terms, ended),
    rule('SUBSCRIPTION_NOT_ACTIVE'),
  );
});

test('reservation: active, in period, covered package, unit available', () => {
  const at = new Date(T0.getTime() + DAY);
  const reserve = (
    state: SubscriptionState,
    overrides: { packageId?: string; scheduledFor?: Date; now?: Date } = {},
  ) =>
    planReservation({
      state,
      packageId: overrides.packageId ?? 'exterior',
      scheduledFor: overrides.scheduledFor ?? at,
      now: overrides.now ?? at,
    });
  const next = reserve(active());
  assert.equal(next.reserved, 1);
  assert.equal(available(next), 1);
  assert.throws(() => reserve(active({ status: 'FROZEN' })), rule('SUBSCRIPTION_FROZEN'));
  assert.throws(
    () => reserve(active({ status: 'PENDING_ACTIVATION', currentPeriod: null })),
    rule('SUBSCRIPTION_NOT_ACTIVE'),
  );
  assert.throws(() => reserve(active({ status: 'CANCELLED' })), rule('SUBSCRIPTION_NOT_ACTIVE'));
  assert.throws(() => reserve(active(), { packageId: 'full-detail' }), rule('PACKAGE_NOT_COVERED'));
  assert.throws(
    () => reserve(active(), { scheduledFor: new Date(T0.getTime() + 30 * DAY) }),
    rule('SCHEDULE_OUTSIDE_PERIOD'),
  );
  assert.throws(
    () => reserve(active(), { scheduledFor: new Date(T0.getTime() - 1) }),
    rule('SCHEDULE_OUTSIDE_PERIOD'),
  );
  assert.throws(
    () => reserve(active(), { now: new Date(T0.getTime() + 30 * DAY) }),
    rule('PERIOD_ENDED'),
  );
  const full = { ...newPeriod(terms, 1, T0), reserved: 1, consumed: 1 };
  assert.throws(() => reserve(active({ currentPeriod: full })), rule('ENTITLEMENT_EXHAUSTED'));
});

test('movements keep 0 <= reserved, consumed and reserved + consumed <= granted', () => {
  const period = { ...newPeriod(terms, 1, T0), reserved: 1 };
  const committed = applyMovement(period, 'COMMIT');
  assert.deepEqual([committed.reserved, committed.consumed], [0, 1]);
  const reversed = applyMovement(committed, 'REVERSE');
  assert.deepEqual([reversed.reserved, reversed.consumed], [0, 0]);
  assert.throws(
    () => applyMovement(newPeriod(terms, 1, T0), 'RELEASE'),
    rule('ENTITLEMENT_EXHAUSTED'),
  );
  assert.throws(
    () => applyMovement(newPeriod(terms, 1, T0), 'REVERSE'),
    rule('ENTITLEMENT_EXHAUSTED'),
  );
  assert.throws(
    () => applyMovement({ ...period, reserved: 0, consumed: 2 }, 'RESERVE'),
    rule('ENTITLEMENT_EXHAUSTED'),
  );
});

test('reservation transitions: RESERVED -> COMMITTED|RELEASED, COMMITTED -> REVERSED only', () => {
  assert.equal(nextReservationStatus('RESERVED', 'COMMIT'), 'COMMITTED');
  assert.equal(nextReservationStatus('RESERVED', 'RELEASE'), 'RELEASED');
  assert.equal(nextReservationStatus('COMMITTED', 'REVERSE'), 'REVERSED');
  assert.throws(
    () => nextReservationStatus('RELEASED', 'COMMIT'),
    rule('RESERVATION_NOT_RESERVED'),
  );
  assert.throws(
    () => nextReservationStatus('COMMITTED', 'RELEASE'),
    rule('RESERVATION_NOT_RESERVED'),
  );
  assert.throws(
    () => nextReservationStatus('RESERVED', 'REVERSE'),
    rule('RESERVATION_NOT_COMMITTED'),
  );
  assert.throws(
    () => nextReservationStatus('REVERSED', 'REVERSE'),
    rule('RESERVATION_NOT_COMMITTED'),
  );
});

test('outbox events are self-validated envelope v2 rows carrying no payment data', () => {
  const context = (actor: { kind: 'account' | 'service'; id: string }) => ({
    eventId: randomUUID(),
    occurredAt: T0,
    correlationId: randomUUID(),
    actor,
    aggregateId: randomUUID(),
    version: 2,
  });
  const changed = subscriptionChangedEvent(
    {
      customerSubject: randomUUID(),
      planCode: 'monthly-care',
      planRevision: 1,
      previousStatus: 'PENDING_ACTIVATION',
      status: 'ACTIVE',
      periodNo: 1,
      periodEndsAt: new Date(T0.getTime() + 30 * DAY).toISOString(),
      unitsGranted: 2,
    },
    context({ kind: 'account', id: randomUUID() }),
  );
  const envelope = JSON.parse(changed.payload) as Record<string, unknown>;
  assert.equal(envelope.producer, 'subscription');
  assert.equal(changed.routingKey, 'subscription.subscription-changed.v1');
  assert.doesNotMatch(changed.payload, /payment|price|amount/i);
  const reserved = entitlementReservedEvent(
    { subscriptionId: randomUUID(), bookingId: randomUUID(), periodNo: 1 },
    context({ kind: 'service', id: 'booking' }),
  );
  assert.equal(reserved.exchange, 'washgo.subscription.events');
  assert.throws(() =>
    entitlementReservedEvent(
      { subscriptionId: randomUUID(), bookingId: randomUUID(), periodNo: 1 },
      context({ kind: 'service', id: 'not-a-producer' }),
    ),
  );
  const base = { subscriptionId: randomUUID(), bookingId: randomUUID(), periodNo: 1 };
  entitlementChangedEvent(
    { ...base, previousStatus: 'RESERVED', status: 'RELEASED', reason: 'BOOKING_CANCELLED' },
    context({ kind: 'service', id: 'booking' }),
  );
  assert.throws(() =>
    entitlementChangedEvent(
      { ...base, previousStatus: 'RESERVED', status: 'REVERSED', reason: 'GOODWILL' },
      context({ kind: 'service', id: 'booking' }),
    ),
  );
  assert.throws(() =>
    entitlementChangedEvent(
      { ...base, previousStatus: 'RESERVED', status: 'COMMITTED', reason: 'GOODWILL' },
      context({ kind: 'service', id: 'booking' }),
    ),
  );
  assert.throws(() =>
    subscriptionChangedEvent(
      {
        customerSubject: randomUUID(),
        planCode: 'monthly-care',
        planRevision: 1,
        previousStatus: null,
        status: 'ACTIVE',
        periodNo: 1,
        periodEndsAt: null,
        unitsGranted: 2,
      },
      context({ kind: 'account', id: randomUUID() }),
    ),
  );
});
