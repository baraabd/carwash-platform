import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryPricingRepository } from './support/in-memory-pricing.repository';
import {
  SERVICE,
  TOKENS,
  startPricingHttp,
  type PricingHttpHarness,
} from './support/pricing-http-harness';
import {
  CUSTOMER,
  DEF,
  FixedClock,
  FixedPolicy,
  GUEST,
  TEST_POLICY,
  priceBookRequest,
  quoteRequest,
} from './support/pricing-fixtures';

/*
 * Transport + application + real Identity/Catalog/service-client adapters
 * over local HTTP stubs. Persistence is an in-memory test double here; the
 * same behaviour against real PostgreSQL is in test/integration.
 */
const PATH = '/internal/v1/pricing';
let http: PricingHttpHarness;
let repository: InMemoryPricingRepository;
let policy: FixedPolicy;
let clock: FixedClock;
let seq = 0;
const key = () => `http-pricing-key-${String(++seq).padStart(8, '0')}`;

function errorOf(body: Record<string, unknown>) {
  const error = body.error as Record<string, unknown>;
  assert.ok(error, JSON.stringify(body));
  return error;
}

async function publish(expected = 1, body = priceBookRequest(expected)) {
  return http.request('POST', `${PATH}/price-books`, { token: TOKENS.admin, key: key(), body });
}

async function quote(token = TOKENS.customer, body = quoteRequest(), k = key()) {
  return http.request('POST', `${PATH}/quotes`, { token, key: k, body });
}

before(async () => {
  clock = new FixedClock(new Date('2026-10-11T10:00:00.000Z'));
  policy = new FixedPolicy();
  repository = new InMemoryPricingRepository();
  http = await startPricingHttp({ repository, policy, clock });
});

after(async () => {
  await http.close();
});

beforeEach(() => {
  policy.policy = TEST_POLICY;
  policy.ttl = 900;
  http.catalog.mode = 'normal';
  http.identity.mode = 'normal';
});

test('publishPriceBook: authentication, contract permission and idempotency key are enforced', async () => {
  const body = priceBookRequest(1);
  let r = await http.request('POST', `${PATH}/price-books`, { key: key(), body });
  assert.equal(r.status, 401);
  assert.equal(errorOf(r.body).code, 'AUTH_REQUIRED');
  r = await http.request('POST', `${PATH}/price-books`, {
    token: TOKENS.customer,
    key: key(),
    body,
  });
  assert.equal(r.status, 403);
  // Identity's current `pricing.publish` grant is not the contract's permission.
  r = await http.request('POST', `${PATH}/price-books`, {
    token: TOKENS.legacyAdmin,
    key: key(),
    body,
  });
  assert.equal(r.status, 403);
  r = await http.request('POST', `${PATH}/price-books`, { token: TOKENS.admin, body });
  assert.equal(r.status, 428);
  assert.equal(errorOf(r.body).code, 'IDEMPOTENCY_KEY_REQUIRED');
  r = await http.request('POST', `${PATH}/price-books`, {
    token: TOKENS.admin,
    key: 'short',
    body,
  });
  assert.equal(r.status, 400);
  http.identity.mode = 'error-500';
  r = await publish();
  assert.equal(r.status, 503);
  assert.equal(errorOf(r.body).reason, 'AUTH_UNAVAILABLE');
  assert.equal(errorOf(r.body).retryable, true);
  assert.equal(repository.books.length, 0);
});

