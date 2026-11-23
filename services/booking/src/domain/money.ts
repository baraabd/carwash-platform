import { invalid } from './errors';

/**
 * Exact money held by a booking. Amounts are bigint counts of the currency's
 * minor unit, never binary floating point. The currency list and its scale
 * mirror the published `common/money` convention (closed list, ISO 4217 scale);
 * a value with an unexpected scale is refused instead of being rescaled.
 */
export const CURRENCY_SCALE = { SYP: 2, USD: 2 } as const;
export type Currency = keyof typeof CURRENCY_SCALE;

export interface Money {
  readonly currency: Currency;
  readonly amountMinor: bigint;
  readonly scale: number;
}

/** Wire form: `{currency, amountMinor: "<integer string>", scale}`. */
export interface MoneyWire {
  readonly currency: Currency;
  readonly amountMinor: string;
  readonly scale: number;
}

const MINOR = /^(0|-?[1-9][0-9]{0,17})$/;
/** 18 digits keeps every value inside PostgreSQL BIGINT. */
const LIMIT = 10n ** 18n;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.hasOwn(CURRENCY_SCALE, value);
}

export function money(currency: Currency, amountMinor: bigint): Money {
  if (amountMinor >= LIMIT || amountMinor <= -LIMIT) throw invalid('Amount is out of range.');
  return { currency, amountMinor, scale: CURRENCY_SCALE[currency] };
}

export function moneyFromWire(value: unknown, field: string): Money {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${field} must be a money object.`);
  }
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== 3 || !['currency', 'amountMinor', 'scale'].every((k) => keys.includes(k))) {
    throw invalid(`${field} has unexpected fields.`);
  }
  if (!isCurrency(v.currency)) throw invalid(`${field}.currency is not supported.`);
  if (typeof v.amountMinor !== 'string' || !MINOR.test(v.amountMinor)) {
    throw invalid(`${field}.amountMinor must be an integer string.`);
  }
  if (v.scale !== CURRENCY_SCALE[v.currency]) throw invalid(`${field}.scale is not supported.`);
  return money(v.currency, BigInt(v.amountMinor));
}

export function moneyToWire(value: Money): MoneyWire {
  return {
    currency: value.currency,
    amountMinor: value.amountMinor.toString(),
    scale: value.scale,
  };
}

export function sameMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.scale === b.scale && a.amountMinor === b.amountMinor;
}

export function sumMoney(currency: Currency, values: readonly Money[]): Money {
  let total = 0n;
  for (const value of values) {
    if (value.currency !== currency || value.scale !== CURRENCY_SCALE[currency]) {
      throw invalid('Currency mismatch.');
    }
    total += value.amountMinor;
  }
  return money(currency, total);
}
