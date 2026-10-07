// Executes the BUILT @carwash/contracts modules (dist), i.e. what providers and consumers import.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ContractViolation } = require('../../../packages/contracts/dist/common/wire.js');
const s = require('../../../packages/contracts/dist/scheduling/v1.js');
const w = require('../../../packages/contracts/dist/workforce/v1.js');
const cfg = require('../../../packages/contracts/dist/configuration/v1.js');

const throwsCode = (fn, code) =>
  assert.throws(fn, (error) => error instanceof ContractViolation && error.code === code);

const ZONE = '11111111-1111-4111-8111-111111111111';
const QUOTE = '22222222-2222-4222-8222-222222222222';
const HOLD = '33333333-3333-4333-8333-333333333333';
const BOOKING = '44444444-4444-4444-8444-444444444444';
const SUBJECT = '55555555-5555-4555-8555-555555555555';
const RESOURCE = '66666666-6666-4666-8666-666666666666';
const beneficiary = { kind: 'guest', subjectId: SUBJECT };

const availability = {
  zoneId: ZONE,
  date: '2026-10-08',
  timezone: 'Asia/Damascus',
  durationMinutes: 60,
  slots: [
    {
      startsAt: '2026-10-08T06:00:00.000Z',
      endsAt: '2026-10-08T07:00:00.000Z',
      availability: 'AVAILABLE',
    },
    // Touching edges are allowed for half-open intervals.
    {
      startsAt: '2026-10-08T07:00:00.000Z',
      endsAt: '2026-10-08T08:00:00.000Z',
      availability: 'LIMITED',
    },
  ],
  earliest: { startsAt: '2026-10-08T06:00:00.000Z', endsAt: '2026-10-08T07:00:00.000Z' },
  asOf: '2026-10-07T12:00:00.000Z',
};

const hold = {
  holdId: HOLD,
  revision: 1,
  state: 'HELD',
  beneficiary,
  zoneId: ZONE,
  startsAt: '2026-10-08T06:00:00.000Z',
  endsAt: '2026-10-08T07:00:00.000Z',
  expiresAt: '2026-10-07T12:10:00.000Z',
  bookingId: null,
  createdAt: '2026-10-07T12:00:00.000Z',
  updatedAt: '2026-10-07T12:00:00.000Z',
};

test('scheduling: descriptor', () => {
  assert.equal(s.SCHEDULING_V1.id, 'scheduling.v1');
  assert.equal(s.SCHEDULING_V1.prefix, '/internal/v1/scheduling');
  assert.equal(s.SCHEDULING_V1.routes.commitHold.access, 'service:scheduling.hold.commit');
  assert.equal(s.SCHEDULING_V1.routes.commitHold.idempotent, true);
  assert.deepEqual([...s.SCHEDULING_V1.reasons].sort(), [
    'HOLD_EXPIRED',
    'HOLD_NOT_ACTIVE',
    'OUTSIDE_HORIZON',
    'SLOT_UNAVAILABLE',
  ]);
});

test('scheduling: availability query parses string duration and bounds it', () => {
  assert.deepEqual(
    s.parseAvailabilityQueryV1({ zoneId: ZONE, date: '2026-10-08', durationMinutes: '45' }),
    {
      zoneId: ZONE,
      date: '2026-10-08',
      durationMinutes: 45,
    },
  );
  throwsCode(
    () => s.parseAvailabilityQueryV1({ zoneId: ZONE, date: '2026-10-08', durationMinutes: '4' }),
    'INVALID_INTEGER',
  );
  throwsCode(
    () => s.parseAvailabilityQueryV1({ zoneId: ZONE, date: '2026-10-08', durationMinutes: '481' }),
    'INVALID_INTEGER',
  );
  throwsCode(
    () => s.parseAvailabilityQueryV1({ zoneId: ZONE, date: '2026-13-01', durationMinutes: '60' }),
    'INVALID_DATE',
  );
});

test('scheduling: availability round trip', () => {
  assert.deepEqual(s.parseAvailabilityV1(availability), availability);
  assert.deepEqual(s.parseAvailabilityV1({ ...availability, slots: [], earliest: null }), {
    ...availability,
    slots: [],
    earliest: null,
  });
});