test('publishPriceBook: fails closed on policy, catalog outage and invalid catalog bodies', async () => {
  policy.policy = null;
  let r = await publish();
  assert.equal(r.status, 503);
  assert.equal(errorOf(r.body).reason, 'POLICY_UNAVAILABLE');
  policy.policy = { ...TEST_POLICY, currency: 'XTS' };
  r = await publish();
  assert.equal(r.status, 503);
  policy.policy = TEST_POLICY;
  for (const mode of ['error-500', 'garbage', 'redirect', 'hang'] as const) {
    http.catalog.mode = mode;
    const started = Date.now();
    r = await publish();
    assert.equal(r.status, 502, mode);
    assert.equal(errorOf(r.body).code, 'UPSTREAM_UNAVAILABLE');
    assert.ok(Date.now() - started < 8_000, `${mode} must be bounded`);
  }
  assert.equal(repository.books.length, 0);
  // No user credential is forwarded to the public catalog route.
  assert.ok(http.catalog.calls.every((c) => c.authorization === undefined));
});

test('publishPriceBook: catalog validation reports issues; nothing is stored', async () => {
  const incomplete = priceBookRequest(1);
  (incomplete.entries as unknown[]).pop();
  const r = await publish(1, incomplete);
  assert.equal(r.status, 422);
  const error = errorOf(r.body);
  assert.equal(error.code, 'VALIDATION_FAILED');
  assert.deepEqual(
    (error.issues as { code: string }[]).map((i) => i.code),
    ['PRICE_MISSING', 'PRICE_MISSING'],
  );
  assert.equal(repository.books.length, 0);
});

test('createQuote: refused until a price book is in force', async () => {
  const r = await quote();
  assert.equal(r.status, 503);
  assert.equal(errorOf(r.body).reason, 'PRICES_NOT_PUBLISHED');
});

test('publishPriceBook: publishes, replays the same key and refuses a stale revision', async () => {
  const k = key();
  const body = priceBookRequest(1);
  const first = await http.request('POST', `${PATH}/price-books`, {
    token: TOKENS.admin,
    key: k,
    body,
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.priceBookRevision, 1);
  assert.equal(first.body.catalogRevision, 1);
  assert.equal(first.body.entryCount, 4);
  assert.equal(first.headers.get('idempotency-replayed'), 'false');
  const replay = await http.request('POST', `${PATH}/price-books`, {
    token: TOKENS.admin,
    key: k,
    body,
  });
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  const conflict = await http.request('POST', `${PATH}/price-books`, {
    token: TOKENS.admin,
    key: k,
    body: priceBookRequest(2),
  });
  assert.equal(conflict.status, 409);
  assert.equal(errorOf(conflict.body).code, 'IDEMPOTENCY_CONFLICT');
  const staleKey = key();
  const stale = await http.request('POST', `${PATH}/price-books`, {
    token: TOKENS.admin,
    key: staleKey,
    body: priceBookRequest(1),
  });
  assert.equal(stale.status, 412);
  assert.equal(errorOf(stale.body).code, 'REVISION_CONFLICT');
  const staleReplay = await http.request('POST', `${PATH}/price-books`, {
    token: TOKENS.admin,
    key: staleKey,
    body: priceBookRequest(1),
  });
  assert.equal(staleReplay.status, 412);
  assert.equal(repository.books.length, 1);
  assert.deepEqual(
    repository.audit.map((a) => [a.action, a.outcome]),
    [
      ['pricing.price-book.published', 'PUBLISHED'],
      ['pricing.price-book.publish-rejected', 'REVISION_CONFLICT'],
    ],
  );
});

test('createQuote: issues the pricing.v1 QuoteV1 for the caller only', async () => {
  const r = await quote();
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), [
    'beneficiary',
    'catalogRevision',
    'currency',
    'expiresAt',
    'issuedAt',
    'lines',
    'priceBookRevision',
    'quoteId',
    'revision',
    'status',
    'total',
    'vehicleType',
    'zoneId',
  ]);
  assert.equal(r.body.status, 'USABLE');
  assert.equal(r.body.revision, 1);
  assert.deepEqual(r.body.beneficiary, CUSTOMER);
  assert.deepEqual(r.body.total, { currency: 'SYP', amountMinor: '800000', scale: 2 });
  assert.equal(r.body.expiresAt, '2026-10-11T10:15:00.000Z');
  const lines = r.body.lines as Record<string, unknown>[];
  assert.deepEqual(
    lines.map((l) => [
      l.kind,
      l.definitionId,
      l.quantity,
      (l.amount as { amountMinor: string }).amountMinor,
    ]),
    [
      ['PACKAGE', DEF.exterior, 1, '650000'],
      ['EXTRA', DEF.tyreShine, 2, '150000'],
    ],
  );

  let refused = await quote(TOKENS.otherCustomer);
  assert.equal(refused.status, 403);
  refused = await quote(
    TOKENS.customer,
    quoteRequest({ beneficiary: { ...CUSTOMER, kind: 'guest' } }),
  );
  assert.equal(refused.status, 403);
  refused = await quote(
    TOKENS.noBooking,
    quoteRequest({
      beneficiary: { kind: 'account', subjectId: '2d2d2d2d-0000-4000-8000-00000000002d' },
    }),
  );
  assert.equal(refused.status, 403);
  const guest = await quote(TOKENS.guest, quoteRequest({ beneficiary: GUEST }));
  assert.equal(guest.status, 201);
  assert.deepEqual(guest.body.beneficiary, GUEST);
});

