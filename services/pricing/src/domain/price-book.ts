import { definitionOf, isVehicleType, type CatalogView, type VehicleType } from './catalog-view';
import type { CurrencyPolicy } from './currency-policy';
import { MoneyError, parseNonNegativeMoney } from './money';

/**
 * A price book is ONE immutable, complete set of unit prices for the Catalog
 * revision it was validated against (pricing.v1 `publishPriceBook`). An entry
 * prices a definition either for one vehicle type or, with `vehicleType: null`,
 * for every eligible vehicle type without a specific entry. Revisions form one
 * linear chain; the newest revision is in force from the moment it commits.
 *
 * Nothing is defaulted: every PUBLISHED definition must be priced for every
 * vehicle type it is eligible for, and no entry may price an unknown, retired
 * or ineligible combination.
 */
export interface PriceBookEntry {
  readonly definitionId: string;
  readonly vehicleType: VehicleType | null;
  readonly unitPriceMinor: bigint;
}

export interface PriceBookDraft {
  readonly expectedPriceBookRevision: number;
  readonly currency: string;
  /** Canonical order: (definitionId, vehicleType with null first). */
  readonly entries: readonly PriceBookEntry[];
}

export type PriceBookIssueCode =
  | 'REQUEST_INVALID'
  | 'CURRENCY_NOT_IN_POLICY'
  | 'AMOUNT_LIMIT_EXCEEDED'
  | 'DUPLICATE_ENTRY'
  | 'DEFINITION_UNKNOWN'
  | 'DEFINITION_RETIRED'
  | 'VEHICLE_TYPE_NOT_ELIGIBLE'
  | 'PRICE_MISSING';

export interface PriceBookIssue {
  readonly field: string;
  readonly code: PriceBookIssueCode;
}

/** Structural problems are REQUEST_INVALID; all other issues are business validation. */
export class PriceBookRuleError extends Error {
  constructor(readonly issues: readonly PriceBookIssue[]) {
    super(issues[0]?.code ?? 'REQUEST_INVALID');
    this.name = 'PriceBookRuleError';
  }

  get structural(): boolean {
    return this.issues.some((issue) => issue.code === 'REQUEST_INVALID');
  }
}

export const MAX_PRICE_BOOK_ENTRIES = 2_000;
export const MAX_REVISION = 2_147_483_647;
const MAX_REPORTED_ISSUES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(field: string): PriceBookRuleError {
  return new PriceBookRuleError([{ field, code: 'REQUEST_INVALID' }]);
}

function entryKey(entry: { definitionId: string; vehicleType: VehicleType | null }): string {
  return `${entry.definitionId}|${entry.vehicleType ?? ''}`;
}

export function isRevision(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_REVISION
  );
}

/** Contract UUID (case-insensitive on input), returned lower-cased; null when invalid. */
export function normalizeUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

