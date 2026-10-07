import { ContractViolation } from './wire';

/** Canonical UTC instant with millisecond precision: 2026-10-07T08:30:00.000Z. */
export type UtcTimestamp = string & { readonly __utc: unique symbol };
/** Civil date without zone, interpreted in the owner's declared zone: 2026-10-07. */
export type LocalDate = string & { readonly __localDate: unique symbol };

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function utc(instant: Date): UtcTimestamp {
  if (!Number.isFinite(instant.getTime())) throw new ContractViolation('INVALID_TIMESTAMP', '$');
  return instant.toISOString() as UtcTimestamp;
}

export function parseUtc(value: unknown, path: string): UtcTimestamp {
  if (typeof value !== 'string' || !UTC.test(value)) {
    throw new ContractViolation('INVALID_TIMESTAMP', path);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
    throw new ContractViolation('INVALID_TIMESTAMP', path);
  }
  return value as UtcTimestamp;
}

export function parseLocalDate(value: unknown, path: string): LocalDate {
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new ContractViolation('INVALID_DATE', path);
  }
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new ContractViolation('INVALID_DATE', path);
  }
  return value as LocalDate;
}

/** IANA zone in which an owner interprets LocalDate/opening hours. Closed on purpose. */
export const BUSINESS_TIME_ZONES = ['Asia/Damascus'] as const;
export type BusinessTimeZone = (typeof BUSINESS_TIME_ZONES)[number];