test('createQuote: rule refusals are recorded per key; malformed input is 400', async () => {
  const k = key();
  const body = quoteRequest({ vehicleType: 'pickup' });
  const r = await quote(TOKENS.customer, body, k);
  assert.equal(r.status, 422);
  assert.equal(errorOf(r.body).code, 'BUSINESS_RULE_VIOLATION');
  assert.equal(errorOf(r.body).reason, 'SELECTION_INVALID');
  const replay = await quote(TOKENS.customer, body, k);
  assert.equal(replay.status, 422);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  const malformed = await quote(TOKENS.customer, { ...quoteRequest(), total: '1' });
  assert.equal(malformed.status, 400);
  assert.equal(errorOf(malformed.body).code, 'REQUEST_INVALID');
  const json = await http.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: key(),
    raw: '{"beneficiary":',
  });
  // Body-parser refusals happen before routing and use the shared service-kit
  // filter installed by bootstrapService; the parser text is never reflected.
  assert.equal(json.status, 400);
  assert.doesNotMatch(JSON.stringify(json.body), /Unexpected|JSON/);
});

test('createQuote: same-key replay returns the original snapshot; concurrent same key yields one quote', async () => {
  const k = key();
  const first = await quote(TOKENS.customer, quoteRequest(), k);
  clock.advance(60_000);
  const replay = await quote(TOKENS.customer, quoteRequest(), k);
  assert.equal(replay.body.quoteId, first.body.quoteId);
  assert.equal(replay.body.issuedAt, first.body.issuedAt);
  assert.equal(replay.body.expiresAt, first.body.expiresAt);
  const conflict = await quote(TOKENS.customer, quoteRequest({ vehicleType: 'sedan' }), k);
  assert.equal(conflict.status, 409);

  const before = repository.quotes.size;
  const racing = key();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => quote(TOKENS.customer, quoteRequest(), racing)),
  );
  assert.equal(new Set(results.map((x) => x.body.quoteId)).size, 1);
  assert.equal(repository.quotes.size, before + 1);
});

test('getQuote: only the beneficiary reads it; status follows server time', async () => {
  const created = await quote();
  const id = created.body.quoteId as string;
  let r = await http.request('GET', `${PATH}/quotes/${id}`, { token: TOKENS.customer });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, created.body);
  r = await http.request('GET', `${PATH}/quotes/${id.toUpperCase()}`, { token: TOKENS.customer });
  assert.equal(r.status, 200);
  for (const token of [TOKENS.otherCustomer, TOKENS.guest]) {
    r = await http.request('GET', `${PATH}/quotes/${id}`, { token });
    assert.equal(r.status, 404);
  }
  r = await http.request('GET', `${PATH}/quotes/not-a-uuid`, { token: TOKENS.customer });
  assert.equal(r.status, 404);
  r = await http.request('GET', `${PATH}/quotes/${id}`);
  assert.equal(r.status, 401);
  clock.advance(900_000);
  r = await http.request('GET', `${PATH}/quotes/${id}`, { token: TOKENS.customer });
  assert.equal(r.body.status, 'EXPIRED');
  assert.equal(r.body.expiresAt, created.body.expiresAt);
});

