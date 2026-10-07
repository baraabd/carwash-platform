// Executes the BUILT @carwash/contracts catalog.v1 / pricing.v1 modules (dist).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const catalog = require('../../../packages/contracts/dist/catalog/v1.js');
const pricing = require('../../../packages/contracts/dist/pricing/v1.js');
const { ContractViolation } = require('../../../packages/contracts/dist/common/wire.js');

const throwsCode = (fn, code) =>
  assert.throws(fn, (error) => error instanceof ContractViolation && error.code === code);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const syp = (amountMinor) => ({ currency: 'SYP', amountMinor, scale: 2 });
const clone = (value) => structuredClone(value);

const definition = (n, code, kind = 'PACKAGE') => ({
  definitionId: id(n),
  revision: 1,
  kind,
  code,
  name: { ar: 'غسيل خارجي', en: null },
  description: { ar: 'غسيل خارجي كامل', en: 'Full exterior wash' },
  durationMinutes: 45,
  vehicleTypes: ['sedan', 'suv'],
  status: 'PUBLISHED',
  sortOrder: 10,
});

const catalogFixture = {
  catalogRevision: 3,
  publishedAt: '2026-10-07T08:00:00.000Z',
  items: [definition(1, 'exterior'), definition(2, 'wax', 'EXTRA')],
};

const quoteFixture = {
  quoteId: id(100),
  revision: 1,
  status: 'USABLE',
  beneficiary: { kind: 'guest', subjectId: id(200) },
  vehicleType: 'suv',
  zoneId: id(300),
  currency: 'SYP',
  lines: [
    {
      lineId: id(401),
      kind: 'PACKAGE',
      definitionId: id(1),
      quantity: 1,
      unitPrice: syp('5000000'),
      amount: syp('5000000'),
    },
    {
      lineId: id(402),
      kind: 'EXTRA',
      definitionId: id(2),
      quantity: 2,
      unitPrice: syp('750050'),
      amount: syp('1500100'),
    },
    {
      lineId: id(403),
      kind: 'VEHICLE_SURCHARGE',
      definitionId: null,
      quantity: 1,
      unitPrice: syp('100000'),
      amount: syp('100000'),
    },
    {
      lineId: id(404),
      kind: 'DISCOUNT',
      definitionId: null,
      quantity: 1,
      unitPrice: syp('250000'),
      amount: syp('-250000'),
    },
  ],
  total: syp('6350100'),
  catalogRevision: 3,
  priceBookRevision: 7,
  issuedAt: '2026-10-07T08:00:00.000Z',
  expiresAt: '2026-10-07T08:15:00.000Z',
};

test('catalog: valid published catalog round trips', () => {
  assert.deepEqual(catalog.parseCatalogV1(catalogFixture), catalogFixture);
  assert.equal(catalog.CATALOG_V1.routes.getPublished.access, 'public');
  assert.equal(catalog.CATALOG_V1.routes.publish.access, 'permission:catalog.publish');
});

test('catalog: duplicate code / definition and bad durations refused', () => {
  const dupCode = clone(catalogFixture);
  dupCode.items[1].code = 'exterior';
  throwsCode(() => catalog.parseCatalogV1(dupCode), 'DUPLICATE_CODE');
  const dupId = clone(catalogFixture);
  dupId.items[1].definitionId = id(1);
  throwsCode(() => catalog.parseCatalogV1(dupId), 'DUPLICATE_DEFINITION');
  for (const minutes of [4, 481, 30.5]) {
    const bad = clone(catalogFixture);
    bad.items[0].durationMinutes = minutes;
    throwsCode(() => catalog.parseCatalogV1(bad), 'INVALID_INTEGER');
  }
  const noTypes = clone(catalogFixture);
  noTypes.items[0].vehicleTypes = [];
  throwsCode(() => catalog.parseCatalogV1(noTypes), 'EMPTY_LIST');
  const dupTypes = clone(catalogFixture);
  dupTypes.items[0].vehicleTypes = ['suv', 'suv'];
  throwsCode(() => catalog.parseCatalogV1(dupTypes), 'DUPLICATE_ITEM');
  const badCode = clone(catalogFixture);
  badCode.items[0].code = 'Exterior';
  throwsCode(() => catalog.parseCatalogV1(badCode), 'INVALID_FORMAT');
});

