/**
 * Reviews v1 on real PostgreSQL/Redis, Identity, Booking, Reviews and Gateway HTTP.
 * Identity captures only OTP delivery. Booking fixtures are seeded through its
 * own runtime client; this proves authoritative reads/authorization, not the
 * earlier checkout, dispatch or completed-wash journey. A declared HTTP fault
 * proxy injects dependency failures/lost responses. No broker/browser claim.
 */
/* global AbortSignal -- Node 24 web API */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, appDsn, context, migrationDsn, serviceClient } from '../../integration/_support.mjs';
import {
  account,
  bootstrapAdmin,
  identityCall,
  Jar,
  signIn,
  staff,
  STAFF_ORIGIN,
  startIdentity,
} from './_identity.mjs';

const own = (service) => createRequire(path.join(ROOT, 'services', service, 'package.json'));
const dist = (service, file) => own(service)(path.join(ROOT, 'services', service, 'dist', file));
const contracts = own('reviews')('@carwash/contracts');
const { reviewsV1, parseApiErrorEnvelope, parsePage } = contracts;
const events = own('reviews')('@carwash/event-contracts');
const ROOT_PATH = '/internal/v1/reviews';
const stack = {};
const clients = [];
const apps = [];
const originalEnv = { ...process.env };
let bookingDb, reviewsDb, migrationDb;

async function owner(service, env) {
  Object.assign(process.env, env);
  own(service)('reflect-metadata');
  const app = await dist(service, 'transport/http/create-app.js').createHttpApplication();
  apps.push(app);
  await app.listen(0, '127.0.0.1');
  return { app, origin: await app.getUrl() };
}

