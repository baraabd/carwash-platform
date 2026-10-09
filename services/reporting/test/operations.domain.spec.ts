import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  OperationsIntegrityError,
  OperationsRuleError,
  currentSlot,
  decideFact,
  deriveStatus,
  factFingerprint,
  freshness,
  instantInput,
  linkedBooking,
  pageSize,
  slotWindow,
  type LinkedHold,
} from '../src/domain/operations';
import {
  OperationsProjector,
  OperationsQueries,
  parseOperationsEvent,
} from '../src/application/operations.service';
import { RequestBudget, requireRead } from '../src/application/access';
import { AccessFault, type VerifiedSession } from '../src/ports/identity.ports';
import type {
  FactOutcome,
  OperationsReader,
  OperationsWriter,
} from '../src/ports/operations.ports';
import { IdentitySessionClient } from '../src/infrastructure/identity/identity-session.client';
import { sha256Hex } from '../src/infrastructure/persistence/prisma-projection.store';

const BOOKING = '7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const OTHER_BOOKING = '8b2d3f4a-5c6e-4f70-9b0c-1d2e3f4a5b6c';
const ZONE = '1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b';
const T0 = '2026-10-08T08:00:00.000Z';

function rejects(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof OperationsRuleError && e.code === code);
}

function integrity(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof OperationsIntegrityError && e.code === code);
}

function hold(
  holdId: string,
  state: LinkedHold['state'],
  occurredAt: string,
  startsAt = '2026-10-09T09:00:00.000Z',
): LinkedHold {
  return {
    holdId,
    state,
    zoneId: ZONE,
    startsAt: new Date(startsAt),
    endsAt: new Date(Date.parse(startsAt) + 3_600_000),
    occurredAt: new Date(occurredAt),
  };
}

function envelope(
  eventType: string,
  producer: string,
  aggregate: { type: string; id: string; version: number },
  data: unknown,
) {
  return {
    eventId: randomUUID(),
    eventType,
    envelopeVersion: 2,
    producer,
    occurredAt: T0,
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate,
    actor: { kind: 'service', id: producer },
    data,
  };
}

/* ------------------------------ domain rules ------------------------------ */

test('operations domain: versions are monotonic and a same-version change is a conflict', () => {
  assert.equal(decideFact(null, { version: 1, fingerprint: 'a' }), 'APPLY');
  assert.equal(
    decideFact({ version: 1, fingerprint: 'a' }, { version: 2, fingerprint: 'b' }),
    'APPLY',
  );
  assert.equal(
    decideFact({ version: 3, fingerprint: 'a' }, { version: 2, fingerprint: 'b' }),
    'STALE',
  );
  assert.equal(
    decideFact({ version: 2, fingerprint: 'a' }, { version: 2, fingerprint: 'a' }),
    'SAME',
  );
  integrity(
    () => decideFact({ version: 2, fingerprint: 'a' }, { version: 2, fingerprint: 'b' }),
    'FACT_VERSION_CONFLICT',
  );
});

test('operations domain: a hold belongs to one booking for life', () => {
  assert.equal(linkedBooking(null, null), null);
  assert.equal(linkedBooking(null, BOOKING), BOOKING);
  assert.equal(linkedBooking(BOOKING, null), BOOKING, 'a later RELEASED keeps the link');
  assert.equal(linkedBooking(BOOKING, BOOKING), BOOKING);
  integrity(() => linkedBooking(BOOKING, OTHER_BOOKING), 'HOLD_BOOKING_CONFLICT');
});

