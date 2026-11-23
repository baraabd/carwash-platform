import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AccessDenied, QuoteUnavailable } from '../src/ports';
import {
  IdentitySessionAuthority,
  identityAuthorityConfigFromEnv,
} from '../src/infrastructure/identity/identity-session.authority';
import {
  PricingQuoteReader,
  pricingConfigFromEnv,
} from '../src/infrastructure/pricing/pricing-quote.reader';
import {
  startIdentityStub,
  startPricingStub,
  tokenFor,
  type PricingStub,
  type Stub,
} from './support/upstream-stubs';

/*
 * Production upstream adapters against real local HTTP listeners (test doubles
 * of Identity and Pricing). Proves fail-closed behaviour: outage, timeout,
 * garbage, oversized body and contract-violating values are never a grant or
 * an amount.
 */
const SUBJECT = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const CORRELATION = randomUUID();
let identity: Stub;
let pricing: PricingStub;
let authority: IdentitySessionAuthority;
let reader: PricingQuoteReader;

const denied = (reason: string) => (error: unknown) =>
  error instanceof AccessDenied && error.reason === reason;
const unavailable = (error: unknown) => error instanceof QuoteUnavailable;

before(async () => {
  identity = await startIdentityStub({
    customer: {
      subject: SUBJECT.toUpperCase(),
      kind: 'guest',
      permissions: ['bookings.create:self'],
    },
  });
  pricing = await startPricingStub();
  authority = new IdentitySessionAuthority({ origin: new URL(identity.origin), timeoutMs: 300 });
  reader = new PricingQuoteReader({ origin: new URL(pricing.origin), timeoutMs: 300 });
});

after(async () => {
  await identity.close();
  await pricing.close();
});

test('identity: a current session yields kind, lower-cased subject and permissions', async () => {
  identity.mode = 'normal';
  const principal = await authority.verify(`Bearer ${tokenFor('customer')}`, CORRELATION);
  assert.deepEqual(
    { kind: principal.kind, subject: principal.subject, permissions: principal.permissions },
    { kind: 'guest', subject: SUBJECT, permissions: ['bookings.create:self'] },
  );
  const call = identity.calls.at(-1);
  assert.equal(call?.correlationId, CORRELATION, 'correlation propagates upstream');
});

test('identity: missing/malformed credentials never reach Identity', async () => {
  const before = identity.calls.length;
  for (const credential of [
    undefined,
    '',
    'Basic abc',
    'Bearer not-a-jwt',
    `Bearer ${'a'.repeat(9000)}.b.c`,
  ])
    await assert.rejects(authority.verify(credential, CORRELATION), denied('AUTH_REQUIRED'));
  assert.equal(identity.calls.length, before);
});

test('identity: rejected, failing, hanging, garbage or oversized answers fail closed', async () => {
  await assert.rejects(
    authority.verify(`Bearer ${tokenFor('nobody')}`, CORRELATION),
    denied('AUTH_REQUIRED'),
  );
  for (const mode of ['error-500', 'hang', 'garbage', 'oversized'] as const) {
    identity.mode = mode;
    await assert.rejects(
      authority.verify(`Bearer ${tokenFor('customer')}`, CORRELATION),
      denied('AUTH_UNAVAILABLE'),
      mode,
    );
  }
  identity.mode = 'normal';
  const unconfigured = new IdentitySessionAuthority({ origin: null, timeoutMs: 300 });
  await assert.rejects(
    unconfigured.verify(`Bearer ${tokenFor('customer')}`, CORRELATION),
    denied('AUTH_UNAVAILABLE'),
  );
});

test('identity: a session without a principal kind is not accepted', async () => {
  const fetcher: typeof fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          subject: SUBJECT,
          sessionId: randomUUID(),
          authVersion: 1,
          permissions: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  const strict = new IdentitySessionAuthority(
    { origin: new URL(identity.origin), timeoutMs: 300 },
    fetcher,
  );
  await assert.rejects(
    strict.verify(`Bearer ${tokenFor('customer')}`, CORRELATION),
    denied('AUTH_UNAVAILABLE'),
  );
});

