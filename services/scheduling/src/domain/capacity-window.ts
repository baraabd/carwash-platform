import { SchedulingError, invalid } from './errors';

/**
 * A bookable time window in one service zone with a finite number of units.
 *
 * Invariant (also enforced by a CHECK constraint): held + reserved <= capacity.
 * `held` counts ACTIVE holds, including ones whose deadline passed but which
 * have not been expired yet; every command that needs exact free capacity first
 * expires the due holds of the window it has locked (see application layer).
 */
export type WindowStatus = 'OPEN' | 'CLOSED';

export interface CapacityWindowState {
  readonly id: string;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly capacity: number;
  readonly held: number;
  readonly reserved: number;
  readonly status: WindowStatus;
  readonly version: number;
}

export const WINDOW_LIMITS = Object.freeze({
  minDurationMs: 15 * 60_000,
  maxDurationMs: 12 * 60 * 60_000,
  maxCapacity: 500,
  /** Windows may be published at most this far ahead. */
  maxHorizonMs: 120 * 24 * 60 * 60_000,
});

export function assertWindowDefinition(input: {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly capacity: number;
  readonly now: Date;
}): void {
  const { startsAt, endsAt, capacity, now } = input;
  if (!isValidInstant(startsAt) || !isValidInstant(endsAt))
    throw invalid('Window instants are invalid.');
  const duration = endsAt.getTime() - startsAt.getTime();
  if (duration < WINDOW_LIMITS.minDurationMs || duration > WINDOW_LIMITS.maxDurationMs) {
    throw invalid('Window duration is outside the allowed range.');
  }
  if (startsAt.getTime() <= now.getTime()) throw invalid('Window must start in the future.');
  if (startsAt.getTime() - now.getTime() > WINDOW_LIMITS.maxHorizonMs) {
    throw invalid('Window starts beyond the publishing horizon.');
  }
  assertCapacityValue(capacity);
}

export function assertCapacityValue(capacity: number): void {
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > WINDOW_LIMITS.maxCapacity) {
    throw invalid('Capacity must be an integer within the allowed range.');
  }
}

export function freeUnits(window: CapacityWindowState): number {
  return window.capacity - window.held - window.reserved;
}

/** Add held units for a new hold. Caller must hold the window row lock. */
export function holdUnits(
  window: CapacityWindowState,
  units: number,
  now: Date,
  /** The held slot's start; a slot inside a long window may begin after it. */
  slotStartsAt: Date = window.startsAt,
): CapacityWindowState {
  if (window.status !== 'OPEN') throw new SchedulingError('WINDOW_CLOSED', 'Window is closed.');
  if (slotStartsAt.getTime() <= now.getTime()) {
    throw new SchedulingError('WINDOW_STARTED', 'The slot has already started.');
  }
  if (freeUnits(window) < units) {
    throw new SchedulingError('CAPACITY_EXHAUSTED', 'No capacity left in this window.');
  }
  return { ...window, held: window.held + units, version: window.version + 1 };
}

export function releaseHeldUnits(window: CapacityWindowState, units: number): CapacityWindowState {
  if (window.held < units) throw new Error('HELD_UNDERFLOW');
  return { ...window, held: window.held - units, version: window.version + 1 };
}

export function convertHeldToReserved(
  window: CapacityWindowState,
  units: number,
): CapacityWindowState {
  if (window.held < units) throw new Error('HELD_UNDERFLOW');
  return {
    ...window,
    held: window.held - units,
    reserved: window.reserved + units,
    version: window.version + 1,
  };
}

export function releaseReservedUnits(
  window: CapacityWindowState,
  units: number,
): CapacityWindowState {
  if (window.reserved < units) throw new Error('RESERVED_UNDERFLOW');
  return { ...window, reserved: window.reserved - units, version: window.version + 1 };
}

export function changeCapacity(window: CapacityWindowState, capacity: number): CapacityWindowState {
  assertCapacityValue(capacity);
  if (capacity < window.held + window.reserved) {
    throw new SchedulingError(
      'CAPACITY_BELOW_COMMITTED',
      'Capacity cannot drop below units already held or reserved.',
    );
  }
  return { ...window, capacity, version: window.version + 1 };
}

export function closeWindow(window: CapacityWindowState): CapacityWindowState {
  if (window.status === 'CLOSED') return window;
  return { ...window, status: 'CLOSED', version: window.version + 1 };
}

function isValidInstant(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
