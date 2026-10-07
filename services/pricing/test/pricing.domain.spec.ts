import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CurrencyPolicyError,
  Money,
  MoneyError,
  PriceRuleError,
  QuoteRuleError,
  computeQuote,
  normalizeRates,
  normalizeSelection,
  parseCurrencyPolicy,
  planPriceVersion,
  quoteExpiry,
  quoteStatus,
  validateRatesAgainstCatalog,
} from '../src/domain';
import { TEST_POLICY, ratesFixture, snapshotFixture } from './support/pricing-fixtures';

const T0 = new Date('2026-10-07T10:00:00.000Z');

function priceRule(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof PriceRuleError && e.code === code);
}
function quoteRule(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof QuoteRuleError && e.code === code);
}

test('money: canonical minor-unit strings only, exact bigint arithmetic', () => {
  assert.equal(Money.parseMinor('0', 'XTS').amountMinor, 0n);
  for (const bad of ['01', '-1', '1.0', '1e3', ' 1', '', '1234567890123456789', 12])
    assert.throws(() => Money.parseMinor(bad, 'XTS'), MoneyError, String(bad));
  // Beyond 2^53: a float would lose the final digit.
  const big = Money.parseMinor('900719925474099300', 'XTS').plus(Money.parseMinor('7', 'XTS'));
  assert.equal(big.toWire().amountMinor, '900719925474099307');
  assert.throws(() => Money.zero('XTS').plus(Money.zero('SYP')), MoneyError);
  assert.throws(() => Money.of(-1n, 'XTS'), MoneyError);
  assert.throws(() => Money.zero('xts'), MoneyError);
});

test('currency policy: strict, explicit and never defaulted', () => {
  const policy = parseCurrencyPolicy({
    revision: 'p-1',
    currency: 'XTS',
    minorUnitExponent: 2,
    maxAmountMinor: '100000000',
  });
  assert.equal(policy.maxAmountMinor, 100_000_000n);
  for (const bad of [
    null,
    {},
    { revision: 'p-1', currency: 'XTS', minorUnitExponent: 2 },
    { revision: 'p-1', currency: 'XTS', minorUnitExponent: 5, maxAmountMinor: '1' },
    { revision: 'p-1', currency: 'XTS', minorUnitExponent: 2, maxAmountMinor: 100 },
    { revision: 'p-1', currency: 'XTS', minorUnitExponent: 2, maxAmountMinor: '0' },
    { revision: 'p 1', currency: 'XTS', minorUnitExponent: 2, maxAmountMinor: '1' },
    { revision: 'p-1', currency: 'XTS', minorUnitExponent: 2, maxAmountMinor: '1', tax: 0 },
  ])
    assert.throws(() => parseCurrencyPolicy(bad), CurrencyPolicyError);
});

test('rates: strict structure, duplicates, limits and canonical order', () => {
  const rates = normalizeRates(ratesFixture().reverse(), TEST_POLICY);
  assert.deepEqual(
    rates.map((r) => `${r.kind}:${r.definitionId}`),
    [
      'PACKAGE:exterior',
      'PACKAGE:full-care',
      'VEHICLE:sedan',
      'VEHICLE:suv',
      'ADDON:interior-fresh',
      'ADDON:tyre-shine',
    ],
  );
  priceRule(() => normalizeRates([], TEST_POLICY), 'RATES_MALFORMED');
  priceRule(
    () =>
      normalizeRates(
        [{ kind: 'PACKAGE', definitionId: 'exterior', amountMinor: 500 }],
        TEST_POLICY,
      ),
    'RATES_MALFORMED',
  );
  priceRule(
    () => normalizeRates([{ kind: 'TAX', definitionId: 'vat', amountMinor: '1' }], TEST_POLICY),
    'RATES_MALFORMED',
  );
  priceRule(
    () =>
      normalizeRates(
        [{ kind: 'PACKAGE', definitionId: 'exterior', amountMinor: '1', currency: 'XTS' }],
        TEST_POLICY,
      ),
    'RATES_MALFORMED',
  );
  priceRule(
    () => normalizeRates([...ratesFixture(), ratesFixture()[0]], TEST_POLICY),
    'RATE_DUPLICATE',
  );
  priceRule(
    () =>
      normalizeRates([{ kind: 'PACKAGE', definitionId: 'exterior', amountMinor: '101' }], {
        ...TEST_POLICY,
        maxAmountMinor: 100n,
      }),
    'AMOUNT_LIMIT_EXCEEDED',
  );
});

