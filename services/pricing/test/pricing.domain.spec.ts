import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MoneyError,
  PriceBookRuleError,
  QuoteRequestInvalid,
  QuoteRuleError,
  canonicalCatalogView,
  moneyWire,
  parseNonNegativeMoney,
  parsePriceBookDraft,
  parseQuoteRequest,
  planPriceBookRevision,
  policyMatchesContract,
  priceSelection,
  quoteExpiry,
  quoteStatus,
  resolveUnitPrice,
  validatePriceBookAgainstCatalog,
  validationReason,
  type CatalogView,
} from '../src/domain';
import { parseCatalogV1Body } from '../src/infrastructure/catalog/catalog-v1-http.reader';
import {
  CUSTOMER,
  DEF,
  GUEST,
  TEST_POLICY,
  catalogBody,
  priceBookRequest,
  quoteRequest,
  syp,
} from './support/pricing-fixtures';

function catalog(): CatalogView {
  const view = parseCatalogV1Body(catalogBody());
  assert.ok(view);
  return canonicalCatalogView(view);
}

function issues(work: () => unknown): string[] {
  try {
    work();
  } catch (error: unknown) {
    assert.ok(error instanceof PriceBookRuleError, String(error));
    return error.issues.map((i) => i.code);
  }
  assert.fail('expected PriceBookRuleError');
}

test('money: wire form carries the contract scale; malformed or rescaled input is refused', () => {
  assert.deepEqual(moneyWire('SYP', 150000n), { currency: 'SYP', amountMinor: '150000', scale: 2 });
  assert.deepEqual(parseNonNegativeMoney(syp('0')), { currency: 'SYP', amountMinor: 0n });
  for (const bad of [
    { currency: 'SYP', amountMinor: 150000, scale: 2 },
    { currency: 'SYP', amountMinor: '01', scale: 2 },
    { currency: 'SYP', amountMinor: '-1', scale: 2 },
    { currency: 'SYP', amountMinor: '1.5', scale: 2 },
    { currency: 'SYP', amountMinor: '1e3', scale: 2 },
    { currency: 'SYP', amountMinor: '1', scale: 0 },
    { currency: 'XTS', amountMinor: '1', scale: 2 },
    { currency: 'SYP', amountMinor: '1', scale: 2, extra: true },
    { currency: 'SYP', amountMinor: '1000000000000000000', scale: 2 },
  ])
    assert.throws(() => parseNonNegativeMoney(bad), MoneyError, JSON.stringify(bad));
  assert.throws(() => moneyWire('XTS', 1n), MoneyError);
  assert.throws(() => moneyWire('SYP', 10n ** 18n), MoneyError);
});

test('policy: only a currency/scale the pricing.v1 Money list carries is usable', () => {
  assert.equal(policyMatchesContract(TEST_POLICY), true);
  assert.equal(policyMatchesContract({ ...TEST_POLICY, currency: 'XTS' }), false);
  assert.equal(policyMatchesContract({ ...TEST_POLICY, minorUnitExponent: 0 }), false);
});

