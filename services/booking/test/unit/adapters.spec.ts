import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { money } from '../../src/domain';
import { OwnerHttpClient } from '../../src/infrastructure/http/owner-http.client';
import {
  IdentityAuthFailure,
  IdentitySessionClient,
} from '../../src/infrastructure/identity/identity-session.client';
import {
  ContractViolation,
  parseAddressSnapshot,
  parseHold,
  parseQuote,
  parseVehicleSnapshot,
} from '../../src/infrastructure/owners/contract-acl';
import {
  BillingObligationsAdapter,
  PricingQuoteReader,
  PricingQuoteValidator,
  SchedulingHoldCommitter,
  SchedulingHoldReader,
  VehicleSnapshotAdapter,
} from '../../src/infrastructure/owners/owner-adapters';
import { UserCredential } from '../../src/ports';
import { errorEnvelope, mapError } from '../../src/transport/http/http-errors';
import { BookingError } from '../../src/domain';
import { addressWire, holdWire, principal, quoteWire, vehicleWire } from '../support/fixtures';

/**
 * Adapter behaviour against a REAL local HTTP server (node:http + Node fetch):
 * status/outcome mapping, timeouts, circuit breaker, header propagation and
 * the fail-closed contract parsers. No database is involved.
 */
type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let handler: Handler = (_req, _body, res) => res.writeHead(500).end();
const seen: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[] =
  [];