test('rates: complete coverage of the exact catalog revision, nothing defaulted', () => {
  const snapshot = snapshotFixture();
  validateRatesAgainstCatalog(normalizeRates(ratesFixture(), TEST_POLICY), snapshot);
  const missingVehicle = ratesFixture().filter((r) => r.definitionId !== 'suv');
  priceRule(
    () => validateRatesAgainstCatalog(normalizeRates(missingVehicle, TEST_POLICY), snapshot),
    'RATE_MISSING',
  );
  const unknown = [
    ...ratesFixture(),
    { kind: 'PACKAGE', definitionId: 'polish', amountMinor: '1' },
  ];
  priceRule(
    () => validateRatesAgainstCatalog(normalizeRates(unknown, TEST_POLICY), snapshot),
    'RATE_UNKNOWN_DEFINITION',
  );
  // tyre-shine is only INCLUDED in a snapshot where no package offers it as optional.
  const includedOnly = snapshotFixture();
  const packages = includedOnly.packages.map((p) => ({
    ...p,
    optionalAddonIds: p.optionalAddonIds.filter((a) => a !== 'tyre-shine'),
  }));
  priceRule(
    () =>
      validateRatesAgainstCatalog(normalizeRates(ratesFixture(), TEST_POLICY), {
        ...includedOnly,
        packages,
      }),
    'RATE_NOT_CHARGEABLE',
  );
});

test('price version plan: chain, non-overlapping windows and catalog alignment', () => {
  const base = { now: T0, catalogEffectiveFrom: new Date(T0.getTime() - 1) };
  assert.deepEqual(
    planPriceVersion({ ...base, head: null, expectedVersion: 0, effectiveFrom: null }),
    {
      accepted: true,
      version: 1,
      effectiveFrom: T0,
    },
  );
  const head = { version: 1, effectiveFrom: T0 };
  assert.equal(
    planPriceVersion({ ...base, head, expectedVersion: 0, effectiveFrom: null }).accepted,
    false,
  );
  assert.deepEqual(planPriceVersion({ ...base, head, expectedVersion: 1, effectiveFrom: T0 }), {
    accepted: false,
    reason: 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS',
  });
  assert.deepEqual(
    planPriceVersion({
      head: null,
      expectedVersion: 0,
      effectiveFrom: T0,
      now: T0,
      catalogEffectiveFrom: new Date(T0.getTime() + 1),
    }),
    { accepted: false, reason: 'PRICE_PRECEDES_CATALOG' },
  );
  assert.deepEqual(
    planPriceVersion({
      ...base,
      head: null,
      expectedVersion: 0,
      effectiveFrom: new Date(T0.getTime() - 1),
    }),
    { accepted: false, reason: 'EFFECTIVE_FROM_IN_PAST' },
  );
});

test('selection: IDs only, duplicates and unknown fields rejected, add-ons sorted', () => {
  assert.deepEqual(
    normalizeSelection({
      catalogRevision: 1,
      categoryId: 'sedan',
      packageId: 'exterior',
      addonIds: ['tyre-shine', 'interior-fresh'],
    }).addonIds,
    ['interior-fresh', 'tyre-shine'],
  );
  const base = { catalogRevision: 1, categoryId: 'sedan', packageId: 'exterior', addonIds: [] };
  quoteRule(() => normalizeSelection({ ...base, totalMinor: '1' }), 'SELECTION_MALFORMED');
  quoteRule(
    () => normalizeSelection({ ...base, addonIds: ['tyre-shine', 'tyre-shine'] }),
    'SELECTION_MALFORMED',
  );
  quoteRule(() => normalizeSelection({ ...base, catalogRevision: '1' }), 'SELECTION_MALFORMED');
  quoteRule(() => normalizeSelection({ ...base, catalogRevision: 0 }), 'SELECTION_MALFORMED');
});