test('price book: strict structural parse, canonical order, duplicate and limit refusal', () => {
  const draft = parsePriceBookDraft(priceBookRequest(), TEST_POLICY);
  assert.equal(draft.expectedPriceBookRevision, 1);
  assert.deepEqual(
    draft.entries.map((e) => `${e.definitionId}|${e.vehicleType ?? ''}`),
    [`${DEF.exterior}|`, `${DEF.exterior}|suv`, `${DEF.fullCare}|`, `${DEF.tyreShine}|`],
  );
  const upper = priceBookRequest();
  (upper.entries as { definitionId: string }[])[0]!.definitionId = DEF.exterior.toUpperCase();
  assert.equal(parsePriceBookDraft(upper, TEST_POLICY).entries[0]!.definitionId, DEF.exterior);

  assert.deepEqual(
    issues(() => parsePriceBookDraft({ ...priceBookRequest(), x: 1 }, TEST_POLICY)),
    ['REQUEST_INVALID'],
  );
  assert.deepEqual(
    issues(() =>
      parsePriceBookDraft({ ...priceBookRequest(), expectedPriceBookRevision: 0 }, TEST_POLICY),
    ),
    ['REQUEST_INVALID'],
  );
  assert.deepEqual(
    issues(() => parsePriceBookDraft({ ...priceBookRequest(), currency: 'USD' }, TEST_POLICY)),
    ['CURRENCY_NOT_IN_POLICY'],
  );
  const duplicate = priceBookRequest();
  (duplicate.entries as unknown[]).push({
    definitionId: DEF.exterior.toUpperCase(),
    vehicleType: null,
    unitPrice: syp('1'),
  });
  assert.deepEqual(
    issues(() => parsePriceBookDraft(duplicate, TEST_POLICY)),
    ['DUPLICATE_ENTRY'],
  );
  const mixed = priceBookRequest();
  (mixed.entries as { unitPrice: unknown }[])[0]!.unitPrice = {
    currency: 'USD',
    amountMinor: '1',
    scale: 2,
  };
  assert.deepEqual(
    issues(() => parsePriceBookDraft(mixed, TEST_POLICY)),
    ['REQUEST_INVALID'],
  );
  const tooMuch = priceBookRequest();
  (tooMuch.entries as { unitPrice: unknown }[])[0]!.unitPrice = syp('100000000001');
  assert.deepEqual(
    issues(() => parsePriceBookDraft(tooMuch, TEST_POLICY)),
    ['AMOUNT_LIMIT_EXCEEDED'],
  );
});

test('price book: complete coverage of every published definition and eligible vehicle type', () => {
  const view = catalog();
  const draft = parsePriceBookDraft(priceBookRequest(), TEST_POLICY);
  validatePriceBookAgainstCatalog(draft.entries, view);

  const missing = draft.entries.filter((e) => e.definitionId !== DEF.tyreShine);
  assert.deepEqual(
    issues(() => validatePriceBookAgainstCatalog(missing, view)),
    ['PRICE_MISSING', 'PRICE_MISSING'],
  );
  const extra = [
    ...draft.entries,
    { definitionId: DEF.unknown, vehicleType: null, unitPriceMinor: 1n },
    { definitionId: DEF.retired, vehicleType: null, unitPriceMinor: 1n },
    { definitionId: DEF.tyreShine, vehicleType: 'pickup' as const, unitPriceMinor: 1n },
  ];
  assert.deepEqual(
    issues(() => validatePriceBookAgainstCatalog(extra, view)),
    ['DEFINITION_UNKNOWN', 'DEFINITION_RETIRED', 'VEHICLE_TYPE_NOT_ELIGIBLE'],
  );
  // A specific entry wins over the general one; nothing is defaulted to zero.
  assert.equal(resolveUnitPrice(draft.entries, DEF.exterior, 'suv'), 650000n);
  assert.equal(resolveUnitPrice(draft.entries, DEF.exterior, 'sedan'), 500000n);
  assert.equal(resolveUnitPrice(draft.entries, DEF.unknown, 'sedan'), null);
});

test('price book: expected revision names the revision this publication creates', () => {
  assert.deepEqual(planPriceBookRevision(null, 1), { accepted: true, revision: 1 });
  assert.deepEqual(planPriceBookRevision(null, 2), { accepted: false, currentRevision: 0 });
  assert.deepEqual(planPriceBookRevision(4, 5), { accepted: true, revision: 5 });
  assert.deepEqual(planPriceBookRevision(4, 4), { accepted: false, currentRevision: 4 });
});