test('catalog: a price inside a definition is refused (Catalog owns no money)', () => {
  const priced = clone(catalogFixture);
  priced.items[0].price = syp('5000000');
  throwsCode(() => catalog.parseCatalogV1(priced), 'UNEXPECTED_FIELD');
});

test('catalog: publish request requires definitions, revision and reason code', () => {
  const draft = definition(1, 'exterior');
  delete draft.revision;
  const request = {
    expectedCatalogRevision: 3,
    definitions: [draft],
    reasonCode: 'SEASONAL_UPDATE',
  };
  assert.deepEqual(catalog.parsePublishCatalogRequestV1(request), request);
  throwsCode(
    () => catalog.parsePublishCatalogRequestV1({ ...request, definitions: [] }),
    'EMPTY_LIST',
  );
  throwsCode(
    () => catalog.parsePublishCatalogRequestV1({ ...request, reasonCode: 'x' }),
    'INVALID_FORMAT',
  );
  throwsCode(
    () =>
      catalog.parsePublishCatalogRequestV1({
        ...request,
        definitions: [definition(1, 'exterior')],
      }),
    'UNEXPECTED_FIELD',
  );
});

test('pricing: valid quote round trips and arithmetic is exact', () => {
  assert.deepEqual(pricing.parseQuoteV1(quoteFixture), quoteFixture);
});

test('pricing: total off by one minor unit is refused', () => {
  for (const amountMinor of ['6350099', '6350101']) {
    const bad = clone(quoteFixture);
    bad.total = syp(amountMinor);
    throwsCode(() => pricing.parseQuoteV1(bad), 'TOTAL_MISMATCH');
  }
  const badLine = clone(quoteFixture);
  badLine.lines[1].amount = syp('1500101');
  throwsCode(() => pricing.parseQuoteV1(badLine), 'LINE_AMOUNT_MISMATCH');
});

test('pricing: mixed currency refused', () => {
  const usdLine = clone(quoteFixture);
  usdLine.lines[2].unitPrice = { currency: 'USD', amountMinor: '100000', scale: 2 };
  usdLine.lines[2].amount = { currency: 'USD', amountMinor: '100000', scale: 2 };
  throwsCode(() => pricing.parseQuoteV1(usdLine), 'CURRENCY_MISMATCH');
  const usdTotal = clone(quoteFixture);
  usdTotal.total = { currency: 'USD', amountMinor: '6350100', scale: 2 };
  throwsCode(() => pricing.parseQuoteV1(usdTotal), 'CURRENCY_MISMATCH');
});

test('pricing: discount sign rules', () => {
  const positiveDiscount = clone(quoteFixture);
  positiveDiscount.lines[3].amount = syp('250000');
  throwsCode(() => pricing.parseQuoteV1(positiveDiscount), 'LINE_AMOUNT_MISMATCH');
  const negativeFee = clone(quoteFixture);
  negativeFee.lines[2].kind = 'FEE';
  negativeFee.lines[2].amount = syp('-100000');
  throwsCode(() => pricing.parseQuoteV1(negativeFee), 'LINE_AMOUNT_MISMATCH');
  const negativeUnit = clone(quoteFixture);
  negativeUnit.lines[3].unitPrice = syp('-250000');
  throwsCode(() => pricing.parseQuoteV1(negativeUnit), 'NEGATIVE_MONEY');
  // A discount larger than the subtotal can never yield a negative total.
  const tooBig = clone(quoteFixture);
  tooBig.lines[3].unitPrice = syp('7000000');
  tooBig.lines[3].amount = syp('-7000000');
  tooBig.total = syp('-399900');
  throwsCode(() => pricing.parseQuoteV1(tooBig), 'NEGATIVE_MONEY');
});

