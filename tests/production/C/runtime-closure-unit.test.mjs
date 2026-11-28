/** Compiled production modules; isolated ports/channels are explicit unit doubles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROOT, require, serviceDist, messaging } from './_support.mjs';

const contracts = require(path.join(ROOT, 'packages/contracts/dist/index.js'));
const events = require(path.join(ROOT, 'packages/event-contracts/dist/index.js'));
const bookingDomain = serviceDist('booking', 'domain/index.js');
const { projectExecution } = serviceDist('booking', 'domain/execution-projection.js');
const { AutomaticAssignmentService, rankCandidates, AUTOMATIC_ASSIGNMENT_LIMITS } = serviceDist(
  'dispatch',
  'application/automatic-assignment.service.js',
);
const { openAssignment, markUnassigned } = serviceDist('dispatch', 'domain/index.js');
const { parseCreateBooking } = serviceDist('booking', 'application/commands.js');
const fixtures = require(path.join(ROOT, 'services/booking/dist-tests/test/support/fixtures.js'));

const now = new Date('2026-12-01T09:00:00.000Z');
const snapshot = (patch = {}) => ({
  bookingId: randomUUID(),
  assignmentId: randomUUID(),
  revision: 2,
  holdId: randomUUID(),
  status: 'ASSIGNED',
  task: { taskId: randomUUID(), revision: 2, stage: 'ACCEPTED', completedAt: null },
  ...patch,
});
const mark = (s) => ({
  assignmentId: s.assignmentId,
  assignmentRevision: s.revision,
  taskId: s.task?.taskId ?? null,
  taskRevision: s.task?.revision ?? null,
});

test('execution projection follows genuine task progression and only CLOSED completes work', () => {
  const source = snapshot();
  for (const [stage, expected] of [
    ['ACCEPTED', 'ASSIGNED'],
    ['EN_ROUTE', 'EN_ROUTE'],
    ['ARRIVED', 'ARRIVED'],
    ['IN_SERVICE', 'IN_PROGRESS'],
    ['DOCUMENTING', 'IN_PROGRESS'],
    ['FINISHED', 'IN_PROGRESS'],
    ['CLOSED', 'COMPLETED'],
  ]) {
    const current = contracts.dispatchExecutionV1.parseExecutionV1({
      ...source,
      task: { ...source.task, stage, completedAt: stage === 'CLOSED' ? now.toISOString() : null },
    });
    assert.equal(projectExecution('CONFIRMED', null, current), expected);
  }
  assert.throws(() =>
    contracts.dispatchExecutionV1.parseExecutionV1({
      ...source,
      task: { ...source.task, stage: 'CLOSED' },
    }),
  );
  for (const stage of ['RELEASED', 'WITHDRAWN', 'CANCELLED'])
    assert.throws(
      () => projectExecution('IN_PROGRESS', null, { ...source, task: { ...source.task, stage } }),
      /LIVE_TASK_INCONSISTENT/,
    );
});

test('late completion from a former assignment generation cannot complete the replacement task', () => {
  const old = snapshot({ revision: 3 });
  const replacement = {
    ...old,
    revision: 5,
    task: { ...old.task, taskId: randomUUID(), revision: 1 },
  };
  const late = {
    ...old,
    task: { ...old.task, revision: 20, stage: 'CLOSED', completedAt: now.toISOString() },
  };
  assert.equal(projectExecution('ASSIGNED', mark(replacement), late), 'STALE');
  assert.equal(projectExecution('IN_PROGRESS', mark(old), replacement), 'ASSIGNED');
  assert.throws(
    () =>
      projectExecution('ASSIGNED', mark(replacement), {
        ...replacement,
        task: { ...replacement.task, taskId: randomUUID() },
      }),
    /TASK_GENERATION_CONFLICT/,
  );
});

test('duplicate or older task snapshots preserve status and terminal Booking states cannot reopen', () => {
  const source = snapshot({
    task: { taskId: randomUUID(), revision: 5, stage: 'ARRIVED', completedAt: null },
  });
  assert.equal(projectExecution('ARRIVED', mark(source), source), 'ARRIVED');
  assert.equal(
    projectExecution('ARRIVED', mark(source), {
      ...source,
      task: { ...source.task, revision: 4, stage: 'EN_ROUTE' },
    }),
    'STALE',
  );
  for (const state of ['CANCELLED', 'REJECTED', 'EXPIRED'])
    assert.equal(projectExecution(state, null, source), 'STALE');
  assert.equal(projectExecution('COMPLETED', null, source), 'COMPLETED');
  assert.throws(
    () => projectExecution('PENDING_CONFIRMATION', null, source),
    /BOOKING_CONFIRMATION_PENDING/,
  );
});

function job() {
  return openAssignment({
    id: randomUUID(),
    bookingId: randomUUID(),
    holdId: randomUUID(),
    zoneId: randomUUID(),
    startsAt: new Date(now.getTime() + 3_600_000),
    endsAt: new Date(now.getTime() + 7_200_000),
    now,
  });
}
function candidate(a, overrides = {}) {
  return {
    resourceId: randomUUID(),
    technicianSubjectId: randomUUID(),
    revision: 1,
    eligibility: 'ELIGIBLE',
    eligibilityRevision: 1,
    zoneIds: [a.zoneId],
    availability: 'AVAILABLE',
    availabilityRevision: 1,
    shifts: [{ startsAt: a.startsAt, endsAt: a.endsAt }],
    ...overrides,
  };
}

test('automatic ranking uses covering zone shifts, genuine availability and least active load', () => {
  const a = job();
  const low = candidate(a);
  const high = candidate(a);
  const unavailable = candidate(a, { availability: 'ON_BREAK' });
  const ineligible = candidate(a, { eligibility: 'INELIGIBLE' });
  const wrongZone = candidate(a, { zoneIds: [randomUUID()] });
  const shortShift = candidate(a, { shifts: [] });
  const ranked = rankCandidates(
    a,
    [high, unavailable, shortShift, low, ineligible, wrongZone],
    new Map([[high.resourceId, 3]]),
  );
  assert.deepEqual(
    ranked.map((r) => r.resourceId),
    [low.resourceId, high.resourceId],
  );
  const tied = rankCandidates(a, [high, low], new Map());
  assert.deepEqual(
    tied.map((r) => r.resourceId),
    [high.resourceId, low.resourceId].sort(),
  );
});

function automaticHarness(candidates, initial = job()) {
  const data = {
    job: initial,
    policy: null,
    tried: [],
    offers: [],
    events: [],
    audits: [],
    clock: new Date(now),
    busy: false,
    observed: null,
  };
  const tx = {
    lockResourceObservation: async () => data.observed,
    lockAssignment: async () => data.job,
    automaticPolicy: async () =>
      (data.policy ??= {
        assignmentId: data.job.id,
        state: 'ACTIVE',
        offeredCount: 0,
        failedPasses: 0,
        nextAttemptAt: data.clock,
        reason: null,
      }),
    updateAutomaticPolicy: async (p) => {
      data.policy = p;
    },
    triedAutomaticResources: async () => data.tried,
    resourceHasOverlap: async () => data.busy,
    updateAssignment: async (a) => {
      data.job = a;
    },
    insertOffer: async (o) => {
      data.offers.push(o);
    },
    recordAutomaticOffer: async (_a, r) => {
      data.tried.push(r);
    },
    appendEvent: async (e) => {
      data.events.push(e);
    },
    appendAudit: async (a) => {
      data.audits.push(a);
    },
  };
  const uow = { run: (fn) => fn(tx) };
  const read = {
    dueAutomaticAssignments: async () => (data.job.status === 'UNASSIGNED' ? [data.job] : []),
    activeResourceLoads: async () => new Map(),
  };
  const owner = {
    listCandidates: async () => (typeof candidates === 'function' ? candidates() : candidates),
  };
  const create = () =>
    new AutomaticAssignmentService(
      uow,
      read,
      owner,
      { now: () => data.clock },
      { next: randomUUID },
    );
  return { data, create, tx };
}

test('automatic expired/declined fallback survives application restart and never offers a tried resource twice', async () => {
  const a = job();
  const c = [candidate(a), candidate(a)];
  const h = automaticHarness(c, a);
  assert.equal(await h.create().runDue(randomUUID()), 1);
  const first = h.data.offers[0];
  h.data.job = markUnassigned(h.data.job, h.data.clock);
  assert.equal(await h.create().runDue(randomUUID()), 1);
  assert.notEqual(h.data.offers[1].resourceId, first.resourceId);
  assert.equal(h.data.policy.offeredCount, 2);
  assert.equal(h.data.events.length, 2);
  assert.ok(
    h.data.offers.every((o) =>
      c.some((x) => x.resourceId === o.resourceId && x.technicianSubjectId === o.technicianSubject),
    ),
  );
});

test('manual pause and newer INELIGIBLE watermark fence automatic offer creation', async () => {
  const a = job();
  const c = candidate(a);
  const h = automaticHarness([c], a);
  h.data.policy = {
    assignmentId: a.id,
    state: 'PAUSED',
    offeredCount: 0,
    failedPasses: 0,
    nextAttemptAt: now,
    reason: 'MANUAL_OVERRIDE',
  };
  assert.equal(await h.create().runDue(randomUUID()), 0);
  assert.equal(h.data.offers.length, 0);
  h.data.policy = { ...h.data.policy, state: 'ACTIVE' };
  h.data.observed = { resourceId: c.resourceId, eligibility: 'INELIGIBLE', revision: 2 };
  assert.equal(await h.create().runDue(randomUUID()), 0);
  assert.equal(h.data.offers.length, 0);
});

test('automatic dependency outage is durably paced and exhausts without creating offers', async () => {
  const h = automaticHarness(() => {
    throw Error('offline');
  });
  for (let i = 0; i < AUTOMATIC_ASSIGNMENT_LIMITS.maxFailedPasses; i++) {
    await h.create().runDue(randomUUID());
    h.data.clock = new Date(h.data.clock.getTime() + AUTOMATIC_ASSIGNMENT_LIMITS.retryMs);
  }
  assert.equal(h.data.policy.state, 'EXHAUSTED');
  assert.equal(h.data.policy.failedPasses, 20);
  assert.equal(h.data.offers.length, 0);
  assert.equal(h.data.audits.at(-1).action, 'assignment.automatic-attention-required');
});

test('automatic assignment stops at its durable offer limit even when more eligible resources exist', async () => {
  const a = job();
  const h = automaticHarness(
    Array.from({ length: AUTOMATIC_ASSIGNMENT_LIMITS.maxOffers + 1 }, () => candidate(a)),
    a,
  );
  for (let i = 0; i < AUTOMATIC_ASSIGNMENT_LIMITS.maxOffers; i++) {
    assert.equal(await h.create().runDue(randomUUID()), 1);
    h.data.job = markUnassigned(h.data.job, h.data.clock);
  }
  assert.equal(await h.create().runDue(randomUUID()), 0);
  assert.equal(h.data.policy.state, 'EXHAUSTED');
  assert.equal(h.data.policy.offeredCount, AUTOMATIC_ASSIGNMENT_LIMITS.maxOffers);
  assert.equal(new Set(h.data.tried).size, AUTOMATIC_ASSIGNMENT_LIMITS.maxOffers);
  assert.equal(h.data.offers.length, AUTOMATIC_ASSIGNMENT_LIMITS.maxOffers);
});

test('a covered Booking reserve never enters the billing debt step; unknown reserve remains unresolved after deadline', () => {
  let saga = bookingDomain.newSaga(randomUUID(), now);
  saga = bookingDomain.onQuoteChecked(saga, { kind: 'VALID' }, now, 0, 'SUBSCRIPTION');
  assert.equal(saga.step, 'RESERVE_ENTITLEMENT');
  assert.equal(saga.obligationId, null);
  const late = new Date(saga.deadlineAt.getTime() + 60_000);
  saga = bookingDomain.onEntitlement(saga, { kind: 'UNAVAILABLE', error: 'TIMEOUT' }, late, 0);
  assert.equal(saga.step, 'RESERVE_ENTITLEMENT');
  assert.equal(saga.outcome, null);
  const reservationId = randomUUID();
  saga = bookingDomain.onEntitlement(saga, { kind: 'RESERVED', reservationId }, late, 0);
  assert.equal(saga.step, 'RELEASE_ENTITLEMENT');
  assert.equal(saga.entitlementReservationId, reservationId);
  saga = bookingDomain.onEntitlementReleased(
    saga,
    { kind: 'UNAVAILABLE', error: 'TIMEOUT' },
    late,
    0,
  );
  assert.equal(saga.step, 'RELEASE_ENTITLEMENT');
  saga = bookingDomain.onEntitlementReleased(saga, { kind: 'VOIDED' }, late, 0);
  assert.equal(saga.outcome, 'REJECTED');
  assert.equal(saga.obligationId, null);
});

function bookingInput() {
  const owner = fixtures.principal();
  return {
    id: randomUUID(),
    beneficiary: owner,
    paymentMethod: 'CASH_ON_COMPLETION',
    contact: fixtures.CONTACT,
    vehicle: fixtures.vehicleSnapshot(now),
    address: fixtures.addressSnapshot(now),
    quote: fixtures.quoteSnapshot(owner, now),
    requestedSlot: fixtures.requestedSlot(now),
    now,
  };
}
test('subscription coverage rejects extras, guest principals and fees before persisting a booking', () => {
  const input = bookingInput();
  const subscription = { subscriptionId: randomUUID(), expectedRevision: 1 };
  const extra = { ...input.quote.lines[0], lineId: randomUUID(), kind: 'EXTRA' };
  assert.throws(
    () =>
      bookingDomain.createBooking({
        ...input,
        quote: { ...input.quote, lines: [...input.quote.lines, extra] },
        subscription,
      }),
    (e) => e.reason === 'SUBSCRIPTION_COVERAGE_UNSUPPORTED',
  );
  const quote = {
    ...input.quote,
    lines: [input.quote.lines[0]],
    total: input.quote.lines[0].amount,
  };
  const covered = bookingDomain.createBooking({ ...input, quote, subscription });
  assert.deepEqual(covered.subscription, subscription);
  assert.throws(() =>
    bookingDomain.createBooking({
      ...input,
      quote,
      subscription,
      beneficiary: { ...input.beneficiary, kind: 'guest' },
    }),
  );
});

test('legacy create normalization is unchanged for old idempotency fingerprints', () => {
  const body = {
    quote: { quoteId: randomUUID(), revision: 1 },
    hold: { holdId: randomUUID(), revision: 1 },
    vehicle: { source: 'saved', vehicleId: randomUUID(), revision: 1 },
    address: { addressId: randomUUID(), revision: 1 },
    contact: fixtures.CONTACT,
    paymentMethod: 'CASH_ON_COMPLETION',
  };
  assert.equal(Object.hasOwn(parseCreateBooking(body), 'subscription'), false);
  const selection = { subscriptionId: randomUUID(), expectedRevision: 2 };
  assert.deepEqual(
    parseCreateBooking({ ...body, subscription: selection }).subscription,
    selection,
  );
  assert.throws(() => parseCreateBooking({ ...body, subscription: { ...selection, paid: true } }));
});

test('only covered creates may omit a payment method and ignored methods normalize identically', () => {
  const body = {
    quote: { quoteId: randomUUID(), revision: 1 },
    hold: { holdId: randomUUID(), revision: 1 },
    vehicle: { source: 'saved', vehicleId: randomUUID(), revision: 1 },
    address: { addressId: randomUUID(), revision: 1 },
    contact: fixtures.CONTACT,
  };
  const subscription = { subscriptionId: randomUUID(), expectedRevision: 2 };
  const normalized = parseCreateBooking({ ...body, subscription });
  assert.deepEqual(normalized.subscription, subscription);
  for (const paymentMethod of ['CASH_ON_COMPLETION', 'SHAM_CASH', 'SYRIATEL_CASH'])
    assert.deepEqual(parseCreateBooking({ ...body, subscription, paymentMethod }), normalized);
  assert.throws(() => parseCreateBooking(body), /paymentMethod is required/);
  for (const invalid of [null, {}, { ...subscription, expectedRevision: 0 }])
    assert.throws(() => parseCreateBooking({ ...body, subscription: invalid }));
  for (const paymentMethod of [null, 'PAID', true])
    assert.throws(() => parseCreateBooking({ ...body, subscription, paymentMethod }));
});

test('covered create without a payment choice confirms through entitlement and emits no debt or collection command', async () => {
  const { BookingProcessManager } = serviceDist('booking', 'application/process-manager.js');
  const { bookingView } = serviceDist('booking', 'transport/http/booking-view.js');
  const input = bookingInput();
  const command = parseCreateBooking({
    quote: { quoteId: input.quote.quoteId, revision: input.quote.revision },
    hold: { holdId: input.requestedSlot.holdId, revision: input.requestedSlot.holdRevision },
    vehicle: { source: 'inline', inline: {} },
    address: { addressId: randomUUID(), revision: 1 },
    contact: fixtures.CONTACT,
    subscription: { subscriptionId: randomUUID(), expectedRevision: 2 },
  });
  const booking = bookingDomain.createBooking({
    ...input,
    paymentMethod: command.paymentMethod,
    subscription: command.subscription,
    quote: {
      ...input.quote,
      lines: [input.quote.lines[0]],
      total: input.quote.lines[0].amount,
    },
  });
  const record = {
    booking,
    saga: bookingDomain.newSaga(booking.id, now),
    correlationId: randomUUID(),
  };
  const lease = { bookingId: booking.id, owner: 'covered-create-unit', fence: 1 };
  const reservationId = randomUUID();
  const steps = [];
  let finished;
  let reserved = 0;
  const manager = new BookingProcessManager({
    store: {
      leaseSaga: async () => ({ record, lease }),
      saveSaga: async (saga) => {
        steps.push(saga.step);
        return true;
      },
      finish: async (value) => {
        finished = value;
        return true;
      },
    },
    quotes: { validate: async () => ({ kind: 'VALID', total: booking.total }) },
    billing: {
      create: async () => assert.fail('covered booking must not create debt'),
      voidForBooking: async () => assert.fail('covered booking must not invent a voided debt'),
    },
    entitlements: {
      reserve: async () => {
        reserved += 1;
        return { kind: 'RESERVED', reservationId };
      },
      consume: async () => assert.fail('confirmation is not work completion'),
      releaseForBooking: async () => assert.fail('confirmed reservation must remain reserved'),
    },
    holds: { commit: async () => ({ kind: 'COMMITTED', slot: booking.requestedSlot }) },
    clock: { now: () => now },
    ids: { next: randomUUID },
    random: { next: () => 0.5 },
    observer: { record: () => {} },
    leaseMs: 30_000,
    traceparent: () => null,
  });
  assert.equal(await manager.drive(booking.id, lease.owner, 10_000), 'DONE');
  assert.equal(reserved, 1);
  assert.equal(steps.includes('CREATE_OBLIGATION'), false);
  assert.equal(finished.saga.obligationId, null);
  assert.equal(finished.event.eventType, 'booking.created.v1');
  const view = bookingView(finished.booking, finished.saga);
  assert.equal(view.status, 'CONFIRMED');
  assert.equal(view.financialSource, 'SUBSCRIPTION');
  assert.equal(view.entitlementReservationId, reservationId);
  assert.equal(view.obligationId, null);
  assert.equal(Object.hasOwn(view, 'paid'), false);
  assert.equal(Object.hasOwn(view, 'paymentReceipt'), false);
});

test('production outbox validation rejects row/envelope tampering before publication', () => {
  const a = job();
  const { assignmentChangedEvent } = serviceDist('dispatch', 'domain/events.js');
  const event = assignmentChangedEvent({
    eventId: randomUUID(),
    correlationId: randomUUID(),
    causationId: null,
    actor: { kind: 'system', id: null },
    assignment: a,
  });
  const { validateDispatchPublication } = serviceDist('dispatch', 'workers/runtime.js');
  const row = {
    id: randomUUID(),
    eventId: event.eventId,
    eventType: event.eventType,
    correlationId: event.correlationId,
    exchange: 'dispatch.events',
    routingKey: event.eventType,
    payload: JSON.stringify(event),
    attempts: 1,
  };
  assert.doesNotThrow(() => validateDispatchPublication(row));
  assert.throws(
    () => validateDispatchPublication({ ...row, exchange: 'billing.events' }),
    /OUTBOX_ENVELOPE_MISMATCH/,
  );
  assert.throws(
    () => validateDispatchPublication({ ...row, eventId: randomUUID() }),
    /OUTBOX_ENVELOPE_MISMATCH/,
  );
  assert.deepEqual(events.DISPATCH_ASSIGNMENT_CHANGED_V1.parse(event), event);
});

test('production consumers only declare subscriber-owned topology and replicas share durable queue names', () => {
  const dispatch = serviceDist('dispatch', 'workers/runtime.js');
  const booking = serviceDist('booking', 'workers/runtime.js');
  const t = dispatch.consumerTopology(
    dispatch.HOLD_QUEUE,
    'scheduling.events',
    'scheduling.hold-changed.v1',
  );
  assert.ok(t.exchanges.every((e) => e.name.startsWith('dispatch.')));
  assert.equal(t.queues[0].queueType, 'quorum');
  assert.equal(t.queues[0].deliveryLimit, 30);
  assert.ok(booking.executionTopology.exchanges.every((e) => e.name.startsWith('booking.')));
  assert.equal(booking.executionTopology.queues[0].deliveryLimit, 120);
  assert.deepEqual(
    booking.executionTopology.bindings
      .filter((b) => b.queue === booking.EXECUTION_QUEUE)
      .map((b) => b.routingKey)
      .sort(),
    ['dispatch.assignment-changed.v1', 'dispatch.task-progressed.v1'],
  );
});

test('all four deployed worker compositions fail closed without broker configuration', async () => {
  for (const name of ['booking', 'dispatch', 'scheduling', 'workforce']) {
    const { runRuntime } = serviceDist(name, 'workers/runtime.js');
    await assert.rejects(() => runRuntime({}, new AbortController().signal), /BROKER_URL_REQUIRED/);
  }
});

test('worker group aborts and drains siblings before reporting a fatal failure', async () => {
  const { runWorkerGroup } = messaging();
  let drained = false;
  await assert.rejects(
    () =>
      runWorkerGroup(new AbortController().signal, [
        async (signal) => {
          await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
          drained = true;
        },
        async () => {
          throw Error('fatal');
        },
      ]),
    /fatal/,
  );
  assert.equal(drained, true);
});

test('Booking hold facade rejects another beneficiary before any owner request', async () => {
  const { BookingHoldsService } = serviceDist('booking', 'application/booking-holds.service.js');
  let calls = 0;
  const facade = new BookingHoldsService({
    create: async () => {
      calls++;
    },
  });
  const owner = fixtures.principal();
  const meta = {
    actor: {
      kind: 'USER',
      principalKind: 'account',
      subject: owner.subjectId,
      permissions: ['bookings.create:self'],
    },
    credential: null,
    correlationId: randomUUID(),
  };
  const body = {
    beneficiary: fixtures.principal(),
    zoneId: randomUUID(),
    startsAt: '2026-12-02T12:00:00.000Z',
    durationMinutes: 60,
    quoteRef: { quoteId: randomUUID(), revision: 1 },
  };
  await assert.rejects(
    () => facade.create(meta, 'request-key-12345678', body),
    (e) => e.code === 'FORBIDDEN',
  );
  assert.equal(calls, 0);
});

test('request recovery looks up only the authenticated principal and pending capture does not invent success', async () => {
  const { BookingService } = serviceDist('booking', 'application/booking.service.js');
  const observed = [];
  const owner = fixtures.principal();
  let state = 'CLAIMED';
  const service = new BookingService({
    store: {
      findRequest: async (p, k) => {
        observed.push({ p, k });
        return { state, bookingId: randomUUID() };
      },
    },
  });
  const meta = {
    actor: {
      kind: 'USER',
      principalKind: 'account',
      subject: owner.subjectId,
      permissions: ['bookings.read:self'],
    },
    credential: null,
    correlationId: randomUUID(),
  };
  await assert.rejects(
    () => service.byRequest(meta, 'request-key-12345678'),
    (e) => e.code === 'IDEMPOTENCY_IN_PROGRESS',
  );
  assert.deepEqual(observed[0], { p: owner, k: 'request-key-12345678' });
  state = 'CLAIMED';
  await assert.rejects(
    () =>
      service.byRequest(
        { ...meta, actor: { ...meta.actor, permissions: [] } },
        'request-key-12345678',
      ),
    (e) => e.code === 'FORBIDDEN',
  );
  assert.equal(observed.length, 1);
});

test('subscription adapter never calls Billing and keeps resolution unknown without an exact reservation reference', async () => {
  const { SubscriptionEntitlementsAdapter } = serviceDist(
    'booking',
    'infrastructure/owners/subscription-entitlements.adapter.js',
  );
  const calls = [];
  const owner = new SubscriptionEntitlementsAdapter({
    call: async (input) => {
      calls.push(input);
      return { kind: 'NO_RESPONSE', error: 'TIMEOUT' };
    },
  });
  const input = bookingInput();
  const booking = bookingDomain.createBooking({
    ...input,
    subscription: { subscriptionId: randomUUID(), expectedRevision: 1 },
  });
  const result = await owner.reserve(booking, randomUUID());
  assert.equal(result.kind, 'UNAVAILABLE');
  assert.equal(calls[0].path, '/internal/v1/subscription/entitlement-reservations');
  assert.equal(calls[0].body.scheduledFor, booking.requestedSlot.startsAt.toISOString());
  assert.equal(calls[0].body.vehicleType, booking.quote.vehicleType);
  assert.equal((await owner.releaseForBooking(booking.id, null, randomUUID())).kind, 'UNAVAILABLE');
  assert.equal(calls.length, 1);
});

test('technician view exposes subscription coverage and uses the current rescheduled slot', () => {
  const { technicianBookingView } = serviceDist('booking', 'transport/http/technician-view.js');
  const input = bookingInput();
  const covered = bookingDomain.createBooking({
    ...input,
    subscription: { subscriptionId: randomUUID(), expectedRevision: 1 },
  });
  const moved = {
    holdId: randomUUID(),
    zoneId: input.requestedSlot.zoneId,
    startsAt: new Date('2026-12-03T09:00:00.000Z'),
    endsAt: new Date('2026-12-03T10:00:00.000Z'),
  };
  const view = technicianBookingView({ ...covered, rescheduledSlot: moved });
  assert.equal(view.financialSource, 'SUBSCRIPTION');
  assert.equal(view.slot.startsAt, moved.startsAt.toISOString());
  assert.equal(Object.hasOwn(view, 'subscriptionId'), false);
  assert.equal(Object.hasOwn(view, 'entitlementReservationId'), false);
});
