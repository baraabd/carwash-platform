import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PromotionRuleError,
  capCheck,
  discountFor,
  evaluatePromotion,
  nextRedemptionStatus,
  normalizeCouponCode,
  normalizePromotionTerms,
  planPromotionRevision,
  promotionRevisionInForce,
  type PromotionTerms,
} from '../src/domain';
import { redemptionChangedEvent } from '../src/application';

const T0 = new Date('2026-10-11T08:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function termsInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    discount: { kind: 'PERCENT', basisPoints: 1000, maxDiscountMinor: null },
    currency: 'XTS',
    packageIds: ['exterior'],
    minSubtotalMinor: '0',
    endsAt: null,
    totalCap: 10,
    perCustomerCap: 1,
    active: true,
    ...overrides,
  };
}

const terms = (overrides: Record<string, unknown> = {}): PromotionTerms =>
  normalizePromotionTerms(termsInput(overrides), 'XTS');

function rule(code: string) {
  return (error: unknown) => error instanceof PromotionRuleError && error.code === code;
}

test('promotion terms: strict parse, canonical packages, policy currency only', () => {
  assert.deepEqual(terms({ packageIds: ['full-care', 'exterior'] }).packageIds, [
    'exterior',
    'full-care',
  ]);
  const bad = (overrides: Record<string, unknown>, code = 'PROMOTION_TERMS_MALFORMED') =>
    assert.throws(() => normalizePromotionTerms(termsInput(overrides), 'XTS'), rule(code));
  bad({ currency: 'SYP' }, 'PROMOTION_CURRENCY_MISMATCH');
  bad({ discount: { kind: 'PERCENT', basisPoints: 0, maxDiscountMinor: null } });
  bad({ discount: { kind: 'PERCENT', basisPoints: 10001, maxDiscountMinor: null } });
  bad({ discount: { kind: 'PERCENT', basisPoints: 100, maxDiscountMinor: '0' } });
  bad({ discount: { kind: 'FIXED', amountMinor: '0' } });
  bad({ discount: { kind: 'FIXED', amountMinor: 5 } });
  bad({ discount: { kind: 'BOGO' } });
  bad({ packageIds: [] });
  bad({ packageIds: ['exterior', 'exterior'] });
  bad({ totalCap: 0 });
  bad({ perCustomerCap: 11 });
  bad({ endsAt: '2026-10-11' });
  bad({ minSubtotalMinor: '-1' });
  bad({ extra: true });
});

test('coupon codes are case-insensitive and strictly shaped', () => {
  assert.equal(normalizeCouponCode(' welcome10 '), 'WELCOME10');
  for (const raw of ['abc', 'WITH SPACE', 'émoji1', 'A'.repeat(33), 42])
    assert.throws(() => normalizeCouponCode(raw), rule('COUPON_CODE_MALFORMED'));
});

test('discount: exact floor of the percentage, capped, never above the subtotal', () => {
  assert.equal(
    discountFor({ kind: 'PERCENT', basisPoints: 1000, maxDiscountMinor: null }, 85_001n),
    8_500n,
  );
  assert.equal(discountFor({ kind: 'PERCENT', basisPoints: 3333, maxDiscountMinor: null }, 3n), 0n);
  assert.equal(
    discountFor({ kind: 'PERCENT', basisPoints: 5000, maxDiscountMinor: 1_000n }, 85_000n),
    1_000n,
  );
  assert.equal(discountFor({ kind: 'FIXED', amountMinor: 10_000n }, 85_000n), 10_000n);
  assert.equal(discountFor({ kind: 'FIXED', amountMinor: 100_000n }, 85_000n), 85_000n);
  // Exact beyond 2^53.
  assert.equal(
    discountFor(
      { kind: 'PERCENT', basisPoints: 1, maxDiscountMinor: null },
      900_000_000_000_000_000n,
    ),
    90_000_000_000_000n,
  );
});

