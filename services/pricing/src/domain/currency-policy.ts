import { AMOUNT_MINOR, CURRENCY } from './money';

/**
 * The accepted currency policy: currency, minor-unit exponent and maximum
 * amount, identified by an immutable revision. Owner decision B-03 is still
 * OPEN, so no value is built in: without a configured policy Pricing refuses to
 * publish prices or issue quotes (POLICY_UNAVAILABLE) instead of guessing.
 */
export interface CurrencyPolicy {
  readonly revision: string;
  readonly currency: string;
  readonly minorUnitExponent: number;
  readonly maxAmountMinor: bigint;
}

export const POLICY_REVISION = /^[A-Za-z0-9._-]{1,64}$/;

export class CurrencyPolicyError extends Error {
  constructor(readonly field: string) {
    super(`CURRENCY_POLICY_INVALID:${field}`);
    this.name = 'CurrencyPolicyError';
  }
}

export function parseCurrencyPolicy(raw: unknown): CurrencyPolicy {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new CurrencyPolicyError('policy');
  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(',');
  if (keys !== 'currency,maxAmountMinor,minorUnitExponent,revision')
    throw new CurrencyPolicyError('keys');
  const { revision, currency, minorUnitExponent, maxAmountMinor } = input;
  if (typeof revision !== 'string' || !POLICY_REVISION.test(revision))
    throw new CurrencyPolicyError('revision');
  if (typeof currency !== 'string' || !CURRENCY.test(currency))
    throw new CurrencyPolicyError('currency');
  if (
    typeof minorUnitExponent !== 'number' ||
    !Number.isInteger(minorUnitExponent) ||
    minorUnitExponent < 0 ||
    minorUnitExponent > 4
  )
    throw new CurrencyPolicyError('minorUnitExponent');
  if (
    typeof maxAmountMinor !== 'string' ||
    !AMOUNT_MINOR.test(maxAmountMinor) ||
    maxAmountMinor === '0'
  )
    throw new CurrencyPolicyError('maxAmountMinor');
  return { revision, currency, minorUnitExponent, maxAmountMinor: BigInt(maxAmountMinor) };
}
