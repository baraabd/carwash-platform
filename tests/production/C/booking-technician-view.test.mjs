/**
 * Booking technician view (P03-C3) with REAL processes.
 *
 * Runs the COMPILED Dispatch API (services/dispatch/dist/main.js) and the
 * COMPILED Booking API (services/booking/dist/main.js) as OS processes on the
 * lane PostgreSQL. Booking authorizes every technician read by calling the real
 * Dispatch `GET /internal/v1/dispatch/bookings/:id/assignment` with its interim
 * service credential, configured as a SHA-256 digest in DISPATCH_SERVICE_CLIENTS
 * with scope `dispatch.assignment.read`.
 *
 * Seeding: the booking is created through Booking's own POST /bookings (real
 * saga and store; owners are the shared HTTP double). The Dispatch job is
 * opened by delivering the COMMITTED `scheduling.hold-changed.v1` for that
 * booking through Dispatch's own inbox store and handler (published parser),
 * exactly as dispatch-restart does. Offer / accept / reassign go through
 * Dispatch HTTP as operations and technicians. Identity is the double.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import pg from '../../../services/booking/node_modules/pg/lib/index.js';
import {
  ROOT,
  digest,
  freePort,
  readContext,
  require,
  serviceDist,
  startProcess,
  waitHttp,
} from './_support.mjs';

const BOOKING_MAIN = path.join(ROOT, 'services', 'booking', 'dist', 'main.js');
const DISPATCH_MAIN = path.join(ROOT, 'services', 'dispatch', 'dist', 'main.js');
const { startOwnerDoubles, bookingEnv } = require(
  path.join(ROOT, 'services', 'booking', 'dist-tests', 'test', 'support', 'owner-doubles.js'),
);
const { PrismaService } = serviceDist('dispatch', 'infrastructure/persistence/prisma.service.js');
const { PrismaDispatchStore } = serviceDist(
  'dispatch',
  'infrastructure/persistence/prisma-dispatch.store.js',
);
const { holdChangedConsumerParts } = serviceDist(
  'dispatch',
  'transport/messaging/hold-changed.consumer.js',
);
const { systemClock, uuidGenerator } = serviceDist('dispatch', 'infrastructure/runtime/system.js');

const SERVICE_TOKEN = `booking-dispatch-${'q'.repeat(40)}`;
const TOKENS = {
  customer: `lane-tv-customer-${randomUUID()}`,
  ops: `lane-tv-operations-${randomUUID()}`,
  a: `lane-tv-technician-a-${randomUUID()}`,
  b: `lane-tv-technician-b-${randomUUID()}`,
};
const SUBJECTS = {
  customer: randomUUID(),
  ops: randomUUID(),
  a: randomUUID(),
  b: randomUUID(),
};

let context;
let doubles;
let dispatchPrisma;
let parts;
let bookingDb;
let dispatchPort;
let bookingPort;
let dispatchProc;
let bookingProc;
let workforce;
const RESOURCES = new Set();
const WORKFORCE_TOKEN = `dispatch-workforce-${'w'.repeat(40)}`;

/**
 * DOUBLE of the PUBLISHED workforce.v1 listCapacityResources for Dispatch's
 * eligibility check (P03-C4): registered resources are ELIGIBLE with a shift
 * covering the queried window. A Dispatch without that check ignores the
 * DISPATCH_WORKFORCE_* settings, so this suite runs on either source.
 */
async function startWorkforceDouble() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const ok =
      req.headers['x-service-client'] === 'dispatch' &&
      req.headers['x-service-token'] === WORKFORCE_TOKEN &&
      url.pathname === '/internal/v1/workforce/capacity-resources';
    if (!ok) return res.writeHead(404).end();
    const from = new Date(url.searchParams.get('from'));
    const to = new Date(url.searchParams.get('to'));
    const items = [...RESOURCES].map((resourceId) => ({
      resourceId,
      revision: 1,
      eligibility: 'ELIGIBLE',
      eligibilityRevision: 1,
      zoneIds: [url.searchParams.get('zoneId')],
      shifts: [
        {
          startsAt: new Date(from.getTime() - 3_600_000).toISOString(),
          endsAt: new Date(to.getTime() + 3_600_000).toISOString(),
        },
      ],
    }));
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ items, nextCursor: null, asOf: new Date().toISOString() }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

