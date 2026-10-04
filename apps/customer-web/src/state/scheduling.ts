import type { BookingSlot } from './bookingDraft.ts';

/**
 * The demonstration schedule of the approved prototype, as pure functions of an
 * explicit instant. Nothing here reads the clock: every caller passes the same
 * `instant` to all calculations of one render or one command.
 *
 * These are the prototype's demo rules, not availability. Real capacity, working
 * hours and reservations belong to the Scheduling service, which this frontend
 * does not call; choosing a time here reserves nothing.
 */

/** Calendar and labels are those of the service area, not of the device. */
export const SERVICE_TIME_ZONE = 'Asia/Damascus';

/** Arrival times offered each day, in order: every hour from 08:00 to 20:00. */
export const ARRIVAL_TIMES: readonly string[] = Array.from(
  { length: 13 },
  (_, index) => `${String(index + 8).padStart(2, '0')}:00`,
);

/** Days offered, starting today. */
export const SCHEDULE_DAY_COUNT = 5;
/** A time today is offered only when it starts later than now plus this many minutes. */
export const LEAD_MINUTES = 45;
/** The prototype never offers this time. A demonstration rule, not occupancy. */
export const EXCLUDED_TIME = '11:00';
/** Times shown before "عرض كل الأوقات". */
export const COLLAPSED_TIME_COUNT = 6;

export const UNSET_DATE_LABEL = 'اختر موعدًا';
export const UNSET_TIME_LABEL = 'لم يحدد';

export interface ServiceNow {
  /** Calendar day in the service time zone, `YYYY-MM-DD`. */
  readonly key: string;
  /** Minutes since midnight in the service time zone. Seconds are dropped. */
  readonly minutes: number;
}

const nowParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: SERVICE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The instant as a service-zone calendar day and minute of day. */
export function serviceNow(instant: Date): ServiceNow {
  // A missing instant must fail loudly: Intl would silently read the real clock.
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError('A scheduling rule needs an explicit, valid instant.');
  }
  const parts: Record<string, string> = {};
  for (const part of nowParts.formatToParts(instant)) parts[part.type] = part.value;
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/**
 * Noon of a calendar key, used only to step and label whole days. The prototype
 * writes it with a fixed +03:00 offset; at noon that is the right calendar day
 * for the service zone whatever its offset is, which is all this is used for.
 */
function noonOf(key: string): Date {
  return new Date(`${key}T12:00:00+03:00`);
}

const dayNumber = new Intl.DateTimeFormat('en-US', { timeZone: SERVICE_TIME_ZONE, day: 'numeric' });
const weekday = new Intl.DateTimeFormat('ar', { timeZone: SERVICE_TIME_ZONE, weekday: 'long' });
const shortMonth = new Intl.DateTimeFormat('ar', { timeZone: SERVICE_TIME_ZONE, month: 'short' });
const fullDate = new Intl.DateTimeFormat('ar', {
  timeZone: SERVICE_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'short',
});

export interface ScheduleDay {
  readonly key: string;
  /** Day of the month in Latin digits. */
  readonly day: string;
  /** «اليوم», «غدًا», then the weekday name. */
  readonly label: string;
  readonly month: string;
}

/** The five days offered at `instant`, starting with the service-zone today. */
export function scheduleDays(instant: Date): readonly ScheduleDay[] {
  const today = serviceNow(instant);
  return Array.from({ length: SCHEDULE_DAY_COUNT }, (_, index) => {
    const date = noonOf(today.key);
    date.setUTCDate(date.getUTCDate() + index);
    return {
      key: date.toISOString().slice(0, 10),
      day: dayNumber.format(date),
      label: index === 0 ? 'اليوم' : index === 1 ? 'غدًا' : weekday.format(date),
      month: shortMonth.format(date),
    };
  });
}

export function isScheduleDay(instant: Date, day: unknown): day is string {
  return typeof day === 'string' && scheduleDays(instant).some((item) => item.key === day);
}

/**
 * Whether `time` on `day` is offered at `instant`:
 * the day is one of the five, the time is one of the arrival times and is not the
 * excluded one, and — for today — it starts strictly later than now + 45 minutes.
 */
export function isSlotAvailable(instant: Date, day: unknown, time: unknown): boolean {
  if (!isScheduleDay(instant, day)) return false;
  if (typeof time !== 'string' || !ARRIVAL_TIMES.includes(time)) return false;
  const now = serviceNow(instant);
  const tooSoon = day === now.key && Number(time.slice(0, 2)) * 60 <= now.minutes + LEAD_MINUTES;
  return !tooSoon && time !== EXCLUDED_TIME;
}

/** The arrival times offered on `day` at `instant`, in order. Empty for an unknown day. */
export function availableTimes(instant: Date, day: unknown): readonly string[] {
  return ARRIVAL_TIMES.filter((time) => isSlotAvailable(instant, day, time));
}

/** The first offered time, by day and then by time; null when nothing is offered. */
export function earliestSlot(instant: Date): BookingSlot | null {
  for (const day of scheduleDays(instant)) {
    const first = availableTimes(instant, day.key)[0];
    if (first) return { date: day.key, time: first };
  }
  return null;
}

/** The day a schedule starts on when none was chosen: the earliest slot's, else today. */
export function defaultScheduleDay(instant: Date): string {
  return earliestSlot(instant)?.date ?? scheduleDays(instant)[0]!.key;
}

/**
 * The times the grid shows: the first six, or all of them when expanded or when
 * the selected time lies beyond the first six (so it is never hidden).
 */
export function visibleTimes(
  times: readonly string[],
  selectedTime: string | null,
  showAll: boolean,
): readonly string[] {
  const selectedIndex = selectedTime === null ? -1 : times.indexOf(selectedTime);
  return showAll || selectedIndex >= COLLAPSED_TIME_COUNT
    ? times
    : times.slice(0, COLLAPSED_TIME_COUNT);
}

/** «الأحد، ٢٠ أيلول» for a calendar key; the approved fallback for anything else. */
export function dateLabel(key: string): string {
  const date = noonOf(key);
  return Number.isNaN(date.getTime()) ? UNSET_DATE_LABEL : fullDate.format(date);
}

/** «1:00 م» for an arrival time; the approved fallback for anything else. */
export function timeLabel(time: string | null): string {
  if (time === null || !ARRIVAL_TIMES.includes(time)) return UNSET_TIME_LABEL;
  const hour = Number(time.slice(0, 2));
  return `${hour % 12 || 12}:00 ${hour < 12 ? 'ص' : 'م'}`;
}

export function slotLabel(slot: BookingSlot): string {
  return `${dateLabel(slot.date)} · ${timeLabel(slot.time)}`;
}
