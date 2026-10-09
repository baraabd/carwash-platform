import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  BOOKING_CONFIRMED_POLICY,
  bookingReference,
  decideTrigger,
  type BookingConfirmedTrigger,
} from '../src/domain/event-notifications';
import {
  NotificationRuleError,
  notificationRequest,
  notificationSubject,
  requestFingerprint,
} from '../src/domain/notification';
import {
  EventNotificationHandler,
  NotificationIntegrityError,
  parseTriggerEvent,
} from '../src/application/event-notifications.service';
import { EnqueueNotification } from '../src/application/notification.service';
import {
  NotificationQueries,
  ReadBudget,
  requireNotificationRead,
} from '../src/application/notification-reads';
import { AccessFault, type VerifiedSession } from '../src/ports/identity.ports';
import type {
  EnqueueResult,
  NotificationIntake,
  NotificationReader,
} from '../src/ports/notification.ports';

const T0 = Date.parse('2026-10-10T08:00:00.000Z');
const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

function trigger(patch: Partial<BookingConfirmedTrigger> = {}): BookingConfirmedTrigger {
  return {
    kind: 'BOOKING_CONFIRMED',
    eventId: randomUUID(),
    occurredAt: new Date(T0),
    bookingId: randomUUID(),
    customerId: randomUUID(),
    ...patch,
  };
}

function confirmedEvent(bookingId = randomUUID(), customerId = randomUUID()) {
  return {
    eventId: randomUUID(),
    eventType: 'booking.confirmed.v1',
    schemaVersion: 1,
    producer: 'booking',
    occurredAt: new Date(T0).toISOString(),
    correlationId: randomUUID(),
    aggregateVersion: 1,
    data: { bookingId, customerId },
  };
}

/* --------------------------------- domain --------------------------------- */

test('trigger: a confirmation becomes one SMS intent keyed by booking, about that booking', () => {
  const t = trigger();
  const decision = decideTrigger(t, new Date(T0 + 60_000));
  assert.equal(decision.kind, 'NOTIFY');
  if (decision.kind !== 'NOTIFY') return;
  const c = decision.command;
  assert.equal(c.idempotencyKey, `booking-confirmed:${t.bookingId}`);
  assert.equal(c.recipientRef, t.customerId);
  assert.equal(c.channel, 'SMS');
  assert.equal(c.templateKey, 'booking.confirmed');
  assert.deepEqual(c.subject, { type: 'booking', ref: t.bookingId });
  assert.deepEqual(c.parameters, { bookingRef: bookingReference(t.bookingId) });
  assert.equal(c.expiresAt.getTime(), T0 + BOOKING_CONFIRMED_POLICY.ttlMs);
});

test('trigger: everything derives from the event, so every replica fingerprints the same', () => {
  const t = trigger();
  const at = (ms: number) => {
    const d = decideTrigger(t, new Date(ms));
    if (d.kind !== 'NOTIFY') throw new Error('expected NOTIFY');
    return requestFingerprint(notificationRequest({ ...d.command, now: new Date(ms) }));
  };
  assert.equal(at(T0 + 1_000), at(T0 + 3_600_000));
  const other = decideTrigger({ ...t, eventId: randomUUID() }, new Date(T0 + 5_000));
  assert.equal(other.kind, 'NOTIFY');
});

test('trigger: a confirmation past its window is skipped, never sent late', () => {
  const t = trigger();
  assert.deepEqual(decideTrigger(t, new Date(T0 + BOOKING_CONFIRMED_POLICY.ttlMs)), {
    kind: 'SKIP',
    reason: 'TOO_LATE',
  });
  assert.throws(
    () => decideTrigger(trigger({ occurredAt: new Date(Number.NaN) }), new Date(T0)),
    (e: unknown) => e instanceof NotificationRuleError && e.code === 'INVALID_TRIGGER_TIME',
  );
});

test('booking reference is short and carries no personal data', () => {
  assert.equal(bookingReference('3fa85f64-5717-4562-b3fc-2c963f66afa6'), '3FA85F64');
});

test('subject: validated, both parts or none, and fingerprints stay backward compatible', () => {
  assert.equal(notificationSubject(undefined), null);
  const ref = randomUUID().toUpperCase();
  assert.deepEqual(notificationSubject({ type: 'booking', ref }), {
    type: 'booking',
    ref: ref.toLowerCase(),
  });
  for (const bad of [
    { type: 'booking' },
    { type: 'Booking', ref },
    { type: 'booking', ref: 'x' },
    'booking',
  ])
    assert.throws(
      () => notificationSubject(bad),
      (e: unknown) => e instanceof NotificationRuleError && e.code === 'INVALID_SUBJECT',
    );
  const base = {
    sourceService: 'booking',
    idempotencyKey: 'booking-confirmed:abcdefgh',
    recipientRef: randomUUID(),
    channel: 'SMS',
    templateKey: 'booking.confirmed',
    templateVersion: 1,
    parameters: {},
    expiresAt: new Date(T0 + 60_000),
    now: new Date(T0),
  };
  const plain = requestFingerprint(notificationRequest(base));
  // The P01-D2 canonical form, unchanged when no subject is given.
  assert.equal(
    plain,
    JSON.stringify([
      base.sourceService,
      base.idempotencyKey,
      base.recipientRef,
      base.channel,
      base.templateKey,
      base.templateVersion,
      [],
      base.expiresAt.toISOString(),
    ]),
  );
  assert.notEqual(
    plain,
    requestFingerprint(notificationRequest({ ...base, subject: { type: 'booking', ref } })),
  );
});