test('validateQuote: service scope only, purpose audited, exact reasons', async () => {
  const created = await quote();
  const id = created.body.quoteId as string;
  const body = { expectedRevision: 1, beneficiary: CUSTOMER, purpose: 'booking-create' };
  const validate = (b: unknown, service = SERVICE.booking, quoteId = id) =>
    http.request('POST', `${PATH}/quotes/${quoteId}/validate`, { service, body: b });

  let r = await http.request('POST', `${PATH}/quotes/${id}/validate`, {
    token: TOKENS.customer,
    body,
  });
  assert.equal(r.status, 401);
  r = await validate(body, SERVICE.reporting);
  assert.equal(r.status, 401);
  r = await validate(body, { clientId: 'booking', token: SERVICE.reporting.token });
  assert.equal(r.status, 401);

  r = await validate(body);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    quoteId: id,
    revision: 1,
    valid: true,
    reason: null,
    total: { currency: 'SYP', amountMinor: '800000', scale: 2 },
  });
  r = await validate({ ...body, beneficiary: GUEST });
  assert.equal(r.body.reason, 'BENEFICIARY_MISMATCH');
  assert.equal(r.body.valid, false);
  r = await validate({ ...body, expectedRevision: 2 });
  assert.equal(r.body.reason, 'REVISION_MISMATCH');
  r = await validate({ ...body, purpose: 'marketing' });
  assert.equal(r.status, 400);
  r = await validate(body, SERVICE.booking, '99999999-9999-4999-8999-999999999999');
  assert.equal(r.status, 404);
  clock.advance(900_000);
  r = await validate(body);
  assert.equal(r.body.reason, 'QUOTE_EXPIRED');

  const audit = repository.audit.filter((a) => a.action === 'pricing.quote.validated');
  assert.ok(audit.length >= 5);
  assert.ok(audit.every((a) => a.actor === 'service:booking' && a.purpose === 'booking-create'));
  assert.deepEqual(audit.map((a) => a.outcome).slice(-5), [
    'VALID',
    'BENEFICIARY_MISMATCH',
    'REVISION_MISMATCH',
    'NOT_FOUND',
    'QUOTE_EXPIRED',
  ]);
});

test('createQuote: a policy change after publication is not silently reinterpreted', async () => {
  policy.policy = { ...TEST_POLICY, revision: 'test-policy-2' };
  const r = await quote();
  assert.equal(r.status, 503);
  assert.equal(errorOf(r.body).reason, 'POLICY_UNAVAILABLE');
  policy.ttl = null;
  policy.policy = TEST_POLICY;
  const noTtl = await quote();
  assert.equal(noTtl.status, 503);
});

test('a newer price book applies to new quotes only; issued quotes keep their snapshot', async () => {
  const old = await quote();
  const raised = priceBookRequest(2);
  (raised.entries as { unitPrice: { amountMinor: string } }[])[1]!.unitPrice.amountMinor = '700000';
  const published = await publish(2, raised);
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const fresh = await quote();
  assert.equal(fresh.body.priceBookRevision, 2);
  assert.equal((fresh.body.total as { amountMinor: string }).amountMinor, '850000');
  const reread = await http.request('GET', `${PATH}/quotes/${old.body.quoteId as string}`, {
    token: TOKENS.customer,
  });
  assert.equal(reread.body.priceBookRevision, 1);
  assert.equal((reread.body.total as { amountMinor: string }).amountMinor, '800000');
});
