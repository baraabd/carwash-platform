import { SchedulingError, invalid } from './errors';

/**
 * A capacity hold taken by a caller (normally the Booking saga) for one window.
 *
 *   ACTIVE    -> CONFIRMED  (held units become reserved; this is the reservation)
 *   ACTIVE    -> RELEASED   (caller gave it back)
 *   ACTIVE    -> EXPIRED    (deadline passed; units return to the window)
 *   CONFIRMED -> CANCELLED  (compensation: reserved units return to the window)
 *
 * RELEASED, EXPIRED and CANCELLED are terminal. Expiry is decided only by the
 * injected clock compared with `expiresAt`, never by whether a sweeper ran.
 */
export type HoldStatus = 'ACTIVE' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED' | 'CANCELLED';

export const RELEASE_REASONS = [
  'CUSTOMER_ABANDONED',
  'BOOKING_FAILED',
  'BOOKING_CANCELLED',
  'RESCHEDULED',
  'OPERATIONS_OVERRIDE',
] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

export interface HoldState {
  readonly id: string;
  readonly windowId: string;
  readonly clientId: string;
  readonly holderRef: string;
  readonly units: number;
  readonly status: HoldStatus;
  readonly expiresAt: Date;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly releaseReason: ReleaseReason | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export const HOLD_LIMITS = Object.freeze({
  minTtlSeconds: 60,
  maxTtlSeconds: 30 * 60,
  defaultTtlSeconds: 10 * 60,
  maxUnits: 4,
});

export function holdTtlSeconds(requested: number | undefined): number {
  if (requested === undefined) return HOLD_LIMITS.defaultTtlSeconds;
  if (
    !Number.isSafeInteger(requested) ||
    requested < HOLD_LIMITS.minTtlSeconds ||
    requested > HOLD_LIMITS.maxTtlSeconds
  ) {
    throw invalid('Hold TTL is outside the allowed range.');
  }
  return requested;
}

export function assertUnits(units: number): void {
  if (!Number.isSafeInteger(units) || units < 1 || units > HOLD_LIMITS.maxUnits) {
    throw invalid('Hold units are outside the allowed range.');
  }
}

export function isReleaseReason(value: unknown): value is ReleaseReason {
  return typeof value === 'string' && RELEASE_REASONS.some((reason) => reason === value);
}

/** An ACTIVE hold whose deadline is at or before `now` no longer protects capacity. */
export function isDue(hold: HoldState, now: Date): boolean {
  return hold.status === 'ACTIVE' && hold.expiresAt.getTime() <= now.getTime();
}

export function expire(hold: HoldState, now: Date): HoldState {
  if (!isDue(hold, now)) throw new Error('HOLD_NOT_DUE');
  return { ...hold, status: 'EXPIRED', updatedAt: now, version: hold.version + 1 };
}

export function confirm(hold: HoldState, now: Date): HoldState {
  if (hold.status !== 'ACTIVE') {
    throw new SchedulingError('HOLD_NOT_ACTIVE', 'Hold is not active.');
  }
  if (isDue(hold, now)) throw new SchedulingError('HOLD_EXPIRED', 'Hold has expired.');
  return { ...hold, status: 'CONFIRMED', updatedAt: now, version: hold.version + 1 };
}

export interface ReleaseOutcome {
  readonly hold: HoldState;
  /** Which counter the units come back from; null when nothing changes. */
  readonly freed: 'HELD' | 'RESERVED' | null;
}

/**
 * Release is idempotent: releasing a hold that is already terminal is a no-op.
 * Releasing a due ACTIVE hold is not allowed here; the caller expires it first.
 */
export function release(hold: HoldState, reason: ReleaseReason, now: Date): ReleaseOutcome {
  if (hold.status === 'ACTIVE') {
    if (isDue(hold, now)) throw new Error('HOLD_DUE_MUST_EXPIRE_FIRST');
    return {
      hold: {
        ...hold,
        status: 'RELEASED',
        releaseReason: reason,
        updatedAt: now,
        version: hold.version + 1,
      },
      freed: 'HELD',
    };
  }
  if (hold.status === 'CONFIRMED') {
    return {
      hold: {
        ...hold,
        status: 'CANCELLED',
        releaseReason: reason,
        updatedAt: now,
        version: hold.version + 1,
      },
      freed: 'RESERVED',
    };
  }
  return { hold, freed: null };
}
