import { WorkforceError, invalid } from './errors';
import { assertUuid } from './operator';

/**
 * The technician's recurring weekly availability (P05-C1).
 *
 * A schedule is a declaration in local wall-clock time of one IANA time zone.
 * It is NOT capacity by itself: published capacity stays the ACTIVE shifts
 * (`workforce.v1`). Applying a schedule to a dated week creates ordinary
 * shifts through the same rules as a hand-made shift (service area, overlap
 * exclusion, idempotency), so Scheduling and Dispatch see one model.
 *
 * Windows never cross midnight (end <= 1440); a night shift is two windows.
 * No stored row means "never set": empty, revision 0.
 */
export const MAX_WEEKLY_WINDOWS = 28;
export const MIN_WINDOW_MINUTES = 15;
export const MAX_SCHEDULE_REVISION = 2_147_483_647;
export const DEFAULT_TIME_ZONE = 'Asia/Damascus';
/** How far ahead a week may be applied, in days from the local today. */
export const MAX_APPLY_AHEAD_DAYS = 56;

export interface WeeklyWindow {
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly zoneId: string;
}

export interface WeeklyScheduleState {
  readonly operatorId: string;
  readonly timeZone: string;
  readonly windows: readonly WeeklyWindow[];
  readonly revision: number;
  readonly updatedAt: Date | null;
}

export function initialSchedule(operatorId: string): WeeklyScheduleState {
  return { operatorId, timeZone: DEFAULT_TIME_ZONE, windows: [], revision: 0, updatedAt: null };
}

// ---------------------------------------------------------------------------
// Time zone arithmetic (Intl only; no dependency)
// ---------------------------------------------------------------------------

const ZONE_NAME = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

export function assertTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || !ZONE_NAME.test(value)) {
    invalid('timeZone must be an IANA time zone name.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    invalid('timeZone must be an IANA time zone name.');
  }
  return value;
}

interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function localParts(timeZone: string, at: number): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) throw new Error('TIME_ZONE_PARTS_MISSING');
    return Number(part.value);
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` from UTC at the instant `at`, in milliseconds. */
function offsetMs(timeZone: string, at: number): number {
  const p = localParts(timeZone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The UTC instant of a local wall-clock time. Two passes settle the offset
 * around a transition; a local time skipped by a forward transition resolves
 * to the instant after the gap (documented, never silently dropped).
 */
export function localToUtc(timeZone: string, date: LocalDate, minuteOfDay: number): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day) + minuteOfDay * 60_000;
  let guess = naive - offsetMs(timeZone, naive);
  guess = naive - offsetMs(timeZone, guess);
  return new Date(guess);
}

export interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(value: unknown, field = 'startDate'): LocalDate {
  if (typeof value !== 'string') invalid(`${field} must be YYYY-MM-DD.`);
  const match = DATE.exec(value);
  if (match === null) invalid(`${field} must be YYYY-MM-DD.`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    invalid(`${field} is not a calendar date.`);
  }
  return { year, month, day };
}

export function formatLocalDate(date: LocalDate): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

function addDays(date: LocalDate, days: number): LocalDate {
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: probe.getUTCFullYear(), month: probe.getUTCMonth() + 1, day: probe.getUTCDate() };
}

function dayNumber(date: LocalDate): number {
  return Math.round(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

function isoWeekday(date: LocalDate): number {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function localToday(timeZone: string, now: Date): LocalDate {
  const p = localParts(timeZone, now.getTime());
  return { year: p.year, month: p.month, day: p.day };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface ScheduleCommand {
  readonly timeZone: string;
  readonly windows: readonly WeeklyWindow[];
  readonly expectedRevision: number;
}

function closed(body: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid(`${what} must be a JSON object.`);
  }
  const present = Object.keys(body).sort();
  const wanted = [...keys].sort();
  if (present.length !== wanted.length || present.some((key, i) => key !== wanted[i])) {
    invalid(`${what} must be exactly {${keys.join(', ')}}.`);
  }
  return Object.fromEntries(Object.entries(body));
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    invalid(`${field} must be an integer ${min}-${max}.`);
  }
  return value;
}

function parseWindow(value: unknown, index: number): WeeklyWindow {
  const record = closed(
    value,
    ['weekday', 'startMinute', 'endMinute', 'zoneId'],
    `windows[${index}]`,
  );
  const weekday = integer(record.weekday, 'weekday', 1, 7);
  const startMinute = integer(record.startMinute, 'startMinute', 0, 1439);
  const endMinute = integer(record.endMinute, 'endMinute', 1, 1440);
  if (endMinute - startMinute < MIN_WINDOW_MINUTES) {
    invalid(`A window lasts at least ${MIN_WINDOW_MINUTES} minutes and ends after it starts.`);
  }
  const zoneId = record.zoneId;
  if (typeof zoneId !== 'string') invalid('zoneId must be a UUID.');
  assertUuid(zoneId, 'zoneId');
  return { weekday, startMinute, endMinute, zoneId: zoneId.toLowerCase() };
}

function compareWindows(a: WeeklyWindow, b: WeeklyWindow): number {
  return a.weekday - b.weekday || a.startMinute - b.startMinute;
}

/** Closed body {timeZone, windows, expectedRevision}; windows sorted, never overlapping. */
export function parseScheduleCommand(body: unknown): ScheduleCommand {
  const record = closed(body, ['timeZone', 'windows', 'expectedRevision'], 'Body');
  const timeZone = assertTimeZone(record.timeZone);
  const expectedRevision = integer(
    record.expectedRevision,
    'expectedRevision',
    0,
    MAX_SCHEDULE_REVISION,
  );
  if (!Array.isArray(record.windows)) invalid('windows must be an array.');
  if (record.windows.length > MAX_WEEKLY_WINDOWS) {
    invalid(`At most ${MAX_WEEKLY_WINDOWS} weekly windows.`);
  }
  const windows = record.windows.map((value: unknown, i: number) => parseWindow(value, i));
  windows.sort(compareWindows);
  for (let i = 1; i < windows.length; i += 1) {
    const previous = windows[i - 1];
    const current = windows[i];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.weekday === current.weekday &&
      current.startMinute < previous.endMinute
    ) {
      invalid('Windows of one weekday may not overlap.');
    }
  }
  return { timeZone, windows, expectedRevision };
}

function sameWindows(a: readonly WeeklyWindow[], b: readonly WeeklyWindow[]): boolean {
  return (
    a.length === b.length &&
    a.every((w, i) => {
      const o = b[i];
      return (
        o !== undefined &&
        o.weekday === w.weekday &&
        o.startMinute === w.startMinute &&
        o.endMinute === w.endMinute &&
        o.zoneId === w.zoneId
      );
    })
  );
}

export function replaceSchedule(
  current: WeeklyScheduleState,
  command: ScheduleCommand,
  now: Date,
): { readonly next: WeeklyScheduleState; readonly changed: boolean } {
  if (command.expectedRevision !== current.revision) {
    throw new WorkforceError('REVISION_CONFLICT', 'Schedule changed; refetch and retry.');
  }
  if (current.timeZone === command.timeZone && sameWindows(current.windows, command.windows)) {
    return { next: current, changed: false };
  }
  if (current.revision >= MAX_SCHEDULE_REVISION) invalid('Schedule revision exhausted.');
  return {
    next: {
      ...current,
      timeZone: command.timeZone,
      windows: command.windows,
      revision: current.revision + 1,
      updatedAt: now,
    },
    changed: true,
  };
}

// ---------------------------------------------------------------------------
// Applying one week
// ---------------------------------------------------------------------------

export interface ApplyCommand {
  readonly startDate: LocalDate;
  readonly expectedRevision: number;
}

export function parseApplyCommand(body: unknown): ApplyCommand {
  const record = closed(body, ['startDate', 'expectedRevision'], 'Body');
  return {
    startDate: parseLocalDate(record.startDate),
    expectedRevision: integer(
      record.expectedRevision,
      'expectedRevision',
      1,
      MAX_SCHEDULE_REVISION,
    ),
  };
}

export interface WindowOccurrence {
  readonly window: WeeklyWindow;
  readonly date: LocalDate;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Stable per (week, schedule revision, window): the shift idempotency key. */
  readonly key: string;
}

/**
 * The seven local days starting at `startDate`, each window placed at its
 * UTC instants. The schedule revision must be the one the caller saw, and the
 * first day must lie within [local today, today + 56 days].
 */
export function expandWeek(
  schedule: WeeklyScheduleState,
  command: ApplyCommand,
  now: Date,
): WindowOccurrence[] {
  if (schedule.revision === 0) {
    throw new WorkforceError('SCHEDULE_NOT_SET', 'No weekly schedule to apply.');
  }
  if (command.expectedRevision !== schedule.revision) {
    throw new WorkforceError('REVISION_CONFLICT', 'Schedule changed; refetch and retry.');
  }
  const offset = dayNumber(command.startDate) - dayNumber(localToday(schedule.timeZone, now));
  if (offset < 0 || offset > MAX_APPLY_AHEAD_DAYS) {
    invalid(`startDate must be within ${MAX_APPLY_AHEAD_DAYS} days from today.`);
  }
  const occurrences: WindowOccurrence[] = [];
  const week = formatLocalDate(command.startDate);
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(command.startDate, i);
    const weekday = isoWeekday(date);
    for (const window of schedule.windows) {
      if (window.weekday !== weekday) continue;
      occurrences.push({
        window,
        date,
        startsAt: localToUtc(schedule.timeZone, date, window.startMinute),
        endsAt: localToUtc(schedule.timeZone, date, window.endMinute),
        key: `wk:${week}:r${schedule.revision}:${weekday}:${window.startMinute}`,
      });
    }
  }
  return occurrences;
}