let server: Server;
let base = '';
const NOW = new Date();
const CREDENTIAL = new UserCredential('Bearer customer-token-0000000001');
const SERVICE = { clientId: 'booking', token: 't'.repeat(40) };

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function json(status: number, body: unknown): Handler {
  return (_req, _body, res) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function envelope(code: string, reason: string | null) {
  return {
    error: {
      code,
      reason,
      message: 'x',
      requestId: 'r',
      correlationId: 'c',
      retryable: false,
      retryAfterMs: null,
      issues: [],
    },
  };
}

function client(options: Partial<ConstructorParameters<typeof OwnerHttpClient>[0]> = {}) {
  return new OwnerHttpClient({
    owner: 'test',
    baseUrl: base,
    timeoutMs: 3_000,
    service: SERVICE,
    ...options,
  });
}

test('http: correlation id, trace and service credential are sent; on-behalf calls send only the bearer', async () => {
  handler = json(200, {});
  seen.length = 0;
  const correlationId = randomUUID();
  await client().call({
    method: 'POST',
    path: '/x',
    correlationId,
    body: { a: 1 },
    idempotencyKey: 'key-0000000000000001',
  });
  await client().call({ method: 'GET', path: '/y', correlationId, credential: CREDENTIAL });
  const [svc, user] = seen;
  assert.equal(svc?.headers['x-correlation-id'], correlationId);
  assert.equal(svc?.headers['x-service-client'], 'booking');
  assert.equal(svc?.headers['idempotency-key'], 'key-0000000000000001');
  assert.equal(svc?.headers.authorization, undefined);
  assert.equal(user?.headers.authorization, 'Bearer customer-token-0000000001');
  assert.equal(
    user?.headers['x-service-token'],
    undefined,
    'a user call never carries the service credential',
  );
});

test('http: a missing URL or credential is NOT_SENT, never a call', async () => {
  seen.length = 0;
  assert.deepEqual(
    await client({ baseUrl: undefined }).call({
      method: 'GET',
      path: '/',
      correlationId: randomUUID(),
    }),
    {
      kind: 'NOT_SENT',
      error: 'NOT_CONFIGURED',
    },
  );
  assert.equal(
    (
      await client({ service: null }).call({
        method: 'GET',
        path: '/',
        correlationId: randomUUID(),
      })
    ).kind,
    'NOT_SENT',
  );
  assert.equal(seen.length, 0);
});

test('http: a slow owner times out as NO_RESPONSE and opens the breaker after the threshold', async () => {
  handler = (_req, _body, res) => setTimeout(() => res.writeHead(200).end('{}'), 1_000);
  let now = 0;
  const c = client({ timeoutMs: 300, failureThreshold: 2, openMs: 1_000, now: () => now });
  assert.deepEqual(await c.call({ method: 'GET', path: '/', correlationId: randomUUID() }), {
    kind: 'NO_RESPONSE',
    error: 'TIMEOUT',
  });
  await c.call({ method: 'GET', path: '/', correlationId: randomUUID() });
  assert.equal(c.breaker.state, 'OPEN');
  assert.deepEqual(await c.call({ method: 'GET', path: '/', correlationId: randomUUID() }), {
    kind: 'NOT_SENT',
    error: 'CIRCUIT_OPEN',
  });
  handler = json(200, {});
  now = 1_001; // half-open: one probe goes through and closes the breaker
  assert.equal(
    (await c.call({ method: 'GET', path: '/', correlationId: randomUUID() })).kind,
    'RESPONSE',
  );
  assert.equal(c.breaker.state, 'CLOSED');
});

test('http: an oversized or non-JSON body is NO_RESPONSE (outcome unknown), not data', async () => {
  handler = (_req, _body, res) => res.writeHead(200).end('x'.repeat(300 * 1024));
  assert.deepEqual(await client().call({ method: 'GET', path: '/', correlationId: randomUUID() }), {
    kind: 'NO_RESPONSE',
    error: 'BAD_BODY',
  });
  handler = (_req, _body, res) => res.writeHead(200).end('{not json');
  assert.deepEqual(await client().call({ method: 'GET', path: '/', correlationId: randomUUID() }), {
    kind: 'NO_RESPONSE',
    error: 'BAD_BODY',
  });
});

test('pricing: quote read maps 200/404/422/5xx and refuses a body for another quote', async () => {
  const beneficiary = principal();
  const wire = quoteWire({ beneficiary, now: NOW });
  const reader = new PricingQuoteReader(client());
  handler = json(200, wire);
  const ok = await reader.read(wire.quoteId, CREDENTIAL, randomUUID());
  assert.equal(ok.kind, 'OK');
  if (ok.kind === 'OK') assert.equal(ok.value.snapshot.total.amountMinor, 9_000_000n);
  assert.deepEqual(await reader.read(randomUUID(), CREDENTIAL, randomUUID()), {
    kind: 'UNAVAILABLE',
    error: 'UPSTREAM_INVALID',
  });
  handler = json(404, envelope('NOT_FOUND', null));
  assert.deepEqual(await reader.read(wire.quoteId, CREDENTIAL, randomUUID()), {
    kind: 'NOT_USABLE',
    reason: 'QUOTE_NOT_FOUND',
  });
  handler = json(422, envelope('BUSINESS_RULE_VIOLATION', 'QUOTE_EXPIRED'));
  assert.deepEqual(await reader.read(wire.quoteId, CREDENTIAL, randomUUID()), {
    kind: 'NOT_USABLE',
    reason: 'QUOTE_EXPIRED',
  });
  handler = json(503, envelope('DEPENDENCY_UNAVAILABLE', null));
  assert.deepEqual(await reader.read(wire.quoteId, CREDENTIAL, randomUUID()), {
    kind: 'UNAVAILABLE',
    error: 'HTTP_503',
  });
});

test('pricing: validation maps reasons; our own refused credential is unavailable, not invalid', async () => {
  const validator = new PricingQuoteValidator(client());
  const quoteId = randomUUID();
  const input = { quoteId, revision: 1, beneficiary: principal() };
  const total = { currency: 'SYP', amountMinor: '100', scale: 2 };
  handler = json(200, { quoteId, revision: 1, valid: true, reason: null, total });
  assert.deepEqual(await validator.validate(input, randomUUID()), {
    kind: 'VALID',
    total: money('SYP', 100n),
  });
  handler = json(200, { quoteId, revision: 1, valid: false, reason: 'QUOTE_EXPIRED', total });
  assert.deepEqual(await validator.validate(input, randomUUID()), {
    kind: 'INVALID',
    reason: 'QUOTE_EXPIRED',
  });
  handler = json(200, {
    quoteId,
    revision: 1,
    valid: false,
    reason: 'BENEFICIARY_MISMATCH',
    total,
  });
  assert.deepEqual(await validator.validate(input, randomUUID()), {
    kind: 'INVALID',
    reason: 'QUOTE_INVALID',
  });
  handler = json(200, { quoteId, revision: 1, valid: true, reason: 'QUOTE_EXPIRED', total });
  assert.deepEqual(await validator.validate(input, randomUUID()), {
    kind: 'UNAVAILABLE',
    error: 'UPSTREAM_INVALID',
  });
  handler = json(403, envelope('AUTH_FORBIDDEN', null));
  assert.deepEqual(await validator.validate(input, randomUUID()), {
    kind: 'UNAVAILABLE',
    error: 'HTTP_403',
  });
  const sent = JSON.parse(seen[seen.length - 1]?.body ?? '{}') as Record<string, unknown>;
  assert.deepEqual(Object.keys(sent).sort(), ['beneficiary', 'expectedRevision', 'purpose']);
  assert.equal(sent.purpose, 'booking-create');
});

test('scheduling: commit is idempotent by booking, refusals are definitive, everything else UNKNOWN', async () => {
  const committer = new SchedulingHoldCommitter(client());
  const beneficiary = principal();
  const bookingId = randomUUID();
  const hold = holdWire({
    beneficiary,
    zoneId: randomUUID(),
    startsAt: new Date(NOW.getTime() + 7_200_000),
    now: NOW,
  });
  const input = { holdId: hold.holdId, expectedRevision: 1, bookingId };
  seen.length = 0;
  handler = json(200, { ...hold, state: 'COMMITTED', revision: 2, bookingId });
  const ok = await committer.commit(input, randomUUID());
  assert.equal(ok.kind, 'COMMITTED');
  assert.equal(seen[0]?.headers['idempotency-key'], `booking-commit-${bookingId}`);
  assert.deepEqual(JSON.parse(seen[0]?.body ?? '{}'), { expectedRevision: 1, bookingId });

  handler = json(200, { ...hold, state: 'COMMITTED', revision: 2, bookingId: randomUUID() });
  assert.deepEqual(await committer.commit(input, randomUUID()), {
    kind: 'REFUSED',
    reason: 'HOLD_UNAVAILABLE',
  });
  handler = json(422, envelope('BUSINESS_RULE_VIOLATION', 'HOLD_EXPIRED'));
  assert.deepEqual(await committer.commit(input, randomUUID()), {
    kind: 'REFUSED',
    reason: 'HOLD_EXPIRED',
  });
  handler = json(422, envelope('BUSINESS_RULE_VIOLATION', 'HOLD_NOT_ACTIVE'));
  assert.deepEqual(await committer.commit(input, randomUUID()), {
    kind: 'REFUSED',
    reason: 'HOLD_UNAVAILABLE',
  });
  handler = json(412, envelope('REVISION_CONFLICT', null));
  assert.deepEqual(await committer.commit(input, randomUUID()), {
    kind: 'REFUSED',
    reason: 'HOLD_UNAVAILABLE',
  });
  for (const [status, body] of [
    [500, envelope('INTERNAL_ERROR', null)],
    [409, envelope('IDEMPOTENCY_IN_PROGRESS', null)],
    [401, envelope('AUTH_REQUIRED', null)],
    [200, { ...hold, state: 'HELD' }],
    [200, { nonsense: true }],
  ] as const) {
    handler = json(status, body);
    assert.equal((await committer.commit(input, randomUUID())).kind, 'UNKNOWN', `status ${status}`);
  }
  handler = (_req, _body, res) => setTimeout(() => res.writeHead(200).end('{}'), 1_000);
  assert.deepEqual(
    await new SchedulingHoldCommitter(client({ timeoutMs: 300 })).commit(input, randomUUID()),
    {
      kind: 'UNKNOWN',
      error: 'TIMEOUT',
    },
  );
});

test('scheduling: hold read refuses a response for another hold', async () => {
  const reader = new SchedulingHoldReader(client());
  const hold = holdWire({
    beneficiary: principal(),
    zoneId: randomUUID(),
    startsAt: new Date(NOW.getTime() + 7_200_000),
    now: NOW,
  });
  handler = json(200, hold);
  assert.equal((await reader.read(hold.holdId, CREDENTIAL, randomUUID())).kind, 'OK');
  assert.equal((await reader.read(randomUUID(), CREDENTIAL, randomUUID())).kind, 'UNAVAILABLE');
});

test('vehicle: the snapshot must be the requested saved vehicle revision', async () => {
  const adapter = new VehicleSnapshotAdapter(client());
  const vehicleId = randomUUID();
  const request = { owner: principal(), id: vehicleId, expectedRevision: 2 };
  handler = json(200, vehicleWire(vehicleId, 2, NOW));
  assert.equal((await adapter.resolve(request, randomUUID())).kind, 'OK');
  handler = json(200, vehicleWire(vehicleId, 3, NOW));
  assert.deepEqual(await adapter.resolve(request, randomUUID()), {
    kind: 'UNAVAILABLE',
    error: 'UPSTREAM_INVALID',
  });
  handler = json(422, envelope('BUSINESS_RULE_VIOLATION', 'VEHICLE_ARCHIVED'));
  assert.deepEqual(await adapter.resolve(request, randomUUID()), {
    kind: 'NOT_USABLE',
    reason: 'VEHICLE_ARCHIVED',
  });
});

function billingRequest() {
  return {
    bookingId: randomUUID(),
    beneficiary: principal(),
    quoteId: randomUUID(),
    quoteRevision: 1,
    amount: money('SYP', 9_000_000n),
    paymentMethod: 'SHAM_CASH' as const,
  };
}

function obligationWire(quoteId: string) {
  const amount = { currency: 'SYP', amountMinor: '9000000', scale: 2 };
  return {
    obligationId: randomUUID(),
    revision: 1,
    status: 'OPEN',
    financialStatus: 'UNPAID',
    quoteId,
    amount,
    verified: { ...amount, amountMinor: '0' },
    outstanding: amount,
    activeIntent: null,
    attempts: [],
    cashReceipt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

test('billing: the published create route binds exact quote and money and rejects incomplete success', async () => {
  const adapter = new BillingObligationsAdapter(client());
  const request = billingRequest();
  const wire = obligationWire(request.quoteId);
  handler = json(201, wire);
  assert.deepEqual(await adapter.create(request, randomUUID()), {
    kind: 'CREATED',
    obligationId: wire.obligationId,
  });
  const call = seen.at(-1);
  assert.equal(call?.url, '/internal/v1/billing/booking-obligations');
  assert.equal(call?.headers['idempotency-key'], `booking-obligation-${request.bookingId}`);
  assert.equal(call?.headers['x-service-client'], 'booking');
  assert.equal(call?.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(call?.body ?? '{}'), {
    beneficiary: request.beneficiary,
    bookingId: request.bookingId,
    quoteId: request.quoteId,
  });
  for (const invalid of [
    { ...wire, amount: { ...wire.amount, amountMinor: '1' } },
    { ...wire, quoteId: randomUUID() },
    { ...wire, obligationId: '<script>' },
    { obligationId: wire.obligationId, quoteId: request.quoteId, amount: wire.amount },
    { ...wire, financialStatus: 'PAID' },
  ]) {
    handler = json(201, invalid);
    assert.deepEqual(await adapter.create(request, randomUUID()), {
      kind: 'UNAVAILABLE',
      error: 'UPSTREAM_INVALID',
    });
  }
  handler = json(409, envelope('BOOKING_COMPENSATED', null));
  assert.deepEqual(await adapter.create(request, randomUUID()), { kind: 'REJECTED' });
  handler = json(409, envelope('QUOTE_NOT_USABLE', null));
  assert.equal((await adapter.create(request, randomUUID())).kind, 'UNAVAILABLE');
  handler = json(422, envelope('BUSINESS_RULE_VIOLATION', null));
  assert.deepEqual(await adapter.create(request, randomUUID()), { kind: 'REJECTED' });
  const unconfigured = new BillingObligationsAdapter(client({ baseUrl: undefined }));
  assert.deepEqual(await unconfigured.create(request, randomUUID()), {
    kind: 'UNAVAILABLE',
    error: 'NOT_CONFIGURED',
  });
});

test('billing: compensation requires a closed owner-bound durable receipt; 404 never proves absence', async () => {
  const adapter = new BillingObligationsAdapter(client());
  const request = billingRequest();
  const receipt = {
    bookingId: request.bookingId,
    beneficiary: request.beneficiary,
    quoteId: request.quoteId,
    outcome: 'ABSENT_FENCED',
    obligationId: null,
    obligationRevision: null,
    compensatedAt: NOW.toISOString(),
  };
  for (const valid of [
    receipt,
    {
      ...receipt,
      outcome: 'VOIDED',
      obligationId: randomUUID(),
      obligationRevision: 2,
    },
  ]) {
    handler = json(200, valid);
    assert.deepEqual(await adapter.voidForBooking(request, randomUUID()), { kind: 'VOIDED' });
  }
  const call = seen.at(-1);
  assert.equal(call?.url, '/internal/v1/billing/booking-obligations/compensations');
  assert.equal(call?.headers['idempotency-key'], `booking-void-${request.bookingId}`);
  assert.deepEqual(JSON.parse(call?.body ?? '{}'), {
    bookingId: request.bookingId,
    beneficiary: request.beneficiary,
    quoteId: request.quoteId,
    reason: 'BOOKING_FAILED',
  });
  for (const invalid of [
    { state: 'VOIDED' },
    { ...receipt, bookingId: randomUUID() },
    { ...receipt, quoteId: randomUUID() },
    { ...receipt, beneficiary: principal() },
    { ...receipt, outcome: 'VOIDED' },
    { ...receipt, obligationId: randomUUID() },
    { ...receipt, amount: '0' },
  ]) {
    handler = json(200, invalid);
    assert.deepEqual(await adapter.voidForBooking(request, randomUUID()), {
      kind: 'UNAVAILABLE',
      error: 'UPSTREAM_INVALID',
    });
  }
  for (const status of [404, 409, 503]) {
    handler = json(status, envelope('NOT_FOUND', null));
    assert.equal((await adapter.voidForBooking(request, randomUUID())).kind, 'UNAVAILABLE');
  }
});

test('acl: closed shapes, exact arithmetic and canonical instants are enforced', () => {
  const beneficiary = principal();
  const quote = quoteWire({ beneficiary, now: NOW });
  assert.doesNotThrow(() => parseQuote(quote));
  const bad = (mutate: (q: ReturnType<typeof quoteWire>) => unknown) => () =>
    parseQuote(mutate(structuredClone(quote)));
  assert.throws(
    bad((q) => ({ ...q, extra: 1 })),
    ContractViolation,
  );
  assert.throws(
    bad((q) => ({ ...q, total: { ...q.total, amountMinor: '9000001' } })),
    ContractViolation,
  );
  assert.throws(
    bad((q) => ({ ...q, issuedAt: '2026-10-08T08:00:00Z' })),
    ContractViolation,
  );
  assert.throws(
    bad((q) => ({ ...q, lines: [] })),
    ContractViolation,
  );
  assert.throws(
    bad((q) => ({ ...q, total: { ...q.total, amountMinor: 9000000 } })),
    ContractViolation,
  );
  const hold = holdWire({
    beneficiary,
    zoneId: randomUUID(),
    startsAt: new Date(NOW.getTime() + 7_200_000),
    now: NOW,
  });
  assert.throws(
    () => parseHold({ ...hold, state: 'COMMITTED' }),
    ContractViolation,
    'COMMITTED requires bookingId',
  );
  assert.throws(() => parseHold({ ...hold, endsAt: hold.startsAt }), ContractViolation);
  const vehicle = vehicleWire(randomUUID(), 1, NOW);
  assert.throws(() => parseVehicleSnapshot({ ...vehicle, source: 'inline' }), ContractViolation);
  const address = addressWire(randomUUID(), 1, NOW);
  assert.throws(
    () =>
      parseAddressSnapshot({
        ...address,
        location: {
          mode: 'coordinates',
          point: { latitude: '91.000000', longitude: '0.000000' },
          description: null,
        },
      }),
    ContractViolation,
  );
  assert.throws(
    () =>
      parseAddressSnapshot({
        ...address,
        location: {
          mode: 'coordinates',
          point: { latitude: 'NaN', longitude: '0.000000' },
          description: null,
        },
      }),
    ContractViolation,
  );
});

test('identity: a session without principalKind is refused, not assumed to be an account', async () => {
  const subject = randomUUID();
  handler = json(200, { subject, permissions: ['bookings.create:self'], sessionId: randomUUID() });
  const identity = new IdentitySessionClient({ baseUrl: base, timeoutMs: 3_000 });
  await assert.rejects(
    identity.resolve('Bearer token-000000000000001', randomUUID()),
    IdentityAuthFailure,
  );
  handler = json(200, { subject, principalKind: 'guest', permissions: ['bookings.create:self'] });
  assert.deepEqual(await identity.resolve('Bearer token-000000000000001', randomUUID()), {
    subject,
    principalKind: 'guest',
    permissions: ['bookings.create:self'],
  });
  await assert.rejects(
    identity.resolve('Basic abc', randomUUID()),
    (e: unknown) => e instanceof IdentityAuthFailure && e.reason === 'UNAUTHENTICATED',
  );
});

test('errors: the envelope has the published shape and never reflects internal text', () => {
  const mapped = mapError(
    new BookingError('QUOTE_NOT_USABLE', 'secret internals', 'QUOTE_EXPIRED'),
  );
  const body = errorEnvelope(mapped, { requestId: 'req-1', correlationId: 'corr-1' });
  assert.deepEqual(Object.keys(body.error).sort(), [
    'code',
    'correlationId',
    'issues',
    'message',
    'reason',
    'requestId',
    'retryAfterMs',
    'retryable',
  ]);
  assert.equal(body.error.code, 'BUSINESS_RULE_VIOLATION');
  assert.equal(body.error.reason, 'QUOTE_EXPIRED');
  assert.equal(JSON.stringify(body).includes('secret'), false);
  const unavailable = errorEnvelope(mapError(new BookingError('DEPENDENCY_UNAVAILABLE', 'x')), {
    requestId: 'r',
    correlationId: 'c',
  });
  assert.equal(unavailable.error.retryable, true);
  assert.equal(
    errorEnvelope(mapError(new Error('boom')), { requestId: 'r', correlationId: 'c' }).error.code,
    'INTERNAL_ERROR',
  );
});

test('credential: the user credential never serialises', () => {
  const text = JSON.stringify({ credential: CREDENTIAL }) + String(CREDENTIAL);
  assert.equal(text.includes('customer-token'), false);
});
