import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FakeCatalogReader,
  FixedClock,
  FixedPolicy,
  ratesFixture,
  snapshotFixture,
  TEST_POLICY,
} from './support/pricing-fixtures';
import { InMemoryPricingRepository } from './support/in-memory-pricing.repository';
import { TOKENS, startPricingHttp } from './support/pricing-http-harness';

/*
 * Real HTTP transport + application + Identity adapter. Persistence is an
 * in-memory TEST DOUBLE and the Catalog reader is a fake; PostgreSQL behaviour
 * is proven by the integration suite.
 */
const T0 = new Date('2026-10-07T10:00:00.000Z');
const PATH = '/internal/v1/pricing';
let seq = 0;
const key = () => `pricing-key-${String(++seq).padStart(8, '0')}`;
const publishBody = (
  expectedVersion = 0,
  effectiveFrom: string | null = null,
  catalogRevision = 1,
) => ({
  expectedVersion,
  effectiveFrom,
  catalogRevision,
  rates: ratesFixture(),
});
const selection = (overrides: Record<string, unknown> = {}) => ({
  catalogRevision: 1,
  categoryId: 'suv',
  packageId: 'exterior',
  addonIds: ['tyre-shine'],
  ...overrides,
});

async function harness(policy = new FixedPolicy()) {
  const repository = new InMemoryPricingRepository();
  const catalog = new FakeCatalogReader();
  catalog.snapshots.set(1, snapshotFixture(1));
  catalog.snapshots.set(2, snapshotFixture(2, new Date(T0.getTime() + 3_600_000)));
  const clock = new FixedClock(T0);
  const http = await startPricingHttp({ repository, catalog, policy, clock });
  return { repository, catalog, clock, policy, http };
}

async function published() {
  const h = await harness();
  const response = await h.http.request('POST', `${PATH}/prices`, {
    token: TOKENS.admin,
    key: key(),
    body: publishBody(),
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return h;
}

test('pricing http: authentication and permissions are enforced server-side', async () => {
  const { http, repository } = await harness();
  try {
    assert.equal((await http.request('GET', `${PATH}/prices`)).status, 401);
    assert.equal(
      (await http.request('GET', `${PATH}/prices`, { token: TOKENS.unknown })).status,
      401,
    );
    const customerPublish = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.customer,
      key: key(),
      body: publishBody(),
    });
    assert.equal(customerPublish.status, 403);
    // The admin token has pricing.publish but not bookings.create:self.
    const adminQuote = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.admin,
      key: key(),
      body: selection(),
    });
    assert.equal(adminQuote.status, 403);
    assert.equal(repository.receipts.size, 0);
    http.identity.mode = 'error-500';
    assert.equal(
      (await http.request('GET', `${PATH}/prices`, { token: TOKENS.customer })).status,
      503,
    );
  } finally {
    await http.close();
  }
});

test('pricing http: missing policy and unavailable catalog fail closed without effects', async () => {
  const noPolicy = await harness(new FixedPolicy(null, null));
  try {
    const response = await noPolicy.http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: key(),
      body: publishBody(),
    });
    assert.equal(response.status, 503);
    assert.equal((response.body.error as { code: string }).code, 'POLICY_UNAVAILABLE');
  } finally {
    await noPolicy.http.close();
  }
  const { http, catalog, repository } = await harness();
  try {
    catalog.down = true;
    const down = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: key(),
      body: publishBody(),
    });
    assert.equal(down.status, 503);
    assert.equal((down.body.error as { code: string }).code, 'UPSTREAM_UNAVAILABLE');
    catalog.down = false;
    const unknown = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: key(),
      body: publishBody(0, null, 9),
    });
    assert.equal(unknown.status, 422);
    assert.equal(repository.versions.length, 0);
    assert.equal(repository.receipts.size, 0);
    const noPrices = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: key(),
      body: selection(),
    });
    assert.equal(noPrices.status, 503);
    assert.equal((noPrices.body.error as { code: string }).code, 'PRICES_NOT_PUBLISHED');
  } finally {
    await http.close();
  }
});

