import type { CatalogSnapshot } from './catalog-snapshot';
import type { CurrencyPolicy } from './currency-policy';
import { Money } from './money';
import type { Rate, RateKind } from './price-version';

/**
 * Quote calculation. Inputs are IDs only — the client never sends an owner,
 * unit price, discount, fee, tax or total. The result is a reproducible,
 * line-by-line breakdown in exact minor units.
 *
 * Not computed in v1 (each needs an owner decision, see POLICY_DECISIONS.md):
 * promotions/discounts (B-10), zone/travel fees and tax (B-04). The quote
 * therefore carries no adjustment lines and total = subtotal; it is a price
 * snapshot, not an invoice, capacity hold, booking or payment.
 */
export interface Selection {
  readonly catalogRevision: number;
  readonly categoryId: string;
  readonly packageId: string;
  /** Unique, sorted. */
  readonly addonIds: readonly string[];
}

export interface QuoteLine {
  readonly kind: RateKind;
  readonly definitionId: string;
  readonly amountMinor: bigint;
  /** INCLUDED add-ons are listed for transparency with a zero charge. */
  readonly included: boolean;
}

export interface QuoteComputation {
  readonly currency: string;
  readonly lines: readonly QuoteLine[];
  readonly subtotalMinor: bigint;
  readonly totalMinor: bigint;
  readonly durationMinutes: number;
}

export type QuoteRuleCode =
  'SELECTION_MALFORMED' | 'SELECTION_INVALID' | 'AMOUNT_LIMIT_EXCEEDED' | 'RATE_MISSING';

export class QuoteRuleError extends Error {
  constructor(readonly code: QuoteRuleCode) {
    super(code);
    this.name = 'QuoteRuleError';
  }
}

const DEFINITION_ID = /^[a-z][a-z0-9-]{1,47}$/;
const MAX_ADDONS = 20;

export function normalizeSelection(raw: unknown): Selection {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new QuoteRuleError('SELECTION_MALFORMED');
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'addonIds,catalogRevision,categoryId,packageId')
    throw new QuoteRuleError('SELECTION_MALFORMED');
  const { catalogRevision, categoryId, packageId, addonIds } = input;
  if (
    typeof catalogRevision !== 'number' ||
    !Number.isInteger(catalogRevision) ||
    catalogRevision < 1 ||
    catalogRevision > 2_147_483_646
  )
    throw new QuoteRuleError('SELECTION_MALFORMED');
  if (typeof categoryId !== 'string' || !DEFINITION_ID.test(categoryId))
    throw new QuoteRuleError('SELECTION_MALFORMED');
  if (typeof packageId !== 'string' || !DEFINITION_ID.test(packageId))
    throw new QuoteRuleError('SELECTION_MALFORMED');
  if (!Array.isArray(addonIds) || addonIds.length > MAX_ADDONS)
    throw new QuoteRuleError('SELECTION_MALFORMED');
  const ids: string[] = [];
  for (const id of addonIds) {
    if (typeof id !== 'string' || !DEFINITION_ID.test(id))
      throw new QuoteRuleError('SELECTION_MALFORMED');
    // Duplicates are rejected, not silently collapsed.
    if (ids.includes(id)) throw new QuoteRuleError('SELECTION_MALFORMED');
    ids.push(id);
  }
  return { catalogRevision, categoryId, packageId, addonIds: ids.sort() };
}

function rateOf(rates: readonly Rate[], kind: RateKind, id: string): bigint {
  const rate = rates.find((r) => r.kind === kind && r.definitionId === id);
  // Rates were validated as complete at publication; a gap here is corruption.
  if (!rate) throw new QuoteRuleError('RATE_MISSING');
  return rate.amountMinor;
}

export function computeQuote(input: {
  readonly selection: Selection;
  readonly snapshot: CatalogSnapshot;
  readonly rates: readonly Rate[];
  readonly policy: CurrencyPolicy;
}): QuoteComputation {
  const { selection, snapshot, rates, policy } = input;
  const pkg = snapshot.packages.find((p) => p.id === selection.packageId);
  const category = snapshot.categories.find((c) => c.id === selection.categoryId);
  if (!pkg || !category || !pkg.allowedCategoryIds.includes(category.id))
    throw new QuoteRuleError('SELECTION_INVALID');

  const lines: QuoteLine[] = [
    {
      kind: 'PACKAGE',
      definitionId: pkg.id,
      amountMinor: rateOf(rates, 'PACKAGE', pkg.id),
      included: false,
    },
    {
      kind: 'VEHICLE',
      definitionId: category.id,
      amountMinor: rateOf(rates, 'VEHICLE', category.id),
      included: false,
    },
  ];
  // The package duration already covers its included add-ons.
  let duration = pkg.durationMinutes + category.extraDurationMinutes;
  for (const addonId of selection.addonIds) {
    const addon = snapshot.addons.find((a) => a.id === addonId);
    if (!addon || !addon.allowedCategoryIds.includes(category.id))
      throw new QuoteRuleError('SELECTION_INVALID');
    if (pkg.includedAddonIds.includes(addonId)) {
      lines.push({ kind: 'ADDON', definitionId: addonId, amountMinor: 0n, included: true });
    } else if (pkg.optionalAddonIds.includes(addonId)) {
      lines.push({
        kind: 'ADDON',
        definitionId: addonId,
        amountMinor: rateOf(rates, 'ADDON', addonId),
        included: false,
      });
      duration += addon.durationMinutes;
    } else {
      throw new QuoteRuleError('SELECTION_INVALID');
    }
  }

  let subtotal = Money.zero(policy.currency);
  for (const line of lines) subtotal = subtotal.plus(Money.of(line.amountMinor, policy.currency));
  if (subtotal.exceeds(policy.maxAmountMinor)) throw new QuoteRuleError('AMOUNT_LIMIT_EXCEEDED');
  return {
    currency: policy.currency,
    lines,
    subtotalMinor: subtotal.amountMinor,
    totalMinor: subtotal.amountMinor,
    durationMinutes: duration,
  };
}

export type QuoteStatus = 'USABLE' | 'EXPIRED';

/**
 * Expiry = issue time + configured TTL (B-05), but never beyond the moment the
 * next scheduled price version takes effect: a quote never outlives the prices
 * it was computed from. Replays never extend validity.
 */
export function quoteExpiry(
  issuedAt: Date,
  ttlSeconds: number,
  nextVersionFrom: Date | null,
): Date {
  const byTtl = issuedAt.getTime() + ttlSeconds * 1000;
  const cap = nextVersionFrom?.getTime() ?? Number.POSITIVE_INFINITY;
  return new Date(Math.min(byTtl, cap));
}

export function quoteStatus(expiresAt: Date, now: Date): QuoteStatus {
  return now.getTime() < expiresAt.getTime() ? 'USABLE' : 'EXPIRED';
}