test('quote request: closed shape, unique selections, bounded quantity, canonical order', () => {
  const parsed = parseQuoteRequest(
    quoteRequest({
      selections: [
        { definitionId: DEF.tyreShine, quantity: 2 },
        { definitionId: DEF.exterior.toUpperCase(), quantity: 1 },
      ],
    }),
  );
  assert.deepEqual(
    parsed.selections.map((s) => s.definitionId),
    [DEF.exterior, DEF.tyreShine],
  );
  const bad: Record<string, unknown>[] = [
    { ...quoteRequest(), total: syp('1') },
    quoteRequest({ vehicleType: 'truck' }),
    quoteRequest({ zoneId: 'zone-1' }),
    quoteRequest({ beneficiary: { kind: 'staff', subjectId: CUSTOMER.subjectId } }),
    quoteRequest({ selections: [] }),
    quoteRequest({ selections: [{ definitionId: DEF.exterior, quantity: 0 }] }),
    quoteRequest({ selections: [{ definitionId: DEF.exterior, quantity: 11 }] }),
    quoteRequest({ selections: [{ definitionId: DEF.exterior, quantity: 1.5 }] }),
    quoteRequest({
      selections: [
        { definitionId: DEF.exterior, quantity: 1 },
        { definitionId: DEF.exterior.toUpperCase(), quantity: 1 },
      ],
    }),
  ];
  for (const body of bad) assert.throws(() => parseQuoteRequest(body), QuoteRequestInvalid);
});

test('quote pricing: exact line arithmetic, package first, rule refusals', () => {
  const view = catalog();
  const entries = parsePriceBookDraft(priceBookRequest(), TEST_POLICY).entries;
  const priced = priceSelection({
    request: parseQuoteRequest(quoteRequest()),
    catalog: view,
    entries,
    maxAmountMinor: TEST_POLICY.maxAmountMinor,
  });
  assert.deepEqual(
    priced.lines.map((l) => [l.kind, l.definitionId, l.quantity, l.unitPriceMinor, l.amountMinor]),
    [
      ['PACKAGE', DEF.exterior, 1, 650000n, 650000n],
      ['EXTRA', DEF.tyreShine, 2, 75000n, 150000n],
    ],
  );
  assert.equal(priced.totalMinor, 800000n);

  const rule = (overrides: Record<string, unknown>, max = TEST_POLICY.maxAmountMinor) => {
    try {
      priceSelection({
        request: parseQuoteRequest(quoteRequest(overrides)),
        catalog: view,
        entries,
        maxAmountMinor: max,
      });
    } catch (error: unknown) {
      assert.ok(error instanceof QuoteRuleError);
      return error.reason;
    }
    return 'PRICED';
  };
  assert.equal(
    rule({ selections: [{ definitionId: DEF.tyreShine, quantity: 1 }] }),
    'SELECTION_INVALID',
  );
  assert.equal(
    rule({
      selections: [
        { definitionId: DEF.exterior, quantity: 1 },
        { definitionId: DEF.fullCare, quantity: 1 },
      ],
    }),
    'SELECTION_INVALID',
  );
  assert.equal(
    rule({ selections: [{ definitionId: DEF.exterior, quantity: 2 }] }),
    'SELECTION_INVALID',
  );
  assert.equal(rule({ vehicleType: 'pickup' }), 'SELECTION_INVALID');
  assert.equal(
    rule({ selections: [{ definitionId: DEF.retired, quantity: 1 }] }),
    'SELECTION_INVALID',
  );
  assert.equal(
    rule({ selections: [{ definitionId: DEF.unknown, quantity: 1 }] }),
    'SELECTION_INVALID',
  );
  assert.equal(rule({}, 799999n), 'AMOUNT_LIMIT_EXCEEDED');
  assert.equal(rule({}, 800000n), 'PRICED');
  const withoutExtra = entries.filter((e) => e.definitionId !== DEF.tyreShine);
  assert.throws(
    () =>
      priceSelection({
        request: parseQuoteRequest(quoteRequest()),
        catalog: view,
        entries: withoutExtra,
        maxAmountMinor: TEST_POLICY.maxAmountMinor,
      }),
    (error: unknown) => error instanceof QuoteRuleError && error.reason === 'PRICE_NOT_AVAILABLE',
  );
});

