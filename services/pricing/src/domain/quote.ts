import {
  definitionOf,
  isVehicleType,
  type CatalogView,
  type DefinitionKind,
  type VehicleType,
} from './catalog-view';
import { normalizeUuid, resolveUnitPrice, type PriceBookEntry } from './price-book';

/**
 * pricing.v1 quote calculation. Inputs are IDs and quantities only: the client
 * never sends a unit price, discount, fee, tax or total. The result is an
 * exact, line-by-line breakdown in minor units.
 *
 * Emitted line kinds are PACKAGE and EXTRA. VEHICLE_SURCHARGE is not a separate
 * line: a price book prices each (definition, vehicle type) directly. DISCOUNT
 * (promotions, B-10), FEE (zone/travel, B-04) and TAX (B-04) need owner
 * decisions that are still OPEN, so no such line is ever produced and none is
 * accepted by the database. A quote is a price snapshot, not an invoice,
 * capacity hold, booking or payment.
 */
export const PRINCIPAL_KINDS = ['account', 'guest'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export interface PrincipalRef {
  readonly kind: PrincipalKind;
  readonly subjectId: string;
}

export interface QuoteSelection {
  readonly definitionId: string;
  readonly quantity: number;
}

export interface QuoteRequest {
  readonly beneficiary: PrincipalRef;
  readonly vehicleType: VehicleType;
  readonly zoneId: string | null;
  /** Canonical order: by definitionId (a selection is a set of unique definitions). */
  readonly selections: readonly QuoteSelection[];
}

export interface PricedLine {
  readonly kind: DefinitionKind;
  readonly definitionId: string;
  readonly quantity: number;
  readonly unitPriceMinor: bigint;
  readonly amountMinor: bigint;
}

export type QuoteRuleReason = 'SELECTION_INVALID' | 'PRICE_NOT_AVAILABLE' | 'AMOUNT_LIMIT_EXCEEDED';

export class QuoteRuleError extends Error {
  constructor(readonly reason: QuoteRuleReason) {
    super(reason);
    this.name = 'QuoteRuleError';
  }
}

export class QuoteRequestInvalid extends Error {
  constructor(readonly field: string) {
    super('REQUEST_INVALID');
    this.name = 'QuoteRequestInvalid';
  }
}

export const MAX_SELECTIONS = 20;
export const MAX_QUANTITY = 10;

function closedObject(value: unknown, keys: string, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new QuoteRequestInvalid(field);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== keys) throw new QuoteRequestInvalid(field);
  return input;
}

export function parsePrincipalRef(value: unknown, field: string): PrincipalRef {
  const v = closedObject(value, 'kind,subjectId', field);
  const kind = PRINCIPAL_KINDS.find((k) => k === v.kind);
  const subjectId = normalizeUuid(v.subjectId);
  if (!kind) throw new QuoteRequestInvalid(`${field}.kind`);
  if (subjectId === null) throw new QuoteRequestInvalid(`${field}.subjectId`);
  return { kind, subjectId };
}

/** Strict parse of QuoteRequestV1. */
export function parseQuoteRequest(raw: unknown): QuoteRequest {
  const v = closedObject(raw, 'beneficiary,selections,vehicleType,zoneId', '$');
  const beneficiary = parsePrincipalRef(v.beneficiary, '$.beneficiary');
  if (!isVehicleType(v.vehicleType)) throw new QuoteRequestInvalid('$.vehicleType');
  let zoneId: string | null = null;
  if (v.zoneId !== null) {
    zoneId = normalizeUuid(v.zoneId);
    if (zoneId === null) throw new QuoteRequestInvalid('$.zoneId');
  }
  if (!Array.isArray(v.selections) || v.selections.length === 0)
    throw new QuoteRequestInvalid('$.selections');
  if (v.selections.length > MAX_SELECTIONS) throw new QuoteRequestInvalid('$.selections');
  const selections = v.selections.map((entry: unknown, index): QuoteSelection => {
    const path = `$.selections[${index}]`;
    const s = closedObject(entry, 'definitionId,quantity', path);
    const definitionId = normalizeUuid(s.definitionId);
    if (definitionId === null) throw new QuoteRequestInvalid(`${path}.definitionId`);
    const { quantity } = s;
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    )
      throw new QuoteRequestInvalid(`${path}.quantity`);
    return { definitionId, quantity };
  });
  if (new Set(selections.map((s) => s.definitionId)).size !== selections.length)
    throw new QuoteRequestInvalid('$.selections');
  return {
    beneficiary,
    vehicleType: v.vehicleType,
    zoneId,
    selections: selections.sort((a, b) =>
      a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0,
    ),
  };
}

