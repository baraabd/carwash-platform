/**
 * Exact money. Authoritative amounts are integers of MINOR units held as
 * bigint; no binary floating point ever touches them.
 *
 * Wire form (pricing.v1 / common Money): `{ currency, amountMinor, scale }`
 * where `amountMinor` is a canonical decimal string and `scale` is fixed per
 * currency. The currency list is CLOSED by the published contract; this table
 * mirrors it (Pricing cannot depend on @carwash/contracts until Lane E adds the
 * dependency) and tests/production/B/pricing-v1-conformance.test.mjs runs the
 * published parsers against real Pricing responses so drift fails the build.
 */
export const CONTRACT_CURRENCY_SCALES: Readonly<Record<string, number>> = Object.freeze({
  SYP: 2,
  USD: 2,
});

/** Non-negative canonical minor units; 18 digits fit PostgreSQL BIGINT. */
export const AMOUNT_MINOR = /^(0|[1-9][0-9]{0,17})$/;
export const CURRENCY = /^[A-Z]{3}$/;
const LIMIT = 10n ** 18n;

export interface MoneyWire {
  readonly currency: string;
  readonly amountMinor: string;
  readonly scale: number;
}

export type MoneyErrorCode = 'AMOUNT_INVALID' | 'CURRENCY_INVALID' | 'SCALE_INVALID';

export class MoneyError extends Error {
  constructor(readonly code: MoneyErrorCode) {
    super(code);
    this.name = 'MoneyError';
  }
}

/** The contract scale for a currency, or null when the contract does not list it. */
export function contractScale(currency: string): number | null {
  return Object.prototype.hasOwnProperty.call(CONTRACT_CURRENCY_SCALES, currency)
    ? (CONTRACT_CURRENCY_SCALES[currency] ?? null)
    : null;
}

export function moneyWire(currency: string, amountMinor: bigint): MoneyWire {
  const scale = contractScale(currency);
  if (scale === null) throw new MoneyError('CURRENCY_INVALID');
  if (amountMinor >= LIMIT || amountMinor <= -LIMIT) throw new MoneyError('AMOUNT_INVALID');
  return { currency, amountMinor: amountMinor.toString(), scale };
}

export interface ExactAmount {
  readonly currency: string;
  readonly amountMinor: bigint;
}

/**
 * Strict parse of a NON-NEGATIVE wire amount (prices are never negative).
 * Exactly the three keys; a JSON number, sign, exponent, fraction, unknown
 * currency or wrong scale is rejected instead of being rescaled.
 */
export function parseNonNegativeMoney(value: unknown): ExactAmount {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new MoneyError('AMOUNT_INVALID');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'amountMinor,currency,scale')
    throw new MoneyError('AMOUNT_INVALID');
  const { currency, amountMinor, scale } = input;
  if (typeof currency !== 'string' || !CURRENCY.test(currency))
    throw new MoneyError('CURRENCY_INVALID');
  const expected = contractScale(currency);
  if (expected === null) throw new MoneyError('CURRENCY_INVALID');
  if (scale !== expected) throw new MoneyError('SCALE_INVALID');
  if (typeof amountMinor !== 'string' || !AMOUNT_MINOR.test(amountMinor))
    throw new MoneyError('AMOUNT_INVALID');
  return { currency, amountMinor: BigInt(amountMinor) };
}