test('pricing: the owner gets the exact pricing.v1 total; others get null (404)', async () => {
  pricing.mode = 'normal';
  const quoteId = randomUUID();
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: '450000000000035001',
  });
  const quote = await reader.read(quoteId, `Bearer ${tokenFor('customer')}`, CORRELATION);
  assert.equal(quote?.total.amountMinor, 450_000_000_000_035_001n);
  assert.equal(quote?.usable, true);
  assert.equal(pricing.calls.at(-1)?.authorization, `Bearer ${tokenFor('customer')}`);
  assert.equal(await reader.read(quoteId, `Bearer ${tokenFor('other')}`, CORRELATION), null);
  assert.equal(
    await reader.read(randomUUID(), `Bearer ${tokenFor('customer')}`, CORRELATION),
    null,
  );
});

test('pricing: expired/revoked quotes are read as not usable', async () => {
  for (const status of ['EXPIRED', 'REVOKED'] as const) {
    const quoteId = randomUUID();
    pricing.quotes.set(quoteId, {
      ownerToken: 'customer',
      status,
      currency: 'USD',
      totalMinor: '100',
    });
    const quote = await reader.read(quoteId, `Bearer ${tokenFor('customer')}`, CORRELATION);
    assert.equal(quote?.usable, false, status);
  }
});

test('pricing: outage, timeout, garbage, oversized and contract violations are QuoteUnavailable', async () => {
  const quoteId = randomUUID();
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: '100',
  });
  for (const mode of ['error-500', 'hang', 'garbage', 'oversized'] as const) {
    pricing.mode = mode;
    await assert.rejects(
      reader.read(quoteId, `Bearer ${tokenFor('customer')}`, CORRELATION),
      unavailable,
      mode,
    );
  }
  pricing.mode = 'normal';
  const wrongScale = randomUUID();
  pricing.quotes.set(wrongScale, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: '100',
    scale: 0,
  });
  await assert.rejects(
    reader.read(wrongScale, `Bearer ${tokenFor('customer')}`, CORRELATION),
    unavailable,
    'a scale Billing does not understand is never rescaled',
  );
  const negative = randomUUID();
  pricing.quotes.set(negative, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: '-5',
  });
  await assert.rejects(
    reader.read(negative, `Bearer ${tokenFor('customer')}`, CORRELATION),
    unavailable,
  );
  await assert.rejects(
    new PricingQuoteReader({ origin: null, timeoutMs: 300 }).read(
      quoteId,
      `Bearer ${tokenFor('customer')}`,
      CORRELATION,
    ),
    unavailable,
  );
});

test('upstream configuration: https required off-loopback, no credentials in URL, bounded timeout', () => {
  assert.equal(pricingConfigFromEnv({}).origin, null);
  assert.equal(identityAuthorityConfigFromEnv({}).origin, null);
  assert.equal(
    pricingConfigFromEnv({ PRICING_ORIGIN: 'https://pricing.internal/' }).origin?.host,
    'pricing.internal',
  );
  assert.throws(
    () => pricingConfigFromEnv({ PRICING_ORIGIN: 'http://pricing.internal/' }),
    /HTTPS_REQUIRED/,
  );
  assert.throws(
    () => pricingConfigFromEnv({ PRICING_ORIGIN: 'https://u:p@pricing.internal/' }),
    /INVALID/,
  );
  assert.throws(
    () => pricingConfigFromEnv({ PRICING_ORIGIN: 'https://pricing.internal/x' }),
    /INVALID/,
  );
  assert.throws(
    () => pricingConfigFromEnv({ PRICING_TIMEOUT_MS: '50' }),
    /PRICING_TIMEOUT_MS_INVALID/,
  );
  assert.throws(
    () => identityAuthorityConfigFromEnv({ IDENTITY_SESSION_TIMEOUT_MS: 'soon' }),
    /IDENTITY_SESSION_TIMEOUT_MS_INVALID/,
  );
});
