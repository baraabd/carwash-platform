import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { type pricingV1, subscriptionV1 } from '@carwash/contracts';
import { SubscriptionQuoteService } from '../src/application/subscription-quote.service';
import { PricingApplicationError } from '../src/application/pricing-errors';
import type { SubscriptionQuoteStore } from '../src/ports/subscription-quote.ports';
import { RandomIds, Sha256Hasher } from '../src/infrastructure/system/system.adapters';
import { CUSTOMER, FixedClock, FixedPolicy } from './support/pricing-fixtures';

function fixture() {
  const clock = new FixedClock(new Date('2026-11-27T09:00:00.000Z'));
  const policy = new FixedPolicy();
  const plan = subscriptionV1.parsePlanV1({
    planId: randomUUID(),
    version: 1,
    status: 'PUBLISHED',
    name: 'Four prepaid washes',
    units: 4,
    validityDays: 30,
    price: { currency: 'SYP', amountMinor: '600000', scale: 2 },
    packageIds: [randomUUID()],
    vehicleTypes: ['sedan'],
    publishedAt: clock.now().toISOString(),
    contentHash: 'a'.repeat(64),
  });
  const rows = new Map<string, pricingV1.SubscriptionQuoteV1>();
  const receipts = new Map<string, { fingerprint: string; quote: pricingV1.SubscriptionQuoteV1 }>();
  const store: SubscriptionQuoteStore = {
    receipt: (actor, key) => Promise.resolve(receipts.get(`${actor}:${key}`) ?? null),
    get: (id) => Promise.resolve(rows.get(id) ?? null),
    create: (actor, key, fingerprint, quote) => {
      const prior = receipts.get(`${actor}:${key}`);
      if (prior) return Promise.resolve({ ...prior, replayed: true });
      rows.set(quote.quoteId, quote);
      const receipt = { fingerprint, quote };
      receipts.set(`${actor}:${key}`, receipt);
      return Promise.resolve({ ...receipt, replayed: false });
    },
  };
  let unavailable = false;
  let foreign = false;
  let guest = false;
  const service = new SubscriptionQuoteService({
    store,
    clock,
    policy,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
    authority: {
      verify: () =>
        Promise.resolve({
          subject: foreign ? randomUUID() : CUSTOMER.subjectId,
          sessionId: randomUUID(),
          kind: guest ? 'guest' : 'account',
          permissions: ['bookings.create:self'],
        }),
    },
    plans: {
      read: () => {
        if (unavailable) throw new Error('owner down');
        return Promise.resolve(plan);
      },
    },
  });
  return {
    clock,
    policy,
    plan,
    service,
    rows,
    setUnavailable: () => {
      unavailable = true;
    },
    setForeign: () => {
      foreign = true;
    },
    setGuest: () => {
      guest = true;
    },
  };
}
const context = {
  credential: 'Bearer test-customer-credential-123456',
  correlationId: randomUUID(),
};
const key = () => randomUUID().replaceAll('-', '');

test('plan quote uses published owner price and immutable replay survives owner outage/expiry', async () => {
  const h = fixture();
  const k = key();
  const body = { planId: h.plan.planId, planVersion: 1 };
  const created = await h.service.create(context, k, body);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.total, h.plan.price);
  assert.deepEqual(created.body.beneficiary, CUSTOMER);
  assert.equal(created.body.planContentHash, h.plan.contentHash);
  h.setUnavailable();
  h.clock.advance(900001);
  const replay = await h.service.create(context, k, body);
  assert.equal(replay.replayed, true);
  assert.equal(replay.body.status, 'EXPIRED');
  assert.equal(replay.body.quoteId, created.body.quoteId);
  assert.equal(replay.body.expiresAt, created.body.expiresAt);
  assert.equal(h.rows.size, 1);
  await assert.rejects(
    h.service.create(context, k, { ...body, planVersion: 2 }),
    (error: unknown) =>
      error instanceof PricingApplicationError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('plan quote refuses client money, stale plans, missing policy, guests and foreign reads', async () => {
  const h = fixture();
  const body = { planId: h.plan.planId, planVersion: 1 };
  await assert.rejects(h.service.create(context, key(), { ...body, total: h.plan.price }));
  await assert.rejects(h.service.create(context, key(), { ...body, planVersion: 2 }));
  h.policy.ttl = null;
  await assert.rejects(h.service.create(context, key(), body));
  assert.equal(h.rows.size, 0);
  h.policy.ttl = 900;
  const created = await h.service.create(context, key(), body);
  h.setForeign();
  await assert.rejects(
    h.service.get(context, created.body.quoteId),
    (error: unknown) => error instanceof PricingApplicationError && error.code === 'NOT_FOUND',
  );
  h.setGuest();
  await assert.rejects(
    h.service.create(context, key(), body),
    (error: unknown) => error instanceof PricingApplicationError && error.code === 'AUTH_FORBIDDEN',
  );
});
