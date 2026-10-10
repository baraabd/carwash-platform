import type { Money } from './api/types';

/**
 * Exact money for the operator UI. Authoritative amounts are integer minor
 * units carried as decimal strings with their scale (contracts `Money`); they
 * are never converted to a JavaScript Number. The reference used
 * `Math.round(n).toLocaleString('en-US')` on demo Numbers; the presentation
 * (grouped Latin digits followed by `<span class="currency">ل.س</span>`) is kept.
 */

const CURRENCY_LABEL: Readonly<Record<Money['currency'], string>> = {
  SYP: 'ل.س',
  // PENDING OWNER DESIGN: the approved reference only shows Syrian pounds.
  USD: 'USD',
};

const pow10 = (scale: number): bigint => 10n ** BigInt(scale);

export const minor = (value: Money): bigint => BigInt(value.amountMinor);

/** Grouped major units, exact; a non-zero fraction is shown, never rounded away. */
export function formatMajor(value: Money): string {
  const units = minor(value);
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = pow10(value.scale);
  const whole = (abs / base).toLocaleString('en-US');
  const fraction = abs % base;
  const text =
    fraction === 0n ? whole : `${whole}.${fraction.toString().padStart(value.scale, '0')}`;
  return negative ? `-${text}` : text;
}

/** Reference `money(n)` markup. */
export const moneyHtml = (value: Money): string =>
  `${formatMajor(value)}<span class="currency">${CURRENCY_LABEL[value.currency]}</span>`;

export const zeroLike = (value: Money): Money => ({
  currency: value.currency,
  amountMinor: '0',
  scale: value.scale,
});

/** Sum of amounts in one currency. Mixed currencies are refused, never coerced. */
export function sumMoney(values: readonly Money[], template: Money): Money {
  let total = 0n;
  for (const value of values) {
    if (value.currency !== template.currency || value.scale !== template.scale) {
      throw new Error('MIXED_CURRENCY');
    }
    total += minor(value);
  }
  return { currency: template.currency, amountMinor: total.toString(), scale: template.scale };
}

/** Reference `digitValue`: Arabic-Indic and Persian digits, separators removed. */
export function digitValue(v: string): string {
  return String(v)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/[,٬\s]/g, '');
}

/**
 * Reference `validCash` rule on exact units: 1-9 whole digits that equal the
 * full total. Partial, over and fractional amounts are refused.
 */
export function cashMatches(input: string, total: Money): boolean {
  const v = digitValue(input);
  if (!/^\d{1,9}$/.test(v)) return false;
  return BigInt(v) * pow10(total.scale) === minor(total);
}

/** The Money that is declared to the server: exactly the booking total. */
export const declaredCash = (total: Money): Money => ({
  currency: total.currency,
  amountMinor: total.amountMinor,
  scale: total.scale,
});