/* ------------------------------- application ------------------------------ */

test('parser: only the published booking.confirmed.v1 is accepted', () => {
  const raw = confirmedEvent();
  const parsed = parseTriggerEvent(raw);
  assert.equal(parsed.trigger.bookingId, raw.data.bookingId);
  assert.throws(
    () => parseTriggerEvent({ ...raw, eventType: 'booking.created.v1' }),
    (e: unknown) => e instanceof NotificationRuleError && e.code === 'UNSUPPORTED_EVENT',
  );
  assert.throws(() => parseTriggerEvent({ ...raw, data: { ...raw.data, phone: '0999' } }));
  assert.throws(() => parseTriggerEvent(null));
});

class MemoryIntake implements NotificationIntake {
  readonly rows = new Map<string, { id: string; hash: string }>();

  enqueue(input: Parameters<NotificationIntake['enqueue']>[0]): Promise<EnqueueResult> {
    const key = `${input.request.sourceService}|${input.request.idempotencyKey}`;
    const existing = this.rows.get(key);
    if (!existing) {
      this.rows.set(key, { id: input.notificationId, hash: input.requestHash });
      return Promise.resolve({ kind: 'CREATED', notificationId: input.notificationId });
    }
    return Promise.resolve(
      existing.hash === input.requestHash
        ? { kind: 'REPLAYED', notificationId: existing.id }
        : { kind: 'CONFLICT' },
    );
  }
}

test('handler: create once, replay for a re-sent confirmation, conflict for a rival customer', async () => {
  let now = T0 + 1_000;
  const clock = { now: () => new Date(now) };
  const handler = new EventNotificationHandler(
    new EnqueueNotification(clock, sha256Hex, () => randomUUID()),
    clock,
  );
  const intake = new MemoryIntake();
  const t = trigger();
  const first = await handler.handle(intake, t);
  assert.equal(first.kind, 'CREATED');
  now += 600_000;
  const again = await handler.handle(intake, { ...t, eventId: randomUUID() });
  assert.deepEqual(again, first.kind === 'CREATED' ? { ...first, kind: 'REPLAYED' } : first);
  await assert.rejects(
    handler.handle(intake, { ...t, customerId: randomUUID() }),
    (e: unknown) => e instanceof NotificationIntegrityError && e.code === 'INTENT_CONFLICT',
  );
  now = T0 + BOOKING_CONFIRMED_POLICY.ttlMs + 1;
  assert.deepEqual(await handler.handle(intake, trigger()), {
    kind: 'SKIPPED',
    reason: 'TOO_LATE',
  });
  assert.equal(intake.rows.size, 1);
});

/* --------------------------------- reads ---------------------------------- */

function session(permissions: string[]): VerifiedSession {
  return { subject: randomUUID(), sessionId: randomUUID(), authVersion: 1, permissions };
}

test('reads: operations may read; finance, reviewer and customers may not', () => {
  requireNotificationRead(session(['operations.dispatch']));
  for (const permissions of [
    ['billing.read', 'billing.refund'],
    ['verification.review'],
    ['bookings.read:self'],
    [],
  ])
    assert.throws(
      () => requireNotificationRead(session(permissions)),
      (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_FORBIDDEN',
    );
});

test('reads: inputs are validated before the reader is asked', async () => {
  let asked: unknown = null;
  const reader: NotificationReader = {
    list: (input) => {
      asked = input;
      return Promise.resolve({ items: [], nextCursor: null });
    },
    detail: () => Promise.resolve(null),
  };
  const queries = new NotificationQueries(reader);
  const ref = randomUUID();
  await queries.list({
    subjectType: 'booking',
    subjectRef: ref,
    state: 'QUEUED',
    limit: '10',
    cursor: undefined,
  });
  assert.deepEqual(asked, {
    subject: { type: 'booking', ref },
    state: 'QUEUED',
    limit: 10,
    cursor: null,
  });
  const base = {
    subjectType: undefined,
    subjectRef: undefined,
    state: undefined,
    limit: undefined,
    cursor: undefined,
  };
  for (const [patch, code] of [
    [{ subjectType: 'booking' }, 'INVALID_SUBJECT'],
    [{ state: 'SENT' }, 'INVALID_STATE'],
    [{ limit: '500' }, 'INVALID_LIMIT'],
    [{ cursor: 'bad cursor' }, 'INVALID_CURSOR'],
  ] as const)
    assert.throws(
      () => queries.list({ ...base, ...patch }),
      (e: unknown) => e instanceof NotificationRuleError && e.code === code,
    );
  assert.throws(
    () => queries.detail('not-a-uuid'),
    (e: unknown) => e instanceof NotificationRuleError && e.code === 'INVALID_NOTIFICATION_ID',
  );
});

test('reads: the per-subject budget is bounded', () => {
  const budget = new ReadBudget(1, 1_000, () => 0);
  budget.take('a');
  assert.throws(
    () => budget.take('a'),
    (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_RATE_LIMITED',
  );
  budget.take('b');
});