test('quote pricing (model-based): totals are exact sums for generated books and selections', () => {
  const view = catalog();
  let seed = 7;
  const next = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };
  for (let round = 0; round < 500; round++) {
    const big = BigInt(next(1_000_000_000)) * 1_000_000n + BigInt(next(1_000_000));
    const entries = [
      { definitionId: DEF.exterior, vehicleType: null, unitPriceMinor: big },
      { definitionId: DEF.fullCare, vehicleType: null, unitPriceMinor: BigInt(next(10_000)) },
      { definitionId: DEF.tyreShine, vehicleType: null, unitPriceMinor: BigInt(next(10_000_000)) },
    ];
    const quantity = 1 + next(10);
    const priced = priceSelection({
      request: parseQuoteRequest(
        quoteRequest({
          vehicleType: next(2) === 0 ? 'sedan' : 'suv',
          selections: [
            { definitionId: DEF.exterior, quantity: 1 },
            { definitionId: DEF.tyreShine, quantity },
          ],
        }),
      ),
      catalog: view,
      entries,
      maxAmountMinor: 10n ** 18n - 1n,
    });
    const extra = entries[2]!.unitPriceMinor * BigInt(quantity);
    assert.equal(priced.totalMinor, big + extra);
    assert.equal(
      priced.lines.reduce((sum, l) => sum + l.amountMinor, 0n),
      priced.totalMinor,
    );
    for (const line of priced.lines)
      assert.equal(line.amountMinor, line.unitPriceMinor * BigInt(line.quantity));
  }
});

test('quote lifecycle: expiry from injected time, beneficiary-first validation reasons', () => {
  const issued = new Date('2026-10-11T10:00:00.000Z');
  const expires = quoteExpiry(issued, 900);
  assert.equal(expires.toISOString(), '2026-10-11T10:15:00.000Z');
  assert.equal(quoteStatus(expires, new Date(expires.getTime() - 1)), 'USABLE');
  assert.equal(quoteStatus(expires, expires), 'EXPIRED');
  const quote = { revision: 1, beneficiary: CUSTOMER, expiresAt: expires };
  const at = (ms: number) => new Date(issued.getTime() + ms);
  assert.equal(
    validationReason({ quote, expectedRevision: 1, beneficiary: CUSTOMER, now: at(0) }),
    null,
  );
  assert.equal(
    validationReason({ quote, expectedRevision: 2, beneficiary: GUEST, now: at(10 ** 7) }),
    'BENEFICIARY_MISMATCH',
  );
  assert.equal(
    validationReason({
      quote,
      expectedRevision: 1,
      beneficiary: { kind: 'guest', subjectId: CUSTOMER.subjectId },
      now: at(0),
    }),
    'BENEFICIARY_MISMATCH',
  );
  assert.equal(
    validationReason({ quote, expectedRevision: 2, beneficiary: CUSTOMER, now: at(10 ** 7) }),
    'REVISION_MISMATCH',
  );
  assert.equal(
    validationReason({ quote, expectedRevision: 1, beneficiary: CUSTOMER, now: at(900_000) }),
    'QUOTE_EXPIRED',
  );
});

test('catalog.v1 body: closed shape is required; the view keeps only pricing fields', () => {
  const view = parseCatalogV1Body(catalogBody(3));
  assert.ok(view);
  assert.equal(view.catalogRevision, 3);
  assert.deepEqual(Object.keys(view.definitions[0]!).sort(), [
    'definitionId',
    'durationMinutes',
    'kind',
    'status',
    'vehicleTypes',
  ]);
  const body = catalogBody();
  const items = body.items as Record<string, unknown>[];
  const cases: unknown[] = [
    { ...body, extra: 1 },
    { ...body, publishedAt: '2026-10-01T08:00:00Z' },
    { ...body, catalogRevision: 0 },
    { ...body, items: [{ ...items[0], price: 1 }] },
    { ...body, items: [{ ...items[0], vehicleTypes: ['sedan', 'sedan'] }] },
    { ...body, items: [{ ...items[0], kind: 'BUNDLE' }] },
    { ...body, items: [items[0], { ...items[1], code: items[0]!.code }] },
    { ...body, items: [items[0], { ...items[1], definitionId: items[0]!.definitionId }] },
    null,
    [],
  ];
  for (const value of cases) assert.equal(parseCatalogV1Body(value), null, JSON.stringify(value));
});