test('pricing http: rate validation against the exact catalog revision', async () => {
  const { http } = await harness();
  try {
    const missing = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: key(),
      body: { ...publishBody(), rates: ratesFixture().slice(1) },
    });
    assert.equal(missing.status, 422);
    assert.equal((missing.body.error as { code: string }).code, 'RATES_INVALID');
    const floatAmount = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: key(),
      body: {
        ...publishBody(),
        rates: [{ kind: 'PACKAGE', definitionId: 'exterior', amountMinor: 500.5 }],
      },
    });
    assert.equal(floatAmount.status, 400);
  } finally {
    await http.close();
  }
});

test('pricing http: publish, replay and conflicts', async () => {
  const { http, repository } = await harness();
  try {
    const k = key();
    const first = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: k,
      body: publishBody(),
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.version, 1);
    assert.equal(first.body.currency, 'XTS');
    assert.equal(first.body.minorUnitExponent, 2);
    const replay = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: k,
      body: publishBody(),
    });
    assert.deepEqual(replay.body, first.body);
    assert.equal(replay.headers.get('idempotency-replayed'), 'true');
    const conflict = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: k,
      body: publishBody(1),
    });
    assert.equal(conflict.status, 409);
    assert.equal((conflict.body.error as { code: string }).code, 'IDEMPOTENCY_CONFLICT');
    const stale = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: key(),
      body: publishBody(0),
    });
    assert.equal(stale.status, 409);
    assert.equal((stale.body.error as { code: string }).code, 'VERSION_CONFLICT');
    // Prices for catalog revision 2 cannot start before revision 2 does.
    const early = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: key(),
      body: publishBody(1, new Date(T0.getTime() + 60_000).toISOString(), 2),
    });
    assert.equal(early.status, 422);
    assert.equal((early.body.error as { code: string }).code, 'PRICE_PRECEDES_CATALOG');
    assert.equal(repository.versions.length, 1);
    const list = await http.request('GET', `${PATH}/price-versions`, { token: TOKENS.admin });
    assert.equal((list.body.versions as unknown[]).length, 1);
    const prices = await http.request('GET', `${PATH}/prices`, { token: TOKENS.customer });
    assert.equal(prices.status, 200);
    assert.deepEqual((prices.body.rates as { amountMinor: string }[])[0], {
      kind: 'PACKAGE',
      definitionId: 'exterior',
      amountMinor: '50000',
    });
  } finally {
    await http.close();
  }
});

test('pricing http: quote is server-computed, immutable, owned and replayable', async () => {
  const { http, clock } = await published();
  try {
    const clientTotal = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: key(),
      body: { ...selection(), total: { amountMinor: '1', currency: 'XTS' } },
    });
    assert.equal(clientTotal.status, 400, 'client money fields are rejected, never trusted');

    const k = key();
    const quote = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: k,
      body: selection(),
    });
    assert.equal(quote.status, 201, JSON.stringify(quote.body));
    assert.equal(quote.body.status, 'USABLE');
    assert.deepEqual(quote.body.total, { amountMinor: '85000', currency: 'XTS' });
    assert.equal(quote.body.expiresAt, '2026-10-07T10:15:00.000Z');
    assert.equal((quote.body.lines as unknown[]).length, 3);
    const id = quote.body.quoteId as string;

    clock.advance(20 * 60_000);
    const replay = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: k,
      body: selection(),
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.body.quoteId, id, 'replay returns the original quote');
    assert.equal(replay.body.expiresAt, quote.body.expiresAt, 'replay never extends validity');
    assert.equal(replay.body.status, 'EXPIRED');

    const read = await http.request('GET', `${PATH}/quotes/${id}`, { token: TOKENS.customer });
    assert.equal(read.status, 200);
    assert.equal(read.body.status, 'EXPIRED');
    assert.equal(
      (await http.request('GET', `${PATH}/quotes/${id}`, { token: TOKENS.otherCustomer })).status,
      404,
    );
    assert.equal(
      (await http.request('GET', `${PATH}/quotes/not-a-uuid`, { token: TOKENS.customer })).status,
      404,
    );

    const expired = await http.request('POST', `${PATH}/quotes/${id}/validate`, {
      token: TOKENS.customer,
      body: selection(),
    });
    assert.equal(expired.status, 409);
    assert.equal((expired.body.error as { code: string }).code, 'QUOTE_EXPIRED');
  } finally {
    await http.close();
  }
});

