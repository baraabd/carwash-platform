// Executes the BUILT @carwash/event-contracts package.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const e = require('../../../packages/event-contracts/dist/index.js');

const base = (spec, data, overrides = {}) => ({
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: spec.eventType,
  envelopeVersion: 2,
  producer: spec.producer,
  occurredAt: '2026-10-07T08:00:00.000Z',
  correlationId: '22222222-2222-4222-8222-222222222222',
  causationId: null,
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  aggregate: { type: spec.aggregateType, id: '33333333-3333-4333-8333-333333333333', version: 2 },
  actor: { kind: 'guest', id: '44444444-4444-4444-8444-444444444444' },
  data,
  ...overrides,
});

const samples = new Map([
  ['customer.profile-updated.v1', { change: 'UPDATED' }],
  [
    'customer.address-updated.v1',
    { customerId: '55555555-5555-4555-8555-555555555555', change: 'ARCHIVED' },
  ],
  ['vehicle.vehicle-updated.v1', { change: 'CREATED' }],
  ['geo.zone-updated.v1', { status: 'SUSPENDED', datasetRevision: 4 }],
  ['catalog.definitions-published.v1', { definitionIds: ['66666666-6666-4666-8666-666666666666'] }],
  ['pricing.price-book-published.v1', { currency: 'SYP' }],
  [
    'pricing.quote-issued.v1',
    { currency: 'SYP', totalMinor: '150000', expiresAt: '2026-10-07T08:15:00.000Z' },
  ],
  [
    'scheduling.hold-changed.v1',
    {
      state: 'COMMITTED',
      zoneId: '77777777-7777-4777-8777-777777777777',
      startsAt: '2026-10-08T07:00:00.000Z',
      endsAt: '2026-10-08T08:00:00.000Z',
      bookingId: '88888888-8888-4888-8888-888888888888',
    },
  ],
  ['workforce.eligibility-changed.v1', { eligibility: 'INELIGIBLE' }],
  [
    'configuration.configuration-published.v1',
    {
      marketId: 'sy',
      namespace: 'booking.policy.v1',
      contentHash: 'a'.repeat(64),
      effectiveAt: '2026-10-07T00:00:00.000Z',
    },
  ],
]);

test('every business event has a sample and round-trips through its parser', () => {
  assert.equal(e.BUSINESS_EVENTS_V1.length, samples.size);
  for (const spec of e.BUSINESS_EVENTS_V1) {
    const data = samples.get(spec.eventType);
    assert.ok(data, spec.eventType);
    const event = base(spec, data);
    assert.deepEqual(spec.parse(event), event, spec.eventType);
  }
});

test('envelope v2 refuses drift, wrong producer/aggregate, bad trace and PII-bearing actors', () => {
  const spec = e.VEHICLE_UPDATED_V1;
  const ok = base(spec, { change: 'CREATED' });
  const bad = [
    [{ ...ok, extra: 1 }, /UNEXPECTED_EVENT_FIELDS/],
    [{ ...ok, envelopeVersion: 1 }, /UNSUPPORTED_EVENT/],
    [{ ...ok, producer: 'customer' }, /UNSUPPORTED_EVENT/],
    [{ ...ok, aggregate: { ...ok.aggregate, type: 'customer-profile' } }, /UNSUPPORTED_AGGREGATE/],
    [{ ...ok, aggregate: { ...ok.aggregate, version: 0 } }, /INVALID_AGGREGATE_VERSION/],
    [{ ...ok, traceparent: '00-0-0-01' }, /INVALID_TRACEPARENT/],
    [{ ...ok, actor: { kind: 'guest', id: '+963912345678' } }, /INVALID_UUID/],
    [{ ...ok, actor: { kind: 'service', id: 'evil-service' } }, /INVALID_ACTOR/],
    [
      { ...ok, actor: { kind: 'system', id: '44444444-4444-4444-8444-444444444444' } },
      /INVALID_ACTOR/,
    ],
    [{ ...ok, actor: { kind: 'staff', id: null } }, /INVALID_ACTOR/],
    [{ ...ok, occurredAt: '2026-10-07T08:00:00Z' }, /INVALID_TIMESTAMP/],
    [{ ...ok, data: { change: 'CREATED', plate: 'ABC' } }, /UNEXPECTED_EVENT_FIELDS/],
  ];
  for (const [event, error] of bad) assert.throws(() => spec.parse(event), error);
  assert.deepEqual(spec.parse({ ...ok, actor: { kind: 'service', id: 'booking' } }).actor, {
    kind: 'service',
    id: 'booking',
  });
  assert.deepEqual(spec.parse({ ...ok, actor: { kind: 'system', id: null } }).actor, {
    kind: 'system',
    id: null,
  });
});

test('event data invariants: hold/booking linkage, interval order, money and hash formats', () => {
  const hold = e.SCHEDULING_HOLD_CHANGED_V1;
  const data = samples.get(hold.eventType);
  assert.throws(() => hold.parse(base(hold, { ...data, bookingId: null })), /INVALID_EVENT_DATA/);
  assert.throws(() => hold.parse(base(hold, { ...data, state: 'HELD' })), /INVALID_EVENT_DATA/);
  assert.throws(
    () => hold.parse(base(hold, { ...data, endsAt: data.startsAt })),
    /INVALID_EVENT_DATA/,
  );
  const quote = e.PRICING_QUOTE_ISSUED_V1;
  for (const totalMinor of ['-1', '1.5', 150000, '01']) {
    assert.throws(
      () => quote.parse(base(quote, { ...samples.get(quote.eventType), totalMinor })),
      /INVALID_EVENT_DATA/,
    );
  }
  const config = e.CONFIGURATION_PUBLISHED_V1;
  assert.throws(
    () => config.parse(base(config, { ...samples.get(config.eventType), contentHash: 'xyz' })),
    /INVALID_EVENT_DATA/,
  );
  const catalog = e.CATALOG_DEFINITIONS_PUBLISHED_V1;
  const id = '66666666-6666-4666-8666-666666666666';
  assert.throws(
    () => catalog.parse(base(catalog, { definitionIds: [id, id] })),
    /INVALID_EVENT_DATA/,
  );
});

test('V1 envelope events keep parsing unchanged (backward compatibility)', () => {
  const v1 = {
    eventId: '11111111-1111-4111-8111-111111111111',
    eventType: 'booking.confirmed.v1',
    schemaVersion: 1,
    producer: 'booking',
    occurredAt: '2026-09-25T00:00:00.000Z',
    correlationId: '22222222-2222-4222-8222-222222222222',
    aggregateVersion: 1,
    data: {
      bookingId: '33333333-3333-4333-8333-333333333333',
      customerId: '44444444-4444-4444-8444-444444444444',
    },
  };
  assert.deepEqual(e.parseBookingConfirmedV1(v1), v1);
});
