/**
 * Booking-operations discovery rules for the console. Pure: no DOM, no fetch.
 * The status here is Reporting's DERIVED operational status, never the Booking
 * owner's lifecycle state.
 */
export const DERIVED_STATUSES = [
  'SCHEDULED',
  'CONFIRMED_UNSCHEDULED',
  'SLOT_COMMITTED_UNCONFIRMED',
  'SLOT_RELEASED',
] as const;
export type DerivedStatus = (typeof DERIVED_STATUSES)[number];

export function isDerivedStatus(value: unknown): value is DerivedStatus {
  return DERIVED_STATUSES.some((s) => s === value);
}

/** The reference's status chip palette, mapped to what each status means. */
export const STATUS_TONE: Readonly<
  Record<DerivedStatus, 's-green' | 's-amber' | 's-blue' | 's-red'>
> = {
  SCHEDULED: 's-green',
  CONFIRMED_UNSCHEDULED: 's-amber',
  SLOT_COMMITTED_UNCONFIRMED: 's-blue',
  SLOT_RELEASED: 's-red',
};

export const PERIODS = ['today', 'week', 'month'] as const;
export type Period = (typeof PERIODS)[number];

export interface Window {
  readonly from: string;
  readonly to: string;
}

/**
 * The discovery window in the operator's local calendar, sent as UTC instants.
 * Weeks start on Saturday, as the Syrian working week does. Every window stays
 * within Reporting's 31-day bound.
 */
export function periodWindow(period: Period, now: Date): Window {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let end: Date;
  if (period === 'today') {
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  } else if (period === 'week') {
    const sinceSaturday = (start.getDay() + 1) % 7;
    start.setDate(start.getDate() - sinceSaturday);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  } else {
    start.setDate(1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  }
  return { from: wire(start), to: wire(end) };
}

/** Reporting accepts second-precision UTC instants. */
function wire(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The search box finds a booking by its exact reference; free text is not supported. */
export function bookingReference(input: string): string | null {
  const value = input.trim();
  return UUID.test(value) ? value.toLowerCase() : null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Short, non-personal display form of an opaque identifier. */
export function shortRef(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}
