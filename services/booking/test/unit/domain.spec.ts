import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BookingError,
  SAGA_POLICY,
  backoffMs,
  beginCommit,
  bookingCreatedEvent,
  confirmBooking,
  contactSnapshot,
  createBooking,
  inlineVehicleSnapshot,
  money,
  moneyFromWire,
  moneyToWire,
  newSaga,
  normalizePhone,
  onCommit,
  onObligation,
  onQuoteChecked,
  onVoid,
  rejectBooking,
  sumMoney,
  totalMatches,
  type Booking,
  type SagaState,
} from '../../src/domain';
import {
  CONTACT,
  HOUR,
  MINUTE,
  addressSnapshot,
  committedSlot,
  principal,
  quoteSnapshot,
  requestedSlot,
  vehicleSnapshot,
} from '../support/fixtures';

const NOW = new Date('2026-10-08T08:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);

function booking(overrides: Partial<Parameters<typeof createBooking>[0]> = {}): Booking {
  const beneficiary = overrides.beneficiary ?? principal();
  return createBooking({
    id: randomUUID(),
    beneficiary,
    paymentMethod: 'CASH_ON_COMPLETION',
    contact: CONTACT,
    vehicle: vehicleSnapshot(NOW),
    address: addressSnapshot(NOW),
    quote: quoteSnapshot(beneficiary, NOW),
    requestedSlot: requestedSlot(NOW),
    now: NOW,
    ...overrides,
  });
}

// ---------------------------------------------------------------- money

test('money: wire round trip is exact for 18-digit amounts and never uses floats', () => {
  const wire = { currency: 'SYP', amountMinor: '999999999999999999', scale: 2 };
  const value = moneyFromWire(wire, 'm');
  assert.equal(value.amountMinor, 999_999_999_999_999_999n);
  assert.deepEqual(moneyToWire(value), wire);
});

test('money: unsupported scale, currency, float or exponent forms are refused', () => {
  for (const bad of [
    { currency: 'SYP', amountMinor: '100', scale: 0 },
    { currency: 'EUR', amountMinor: '100', scale: 2 },
    { currency: 'SYP', amountMinor: 100, scale: 2 },
    { currency: 'SYP', amountMinor: '1e3', scale: 2 },
    { currency: 'SYP', amountMinor: '01', scale: 2 },
    { currency: 'SYP', amountMinor: '1000000000000000000', scale: 2 },
    { currency: 'SYP', amountMinor: '1', scale: 2, extra: true },
  ]) {
    assert.throws(() => moneyFromWire(bad, 'm'), BookingError, JSON.stringify(bad));
  }
});

test('money: sums are exact and refuse mixed currencies', () => {
  assert.equal(
    sumMoney('SYP', [money('SYP', 1n), money('SYP', -1n), money('SYP', 10n ** 17n)]).amountMinor,
    10n ** 17n,
  );
  assert.throws(() => sumMoney('SYP', [money('USD', 1n)]), BookingError);
});

// ---------------------------------------------------------------- snapshots

test('contact: Syrian numbers normalise to E.164; anything else is refused', () => {
  assert.equal(normalizePhone('0912 345 678'), '+963912345678');
  assert.equal(normalizePhone('912345678'), '+963912345678');
  assert.equal(normalizePhone('00963912345678'), '+963912345678');
  assert.equal(normalizePhone('+963 912-345-678'), '+963912345678');
  assert.equal(normalizePhone('+49301234567'), '+49301234567');
  for (const bad of ['0112345678', '+963112345678', '12345', 'abc', '+0123456789', 123]) {
    assert.throws(() => normalizePhone(bad), BookingError, String(bad));
  }
});

test('contact: names are NFC-normalised and bounded; control characters are refused', () => {
  const contact = contactSnapshot({ name: '  سارة   أحمد ', phone: '0912345678', notes: null });
  assert.equal(contact.name, 'سارة أحمد');
  assert.throws(
    () => contactSnapshot({ name: 'A', phone: '0912345678', notes: null }),
    BookingError,
  );
  assert.throws(
    () => contactSnapshot({ name: 'Sara\u0000', phone: '0912345678', notes: null }),
    BookingError,
  );
  assert.throws(
    () => contactSnapshot({ name: 'Sara', phone: '0912345678', notes: 'x'.repeat(501) }),
    BookingError,
  );
});

test('vehicle: a one-time vehicle keeps the plate optional and normalises it when given', () => {
  const without = inlineVehicleSnapshot({ type: 'suv' }, NOW);
  assert.equal(without.source, 'inline');
  assert.equal(without.plate, null);
  assert.equal(without.vehicleId, null);
  const withPlate = inlineVehicleSnapshot(
    { type: 'sedan', plate: { text: ' ab  123 ', region: 'حلب' } },
    NOW,
  );
  assert.deepEqual(withPlate.plate, { text: 'AB 123', region: 'حلب' });
  assert.throws(() => inlineVehicleSnapshot({ type: 'bus' }, NOW), BookingError);
  assert.throws(() => inlineVehicleSnapshot({ type: 'sedan', owner: 'x' }, NOW), BookingError);
  assert.throws(
    () => inlineVehicleSnapshot({ type: 'sedan', plate: { text: 'A_1' } }, NOW),
    BookingError,
  );
});

// ---------------------------------------------------------------- aggregate

test('booking: created PENDING_CONFIRMATION with the quote total and no committed slot', () => {
  const b = booking();
  assert.equal(b.status, 'PENDING_CONFIRMATION');
  assert.equal(b.slot, null);
  assert.equal(b.version, 1);
  assert.equal(b.total.amountMinor, 9_000_000n);
});

test('booking: a quote of another principal, vehicle type or zone is refused before anything is reserved', () => {
  const beneficiary = principal();
  assert.throws(
    () => booking({ beneficiary, quote: quoteSnapshot(principal(), NOW) }),
    (e: unknown) => e instanceof BookingError && e.code === 'QUOTE_MISMATCH',
  );
  assert.throws(
    () =>
      booking({ beneficiary, quote: { ...quoteSnapshot(beneficiary, NOW), vehicleType: 'suv' } }),
    (e: unknown) => e instanceof BookingError && e.reason === 'VEHICLE_TYPE_MISMATCH',
  );
  assert.throws(
    () => booking({ beneficiary, quote: quoteSnapshot(beneficiary, NOW, randomUUID()) }),
    (e: unknown) => e instanceof BookingError && e.reason === 'ZONE_MISMATCH',
  );
  const zone = randomUUID();
  assert.doesNotThrow(() =>
    booking({
      beneficiary,
      quote: quoteSnapshot(beneficiary, NOW, zone),
      requestedSlot: requestedSlot(NOW, zone),
    }),
  );
});

test('booking: a slot that already started is refused', () => {
  const slot = { ...requestedSlot(NOW), startsAt: NOW, endsAt: at(HOUR) };
  assert.throws(
    () => booking({ requestedSlot: slot }),
    (e: unknown) => e instanceof BookingError && e.reason === 'SLOT_STARTED',
  );
});

test('booking: confirmation requires exactly the requested slot and bumps the version once', () => {
  const b = booking();
  const confirmed = confirmBooking(b, committedSlot(b), at(1000));
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(confirmed.version, 2);
  assert.deepEqual(confirmed.slot, committedSlot(b));
  assert.throws(
    () => confirmBooking(b, { ...committedSlot(b), startsAt: at(5 * HOUR) }, NOW),
    BookingError,
  );
  assert.throws(() => confirmBooking(confirmed, committedSlot(b), NOW), /INVALID_TRANSITION/);
});

test('booking: rejection is terminal and records the reason', () => {
  const rejected = rejectBooking(booking(), 'HOLD_EXPIRED', NOW);
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.rejectionReason, 'HOLD_EXPIRED');
  assert.throws(() => rejectBooking(rejected, 'HOLD_EXPIRED', NOW), /INVALID_TRANSITION/);
  assert.throws(() => confirmBooking(rejected, committedSlot(rejected), NOW), /INVALID_TRANSITION/);
});