test('operations domain: a reschedule keeps the new committed slot whatever the arrival order', () => {
  const oldHold = 'a0000000-0000-4000-8000-000000000001';
  const newHold = 'a0000000-0000-4000-8000-000000000002';
  // The old hold's RELEASE occurs AFTER the new hold's COMMIT.
  const holds = [
    hold(newHold, 'COMMITTED', '2026-10-08T08:01:00.000Z', '2026-10-10T09:00:00.000Z'),
    hold(oldHold, 'RELEASED', '2026-10-08T08:02:00.000Z'),
  ];
  for (const order of [holds, [...holds].reverse()]) {
    const slot = currentSlot(order);
    assert.equal(slot?.holdId, newHold);
    assert.equal(slot?.state, 'COMMITTED');
    assert.equal(deriveStatus({ confirmed: true, latestSlot: slot }), 'SCHEDULED');
  }
});

test('operations domain: without a committed hold the latest one explains the missing slot', () => {
  const a = 'a0000000-0000-4000-8000-00000000000a';
  const b = 'a0000000-0000-4000-8000-00000000000b';
  assert.equal(currentSlot([]), null);
  const slot = currentSlot([
    hold(a, 'EXPIRED', '2026-10-08T08:00:00.000Z'),
    hold(b, 'RELEASED', '2026-10-08T08:05:00.000Z'),
  ]);
  assert.equal(slot?.holdId, b);
  assert.equal(deriveStatus({ confirmed: true, latestSlot: slot }), 'SLOT_RELEASED');
  // Equal occurrence: the hold id breaks the tie deterministically.
  const tie = currentSlot([
    hold(a, 'COMMITTED', '2026-10-08T08:00:00.000Z'),
    hold(b, 'COMMITTED', '2026-10-08T08:00:00.000Z'),
  ]);
  assert.equal(tie?.holdId, b);
});

test('operations domain: derived status covers every combination and never invents one', () => {
  const committed = currentSlot([hold(BOOKING, 'COMMITTED', T0)]);
  const held = currentSlot([hold(BOOKING, 'HELD', T0)]);
  assert.equal(deriveStatus({ confirmed: true, latestSlot: null }), 'CONFIRMED_UNSCHEDULED');
  assert.equal(deriveStatus({ confirmed: true, latestSlot: held }), 'CONFIRMED_UNSCHEDULED');
  assert.equal(
    deriveStatus({ confirmed: false, latestSlot: committed }),
    'SLOT_COMMITTED_UNCONFIRMED',
  );
  assert.equal(deriveStatus({ confirmed: false, latestSlot: held }), null);
  assert.equal(deriveStatus({ confirmed: false, latestSlot: null }), null);
});

test('operations domain: freshness distinguishes no data, fresh and stale, with ingestion lag', () => {
  const now = new Date('2026-10-08T10:00:00.000Z');
  assert.equal(freshness('booking', null, now).status, 'NO_DATA');
  const fresh = freshness(
    'scheduling',
    {
      lastEventOccurredAt: new Date('2026-10-08T09:59:00.000Z'),
      lastAppliedAt: new Date('2026-10-08T09:59:02.500Z'),
      appliedCount: 7n,
    },
    now,
  );
  assert.equal(fresh.status, 'FRESH');
  assert.equal(fresh.ingestionLagMs, 2_500);
  const stale = freshness(
    'workforce',
    {
      lastEventOccurredAt: new Date('2026-10-08T09:00:00.000Z'),
      lastAppliedAt: new Date('2026-10-08T09:00:00.000Z'),
      appliedCount: 1n,
    },
    now,
  );
  assert.equal(stale.status, 'STALE');
});

test('operations domain: query inputs are strict and bounded', () => {
  assert.equal(instantInput('2026-10-08T08:00:00Z', 'X').toISOString(), T0);
  rejects(() => instantInput('2026-02-30T00:00:00Z', 'X'), 'X');
  rejects(() => instantInput('2026-10-08 08:00', 'X'), 'X');
  rejects(() => instantInput(42, 'X'), 'X');
  assert.equal(pageSize(undefined), 25);
  assert.equal(pageSize('100'), 100);
  for (const bad of ['0', '101', '1.5', '-1', '01', 'ten'])
    rejects(() => pageSize(bad), 'INVALID_LIMIT');
  rejects(() => slotWindow(T0, T0), 'INVALID_WINDOW');
  rejects(() => slotWindow('2026-10-01T00:00:00Z', '2026-11-02T00:00:00Z'), 'WINDOW_TOO_LARGE');
  assert.ok(slotWindow('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'));
});

