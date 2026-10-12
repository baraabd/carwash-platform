/**
 * Provider conformance: the REAL Pricing owner API (compiled service, real Nest
 * transport, real Identity/Catalog/service-client adapters over local stubs)
 * answers exactly what the PUBLISHED @carwash/contracts parsers accept:
 * pricing.v1 QuoteV1, QuoteValidationV1, PublishPriceBookRequestV1, the shared
 * ApiErrorEnvelope and the route table; and the Catalog stub Pricing is tested
 * against serves a body the published catalog.v1 parser accepts.
 *
 * Pricing cannot depend on @carwash/contracts yet (the lockfile is Lane E's),
 * so its local restatement is kept honest here: drift fails this suite.
 * Persistence is the in-memory test double; PostgreSQL behaviour is proven by
 * scripts/production/B/postgres-acceptance.mjs --service pricing.
 *
 * Requires: pnpm run build:packages and pnpm --filter @carwash/pricing run build:tests.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

function load(...parts) {
  const file = path.join(ROOT, ...parts);
  if (!existsSync(file)) throw new Error(`Missing ${file}; build packages and pricing tests first`);
  return require(file);
}

const contracts = (rel) => load('packages', 'contracts', 'dist', rel);
const pricingContract = contracts('pricing/v1.js');
const catalogContract = contracts('catalog/v1.js');
const { parseApiErrorEnvelope } = contracts('common/errors.js');
const { CURRENCIES } = contracts('common/money.js');
const { VEHICLE_TYPES } = contracts('common/vehicle-type.js');
const { PRINCIPAL_KINDS, RESOLVE_PURPOSES } = contracts('common/principal.js');
const { contractProblems } = contracts('common/route.js');

const pricingTests = (...rel) => load('services', 'pricing', 'dist-tests', ...rel);
const { startPricingHttp, TOKENS, SERVICE } = pricingTests(
  'test',
  'support',
  'pricing-http-harness.js',
);
const { InMemoryPricingRepository } = pricingTests(
  'test',
  'support',
  'in-memory-pricing.repository.js',
);
const fixtures = pricingTests('test', 'support', 'pricing-fixtures.js');
const domain = pricingTests('src', 'domain', 'index.js');
const service = pricingTests('src', 'application', 'pricing.service.js');
const controller = pricingTests('src', 'transport', 'http', 'pricing.controller.js');

const PATH = pricingContract.PRICING_V1.prefix;
let http;
let clock;
let seq = 0;
const key = () => `conformance-key-${String(++seq).padStart(8, '0')}`;

before(async () => {
  clock = new fixtures.FixedClock(new Date('2026-10-11T10:00:00.000Z'));
  http = await startPricingHttp({
    repository: new InMemoryPricingRepository(),
    policy: new fixtures.FixedPolicy(),
    clock,
  });
});

after(async () => {
  await http.close();
});

test('route table: Pricing serves exactly the pricing.v1 routes and access rules', () => {
  const { PRICING_V1 } = pricingContract;
  assert.deepEqual(contractProblems(PRICING_V1), []);
  assert.equal(`/${controller.PRICING_V1_PREFIX}`, PRICING_V1.prefix);
  const { Reflect: R } = globalThis;
  const proto = controller.PricingController.prototype;
  const served = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && R.getMetadata('path', proto[name]) !== undefined)
    .map((name) => {
      const method = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][
        R.getMetadata('method', proto[name])
      ];
      return `${method} /${R.getMetadata('path', proto[name])}`;
    })
    .sort();
  const published = Object.values(PRICING_V1.routes)
    .map((r) => `${r.method} ${r.path.replace(/^\//, '/')}`)
    .sort();
  assert.deepEqual(served, published);
  assert.equal(
    PRICING_V1.routes.publishPriceBook.access,
    `permission:${service.PRICE_BOOK_PERMISSION}`,
  );
  assert.equal(PRICING_V1.routes.validateQuote.access, 'service:pricing.quote.validate');
});

test('local mirrors equal the published vocabularies', () => {
  assert.deepEqual({ ...domain.CONTRACT_CURRENCY_SCALES }, { ...CURRENCIES });
  assert.deepEqual([...domain.VEHICLE_TYPES], [...VEHICLE_TYPES]);
  assert.deepEqual([...domain.PRINCIPAL_KINDS], [...PRINCIPAL_KINDS]);
  assert.deepEqual([...service.RESOLVE_PURPOSES], [...RESOLVE_PURPOSES]);
  assert.deepEqual([...domain.DEFINITION_KINDS], [...catalogContract.DEFINITION_KINDS]);
});

test('fixtures: the Catalog stub body and the price book request are valid published documents', () => {
  const catalog = catalogContract.parseCatalogV1(fixtures.catalogBody());
  assert.equal(catalog.items.length, 4);
  const request = pricingContract.parsePublishPriceBookRequestV1(fixtures.priceBookRequest(1));
  assert.equal(request.entries.length, 4);
  pricingContract.parseQuoteRequestV1(fixtures.quoteRequest());
});

test('real responses: QuoteV1, QuoteValidationV1 and error envelopes parse with the published parsers', async () => {
  const published = await http.request('POST', `${PATH}/price-books`, {
    token: TOKENS.admin,
    key: key(),
    body: fixtures.priceBookRequest(1),
  });
  assert.equal(published.status, 201, JSON.stringify(published.body));

  const created = await http.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: key(),
    body: fixtures.quoteRequest({ zoneId: '66666666-6666-4666-8666-666666666666' }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const quote = pricingContract.parseQuoteV1(created.body);
  assert.equal(quote.total.amountMinor, '800000');
  assert.equal(quote.status, 'USABLE');

  const read = await http.request('GET', `${PATH}/quotes/${quote.quoteId}`, {
    token: TOKENS.customer,
  });
  assert.deepEqual(pricingContract.parseQuoteV1(read.body), quote);

  const validation = await http.request('POST', `${PATH}/quotes/${quote.quoteId}/validate`, {
    service: SERVICE.booking,
    body: {
      expectedRevision: quote.revision,
      beneficiary: quote.beneficiary,
      purpose: 'booking-create',
    },
  });
  assert.equal(validation.status, 200);
  const valid = pricingContract.parseQuoteValidationV1(validation.body);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.total, quote.total);

  clock.advance(15 * 60_000);
  const expired = await http.request('POST', `${PATH}/quotes/${quote.quoteId}/validate`, {
    service: SERVICE.booking,
    body: {
      expectedRevision: quote.revision,
      beneficiary: quote.beneficiary,
      purpose: 'booking-create',
    },
  });
  const refusal = pricingContract.parseQuoteValidationV1(expired.body);
  assert.equal(refusal.reason, 'QUOTE_EXPIRED');
  assert.ok(pricingContract.QUOTE_VALIDATION_REASONS.includes(refusal.reason));

  const errors = [
    await http.request('GET', `${PATH}/quotes/${quote.quoteId}`),
    await http.request('GET', `${PATH}/quotes/${quote.quoteId}`, { token: TOKENS.otherCustomer }),
    await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      body: fixtures.quoteRequest(),
    }),
    await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: key(),
      body: fixtures.quoteRequest({ vehicleType: 'pickup' }),
    }),
    await http.request('POST', `${PATH}/price-books`, {
      token: TOKENS.admin,
      key: key(),
      body: fixtures.priceBookRequest(1),
    }),
  ];
  assert.deepEqual(
    errors.map((e) => e.status),
    [401, 404, 428, 422, 412],
  );
  for (const error of errors) {
    const envelope = parseApiErrorEnvelope(error.body);
    if (envelope.error.reason !== null)
      assert.ok(
        pricingContract.PRICING_V1.reasons.includes(envelope.error.reason),
        envelope.error.reason,
      );
  }
  assert.equal(parseApiErrorEnvelope(errors[3].body).error.reason, 'SELECTION_INVALID');
});
