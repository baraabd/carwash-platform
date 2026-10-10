/**
 * Report rules: reporting periods and buckets, exact growth and averages,
 * source-stream freshness and RFC 4180 CSV.
 *
 * Pure domain. Every figure a report shows is computed from Reporting's own
 * projections; nothing here reads or decides an owner's state, and nothing
 * here ever uses a binary float for money or a ratio.
 */
import { OperationsRuleError, instantInput, type OperationsSource } from './operations';

/* ------------------------------ periods ----------------------------------- */

/** Closed set of report time zones. Both have whole-hour UTC offsets. */
export const REPORT_TIME_ZONES = ['UTC', 'Asia/Damascus'] as const;
export type ReportTimeZone = (typeof REPORT_TIME_ZONES)[number];

export const REPORT_GRANULARITIES = ['day', 'hour'] as const;
export type ReportGranularity = (typeof REPORT_GRANULARITIES)[number];

/** Upper bounds that keep every series (and every export) small and bounded. */
export const MAX_DAY_BUCKETS = 92;
export const MAX_HOUR_BUCKETS = 168;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface ReportPeriod {
  readonly from: Date;
  readonly to: Date;
  readonly timezone: ReportTimeZone;
  readonly granularity: ReportGranularity;
  /** The equal-length period immediately before `from`, for growth. */
  readonly previous: { readonly from: Date; readonly to: Date };
  /** Start of every bucket, ascending; the last bucket ends at `to`. */
  readonly buckets: readonly Date[];
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The civil date of `instant` in `timeZone`, as YYYY-MM-DD. */
export function localDateOf(instant: Date, timeZone: string): string {
  return new Date(instant.getTime() + offsetMs(instant, timeZone)).toISOString().slice(0, 10);
}

/** The UTC instant at which civil `date` begins in `timeZone` (IANA rules via Intl). */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const naive = Date.parse(`${date}T00:00:00.000Z`);
  // Two passes converge across an offset change near midnight.
  let utc = naive - offsetMs(new Date(naive), timeZone);
  utc = naive - offsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

function nextLocalMidnight(instant: Date, timeZone: string): Date {
  const date = localDateOf(instant, timeZone);
  const next = new Date(Date.parse(`${date}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10);
  return startOfLocalDay(next, timeZone);
}

function isLocalMidnight(instant: Date, timeZone: string): boolean {
  return startOfLocalDay(localDateOf(instant, timeZone), timeZone).getTime() === instant.getTime();
}

function closed<T extends string>(value: unknown, allowed: readonly T[], code: string): T {
  const found = allowed.find((a) => a === value);
  if (found === undefined) throw new OperationsRuleError(code);
  return found;
}

/**
 * Validates a report period. `from`/`to` are canonical UTC instants
 * (`...Z`), `to` is exclusive, and both lie on a bucket boundary of the
 * requested time zone (local midnight for `day`, a whole hour for `hour`), so
 * every bucket is complete. Bounded: at most 92 days or 168 hours.
 */
export function reportPeriod(input: {
  readonly from: unknown;
  readonly to: unknown;
  readonly timezone: unknown;
  readonly granularity: unknown;
}): ReportPeriod {
  const timezone = closed(input.timezone, REPORT_TIME_ZONES, 'INVALID_TIMEZONE');
  const granularity = closed(input.granularity, REPORT_GRANULARITIES, 'INVALID_GRANULARITY');
  const from = instantInput(input.from, 'INVALID_FROM');
  const to = instantInput(input.to, 'INVALID_TO');
  if (to.getTime() <= from.getTime()) throw new OperationsRuleError('INVALID_PERIOD');
  const buckets: Date[] = [];
  if (granularity === 'hour') {
    if (from.getTime() % HOUR_MS !== 0 || to.getTime() % HOUR_MS !== 0)
      throw new OperationsRuleError('PERIOD_NOT_ALIGNED');
    if ((to.getTime() - from.getTime()) / HOUR_MS > MAX_HOUR_BUCKETS)
      throw new OperationsRuleError('PERIOD_TOO_LARGE');
    for (let t = from.getTime(); t < to.getTime(); t += HOUR_MS) buckets.push(new Date(t));
  } else {
    if (!isLocalMidnight(from, timezone) || !isLocalMidnight(to, timezone))
      throw new OperationsRuleError('PERIOD_NOT_ALIGNED');
    // A day is 23-25 hours across a DST change; the bound is on days.
    if (to.getTime() - from.getTime() > (MAX_DAY_BUCKETS + 1) * DAY_MS)
      throw new OperationsRuleError('PERIOD_TOO_LARGE');
    for (let t = from; t.getTime() < to.getTime(); t = nextLocalMidnight(t, timezone)) {
      buckets.push(t);
      if (buckets.length > MAX_DAY_BUCKETS) throw new OperationsRuleError('PERIOD_TOO_LARGE');
    }
  }
  const span = to.getTime() - from.getTime();
  return {
    from,
    to,
    timezone,
    granularity,
    previous: { from: new Date(from.getTime() - span), to: from },
    buckets,
  };
}

/* ----------------------------- exact numbers ------------------------------ */

/**
 * num / den rounded to `places` decimals, half away from zero, as an exact
 * decimal string. BigInt only: no binary float is ever involved.
 */
export function decimalDivide(num: bigint, den: bigint, places: number): string {
  if (den === 0n) throw new OperationsRuleError('DIVISION_BY_ZERO');
  if (!Number.isSafeInteger(places) || places < 0 || places > 12)
    throw new OperationsRuleError('INVALID_PLACES');
  const negative = num < 0n !== den < 0n && num !== 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const scale = 10n ** BigInt(places);
  const scaled = n * scale;
  let q = scaled / d;
  if ((scaled % d) * 2n >= d) q += 1n;
  const digits = q.toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = places > 0 ? `.${digits.slice(digits.length - places)}` : '';
  const text = `${whole}${fraction}`;
  return negative && q !== 0n ? `-${text}` : text;
}

export type Growth =
  | {
      readonly ratio: string;
      readonly percent: string;
      readonly reason: null;
    }
  | { readonly ratio: null; readonly percent: null; readonly reason: 'ZERO_BASE' };

/**
 * Growth of `current` over `previous`: (current - previous) / previous.
 * The ratio has 6 decimals and the percentage 2, both rounded half away from
 * zero from the exact integers. A zero base has no growth (never "infinite").
 */
export function growth(current: bigint, previous: bigint): Growth {
  if (previous === 0n) return { ratio: null, percent: null, reason: 'ZERO_BASE' };
  const delta = current - previous;
  return {
    ratio: decimalDivide(delta, previous, 6),
    percent: decimalDivide(delta * 100n, previous, 2),
    reason: null,
  };
}

/** Parses a database integer aggregate (NUMERIC text) exactly. */
export function exactInteger(value: string | null): bigint {
  if (value === null) return 0n;
  if (!/^-?(0|[1-9][0-9]*)$/.test(value)) throw new Error('CORRUPT_AGGREGATE');
  return BigInt(value);
}

/* ------------------------------ freshness --------------------------------- */

export type StreamState = 'FRESH' | 'STALE' | 'NEVER_RECEIVED';

/**
 * A stream is FRESH when Reporting applied one of its events within this
 * window, measured on Reporting's own apply clock. STALE means nothing was
 * applied recently: a quiet producer and a broken pipeline look the same
 * without producer heartbeats, and the report says so instead of guessing.
 */
export const REPORT_STALE_AFTER_MS = 15 * 60 * 1000;

/** Broker stream (producer exchange) behind each projected source. */
export const SOURCE_STREAMS: Readonly<Record<OperationsSource, string>> = {
  booking: 'booking.events',
  scheduling: 'scheduling.events',
  workforce: 'workforce.events',
  dispatch: 'dispatch.events',
  billing: 'washgo.billing.events',
};

export interface SourceStreamStatus {
  readonly source: OperationsSource;
  readonly stream: string;
  readonly state: StreamState;
  /** Newest source occurrence time Reporting has applied for this stream. */
  readonly lastEventOccurredAt: Date | null;
  /** When Reporting last applied an event of this stream. */
  readonly lastAppliedAt: Date | null;
  readonly appliedCount: bigint;
}

export function streamStatus(
  source: OperationsSource,
  checkpoint: {
    readonly lastEventOccurredAt: Date;
    readonly lastAppliedAt: Date;
    readonly appliedCount: bigint;
  } | null,
  now: Date,
  staleAfterMs = REPORT_STALE_AFTER_MS,
): SourceStreamStatus {
  if (!checkpoint)
    return {
      source,
      stream: SOURCE_STREAMS[source],
      state: 'NEVER_RECEIVED',
      lastEventOccurredAt: null,
      lastAppliedAt: null,
      appliedCount: 0n,
    };
  return {
    source,
    stream: SOURCE_STREAMS[source],
    state: now.getTime() - checkpoint.lastAppliedAt.getTime() <= staleAfterMs ? 'FRESH' : 'STALE',
    lastEventOccurredAt: checkpoint.lastEventOccurredAt,
    lastAppliedAt: checkpoint.lastAppliedAt,
    appliedCount: checkpoint.appliedCount,
  };
}

/* --------------------------------- CSV ------------------------------------ */

/** A row bound for one export; the period bounds keep real exports far below it. */
export const MAX_EXPORT_ROWS = 1_000;

/** A cell that is exactly a signed decimal number; it can never be a formula. */
const PLAIN_NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One RFC 4180 field. Spreadsheet formula injection is neutralised by
 * prefixing a single quote to any cell that starts with = + - @ TAB or CR,
 * except a plain signed decimal number (which a spreadsheet reads as a number,
 * never as a formula). A field with a comma, quote, CR or LF is quoted and its
 * quotes doubled.
 */
export function csvField(value: string): string {
  const safe = FORMULA_LEAD.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRow(values: readonly string[]): string {
  return values.map(csvField).join(',');
}

/**
 * A whole export: UTF-8 BOM (so spreadsheet software reads Arabic text
 * correctly), a metadata block of key/value records, one all-empty separator
 * record, the column header and the rows. Every record has the same number of
 * fields and ends with CRLF, as RFC 4180 requires.
 */
export function csvDocument(input: {
  readonly meta: readonly (readonly [string, string])[];
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}): string {
  if (input.rows.length > MAX_EXPORT_ROWS) throw new OperationsRuleError('EXPORT_TOO_LARGE');
  const width = input.columns.length;
  if (width < 2 || input.rows.some((r) => r.length !== width))
    throw new Error('CSV_ROW_WIDTH_MISMATCH');
  const pad = (row: readonly string[]): readonly string[] => [
    ...row,
    ...Array<string>(width - row.length).fill(''),
  ];
  const lines = [
    ...input.meta.map((m) => csvRow(pad(m))),
    csvRow(pad([])),
    csvRow(input.columns),
    ...input.rows.map(csvRow),
  ];
  return `﻿${lines.map((l) => `${l}\r\n`).join('')}`;
}

/* ------------------------------- exports ---------------------------------- */

export const REPORT_KINDS = ['revenue', 'operations'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Closed set of report currencies with their fixed minor-unit scale (Billing contract). */
export const REPORT_CURRENCIES = { SYP: 2, USD: 2 } as const;
export type ReportCurrency = keyof typeof REPORT_CURRENCIES;

export function reportKind(value: unknown): ReportKind {
  return closed(value, REPORT_KINDS, 'INVALID_REPORT');
}

export function reportCurrency(value: unknown): ReportCurrency {
  return closed(value, ['SYP', 'USD'] as const, 'INVALID_CURRENCY');
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/;

export function idempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value))
    throw new OperationsRuleError('IDEMPOTENCY_KEY_INVALID');
  return value;
}

/** How long a finished export can be replayed by its idempotency key. */
export const EXPORT_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