/* ---------------------------- contract parsing ---------------------------- */

test('operations events: published contracts parse to facts; anything else is refused', () => {
  const holdId = randomUUID();
  const parsed = parseOperationsEvent(
    envelope(
      'scheduling.hold-changed.v1',
      'scheduling',
      { type: 'hold', id: holdId, version: 2 },
      {
        state: 'COMMITTED',
        zoneId: ZONE.toUpperCase(),
        startsAt: '2026-10-09T09:00:00.000Z',
        endsAt: '2026-10-09T10:00:00.000Z',
        bookingId: BOOKING,
      },
    ),
  );
  const fact = parsed.fact;
  assert.ok(fact.kind === 'HOLD_CHANGED');
  assert.equal(fact.zoneId, ZONE, 'identifiers are normalised to lower case');
  assert.equal(fact.bookingId, BOOKING);
  assert.equal(fact.version, 2);

  const eligibility = parseOperationsEvent(
    envelope(
      'workforce.eligibility-changed.v1',
      'workforce',
      { type: 'capacity-resource', id: randomUUID(), version: 4 },
      { eligibility: 'INELIGIBLE' },
    ),
  );
  assert.equal(eligibility.fact.kind, 'ELIGIBILITY_CHANGED');

  const confirmed = parseOperationsEvent({
    eventId: randomUUID(),
    eventType: 'booking.confirmed.v1',
    schemaVersion: 1,
    producer: 'booking',
    occurredAt: T0,
    correlationId: randomUUID(),
    aggregateVersion: 3,
    data: { bookingId: BOOKING, customerId: randomUUID() },
  });
  assert.equal(confirmed.fact.kind, 'BOOKING_CONFIRMED');

  // The local Workforce event shape (not the published contract) is refused.
  assert.throws(() =>
    parseOperationsEvent({
      ...envelope(
        'workforce.eligibility-changed.v1',
        'workforce',
        {
          type: 'capacity-resource',
          id: randomUUID(),
          version: 1,
        },
        { eligibility: 'ELIGIBLE' },
      ),
      data: { operatorId: randomUUID(), eligible: true },
    }),
  );
  // COMMITTED without a booking contradicts the contract.
  assert.throws(() =>
    parseOperationsEvent(
      envelope(
        'scheduling.hold-changed.v1',
        'scheduling',
        { type: 'hold', id: holdId, version: 1 },
        {
          state: 'COMMITTED',
          zoneId: ZONE,
          startsAt: '2026-10-09T09:00:00.000Z',
          endsAt: '2026-10-09T10:00:00.000Z',
          bookingId: null,
        },
      ),
    ),
  );
  for (const raw of [null, [], 'x', { eventType: 'catalog.definitions-published.v1' }])
    assert.throws(() => parseOperationsEvent(raw));
});

test('operations events: fingerprints change with content and ignore delivery identity', () => {
  const base = parseOperationsEvent(
    envelope(
      'workforce.eligibility-changed.v1',
      'workforce',
      {
        type: 'capacity-resource',
        id: BOOKING,
        version: 1,
      },
      { eligibility: 'ELIGIBLE' },
    ),
  ).fact;
  const redelivered = { ...base, eventId: randomUUID() };
  const changed = { ...base, eligibility: 'INELIGIBLE' as const };
  assert.equal(factFingerprint(base), factFingerprint(redelivered));
  assert.notEqual(factFingerprint(base), factFingerprint(changed));
});

/* ------------------------------- application ------------------------------ */