test('pricing http: validation binds the quote to the exact selection and owner', async () => {
  const { http } = await published();
  try {
    const quote = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: key(),
      body: selection(),
    });
    const id = quote.body.quoteId as string;
    const ok = await http.request('POST', `${PATH}/quotes/${id}/validate`, {
      token: TOKENS.customer,
      body: selection(),
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'USABLE');
    const changed = await http.request('POST', `${PATH}/quotes/${id}/validate`, {
      token: TOKENS.customer,
      body: selection({ addonIds: [] }),
    });
    assert.equal(changed.status, 409);
    assert.equal((changed.body.error as { code: string }).code, 'QUOTE_SELECTION_MISMATCH');
    const other = await http.request('POST', `${PATH}/quotes/${id}/validate`, {
      token: TOKENS.otherCustomer,
      body: selection(),
    });
    assert.equal(other.status, 404);
  } finally {
    await http.close();
  }
});

test('pricing http: catalog revision mismatch and incompatible selection are durable rejections', async () => {
  const { http } = await published();
  try {
    const k = key();
    const mismatch = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: k,
      body: selection({ catalogRevision: 2 }),
    });
    assert.equal(mismatch.status, 409);
    assert.equal((mismatch.body.error as { code: string }).code, 'CATALOG_REVISION_MISMATCH');
    const again = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: k,
      body: selection({ catalogRevision: 2 }),
    });
    assert.equal(again.status, 409);
    assert.equal(again.headers.get('idempotency-replayed'), 'true');
    const invalid = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: key(),
      body: selection({ addonIds: ['interior-fresh'] }),
    });
    assert.equal(invalid.status, 422);
    assert.equal((invalid.body.error as { code: string }).code, 'SELECTION_INVALID');
  } finally {
    await http.close();
  }
});

test('pricing http: policy changed after publication blocks quoting until republished', async () => {
  const { http, policy } = await published();
  try {
    policy.policy = { ...TEST_POLICY, revision: 'test-policy-2' };
    const response = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: key(),
      body: selection(),
    });
    assert.equal(response.status, 503);
    assert.equal((response.body.error as { code: string }).code, 'POLICY_UNAVAILABLE');
  } finally {
    await http.close();
  }
});

test('pricing http: a quote never outlives a scheduled price change', async () => {
  const { http } = await published();
  try {
    const at = new Date(T0.getTime() + 5 * 60_000).toISOString();
    const next = await http.request('POST', `${PATH}/prices`, {
      token: TOKENS.admin,
      key: key(),
      body: publishBody(1, at),
    });
    assert.equal(next.status, 201);
    const quote = await http.request('POST', `${PATH}/quotes`, {
      token: TOKENS.customer,
      key: key(),
      body: selection(),
    });
    assert.equal(quote.body.expiresAt, at);
    assert.equal(quote.body.priceVersion, 1);
  } finally {
    await http.close();
  }
});

test('pricing http: concurrent same-key quote requests produce one quote', async () => {
  const { http, repository } = await published();
  try {
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        http.request('POST', `${PATH}/quotes`, {
          token: TOKENS.customer,
          key: k,
          body: selection(),
        }),
      ),
    );
    assert.ok(results.every((r) => r.status === 201));
    assert.equal(new Set(results.map((r) => r.body.quoteId)).size, 1);
    assert.equal(repository.quotes.size, 1);
  } finally {
    await http.close();
  }
});