test('scheduling: availability refuses overlap, unsorted, wrong duration, bad zone/timezone', () => {
  const [a, b] = availability.slots;
  throwsCode(
    () => s.parseAvailabilityV1({ ...availability, slots: [b, a] }),
    'OVERLAPPING_OR_UNSORTED_INTERVALS',
  );
  throwsCode(
    () =>
      s.parseAvailabilityV1({
        ...availability,
        durationMinutes: 90,
        slots: [
          { ...a, endsAt: '2026-10-08T07:30:00.000Z' },
          { ...b, startsAt: '2026-10-08T07:00:00.000Z', endsAt: '2026-10-08T08:30:00.000Z' },
        ],
        earliest: null,
      }),
    'OVERLAPPING_OR_UNSORTED_INTERVALS',
  );
  throwsCode(
    () =>
      s.parseAvailabilityV1({
        ...availability,
        slots: [{ ...a, endsAt: '2026-10-08T06:30:00.000Z' }],
      }),
    'INVALID_SLOT_DURATION',
  );
  throwsCode(
    () =>
      s.parseAvailabilityV1({
        ...availability,
        earliest: { startsAt: a.startsAt, endsAt: '2026-10-08T06:30:00.000Z' },
      }),
    'INVALID_SLOT_DURATION',
  );
  throwsCode(
    () => s.parseAvailabilityV1({ ...availability, slots: [{ ...a, endsAt: a.startsAt }] }),
    'INVALID_INTERVAL',
  );
  throwsCode(
    () => s.parseAvailabilityV1({ ...availability, timezone: 'Europe/Berlin' }),
    'INVALID_ENUM',
  );
  throwsCode(() => s.parseAvailabilityV1({ ...availability, extra: 1 }), 'UNEXPECTED_FIELD');
  throwsCode(
    () => s.parseAvailabilityV1({ ...availability, slots: [{ ...a, availability: 'FULL' }] }),
    'INVALID_ENUM',
  );
  throwsCode(
    () => s.parseAvailabilityV1({ ...availability, slots: Array.from({ length: 201 }, () => a) }),
    'TOO_MANY_ITEMS',
  );
});

test('scheduling: hold request and hold round trip', () => {
  const request = {
    beneficiary,
    zoneId: ZONE,
    startsAt: '2026-10-08T06:00:00.000Z',
    durationMinutes: 60,
    quoteRef: { quoteId: QUOTE, revision: 2 },
  };
  assert.deepEqual(s.parseHoldRequestV1(request), request);
  throwsCode(
    () => s.parseHoldRequestV1({ ...request, quoteRef: { quoteId: QUOTE, revision: 0 } }),
    'INVALID_INTEGER',
  );
  throwsCode(
    () => s.parseHoldRequestV1({ ...request, beneficiary: { kind: 'staff', subjectId: SUBJECT } }),
    'INVALID_ENUM',
  );
  assert.deepEqual(s.parseHoldV1(hold), hold);
  const committed = { ...hold, state: 'COMMITTED', bookingId: BOOKING, revision: 2 };
  assert.deepEqual(s.parseHoldV1(committed), committed);
});

test('scheduling: hold state/bookingId consistency and interval', () => {
  throwsCode(() => s.parseHoldV1({ ...hold, state: 'COMMITTED' }), 'INCONSISTENT_HOLD_BOOKING');
  throwsCode(() => s.parseHoldV1({ ...hold, bookingId: BOOKING }), 'INCONSISTENT_HOLD_BOOKING');
  throwsCode(
    () => s.parseHoldV1({ ...hold, state: 'RELEASED', bookingId: BOOKING }),
    'INCONSISTENT_HOLD_BOOKING',
  );
  throwsCode(() => s.parseHoldV1({ ...hold, endsAt: hold.startsAt }), 'INVALID_INTERVAL');
  throwsCode(
    () => s.parseHoldV1({ ...hold, endsAt: '2026-10-08T06:04:00.000Z' }),
    'INVALID_SLOT_DURATION',
  );
  throwsCode(() => s.parseHoldV1({ ...hold, state: 'PENDING' }), 'INVALID_ENUM');
});