test('operations projector: every applied, stale or repeated fact moves freshness', async () => {
  const calls: string[] = [];
  const outcomes: FactOutcome[] = ['APPLIED', 'STALE', 'SAME'];
  const writer: OperationsWriter = {
    applyBookingConfirmed: () => Promise.resolve(outcomes.shift() ?? 'APPLIED'),
    applyHoldChanged: () => Promise.resolve('APPLIED'),
    applyEligibilityChanged: () => Promise.resolve('APPLIED'),
    applyAssignmentChanged: () => Promise.resolve('APPLIED'),
    applyObligationStatus: () => Promise.resolve('APPLIED'),
    touchFreshness: (source) => {
      calls.push(source);
      return Promise.resolve();
    },
  };
  const projector = new OperationsProjector(sha256Hex, { now: () => new Date(T0) });
  const fact = {
    kind: 'BOOKING_CONFIRMED' as const,
    source: 'booking' as const,
    eventId: randomUUID(),
    occurredAt: new Date(T0),
    version: 1,
    bookingId: BOOKING,
    customerRef: randomUUID(),
  };
  assert.deepEqual(
    [
      await projector.apply(writer, fact),
      await projector.apply(writer, fact),
      await projector.apply(writer, fact),
    ],
    ['APPLIED', 'STALE', 'SAME'],
  );
  assert.deepEqual(calls, ['booking', 'booking', 'booking']);
});

test('operations queries: every read is labelled derived, with owners and per-source freshness', async () => {
  const reader: OperationsReader = {
    listBookings: () => Promise.resolve({ items: [], nextCursor: null }),
    booking: () => Promise.resolve(null),
    bookingHolds: () => Promise.reject(new Error('not reached for an unprojected booking')),
    listResources: () => Promise.resolve({ items: [], nextCursor: null }),
    resourceSummary: () => Promise.resolve({ eligible: 0, ineligible: 0 }),
    bookingAssignments: () => Promise.reject(new Error('not reached for an unprojected booking')),
    operationsKpis: () => Promise.reject(new Error('not used here')),
    cashKpis: () => Promise.reject(new Error('not used here')),
    checkpoints: () => Promise.resolve(new Map()),
  };
  const queries = new OperationsQueries(reader, { now: () => new Date(T0) });
  const page = await queries.bookings({
    from: '2026-10-08T00:00:00Z',
    to: '2026-10-09T00:00:00Z',
    zoneId: undefined,
    status: 'SCHEDULED',
    limit: undefined,
    cursor: undefined,
  });
  assert.equal(page.derived, true);
  assert.deepEqual(
    page.freshness.map((f) => [f.source, f.status]),
    [
      ['booking', 'NO_DATA'],
      ['scheduling', 'NO_DATA'],
    ],
  );
  assert.ok(page.authority.some((a) => a.owner === 'booking'));
  const detail = await queries.booking(BOOKING);
  assert.equal(detail.item, null);
  assert.deepEqual(detail.holds, []);
  assert.deepEqual(detail.assignments, []);
  const base = {
    from: '2026-10-08T00:00:00Z',
    to: '2026-10-09T00:00:00Z',
    limit: undefined,
    zoneId: undefined,
    status: undefined,
    cursor: undefined,
  };
  for (const [patch, code] of [
    [{ status: 'DONE' }, 'INVALID_STATUS'],
    [{ zoneId: 'zone-1' }, 'INVALID_ZONE'],
    [{ cursor: 'bad cursor' }, 'INVALID_CURSOR'],
  ] as const) {
    await assert.rejects(
      queries.bookings({ ...base, ...patch }),
      (e: unknown) => e instanceof OperationsRuleError && e.code === code,
    );
  }
  await assert.rejects(
    queries.resources({ eligibility: 'MAYBE', limit: undefined, cursor: undefined }),
    (e: unknown) => e instanceof OperationsRuleError && e.code === 'INVALID_ELIGIBILITY',
  );
});

/* --------------------------------- access --------------------------------- */

function session(permissions: string[]): VerifiedSession {
  return { subject: randomUUID(), sessionId: randomUUID(), authVersion: 1, permissions };
}