test('pricing: definitionId presence follows line kind', () => {
  const missing = clone(quoteFixture);
  missing.lines[0].definitionId = null;
  throwsCode(() => pricing.parseQuoteV1(missing), 'INVALID_DEFINITION_REFERENCE');
  const extra = clone(quoteFixture);
  extra.lines[2].definitionId = id(9);
  throwsCode(() => pricing.parseQuoteV1(extra), 'INVALID_DEFINITION_REFERENCE');
});

test('pricing: expiry must be after issue', () => {
  for (const expiresAt of ['2026-10-07T08:00:00.000Z', '2026-10-07T07:59:59.999Z']) {
    throwsCode(() => pricing.parseQuoteV1({ ...clone(quoteFixture), expiresAt }), 'INVALID_EXPIRY');
  }
});

test('pricing: quote request selection rules', () => {
  const request = {
    beneficiary: { kind: 'account', subjectId: id(200) },
    vehicleType: 'sedan',
    zoneId: null,
    selections: [{ definitionId: id(1), quantity: 1 }],
  };
  assert.deepEqual(pricing.parseQuoteRequestV1(request), request);
  throwsCode(() => pricing.parseQuoteRequestV1({ ...request, selections: [] }), 'EMPTY_LIST');
  throwsCode(
    () =>
      pricing.parseQuoteRequestV1({
        ...request,
        selections: [request.selections[0], request.selections[0]],
      }),
    'DUPLICATE_ITEM',
  );
  throwsCode(
    () =>
      pricing.parseQuoteRequestV1({
        ...request,
        selections: [{ definitionId: id(1), quantity: 11 }],
      }),
    'INVALID_INTEGER',
  );
});

test('pricing: validation valid/reason consistency', () => {
  const ok = { quoteId: id(100), revision: 1, valid: true, reason: null, total: syp('6350100') };
  assert.deepEqual(pricing.parseQuoteValidationV1(ok), ok);
  const expired = { ...ok, valid: false, reason: 'QUOTE_EXPIRED' };
  assert.deepEqual(pricing.parseQuoteValidationV1(expired), expired);
  throwsCode(
    () => pricing.parseQuoteValidationV1({ ...ok, reason: 'QUOTE_REVOKED' }),
    'INCONSISTENT_VALIDATION',
  );
  throwsCode(
    () => pricing.parseQuoteValidationV1({ ...ok, valid: false }),
    'INCONSISTENT_VALIDATION',
  );
  const req = {
    expectedRevision: 1,
    beneficiary: { kind: 'guest', subjectId: id(200) },
    purpose: 'booking-create',
  };
  assert.deepEqual(pricing.parseValidateQuoteRequestV1(req), req);
  throwsCode(
    () => pricing.parseValidateQuoteRequestV1({ ...req, purpose: 'marketing' }),
    'INVALID_ENUM',
  );
});

test('pricing: price book entries unique per (definition, vehicle type) and single currency', () => {
  const book = {
    expectedPriceBookRevision: 7,
    currency: 'SYP',
    entries: [
      { definitionId: id(1), vehicleType: null, unitPrice: syp('5000000') },
      { definitionId: id(1), vehicleType: 'suv', unitPrice: syp('6000000') },
    ],
  };
  assert.deepEqual(pricing.parsePublishPriceBookRequestV1(book), book);
  const dup = clone(book);
  dup.entries[1].vehicleType = null;
  throwsCode(() => pricing.parsePublishPriceBookRequestV1(dup), 'DUPLICATE_ITEM');
  const usd = clone(book);
  usd.entries[0].unitPrice = { currency: 'USD', amountMinor: '1', scale: 2 };
  throwsCode(() => pricing.parsePublishPriceBookRequestV1(usd), 'CURRENCY_MISMATCH');
});
