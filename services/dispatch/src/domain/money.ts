import { invalid } from './errors';

/**
 * Exact money for the technician's cash declaration. Integer minor units
 * (bigint), explicit currency and scale, mirroring the published
 * `common/money` wire form `{currency, amountMinor: "<integer>", scale}`.
 * Dispatch never stores a price; it stores what the technician declared.
 */
export const CURRENCY_SCALE = { SYP: 2, USD: 2 } as const;
export type Currency = keyof typeof CURRENCY_SCALE;

export interface Money {
  readonly currency: Currency;
  readonly amountMinor: bigint;
  readonly scale: number;
}

export interface MoneyWire {
  readonly currency: Currency;
  readonly amountMinor: string;
  readonly scale: number;
}

/** Positive, at most 18 digits (inside PostgreSQL BIGINT). */
const POSITIVE_MINOR = /^[1-9][0-9]{0,17}$/;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.hasOwn(CURRENCY_SCALE, value);
}

export function positiveMoneyFromWire(value: unknown, field: string): Money {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${field} must be a money object.`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 3 || !['currency', 'amountMinor', 'scale'].every((k) => keys.includes(k))) {
    throw invalid(`${field} has unexpected fields.`);
  }
  if (!isCurrency(record.currency)) throw invalid(`${field}.currency is not supported.`);
  if (typeof record.amountMinor !== 'string' || !POSITIVE_MINOR.test(record.amountMinor)) {
    throw invalid(`${field}.amountMinor must be a positive integer string.`);
  }
  if (record.scale !== CURRENCY_SCALE[record.currency]) {
    throw invalid(`${field}.scale is not supported.`);
  }
  return {
    currency: record.currency,
    amountMinor: BigInt(record.amountMinor),
    scale: CURRENCY_SCALE[record.currency],
  };
}

export function moneyToWire(value: Money): MoneyWire {
  return {
    currency: value.currency,
    amountMinor: value.amountMinor.toString(),
    scale: value.scale,
  };
}