test('scheduling: commit and release bodies', () => {
  assert.deepEqual(s.parseCommitHoldRequestV1({ expectedRevision: 1, bookingId: BOOKING }), {
    expectedRevision: 1,
    bookingId: BOOKING,
  });
  throwsCode(() => s.parseCommitHoldRequestV1({ expectedRevision: 1 }), 'MISSING_FIELD');
  assert.deepEqual(s.parseReleaseHoldRequestV1({ expectedRevision: 3, reason: 'BOOKING_FAILED' }), {
    expectedRevision: 3,
    reason: 'BOOKING_FAILED',
  });
  throwsCode(
    () => s.parseReleaseHoldRequestV1({ expectedRevision: 3, reason: 'OTHER' }),
    'INVALID_ENUM',
  );
});

const resource = {
  resourceId: RESOURCE,
  revision: 4,
  eligibility: 'ELIGIBLE',
  eligibilityRevision: 2,
  zoneIds: [ZONE],
  shifts: [
    { startsAt: '2026-10-08T05:00:00.000Z', endsAt: '2026-10-08T09:00:00.000Z' },
    { startsAt: '2026-10-08T09:00:00.000Z', endsAt: '2026-10-08T13:00:00.000Z' },
  ],
};

test('workforce: capacity resource round trip and no personal fields', () => {
  assert.equal(w.WORKFORCE_V1.id, 'workforce.v1');
  assert.deepEqual(w.parseCapacityResourceV1(resource), resource);
  throwsCode(() => w.parseCapacityResourceV1({ ...resource, name: 'Ahmad' }), 'UNEXPECTED_FIELD');
  throwsCode(
    () => w.parseCapacityResourceV1({ ...resource, phone: '+963900000000' }),
    'UNEXPECTED_FIELD',
  );
});

test('workforce: zones unique and bounded, shifts ordered and positive', () => {
  throwsCode(() => w.parseCapacityResourceV1({ ...resource, zoneIds: [] }), 'EMPTY_ZONES');
  throwsCode(
    () => w.parseCapacityResourceV1({ ...resource, zoneIds: [ZONE, ZONE] }),
    'DUPLICATE_ZONE',
  );
  throwsCode(
    () =>
      w.parseCapacityResourceV1({ ...resource, zoneIds: Array.from({ length: 21 }, () => ZONE) }),
    'TOO_MANY_ITEMS',
  );
  const [a, b] = resource.shifts;
  throwsCode(
    () => w.parseCapacityResourceV1({ ...resource, shifts: [b, a] }),
    'OVERLAPPING_OR_UNSORTED_INTERVALS',
  );
  throwsCode(
    () =>
      w.parseCapacityResourceV1({
        ...resource,
        shifts: [a, { ...b, startsAt: '2026-10-08T08:59:00.000Z' }],
      }),
    'OVERLAPPING_OR_UNSORTED_INTERVALS',
  );
  throwsCode(
    () => w.parseCapacityResourceV1({ ...resource, shifts: [{ ...a, endsAt: a.startsAt }] }),
    'INVALID_INTERVAL',
  );
  throwsCode(
    () => w.parseCapacityResourceV1({ ...resource, eligibility: 'MAYBE' }),
    'INVALID_ENUM',
  );
});

test('workforce: capacity query', () => {
  assert.deepEqual(
    w.parseCapacityResourceQueryV1({
      zoneId: ZONE,
      from: '2026-10-08T00:00:00.000Z',
      to: '2026-10-09T00:00:00.000Z',
      limit: '50',
    }),
    {
      zoneId: ZONE,
      from: '2026-10-08T00:00:00.000Z',
      to: '2026-10-09T00:00:00.000Z',
      page: { limit: 50, cursor: null },
    },
  );
  throwsCode(
    () =>
      w.parseCapacityResourceQueryV1({
        zoneId: ZONE,
        from: '2026-10-09T00:00:00.000Z',
        to: '2026-10-08T00:00:00.000Z',
      }),
    'INVALID_INTERVAL',
  );
});

const policy = {
  holdTtlSeconds: 600,
  quoteTtlSeconds: 900,
  minLeadMinutes: 60,
  horizonDays: 14,
  slotStepMinutes: 30,
  cancellationCutoffMinutes: 120,
};
const published = {
  marketId: 'sy-damascus',
  namespace: 'booking.policy.v1',
  version: 3,
  effectiveAt: '2026-10-01T00:00:00.000Z',
  contentHash: 'a'.repeat(64),
  content: policy,
};

