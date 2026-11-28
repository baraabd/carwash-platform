/** Real owner PostgreSQL and compiled adapters; no broker or provider delivery is simulated here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROOT, require, readContext, serviceDist } from './_support.mjs';

const context = await readContext();
const { serviceTelemetry } = require(path.join(ROOT, 'packages/service-kit/dist/index.js'));
const { PrismaService: CommunicationsPrisma } = serviceDist('communications', 'prisma.service.js');
const { PrismaService: ReportingPrisma } = serviceDist('reporting', 'prisma.service.js');
const communications = new CommunicationsPrisma(context.databases.communications.appUrl);
const reporting = new ReportingPrisma(context.databases.reporting.appUrl);
const { PrismaNotificationRepository, sha256Hex } = serviceDist(
  'communications',
  'infrastructure/persistence/prisma-notification.repository.js',
);
const { EnqueueNotification } = serviceDist(
  'communications',
  'application/notification.service.js',
);
const { EventNotificationHandler, parseTriggerEvent } = serviceDist(
  'communications',
  'application/event-notifications.service.js',
);
const { OperationsProjector, parseOperationsEvent } = serviceDist(
  'reporting',
  'application/operations.service.js',
);
const { PrismaOperationsWriter } = serviceDist(
  'reporting',
  'infrastructure/persistence/prisma-operations.store.js',
);
const repo = new PrismaNotificationRepository(communications.client);
const clock = { now: () => new Date() };
const handler = new EventNotificationHandler(
  new EnqueueNotification(clock, sha256Hex, randomUUID),
  clock,
);
const projector = new OperationsProjector(sha256Hex, clock);
test.after(async () => {
  await Promise.all([communications.client.$disconnect(), reporting.client.$disconnect()]);
  await Promise.all(
    ['communications', 'reporting'].map((owner) => serviceTelemetry(owner).shutdown()),
  );
});

const money = { currency: 'SYP', amountMinor: '50000', scale: 2 };
function envelope(eventType, producer, aggregate, data) {
  return {
    eventId: randomUUID(),
    eventType,
    envelopeVersion: 2,
    producer,
    occurredAt: clock.now().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    actor: { kind: 'service', id: producer },
    aggregate,
    data,
  };
}
function created(kind = 'account') {
  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const endsAt = new Date(Date.now() + 7_200_000).toISOString();
  return envelope(
    'booking.created.v1',
    'booking',
    { type: 'booking', id: randomUUID(), version: 4 },
    {
      status: 'CONFIRMED',
      beneficiary: { kind, subjectId: randomUUID() },
      zoneId: randomUUID(),
      startsAt,
      endsAt,
      holdId: randomUUID(),
      quoteId: randomUUID(),
      quoteRevision: 1,
      total: money,
      paymentMethod: 'CASH_ON_COMPLETION',
    },
  );
}
function cancelled(source) {
  const { zoneId, startsAt, endsAt, holdId, total, paymentMethod } = source.data;
  return envelope(
    'booking.cancelled.v1',
    'booking',
    { ...source.aggregate, version: 7 },
    {
      status: 'CANCELLED',
      changeId: randomUUID(),
      reason: 'CUSTOMER_REQUEST',
      zoneId,
      startsAt,
      endsAt,
      holdId,
      total,
      paymentMethod,
    },
  );
}
const handle = (event) => handler.handle(repo, parseTriggerEvent(event).trigger);
const apply = (event) =>
  reporting.client.$transaction((tx) =>
    projector.apply(new PrismaOperationsWriter(tx), parseOperationsEvent(event).fact),
  );
const claim = () =>
  repo.claimDue({
    now: clock.now(),
    workerId: 'native-owner-proof',
    limit: 100,
    leaseMs: 30_000,
    idempotentProvider: true,
    maxAttempts: 5,
  });

test('native Booking recipient namespaces survive persistence and cannot alias each other', async () => {
  for (const kind of ['account', 'guest']) {
    const event = created(kind);
    const first = await handle(event);
    assert.equal(first.kind, 'CREATED');
    const row = await communications.client.notification.findUnique({
      where: { id: first.notificationId },
    });
    assert.equal(row.recipientRef, event.data.beneficiary.subjectId);
    assert.equal(
      row.recipientNamespace,
      kind === 'account' ? 'IDENTITY_ACCOUNT' : 'IDENTITY_GUEST',
    );
    assert.equal(row.attemptCount, 0);
    assert.equal((await handle({ ...event, eventId: randomUUID() })).kind, 'REPLAYED');
    await assert.rejects(
      handle({
        ...event,
        eventId: randomUUID(),
        data: {
          ...event.data,
          beneficiary: {
            ...event.data.beneficiary,
            kind: kind === 'account' ? 'guest' : 'account',
          },
        },
      }),
      (error) => error.code === 'INTENT_CONFLICT',
    );
    await handle(cancelled(event));
  }
});

test('cancellation arriving before confirmation is durable, immutable and prevents a delayed intent', async () => {
  const event = created();
  const cancel = cancelled(event);
  assert.deepEqual(await handle(cancel), { kind: 'SKIPPED', reason: 'BOOKING_CANCELLED' });
  assert.deepEqual(await handle({ ...cancel, eventId: randomUUID() }), {
    kind: 'SKIPPED',
    reason: 'BOOKING_CANCELLED',
  });
  assert.deepEqual(await handle(event), { kind: 'SKIPPED', reason: 'BOOKING_CANCELLED' });
  assert.equal(
    await communications.client.notification.count({ where: { subjectRef: event.aggregate.id } }),
    0,
  );
  const tombstone = await communications.client.bookingNotificationCancellation.findUnique({
    where: { bookingId: event.aggregate.id },
  });
  assert.equal(tombstone.eventId, cancel.eventId);
  for (const statement of [
    'UPDATE app.booking_notification_cancellation SET source_version=99 WHERE booking_id=$1::uuid',
    'DELETE FROM app.booking_notification_cancellation WHERE booking_id=$1::uuid',
  ])
    await assert.rejects(
      communications.client.$executeRawUnsafe(statement, event.aggregate.id),
      /BOOKING_NOTIFICATION_CANCELLATION_IMMUTABLE/,
    );
});

test('concurrent confirmations and cancellation leave no sendable stale confirmation', async () => {
  const event = created();
  await Promise.all([
    ...Array.from({ length: 8 }, () => handle({ ...event, eventId: randomUUID() })),
    handle(cancelled(event)),
  ]);
  const rows = await communications.client.notification.findMany({
    where: { subjectRef: event.aggregate.id },
  });
  assert.ok(rows.length <= 1);
  for (const row of rows) {
    assert.equal(row.state, 'CANCELLED');
    assert.equal(row.attemptCount, 0);
  }
  assert.deepEqual(await handle(event), { kind: 'SKIPPED', reason: 'BOOKING_CANCELLED' });
  assert.equal(
    (await claim()).some((c) => rows.some((row) => row.id === c.notificationId)),
    false,
  );
});

test('cancellation during a provider attempt prevents retry while retaining the actual attempt outcome', async () => {
  const event = created();
  const intent = await handle(event);
  const active = (await claim()).find((c) => c.notificationId === intent.notificationId);
  assert.ok(active);
  assert.equal(active.submission.recipientNamespace, 'IDENTITY_ACCOUNT');
  await handle(cancelled(event));
  assert.equal(
    await repo.complete({
      notificationId: active.notificationId,
      fence: active.fence,
      attempt: active.attempt,
      outcome: 'REJECTED',
      now: clock.now(),
      transition: {
        state: 'RETRY_WAIT',
        nextAttemptAt: new Date(Date.now() + 1_000),
        providerMessageId: null,
        errorCode: 'PROVIDER_REFUSED_429',
      },
    }),
    true,
  );
  const row = await communications.client.notification.findUnique({
    where: { id: active.notificationId },
  });
  assert.equal(row.state, 'UNKNOWN');
  assert.equal(row.nextAttemptAt, null);
  const attempt = await communications.client.deliveryAttempt.findFirst({
    where: { notificationId: row.id },
  });
  assert.equal(attempt.outcome, 'REJECTED');
  assert.equal(attempt.errorCode, 'PROVIDER_REFUSED_429');
  assert.equal(
    (await claim()).some((c) => c.notificationId === row.id),
    false,
  );
});

test('Reporting consumes native Booking and Dispatch facts and rejects same-version contradictions', async () => {
  const source = created();
  assert.equal(await apply(source), 'APPLIED');
  assert.equal(await apply({ ...source, eventId: randomUUID() }), 'SAME');
  const { zoneId, startsAt, endsAt } = source.data;
  const assignment = envelope(
    'dispatch.assignment-changed.v1',
    'dispatch',
    { type: 'assignment', id: randomUUID(), version: 3 },
    {
      bookingId: source.aggregate.id,
      status: 'ASSIGNED',
      zoneId,
      startsAt,
      endsAt,
      resourceId: randomUUID(),
    },
  );
  assert.equal(await apply(assignment), 'APPLIED');
  assert.equal(
    (await reporting.client.opsBooking.findUnique({ where: { bookingId: source.aggregate.id } }))
      .customerRef,
    source.data.beneficiary.subjectId,
  );
  assert.equal(
    (
      await reporting.client.opsAssignment.findUnique({
        where: { assignmentId: assignment.aggregate.id },
      })
    ).resourceId,
    assignment.data.resourceId,
  );
  await assert.rejects(
    apply({
      ...assignment,
      eventId: randomUUID(),
      data: { ...assignment.data, resourceId: randomUUID() },
    }),
    (error) => error.code === 'FACT_VERSION_CONFLICT',
  );
});

test('Reporting observations are monotonic and technician cash declarations never create a Billing payment', async () => {
  const source = created();
  const lifecycle = envelope(
    'booking.lifecycle-progressed.v1',
    'booking',
    { ...source.aggregate, version: 12 },
    {
      previousStatus: 'IN_PROGRESS',
      status: 'COMPLETED',
      assignmentId: randomUUID(),
      assignmentRevision: 3,
      taskId: randomUUID(),
      taskRevision: 9,
    },
  );
  assert.equal(await apply(lifecycle), 'APPLIED');
  assert.equal(
    await apply({
      ...lifecycle,
      eventId: randomUUID(),
      aggregate: { ...lifecycle.aggregate, version: 11 },
      data: { ...lifecycle.data, status: 'IN_PROGRESS' },
    }),
    'STALE',
  );
  await assert.rejects(
    apply({
      ...lifecycle,
      eventId: randomUUID(),
      data: { ...lifecycle.data, status: 'IN_PROGRESS' },
    }),
    (error) => error.code === 'FACT_VERSION_CONFLICT',
  );
  const row = await reporting.client.opsOwnerObservation.findUnique({
    where: {
      eventType_aggregateId: {
        eventType: lifecycle.eventType,
        aggregateId: lifecycle.aggregate.id,
      },
    },
  });
  assert.equal(row.state.status, 'COMPLETED');
  assert.equal(row.version, 12);
  const before = await reporting.client.opsObligation.count();
  const cash = envelope(
    'dispatch.cash-declared.v1',
    'dispatch',
    { type: 'task', id: lifecycle.data.taskId, version: 10 },
    {
      bookingId: source.aggregate.id,
      taskId: lifecycle.data.taskId,
      outcome: 'CASH_COLLECTED',
      amount: money,
      late: false,
    },
  );
  assert.equal(await apply(cash), 'APPLIED');
  assert.equal(await reporting.client.opsObligation.count(), before);
});
