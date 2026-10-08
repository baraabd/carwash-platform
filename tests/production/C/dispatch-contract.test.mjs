/**
 * Dispatch against the PUBLISHED contracts (built @carwash/contracts and
 * @carwash/event-contracts):
 *   - every error body the edge can produce is accepted by parseApiErrorEnvelope
 *     and agrees with API_ERROR_STATUS / API_ERROR_RETRYABLE;
 *   - the consumer admits exactly what the published hold-changed parser admits;
 *   - the produced (requested, unpublished) assignment-changed event is a valid
 *     envelope v2 and carries no personal data.
 * No database or broker is needed; these are compiled-artifact contract checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROOT, require, serviceDist } from './_support.mjs';

const contracts = require(path.join(ROOT, 'packages', 'contracts', 'dist', 'common', 'errors.js'));
const events = require(path.join(ROOT, 'packages', 'event-contracts', 'dist', 'index.js'));
const { errorBody, statusOf, RateLimited } = serviceDist(
  'dispatch',
  'transport/http/http-errors.js',
);
const { DispatchError, assignmentChangedEvent, openAssignment } = serviceDist(
  'dispatch',
  'domain/index.js',
);
const { parseHoldChanged } = serviceDist('dispatch', 'application/index.js');
const { IdentityAuthFailure } = serviceDist(
  'dispatch',
  'infrastructure/identity/identity-session.client.js',
);
const { ConcurrencyViolation } = serviceDist(
  'dispatch',
  'infrastructure/persistence/prisma-dispatch.store.js',
);

const DOMAIN_CODES = [
  'INVALID_INPUT',
  'FORBIDDEN',
  'ASSIGNMENT_NOT_FOUND',
  'OFFER_NOT_FOUND',
  'ASSIGNMENT_CANCELLED',
  'ASSIGNMENT_ALREADY_ASSIGNED',
  'ASSIGNMENT_NOT_ASSIGNED',
  'LIVE_OFFER_EXISTS',
  'OFFER_NOT_LIVE',
  'OFFER_EXPIRED',
  'JOB_WINDOW_PASSED',
  'RESOURCE_BUSY',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_CONFLICT',
];

test('every edge error body satisfies the published error envelope', () => {
  const errors = [
    ...DOMAIN_CODES.map((code) => new DispatchError(code, 'x')),
    new IdentityAuthFailure('UNAUTHENTICATED'),
    new IdentityAuthFailure('UNAVAILABLE'),
    new RateLimited(1500),
    new ConcurrencyViolation('OFFER'),
    { meta: { driverAdapterError: { cause: { code: '40P01' } } } },
    { code: 'P2028' },
    { getStatus: () => 404 },
    { getStatus: () => 413 },
    new Error('boom'),
  ];
  for (const error of errors) {
    const body = errorBody(error, randomUUID(), randomUUID());
    const parsed = contracts.parseApiErrorEnvelope(body);
    assert.equal(statusOf(body), contracts.API_ERROR_STATUS[parsed.error.code], parsed.error.code);
    assert.equal(body.error.retryable, contracts.API_ERROR_RETRYABLE.has(body.error.code));
  }
});

test('the consumer admits exactly what the published hold-changed parser admits', () => {
  const base = () => ({
    eventId: randomUUID(),
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: '2026-10-10T08:00:00.000Z',
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: randomUUID(), version: 2 },
    actor: { kind: 'service', id: 'booking' },
    data: {
      state: 'COMMITTED',
      zoneId: randomUUID(),
      startsAt: '2026-10-10T10:00:00.000Z',
      endsAt: '2026-10-10T11:00:00.000Z',
      bookingId: randomUUID(),
    },
  });
  const variants = [
    base(),
    { ...base(), data: { ...base().data, state: 'RELEASED', bookingId: null } },
    { ...base(), data: { ...base().data, state: 'HELD' } },
    { ...base(), producer: 'booking' },
    { ...base(), envelopeVersion: 1 },
    { ...base(), occurredAt: '2026-10-10T08:00:00Z' },
    { ...base(), traceparent: 'not-a-trace' },
    { ...base(), traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' },
    { ...base(), data: { ...base().data, endsAt: '2026-10-10T09:00:00.000Z' } },
    { ...base(), data: { ...base().data, plate: 'X' } },
  ];
  for (const raw of variants) {
    let published = true;
    try {
      events.SCHEDULING_HOLD_CHANGED_V1.parse(raw);
    } catch {
      published = false;
    }
    let ours = true;
    try {
      parseHoldChanged(raw);
    } catch {
      ours = false;
    }
    assert.equal(ours, published, JSON.stringify(raw).slice(0, 120));
  }
});

test('assignment-changed is a valid envelope v2 with closed, PII-free data', () => {
  const now = new Date('2026-10-10T08:00:00.000Z');
  const assignment = openAssignment({
    id: randomUUID(),
    bookingId: randomUUID(),
    holdId: randomUUID(),
    zoneId: randomUUID(),
    startsAt: new Date('2026-10-10T10:00:00.000Z'),
    endsAt: new Date('2026-10-10T11:00:00.000Z'),
    now,
  });
  const event = assignmentChangedEvent({
    eventId: randomUUID(),
    correlationId: randomUUID(),
    causationId: randomUUID(),
    actor: { kind: 'system', id: null },
    assignment,
  });
  const parsed = events.parseEnvelopeV2(
    JSON.parse(JSON.stringify(event)),
    {
      eventType: 'dispatch.assignment-changed.v1',
      producer: 'dispatch',
      aggregateType: 'assignment',
    },
    (data) => data,
  );
  assert.equal(parsed.aggregate.version, 1);
  assert.deepEqual(Object.keys(event.data).sort(), [
    'bookingId',
    'endsAt',
    'resourceId',
    'startsAt',
    'status',
    'zoneId',
  ]);
  assert.ok(events.EVENT_PRODUCERS.includes('dispatch'));
  assert.ok(Array.isArray(events.BUSINESS_EVENTS_V1) && events.BUSINESS_EVENTS_V1.length > 0);
  assert.equal(
    events.BUSINESS_EVENTS_V1.some((e) => e.eventType === 'dispatch.assignment-changed.v1'),
    false,
    'the event is not (yet) published by Lane E; it must not be claimed as published',
  );
  assert.ok(
    events.BUSINESS_EVENTS_V1.some((e) => e.eventType === 'scheduling.hold-changed.v1'),
    'the consumed event is published',
  );
});
