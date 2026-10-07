import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLD_LIMITS,
  SchedulingError,
  assertWindowDefinition,
  changeCapacity,
  closeWindow,
  confirm,
  convertHeldToReserved,
  expire,
  holdCreatedEvent,
  holdExpiredEvent,
  holdTtlSeconds,
  holdUnits,
  isDue,
  release,
  releaseHeldUnits,
  type CapacityWindowState,
  type HoldState,
} from '../../src/domain';

const NOW = new Date('2026-10-07T08:00:00.000Z');
const HOUR = 3_600_000;

function window(overrides: Partial<CapacityWindowState> = {}): CapacityWindowState {
  return {
    id: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0001',
    zoneId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0002',
    startsAt: new Date(NOW.getTime() + 2 * HOUR),
    endsAt: new Date(NOW.getTime() + 3 * HOUR),
    capacity: 2,
    held: 0,
    reserved: 0,
    status: 'OPEN',
    version: 1,
    ...overrides,
  };
}

function hold(overrides: Partial<HoldState> = {}): HoldState {
  return {
    id: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0003',
    windowId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0001',
    clientId: 'booking',
    holderRef: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0004',
    units: 1,
    status: 'ACTIVE',
    expiresAt: new Date(NOW.getTime() + 600_000),
    idempotencyKey: 'key-0000000000000001',
    requestFingerprint: 'f'.repeat(64),
    releaseReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SchedulingError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

test('window definition rejects past, too short, too long and oversized windows', () => {
  const ok = { startsAt: window().startsAt, endsAt: window().endsAt, capacity: 3, now: NOW };
  assert.doesNotThrow(() => assertWindowDefinition(ok));
  assert.equal(
    code(() => assertWindowDefinition({ ...ok, startsAt: new Date(NOW.getTime() - 1) })),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => assertWindowDefinition({ ...ok, endsAt: new Date(ok.startsAt.getTime() + 60_000) })),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() =>
      assertWindowDefinition({ ...ok, endsAt: new Date(ok.startsAt.getTime() + 13 * HOUR) }),
    ),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => assertWindowDefinition({ ...ok, capacity: 501 })),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => assertWindowDefinition({ ...ok, capacity: 1.5 })),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => assertWindowDefinition({ ...ok, startsAt: new Date(Number.NaN) })),
    'INVALID_INPUT',
  );
});

test('the last unit can be held once and never twice', () => {
  const one = holdUnits(window({ capacity: 1 }), 1, NOW);
  assert.equal(one.held, 1);
  assert.equal(
    code(() => holdUnits(one, 1, NOW)),
    'CAPACITY_EXHAUSTED',
  );
  assert.equal(
    code(() => holdUnits(window({ capacity: 3, reserved: 2 }), 2, NOW)),
    'CAPACITY_EXHAUSTED',
  );
});

test('closed and already-started windows accept no new holds', () => {
  assert.equal(
    code(() => holdUnits(closeWindow(window()), 1, NOW)),
    'WINDOW_CLOSED',
  );
  assert.equal(
    code(() =>
      holdUnits(window({ startsAt: NOW, endsAt: new Date(NOW.getTime() + HOUR) }), 1, NOW),
    ),
    'WINDOW_STARTED',
  );
});

test('capacity cannot be reduced below what is already held or reserved', () => {
  const busy = window({ capacity: 5, held: 2, reserved: 2 });
  assert.equal(changeCapacity(busy, 4).capacity, 4);
  assert.equal(
    code(() => changeCapacity(busy, 3)),
    'CAPACITY_BELOW_COMMITTED',
  );
});

test('counters can never go negative', () => {
  assert.throws(() => releaseHeldUnits(window({ held: 0 }), 1), /HELD_UNDERFLOW/);
  assert.throws(() => convertHeldToReserved(window({ held: 0 }), 1), /HELD_UNDERFLOW/);
});

test('hold TTL is bounded and defaults to ten minutes', () => {
  assert.equal(holdTtlSeconds(undefined), HOLD_LIMITS.defaultTtlSeconds);
  assert.equal(holdTtlSeconds(60), 60);
  assert.equal(
    code(() => holdTtlSeconds(59)),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => holdTtlSeconds(1801)),
    'INVALID_INPUT',
  );
});

test('a hold is due exactly at its deadline, by the injected clock', () => {
  const h = hold();
  assert.equal(isDue(h, new Date(h.expiresAt.getTime() - 1)), false);
  assert.equal(isDue(h, h.expiresAt), true);
  assert.equal(expire(h, h.expiresAt).status, 'EXPIRED');
  assert.throws(() => expire(h, NOW), /HOLD_NOT_DUE/);
});

test('confirm refuses expired or terminal holds', () => {
  const h = hold();
  assert.equal(confirm(h, NOW).status, 'CONFIRMED');
  assert.equal(
    code(() => confirm(h, h.expiresAt)),
    'HOLD_EXPIRED',
  );
  assert.equal(
    code(() => confirm(hold({ status: 'RELEASED', releaseReason: 'BOOKING_FAILED' }), NOW)),
    'HOLD_NOT_ACTIVE',
  );
});

test('release frees held or reserved units once and is idempotent afterwards', () => {
  const active = release(hold(), 'BOOKING_FAILED', NOW);
  assert.equal(active.freed, 'HELD');
  assert.equal(active.hold.status, 'RELEASED');
  const confirmed = release(hold({ status: 'CONFIRMED' }), 'BOOKING_CANCELLED', NOW);
  assert.equal(confirmed.freed, 'RESERVED');
  assert.equal(confirmed.hold.status, 'CANCELLED');
  const again = release(active.hold, 'BOOKING_FAILED', NOW);
  assert.equal(again.freed, null);
  assert.equal(again.hold, active.hold);
  assert.throws(
    () => release(hold(), 'BOOKING_FAILED', hold().expiresAt),
    /HOLD_DUE_MUST_EXPIRE_FIRST/,
  );
});

test('events carry opaque references only and validate before reaching the outbox', () => {
  const created = holdCreatedEvent({
    eventId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0010',
    correlationId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0011',
    hold: hold(),
    window: window(),
  });
  assert.equal(created.eventType, 'scheduling.hold-created.v1');
  assert.deepEqual(Object.keys(created.data).sort(), [
    'expiresAt',
    'holdId',
    'holderRef',
    'units',
    'windowEndsAt',
    'windowId',
    'windowStartsAt',
    'zoneId',
  ]);
  assert.throws(
    () =>
      holdCreatedEvent({
        eventId: 'nope',
        correlationId: created.correlationId,
        hold: hold(),
        window: window(),
      }),
    /INVALID_EVENT_UUID/,
  );
  const late = new Date(hold().expiresAt.getTime() + 5_000);
  const expired = expire(hold(), late);
  const event = holdExpiredEvent({
    eventId: '7d7f1d2e-7a55-4f52-9a77-3f1d9c1a0012',
    correlationId: created.correlationId,
    hold: expired,
    zoneId: window().zoneId,
  });
  assert.equal(
    event.data.expiredAt,
    hold().expiresAt.toISOString(),
    'the deadline, not the sweep time',
  );
  assert.equal(event.occurredAt, late.toISOString());
  assert.equal(event.aggregateVersion, 2);
  assert.throws(
    () =>
      holdExpiredEvent({
        eventId: event.eventId,
        correlationId: event.correlationId,
        hold: hold(),
        zoneId: window().zoneId,
      }),
    /HOLD_NOT_EXPIRED/,
  );
});
