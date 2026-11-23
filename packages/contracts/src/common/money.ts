import { ContractViolation, closed, oneOf } from './wire';

/**
 * Exact money on the wire. Amounts are integer counts of the currency's minor
 * unit encoded as a decimal string, never a binary float. Scale is fixed per
 * currency (ISO 4217 minor units) and travels with the value so a consumer can
 * reject a scale it does not understand instead of silently rescaling.
 *
 * The currency list is closed. Adding a currency is a contract change.
 */
export const CURRENCIES = { SYP: 2, USD: 2 } as const;
export type Currency = keyof typeof CURRENCIES;
const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];

export interface Money {
  readonly currency: Currency;
  /** Signed integer of minor units, e.g. "150000" = 1500.00 SYP. */
  readonly amountMinor: string;
  readonly scale: number;
}

const MINOR = /^(0|-?[1-9][0-9]{0,17})$/;
/** 18 digits keeps every value inside PostgreSQL BIGINT and NUMERIC(20, s). */
const LIMIT = 10n ** 18n;

export function money(currency: Currency, amountMinor: bigint): Money {
  if (amountMinor >= LIMIT || amountMinor <= -LIMIT) {
    throw new ContractViolation('MONEY_OUT_OF_RANGE', '$');
  }
  return { currency, amountMinor: amountMinor.toString(), scale: CURRENCIES[currency] };
}

export function minorUnits(value: Money): bigint {
  return BigInt(value.amountMinor);
}

export function parseMoney(value: unknown, path: string): Money {
  const v = closed(value, path, ['currency', 'amountMinor', 'scale']);
  const currency = oneOf(v.currency, `${path}.currency`, CURRENCY_CODES);
  if (typeof v.amountMinor !== 'string' || !MINOR.test(v.amountMinor)) {
    throw new ContractViolation('INVALID_MONEY_AMOUNT', `${path}.amountMinor`);
  }
  if (v.scale !== CURRENCIES[currency]) {
    throw new ContractViolation('UNSUPPORTED_MONEY_SCALE', `${path}.scale`);
  }
  return { currency, amountMinor: v.amountMinor, scale: CURRENCIES[currency] };
}

/** A non-negative amount; prices, quotes and charges are never negative. */
export function parseNonNegativeMoney(value: unknown, path: string): Money {
  const parsed = parseMoney(value, path);
  if (parsed.amountMinor.startsWith('-')) {
    throw new ContractViolation('NEGATIVE_MONEY', `${path}.amountMinor`);
  }
  return parsed;
}

function same(a: Money, b: Money): void {
  if (a.currency !== b.currency || a.scale !== b.scale) {
    throw new ContractViolation('CURRENCY_MISMATCH', '$');
  }
}

export function addMoney(a: Money, b: Money): Money {
  same(a, b);
  return money(a.currency, minorUnits(a) + minorUnits(b));
}

export function subtractMoney(a: Money, b: Money): Money {
  same(a, b);
  return money(a.currency, minorUnits(a) - minorUnits(b));
}

export function multiplyMoney(a: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new ContractViolation('INVALID_QUANTITY', '$');
  }
  return money(a.currency, minorUnits(a) * BigInt(quantity));
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  same(a, b);
  const left = minorUnits(a);
  const right = minorUnits(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sumMoney(currency: Currency, values: readonly Money[]): Money {
  return values.reduce((total, value) => addMoney(total, value), money(currency, 0n));
}