test('configuration: published booking policy and market presentation round trip', () => {
  assert.equal(cfg.CONFIGURATION_V1.id, 'configuration.v1');
  assert.deepEqual(cfg.parsePublishedConfigurationV1(published), published);
  const presentation = {
    ...published,
    namespace: 'market.presentation.v1',
    content: { currency: 'SYP', defaultLocale: 'ar', timezone: 'Asia/Damascus' },
  };
  assert.deepEqual(cfg.parsePublishedConfigurationV1(presentation), presentation);
});

test('configuration: closed namespaces, market id, hash and version', () => {
  throwsCode(
    () => cfg.parsePublishedConfigurationV1({ ...published, namespace: 'privacy.retention.v1' }),
    'INVALID_ENUM',
  );
  throwsCode(
    () => cfg.parsePublishedConfigurationV1({ ...published, contentHash: 'A'.repeat(64) }),
    'INVALID_FORMAT',
  );
  throwsCode(
    () => cfg.parsePublishedConfigurationV1({ ...published, contentHash: 'a'.repeat(63) }),
    'INVALID_LENGTH',
  );
  throwsCode(
    () => cfg.parsePublishedConfigurationV1({ ...published, marketId: 'SY' }),
    'INVALID_FORMAT',
  );
  throwsCode(
    () => cfg.parsePublishedConfigurationV1({ ...published, version: 0 }),
    'INVALID_INTEGER',
  );
  // Content must match its namespace, not just any known shape.
  throwsCode(
    () =>
      cfg.parsePublishedConfigurationV1({
        ...published,
        content: { currency: 'SYP', defaultLocale: 'ar', timezone: 'Asia/Damascus' },
      }),
    'MISSING_FIELD',
  );
});

test('configuration: booking policy bounds', () => {
  const cases = [
    ['holdTtlSeconds', 59],
    ['holdTtlSeconds', 3601],
    ['quoteTtlSeconds', 59],
    ['quoteTtlSeconds', 86_401],
    ['minLeadMinutes', -1],
    ['minLeadMinutes', 1441],
    ['horizonDays', 0],
    ['horizonDays', 61],
    ['cancellationCutoffMinutes', 1441],
    ['holdTtlSeconds', 600.5],
  ];
  for (const [field, value] of cases) {
    throwsCode(
      () =>
        cfg.parsePublishedConfigurationV1({ ...published, content: { ...policy, [field]: value } }),
      'INVALID_INTEGER',
    );
  }
  throwsCode(
    () =>
      cfg.parsePublishedConfigurationV1({
        ...published,
        content: { ...policy, slotStepMinutes: 20 },
      }),
    'INVALID_ENUM',
  );
  throwsCode(
    () => cfg.parsePublishedConfigurationV1({ ...published, content: { ...policy, extra: true } }),
    'UNEXPECTED_FIELD',
  );
  throwsCode(
    () =>
      cfg.parsePublishedConfigurationV1({
        ...published,
        namespace: 'market.presentation.v1',
        content: { currency: 'EUR', defaultLocale: 'ar', timezone: 'Asia/Damascus' },
      }),
    'INVALID_ENUM',
  );
});

test('configuration: draft and transition bodies', () => {
  assert.deepEqual(
    cfg.parseCreateDraftRequestV1('booking.policy.v1', { expectedVersion: null, content: policy }),
    {
      expectedVersion: null,
      content: { namespace: 'booking.policy.v1', content: policy },
    },
  );
  throwsCode(
    () => cfg.parseCreateDraftRequestV1('unknown.v1', { expectedVersion: 1, content: policy }),
    'INVALID_ENUM',
  );
  throwsCode(
    () =>
      cfg.parseCreateDraftRequestV1('booking.policy.v1', { expectedVersion: 0, content: policy }),
    'INVALID_INTEGER',
  );
  assert.deepEqual(cfg.parseDraftTransitionRequestV1({ expectedRevision: 2 }), {
    expectedRevision: 2,
  });
  throwsCode(() => cfg.parseDraftTransitionRequestV1({}), 'MISSING_FIELD');
});
