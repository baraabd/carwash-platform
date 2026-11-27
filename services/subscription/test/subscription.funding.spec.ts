import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Money } from '../src/domain';
import {
  BillingFundingAuthority,
  billingFundingConfigFromEnv,
} from '../src/infrastructure/billing/billing-funding.authority';

const input = {
  obligationId: randomUUID(),
  customerSubject: randomUUID(),
  quoteId: randomUUID(),
  amount: Money.parse({ currency: 'SYP', amountMinor: '500000', scale: 2 }),
  correlationId: randomUUID(),
};
const config = {
  origin: new URL('https://billing.example.test'),
  clientId: 'subscription',
  token: 'test-funding-token-12345678901234567890',
  timeoutMs: 500,
};
const proof = () => ({
  verified: true,
  obligationId: input.obligationId,
  revision: 3,
  beneficiary: { kind: 'account', subjectId: input.customerSubject },
  amount: input.amount.toWire(),
  quoteId: input.quoteId,
});

test('funding authority uses workload-only credentials and validates quote/customer/exact-money binding', async () => {
  const requests: RequestInit[] = [];
  let answer: unknown = proof();
  const authority = new BillingFundingAuthority(config, (url, request) => {
    assert.ok(url instanceof URL);
    assert.equal(
      url.href,
      'https://billing.example.test/internal/v1/billing/subscription-funding/verify',
    );
    requests.push(request ?? {});
    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
  });
  assert.equal(await authority.verify(input), 'VERIFIED');
  const headers = new Headers(requests[0]!.headers);
  assert.equal(headers.get('authorization'), null);
  assert.equal(headers.get('cookie'), null);
  assert.equal(headers.get('x-service-client'), 'subscription');
  assert.equal(headers.get('x-service-token'), config.token);
  assert.equal(requests[0]!.redirect, 'error');
  const requestBody = requests[0]!.body;
  assert.ok(typeof requestBody === 'string');
  assert.deepEqual(JSON.parse(requestBody), {
    obligationId: input.obligationId,
    beneficiary: { kind: 'account', subjectId: input.customerSubject },
    amount: input.amount.toWire(),
  });
  for (const invalid of [
    { ...proof(), obligationId: randomUUID() },
    { ...proof(), quoteId: randomUUID() },
    { ...proof(), beneficiary: { kind: 'guest', subjectId: input.customerSubject } },
    { ...proof(), beneficiary: { kind: 'account', subjectId: randomUUID() } },
    { ...proof(), amount: { currency: 'USD', amountMinor: '500000', scale: 2 } },
    { ...proof(), amount: { currency: 'SYP', amountMinor: '500001', scale: 2 } },
    { ...proof(), amount: { currency: 'SYP', amountMinor: '500000', scale: 0 } },
    { ...proof(), revision: 0 },
    { verified: true },
  ]) {
    answer = invalid;
    assert.equal(await authority.verify(input), 'UNAVAILABLE');
  }
  answer = { verified: false, reason: 'PAYMENT_NOT_VERIFIED' };
  assert.equal(await authority.verify(input), 'NOT_VERIFIED');
});

test('funding authority fails closed on missing configuration, oversized/unreadable/non-200 responses', async () => {
  let touched = false;
  const absent = new BillingFundingAuthority({ ...config, token: undefined }, () => {
    touched = true;
    return Promise.resolve(new Response('{}'));
  });
  assert.equal(await absent.verify(input), 'UNAVAILABLE');
  assert.equal(touched, false);
  for (const make of [
    () => new Response(JSON.stringify(proof()), { status: 201 }),
    () => new Response(JSON.stringify(proof()), { status: 500 }),
    () => new Response('not json'),
    () => new Response('x'.repeat(17000)),
  ])
    assert.equal(
      await new BillingFundingAuthority(config, () => Promise.resolve(make())).verify(input),
      'UNAVAILABLE',
    );
  assert.equal(
    await new BillingFundingAuthority(config, () => Promise.reject(new Error('network'))).verify(
      input,
    ),
    'UNAVAILABLE',
  );
});

test('funding configuration rejects origins containing credentials/paths and invalid timeouts', () => {
  for (const origin of [
    'http://public.example.test',
    'https://user:pass@example.test',
    'https://example.test/path',
  ])
    assert.throws(() => billingFundingConfigFromEnv({ SUBSCRIPTION_BILLING_ORIGIN: origin }));
  for (const timeout of ['0', '6000', 'NaN'])
    assert.throws(() => billingFundingConfigFromEnv({ SUBSCRIPTION_BILLING_TIMEOUT_MS: timeout }));
  assert.equal(
    billingFundingConfigFromEnv({ SUBSCRIPTION_BILLING_ORIGIN: 'http://127.0.0.1:1234' }).origin
      ?.port,
    '1234',
  );
});