/**
 * Prices a selection against ONE price book and the Catalog view stored with
 * it. Exactly one PACKAGE (quantity 1); every selected definition must be
 * PUBLISHED and eligible for the vehicle type. Lines: the package first, then
 * extras in canonical order. amount = unitPrice x quantity, exactly.
 */
export function priceSelection(input: {
  readonly request: QuoteRequest;
  readonly catalog: CatalogView;
  readonly entries: readonly PriceBookEntry[];
  readonly maxAmountMinor: bigint;
}): { readonly lines: readonly PricedLine[]; readonly totalMinor: bigint } {
  const { request, catalog, entries } = input;
  const lines: PricedLine[] = [];
  for (const selection of request.selections) {
    const definition = definitionOf(catalog, selection.definitionId);
    if (
      !definition ||
      definition.status !== 'PUBLISHED' ||
      !definition.vehicleTypes.includes(request.vehicleType)
    )
      throw new QuoteRuleError('SELECTION_INVALID');
    if (definition.kind === 'PACKAGE' && selection.quantity !== 1)
      throw new QuoteRuleError('SELECTION_INVALID');
    const unitPriceMinor = resolveUnitPrice(entries, definition.definitionId, request.vehicleType);
    if (unitPriceMinor === null) throw new QuoteRuleError('PRICE_NOT_AVAILABLE');
    lines.push({
      kind: definition.kind,
      definitionId: definition.definitionId,
      quantity: selection.quantity,
      unitPriceMinor,
      amountMinor: unitPriceMinor * BigInt(selection.quantity),
    });
  }
  const packages = lines.filter((line) => line.kind === 'PACKAGE');
  if (packages.length !== 1) throw new QuoteRuleError('SELECTION_INVALID');
  const ordered = [...packages, ...lines.filter((line) => line.kind !== 'PACKAGE')];
  const totalMinor = ordered.reduce((sum, line) => sum + line.amountMinor, 0n);
  if (totalMinor > input.maxAmountMinor) throw new QuoteRuleError('AMOUNT_LIMIT_EXCEEDED');
  return { lines: ordered, totalMinor };
}

export type QuoteStatus = 'USABLE' | 'EXPIRED' | 'REVOKED';

/**
 * Expiry = issue time + configured TTL (B-05). Publishing a newer price book
 * does not shorten or revoke an issued quote: the quote is honoured at its own
 * snapshot until it expires. No revocation command exists in pricing.v1 and
 * revocation conditions are an OPEN owner decision (B-05), so REVOKED is part
 * of the vocabulary but is never produced by this implementation.
 */
export function quoteExpiry(issuedAt: Date, ttlSeconds: number): Date {
  return new Date(issuedAt.getTime() + ttlSeconds * 1000);
}

export function quoteStatus(expiresAt: Date, now: Date): QuoteStatus {
  return now.getTime() < expiresAt.getTime() ? 'USABLE' : 'EXPIRED';
}

export type QuoteValidationReason =
  'QUOTE_EXPIRED' | 'QUOTE_REVOKED' | 'REVISION_MISMATCH' | 'BENEFICIARY_MISMATCH';

/**
 * pricing.v1 validateQuote decision. Beneficiary is checked first so a caller
 * that names the wrong beneficiary learns nothing else about the quote.
 */
export function validationReason(input: {
  readonly quote: {
    readonly revision: number;
    readonly beneficiary: PrincipalRef;
    readonly expiresAt: Date;
  };
  readonly expectedRevision: number;
  readonly beneficiary: PrincipalRef;
  readonly now: Date;
}): QuoteValidationReason | null {
  const { quote, beneficiary } = input;
  if (
    quote.beneficiary.kind !== beneficiary.kind ||
    quote.beneficiary.subjectId !== beneficiary.subjectId
  )
    return 'BENEFICIARY_MISMATCH';
  if (quote.revision !== input.expectedRevision) return 'REVISION_MISMATCH';
  if (quoteStatus(quote.expiresAt, input.now) === 'EXPIRED') return 'QUOTE_EXPIRED';
  return null;
}