test('operations access: role permissions gate each read; everything else is denied', () => {
  const forbidden = (fn: () => void) =>
    assert.throws(fn, (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_FORBIDDEN');
  const operations = session(['operations.dispatch']);
  const reviewer = session(['verification.review']);
  const customer = session(['profile.read:self', 'bookings.read:self']);
  requireRead(operations, 'bookings');
  requireRead(operations, 'resources');
  requireRead(reviewer, 'resources');
  requireRead(reviewer, 'freshness');
  forbidden(() => requireRead(reviewer, 'bookings'));
  for (const read of ['bookings', 'resources', 'freshness'] as const)
    forbidden(() => requireRead(customer, read));
});

test('operations access: the per-subject read budget is bounded and windowed', () => {
  let now = 0;
  const budget = new RequestBudget(2, 1_000, () => now);
  budget.take('a');
  budget.take('a');
  budget.take('b');
  assert.throws(
    () => budget.take('a'),
    (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_RATE_LIMITED',
  );
  now = 1_000;
  budget.take('a');
  assert.throws(() => new RequestBudget(0));
});

async function identityStub(
  handler: (respond: (status: number, body: string) => void) => void,
): Promise<{ server: Server; origin: URL }> {
  const server = createServer((_req, res) =>
    handler((status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('NO_ADDRESS');
  return { server, origin: new URL(`http://127.0.0.1:${address.port}`) };
}

test('operations identity client: verifies with Identity and fails closed', async () => {
  const subject = randomUUID();
  let reply = { status: 200, body: '' };
  const { server, origin } = await identityStub((respond) => respond(reply.status, reply.body));
  const client = new IdentitySessionClient(origin, 500);
  const bearer = `Bearer ${'a'.repeat(40)}`;
  const code = (e: unknown, expected: string) => e instanceof AccessFault && e.code === expected;
  try {
    reply = {
      status: 200,
      body: JSON.stringify({
        subject,
        sessionId: randomUUID(),
        authVersion: 2,
        principalKind: 'account',
        roles: ['reviewer'],
        permissions: ['verification.review'],
      }),
    };
    const verified = await client.verify({ authorization: bearer, forwardedSubject: subject });
    assert.deepEqual(verified.permissions, ['verification.review']);
    await assert.rejects(
      client.verify({ authorization: bearer, forwardedSubject: randomUUID() }),
      (e) => code(e, 'AUTH_REQUIRED'),
    );
    await assert.rejects(
      client.verify({ authorization: undefined, forwardedSubject: undefined }),
      (e) => code(e, 'AUTH_REQUIRED'),
    );
    await assert.rejects(
      client.verify({ authorization: 'Basic abc', forwardedSubject: undefined }),
      (e) => code(e, 'AUTH_REQUIRED'),
    );
    reply = { status: 401, body: '{}' };
    await assert.rejects(
      client.verify({ authorization: bearer, forwardedSubject: undefined }),
      (e) => code(e, 'AUTH_REQUIRED'),
    );
    for (const bad of [
      { status: 500, body: '{}' },
      { status: 200, body: 'not json' },
      { status: 200, body: JSON.stringify({ subject: 'x', permissions: [] }) },
      {
        status: 200,
        body: JSON.stringify({
          subject,
          sessionId: randomUUID(),
          authVersion: 1,
          permissions: ['DROP TABLE'],
        }),
      },
    ]) {
      reply = bad;
      await assert.rejects(
        client.verify({ authorization: bearer, forwardedSubject: undefined }),
        (e) => code(e, 'AUTH_UNAVAILABLE'),
      );
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
  // Unreachable Identity is unavailable, never an allow.
  await assert.rejects(
    new IdentitySessionClient(origin, 200).verify({
      authorization: bearer,
      forwardedSubject: undefined,
    }),
    (e) => code(e, 'AUTH_UNAVAILABLE'),
  );
  assert.throws(() => new IdentitySessionClient(new URL('http://identity.example.com')));
  assert.throws(() => new IdentitySessionClient(new URL('https://u:p@identity.internal')));
});
