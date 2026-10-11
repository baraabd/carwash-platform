import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BillingApplicationError,
  BookingObligationService,
  type ServiceRequestContext,
} from '../src/application';
import { QuoteUnavailable, type BillingRepository } from '../src/ports';
import { PricingQuoteValidator } from '../src/infrastructure/pricing/pricing-quote.validator';
import { ServiceClientCallerAuthority } from '../src/infrastructure/security/service-callers';
import { RandomIds, Sha256Hasher } from '../src/infrastructure/system/system.adapters';
import { FixedClock, SESSIONS, TOKENS } from './support/billing-http-harness';
import {
  SERVICE_CLIENTS,
  WORKLOADS,
  startBookingSagaHttp,
  startValidateStub,
  type BookingSagaHttp,
  type ValidateStub,
} from './support/booking-saga-harness';
import {
  startIdentityStub,
  startPricingStub,
  type PricingStub,
  type Stub,
} from './support/upstream-stubs';

/*
 * Unit/adapter evidence for the booking-saga routes: workload authorization
 * (deny by default), the pricing.v1 validateQuote adapter against a local HTTP
 * double, and the HTTP auth matrix with a repository that must never be
 * touched. Persistence, concurrency and money effects are proven on real
 * PostgreSQL in test/integration/billing.booking-saga.postgres.spec.ts.
 */

const BENEFICIARY = { kind: 'account', subjectId: '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f' } as const;
const PATH = '/internal/v1/billing';

/** Any repository access fails the test: authorization must come first. */
const untouchable = new Proxy({} as BillingRepository, {
  get(_target, property) {
    throw new Error(`REPOSITORY_TOUCHED:${String(property)}`);
  },
});

let identity: Stub;
let pricing: PricingStub;
let validate: ValidateStub;
let http: BookingSagaHttp;
let unconfigured: BookingSagaHttp;

before(async () => {
  identity = await startIdentityStub(SESSIONS);
  pricing = await startPricingStub();
  validate = await startValidateStub();
  const clock = new FixedClock(new Date('2026-10-11T10:00:00.000Z'));
  http = await startBookingSagaHttp({
    repository: untouchable,
    clock,
    identity,
    pricing,
    validate,
  });
  unconfigured = await startBookingSagaHttp({
    repository: untouchable,
    clock,
    identity,
    pricing,
    validate,
    serviceClients: '',
  });
});

after(async () => {
  await http?.close();
  await unconfigured?.close();
  await identity?.close();
  await pricing?.close();
  await validate?.close();
});

const code = (body: Record<string, unknown>) =>
  (body.error as { code?: unknown } | undefined)?.code;

// ------------------------------------------------------- workload authority

test('workload authority: configured client with the scope is allowed', () => {
  const authority = new ServiceClientCallerAuthority(SERVICE_CLIENTS);
  assert.deepEqual(
    authority.authorize(
      WORKLOADS.booking.clientId,
      WORKLOADS.booking.token,
      'billing.obligation.write',
    ),
    { ok: true, clientId: 'booking' },
  );
});

test('workload authority: unknown client, wrong token, missing values and empty config are unauthenticated', () => {
  const authority = new ServiceClientCallerAuthority(SERVICE_CLIENTS);
  const scope = 'billing.obligation.write' as const;
  const denied = { ok: false, reason: 'UNAUTHENTICATED' };
  assert.deepEqual(authority.authorize('booking', WORKLOADS.other.token, scope), denied);
  assert.deepEqual(authority.authorize('dispatch', WORKLOADS.booking.token, scope), denied);
  assert.deepEqual(authority.authorize(undefined, WORKLOADS.booking.token, scope), denied);
  assert.deepEqual(authority.authorize('booking', undefined, scope), denied);
  for (const raw of [undefined, '', '   ']) {
    assert.deepEqual(
      new ServiceClientCallerAuthority(raw).authorize('booking', WORKLOADS.booking.token, scope),
      denied,
    );
  }
});

test('workload authority: malformed or over-broad configuration fails startup', () => {
  assert.throws(() => new ServiceClientCallerAuthority('{'), /SERVICE_CLIENTS_INVALID_JSON/);
  assert.throws(
    () =>
      new ServiceClientCallerAuthority(
        JSON.stringify([{ id: 'booking', tokenSha256: 'a'.repeat(64), scopes: ['billing.read'] }]),
      ),
    /SERVICE_CLIENTS_INVALID_SCOPE/,
  );
});

