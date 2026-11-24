import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PricingQuoteHttpReader,
  pricingReaderConfigFromEnv,
} from '../../src/infrastructure/pricing/pricing-quote-http.reader';
import { PricingUnavailable } from '../../src/ports';
import { DeclaredQuotes } from '../support/quotes';

const registry = new DeclaredQuotes();
const input = registry.register({
  beneficiary: { kind: 'guest' as const, subjectId: randomUUID() },
  zoneId: randomUUID(),
  startsAt: new Date(Date.now() + 3_600_000),
  durationMinutes: 45,
  quoteRef: { quoteId: randomUUID(), revision: 1 },
});
const wire = registry.wire(input.quoteRef.quoteId)!;
const bearer = `Bearer ${'acceptance-token'.repeat(3)}`;
const correlationId = randomUUID();
const config = { origin: new URL('https://pricing.example'), timeoutMs: 50 };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('Pricing reader sends only the validated bearer to its configured exact owner route and parses the published contract', async () => {
  let calls = 0;
  const reader = new PricingQuoteHttpReader(config, (url, options) => {
    calls += 1;
    assert.ok(url instanceof URL);
    assert.equal(
      url.href,
      `https://pricing.example/internal/v1/pricing/quotes/${input.quoteRef.quoteId}`,
    );
    assert.equal(options?.method, 'GET');
    assert.equal(options?.redirect, 'error');
    assert.deepEqual(options?.headers, {
      accept: 'application/json',
      authorization: bearer,
      'x-correlation-id': correlationId,
    });
    assert.ok(options?.signal);
    return Promise.resolve(json(wire));
  });
  assert.deepEqual(
    await reader.read(input.quoteRef.quoteId, bearer, correlationId),
    registry.quotes.get(input.quoteRef.quoteId),
  );
  assert.equal(calls, 1);
});

test('missing configuration, invalid credentials and path-shaped identifiers never make a request', async () => {
  const fetcher: typeof fetch = () => {
    assert.fail('must not request');
  };
  for (const [origin, credential, id] of [
    [null, bearer, input.quoteRef.quoteId],
    [config.origin, undefined, input.quoteRef.quoteId],
    [config.origin, 'Basic secret', input.quoteRef.quoteId],
    [config.origin, bearer, '../../another-origin'],
  ] as const) {
    await assert.rejects(
      new PricingQuoteHttpReader({ ...config, origin }, fetcher).read(
        id,
        credential,
        correlationId,
      ),
      PricingUnavailable,
    );
  }
});

test('malformed, redirected, mismatched, oversized and invalid-UTF8 responses never authorize a hold', async () => {
  const missing = { ...wire };
  delete missing.durationMinutes;
  const responses = [
    () => json({}, 302),
    () => json({}, 503),
    () => new Response(JSON.stringify(wire), { headers: { 'content-type': 'text/plain' } }),
    () =>
      new Response(JSON.stringify(wire), { headers: { 'content-type': 'application/json-extra' } }),
    () => json(missing),
    () => json({ ...wire, durationMinutes: 45.5 }),
    () => json({ ...wire, quoteId: randomUUID() }),
    () => json({ ...wire, inventedField: true }),
    () => json({ ...wire, total: { currency: 'SYP', amountMinor: '1', scale: 2 } }),
    () =>
      new Response(Buffer.from([0xff, 0xfe]), { headers: { 'content-type': 'application/json' } }),
    () => new Response('x'.repeat(65_537), { headers: { 'content-type': 'application/json' } }),
    () =>
      new Response('{}', {
        headers: { 'content-type': 'application/json', 'content-length': '65537' },
      }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  ];
  for (const response of responses) {
    await assert.rejects(
      new PricingQuoteHttpReader(config, () => Promise.resolve(response())).read(
        input.quoteRef.quoteId,
        bearer,
        correlationId,
      ),
      (error: unknown) =>
        error instanceof PricingUnavailable && error.message === 'PRICING_UNAVAILABLE',
    );
  }
});

test('not-found and denied owner records stay unusable without exposing the upstream body', async () => {
  for (const status of [401, 403, 404]) {
    const reader = new PricingQuoteHttpReader(config, () =>
      Promise.resolve(json({ secret: 'must-not-escape' }, status)),
    );
    assert.equal(await reader.read(input.quoteRef.quoteId, bearer, correlationId), null);
  }
});

test('bounded upstream deadline aborts before a slow response can authorize capacity', async () => {
  const reader = new PricingQuoteHttpReader(
    config,
    async (_url, options) =>
      new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('deadline did not abort')), 500);
        options?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('sensitive upstream failure'));
          },
          { once: true },
        );
      }),
  );
  await assert.rejects(
    reader.read(input.quoteRef.quoteId, bearer, correlationId),
    PricingUnavailable,
  );
});

test('owner configuration is HTTPS or explicit loopback, without embedded secrets/path/query/fragment', () => {
  assert.equal(pricingReaderConfigFromEnv({}).origin, null);
  assert.equal(
    pricingReaderConfigFromEnv({ PRICING_ORIGIN: 'http://127.0.0.1:1234' }).origin!.origin,
    'http://127.0.0.1:1234',
  );
  for (const origin of [
    'http://pricing.example',
    'https://user:pass@pricing.example',
    'https://pricing.example/path',
    'https://pricing.example?redirect=x',
    'https://pricing.example#fragment',
  ]) {
    assert.throws(() => pricingReaderConfigFromEnv({ PRICING_ORIGIN: origin }));
  }
  for (const timeout of ['99', '10001', '1.5', 'NaN', ''])
    assert.throws(() => pricingReaderConfigFromEnv({ PRICING_TIMEOUT_MS: timeout }));
});