async function proxy(target, { drop = false } = {}) {
  const state = { mode: 'normal', calls: 0, drop };
  const origin = new URL(target);
  const server = createServer((req, res) => {
    state.calls += 1;
    if (state.mode === 'unavailable') {
      res.writeHead(503, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    if (state.mode === 'invalid') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ bookingId: randomUUID() }));
      return;
    }
    const upstream = httpRequest(
      {
        hostname: origin.hostname,
        port: origin.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: origin.host },
      },
      (answer) => {
        if (
          state.drop &&
          answer.statusCode >= 200 &&
          answer.statusCode < 300 &&
          req.method === 'POST'
        ) {
          state.drop = false;
          answer.resume();
          answer.once('end', () => res.destroy());
          return;
        }
        res.writeHead(answer.statusCode, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    state,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test.before(async () => {
  stack.identity = await startIdentity();
  apps.push(stack.identity.app);
  stack.customer = await account(stack.identity);
  stack.other = await account(stack.identity);
  stack.admin = await bootstrapAdmin(stack.identity);
  stack.moderator = await staff(stack.identity, ['super-admin']);
  stack.reviewer = await staff(stack.identity, ['reviewer']);
  stack.guest = { jar: new Jar() };
  await identityCall(stack.identity, stack.guest, '/csrf');
  const guest = await identityCall(stack.identity, stack.guest, '/guest-sessions', 'POST', {});
  assert.equal(guest.status, 201);
  stack.guest.token = stack.guest.jar.cookies.get('__Host-wg_access');
  stack.guest.subject = guest.body.session.subject;
  stack.guest.session = guest.body.session;
  stack.booking = await owner('booking', {
    DATABASE_URL: appDsn(context, 'booking'),
    IDENTITY_URL: stack.identity.base,
    BOOKING_USER_REQUESTS_PER_MINUTE: '600',
  });
  stack.bookingProxy = await proxy(stack.booking.origin);
  const env = {
    DATABASE_URL: appDsn(context, 'reviews'),
    IDENTITY_SESSION_ORIGIN: stack.identity.base,
    REVIEWS_BOOKING_ORIGIN: stack.bookingProxy.origin,
    REVIEWS_BOOKING_TIMEOUT_MS: '500',
  };
  stack.reviews = await owner('reviews', env);
  stack.replica = await owner('reviews', env);
  bookingDb = serviceClient('booking');
  reviewsDb = serviceClient('reviews');
  migrationDb = serviceClient('reviews', migrationDsn(context, 'reviews'));
  clients.push(bookingDb, reviewsDb, migrationDb);
  const gw = createRequire(path.join(ROOT, 'apps/api-gateway/package.json'));
  const app = await gw('./dist/index.js').createGatewayApplication(
    gw('./dist/index.js').loadGatewayConfig({
      GATEWAY_UPSTREAMS: JSON.stringify({
        identity: stack.identity.base,
        reviews: stack.reviews.origin,
      }),
      IDENTITY_ISSUER: 'https://identity.washgo.invalid',
      IDENTITY_AUDIENCE: 'washgo-web',
      GATEWAY_ALLOWED_ORIGINS: STAFF_ORIGIN,
      GATEWAY_RESPONSE_LIMIT: '524288',
    }),
  );
  apps.push(app);
  await app.listen(0, '127.0.0.1');
  stack.gateway = { app, origin: await app.getUrl() };
});

test.after(async () => {
  const closed = await Promise.allSettled([
    ...apps.reverse().map((app) => app.close()),
    ...clients.map((client) => client.$disconnect()),
    stack.bookingProxy?.close(),
  ]);
  for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
  Object.assign(process.env, originalEnv);
  assert.equal(
    closed.filter((result) => result.status === 'rejected').length,
    0,
    'Every started component must close',
  );
});

/** Explicit Booking-owned seeded fact; no Reviews process can connect to this database. */
async function booking(
  principal = stack.customer,
  status = 'COMPLETED',
  kind = principal.session.principalKind,
) {
  const id = randomUUID(),
    quoteId = randomUUID(),
    holdId = randomUUID(),
    zoneId = randomUUID();
  const now = new Date(),
    start = new Date(now.getTime() - 7_200_000),
    end = new Date(now.getTime() - 3_600_000);
  const beneficiary = { kind, subjectId: principal.subject };
  const amount = { currency: 'SYP', amountMinor: '9000000', scale: 2 };
  const committed = !['PENDING_CONFIRMATION', 'REJECTED', 'EXPIRED'].includes(status);
  await bookingDb.booking.create({
    data: {
      id,
      principalKind: kind,
      principalSubject: principal.subject,
      status,
      rejectionReason: status === 'REJECTED' ? 'QUOTE_INVALID' : null,
      paymentMethod: 'CASH_ON_COMPLETION',
      contact: { name: 'Synthetic owner fixture', phone: '+963900000000', notes: null },
      vehicleSnapshot: {
        snapshotSchemaVersion: 1,
        source: 'saved',
        vehicleId: randomUUID(),
        vehicleRevision: 1,
        type: 'sedan',
        make: null,
        model: null,
        color: null,
        plate: null,
        capturedAt: now.toISOString(),
      },
      addressSnapshot: {
        snapshotSchemaVersion: 1,
        addressId: randomUUID(),
        addressRevision: 1,
        location: { mode: 'manual', description: 'Synthetic private address' },
        details: null,
        capturedAt: now.toISOString(),
      },
      quoteSnapshot: {
        quoteId,
        revision: 1,
        beneficiary,
        vehicleType: 'sedan',
        zoneId,
        currency: 'SYP',
        lines: [
          {
            lineId: randomUUID(),
            kind: 'PACKAGE',
            definitionId: randomUUID(),
            quantity: 1,
            unitPrice: amount,
            amount,
          },
        ],
        total: amount,
        catalogRevision: 1,
        priceBookRevision: 1,
        issuedAt: start.toISOString(),
        expiresAt: end.toISOString(),
      },
      quoteId,
      quoteRevision: 1,
      currency: 'SYP',
      totalMinor: 9000000n,
      totalScale: 2,
      holdId,
      holdRevision: 1,
      zoneId,
      requestedStartsAt: start,
      requestedEndsAt: end,
      slotStartsAt: committed ? start : null,
      slotEndsAt: committed ? end : null,
      version: 7,
      createdAt: start,
      updatedAt: now,
      confirmedAt: committed ? start : null,
      cancellationReason: status === 'CANCELLED' ? 'CUSTOMER_REQUEST' : null,
      cancelledAt: status === 'CANCELLED' ? now : null,
      saga: {
        create: {
          step: status === 'PENDING_CONFIRMATION' ? 'VALIDATE_QUOTE' : 'DONE',
          outcome:
            status === 'PENDING_CONFIRMATION'
              ? null
              : status === 'REJECTED'
                ? 'REJECTED'
                : 'CONFIRMED',
          nextAttemptAt: now,
          deadlineAt: now,
          correlationId: randomUUID(),
          createdAt: start,
          updatedAt: now,
        },
      },
    },
  });
  return id;
}

async function call(
  principal,
  route,
  {
    method = 'GET',
    body,
    key = randomUUID(),
    headers = {},
    origin = stack.reviews.origin,
    raw,
  } = {},
) {
  const response = await fetch(`${origin}${ROOT_PATH}${route}`, {
    method,
    headers: {
      ...(principal ? { authorization: `Bearer ${principal.token}` } : {}),
      'x-correlation-id': randomUUID(),
      ...(method === 'POST'
        ? {
            'content-type': 'application/json',
            ...(key === null ? {} : { 'idempotency-key': key }),
          }
        : {}),
      ...headers,
    },
    ...(raw !== undefined
      ? { body: raw }
      : body === undefined
        ? {}
        : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const value = await response.json();
  if (response.status >= 400) parseApiErrorEnvelope(value);
  else if (route.startsWith('/moderation/reviews?') || route === '/moderation/reviews')
    parsePage(value, '$', reviewsV1.parseReviewV1);
  else reviewsV1.parseReviewV1(value);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return {
    status: response.status,
    body: value,
    replayed: response.headers.get('idempotent-replayed'),
  };
}

const bodyFor = (bookingId, extra = {}) => ({
  bookingId,
  rating: 5,
  comment: 'تعليق خاص للاختبار فقط',
  publicationConsent: true,
  ...extra,
});
const submit = (principal, body, options = {}) =>
  call(principal, '/reviews', { method: 'POST', body, ...options });
const decide = (
  principal,
  review,
  decision = 'PUBLISH',
  reason = 'MEETS_GUIDELINES',
  options = {},
) =>
  call(principal, `/moderation/reviews/${review.reviewId}/decision`, {
    method: 'POST',
    body: { expectedRevision: review.revision, decision, reason },
    ...options,
  });
const reason = (result, code, refinement = null) => {
  assert.equal(result.body.error.code, code);
  assert.equal(result.body.error.reason, refinement);
};

test('Reviews readiness remains fail-closed after implementation', async () => {
  const ready = await fetch(`${stack.reviews.origin}/health/ready`);
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).businessReady, false);
});

test('real Identity rejects absent/forged credentials and service impersonation', async () => {
  const body = bodyFor(await booking());
  for (const principal of [null, { token: 'forged.payload.signature' }]) {
    const result = await submit(principal, body, {
      headers: { 'x-auth-subject': stack.customer.subject, 'x-permissions': 'reviews.moderate' },
    });
    assert.equal(result.status, 401);
    reason(result, 'AUTH_REQUIRED');
  }
  const spoof = await submit(stack.customer, body, {
    headers: { 'x-service-client': 'reviews', 'x-service-token': 'untrusted-service-token' },
  });
  assert.equal(spoof.status, 401);
  assert.equal(await reviewsDb.review.count({ where: { bookingId: body.bookingId } }), 0);
});

test('completed owner Booking yields a private record, strict response, audit and safe status event', async () => {
  const bookingId = await booking(),
    body = bodyFor(bookingId, { comment: 'PRIVATE-COMMENT-no-event-أحمد' });
  const result = await submit(stack.customer, body);
  assert.equal(result.status, 201);
  assert.equal(result.replayed, 'false');
  assert.equal(result.body.status, 'PENDING_MODERATION');
  assert.equal(result.body.revision, 1);
  assert.deepEqual(result.body.author, { kind: 'account', subjectId: stack.customer.subject });
  const row = await reviewsDb.review.findUnique({ where: { bookingId } });
  assert.equal(row.bookingRevision, 7);
  assert.equal(row.comment, body.comment);
  const audit = await reviewsDb.reviewAudit.findMany({ where: { reviewId: row.id } });
  const outbox = await reviewsDb.outboxMessage.findMany({ where: { reviewId: row.id } });
  assert.equal(audit.length, 1);
  assert.equal(outbox.length, 1);
  assert.equal(audit[0].actorSubject, stack.customer.subject);
  const event = events.REVIEWS_REVIEW_STATUS_CHANGED_V1.parse(JSON.parse(outbox[0].payload));
  assert.deepEqual(Object.keys(event.data).sort(), [
    'bookingId',
    'previousStatus',
    'rating',
    'status',
  ]);
  assert.equal(event.data.status, 'PENDING_MODERATION');
  assert.equal(outbox[0].publishedAt, null);
  for (const privateText of [
    body.comment,
    'Synthetic private address',
    'Synthetic owner fixture',
    '+963900000000',
  ])
    assert.equal(JSON.stringify({ audit, outbox }).includes(privateText), false);
  const read = await call(stack.customer, `/bookings/${bookingId}/review`);
  assert.deepEqual(read.body, result.body);
});

test('private consent is immutable; comments are visible only to author and current moderator', async () => {
  const bookingId = await booking();
  const created = await submit(stack.customer, bodyFor(bookingId, { publicationConsent: false }));
  assert.equal(created.body.status, 'PRIVATE');
  assert.equal((await call(stack.other, `/bookings/${bookingId}/review`)).status, 404);
  assert.equal((await call(stack.admin, `/bookings/${bookingId}/review`)).status, 200);
  const denied = await decide(stack.admin, created.body);
  assert.equal(denied.status, 422);
  reason(denied, 'BUSINESS_RULE_VIOLATION', 'CONSENT_REQUIRED');
  assert.equal(
    (await decide(stack.reviewer, created.body)).status,
    403,
    'Workforce reviewer is not a customer-review moderator',
  );
  assert.equal((await call(stack.customer, '/moderation/reviews')).status, 403);
  assert.equal((await call(stack.reviewer, '/moderation/reviews')).status, 403);
});

test('all non-completed Booking states and foreign principals are non-reviewable', async () => {
  for (const status of [
    'PENDING_CONFIRMATION',
    'CONFIRMED',
    'ASSIGNED',
    'EN_ROUTE',
    'ARRIVED',
    'IN_PROGRESS',
    'CANCELLED',
    'EXPIRED',
    'REJECTED',
  ]) {
    const result = await submit(stack.customer, bodyFor(await booking(stack.customer, status)));
    assert.equal(result.status, 422, status);
    reason(result, 'BUSINESS_RULE_VIOLATION', 'NOT_REVIEWABLE');
  }
  const foreign = await booking(stack.other);
  const ownerRead = await fetch(`${stack.booking.origin}/internal/v1/booking/bookings/${foreign}`, {
    headers: { authorization: `Bearer ${stack.customer.token}` },
  });
  assert.equal(ownerRead.status, 404);
  for (const principal of [stack.customer, stack.admin]) {
    const result = await submit(principal, bodyFor(foreign));
    assert.equal(result.status, 422);
    reason(result, 'BUSINESS_RULE_VIOLATION', 'NOT_REVIEWABLE');
  }
  assert.equal((await submit(stack.customer, bodyFor(randomUUID()))).status, 422);
});

test('real guest author works; equal UUIDs never collapse guest and account ownership', async () => {
  const guestBooking = await booking(stack.guest);
  const created = await submit(stack.guest, bodyFor(guestBooking));
  assert.equal(created.status, 201);
  assert.equal(created.body.author.kind, 'guest');
  assert.equal((await call(stack.guest, `/bookings/${guestBooking}/review`)).status, 200);
  assert.equal((await call(stack.customer, `/bookings/${guestBooking}/review`)).status, 404);
  const kindCollision = await booking(stack.customer, 'COMPLETED', 'guest');
  const denied = await submit(stack.customer, bodyFor(kindCollision));
  assert.equal(denied.status, 422);
  reason(denied, 'BUSINESS_RULE_VIOLATION', 'NOT_REVIEWABLE');
});

test('same key replays its original revision with common canonicalization and rejects changed business input', async () => {
  const body = bodyFor(await booking(), { comment: 'Café' }),
    key = randomUUID();
  const created = await submit(stack.customer, body, { key });
  const published = await decide(stack.admin, created.body);
  assert.equal(published.status, 200);
  stack.bookingProxy.state.mode = 'unavailable';
  try {
    const calls = stack.bookingProxy.state.calls;
    const repeated = await submit(stack.customer, body, { key, origin: stack.replica.origin });
    assert.deepEqual(repeated.body, created.body);
    assert.equal(repeated.replayed, 'true');
    assert.equal(
      stack.bookingProxy.state.calls,
      calls,
      'durable receipt recovery needs no owner read',
    );
    // The published common fingerprint protocol explicitly normalizes NFC and key order.
    const equivalent = await submit(
      stack.customer,
      {
        comment: 'Cafe\u0301',
        publicationConsent: body.publicationConsent,
        rating: body.rating,
        bookingId: body.bookingId,
      },
      { key },
    );
    assert.equal(equivalent.status, 201);
    assert.equal(equivalent.replayed, 'true');
    assert.deepEqual(equivalent.body, created.body);
    for (const changed of [
      { ...body, rating: 4 },
      { ...body, comment: 'different' },
      { ...body, publicationConsent: false },
    ]) {
      const conflict = await submit(stack.customer, changed, { key });
      assert.equal(conflict.status, 409);
      reason(conflict, 'IDEMPOTENCY_CONFLICT');
    }
  } finally {
    stack.bookingProxy.state.mode = 'normal';
  }
  const duplicate = await submit(stack.customer, body);
  assert.equal(duplicate.status, 409);
  reason(duplicate, 'CONFLICT', 'REVIEW_ALREADY_SUBMITTED');
  assert.equal(
    (await call(stack.customer, `/bookings/${body.bookingId}/review`)).body.status,
    'PUBLISHED',
  );
});

test('two independent replicas serialize booking uniqueness and same-key retries', async () => {
  const body = bodyFor(await booking());
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      submit(stack.customer, body, { origin: i % 2 ? stack.replica.origin : stack.reviews.origin }),
    ),
  );
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  for (const denied of results.filter((result) => result.status !== 201))
    reason(denied, 'CONFLICT', 'REVIEW_ALREADY_SUBMITTED');
  const same = bodyFor(await booking()),
    key = randomUUID();
  const raced = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      submit(stack.customer, same, {
        key,
        origin: i % 2 ? stack.replica.origin : stack.reviews.origin,
      }),
    ),
  );
  for (const result of raced)
    assert.ok(result.status === 201 || result.body.error.code === 'IDEMPOTENCY_IN_PROGRESS');
  const recovered = await submit(stack.customer, same, { key });
  assert.equal(recovered.status, 201);
  for (const result of raced.filter((result) => result.status === 201))
    assert.deepEqual(result.body, recovered.body);
  assert.equal(await reviewsDb.review.count({ where: { bookingId: same.bookingId } }), 1);
  assert.equal(
    await reviewsDb.reviewAudit.count({ where: { reviewId: recovered.body.reviewId } }),
    1,
  );
});