test('application: a scope denial is 403 and an unauthenticated workload is 401, before any read', async () => {
  const context: ServiceRequestContext = {
    clientId: 'booking',
    token: 'x'.repeat(40),
    bearerPresent: false,
    correlationId: randomUUID(),
  };
  for (const [reason, expected] of [
    ['SCOPE_DENIED', 'AUTH_FORBIDDEN'],
    ['UNAUTHENTICATED', 'AUTH_REQUIRED'],
  ] as const) {
    const service = new BookingObligationService({
      repository: untouchable,
      services: { authorize: () => ({ ok: false, reason }) },
      quotes: {
        validate: () => Promise.reject(new Error('PRICING_MUST_NOT_BE_CALLED')),
      },
      clock: new FixedClock(new Date()),
      ids: new RandomIds(),
      hasher: new Sha256Hasher(),
    });
    await assert.rejects(
      service.createForBooking(context, 'booking-key-0000000001', {}),
      (error: unknown) => error instanceof BillingApplicationError && error.code === expected,
    );
    await assert.rejects(
      service.voidForBooking(context, randomUUID(), 'booking-key-0000000001', {}),
      (error: unknown) => error instanceof BillingApplicationError && error.code === expected,
    );
  }
});

// ------------------------------------------------- pricing.v1 validateQuote

function validator(credential = true, timeoutMs = 5_000) {
  return new PricingQuoteValidator(
    { origin: new URL(validate.origin), timeoutMs },
    credential ? WORKLOADS.billing : null,
  );
}

function quoteFor(overrides: Partial<{ revision: number; status: 'USABLE' | 'EXPIRED' }> = {}) {
  const id = randomUUID();
  validate.quotes.set(id, {
    beneficiary: BENEFICIARY,
    status: overrides.status ?? 'USABLE',
    revision: overrides.revision ?? 1,
    currency: 'SYP',
    totalMinor: '175000',
  });
  return id;
}

test('validator: a valid quote yields Pricing total; workload headers only, purpose booking-create', async () => {
  validate.mode = 'normal';
  const id = quoteFor();
  const before = validate.calls.length;
  const result = await validator().validate(id, BENEFICIARY, randomUUID());
  assert.equal(result.kind, 'VALID');
  assert.equal(result.kind === 'VALID' && result.total.amountMinor, 175000n);
  const call = validate.calls.at(-1);
  assert.equal(validate.calls.length, before + 1);
  assert.equal(call?.client, 'billing');
  assert.equal(call?.authorization, undefined);
  assert.deepEqual(call?.body, {
    expectedRevision: 1,
    beneficiary: BENEFICIARY,
    purpose: 'booking-create',
  });
});

test('validator: REVISION_MISMATCH is resolved with exactly one more call at the named revision', async () => {
  validate.mode = 'normal';
  const id = quoteFor({ revision: 3 });
  const before = validate.calls.length;
  const result = await validator().validate(id, BENEFICIARY, randomUUID());
  assert.equal(result.kind, 'VALID');
  assert.equal(validate.calls.length, before + 2);
  assert.equal(validate.calls.at(-1)?.body.expectedRevision, 3);
});

test('validator: negative reasons, 404 and 422 are NOT_USABLE', async () => {
  validate.mode = 'normal';
  const v = validator();
  assert.deepEqual(await v.validate(quoteFor({ status: 'EXPIRED' }), BENEFICIARY, randomUUID()), {
    kind: 'NOT_USABLE',
  });
  assert.deepEqual(
    await v.validate(quoteFor(), { kind: 'guest', subjectId: randomUUID() }, randomUUID()),
    { kind: 'NOT_USABLE' },
  );
  assert.deepEqual(await v.validate(randomUUID(), BENEFICIARY, randomUUID()), {
    kind: 'NOT_USABLE',
  });
  validate.mode = 'status-422';
  assert.deepEqual(await v.validate(quoteFor(), BENEFICIARY, randomUUID()), {
    kind: 'NOT_USABLE',
  });
  validate.mode = 'normal';
});

