/**
 * Exact money for Subscription plan prices. Integer minor units held as bigint;
 * wire form `{ currency, amountMinor: "<integer string>", scale }` with the scale
 * equal to the currency's minor unit. Any other scale is rejected, never rescaled.
 *
 * The supported set mirrors `CURRENCIES` in `@carwash/contracts/common`
 * (SYP 2, USD 2). Subscription does not depend on that package (adding it is a
 * Lane E lockfile change), so a change there must be reflected here and in the
 * migration CHECK. Which currency a plan is sold in is owner policy (B-03): the
 * plan revision states it explicitly; nothing is defaulted.
 */
export const SUPPORTED_SCALES: Readonly<Record<string, number>> = { SYP: 2, USD: 2 };
const AMOUNT = /^(0|[1-9][0-9]{0,17})$/;
const LIMIT = 10n ** 18n;

export class MoneyError extends Error {
  constructor(readonly code: 'MONEY_INVALID' | 'CURRENCY_UNSUPPORTED' | 'MONEY_OUT_OF_RANGE') {
    super(code);
    this.name = 'MoneyError';
  }
}

export interface MoneyWire {
  readonly currency: string;
  readonly amountMinor: string;
  readonly scale: number;
}

export class Money {
  private constructor(
    readonly currency: string,
    readonly amountMinor: bigint,
  ) {}

  static of(currency: string, amountMinor: bigint): Money {
    if (SUPPORTED_SCALES[currency] === undefined) throw new MoneyError('CURRENCY_UNSUPPORTED');
    if (amountMinor < 0n) throw new MoneyError('MONEY_INVALID');
    if (amountMinor >= LIMIT) throw new MoneyError('MONEY_OUT_OF_RANGE');
    return new Money(currency, amountMinor);
  }

  /** Strict parse of the published wire shape; unknown fields are rejected. */
  static parse(value: unknown): Money {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new MoneyError('MONEY_INVALID');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'amountMinor,currency,scale')
      throw new MoneyError('MONEY_INVALID');
    const { currency, amountMinor, scale } = input;
    if (typeof currency !== 'string' || SUPPORTED_SCALES[currency] === undefined)
      throw new MoneyError('CURRENCY_UNSUPPORTED');
    if (scale !== SUPPORTED_SCALES[currency]) throw new MoneyError('CURRENCY_UNSUPPORTED');
    if (typeof amountMinor !== 'string' || !AMOUNT.test(amountMinor))
      throw new MoneyError('MONEY_INVALID');
    return Money.of(currency, BigInt(amountMinor));
  }

  get scale(): number {
    return SUPPORTED_SCALES[this.currency] ?? 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  toWire(): MoneyWire {
    return { currency: this.currency, amountMinor: this.amountMinor.toString(), scale: this.scale };
  }
}
