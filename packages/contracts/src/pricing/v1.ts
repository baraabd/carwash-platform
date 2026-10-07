import type { OwnerContract } from '../common/route';
import { VEHICLE_TYPES, type VehicleType } from '../common/vehicle-type';
import {
  CURRENCIES,
  minorUnits,
  multiplyMoney,
  parseMoney,
  parseNonNegativeMoney,
  sumMoney,
  type Currency,
  type Money,
} from '../common/money';
import {
  parsePrincipalRef,
  parseResolvePurpose,
  type PrincipalRef,
  type ResolvePurpose,
} from '../common/principal';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import { ContractViolation, boolean, closed, integer, list, oneOf, uuid } from '../common/wire';

/**
 * pricing.v1 — owner: Pricing service (Lane B).
 * Quotes are server-computed and immutable per revision. The wire parser
 * re-verifies line and total arithmetic exactly (bigint minor units), so a
 * consumer can never display or charge a total that disagrees with its lines.
 */
export const PRICING_V1 = {
  id: 'pricing.v1',
  owner: 'pricing',
  prefix: '/internal/v1/pricing',
  routes: {
    createQuote: { method: 'POST', path: '/quotes', access: 'principal', idempotent: true },
    getQuote: { method: 'GET', path: '/quotes/:quoteId', access: 'principal' },
    validateQuote: {
      method: 'POST',
      path: '/quotes/:quoteId/validate',
      access: 'service:pricing.quote.validate',
      safe: true,
    },
    publishPriceBook: {
      method: 'POST',
      path: '/price-books',
      access: 'permission:pricing.prices.publish',
      idempotent: true,
    },
  },
  reasons: ['QUOTE_EXPIRED', 'QUOTE_REVOKED', 'SELECTION_INVALID', 'PRICE_NOT_AVAILABLE'],
} as const satisfies OwnerContract;

const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];

export const QUOTE_LINE_KINDS = [
  'PACKAGE',
  'EXTRA',
  'VEHICLE_SURCHARGE',
  'DISCOUNT',
  'FEE',
  'TAX',
] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export interface QuoteSelectionV1 {
  readonly definitionId: string;
  readonly quantity: number;
}

export interface QuoteRequestV1 {
  readonly beneficiary: PrincipalRef;
  readonly vehicleType: VehicleType;
  readonly zoneId: string | null;
  readonly selections: readonly QuoteSelectionV1[];
}

export interface QuoteLineV1 {
  readonly lineId: string;
  readonly kind: QuoteLineKind;
  readonly definitionId: string | null;
  readonly quantity: number;
  readonly unitPrice: Money;
  /** Signed: DISCOUNT lines are <= 0, all other kinds >= 0. */
  readonly amount: Money;
}

export interface QuoteV1 {
  readonly quoteId: string;
  readonly revision: number;
  readonly status: 'USABLE' | 'EXPIRED' | 'REVOKED';
  readonly beneficiary: PrincipalRef;
  readonly vehicleType: VehicleType;
  readonly zoneId: string | null;
  readonly currency: Currency;
  readonly lines: readonly QuoteLineV1[];
  readonly total: Money;
  readonly catalogRevision: number;
  readonly priceBookRevision: number;
  readonly issuedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
}

export interface ValidateQuoteRequestV1 {
  readonly expectedRevision: number;
  readonly beneficiary: PrincipalRef;
  readonly purpose: ResolvePurpose;
}

export const QUOTE_VALIDATION_REASONS = [
  'QUOTE_EXPIRED',
  'QUOTE_REVOKED',
  'REVISION_MISMATCH',
  'BENEFICIARY_MISMATCH',
] as const;
export type QuoteValidationReason = (typeof QUOTE_VALIDATION_REASONS)[number];

export interface QuoteValidationV1 {
  readonly quoteId: string;
  readonly revision: number;
  /** True iff reason is null. */
  readonly valid: boolean;
  readonly reason: QuoteValidationReason | null;
  readonly total: Money;
}