test('validator: outage, refused credential, timeout, malformed body and missing config are unavailable', async () => {
  const id = quoteFor();
  for (const mode of ['error-500', 'refuse-401', 'garbage', 'hang'] as const) {
    validate.mode = mode;
    await assert.rejects(
      validator(true, 200).validate(id, BENEFICIARY, randomUUID()),
      QuoteUnavailable,
      mode,
    );
  }
  validate.mode = 'normal';
  await assert.rejects(validator(false).validate(id, BENEFICIARY, randomUUID()), QuoteUnavailable);
  await assert.rejects(
    new PricingQuoteValidator({ origin: null, timeoutMs: 500 }, WORKLOADS.billing).validate(
      id,
      BENEFICIARY,
      randomUUID(),
    ),
    QuoteUnavailable,
  );
  await assert.rejects(
    validator().validate('not-a-uuid', BENEFICIARY, randomUUID()),
    QuoteUnavailable,
  );
});

// ----------------------------------------------------------- HTTP auth matrix

const createBody = () => ({
  beneficiary: BENEFICIARY,
  quoteId: randomUUID(),
  bookingId: randomUUID(),
});

test('HTTP: booking-saga routes refuse missing, wrong, unconfigured and human credentials (401)', async () => {
  const create = `${PATH}/booking-obligations`;
  const voidPath = `${PATH}/booking-obligations/${randomUUID()}/void`;
  const key = 'booking-key-0000000002';
  const cases = [
    { name: 'none', options: {} },
    { name: 'human bearer', options: { token: TOKENS.customer } },
    {
      name: 'bearer plus valid workload',
      options: { token: TOKENS.customer, workload: WORKLOADS.booking },
    },
    {
      name: 'wrong token',
      options: { workload: { clientId: 'booking', token: WORKLOADS.other.token } },
    },
    {
      name: 'unknown client',
      options: { workload: { clientId: 'dispatch', token: WORKLOADS.booking.token } },
    },
  ];
  for (const { name, options } of cases) {
    const created = await http.request('POST', create, { ...options, key, body: createBody() });
    assert.equal(created.status, 401, `create ${name}`);
    assert.equal(code(created.body), 'AUTH_REQUIRED', `create ${name}`);
    const voided = await http.request('POST', voidPath, {
      ...options,
      key,
      body: { expectedRevision: 1 },
    });
    assert.equal(voided.status, 401, `void ${name}`);
  }
  const off = await unconfigured.request('POST', create, {
    workload: WORKLOADS.booking,
    key,
    body: createBody(),
  });
  assert.equal(off.status, 401);
});

test('HTTP: an authorized workload still needs a valid key and the exact contract body (no repository access)', async () => {
  const create = `${PATH}/booking-obligations`;
  const noKey = await http.request('POST', create, {
    workload: WORKLOADS.booking,
    body: createBody(),
  });
  assert.equal(noKey.status, 400);
  assert.equal(code(noKey.body), 'IDEMPOTENCY_KEY_INVALID');
  const key = 'booking-key-0000000003';
  for (const body of [
    { ...createBody(), amount: { currency: 'SYP', amountMinor: '1', scale: 2 } },
    { quoteId: randomUUID(), bookingId: randomUUID() },
    { ...createBody(), beneficiary: { kind: 'technician', subjectId: randomUUID() } },
    { ...createBody(), bookingId: 'booking-1' },
  ]) {
    const reply = await http.request('POST', create, { workload: WORKLOADS.booking, key, body });
    assert.equal(reply.status, 400, JSON.stringify(body));
    assert.equal(code(reply.body), 'REQUEST_INVALID');
  }
  const badId = await http.request('POST', `${PATH}/booking-obligations/not-a-uuid/void`, {
    workload: WORKLOADS.booking,
    key,
    body: { expectedRevision: 1 },
  });
  assert.equal(badId.status, 404);
});

test('HTTP: the customer routes never accept a workload credential', async () => {
  const reply = await http.request('POST', `${PATH}/obligations`, {
    workload: WORKLOADS.booking,
    key: 'booking-key-0000000004',
    body: { quoteId: randomUUID() },
  });
  assert.equal(reply.status, 401);
  const read = await http.request('GET', `${PATH}/obligations/${randomUUID()}`, {
    workload: WORKLOADS.booking,
  });
  assert.equal(read.status, 401);
});
