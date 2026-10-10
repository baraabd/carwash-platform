/**
 * Exact money for display and input. Amounts are integer minor units carried
 * as decimal strings with an explicit currency and scale; nothing here ever
 * converts an amount to a binary floating-point number.
 */
export interface MoneyWire {
  readonly currency: string;
  readonly amountMinor: string;
  readonly scale: number;
}

const MINOR = /^(0|[1-9][0-9]{0,17})$/;

/** "150050" with scale 2 → "1,500.50" (grouping is display only). */
export function formatMoney(money: MoneyWire): string {
  if (!MINOR.test(money.amountMinor) || !Number.isSafeInteger(money.scale) || money.scale < 0)
    return '—';
  const digits = money.amountMinor.padStart(money.scale + 1, '0');
  const whole = digits.slice(0, digits.length - money.scale);
  const fraction = money.scale > 0 ? digits.slice(digits.length - money.scale) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${fraction ? `${grouped}.${fraction}` : grouped} ${money.currency}`;
}

export type AmountProblem = 'AMOUNT_REQUIRED' | 'AMOUNT_INVALID' | 'AMOUNT_TOO_PRECISE';

/**
 * Parses what finance typed ("1500", "1500.5", "1,500.50") into exact minor
 * units for the obligation's currency and scale. More fraction digits than
 * the scale is refused, never rounded.
 */
export function parseAmount(
  raw: string,
  currency: string,
  scale: number,
): { ok: true; value: MoneyWire } | { ok: false; problem: AmountProblem } {
  const text = raw.trim().replaceAll(',', '');
  if (text === '') return { ok: false, problem: 'AMOUNT_REQUIRED' };
  const match = /^(0|[1-9][0-9]{0,15})(?:\.([0-9]+))?$/.exec(text);
  if (!match) return { ok: false, problem: 'AMOUNT_INVALID' };
  const fraction = match[2] ?? '';
  if (fraction.length > scale) return { ok: false, problem: 'AMOUNT_TOO_PRECISE' };
  const minor = `${match[1]}${fraction.padEnd(scale, '0')}`.replace(/^0+(?=\d)/, '');
  if (!MINOR.test(minor)) return { ok: false, problem: 'AMOUNT_INVALID' };
  return { ok: true, value: { currency, amountMinor: minor, scale } };
}

/** Attempts Billing still has under review (a review case may be opened). */
export const OPEN_ATTEMPT_STATUSES = ['PENDING_REVIEW', 'UNKNOWN'] as const;

export function isOpenAttempt(status: string): boolean {
  return OPEN_ATTEMPT_STATUSES.some((s) => s === status);
}
