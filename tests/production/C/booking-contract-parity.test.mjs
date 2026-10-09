/**
 * Consumer-contract parity: Booking's anti-corruption parsers versus the
 * PUBLISHED parsers of @carwash/contracts (pricing.v1, scheduling.v1,
 * vehicle.v1, customer.v1) on the same accepted and rejected documents, plus
 * the producer shape of the requested booking.created.v1 against the published
 * envelope v2 parser.
 *
 * Booking cannot depend on @carwash/contracts yet (lockfile is Lane E's,
 * CR-P02-C2 §2). This suite is what keeps the local restatement honest: a
 * document that one side accepts and the other rejects fails here.
 *
 * Requires: pnpm run build:packages, and the booking build + build:tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROOT, require } from './_support.mjs';

const contracts = (name) => require(path.join(ROOT, 'packages', 'contracts', 'dist', name));
const pricing = contracts('pricing/v1.js');
const scheduling = contracts('scheduling/v1.js');
const vehicle = contracts('vehicle/v1.js');
const customer = contracts('customer/v1.js');
const { parseEnvelopeV2 } = require(
  path.join(ROOT, 'packages', 'event-contracts', 'dist', 'envelope-v2.js'),
);
const bookingDist = (rel) => require(path.join(ROOT, 'services', 'booking', 'dist', rel));
const fixtures = require(
  path.join(ROOT, 'services', 'booking', 'dist-tests', 'test', 'support', 'fixtures.js'),
);
const acl = bookingDist('infrastructure/owners/contract-acl.js');
const domain = bookingDist('domain/index.js');

const NOW = new Date('2026-10-08T08:00:00.000Z');

function accepts(fn, value) {
  try {
    fn(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every case must be accepted or rejected by BOTH parsers. The first case is
 * the baseline document and must be accepted, so "both reject" cannot pass
 * for a fixture that is itself invalid.
 */
function parity(name, published, local, cases) {
  assert.equal(accepts(published, cases[0][1]), true, `${name}: baseline must be valid`);
  for (const [label, value] of cases) {
    const a = accepts(published, value);
    const b = accepts(local, value);
    assert.equal(b, a, `${name}: ${label}: published=${a} booking=${b}`);
  }
}

const clone = (v) => structuredClone(v);
const set = (v, mutate) => {
  const c = clone(v);
  mutate(c);
  return c;
};

test('pricing.v1 QuoteV1 parity (valid, arithmetic, closed shape, instants, money)', () => {
  const beneficiary = { kind: 'account', subjectId: randomUUID() };
  const q = fixtures.quoteWire({ beneficiary, now: NOW, zoneId: randomUUID() });
  parity(
    'QuoteV1',
    (v) => pricing.parseQuoteV1(v),
    (v) => acl.parseQuote(v),
    [
      ['valid', q],
      [
        'valid guest, null zone',
        { ...q, beneficiary: { kind: 'guest', subjectId: randomUUID() }, zoneId: null },
      ],
      ['expired status still a quote', { ...q, status: 'EXPIRED' }],
      ['extra field', { ...q, extra: true }],
      ['missing field', set(q, (c) => delete c.priceBookRevision)],
      ['total mismatch', set(q, (c) => (c.total.amountMinor = '9000001'))],
      ['line amount mismatch', set(q, (c) => (c.lines[0].amount.amountMinor = '1'))],
      ['positive discount', set(q, (c) => (c.lines[2].amount.amountMinor = '500000'))],
      ['package without definition', set(q, (c) => (c.lines[0].definitionId = null))],
      ['discount with definition', set(q, (c) => (c.lines[2].definitionId = randomUUID()))],
      ['duplicate line ids', set(q, (c) => (c.lines[1].lineId = c.lines[0].lineId))],
      ['empty lines', { ...q, lines: [] }],
      ['numeric amount', set(q, (c) => (c.total.amountMinor = 9000000))],
      ['wrong scale', set(q, (c) => (c.total.scale = 0))],
      ['negative total', set(q, (c) => (c.total.amountMinor = '-1'))],
      ['currency mismatch line', set(q, (c) => (c.lines[0].unitPrice.currency = 'USD'))],
      ['non-canonical instant', { ...q, issuedAt: '2026-10-08T08:00:00Z' }],
      ['expiry before issue', { ...q, expiresAt: q.issuedAt }],
      ['revision zero', { ...q, revision: 0 }],
      ['revision too large', { ...q, revision: 2 ** 31 }],
      ['bad uuid', { ...q, quoteId: 'not-a-uuid' }],
      [
        'quantity 11',
        set(q, (c) => ((c.lines[1].quantity = 11), (c.lines[1].amount.amountMinor = '11000000'))),
      ],
      ['unknown vehicle type', { ...q, vehicleType: 'bus' }],
    ],
  );
});

test('pricing.v1 QuoteValidationV1 parity', () => {
  const v = {
    quoteId: randomUUID(),
    revision: 1,
    valid: true,
    reason: null,
    total: { currency: 'SYP', amountMinor: '1', scale: 2 },
  };
  parity(
    'QuoteValidationV1',
    (x) => pricing.parseQuoteValidationV1(x),
    (x) => acl.parseQuoteValidation(x),
    [
      ['valid', v],
      ['invalid with reason', { ...v, valid: false, reason: 'QUOTE_EXPIRED' }],
      ['valid with reason', { ...v, reason: 'QUOTE_EXPIRED' }],
      ['invalid without reason', { ...v, valid: false }],
      ['unknown reason', { ...v, valid: false, reason: 'NOPE' }],
      ['extra', { ...v, extra: 1 }],
    ],
  );
});

