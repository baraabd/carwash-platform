/**
 * P05-E1 — subscription.v1, promotion.v1, support.v1, reviews.v1, reporting.v1 and
 * the product events.
 *
 * Evidence kinds:
 *  1. Consumer rules: parsers refuse fabricated success, drift and leaks.
 *  2. Provider conformance (reporting.v1): the MERGED Reporting controller,
 *     transpiled from the exact source of this tree, renders responses that the
 *     published parsers must accept.
 *  3. support.v1 conforms to open PR #126 by fixture (provider not merged yet).
 *
 * Requires: pnpm build:packages (contracts, event-contracts, service-kit).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createTsLoader, nestStub } from './ts-module-loader.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const contracts = require(path.join(root, 'packages/contracts/dist/index.js'));
const events = require(path.join(root, 'packages/event-contracts/dist/index.js'));
const { ContractViolation } = contracts;
const sub = contracts.subscriptionV1;
const promo = contracts.promotionV1;
const sup = contracts.supportV1;
const rev = contracts.reviewsV1;
const rep = contracts.reportingV1;

const id = () => randomUUID();
const SYP = (minor) => ({ currency: 'SYP', amountMinor: String(minor), scale: 2 });
const T0 = '2026-10-11T08:00:00.000Z';
const T1 = '2026-10-11T08:05:00.000Z';
const T2 = '2026-11-10T08:00:00.000Z';
const SUBJECT = { kind: 'account', subjectId: id() };
const SHA = 'a'.repeat(64);
const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof ContractViolation && e.code === code, code);
const NEW = [
  sub.SUBSCRIPTION_V1,
  promo.PROMOTION_V1,
  sup.SUPPORT_V1,
  rev.REVIEWS_V1,
  rep.REPORTING_V1,
];

// ---------------------------------------------------------------- registry

test('new contracts pass the shared lint and are registered with honest status', () => {
  for (const contract of NEW) {
    assert.deepEqual(contracts.contractProblems(contract), [], contract.id);
    assert.ok(contracts.OWNER_CONTRACTS.includes(contract), contract.id);
    assert.equal(contracts.httpContract(contract.id).status, 'published-provider-pending');
  }
});

test('an owner serving two contracts never serves the same method+path twice', () => {
  const seen = new Map();
  for (const contract of contracts.OWNER_CONTRACTS) {
    for (const [name, route] of Object.entries(contract.routes)) {
      const key = `${contract.prefix} ${route.method} ${route.path.replace(/:[a-zA-Z]+/g, ':')}`;
      assert.equal(
        seen.get(key),
        undefined,
        `${contract.id}.${name} collides with ${seen.get(key)}`,
      );
      seen.set(key, `${contract.id}.${name}`);
    }
  }
  assert.deepEqual(
    contracts.contractsOf('pricing').map((c) => c.id),
    ['pricing.v1', 'promotion.v1'],
  );
});

test('any-of permission access: up to four distinct permissions, nothing else', () => {
  const lint = (access) =>
    contracts.contractProblems({
      id: 'x.v1',
      owner: 'x',
      prefix: '/internal/v1/x',
      routes: { r: { method: 'GET', path: '/r', access } },
      reasons: [],
    });
  assert.deepEqual(lint('permission:a.read|b.read'), []);
  assert.deepEqual(contracts.routePermissions('permission:a.read|b.read'), ['a.read', 'b.read']);
  assert.deepEqual(contracts.routePermissions('principal'), []);
  assert.ok(lint('permission:a.read|a.read').length > 0, 'duplicate');
  assert.ok(lint('permission:a.aa|b.bb|c.cc|d.dd|e.ee').length > 0, 'more than four');
  assert.ok(lint('permission:a.read|').length > 0, 'empty alternative');
  assert.ok(lint('service:a.read|b.read').length > 0, 'services never any-of');
});

test('every staff permission named by a new contract is published by Identity', () => {
  for (const contract of NEW) {
    for (const route of Object.values(contract.routes)) {
      for (const permission of contracts.routePermissions(route.access)) {
        assert.ok(
          contracts.IDENTITY_PERMISSIONS.includes(permission),
          `${contract.id}: ${permission}`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------- subscription

const plan = () => ({
  planId: id(),
  version: 3,
  status: 'PUBLISHED',
  name: 'باقة شهرية',
  units: 4,
  validityDays: 30,
  price: SYP(12000000),
  packageIds: [id()],
  vehicleTypes: ['sedan', 'suv'],
  publishedAt: T0,
  contentHash: SHA,
});
const subscription = (over = {}) => ({
  subscriptionId: id(),
  revision: 2,
  status: 'ACTIVE',
  beneficiary: SUBJECT,
  planId: id(),
  planVersion: 3,
  purchaseId: id(),
  units: { total: 4, reserved: 1, consumed: 1, available: 2 },
  startsAt: T0,
  expiresAt: T2,
  frozenAt: null,
  cancelledAt: null,
  updatedAt: T1,
  ...over,
});
const purchase = (over = {}) => ({
  purchaseId: id(),
  revision: 1,
  status: 'PENDING_PAYMENT',
  beneficiary: SUBJECT,
  planId: id(),
  planVersion: 3,
  quoteId: id(),
  total: SYP(12000000),
  paymentMethod: 'SHAM_CASH',
  obligationId: null,
  subscriptionId: null,
  createdAt: T0,
  updatedAt: T1,
  ...over,
});

test('subscription: plans are owner data with closed shape and no free plan', () => {
  assert.equal(sub.parsePlanV1(plan()).units, 4);
  throwsCode(() => sub.parsePlanV1({ ...plan(), price: SYP(0) }), 'ZERO_PLAN_PRICE');
  throwsCode(() => sub.parsePlanV1({ ...plan(), packageIds: [] }), 'INVALID_PLAN_PACKAGES');
  throwsCode(() => sub.parsePlanV1({ ...plan(), discountPercent: 10 }), 'UNEXPECTED_FIELD');
  throwsCode(
    () => sub.parsePlanV1({ ...plan(), price: { ...SYP(1), amountMinor: 1.5 } }),
    'INVALID_MONEY_AMOUNT',
  );
});

test('subscription: a purchase activates only with a verified obligation and a subscription', () => {
  assert.equal(sub.parsePurchaseV1(purchase()).status, 'PENDING_PAYMENT');
  const obligationId = id();
  const activated = purchase({ status: 'ACTIVATED', obligationId, subscriptionId: id() });
  assert.equal(sub.parsePurchaseV1(activated).obligationId, obligationId);
  throwsCode(
    () => sub.parsePurchaseV1(purchase({ status: 'ACTIVATED', obligationId })),
    'INCONSISTENT_ACTIVATION',
  );
  throwsCode(
    () => sub.parsePurchaseV1(purchase({ status: 'ACTIVATED', subscriptionId: id() })),
    'OBLIGATION_REQUIRED',
  );
  // An unknown payment is never a subscription.
  throwsCode(
    () =>
      sub.parsePurchaseV1(
        purchase({ status: 'PAYMENT_UNKNOWN', obligationId, subscriptionId: id() }),
      ),
    'INCONSISTENT_ACTIVATION',
  );
  throwsCode(
    () => sub.parsePurchaseV1(purchase({ updatedAt: '2026-10-10T08:00:00.000Z' })),
    'TIME_TRAVEL',
  );
  assert.deepEqual(
    Object.keys(
      sub.parseCreatePurchaseRequestV1({
        planId: id(),
        planVersion: 3,
        quoteId: id(),
        total: SYP(12000000),
        paymentMethod: 'CASH_ON_COMPLETION',
      }),
    ).sort(),
    ['paymentMethod', 'planId', 'planVersion', 'quoteId', 'total'],
  );
  throwsCode(
    () =>
      sub.parseCreatePurchaseRequestV1({
        planId: id(),
        planVersion: 3,
        quoteId: id(),
        total: SYP(1),
        paymentMethod: 'SHAM_CASH',
        beneficiary: SUBJECT,
      }),
    'UNEXPECTED_FIELD',
  );
  throwsCode(
    () =>
      sub.parseCreatePurchaseRequestV1({
        planId: id(),
        planVersion: 3,
        quoteId: id(),
        total: SYP(1),
        paymentMethod: 'WALLET',
      }),
    'INVALID_ENUM',
  );
});

test('subscription: units are owner-counted and recomputed', () => {
  assert.equal(sub.parseSubscriptionV1(subscription()).units.available, 2);
  throwsCode(
    () =>
      sub.parseSubscriptionV1(
        subscription({ units: { total: 4, reserved: 1, consumed: 1, available: 3 } }),
      ),
    'INCONSISTENT_UNITS',
  );
  throwsCode(
    () =>
      sub.parseSubscriptionV1(
        subscription({ units: { total: 4, reserved: 3, consumed: 2, available: 0 } }),
      ),
    'INCONSISTENT_UNITS',
  );
  throwsCode(
    () =>
      sub.parseSubscriptionV1(
        subscription({ units: { total: 4, reserved: 0, consumed: 4, available: 0 } }),
      ),
    'INCONSISTENT_EXHAUSTION',
  );
  assert.equal(
    sub.parseSubscriptionV1(
      subscription({
        status: 'EXHAUSTED',
        units: { total: 4, reserved: 0, consumed: 4, available: 0 },
      }),
    ).status,
    'EXHAUSTED',
  );
  throwsCode(
    () => sub.parseSubscriptionV1(subscription({ status: 'FROZEN' })),
    'INCONSISTENT_FREEZE',
  );
  throwsCode(
    () => sub.parseSubscriptionV1(subscription({ cancelledAt: T1 })),
    'INCONSISTENT_CANCELLATION',
  );
  throwsCode(() => sub.parseSubscriptionV1(subscription({ expiresAt: T0 })), 'INVALID_VALIDITY');
});

test('subscription: a change result must reflect what it claims', () => {
  const frozen = subscription({ status: 'FROZEN', frozenAt: T1 });
  const change = (over) => ({
    changeId: id(),
    action: 'FREEZE',
    status: 'APPLIED',
    effectiveAt: T1,
    subscription: frozen,
    ...over,
  });
  assert.equal(sub.parseSubscriptionChangeV1(change({})).status, 'APPLIED');
  throwsCode(
    () => sub.parseSubscriptionChangeV1(change({ subscription: subscription() })),
    'CHANGE_NOT_REFLECTED',
  );
  // Requested is not cancelled: PENDING_REVIEW leaves the subscription as it is.
  assert.equal(
    sub.parseSubscriptionChangeV1(
      change({
        action: 'CANCEL',
        status: 'PENDING_REVIEW',
        effectiveAt: null,
        subscription: subscription(),
      }),
    ).subscription.status,
    'ACTIVE',
  );
  throwsCode(
    () => sub.parseSubscriptionChangeV1(change({ effectiveAt: null })),
    'INCONSISTENT_EFFECTIVE_AT',
  );
  throwsCode(
    () =>
      sub.parseRequestSubscriptionChangeV1({
        expectedRevision: 2,
        action: 'CANCEL',
        reason: 'free text here',
      }),
    'INVALID_ENUM',
  );
});

test('subscription: reservations resolve once and are bound to one booking', () => {
  const r = {
    reservationId: id(),
    revision: 1,
    subscriptionId: id(),
    bookingId: id(),
    packageId: id(),
    status: 'RESERVED',
    reservedAt: T0,
    expiresAt: T1,
    resolvedAt: null,
  };
  assert.equal(sub.parseEntitlementReservationV1(r).status, 'RESERVED');
  throwsCode(
    () => sub.parseEntitlementReservationV1({ ...r, status: 'CONSUMED' }),
    'INCONSISTENT_RESOLUTION',
  );
  throwsCode(
    () => sub.parseEntitlementReservationV1({ ...r, resolvedAt: T1 }),
    'INCONSISTENT_RESOLUTION',
  );
  throwsCode(
    () => sub.parseResolveEntitlementRequestV1({ action: 'RESTORE', bookingId: id() }),
    'INVALID_ENUM',
  );
  assert.equal(
    sub.SUBSCRIPTION_V1.routes.reserveEntitlement.access,
    'service:subscription.entitlement.reserve',
  );
});

// ---------------------------------------------------------------- promotion

test('promotion: eligibility is a read; UNAVAILABLE is never INELIGIBLE or zero', () => {
  const e = {
    state: 'ELIGIBLE',
    promotion: { promotionId: id(), version: 1 },
    reason: null,
    quoteId: id(),
    evaluatedAt: T0,
  };
  assert.equal(promo.parseEligibilityV1(e).state, 'ELIGIBLE');
  assert.equal(promo.PROMOTION_V1.routes.checkEligibility.safe, true);
  throwsCode(() => promo.parseEligibilityV1({ ...e, promotion: null }), 'INCONSISTENT_ELIGIBILITY');
  throwsCode(
    () => promo.parseEligibilityV1({ ...e, state: 'UNAVAILABLE' }),
    'INCONSISTENT_ELIGIBILITY',
  );
  throwsCode(
    () =>
      promo.parseEligibilityV1({
        ...e,
        state: 'UNAVAILABLE',
        promotion: null,
        reason: 'USAGE_LIMIT_REACHED',
      }),
    'INCONSISTENT_ELIGIBILITY',
  );
  assert.equal(
    promo.parseEligibilityV1({ ...e, state: 'UNAVAILABLE', promotion: null }).reason,
    null,
  );
  throwsCode(
    () => promo.parseCheckEligibilityRequestV1({ code: 'sum10', quoteId: id() }),
    'INVALID_FORMAT',
  );
  throwsCode(
    () => promo.parseCheckEligibilityRequestV1({ code: 'SUM10', quoteId: id(), discount: SYP(5) }),
    'UNEXPECTED_FIELD',
  );
});

test('promotion: reservation lifecycle guards', () => {
  const r = {
    reservationId: id(),
    revision: 1,
    promotion: { promotionId: id(), version: 2 },
    quoteId: id(),
    bookingId: id(),
    beneficiary: SUBJECT,
    status: 'REDEEMED',
    reservedAt: T0,
    expiresAt: T1,
    resolvedAt: T1,
  };
  assert.equal(promo.parsePromotionReservationV1(r).status, 'REDEEMED');
  throwsCode(
    () => promo.parsePromotionReservationV1({ ...r, resolvedAt: null }),
    'INCONSISTENT_RESOLUTION',
  );
  throwsCode(
    () => promo.parseResolvePromotionRequestV1({ action: 'RESTOCK', bookingId: id() }),
    'INVALID_ENUM',
  );
});

// ---------------------------------------------------------------- support (PR #126 shapes)

const caseView = (over = {}) => ({
  caseId: id(),
  kind: 'REFUND',
  status: 'AWAITING_APPROVAL',
  subject: { type: 'billing.obligation', id: id(), parentId: null },
  summary: 'Customer paid twice',
  snapshot: {
    owner: 'billing',
    readAt: T0,
    state: { obligationId: id(), revision: 3, financialStatus: 'PAID', verifiedMinor: '150000' },
  },
  openedBy: id(),
  openedAt: T0,
  revision: 2,
  updatedAt: T1,
  ...over,
});
const decision = (over = {}) => ({
  decisionNo: 1,
  action: 'REFUND',
  status: 'AWAITING_APPROVAL',
  reason: { code: 'DUPLICATE_PAYMENT', note: 'Two identical transfers on statement' },
  evidence: [{ kind: 'PROVIDER_STATEMENT', reference: 'stmt-2026-10-11' }],
  amount: SYP(150000),
  window: null,
  decidedBy: id(),
  decidedAt: T1,
  approval: null,
  owner: null,
  ...over,
});
const AUTHORITY = [{ owner: 'support', reads: 'exception cases, decisions, reasons and audit' }];

test('support: detail view as #126 serialises it, with four-eyes enforced on the wire', () => {
  const detail = { authority: AUTHORITY, case: caseView(), decisions: [decision()], events: [] };
  assert.equal(sup.parseCaseDetailV1(detail).decisions[0].status, 'AWAITING_APPROVAL');
  const self = decision();
  throwsCode(
    () =>
      sup.parseDecisionV1({
        ...self,
        status: 'EXECUTING',
        approval: { by: self.decidedBy, at: T1, note: 'approved by me as well' },
        owner: {
          operation: 'billing.refund',
          targetId: id(),
          commandKey: 'support-case-d1-xxxxxxxx',
          httpStatus: null,
          code: null,
          state: null,
          attempts: 1,
          lastSentAt: T1,
        },
      }),
    'SAME_PERSON_APPROVAL',
  );
  // An executing decision always names its frozen owner command.
  throwsCode(
    () => sup.parseDecisionV1(decision({ status: 'OUTCOME_UNKNOWN' })),
    'OWNER_COMMAND_REQUIRED',
  );
  throwsCode(
    () => sup.parseCaseDetailV1({ ...detail, decisions: [decision({ decisionNo: 2 })] }),
    'DECISIONS_NOT_SEQUENTIAL',
  );
  throwsCode(
    () => sup.parseCaseV1(caseView({ kind: 'BOOKING_CANCELLATION' })),
    'SUBJECT_KIND_MISMATCH',
  );
  throwsCode(
    () =>
      sup.parseCaseV1(
        caseView({ subject: { type: 'billing.obligation', id: id(), parentId: id() } }),
      ),
    'UNEXPECTED_PARENT',
  );
});

test('support: requests are closed and kind-bound', () => {
  const attempt = { type: 'billing.payment-attempt', id: id(), parentId: id() };
  assert.equal(
    sup.parseOpenCaseRequestV1({
      kind: 'PAYMENT_REVIEW',
      subject: attempt,
      summary: 'Claim review',
    }).subject.parentId,
    attempt.parentId,
  );
  throwsCode(
    () =>
      sup.parseOpenCaseRequestV1({
        kind: 'REFUND',
        subject: { type: 'billing.obligation', id: id(), parentId: null },
        summary: 'x y z',
      }),
    'UNEXPECTED_FIELD',
  );
  throwsCode(
    () => sup.parseOpenCaseRequestV1({ kind: 'REFUND', subject: attempt, summary: 'Refund it' }),
    'SUBJECT_KIND_MISMATCH',
  );
  throwsCode(
    () =>
      sup.parseDecideCaseRequestV1({
        action: 'REFUND',
        reason: { code: 'DUPLICATE_PAYMENT', note: 'short' },
      }),
    'INVALID_LENGTH',
  );
  assert.equal(sup.parseDecisionNo('12', '$'), 12);
  assert.throws(() => sup.parseDecisionNo('012', '$'));
  assert.equal(sup.SUPPORT_V1.routes.approveDecision.access, 'permission:billing.refund');
});

// ---------------------------------------------------------------- reviews

const review = (over = {}) => ({
  reviewId: id(),
  revision: 1,
  bookingId: id(),
  author: SUBJECT,
  rating: 5,
  comment: 'خدمة ممتازة',
  publicationConsent: true,
  status: 'PENDING_MODERATION',
  moderationReason: null,
  submittedAt: T0,
  updatedAt: T0,
  ...over,
});

test('reviews: publication needs consent and a moderation decision', () => {
  assert.equal(rev.parseReviewV1(review()).status, 'PENDING_MODERATION');
  throwsCode(
    () => rev.parseReviewV1(review({ publicationConsent: false })),
    'INCONSISTENT_CONSENT',
  );
  assert.equal(
    rev.parseReviewV1(review({ publicationConsent: false, status: 'PRIVATE' })).status,
    'PRIVATE',
  );
  throwsCode(() => rev.parseReviewV1(review({ status: 'PUBLISHED' })), 'INCONSISTENT_MODERATION');
  throwsCode(
    () => rev.parseReviewV1(review({ status: 'PUBLISHED', moderationReason: 'SPAM' })),
    'INCONSISTENT_MODERATION',
  );
  throwsCode(() => rev.parseReviewV1(review({ rating: 6 })), 'INVALID_INTEGER');
  throwsCode(
    () =>
      rev.parseModerateReviewRequestV1({
        expectedRevision: 1,
        decision: 'PUBLISH',
        reason: 'SPAM',
      }),
    'INCONSISTENT_MODERATION',
  );
  throwsCode(
    () =>
      rev.parseSubmitReviewRequestV1({
        bookingId: id(),
        rating: 4,
        comment: null,
        publicationConsent: true,
        author: SUBJECT,
      }),
    'UNEXPECTED_FIELD',
  );
});

// ---------------------------------------------------------------- events

test('product events: registered, closed, no free text, legal transitions only', () => {
  const env = (spec, data, aggregateId = id()) => ({
    eventId: id(),
    eventType: spec.eventType,
    envelopeVersion: 2,
    producer: spec.producer,
    occurredAt: T1,
    correlationId: id(),
    causationId: null,
    traceparent: null,
    aggregate: { type: spec.aggregateType, id: aggregateId, version: 2 },
    actor: { kind: 'service', id: spec.producer },
    data,
  });
  for (const spec of events.PRODUCT_EVENTS_V1) {
    assert.equal(events.eventContract(spec.eventType).status, 'published-producer-pending');
  }
  const reviewEvent = events.REVIEWS_REVIEW_STATUS_CHANGED_V1;
  const rv = {
    bookingId: id(),
    rating: 4,
    previousStatus: 'PENDING_MODERATION',
    status: 'PUBLISHED',
  };
  assert.equal(reviewEvent.parse(env(reviewEvent, rv)).data.status, 'PUBLISHED');
  assert.throws(() => reviewEvent.parse(env(reviewEvent, { ...rv, comment: 'x' })));
  assert.throws(() => reviewEvent.parse(env(reviewEvent, { ...rv, previousStatus: 'PRIVATE' })));
  const reservation = events.SUBSCRIPTION_ENTITLEMENT_RESERVATION_CHANGED_V1;
  const res = {
    subscriptionId: id(),
    bookingId: id(),
    previousStatus: 'CONSUMED',
    status: 'RELEASED',
  };
  assert.throws(() => reservation.parse(env(reservation, res)), 'consumed never released');
  const purchaseEvent = events.SUBSCRIPTION_PURCHASE_STATUS_CHANGED_V1;
  const pe = {
    planId: id(),
    planVersion: 3,
    previousStatus: 'PAYMENT_UNKNOWN',
    status: 'ACTIVATED',
    obligationId: id(),
    subscriptionId: null,
  };
  assert.throws(
    () => purchaseEvent.parse(env(purchaseEvent, pe)),
    'activation needs a subscription',
  );
  const caseEvent = events.SUPPORT_CASE_STATUS_CHANGED_V1;
  const ce = {
    kind: 'REFUND',
    previousStatus: 'AWAITING_APPROVAL',
    status: 'EXECUTING',
    decisionNo: 1,
    action: 'REFUND',
  };
  assert.equal(caseEvent.parse(env(caseEvent, ce)).data.decisionNo, 1);
  assert.throws(() => caseEvent.parse(env(caseEvent, { ...ce, note: 'free text' })));
});

// ---------------------------------------------------------------- reporting provider conformance

test('reporting.v1 conforms to the MERGED Reporting operations controller', async () => {
  // The real service-kit modules the controller uses (not the Nest bootstrap barrel).
  const kit = (name) => require(path.join(root, `packages/service-kit/dist/${name}.js`));
  const serviceKit = { ...kit('errors'), ...kit('correlation'), ...kit('logging') };
  const load = createTsLoader(root, {
    '@nestjs/common': nestStub(),
    '@carwash/service-kit': serviceKit,
  });
  const { OperationsController } = load(
    'services/reporting/src/transport/http/operations.controller.ts',
  );
  const domain = load('services/reporting/src/domain/operations.ts');
  const service = load('services/reporting/src/application/operations.service.ts');
  const now = new Date('2026-10-11T09:00:00.000Z');
  const freshness = [
    domain.freshness('booking', null, now),
    domain.freshness(
      'scheduling',
      { lastEventOccurredAt: new Date(T0), lastAppliedAt: new Date(T1), appliedCount: 42n },
      now,
    ),
  ];
  const meta = (authority) => ({ derived: true, authority, freshness });
  const slot = {
    holdId: id(),
    state: 'COMMITTED',
    zoneId: id(),
    startsAt: new Date(T1),
    endsAt: new Date('2026-10-11T09:05:00.000Z'),
  };
  const row = {
    bookingId: id(),
    customerRef: id(),
    confirmedAt: new Date(T0),
    derivedStatus: 'SCHEDULED',
    slot,
    updatedAt: new Date(T1),
  };
  const queries = {
    bookings: async () => ({
      ...meta(service.BOOKING_AUTHORITY),
      items: [
        row,
        {
          ...row,
          bookingId: id(),
          customerRef: null,
          confirmedAt: null,
          derivedStatus: null,
          slot: null,
        },
      ],
      nextCursor: 'abc_DEF-1',
    }),
    booking: async () => ({
      ...meta(service.BOOKING_AUTHORITY),
      item: row,
      holds: [{ ...slot, version: 2, occurredAt: new Date(T1) }],
      assignments: [
        {
          assignmentId: id(),
          status: 'ASSIGNED',
          resourceId: id(),
          zoneId: slot.zoneId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          version: 3,
          occurredAt: new Date(T1),
          firstObservedAt: new Date(T0),
          firstOfferedAt: new Date(T0),
          firstAssignedAt: new Date(T1),
          assignedResourceCount: 2,
        },
      ],
    }),
    resources: async () => ({
      ...meta(service.WORKFORCE_AUTHORITY),
      summary: { eligible: 3, ineligible: 1 },
      items: [{ resourceId: id(), eligibility: 'ELIGIBLE', version: 1, changedAt: new Date(T0) }],
      nextCursor: null,
    }),
    operationsKpis: async () => ({
      ...meta(service.ASSIGNMENT_AUTHORITY),
      incompleteSources: ['dispatch'],
      window: { from: new Date(T0), to: new Date(T2) },
      bookingsByStatus: new Map([['SCHEDULED', 4]]),
      assignmentsByStatus: new Map([
        ['ASSIGNED', 3],
        ['OFFERED', 1],
      ]),
      reassigned: 1,
      assignedAfterStart: 0,
      timeToFirstOffer: { count: 2, p50Ms: 100, p90Ms: 300, maxMs: 300 },
      timeToAssign: { count: 0, p50Ms: null, p90Ms: null, maxMs: null },
      offerToAssign: { count: 1, p50Ms: 50, p90Ms: 50, maxMs: 50 },
    }),
    cashKpis: async () => ({
      ...meta(service.CASH_AUTHORITY),
      incompleteSources: [],
      asOf: now,
      states: [
        {
          cashState: 'AWAITING_CASH',
          count: 2,
          outstanding: [{ currency: 'SYP', amountMinor: '300000', scale: 2 }],
          oldestSince: new Date(T0),
        },
        { cashState: 'PAID', count: 5, outstanding: [], oldestSince: null },
      ],
    }),
    freshness: async () => freshness,
  };
  const session = {
    subject: id(),
    permissions: ['operations.dispatch', 'billing.read', 'verification.review'],
  };
  const controller = new OperationsController(
    queries,
    { verify: async () => session },
    { take: () => undefined },
  );
  const headers = { authorization: 'Bearer x', 'x-correlation-id': id() };
  const page = rep.parseBookingOperationsPageV1(await controller.bookings(headers, {}));
  assert.equal(page.items.length, 2);
  assert.equal(page.freshness[0].status, 'NO_DATA');
  const detail = rep.parseBookingOperationDetailV1(
    await controller.booking(headers, row.bookingId),
  );
  assert.equal(detail.assignments[0].reassigned, true);
  assert.equal(
    rep.parseResourcesPageV1(await controller.resources(headers, {})).summary.eligible,
    3,
  );
  const kpis = rep.parseOperationsKpisV1(await controller.operationsKpis(headers, {}));
  assert.equal(kpis.fieldStages.available, false);
  const cash = rep.parseCashKpisV1(await controller.cashKpis(headers));
  assert.equal(cash.states[0].outstanding[0].amountMinor, '300000');
  assert.equal(
    rep.parseFreshnessReportV1(await controller.freshness(headers)).freshness[1].appliedCount,
    '42',
  );
  // Negative control: a derived page that drops the label is refused.
  const raw = await controller.bookings(headers, {});
  throwsCode(() => rep.parseBookingOperationsPageV1({ ...raw, derived: false }), 'NOT_DERIVED');
  // The provider's own access rule matches the published any-of permission set.
  const access = load('services/reporting/src/application/access.ts');
  const published = (route) => contracts.routePermissions(rep.REPORTING_V1.routes[route].access);
  assert.deepEqual([...access.OPERATIONS_READS.bookings], published('listBookingOperations'));
  assert.deepEqual([...access.OPERATIONS_READS.resources], published('listResources'));
  assert.deepEqual([...access.OPERATIONS_READS.freshness], published('getFreshness'));
  assert.deepEqual([...access.OPERATIONS_READS.cashKpis], published('getCashKpis'));
  assert.deepEqual([...access.OPERATIONS_READS.operationsKpis], published('getOperationsKpis'));
});