test('two moderators race on a revision; exactly one decision and event commit', async () => {
  const created = await submit(stack.customer, bodyFor(await booking()));
  const results = await Promise.all([
    decide(stack.admin, created.body),
    decide(stack.moderator, created.body, 'REJECT', 'SPAM', { origin: stack.replica.origin }),
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  const rejected = results.find((result) => result.status !== 200);
  assert.equal(rejected.status, 412);
  reason(rejected, 'REVISION_CONFLICT');
  assert.equal(
    await reviewsDb.reviewAudit.count({ where: { reviewId: created.body.reviewId } }),
    2,
  );
  assert.equal(
    await reviewsDb.outboxMessage.count({ where: { reviewId: created.body.reviewId } }),
    2,
  );
});

test('publication, hiding and withdrawal preserve explicit original consent and replay snapshots', async () => {
  const created = await submit(stack.customer, bodyFor(await booking()));
  const key = randomUUID();
  const published = await decide(stack.admin, created.body, 'PUBLISH', 'MEETS_GUIDELINES', { key });
  assert.equal(published.body.status, 'PUBLISHED');
  const stale = await decide(stack.admin, created.body, 'HIDE', 'PERSONAL_DATA');
  assert.equal(stale.status, 412);
  const hidden = await decide(stack.moderator, published.body, 'HIDE', 'CUSTOMER_WITHDREW_CONSENT');
  assert.equal(hidden.body.status, 'HIDDEN');
  assert.equal(hidden.body.publicationConsent, true);
  assert.equal(hidden.body.moderationReason, 'CUSTOMER_WITHDREW_CONSENT');
  const replay = await decide(stack.admin, created.body, 'PUBLISH', 'MEETS_GUIDELINES', {
    key,
    origin: stack.replica.origin,
  });
  assert.deepEqual(replay.body, published.body);
  assert.equal(replay.replayed, 'true');
  const closed = await decide(stack.admin, hidden.body);
  assert.equal(closed.status, 409);
  reason(closed, 'CONFLICT', 'REVIEW_NOT_PENDING');
  const invalidTransition = await decide(
    stack.admin,
    (await submit(stack.customer, bodyFor(await booking()))).body,
    'HIDE',
    'SPAM',
  );
  assert.equal(invalidTransition.status, 409);
  reason(invalidTransition, 'CONFLICT', 'REVIEW_NOT_PENDING');
});

test('moderation pagination is bounded, private-safe and rejects forged/unknown query fields', async () => {
  const first = await call(stack.admin, '/moderation/reviews?limit=2');
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 2);
  assert.ok(first.body.nextCursor);
  assert.ok(first.body.items.every((item) => item.status === 'PENDING_MODERATION'));
  const next = await call(
    stack.admin,
    `/moderation/reviews?limit=2&cursor=${first.body.nextCursor}`,
  );
  assert.equal(next.body.asOf, first.body.asOf);
  assert.equal(
    next.body.items.some((item) =>
      first.body.items.some((previous) => previous.reviewId === item.reviewId),
    ),
    false,
  );
  for (const query of [
    'limit=101',
    'limit=0',
    'limit=2&limit=3',
    'status=PRIVATE',
    'comment=private',
    'cursor=e30',
    'cursor=not_json',
  ])
    assert.equal((await call(stack.admin, `/moderation/reviews?${query}`)).status, 400, query);
});

test('strict commands reject forged fields, absent consent, invalid keys and malformed JSON', async () => {
  const bookingId = await booking(),
    body = bodyFor(bookingId);
  const invalid = [
    { ...body, author: { kind: 'account', subjectId: stack.admin.subject } },
    { ...body, status: 'PUBLISHED' },
    { ...body, rating: 0 },
    { ...body, rating: 1.5 },
    { ...body, comment: 'x'.repeat(1001) },
    { ...body, publicationConsent: 'true' },
    { bookingId, rating: 5, comment: null },
  ];
  for (const candidate of invalid)
    assert.equal((await submit(stack.customer, candidate)).status, 400);
  const missing = await submit(stack.customer, body, { key: null });
  assert.equal(missing.status, 428);
  reason(missing, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal((await submit(stack.customer, body, { key: 'short' })).status, 400);
  assert.equal((await submit(stack.customer, body, { raw: '{"comment":' })).status, 400);
  assert.equal(
    (
      await submit(stack.customer, body, {
        raw: JSON.stringify({ ...body, comment: 'x'.repeat(20_000) }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await call(stack.customer, '/reviews?comment=private', { method: 'POST', body })).status,
    400,
  );
  assert.equal(await reviewsDb.review.count({ where: { bookingId } }), 0);
});

test('owner transport failures cannot create review eligibility or persist empty success', async () => {
  const body = bodyFor(await booking());
  for (const [mode, status, code] of [
    ['unavailable', 503, 'DEPENDENCY_UNAVAILABLE'],
    ['invalid', 502, 'UPSTREAM_INVALID'],
  ]) {
    stack.bookingProxy.state.mode = mode;
    try {
      const result = await submit(stack.customer, body);
      assert.equal(result.status, status);
      reason(result, code);
    } finally {
      stack.bookingProxy.state.mode = 'normal';
    }
  }
  assert.equal(await reviewsDb.review.count({ where: { bookingId: body.bookingId } }), 0);
  assert.equal((await submit(stack.customer, body)).status, 201);
});

test('lost committed submit and moderation responses recover by stable key through another replica', async (t) => {
  const relay = await proxy(stack.reviews.origin, { drop: true });
  t.after(() => relay.close());
  const body = bodyFor(await booking()),
    key = randomUUID();
  await assert.rejects(submit(stack.customer, body, { key, origin: relay.origin }), TypeError);
  const recovered = await submit(stack.customer, body, { key, origin: stack.replica.origin });
  assert.equal(recovered.status, 201);
  assert.equal(recovered.replayed, 'true');
  relay.state.drop = true;
  const decisionKey = randomUUID();
  await assert.rejects(
    decide(stack.admin, recovered.body, 'PUBLISH', 'MEETS_GUIDELINES', {
      key: decisionKey,
      origin: relay.origin,
    }),
    TypeError,
  );
  const decision = await decide(stack.admin, recovered.body, 'PUBLISH', 'MEETS_GUIDELINES', {
    key: decisionKey,
    origin: stack.replica.origin,
  });
  assert.equal(decision.status, 200);
  assert.equal(decision.replayed, 'true');
  assert.equal(decision.body.revision, 2);
  assert.equal(
    await reviewsDb.reviewAudit.count({ where: { reviewId: recovered.body.reviewId } }),
    2,
  );
  assert.equal(
    await reviewsDb.outboxMessage.count({ where: { reviewId: recovered.body.reviewId } }),
    2,
  );
});

async function outboxFailure(bookingId, work) {
  const suffix = randomUUID().replaceAll('-', ''),
    name = `reviews_test_fault_${suffix}`;
  // Test-only failure injection in this disposable owner database, never a runtime switch.
  await migrationDb.$executeRawUnsafe(
    `CREATE FUNCTION app.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (NEW.payload::jsonb->'data'->>'bookingId') = '${bookingId}' THEN RAISE EXCEPTION 'TEST_OUTBOX_FAILURE'; END IF; RETURN NEW; END; $$`,
  );
  await migrationDb.$executeRawUnsafe(
    `CREATE TRIGGER ${name} BEFORE INSERT ON app.outbox_message FOR EACH ROW EXECUTE FUNCTION app.${name}()`,
  );
  try {
    await work();
  } finally {
    await migrationDb.$executeRawUnsafe(`DROP TRIGGER ${name} ON app.outbox_message`);
    await migrationDb.$executeRawUnsafe(`DROP FUNCTION app.${name}()`);
  }
}

test('failed outbox insert rolls back submission and moderation, including command receipts', async () => {
  const body = bodyFor(await booking()),
    key = randomUUID();
  await outboxFailure(body.bookingId, async () => {
    const failed = await submit(stack.customer, body, { key });
    assert.equal(failed.status, 500);
    reason(failed, 'INTERNAL_ERROR');
    assert.equal(await reviewsDb.review.count({ where: { bookingId: body.bookingId } }), 0);
    assert.equal(await reviewsDb.reviewCommandReceipt.count({ where: { key } }), 0);
  });
  const created = await submit(stack.customer, body, { key });
  assert.equal(created.status, 201);
  assert.equal(created.replayed, 'false');
  const decisionKey = randomUUID();
  await outboxFailure(body.bookingId, async () => {
    assert.equal(
      (await decide(stack.admin, created.body, 'PUBLISH', 'MEETS_GUIDELINES', { key: decisionKey }))
        .status,
      500,
    );
    assert.equal(
      (await call(stack.customer, `/bookings/${body.bookingId}/review`)).body.revision,
      1,
    );
    assert.equal(await reviewsDb.reviewCommandReceipt.count({ where: { key: decisionKey } }), 0);
    assert.equal(
      await reviewsDb.reviewAudit.count({ where: { reviewId: created.body.reviewId } }),
      1,
    );
  });
  assert.equal(
    (await decide(stack.admin, created.body, 'PUBLISH', 'MEETS_GUIDELINES', { key: decisionKey }))
      .status,
    200,
  );
});

test('runtime SQL cannot rewrite content/consent/history, omit effects or expose trigger helpers', async () => {
  const created = await submit(stack.customer, bodyFor(await booking()));
  const id = created.body.reviewId;
  for (const data of [
    { comment: 'overwritten' },
    { publicationConsent: false },
    { rating: 1 },
    { authorSubject: stack.other.subject },
  ])
    await assert.rejects(reviewsDb.review.update({ where: { id }, data }));
  await assert.rejects(
    reviewsDb.review.update({
      where: { id },
      data: { status: 'PUBLISHED', moderationReason: 'MEETS_GUIDELINES', revision: 2 },
    }),
    /REVIEW_AUDIT_REQUIRED/,
  );
  await assert.rejects(reviewsDb.review.delete({ where: { id } }), /REVIEW_IMMUTABLE/);
  await assert.rejects(
    reviewsDb.reviewAudit.updateMany({ where: { reviewId: id }, data: { action: 'HIDE' } }),
    /permission denied/,
  );
  await assert.rejects(
    reviewsDb.reviewCommandReceipt.deleteMany({ where: { reviewId: id } }),
    /permission denied/,
  );
  await assert.rejects(
    reviewsDb.outboxMessage.updateMany({
      where: { reviewId: id },
      data: { payload: '{"comment":"private"}' },
    }),
    /REVIEW_EVENT_IMMUTABLE/,
  );
  const recorded = await reviewsDb.outboxMessage.findFirstOrThrow({ where: { reviewId: id } });
  const forgedId = randomUUID();
  const forged = JSON.parse(recorded.payload);
  forged.eventId = forgedId;
  forged.data.comment = 'PRIVATE-COMMENT-NOT-AN-EVENT';
  await assert.rejects(
    reviewsDb.outboxMessage.create({
      data: {
        ...recorded,
        id: forgedId,
        eventId: forgedId,
        payload: JSON.stringify(forged),
      },
    }),
    /REVIEW_EVENT_CONTRACT/,
  );
  const roles =
    await reviewsDb.$queryRaw`SELECT has_schema_privilege(current_user, 'app', 'CREATE') AS ddl, has_table_privilege(current_user, 'app._prisma_migrations', 'SELECT') AS migrations, has_function_privilege(current_user, 'app.reviews_assert_effects()', 'EXECUTE') AS helper`;
  assert.deepEqual(roles, [{ ddl: false, migrations: false, helper: false }]);
  const { Client } = own('reviews')('pg');
  const foreignUrl = new URL(appDsn(context, 'reviews'));
  foreignUrl.pathname = '/cw_booking';
  const foreign = new Client({ connectionString: foreignUrl.href });
  try {
    await assert.rejects(foreign.connect(), (error) => error.code === '42501');
  } finally {
    await foreign.end();
  }
  assert.equal(
    (await call(stack.customer, `/bookings/${created.body.bookingId}/review`)).body.revision,
    1,
  );
});

test('current Identity revocation blocks even a previously completed idempotent replay', async () => {
  const principal = await account(stack.identity),
    body = bodyFor(await booking(principal)),
    key = randomUUID();
  assert.equal((await submit(principal, body, { key })).status, 201);
  const revoked = await identityCall(stack.identity, principal, '/logout-all', 'POST', {});
  assert.equal(revoked.status, 204);
  stack.revoked = principal;
  const refused = await submit(principal, body, { key, origin: stack.replica.origin });
  assert.equal(refused.status, 401);
  reason(refused, 'AUTH_REQUIRED');
});

test('Gateway exposes only scoped customer/moderation routes and cannot spoof moderator grants', async () => {
  const security = own('identity')('@carwash/security-kit');
  await new security.AccessTokenVerifier(
    { issuer: 'https://identity.washgo.invalid', audience: 'washgo-web' },
    new URL(`${stack.identity.base}/internal/v1/identity/.well-known/jwks.json`),
  ).verify(stack.customer.token);
  async function gateway(principal, route, method = 'GET', body, extraHeaders = {}) {
    const response = await fetch(`${stack.gateway.origin}/api/v1${route}`, {
      method,
      headers: {
        cookie: principal.jar.header(),
        origin: STAFF_ORIGIN,
        'x-permissions': 'reviews.moderate',
        ...(method === 'POST'
          ? {
              'content-type': 'application/json',
              'x-csrf-token': principal.jar.cookies.get('__Host-wg_csrf'),
              'idempotency-key': randomUUID(),
            }
          : {}),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const value = await response.json();
    if (response.status >= 400) parseApiErrorEnvelope(value);
    return { status: response.status, body: value };
  }
  const body = bodyFor(await booking());
  const created = await gateway(stack.customer, '/customer/reviews', 'POST', body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  reviewsV1.parseReviewV1(created.body);
  const readRoute = `/customer/bookings/${body.bookingId}/review`;
  assert.equal((await gateway({ jar: new Jar() }, readRoute)).status, 401);
  assert.equal((await gateway(stack.other, readRoute)).status, 404);
  assert.equal(
    (
      await gateway({ jar: new Jar() }, readRoute, 'GET', undefined, {
        authorization: `Bearer ${stack.revoked.token}`,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await gateway(stack.customer, readRoute, 'GET', undefined, {
        authorization: `Bearer ${stack.other.token}`,
      })
    ).status,
    401,
    'mixed credentials must never select an arbitrary principal',
  );
  assert.equal(
    (await gateway(stack.customer, `/customer/bookings/${body.bookingId}/review`)).status,
    200,
  );
  assert.equal((await gateway(stack.customer, '/admin/customer-reviews')).status, 403);
  assert.equal((await gateway(stack.reviewer, '/admin/customer-reviews')).status, 403);
  const queue = await gateway(stack.admin, '/admin/customer-reviews?limit=2');
  assert.equal(queue.status, 200);
  parsePage(queue.body, '$', reviewsV1.parseReviewV1);
  const moderation = await gateway(
    stack.admin,
    `/admin/customer-reviews/${created.body.reviewId}/decision`,
    'POST',
    { expectedRevision: 1, decision: 'PUBLISH', reason: 'MEETS_GUIDELINES' },
  );
  assert.equal(moderation.status, 200);
  assert.equal(moderation.body.status, 'PUBLISHED');
  for (const query of ['limit=101', 'limit=2&limit=3', 'comment=PRIVATE', 'cursor=a%2Fb'])
    assert.equal((await gateway(stack.admin, `/admin/customer-reviews?${query}`)).status, 400);
});

test('revoked moderation grants never authorize replay or fresh decisions on either replica', async () => {
  const created = await submit(stack.customer, bodyFor(await booking()));
  const key = randomUUID();
  const accepted = await decide(stack.moderator, created.body, 'PUBLISH', 'MEETS_GUIDELINES', {
    key,
  });
  assert.equal(accepted.status, 200);
  const changed = await identityCall(
    stack.identity,
    stack.admin,
    `/accounts/${stack.moderator.subject}/roles`,
    'POST',
    { roles: ['customer'] },
  );
  assert.equal(changed.status, 204);
  assert.equal(
    (
      await decide(stack.moderator, created.body, 'PUBLISH', 'MEETS_GUIDELINES', {
        key,
        origin: stack.replica.origin,
      })
    ).status,
    401,
  );
  const current = await signIn(stack.identity, stack.moderator.email);
  assert.equal(
    (await decide(current, created.body, 'PUBLISH', 'MEETS_GUIDELINES', { key })).status,
    403,
  );
  assert.equal((await call(current, '/moderation/reviews')).status, 403);
  assert.equal((await call(current, `/bookings/${created.body.bookingId}/review`)).status, 404);
});

test('successful and rejected HTTP requests never log the private comment', async () => {
  const marker = `PRIVATE_LOG_PROBE_${randomUUID()}`;
  const body = bodyFor(await booking(), { comment: marker });
  const original = process.stdout.write;
  const captured = [];
  process.stdout.write = function (chunk, ...args) {
    captured.push(String(chunk));
    return original.call(this, chunk, ...args);
  };
  try {
    const created = await submit(stack.customer, body);
    assert.equal(created.status, 201);
    assert.equal((await submit(stack.customer, body)).status, 409);
    assert.equal((await submit(stack.other, body)).status, 422);
    assert.equal(
      (await submit(stack.customer, body, { raw: `{"comment":"${marker}"` })).status,
      400,
    );
  } finally {
    process.stdout.write = original;
  }
  assert.equal(
    captured.join('').includes(marker),
    false,
    'free text must never reach structured or parser logs',
  );
});