test('scheduling.v1 HoldV1 parity', () => {
  const h = fixtures.holdWire({
    beneficiary: { kind: 'guest', subjectId: randomUUID() },
    zoneId: randomUUID(),
    startsAt: new Date(NOW.getTime() + 7_200_000),
    now: NOW,
  });
  parity(
    'HoldV1',
    (x) => scheduling.parseHoldV1(x),
    (x) => acl.parseHold(x),
    [
      ['held', h],
      [
        'committed with booking',
        { ...h, state: 'COMMITTED', bookingId: randomUUID(), revision: 2 },
      ],
      ['committed without booking', { ...h, state: 'COMMITTED' }],
      ['held with booking', { ...h, bookingId: randomUUID() }],
      ['expired', { ...h, state: 'EXPIRED' }],
      ['unknown state', { ...h, state: 'CONFIRMED' }],
      [
        '4 minute slot',
        { ...h, endsAt: new Date(NOW.getTime() + 7_200_000 + 240_000).toISOString() },
      ],
      [
        '481 minute slot',
        { ...h, endsAt: new Date(NOW.getTime() + 7_200_000 + 481 * 60_000).toISOString() },
      ],
      ['inverted', { ...h, endsAt: h.startsAt }],
      ['extra', { ...h, units: 1 }],
    ],
  );
});

test('vehicle.v1 VehicleSnapshotV1 parity (plate optional)', () => {
  const s = fixtures.vehicleWire(randomUUID(), 2, NOW);
  parity(
    'VehicleSnapshotV1',
    (x) => vehicle.parseVehicleSnapshotV1(x),
    (x) => acl.parseVehicleSnapshot(x),
    [
      ['saved, no plate', s],
      ['saved with plate', { ...s, plate: { text: 'ab 1234', region: 'حلب' } }],
      ['inline', { ...s, source: 'inline', vehicleId: null, vehicleRevision: null }],
      ['inline with id', { ...s, source: 'inline' }],
      ['bad plate', { ...s, plate: { text: 'A_1', region: null } }],
      ['long make', { ...s, make: 'x'.repeat(41) }],
      ['schema v2', { ...s, snapshotSchemaVersion: 2 }],
      ['control char', { ...s, model: 'Rio\u0007' }],
    ],
  );
});

test('customer.v1 AddressSnapshotV1 parity (coordinates exact)', () => {
  const s = fixtures.addressWire(randomUUID(), 1, NOW);
  const at = (latitude, longitude) => ({
    ...s,
    location: { mode: 'coordinates', point: { latitude, longitude }, description: null },
  });
  parity(
    'AddressSnapshotV1',
    (x) => customer.parseAddressSnapshotV1(x),
    (x) => acl.parseAddressSnapshot(x),
    [
      ['coordinates', s],
      ['manual', { ...s, location: { mode: 'manual', description: 'حلب، الفرقان' } }],
      ['manual too short', { ...s, location: { mode: 'manual', description: 'ab' } }],
      ['lat 90', at('90.000000', '0.000000')],
      ['lat 90.000001', at('90.000001', '0.000000')],
      ['lon -180', at('0.000000', '-180.000000')],
      ['minus zero', at('-0.000000', '0.000000')],
      ['5 decimals', at('36.20210', '37.134260')],
      ['leading zero', at('036.202105', '37.134260')],
      ['NaN', at('NaN', '0.000000')],
      ['number', at(36.202105, 37.13426)],
      ['unknown mode', { ...s, location: { mode: 'pin' } }],
    ],
  );
});

test('booking.created.v1 (requested) is a valid envelope v2 document without personal data', () => {
  const beneficiary = { kind: 'guest', subjectId: randomUUID() };
  const b = domain.createBooking({
    id: randomUUID(),
    beneficiary,
    paymentMethod: 'CASH_ON_COMPLETION',
    contact: fixtures.CONTACT,
    vehicle: fixtures.vehicleSnapshot(NOW),
    address: fixtures.addressSnapshot(NOW),
    quote: fixtures.quoteSnapshot(beneficiary, NOW),
    requestedSlot: fixtures.requestedSlot(NOW),
    now: NOW,
  });
  const confirmed = domain.confirmBooking(
    b,
    fixtures.committedSlot(b),
    new Date(NOW.getTime() + 1),
  );
  const event = domain.bookingCreatedEvent({
    eventId: randomUUID(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    booking: confirmed,
  });
  const parsed = parseEnvelopeV2(
    JSON.parse(JSON.stringify(event)),
    { eventType: 'booking.created.v1', producer: 'booking', aggregateType: 'booking' },
    (data) => data,
  );
  assert.equal(parsed.aggregate.id, confirmed.id);
  assert.deepEqual(parsed.actor, { kind: 'guest', id: beneficiary.subjectId });
  assert.equal(parsed.traceparent, event.traceparent);
  const text = JSON.stringify(event);
  for (const secret of [fixtures.CONTACT.name, fixtures.CONTACT.phone, 'حلب، الفرقان']) {
    assert.equal(text.includes(secret), false);
  }
});
