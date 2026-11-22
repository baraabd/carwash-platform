/**
 * Real Identity (PostgreSQL, Redis, signatures), Gateway, Booking and Billing.
 * The Billing fault proxy changes transport delivery only; it never fabricates
 * a successful owner response or changes a database. Pricing, Scheduling and
 * saved-address resolution are explicit HTTP doubles. This proves the actual
 * Booking/Billing boundary, not full checkout, actual capacity or merchant payment.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  ROOT,
  ORIGIN,
  account,
  guest,
  context,
  contracts,
  idempotencyKey,
  serviceRequire,
  sql,
  startIdentity,
  startService,
} from './_support.mjs';

const bookingRequire = serviceRequire('booking');
const billingRequire = serviceRequire('billing');
const { startOwnerDoubles, bookingEnv } = bookingRequire(
  './dist-tests/test/support/owner-doubles.js',
);
const { startValidateStub, WORKLOADS, SERVICE_CLIENTS } = billingRequire(
  './dist-tests/test/support/booking-saga-harness.js',
);
const { BookingProcessManager } = bookingRequire('./dist/application/process-manager.js');
const { PrismaService } = bookingRequire('./dist/infrastructure/persistence/prisma.service.js');
const { PrismaBookingStore } = bookingRequire(
  './dist/infrastructure/persistence/prisma-booking.store.js',
);
const { OwnerHttpClient } = bookingRequire('./dist/infrastructure/http/owner-http.client.js');
const { BillingObligationsAdapter, PricingQuoteValidator, SchedulingHoldCommitter } =
  bookingRequire('./dist/infrastructure/owners/owner-adapters.js');
const gatewayRequire = createRequire(path.join(ROOT, 'apps/api-gateway/package.json'));
const { createGatewayApplication } = gatewayRequire('./dist/index.js');

let identity;
let billing;
let booking;
let upstreams;
let validate;
let proxy;
let gateway;
let base;
const workerPools = [];
const money = contracts.billingV1;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function deadline(promise, milliseconds = 8000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('TEST_BOUNDARY_TIMEOUT')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** No secret headers/bodies are retained in evidence; only opaque booking ids and counters. */
async function billingFaultProxy(origin) {
  const state = {
    loseCreate: 0,
    loseCompensation: 0,
    rejectCreate: false,
    rejectCompensation: false,
    pending: null,
  };
  const calls = { create: 0, compensate: 0 };
  const server = createServer((request, response) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const create = request.url === '/internal/v1/billing/booking-obligations';
      const compensate = request.url === '/internal/v1/billing/booking-obligations/compensations';
      if (create) calls.create += 1;
      if (compensate) calls.compensate += 1;
      if ((create && state.rejectCreate) || (compensate && state.rejectCompensation)) {
        response
          .writeHead(503, { 'content-type': 'application/json' })
          .end('{"error":{"code":"UPSTREAM_UNAVAILABLE"}}');
        return;
      }
      const gate = create ? state.pending : null;
      if (gate) state.pending = null;
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter(
          ([name, value]) =>
            value !== undefined && !['host', 'connection', 'content-length'].includes(name),
        ),
      );
      const remote = await fetch(origin + request.url, {
        method: request.method,
        headers,
        ...(body.length ? { body } : {}),
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(6000),
      });
      const bytes = await remote.arrayBuffer();
      if (gate) {
        gate.entered.resolve({
          bookingId: JSON.parse(body.toString('utf8')).bookingId,
          status: remote.status,
        });
        await gate.release.promise;
      }
      if ((create && state.loseCreate > 0) || (compensate && state.loseCompensation > 0)) {
        if (create) state.loseCreate -= 1;
        else state.loseCompensation -= 1;
        response.destroy();
        return;
      }
      response
        .writeHead(remote.status, {
          'content-type': remote.headers.get('content-type') ?? 'application/json',
          'idempotency-replayed': remote.headers.get('idempotency-replayed') ?? 'false',
        })
        .end(Buffer.from(bytes));
    })().catch(() => {
      response.destroy();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    state,
    calls,
    pauseNextCreate() {
      const gate = { entered: deferred(), release: deferred() };
      state.pending = gate;
      return { entered: gate.entered.promise, release: () => gate.release.resolve() };
    },
    async close() {
      state.pending?.release.resolve();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

before(async () => {
  assert.ok(context.services.billing?.app && context.services.booking?.app);
  identity = await startIdentity();
  upstreams = await startOwnerDoubles();
  validate = await startValidateStub();
  billing = await startService('billing', context.services.billing.app, {
    IDENTITY_SESSION_ORIGIN: identity.base,
    IDENTITY_SESSION_TIMEOUT_MS: '3000',
    PRICING_ORIGIN: validate.origin,
    PRICING_TIMEOUT_MS: '3000',
    BILLING_SERVICE_CLIENTS: SERVICE_CLIENTS,
    BILLING_PRICING_CLIENT_ID: WORKLOADS.billing.clientId,
    BILLING_PRICING_SERVICE_TOKEN: WORKLOADS.billing.token,
  });
  proxy = await billingFaultProxy(billing.base);
  booking = await startService('booking', context.services.booking.app, {
    ...bookingEnv(upstreams, context.services.booking.app),
    IDENTITY_URL: identity.base,
    IDENTITY_TIMEOUT_MS: '3000',
    BILLING_URL: proxy.base,
    BOOKING_TOKEN_BILLING: WORKLOADS.booking.token,
    BOOKING_OWNER_TIMEOUT_MS: '5000',
    BOOKING_INLINE_SAGA_BUDGET_MS: '4000',
    BOOKING_SAGA_LEASE_MS: '1000',
    BOOKING_USER_REQUESTS_PER_MINUTE: '120',
  });
  gateway = await createGatewayApplication({
    origins: { identity: identity.base, booking: booking.base, billing: billing.base },
    issuer: 'https://identity.washgo.invalid',
    audience: 'washgo-web',
    cookiePrefix: '__Host-wg_',
    timeoutMs: 8000,
    responseLimit: 262144,
    allowedOrigins: [ORIGIN],
  });
  await gateway.listen(0, '127.0.0.1');
  base = await gateway.getUrl();
});

after(async () => {
  await gateway?.close();
  await booking?.app.close();
  await proxy?.close();
  await billing?.app.close();
  await Promise.all(workerPools.map((pool) => pool.onModuleDestroy()));
  await upstreams?.close();
  await validate?.close();
  await identity?.app.close();
});

async function caller(kind = 'guest') {
  const person = await (kind === 'guest' ? guest(identity) : account(identity));
  const principal = { kind, subjectId: person.subject };
  // Only the explicit Pricing/Scheduling doubles need this fixture mapping.
  upstreams.sessions.set(person.token, {
    subject: person.subject,
    principalKind: kind,
    permissions: ['bookings.read:self', 'bookings.create:self'],
  });
  return { ...person, principal };
}

function bookingInput(person) {
  const issued = upstreams.issue(person.principal);
  const quote = upstreams.quotes.get(issued.quoteId);
  validate.quotes.set(issued.quoteId, {
    beneficiary: person.principal,
    status: 'USABLE',
    revision: quote.revision,
    currency: quote.total.currency,
    totalMinor: quote.total.amountMinor,
  });
  return {
    quote: { quoteId: issued.quoteId, revision: quote.revision },
    hold: { holdId: issued.holdId, revision: 1 },
    vehicle: {
      source: 'inline',
      inline: { type: 'sedan', make: 'Kia', model: null, color: null, plate: null },
    },
    address: { addressId: randomUUID(), revision: 1 },
    contact: { name: 'عميل الاختبار', phone: '+963912345678', notes: null },
    paymentMethod: 'SHAM_CASH',
  };
}

async function call(person, route, { method = 'GET', body, key, headers = {} } = {}) {
  const response = await fetch(base + '/api/v1' + route, {
    method,
    headers: {
      ...(person ? { cookie: person.jar.header() } : {}),
      ...(method === 'GET'
        ? {}
        : {
            'content-type': 'application/json',
            origin: ORIGIN,
            'x-csrf-token': person?.jar.cookies.get('__Host-wg_csrf') ?? '',
          }),
      ...(key ? { 'idempotency-key': key } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}

function worker(now = new Date()) {
  let instant = now;
  const clock = { now: () => new Date(instant) };
  const pool = new PrismaService(context.services.booking.app);
  workerPools.push(pool);
  const store = new PrismaBookingStore(pool, { sagaLeaseMs: 1000 });
  const owner = (name, url, token) =>
    new OwnerHttpClient({
      owner: name,
      baseUrl: url,
      timeoutMs: 5000,
      service: { clientId: 'booking', token },
    });
  const manager = new BookingProcessManager({
    store,
    billing: new BillingObligationsAdapter(owner('billing', proxy.base, WORKLOADS.booking.token)),
    quotes: new PricingQuoteValidator(owner('pricing', upstreams.url, upstreams.tokens.pricing)),
    holds: new SchedulingHoldCommitter(
      owner('scheduling', upstreams.url, upstreams.tokens.scheduling),
    ),
    clock,
    ids: { next: randomUUID },
    random: { next: () => 0.5 },
    observer: { record() {} },
    leaseMs: 1000,
    traceparent: () => null,
  });
  return {
    manager,
    store,
    advance(ms) {
      instant = new Date(instant.getTime() + ms);
    },
  };
}

async function financialRows(bookingId) {
  const result = await sql(
    context.services.billing.app,
    `SELECT o.id::text, o.status, o.revision,
      (SELECT count(*)::int FROM app.ledger_journal j WHERE j.obligation_id=o.id AND j.kind='OBLIGATION_VOIDED') AS voids
     FROM app.booking_obligation l JOIN app.billing_obligation o ON o.id=l.obligation_id WHERE l.booking_id=$1`,
    [bookingId],
  );
  return result.rows;
}

test('real guest and account journeys: actual Booking creates one Billing obligation and exact-owner Gateway lookup', async () => {
  for (const kind of ['guest', 'account']) {
    const person = await caller(kind);
    const foreign = await caller();
    const input = bookingInput(person);
    const key = idempotencyKey();
    const result = await call(person, '/customer/bookings', { method: 'POST', body: input, key });
    assert.equal(result.status, 201);
    assert.equal(result.body.status, 'CONFIRMED');
    const bookingId = result.body.bookingId;
    const read = await call(person, `/customer/bookings/${bookingId}/obligation`);
    assert.equal(read.status, 200);
    const obligation = money.parseObligationV1(read.body);
    assert.equal(obligation.quoteId, input.quote.quoteId);
    assert.deepEqual(obligation.amount, result.body.total);
    assert.equal(obligation.status, 'OPEN');
    const replay = await call(person, '/customer/bookings', { method: 'POST', body: input, key });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.bookingId, bookingId);
    assert.equal((await financialRows(bookingId)).length, 1);
    assert.equal((await call(foreign, `/customer/bookings/${bookingId}/obligation`)).status, 404);
    assert.equal(
      (await call(foreign, `/customer/bookings/${randomUUID()}/obligation`)).status,
      404,
    );
    assert.equal(
      (
        await call(null, `/customer/bookings/${bookingId}/obligation`, {
          headers: { 'x-auth-subject': person.subject, 'x-auth-permissions': 'bookings.read:self' },
        })
      ).status,
      401,
    );
    await person.logout();
    assert.equal((await call(person, `/customer/bookings/${bookingId}/obligation`)).status, 401);
  }
});

test('lost successful create response: pending Booking retries the same owner command, finds one obligation and confirms once', async () => {
  const person = await caller();
  const input = bookingInput(person);
  proxy.state.loseCreate = 1;
  const created = await call(person, '/customer/bookings', {
    method: 'POST',
    body: input,
    key: idempotencyKey(),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'PENDING_CONFIRMATION');
  const bookingId = created.body.bookingId;
  const before = await financialRows(bookingId);
  assert.equal(before.length, 1, 'owner committed despite the lost response');
  const resumed = worker(new Date(Date.now() + 30000));
  assert.equal(await resumed.manager.drive(bookingId, 'lost-response-worker', 5000), 'DONE');
  const read = await call(person, `/customer/bookings/${bookingId}`);
  assert.equal(read.body.status, 'CONFIRMED');
  assert.deepEqual(
    await financialRows(bookingId),
    before,
    'retry made no second financial mutation',
  );
});

test('stale create reply after compensation: newer lease rejects safely; old worker never commits Scheduling', async () => {
  const person = await caller();
  const input = bookingInput(person);
  const gate = proxy.pauseNextCreate();
  const commitsBefore = upstreams.commitsApplied;
  const creating = call(person, '/customer/bookings', {
    method: 'POST',
    body: input,
    key: idempotencyKey(),
  });
  try {
    const reached = await deadline(gate.entered);
    assert.equal(reached.status, 201, 'real Billing committed before its response was paused');
    proxy.state.rejectCreate = true;
    const resumed = worker(new Date(Date.now() + 11 * 60000));
    assert.equal(
      await resumed.manager.drive(reached.bookingId, 'compensation-worker', 5000),
      'DONE',
    );
    gate.release();
    const result = await creating;
    assert.equal(result.body.status, 'REJECTED');
    assert.equal(upstreams.commitsApplied, commitsBefore, 'the stale lease cannot reach the pivot');
    const rows = await financialRows(reached.bookingId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'VOIDED');
    assert.equal(rows[0].voids, 1);
    const fence = await sql(
      context.services.billing.app,
      `SELECT outcome FROM app.booking_compensation WHERE booking_id=$1`,
      [reached.bookingId],
    );
    assert.deepEqual(fence.rows, [{ outcome: 'VOIDED' }]);
    const record = await resumed.store.find(reached.bookingId);
    assert.equal(record.saga.pivotAttempted, false);
    assert.equal(record.booking.status, 'REJECTED');
  } finally {
    proxy.state.rejectCreate = false;
    gate.release();
    await creating;
  }
});

test('compensation unavailable and its response lost: Booking stays pending until the same durable receipt is recovered', async () => {
  const person = await caller();
  const input = bookingInput(person);
  proxy.state.rejectCreate = true;
  try {
    const created = await call(person, '/customer/bookings', {
      method: 'POST',
      body: input,
      key: idempotencyKey(),
    });
    assert.equal(created.body.status, 'PENDING_CONFIRMATION');
    const bookingId = created.body.bookingId;
    const resumed = worker(new Date(Date.now() + 11 * 60000));
    proxy.state.rejectCompensation = true;
    assert.equal(
      await resumed.manager.drive(bookingId, 'unavailable-compensation', 5000),
      'WAITING',
    );
    assert.equal((await resumed.store.find(bookingId)).booking.status, 'PENDING_CONFIRMATION');
    assert.deepEqual(await financialRows(bookingId), []);
    assert.equal(
      (
        await sql(
          context.services.billing.app,
          `SELECT count(*)::int AS n FROM app.booking_compensation WHERE booking_id=$1`,
          [bookingId],
        )
      ).rows[0].n,
      0,
    );
    proxy.state.rejectCompensation = false;
    proxy.state.loseCompensation = 1;
    resumed.advance(30000);
    assert.equal(await resumed.manager.drive(bookingId, 'lost-compensation', 5000), 'WAITING');
    assert.equal((await resumed.store.find(bookingId)).booking.status, 'PENDING_CONFIRMATION');
    assert.deepEqual(
      (
        await sql(
          context.services.billing.app,
          `SELECT outcome FROM app.booking_compensation WHERE booking_id=$1`,
          [bookingId],
        )
      ).rows,
      [{ outcome: 'ABSENT_FENCED' }],
    );
    resumed.advance(30000);
    assert.equal(await resumed.manager.drive(bookingId, 'recover-compensation', 5000), 'DONE');
    assert.equal((await resumed.store.find(bookingId)).booking.status, 'REJECTED');
    assert.deepEqual(await financialRows(bookingId), []);
  } finally {
    proxy.state.rejectCreate = false;
    proxy.state.rejectCompensation = false;
    proxy.state.loseCompensation = 0;
  }
});

test('workload routes reject mixed real human Cookie or Authorization before compensation persistence', async () => {
  const person = await caller();
  for (const route of ['booking-obligations', 'booking-obligations/compensations']) {
    for (const human of [
      { cookie: person.jar.header() },
      { authorization: `Bearer ${person.token}` },
    ]) {
      const bookingId = randomUUID();
      const response = await fetch(`${billing.base}/internal/v1/billing/${route}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey(),
          'x-service-client': WORKLOADS.booking.clientId,
          'x-service-token': WORKLOADS.booking.token,
          ...human,
        },
        body: JSON.stringify({
          bookingId,
          beneficiary: person.principal,
          quoteId: randomUUID(),
          ...(route.endsWith('compensations') ? { reason: 'BOOKING_FAILED' } : {}),
        }),
      });
      assert.equal(response.status, 401);
      await response.body?.cancel();
      assert.equal(
        (
          await sql(
            context.services.billing.app,
            `SELECT count(*)::int AS n FROM app.booking_compensation WHERE booking_id=$1`,
            [bookingId],
          )
        ).rows[0].n,
        0,
      );
    }
  }
});