before(async () => {
  context = await readContext();
  doubles = await startOwnerDoubles();
  const tech = ['work.read:assigned', 'work.execute:assigned'];
  doubles.sessions.set(TOKENS.customer, {
    subject: SUBJECTS.customer,
    principalKind: 'account',
    permissions: ['bookings.create:self', 'bookings.read:self'],
  });
  doubles.sessions.set(TOKENS.ops, {
    subject: SUBJECTS.ops,
    principalKind: 'account',
    permissions: ['operations.dispatch'],
  });
  doubles.sessions.set(TOKENS.a, {
    subject: SUBJECTS.a,
    principalKind: 'account',
    permissions: tech,
  });
  doubles.sessions.set(TOKENS.b, {
    subject: SUBJECTS.b,
    principalKind: 'account',
    permissions: tech,
  });

  dispatchPrisma = new PrismaService(context.databases.dispatch.appUrl);
  parts = holdChangedConsumerParts(
    new PrismaDispatchStore(dispatchPrisma),
    systemClock,
    uuidGenerator,
  );
  bookingDb = new pg.Pool({
    connectionString: context.databases.booking.appUrl.replace('?schema=app', ''),
    max: 2,
  });
  workforce = await startWorkforceDouble();
  dispatchPort = await freePort();
  bookingPort = await freePort();

  dispatchProc = startProcess(DISPATCH_MAIN, {
    PORT: String(dispatchPort),
    HOST: '127.0.0.1',
    DATABASE_URL: context.databases.dispatch.appUrl,
    IDENTITY_URL: doubles.url,
    DISPATCH_USER_REQUESTS_PER_MINUTE: '1000',
    DISPATCH_WORKFORCE_URL: workforce.url,
    DISPATCH_WORKFORCE_CLIENT_ID: 'dispatch',
    DISPATCH_WORKFORCE_CLIENT_TOKEN: WORKFORCE_TOKEN,
    DISPATCH_SERVICE_CLIENTS: JSON.stringify([
      { id: 'booking', tokenSha256: digest(SERVICE_TOKEN), scopes: ['dispatch.assignment.read'] },
    ]),
  });
  await waitHttp(`http://127.0.0.1:${dispatchPort}/health/live`, (s) => s === 200);

  bookingProc = startProcess(BOOKING_MAIN, {
    ...bookingEnv(doubles, context.databases.booking.appUrl),
    PORT: String(bookingPort),
    HOST: '127.0.0.1',
    BOOKING_USER_REQUESTS_PER_MINUTE: '1000',
    BOOKING_INLINE_SAGA_BUDGET_MS: '15000',
    BOOKING_DISPATCH_URL: `http://127.0.0.1:${dispatchPort}`,
    BOOKING_DISPATCH_CLIENT_ID: 'booking',
    BOOKING_DISPATCH_CLIENT_TOKEN: SERVICE_TOKEN,
    BOOKING_DISPATCH_TIMEOUT_MS: '1000',
  });
  await waitHttp(`http://127.0.0.1:${bookingPort}/health/live`, (s) => s === 200);
});

after(async () => {
  await bookingProc?.kill();
  await dispatchProc?.kill();
  await bookingDb?.end();
  await dispatchPrisma?.client.$disconnect();
  await doubles?.close();
  await workforce?.close();
});