test('booking: validated total must equal the snapshot exactly', () => {
  const b = booking();
  assert.equal(totalMatches(b, money('SYP', 9_000_000n)), true);
  assert.equal(totalMatches(b, money('SYP', 9_000_001n)), false);
  assert.equal(totalMatches(b, money('USD', 9_000_000n)), false);
});

test('event: booking.created.v1 carries ids, slot and money only, never contact, address or plate', () => {
  const b = booking({
    vehicle: inlineVehicleSnapshot({ type: 'sedan', plate: { text: 'XYZ 999' } }, NOW),
  });
  const confirmed = confirmBooking(b, committedSlot(b), at(1));
  const event = bookingCreatedEvent({
    eventId: randomUUID(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: 'not-a-traceparent',
    booking: confirmed,
  });
  assert.equal(event.envelopeVersion, 2);
  assert.equal(event.aggregate.version, 2);
  assert.equal(event.traceparent, null, 'an invalid trace parent is dropped, not forwarded');
  const text = JSON.stringify(event);
  for (const secret of [CONTACT.name, CONTACT.phone, 'XYZ 999', 'حلب، الفرقان']) {
    assert.equal(text.includes(secret), false, `event leaks ${secret}`);
  }
  assert.throws(
    () =>
      bookingCreatedEvent({
        eventId: randomUUID(),
        correlationId: randomUUID(),
        causationId: null,
        traceparent: null,
        booking: b,
      }),
    /BOOKING_NOT_CONFIRMED/,
  );
});

// ---------------------------------------------------------------- saga

function saga(): SagaState {
  return newSaga(randomUUID(), NOW);
}

test('saga: happy path goes quote -> obligation -> pivot -> CONFIRMED', () => {
  let s = onQuoteChecked(saga(), { kind: 'VALID' }, NOW, 0.5);
  assert.equal(s.step, 'CREATE_OBLIGATION');
  s = onObligation(s, { kind: 'CREATED', obligationId: 'obl_12345678' }, NOW, 0.5);
  assert.equal(s.step, 'COMMIT_HOLD');
  assert.equal(s.obligationId, 'obl_12345678');
  assert.throws(
    () => onCommit(s, { kind: 'COMMITTED', matchesRequest: true }, NOW, 0.5),
    /SAGA_PIVOT_NOT_RECORDED/,
  );
  s = beginCommit(s, NOW);
  assert.equal(beginCommit(s, NOW), s, 'recording the pivot twice is a no-op');
  s = onCommit(s, { kind: 'COMMITTED', matchesRequest: true }, NOW, 0.5);
  assert.equal(s.step, 'DONE');
  assert.equal(s.outcome, 'CONFIRMED');
});

test('saga: an invalid quote rejects without compensation', () => {
  const s = onQuoteChecked(saga(), { kind: 'INVALID', reason: 'QUOTE_EXPIRED' }, NOW, 0.5);
  assert.equal(s.step, 'DONE');
  assert.equal(s.outcome, 'REJECTED');
  assert.equal(s.pendingRejection, 'QUOTE_EXPIRED');
});

test('saga: unavailability before the pivot retries with backoff, then rejects at the deadline', () => {
  let s = onQuoteChecked(saga(), { kind: 'VALID' }, NOW, 0.5);
  s = onObligation(s, { kind: 'UNAVAILABLE', error: 'HTTP_503' }, NOW, 0.999);
  assert.equal(s.step, 'CREATE_OBLIGATION');
  assert.equal(s.attempts, 1);
  assert.ok(s.nextAttemptAt.getTime() > NOW.getTime());
  assert.equal(s.lastError, 'HTTP_503');
  // Creation outcome unknown at the deadline: void before rejecting.
  s = onObligation(s, { kind: 'UNAVAILABLE', error: 'TIMEOUT' }, at(SAGA_POLICY.deadlineMs), 0.5);
  assert.equal(s.step, 'VOID_OBLIGATION');
  assert.equal(s.pendingRejection, 'DEADLINE_EXCEEDED');
  s = onVoid(s, { kind: 'UNAVAILABLE', error: 'HTTP_502' }, at(SAGA_POLICY.deadlineMs * 3), 0.5);
  assert.equal(s.step, 'VOID_OBLIGATION', 'compensation has no deadline');
  s = onVoid(s, { kind: 'VOIDED' }, at(SAGA_POLICY.deadlineMs * 4), 0.5);
  assert.equal(s.outcome, 'REJECTED');
  assert.equal(s.pendingRejection, 'DEADLINE_EXCEEDED');
});

test('saga: a definitively refused obligation rejects without a void', () => {
  let s = onQuoteChecked(saga(), { kind: 'VALID' }, NOW, 0.5);
  s = onObligation(s, { kind: 'REJECTED' }, NOW, 0.5);
  assert.equal(s.step, 'DONE');
  assert.equal(s.pendingRejection, 'OBLIGATION_REJECTED');
});

test('saga: after the pivot an unknown outcome is replayed forever, never rejected on time', () => {
  let s = onQuoteChecked(saga(), { kind: 'VALID' }, NOW, 0.5);
  s = onObligation(s, { kind: 'CREATED', obligationId: 'obl_12345678' }, NOW, 0.5);
  s = beginCommit(s, NOW);
  for (let i = 1; i <= 30; i += 1) {
    s = onCommit(s, { kind: 'UNKNOWN', error: 'TIMEOUT' }, at(SAGA_POLICY.deadlineMs * i), 0.999);
    assert.equal(s.step, 'COMMIT_HOLD');
  }
  assert.ok(
    s.nextAttemptAt.getTime() - at(SAGA_POLICY.deadlineMs * 30).getTime() <=
      SAGA_POLICY.maxDelayAfterPivotMs,
  );
  s = onCommit(
    s,
    { kind: 'COMMITTED', matchesRequest: true },
    at(SAGA_POLICY.deadlineMs * 31),
    0.5,
  );
  assert.equal(s.outcome, 'CONFIRMED');
});

test('saga: a refused commit voids the obligation and rejects with the hold reason', () => {
  let s = onQuoteChecked(saga(), { kind: 'VALID' }, NOW, 0.5);
  s = onObligation(s, { kind: 'CREATED', obligationId: 'obl_12345678' }, NOW, 0.5);
  s = onCommit(beginCommit(s, NOW), { kind: 'REFUSED', reason: 'HOLD_EXPIRED' }, NOW, 0.5);
  assert.equal(s.step, 'VOID_OBLIGATION');
  assert.equal(s.pendingRejection, 'HOLD_EXPIRED');
});

test('saga: a committed hold that differs from the request stops for reconciliation', () => {
  let s = onQuoteChecked(saga(), { kind: 'VALID' }, NOW, 0.5);
  s = onObligation(s, { kind: 'CREATED', obligationId: 'obl_12345678' }, NOW, 0.5);
  s = onCommit(beginCommit(s, NOW), { kind: 'COMMITTED', matchesRequest: false }, NOW, 0.5);
  assert.equal(s.step, 'NEEDS_RECONCILIATION');
  assert.equal(s.outcome, null);
  assert.equal(s.lastError, 'COMMITTED_SLOT_MISMATCH');
});

test('saga: steps refuse outcomes of another step', () => {
  assert.throws(() => onObligation(saga(), { kind: 'REJECTED' }, NOW, 0.5), /SAGA_STEP_MISMATCH/);
  assert.throws(() => onVoid(saga(), { kind: 'VOIDED' }, NOW, 0.5), /SAGA_STEP_MISMATCH/);
});

test('saga: backoff is bounded, jittered and never a hot loop', () => {
  assert.equal(backoffMs(0, false, 0), 100);
  assert.ok(backoffMs(50, false, 0.999999) <= SAGA_POLICY.maxDelayBeforePivotMs);
  assert.ok(backoffMs(50, true, 0.999999) <= SAGA_POLICY.maxDelayAfterPivotMs);
  assert.ok(backoffMs(3, false, 0.5) < backoffMs(3, false, 0.9));
  assert.equal(newSaga(randomUUID(), NOW).deadlineAt.getTime(), NOW.getTime() + 10 * MINUTE);
});