/** Strict parse of PublishPriceBookRequestV1 under the accepted currency policy. */
export function parsePriceBookDraft(raw: unknown, policy: CurrencyPolicy): PriceBookDraft {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid('$');
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'currency,entries,expectedPriceBookRevision')
    throw invalid('$');
  const { expectedPriceBookRevision, currency, entries } = input;
  if (!isRevision(expectedPriceBookRevision)) throw invalid('$.expectedPriceBookRevision');
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw invalid('$.currency');
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_PRICE_BOOK_ENTRIES)
    throw invalid('$.entries');
  if (currency !== policy.currency)
    throw new PriceBookRuleError([{ field: '$.currency', code: 'CURRENCY_NOT_IN_POLICY' }]);

  const parsed = entries.map((entry: unknown, index): PriceBookEntry => {
    const path = `$.entries[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw invalid(path);
    const e = entry as Record<string, unknown>;
    if (Object.keys(e).sort().join(',') !== 'definitionId,unitPrice,vehicleType')
      throw invalid(path);
    const definitionId = normalizeUuid(e.definitionId);
    if (definitionId === null) throw invalid(`${path}.definitionId`);
    if (e.vehicleType !== null && !isVehicleType(e.vehicleType))
      throw invalid(`${path}.vehicleType`);
    let price;
    try {
      price = parseNonNegativeMoney(e.unitPrice);
    } catch (error: unknown) {
      if (error instanceof MoneyError) throw invalid(`${path}.unitPrice`);
      throw error;
    }
    if (price.currency !== currency) throw invalid(`${path}.unitPrice.currency`);
    if (price.amountMinor > policy.maxAmountMinor)
      throw new PriceBookRuleError([
        { field: `${path}.unitPrice.amountMinor`, code: 'AMOUNT_LIMIT_EXCEEDED' },
      ]);
    return {
      definitionId,
      vehicleType: e.vehicleType,
      unitPriceMinor: price.amountMinor,
    };
  });
  const seen = new Set<string>();
  parsed.forEach((entry, index) => {
    const key = entryKey(entry);
    if (seen.has(key))
      throw new PriceBookRuleError([{ field: `$.entries[${index}]`, code: 'DUPLICATE_ENTRY' }]);
    seen.add(key);
  });
  return {
    expectedPriceBookRevision,
    currency,
    entries: [...parsed].sort((a, b) => {
      const x = entryKey(a);
      const y = entryKey(b);
      return x < y ? -1 : x > y ? 1 : 0;
    }),
  };
}

/** The unit price for (definition, vehicle type): a specific entry wins over the null entry. */
export function resolveUnitPrice(
  entries: readonly PriceBookEntry[],
  definitionId: string,
  vehicleType: VehicleType,
): bigint | null {
  const specific = entries.find(
    (e) => e.definitionId === definitionId && e.vehicleType === vehicleType,
  );
  if (specific) return specific.unitPriceMinor;
  const general = entries.find((e) => e.definitionId === definitionId && e.vehicleType === null);
  return general ? general.unitPriceMinor : null;
}

/**
 * Validates a draft against the exact Catalog view it will be stored with.
 * Reports up to 20 issues so an administrator can fix them in one pass.
 */
export function validatePriceBookAgainstCatalog(
  entries: readonly PriceBookEntry[],
  view: CatalogView,
): void {
  const issues: PriceBookIssue[] = [];
  entries.forEach((entry) => {
    const field = `$.entries[definitionId=${entry.definitionId},vehicleType=${entry.vehicleType ?? 'null'}]`;
    const definition = definitionOf(view, entry.definitionId);
    if (!definition) issues.push({ field, code: 'DEFINITION_UNKNOWN' });
    else if (definition.status !== 'PUBLISHED') issues.push({ field, code: 'DEFINITION_RETIRED' });
    else if (entry.vehicleType !== null && !definition.vehicleTypes.includes(entry.vehicleType))
      issues.push({ field, code: 'VEHICLE_TYPE_NOT_ELIGIBLE' });
  });
  for (const definition of view.definitions) {
    if (definition.status !== 'PUBLISHED') continue;
    for (const vehicleType of definition.vehicleTypes)
      if (resolveUnitPrice(entries, definition.definitionId, vehicleType) === null)
        issues.push({
          field: `$.entries[definitionId=${definition.definitionId},vehicleType=${vehicleType}]`,
          code: 'PRICE_MISSING',
        });
  }
  if (issues.length > 0) throw new PriceBookRuleError(issues.slice(0, MAX_REPORTED_ISSUES));
}

export type PriceBookPlan =
  | { readonly accepted: true; readonly revision: number }
  | { readonly accepted: false; readonly currentRevision: number };

/**
 * Optimistic concurrency on the linear chain. pricing.v1 requires
 * `expectedPriceBookRevision >= 1`, so it names the revision this publication
 * CREATES (head + 1; 1 for the first book). A stale editor whose head moved is
 * refused instead of overwriting a concurrent publication.
 */
export function planPriceBookRevision(head: number | null, expected: number): PriceBookPlan {
  const next = (head ?? 0) + 1;
  return expected === next
    ? { accepted: true, revision: next }
    : { accepted: false, currentRevision: head ?? 0 };
}