test('eligibility: active, not ended, same currency, eligible package, minimum subtotal', () => {
  const at = new Date(T0.getTime() + DAY);
  const evaluate = (
    t: PromotionTerms | null,
    overrides: { packageId?: string; subtotal?: bigint; currency?: string } = {},
  ) =>
    evaluatePromotion({
      terms: t,
      now: at,
      packageId: overrides.packageId ?? 'exterior',
      subtotalMinor: overrides.subtotal ?? 85_000n,
      currency: overrides.currency ?? 'XTS',
    });
  assert.deepEqual(evaluate(terms()), { eligible: true, discountMinor: 8_500n });
  assert.deepEqual(evaluate(null), { eligible: false, reason: 'PROMOTION_NOT_STARTED' });
  assert.deepEqual(evaluate(terms({ active: false })), {
    eligible: false,
    reason: 'PROMOTION_INACTIVE',
  });
  assert.deepEqual(evaluate(terms({ endsAt: at.toISOString() })), {
    eligible: false,
    reason: 'PROMOTION_ENDED',
  });
  assert.deepEqual(evaluate(terms(), { currency: 'SYP' }), {
    eligible: false,
    reason: 'PROMOTION_CURRENCY_MISMATCH',
  });
  assert.deepEqual(evaluate(terms(), { packageId: 'full-care' }), {
    eligible: false,
    reason: 'PACKAGE_NOT_ELIGIBLE',
  });
  assert.deepEqual(evaluate(terms({ minSubtotalMinor: '90000' })), {
    eligible: false,
    reason: 'SUBTOTAL_TOO_LOW',
  });
  assert.deepEqual(
    evaluate(terms({ discount: { kind: 'PERCENT', basisPoints: 1, maxDiscountMinor: null } }), {
      subtotal: 50n,
    }),
    {
      eligible: false,
      reason: 'SUBTOTAL_TOO_LOW',
    },
  );
});

test('caps: total and per-customer, counted over live (reserved + committed) uses', () => {
  const t = terms({ totalCap: 3, perCustomerCap: 2 });
  assert.equal(capCheck({ terms: t, liveTotal: 2, liveForCustomer: 1 }), null);
  assert.equal(capCheck({ terms: t, liveTotal: 3, liveForCustomer: 0 }), 'PROMOTION_EXHAUSTED');
  assert.equal(capCheck({ terms: t, liveTotal: 2, liveForCustomer: 2 }), 'CUSTOMER_LIMIT_REACHED');
});

test('revisions and redemption transitions', () => {
  assert.deepEqual(
    planPromotionRevision({ head: null, expectedRevision: 0, effectiveFrom: null, now: T0 }),
    {
      accepted: true,
      revision: 1,
      effectiveFrom: T0,
    },
  );
  const head = { revision: 1, effectiveFrom: T0 };
  assert.deepEqual(
    planPromotionRevision({ head, expectedRevision: 0, effectiveFrom: null, now: T0 }),
    {
      accepted: false,
      reason: 'REVISION_CONFLICT',
    },
  );
  assert.deepEqual(
    planPromotionRevision({ head, expectedRevision: 1, effectiveFrom: T0, now: T0 }),
    {
      accepted: false,
      reason: 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS',
    },
  );
  const revisions = [head, { revision: 2, effectiveFrom: new Date(T0.getTime() + DAY) }];
  assert.equal(promotionRevisionInForce(revisions, new Date(T0.getTime() - 1)), null);
  assert.equal(promotionRevisionInForce(revisions, new Date(T0.getTime() + DAY))?.revision, 2);
  assert.equal(nextRedemptionStatus('RESERVED', 'COMMIT'), 'COMMITTED');
  assert.equal(nextRedemptionStatus('RESERVED', 'RELEASE'), 'RELEASED');
  assert.equal(nextRedemptionStatus('COMMITTED', 'RELEASE'), null);
  assert.equal(nextRedemptionStatus('RELEASED', 'COMMIT'), null);
});

test('redemption events are self-validated and carry no coupon code', () => {
  const base = {
    promotionCode: 'spring-care',
    quoteId: randomUUID(),
    bookingId: randomUUID(),
    discount: { currency: 'XTS', amountMinor: '8500' },
  };
  const context = {
    eventId: randomUUID(),
    occurredAt: T0,
    correlationId: randomUUID(),
    actor: { kind: 'service' as const, id: 'booking' },
    redemptionId: randomUUID(),
    version: 1,
  };
  const reserved = redemptionChangedEvent(
    { ...base, previousStatus: null, status: 'RESERVED', reason: null },
    context,
  );
  assert.equal(reserved.routingKey, 'pricing.promotion-redemption-changed.v1');
  // The coupon (e.g. WELCOME10) is never part of the event; only the promotion code is.
  assert.doesNotMatch(reserved.payload, /coupon|WELCOME10/i);
  redemptionChangedEvent(
    { ...base, previousStatus: 'RESERVED', status: 'RELEASED', reason: 'BOOKING_CANCELLED' },
    { ...context, version: 2 },
  );
  assert.throws(() =>
    redemptionChangedEvent(
      { ...base, previousStatus: 'COMMITTED', status: 'RELEASED', reason: 'BOOKING_CANCELLED' },
      context,
    ),
  );
  assert.throws(() =>
    redemptionChangedEvent(
      { ...base, previousStatus: 'RESERVED', status: 'COMMITTED', reason: 'BOOKING_FAILED' },
      context,
    ),
  );
  assert.throws(() =>
    redemptionChangedEvent(
      { ...base, previousStatus: null, status: 'RESERVED', reason: null },
      { ...context, actor: { kind: 'service', id: 'stranger' } },
    ),
  );
});