async function http(port, prefix, method, route, token, { body, key } = {}) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  if (key) headers['idempotency-key'] = key;
  const res = await fetch(`http://127.0.0.1:${port}/internal/v1/${prefix}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}

const booking = (method, route, token, options) =>
  http(bookingPort, 'booking', method, route, token, options);
const dispatch = (method, route, token, options) =>
  http(dispatchPort, 'dispatch', method, route, token, options);
const technicianView = (bookingId, token) =>
  booking('GET', `/bookings/${bookingId}/technician-view`, token);

/** A CONFIRMED booking through Booking's API, then the job opened in Dispatch's inbox. */
async function confirmedBookingWithJob() {
  const issued = doubles.issue({ kind: 'account', subjectId: SUBJECTS.customer });
  const created = await booking('POST', '/bookings', TOKENS.customer, {
    key: `lane-tv-${randomUUID()}`,
    body: {
      quote: { quoteId: issued.quoteId, revision: 1 },
      hold: { holdId: issued.holdId, revision: 1 },
      vehicle: {
        source: 'inline',
        inline: { type: 'sedan', make: 'Kia', model: 'Rio', color: null, plate: null },
      },
      address: { addressId: randomUUID(), revision: 1 },
      contact: { name: 'سارة أحمد', phone: '0912345678', notes: null },
      paymentMethod: 'CASH_ON_COMPLETION',
    },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.status, 'CONFIRMED');
  const bookingId = created.body.bookingId;
  const hold = doubles.holds.get(issued.holdId);
  assert.equal(hold.state, 'COMMITTED');
  assert.equal(hold.bookingId, bookingId);

  const raw = {
    eventId: randomUUID(),
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: hold.holdId, version: hold.revision },
    actor: { kind: 'service', id: 'booking' },
    data: {
      state: 'COMMITTED',
      zoneId: hold.zoneId,
      startsAt: hold.startsAt,
      endsAt: hold.endsAt,
      bookingId,
    },
  };
  const text = JSON.stringify(raw);
  const message = parts.parse(JSON.parse(text));
  const outcome = await parts.store.applyOnce(
    {
      eventId: message.eventId,
      eventType: message.eventType,
      payloadHash: createHash('sha256').update(text).digest('hex'),
      correlationId: message.correlationId,
    },
    (tx) => parts.effect(message, tx),
  );
  assert.equal(outcome, 'APPLIED');
  const job = await dispatch('GET', `/bookings/${bookingId}/assignment`, TOKENS.ops);
  assert.equal(job.status, 200, job.text);
  assert.equal(job.body.status, 'UNASSIGNED');
  return { bookingId, assignmentId: job.body.assignmentId };
}

async function offerTo(assignmentId, technician, route = 'offers') {
  const current = await dispatch('GET', `/assignments/${assignmentId}`, TOKENS.ops);
  const res = await dispatch('POST', `/assignments/${assignmentId}/${route}`, TOKENS.ops, {
    key: `lane-tv-offer-${randomUUID()}`,
    body: {
      expectedRevision: current.body.revision,
      resourceId: (() => {
        const id = randomUUID();
        RESOURCES.add(id);
        return id;
      })(),
      technicianSubjectId: technician,
    },
  });
  assert.ok(res.status === 200 || res.status === 201, res.text);
  return res.body.offer.offerId;
}

async function accept(offerId, token) {
  const res = await dispatch('POST', `/offers/${offerId}/accept`, token, {
    key: `lane-tv-accept-${randomUUID()}`,
    body: {},
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.job.status, 'ASSIGNED');
}

async function auditCount(bookingId, actor) {
  const { rows } = await bookingDb.query(
    `SELECT count(*)::int AS n FROM app.audit_entry
      WHERE target_id = $1::uuid AND action = 'booking.technician-view.read' AND actor_id = $2`,
    [bookingId, actor],
  );
  return rows[0].n;
}

test('real Dispatch decides: visible only after accept, never to another technician, gone after reassignment', async () => {
  const { bookingId, assignmentId } = await confirmedBookingWithJob();

  // Job open but nobody offered.
  assert.equal((await technicianView(bookingId, TOKENS.a)).status, 404);

  // Offered to A, not yet accepted.
  const offerA = await offerTo(assignmentId, SUBJECTS.a);
  assert.equal((await technicianView(bookingId, TOKENS.a)).status, 404);

  // Accepted by A: A sees the view, B does not.
  await accept(offerA, TOKENS.a);
  const seen = await technicianView(bookingId, TOKENS.a);
  assert.equal(seen.status, 200, seen.text);
  assert.equal(seen.body.bookingId, bookingId);
  assert.equal(seen.body.status, 'CONFIRMED');
  assert.equal(seen.body.vehicle.plate, null);
  assert.equal(seen.text.includes(SUBJECTS.customer), false);
  assert.equal(await auditCount(bookingId, SUBJECTS.a), 1);
  const other = await technicianView(bookingId, TOKENS.b);
  assert.equal(other.status, 404);
  assert.equal(other.body.error.reason, 'BOOKING_NOT_FOUND');

  // Operations reassigns to B: A loses access at once; B only after accepting.
  const offerB = await offerTo(assignmentId, SUBJECTS.b, 'reassign');
  assert.equal((await technicianView(bookingId, TOKENS.a)).status, 404);
  assert.equal((await technicianView(bookingId, TOKENS.b)).status, 404);
  await accept(offerB, TOKENS.b);
  assert.equal((await technicianView(bookingId, TOKENS.b)).status, 200);
  assert.equal((await technicianView(bookingId, TOKENS.a)).status, 404);
  assert.equal(await auditCount(bookingId, SUBJECTS.a), 1, 'denied reads are not audited');
  assert.equal(await auditCount(bookingId, SUBJECTS.b), 1);
});

test('Dispatch process killed: 503 ASSIGNMENT_UNVERIFIED for the assigned technician, never 200', async () => {
  const { bookingId, assignmentId } = await confirmedBookingWithJob();
  await accept(await offerTo(assignmentId, SUBJECTS.a), TOKENS.a);
  assert.equal((await technicianView(bookingId, TOKENS.a)).status, 200);

  await dispatchProc.kill();
  for (const token of [TOKENS.a, TOKENS.b]) {
    const started = Date.now();
    const res = await technicianView(bookingId, token);
    assert.equal(res.status, 503, res.text);
    assert.equal(res.body.error.code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(res.body.error.reason, 'ASSIGNMENT_UNVERIFIED');
    assert.equal(res.body.error.retryable, true);
    assert.ok(Date.now() - started < 5_000, 'bounded by the Dispatch call budget');
  }
  assert.equal(await auditCount(bookingId, SUBJECTS.a), 1, 'no audit row for an unverified read');
});
