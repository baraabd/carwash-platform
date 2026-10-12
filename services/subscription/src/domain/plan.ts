import { Money, MoneyError } from './money';

/**
 * A subscription PLAN is a stable code with a linear chain of immutable
 * revisions. Each revision states, as data published by an authorized staff
 * member, the terms a customer buys: price, wash units per period, period
 * length and the catalog packages a unit may be spent on. None of these values
 * is a code default: the owner decisions (B-09) are recorded by publishing a
 * revision, and an unpublished plan cannot be bought.
 *
 * Revisions take effect at strictly increasing instants (like catalog and price
 * versions). `available: false` stops new sales from that instant; existing
 * subscriptions keep the terms snapshotted when they were bought or renewed.
 */
export const PLAN_CODE = /^[a-z][a-z0-9-]{2,40}$/;
/** Catalog definition id convention (services/catalog). */
export const PACKAGE_ID = /^[a-z][a-z0-9-]{1,47}$/;
export const MAX_WASH_UNITS = 100;
export const MAX_PERIOD_DAYS = 366;
export const MAX_COVERED_PACKAGES = 20;
export const MAX_DISPLAY_NAME = 80;
export const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanRuleCode = 'TERMS_MALFORMED' | 'CURRENCY_UNSUPPORTED' | 'PRICE_INVALID';

export class PlanRuleError extends Error {
  constructor(
    readonly code: PlanRuleCode,
    readonly path: string,
  ) {
    super(code);
    this.name = 'PlanRuleError';
  }
}

export interface PlanTerms {
  readonly displayName: string;
  readonly price: Money;
  readonly washUnits: number;
  readonly periodDays: number;
  /** Sorted, unique catalog package ids a unit may be spent on. */
  readonly coveredPackageIds: readonly string[];
  readonly available: boolean;
}

// Printable text only: no control characters, no leading/trailing whitespace.
const DISPLAY_NAME = /^[^\p{Cc}\p{Cf}\s](?:[^\p{Cc}\p{Cf}]*[^\p{Cc}\p{Cf}\s])?$/u;

function integerIn(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new PlanRuleError('TERMS_MALFORMED', path);
  return value;
}

/** Strict structural parse of the published terms. Unknown fields are rejected. */
export function normalizePlanTerms(raw: unknown): PlanTerms {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new PlanRuleError('TERMS_MALFORMED', 'terms');
  const input = raw as Record<string, unknown>;
  const keys = 'available,coveredPackageIds,displayName,periodDays,price,washUnits';
  if (Object.keys(input).sort().join(',') !== keys)
    throw new PlanRuleError('TERMS_MALFORMED', 'terms');
  const { displayName, price, washUnits, periodDays, coveredPackageIds, available } = input;
  if (
    typeof displayName !== 'string' ||
    [...displayName].length > MAX_DISPLAY_NAME ||
    !DISPLAY_NAME.test(displayName)
  )
    throw new PlanRuleError('TERMS_MALFORMED', 'displayName');
  let money: Money;
  try {
    money = Money.parse(price);
  } catch (error: unknown) {
    if (error instanceof MoneyError && error.code === 'CURRENCY_UNSUPPORTED')
      throw new PlanRuleError('CURRENCY_UNSUPPORTED', 'price');
    throw new PlanRuleError('TERMS_MALFORMED', 'price');
  }
  // A free plan is a product decision nobody approved; refuse rather than allow.
  if (money.amountMinor === 0n) throw new PlanRuleError('PRICE_INVALID', 'price');
  if (typeof available !== 'boolean') throw new PlanRuleError('TERMS_MALFORMED', 'available');
  if (
    !Array.isArray(coveredPackageIds) ||
    coveredPackageIds.length === 0 ||
    coveredPackageIds.length > MAX_COVERED_PACKAGES
  )
    throw new PlanRuleError('TERMS_MALFORMED', 'coveredPackageIds');
  const covered = new Set<string>();
  for (const [index, id] of coveredPackageIds.entries()) {
    if (typeof id !== 'string' || !PACKAGE_ID.test(id) || covered.has(id))
      throw new PlanRuleError('TERMS_MALFORMED', `coveredPackageIds[${index}]`);
    covered.add(id);
  }
  return {
    displayName,
    price: money,
    washUnits: integerIn(washUnits, 1, MAX_WASH_UNITS, 'washUnits'),
    periodDays: integerIn(periodDays, 1, MAX_PERIOD_DAYS, 'periodDays'),
    coveredPackageIds: [...covered].sort(),
    available,
  };
}

export interface RevisionHead {
  readonly revision: number;
  readonly effectiveFrom: Date;
}

export type RevisionRejection =
  | 'REVISION_CONFLICT'
  | 'EFFECTIVE_FROM_IN_PAST'
  | 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS'
  | 'EFFECTIVE_FROM_TOO_FAR';

export type RevisionPlan =
  | { readonly accepted: true; readonly revision: number; readonly effectiveFrom: Date }
  | { readonly accepted: false; readonly reason: RevisionRejection };

/** One linear chain per plan code; optimistic on the expected head revision. */
export function planRevision(input: {
  readonly head: RevisionHead | null;
  readonly expectedRevision: number;
  readonly effectiveFrom: Date | null;
  readonly now: Date;
}): RevisionPlan {
  const current = input.head?.revision ?? 0;
  if (input.expectedRevision !== current) return { accepted: false, reason: 'REVISION_CONFLICT' };
  const effectiveFrom = input.effectiveFrom ?? input.now;
  if (effectiveFrom.getTime() < input.now.getTime())
    return { accepted: false, reason: 'EFFECTIVE_FROM_IN_PAST' };
  if (effectiveFrom.getTime() - input.now.getTime() > MAX_SCHEDULE_AHEAD_MS)
    return { accepted: false, reason: 'EFFECTIVE_FROM_TOO_FAR' };
  if (input.head && effectiveFrom.getTime() <= input.head.effectiveFrom.getTime())
    return { accepted: false, reason: 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS' };
  return { accepted: true, revision: current + 1, effectiveFrom };
}

/** The revision in force at `at`: the latest whose effectiveFrom <= at. */
export function revisionInForce<T extends RevisionHead>(
  revisions: readonly T[],
  at: Date,
): T | null {
  let found: T | null = null;
  for (const revision of revisions)
    if (
      revision.effectiveFrom.getTime() <= at.getTime() &&
      (!found || revision.revision > found.revision)
    )
      found = revision;
  return found;
}
