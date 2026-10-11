import { chargeableAddonIds, type CatalogSnapshot } from './catalog-snapshot';
import type { CurrencyPolicy } from './currency-policy';
import { AMOUNT_MINOR } from './money';

/**
 * A price version is an immutable set of exact rates for ONE catalog revision:
 *   PACKAGE  — base price of a package,
 *   VEHICLE  — surcharge of a vehicle category (may be zero),
 *   ADDON    — price of an optional add-on.
 * The approved bill keeps the vehicle surcharge as its own line, so it is never
 * folded into the package rate. Included add-ons are never charged and must not
 * carry a rate.
 */
export const RATE_KINDS = ['PACKAGE', 'VEHICLE', 'ADDON'] as const;
export type RateKind = (typeof RATE_KINDS)[number];

export interface Rate {
  readonly kind: RateKind;
  readonly definitionId: string;
  readonly amountMinor: bigint;
}

export type PriceRuleCode =
  | 'RATES_MALFORMED'
  | 'RATE_DUPLICATE'
  | 'RATE_UNKNOWN_DEFINITION'
  | 'RATE_MISSING'
  | 'RATE_NOT_CHARGEABLE'
  | 'AMOUNT_LIMIT_EXCEEDED';

export class PriceRuleError extends Error {
  constructor(
    readonly code: PriceRuleCode,
    readonly path: string,
  ) {
    super(code);
    this.name = 'PriceRuleError';
  }
}

const DEFINITION_ID = /^[a-z][a-z0-9-]{1,47}$/;
const MAX_RATES = 500;

function kindOrder(kind: RateKind): number {
  return RATE_KINDS.indexOf(kind);
}

/** Strict structural parse; canonical order is (kind, definitionId). */
export function normalizeRates(raw: unknown, policy: CurrencyPolicy): Rate[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RATES)
    throw new PriceRuleError('RATES_MALFORMED', 'rates');
  const rates = raw.map((entry: unknown, index): Rate => {
    const path = `rates[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      throw new PriceRuleError('RATES_MALFORMED', path);
    const rate = entry as Record<string, unknown>;
    if (Object.keys(rate).sort().join(',') !== 'amountMinor,definitionId,kind')
      throw new PriceRuleError('RATES_MALFORMED', path);
    const { kind, definitionId, amountMinor } = rate;
    if (typeof kind !== 'string' || !(RATE_KINDS as readonly string[]).includes(kind))
      throw new PriceRuleError('RATES_MALFORMED', `${path}.kind`);
    if (typeof definitionId !== 'string' || !DEFINITION_ID.test(definitionId))
      throw new PriceRuleError('RATES_MALFORMED', `${path}.definitionId`);
    if (typeof amountMinor !== 'string' || !AMOUNT_MINOR.test(amountMinor))
      throw new PriceRuleError('RATES_MALFORMED', `${path}.amountMinor`);
    const amount = BigInt(amountMinor);
    if (amount > policy.maxAmountMinor)
      throw new PriceRuleError('AMOUNT_LIMIT_EXCEEDED', `${path}.amountMinor`);
    return { kind: kind as RateKind, definitionId, amountMinor: amount };
  });
  const seen = new Set<string>();
  for (const [index, rate] of rates.entries()) {
    const key = `${rate.kind}:${rate.definitionId}`;
    if (seen.has(key)) throw new PriceRuleError('RATE_DUPLICATE', `rates[${index}]`);
    seen.add(key);
  }
  return rates.sort(
    (a, b) =>
      kindOrder(a.kind) - kindOrder(b.kind) ||
      (a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0),
  );
}

/**
 * Every package and category of the catalog revision needs exactly one rate,
 * every chargeable (optional somewhere) add-on needs one, and no rate may name
 * an unknown or never-chargeable definition. Nothing is defaulted to zero.
 */
export function validateRatesAgainstCatalog(
  rates: readonly Rate[],
  snapshot: CatalogSnapshot,
): void {
  const required: Record<RateKind, Set<string>> = {
    PACKAGE: new Set(snapshot.packages.map((p) => p.id)),
    VEHICLE: new Set(snapshot.categories.map((c) => c.id)),
    ADDON: chargeableAddonIds(snapshot),
  };
  const knownAddons = new Set(snapshot.addons.map((a) => a.id));
  for (const rate of rates) {
    const path = `${rate.kind}:${rate.definitionId}`;
    if (
      rate.kind === 'ADDON' &&
      knownAddons.has(rate.definitionId) &&
      !required.ADDON.has(rate.definitionId)
    )
      throw new PriceRuleError('RATE_NOT_CHARGEABLE', path);
    if (!required[rate.kind].has(rate.definitionId))
      throw new PriceRuleError('RATE_UNKNOWN_DEFINITION', path);
  }
  for (const kind of RATE_KINDS)
    for (const id of required[kind])
      if (!rates.some((rate) => rate.kind === kind && rate.definitionId === id))
        throw new PriceRuleError('RATE_MISSING', `${kind}:${id}`);
}

export interface VersionHead {
  readonly version: number;
  readonly effectiveFrom: Date;
}

export type PricePublicationRejection =
  | 'VERSION_CONFLICT'
  | 'EFFECTIVE_FROM_IN_PAST'
  | 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS'
  | 'EFFECTIVE_FROM_TOO_FAR'
  | 'PRICE_PRECEDES_CATALOG';

export type PricePublicationPlan =
  | { readonly accepted: true; readonly version: number; readonly effectiveFrom: Date }
  | { readonly accepted: false; readonly reason: PricePublicationRejection };

export const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Price versions form one linear chain with strictly increasing effective
 * times, exactly like catalog revisions, and a price version can never take
 * effect before the catalog revision it prices.
 */
export function planPriceVersion(input: {
  readonly head: VersionHead | null;
  readonly expectedVersion: number;
  readonly effectiveFrom: Date | null;
  readonly now: Date;
  readonly catalogEffectiveFrom: Date;
}): PricePublicationPlan {
  const current = input.head?.version ?? 0;
  if (input.expectedVersion !== current) return { accepted: false, reason: 'VERSION_CONFLICT' };
  const effectiveFrom = input.effectiveFrom ?? input.now;
  if (effectiveFrom.getTime() < input.now.getTime())
    return { accepted: false, reason: 'EFFECTIVE_FROM_IN_PAST' };
  if (effectiveFrom.getTime() - input.now.getTime() > MAX_SCHEDULE_AHEAD_MS)
    return { accepted: false, reason: 'EFFECTIVE_FROM_TOO_FAR' };
  if (input.head && effectiveFrom.getTime() <= input.head.effectiveFrom.getTime())
    return { accepted: false, reason: 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS' };
  if (effectiveFrom.getTime() < input.catalogEffectiveFrom.getTime())
    return { accepted: false, reason: 'PRICE_PRECEDES_CATALOG' };
  return { accepted: true, version: current + 1, effectiveFrom };
}