export interface PriceBookEntryV1 {
  readonly definitionId: string;
  /** null = applies to every vehicle type without a specific entry. */
  readonly vehicleType: VehicleType | null;
  readonly unitPrice: Money;
}

export interface PublishPriceBookRequestV1 {
  readonly expectedPriceBookRevision: number;
  readonly currency: Currency;
  readonly entries: readonly PriceBookEntryV1[];
}

function optionalUuid(value: unknown, path: string): string | null {
  return value === null ? null : uuid(value, path);
}

export function parseQuoteRequestV1(value: unknown): QuoteRequestV1 {
  const v = closed(value, '$', ['beneficiary', 'vehicleType', 'zoneId', 'selections']);
  const selections = list(v.selections, '$.selections', 20, (entry, path) => {
    const s = closed(entry, path, ['definitionId', 'quantity']);
    return {
      definitionId: uuid(s.definitionId, `${path}.definitionId`),
      quantity: integer(s.quantity, `${path}.quantity`, 1, 10),
    };
  });
  if (selections.length === 0) throw new ContractViolation('EMPTY_LIST', '$.selections');
  if (new Set(selections.map((s) => s.definitionId)).size !== selections.length) {
    throw new ContractViolation('DUPLICATE_ITEM', '$.selections');
  }
  return {
    beneficiary: parsePrincipalRef(v.beneficiary, '$.beneficiary'),
    vehicleType: oneOf(v.vehicleType, '$.vehicleType', VEHICLE_TYPES),
    zoneId: optionalUuid(v.zoneId, '$.zoneId'),
    selections,
  };
}

export function parseQuoteLineV1(value: unknown, path = '$'): QuoteLineV1 {
  const v = closed(value, path, [
    'lineId',
    'kind',
    'definitionId',
    'quantity',
    'unitPrice',
    'amount',
  ]);
  const kind = oneOf(v.kind, `${path}.kind`, QUOTE_LINE_KINDS);
  const definitionId = optionalUuid(v.definitionId, `${path}.definitionId`);
  const needsDefinition = kind === 'PACKAGE' || kind === 'EXTRA';
  if (needsDefinition !== (definitionId !== null)) {
    throw new ContractViolation('INVALID_DEFINITION_REFERENCE', `${path}.definitionId`);
  }
  const quantity = integer(v.quantity, `${path}.quantity`, 1, 10);
  const unitPrice = parseNonNegativeMoney(v.unitPrice, `${path}.unitPrice`);
  const amount = parseMoney(v.amount, `${path}.amount`);
  if (amount.currency !== unitPrice.currency) {
    throw new ContractViolation('CURRENCY_MISMATCH', `${path}.amount`);
  }
  const gross = minorUnits(multiplyMoney(unitPrice, quantity));
  const expected = kind === 'DISCOUNT' ? -gross : gross;
  if (minorUnits(amount) !== expected) {
    throw new ContractViolation('LINE_AMOUNT_MISMATCH', `${path}.amount`);
  }
  return {
    lineId: uuid(v.lineId, `${path}.lineId`),
    kind,
    definitionId,
    quantity,
    unitPrice,
    amount,
  };
}

