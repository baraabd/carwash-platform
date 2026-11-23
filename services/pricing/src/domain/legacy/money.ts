/**
 * Exact money. Amounts are non-negative integers in MINOR units held as bigint;
 * no binary floating point ever touches an authoritative amount. The wire form
 * is a canonical decimal string (no sign, leading zero, exponent or fraction).
 */
export const AMOUNT_MINOR = /^(0|[1-9][0-9]{0,17})$/;
export const CURRENCY = /^[A-Z]{3}$/;

export type MoneyErrorCode = 'AMOUNT_INVALID' | 'CURRENCY_INVALID' | 'CURRENCY_MISMATCH';

export class MoneyError extends Error {
  constructor(readonly code: MoneyErrorCode) {
    super(code);
    this.name = 'MoneyError';
  }
}

export interface MoneyWire {
  readonly amountMinor: string;
  readonly currency: string;
}

export class Money {
  private constructor(
    readonly amountMinor: bigint,
    readonly currency: string,
  ) {}

  static of(amountMinor: bigint, currency: string): Money {
    if (!CURRENCY.test(currency)) throw new MoneyError('CURRENCY_INVALID');
    if (amountMinor < 0n) throw new MoneyError('AMOUNT_INVALID');
    return new Money(amountMinor, currency);
  }

  static zero(currency: string): Money {
    return Money.of(0n, currency);
  }

  /** Parses the canonical wire string; anything else (incl. JSON numbers) is rejected. */
  static parseMinor(value: unknown, currency: string): Money {
    if (typeof value !== 'string' || !AMOUNT_MINOR.test(value))
      throw new MoneyError('AMOUNT_INVALID');
    return Money.of(BigInt(value), currency);
  }

  plus(other: Money): Money {
    if (other.currency !== this.currency) throw new MoneyError('CURRENCY_MISMATCH');
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  exceeds(limitMinor: bigint): boolean {
    return this.amountMinor > limitMinor;
  }

  toWire(): MoneyWire {
    return { amountMinor: this.amountMinor.toString(), currency: this.currency };
  }
}
