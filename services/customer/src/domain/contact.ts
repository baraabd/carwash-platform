import { CustomerDomainError } from './errors';
import { codePointLength, hasControlCharacters, latinDigits, singleLine } from './text';

/**
 * Contact rules mirror the approved contact screen (docs/customer/C011):
 * a name of at least two characters (60 max) and a number of 8-15 digits with an
 * optional leading "+". Arabic-Indic digits, spaces, "()" and "-" are accepted
 * on input. The check is a format check only; it never claims reachability,
 * ownership or E.164 validity, and no country prefix is assumed.
 */
export const DISPLAY_NAME_MAX = 60;
export const PHONE_RAW_MAX = 24;

export function parseDisplayName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > DISPLAY_NAME_MAX * 4) {
    throw new CustomerDomainError('INVALID_DISPLAY_NAME', 'displayName');
  }
  const value = singleLine(raw);
  const length = codePointLength(value);
  if (length < 2 || length > DISPLAY_NAME_MAX || hasControlCharacters(value)) {
    throw new CustomerDomainError('INVALID_DISPLAY_NAME', 'displayName');
  }
  return value;
}

/** Returns the stored form: optional "+" followed by Latin digits only. */
export function parsePhone(raw: unknown): string {
  if (typeof raw !== 'string' || codePointLength(raw) > PHONE_RAW_MAX) {
    throw new CustomerDomainError('INVALID_PHONE', 'phone');
  }
  const compact = latinDigits(raw.trim()).replace(/[\s()-]/g, '');
  if (!/^\+?[0-9]{8,15}$/.test(compact)) {
    throw new CustomerDomainError('INVALID_PHONE', 'phone');
  }
  return compact;
}

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export function parseLocale(raw: unknown): Locale {
  const found = LOCALES.find((locale) => locale === raw);
  if (!found) throw new CustomerDomainError('INVALID_LOCALE', 'preferredLocale');
  return found;
}
