/**
 * Exact money for Billing. Amounts are integer minor units held as bigint; the
 * wire form follows the published Lane E convention
 * `{ currency, amountMinor: "<integer string>", scale }` where the scale must
 * equal the currency's ISO 4217 minor unit. A value with any other scale is
 * rejected, never rescaled.
 *
 * The supported set mirrors `CURRENCIES` in `@carwash/contracts/common`
 * (SYP 2, USD 2). Billing cannot import that package until Lane E adds the
 * dependency (docs/production/B/CONTRACT_REQUEST_E_BILLING.md, CR-B-04); a change there must be
 * reflected here and in the migration CHECK.
 */
export const SUPPORTED_SCALES: Readonly<Record<string, number>> = { SYP: 2, USD: 2 };
const AMOUNT = /^(0|[1-9][0-9]{0,17})$/;
/** 18 digits keeps every value inside PostgreSQL BIGINT. */
const LIMIT = 10n ** 18n;

export class MoneyError extends Error {
  constructor(
    readonly code:
      'MONEY_INVALID' | 'CURRENCY_UNSUPPORTED' | 'CURRENCY_MISMATCH' | 'MONEY_OUT_OF_RANGE',
  ) {
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

  static zero(currency: string): Money {
    return Money.of(currency, 0n);
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

  plus(other: Money): Money {
    this.sameCurrency(other);
    return Money.of(this.currency, this.amountMinor + other.amountMinor);
  }

  minus(other: Money): Money {
    this.sameCurrency(other);
    return Money.of(this.currency, this.amountMinor - other.amountMinor);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  toWire(): MoneyWire {
    return { currency: this.currency, amountMinor: this.amountMinor.toString(), scale: this.scale };
  }

  private sameCurrency(other: Money): void {
    if (other.currency !== this.currency) throw new MoneyError('CURRENCY_MISMATCH');
  }
}