function quoteFor(addonIds: string[], categoryId = 'suv', packageId = 'exterior') {
  return computeQuote({
    selection: normalizeSelection({ catalogRevision: 1, categoryId, packageId, addonIds }),
    snapshot: snapshotFixture(),
    rates: normalizeRates(ratesFixture(), TEST_POLICY),
    policy: TEST_POLICY,
  });
}

test('quote: reproducible breakdown with a separate vehicle surcharge', () => {
  const result = quoteFor(['tyre-shine']);
  assert.deepEqual(
    result.lines.map((l) => [l.kind, l.definitionId, l.amountMinor, l.included]),
    [
      ['PACKAGE', 'exterior', 50000n, false],
      ['VEHICLE', 'suv', 20000n, false],
      ['ADDON', 'tyre-shine', 15000n, false],
    ],
  );
  assert.equal(result.subtotalMinor, 85000n);
  assert.equal(result.totalMinor, 85000n);
  assert.equal(result.durationMinutes, 35 + 10 + 10);
  assert.deepEqual(quoteFor(['tyre-shine']), result, 'same input, same result');
});

test('quote: included add-ons are listed at zero and never double-charged', () => {
  const result = quoteFor(['tyre-shine'], 'sedan', 'full-care');
  assert.deepEqual(
    result.lines.map((l) => [l.definitionId, l.amountMinor, l.included]),
    [
      ['full-care', 150000n, false],
      ['sedan', 0n, false],
      ['tyre-shine', 0n, true],
    ],
  );
  assert.equal(result.totalMinor, 150000n);
  assert.equal(result.durationMinutes, 95, 'package duration already covers included add-ons');
});

test('quote: incompatible selections are rejected', () => {
  quoteRule(() => quoteFor(['interior-fresh'], 'suv'), 'SELECTION_INVALID'); // sedan-only add-on
  quoteRule(() => quoteFor([], 'bus'), 'SELECTION_INVALID');
  quoteRule(() => quoteFor([], 'sedan', 'polish'), 'SELECTION_INVALID');
  quoteRule(() => quoteFor(['interior-fresh'], 'sedan', 'full-care'), 'SELECTION_INVALID'); // not offered by package
});

test('quote: the policy maximum is enforced on the exact total', () => {
  assert.throws(
    () =>
      computeQuote({
        selection: normalizeSelection({
          catalogRevision: 1,
          categoryId: 'suv',
          packageId: 'exterior',
          addonIds: [],
        }),
        snapshot: snapshotFixture(),
        rates: normalizeRates(ratesFixture(), TEST_POLICY),
        policy: { ...TEST_POLICY, maxAmountMinor: 69_999n },
      }),
    (e: unknown) => e instanceof QuoteRuleError && e.code === 'AMOUNT_LIMIT_EXCEEDED',
  );
});

test('quote expiry: TTL, capped by the next scheduled price version; status by server time', () => {
  assert.equal(quoteExpiry(T0, 900, null).toISOString(), '2026-10-07T10:15:00.000Z');
  const next = new Date('2026-10-07T10:05:00.000Z');
  assert.equal(quoteExpiry(T0, 900, next).toISOString(), next.toISOString());
  const expires = new Date(T0.getTime() + 1000);
  assert.equal(quoteStatus(expires, T0), 'USABLE');
  assert.equal(quoteStatus(expires, expires), 'EXPIRED');
});