export function parseQuoteV1(value: unknown, path = '$'): QuoteV1 {
  const v = closed(value, path, [
    'quoteId',
    'revision',
    'status',
    'beneficiary',
    'vehicleType',
    'zoneId',
    'currency',
    'lines',
    'total',
    'catalogRevision',
    'priceBookRevision',
    'issuedAt',
    'expiresAt',
  ]);
  const currency = oneOf(v.currency, `${path}.currency`, CURRENCY_CODES);
  const lines = list(v.lines, `${path}.lines`, 30, parseQuoteLineV1);
  if (lines.length === 0) throw new ContractViolation('EMPTY_LIST', `${path}.lines`);
  if (new Set(lines.map((l) => l.lineId)).size !== lines.length) {
    throw new ContractViolation('DUPLICATE_ITEM', `${path}.lines`);
  }
  if (lines.some((l) => l.amount.currency !== currency)) {
    throw new ContractViolation('CURRENCY_MISMATCH', `${path}.lines`);
  }
  const total = parseNonNegativeMoney(v.total, `${path}.total`);
  if (total.currency !== currency)
    throw new ContractViolation('CURRENCY_MISMATCH', `${path}.total`);
  const computed = sumMoney(
    currency,
    lines.map((l) => l.amount),
  );
  if (computed.amountMinor !== total.amountMinor) {
    throw new ContractViolation('TOTAL_MISMATCH', `${path}.total`);
  }
  const issuedAt = parseUtc(v.issuedAt, `${path}.issuedAt`);
  const expiresAt = parseUtc(v.expiresAt, `${path}.expiresAt`);
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new ContractViolation('INVALID_EXPIRY', `${path}.expiresAt`);
  }
  return {
    quoteId: uuid(v.quoteId, `${path}.quoteId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    status: oneOf(v.status, `${path}.status`, ['USABLE', 'EXPIRED', 'REVOKED'] as const),
    beneficiary: parsePrincipalRef(v.beneficiary, `${path}.beneficiary`),
    vehicleType: oneOf(v.vehicleType, `${path}.vehicleType`, VEHICLE_TYPES),
    zoneId: optionalUuid(v.zoneId, `${path}.zoneId`),
    currency,
    lines,
    total,
    catalogRevision: parseRevision(v.catalogRevision, `${path}.catalogRevision`),
    priceBookRevision: parseRevision(v.priceBookRevision, `${path}.priceBookRevision`),
    issuedAt,
    expiresAt,
  };
}

export function parseValidateQuoteRequestV1(value: unknown): ValidateQuoteRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'beneficiary', 'purpose']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    beneficiary: parsePrincipalRef(v.beneficiary, '$.beneficiary'),
    purpose: parseResolvePurpose(v.purpose, '$.purpose'),
  };
}

export function parseQuoteValidationV1(value: unknown, path = '$'): QuoteValidationV1 {
  const v = closed(value, path, ['quoteId', 'revision', 'valid', 'reason', 'total']);
  const valid = boolean(v.valid, `${path}.valid`);
  const reason =
    v.reason === null ? null : oneOf(v.reason, `${path}.reason`, QUOTE_VALIDATION_REASONS);
  if (valid !== (reason === null)) {
    throw new ContractViolation('INCONSISTENT_VALIDATION', `${path}.valid`);
  }
  return {
    quoteId: uuid(v.quoteId, `${path}.quoteId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    valid,
    reason,
    total: parseNonNegativeMoney(v.total, `${path}.total`),
  };
}

export function parsePublishPriceBookRequestV1(value: unknown): PublishPriceBookRequestV1 {
  const v = closed(value, '$', ['expectedPriceBookRevision', 'currency', 'entries']);
  const currency = oneOf(v.currency, '$.currency', CURRENCY_CODES);
  const entries = list(v.entries, '$.entries', 2_000, (entry, path) => {
    const e = closed(entry, path, ['definitionId', 'vehicleType', 'unitPrice']);
    const unitPrice = parseNonNegativeMoney(e.unitPrice, `${path}.unitPrice`);
    if (unitPrice.currency !== currency) {
      throw new ContractViolation('CURRENCY_MISMATCH', `${path}.unitPrice`);
    }
    return {
      definitionId: uuid(e.definitionId, `${path}.definitionId`),
      vehicleType:
        e.vehicleType === null ? null : oneOf(e.vehicleType, `${path}.vehicleType`, VEHICLE_TYPES),
      unitPrice,
    };
  });
  if (entries.length === 0) throw new ContractViolation('EMPTY_LIST', '$.entries');
  const keys = entries.map((e) => `${e.definitionId}|${e.vehicleType ?? '*'}`);
  if (new Set(keys).size !== keys.length)
    throw new ContractViolation('DUPLICATE_ITEM', '$.entries');
  return {
    expectedPriceBookRevision: parseRevision(
      v.expectedPriceBookRevision,
      '$.expectedPriceBookRevision',
    ),
    currency,
    entries,
  };
}
