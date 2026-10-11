/**
 * Exact money as integer minor units (bigint). The currency list and scale
 * mirror the published billing.v1 events; an amount Wallet cannot interpret is
 * rejected, never rescaled. Wallet never creates money: every amount it holds
 * is copied from a Billing event.
 */
export const CURRENCY_SCALE = { SYP: 2, USD: 2 } as const;
export type Currency = keyof typeof CURRENCY_SCALE;
export const CURRENCIES = Object.keys(CURRENCY_SCALE) as Currency[];

const MINOR = /^(0|[1-9][0-9]{0,17})$/;

export class MoneyError extends Error {
  constructor(readonly code: 'AMOUNT_INVALID' | 'CURRENCY_INVALID' | 'CURRENCY_MISMATCH') {
    super(code);
    this.name = 'MoneyError';
  }
}

export interface Amount {
  readonly currency: Currency;
  readonly minor: bigint;
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

export function amountOf(currency: unknown, minor: bigint): Amount {
  if (!isCurrency(currency)) throw new MoneyError('CURRENCY_INVALID');
  if (minor < 0n || minor >= 10n ** 18n) throw new MoneyError('AMOUNT_INVALID');
  return { currency, minor };
}

/** Parses the event wire form `{currency, amountMinor, scale}`. */
export function parseWireAmount(value: {
  readonly currency: string;
  readonly amountMinor: string;
  readonly scale: number;
}): Amount {
  if (!isCurrency(value.currency) || value.scale !== CURRENCY_SCALE[value.currency])
    throw new MoneyError('CURRENCY_INVALID');
  if (!MINOR.test(value.amountMinor)) throw new MoneyError('AMOUNT_INVALID');
  return amountOf(value.currency, BigInt(value.amountMinor));
}

export interface MoneyView {
  readonly currency: Currency;
  readonly amountMinor: string;
  readonly scale: number;
}

/** Signed view: a projection balance may be transiently negative (see custody.ts). */
export function moneyView(currency: Currency, minor: bigint): MoneyView {
  return { currency, amountMinor: minor.toString(), scale: CURRENCY_SCALE[currency] };
}
