import { invalid } from './errors';

/**
 * Civil-day arithmetic for the closed business time-zone list of the published
 * contracts (`Asia/Damascus`). Uses the platform's IANA database through Intl;
 * no offset is hard-coded, so a future DST rule change is picked up from ICU.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Damascus' as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

/** The UTC instant at which `date` begins in `timeZone`. */
export function startOfLocalDay(date: string, timeZone: string = BUSINESS_TIME_ZONE): Date {
  if (!DATE.test(date)) throw invalid('date must be YYYY-MM-DD.');
  const naive = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 10) !== date) {
    throw invalid('date is not a calendar date.');
  }
  // Two passes converge across an offset change near midnight.
  let utc = naive - offsetMs(new Date(naive), timeZone);
  utc = naive - offsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

export function nextLocalDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** The civil date of `instant` in `timeZone`, as YYYY-MM-DD. */
export function localDateOf(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  return new Date(instant.getTime() + offsetMs(instant, timeZone)).toISOString().slice(0, 10);
}
