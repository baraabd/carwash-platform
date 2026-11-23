import { SchedulingError, invalid } from './errors';

/**
 * A temporary capacity hold for one slot, owned by its beneficiary (an account
 * or guest principal) and committed by Booking only (scheduling.v1).
 *
 * Internal status          scheduling.v1 state
 *   ACTIVE                   HELD
 *   CONFIRMED                COMMITTED   (bookingId set; units become reserved)
 *   RELEASED                 RELEASED    (beneficiary gave it back)
 *   EXPIRED                  EXPIRED     (deadline passed; units returned)
 *   CANCELLED                RELEASED    (a committed hold given back: staff override,
 *                                         booking cancelled, or the booking moved
 *                                         to another hold by a reschedule)
 *
 * Expiry is decided only by the injected clock compared with `expiresAt`,
 * never by whether a sweeper ran. `version` is the contract `revision`.
 */
export type HoldStatus = 'ACTIVE' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED' | 'CANCELLED';
export type HoldStateV1 = 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
export type PrincipalKind = 'account' | 'guest';

/**
 * scheduling.v1 reasons a beneficiary may give, the staff-only override, and
 * the two reasons Booking gives when it changes a committed booking (P04-C1).
 * Every value is already allowed by capacity_hold_reason_ck.
 */
export const RELEASE_REASONS = [
  'CUSTOMER_CHANGED',
  'BOOKING_FAILED',
  'EXPIRED_BY_CLIENT',
  'OPERATIONS_OVERRIDE',
  'BOOKING_CANCELLED',
  'RESCHEDULED',
] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];
export const PRINCIPAL_RELEASE_REASONS: readonly ReleaseReason[] = [
  'CUSTOMER_CHANGED',
  'BOOKING_FAILED',
  'EXPIRED_BY_CLIENT',
];

export interface HoldState {
  readonly id: string;
  readonly windowId: string;
  readonly zoneId: string;
  readonly beneficiaryKind: PrincipalKind;
  readonly beneficiarySubject: string;
  readonly quoteId: string;
  readonly quoteRevision: number;
  readonly slotStartsAt: Date;
  readonly slotEndsAt: Date;
  readonly units: number;
  readonly status: HoldStatus;
  readonly expiresAt: Date;
  readonly bookingId: string | null;
  readonly releaseReason: ReleaseReason | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export const HOLD_LIMITS = Object.freeze({
  ttlSeconds: 10 * 60,
  minDurationMinutes: 5,
  maxDurationMinutes: 480,
  /** Holds a single beneficiary may have ACTIVE at once (anti-hoarding). */
  maxActivePerBeneficiary: 3,
  /** How far ahead a slot may be held. */
  horizonDays: 30,
});

export function assertDurationMinutes(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < HOLD_LIMITS.minDurationMinutes ||
    value > HOLD_LIMITS.maxDurationMinutes
  ) {
    throw invalid('durationMinutes is outside the allowed range.');
  }
}

export function isReleaseReason(value: unknown): value is ReleaseReason {
  return typeof value === 'string' && RELEASE_REASONS.some((reason) => reason === value);
}

export function v1State(hold: HoldState): HoldStateV1 {
  switch (hold.status) {
    case 'ACTIVE':
      return 'HELD';
    case 'CONFIRMED':
      return 'COMMITTED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'RELEASED':
    case 'CANCELLED':
      return 'RELEASED';
  }
}

/** An ACTIVE hold whose deadline is at or before `now` no longer protects capacity. */
export function isDue(hold: HoldState, now: Date): boolean {
  return hold.status === 'ACTIVE' && hold.expiresAt.getTime() <= now.getTime();
}

export function expire(hold: HoldState, now: Date): HoldState {
  if (!isDue(hold, now)) throw new Error('HOLD_NOT_DUE');
  return { ...hold, status: 'EXPIRED', updatedAt: now, version: hold.version + 1 };
}

/** ACTIVE and before its deadline. An expired hold reports HOLD_EXPIRED, not merely inactive. */
function assertLive(hold: HoldState, now: Date): void {
  if (hold.status === 'EXPIRED' || isDue(hold, now)) {
    throw new SchedulingError('HOLD_EXPIRED', 'Hold has expired.');
  }
  if (hold.status !== 'ACTIVE') throw new SchedulingError('HOLD_NOT_ACTIVE', 'Hold is not active.');
}

function assertRevision(hold: HoldState, expectedRevision: number): void {
  if (hold.version !== expectedRevision) {
    throw new SchedulingError('VERSION_CONFLICT', 'Hold revision does not match.');
  }
}

/**
 * Commit for a booking. Re-committing for the SAME booking is a replay (no
 * change, whatever the revision now is); a different booking is refused.
 */
export function commit(
  hold: HoldState,
  input: { readonly bookingId: string; readonly expectedRevision: number; readonly now: Date },
): { readonly hold: HoldState; readonly replay: boolean } {
  if (hold.status === 'CONFIRMED') {
    if (hold.bookingId === input.bookingId) return { hold, replay: true };
    throw new SchedulingError('HOLD_NOT_ACTIVE', 'Hold is committed to another booking.');
  }
  assertLive(hold, input.now);
  assertRevision(hold, input.expectedRevision);
  return {
    hold: {
      ...hold,
      status: 'CONFIRMED',
      bookingId: input.bookingId,
      updatedAt: input.now,
      version: hold.version + 1,
    },
    replay: false,
  };
}

export interface ReleaseOutcome {
  readonly hold: HoldState;
  /** Which counter the units come back from. */
  readonly freed: 'HELD' | 'RESERVED';
}

/**
 * Beneficiary release: only a live HELD hold. A repeated release with the same
 * key is answered by the idempotency record, not here.
 */
export function releaseByBeneficiary(
  hold: HoldState,
  input: { readonly reason: ReleaseReason; readonly expectedRevision: number; readonly now: Date },
): ReleaseOutcome {
  if (!PRINCIPAL_RELEASE_REASONS.includes(input.reason)) {
    throw invalid('Reason is reserved for operations.');
  }
  assertLive(hold, input.now);
  assertRevision(hold, input.expectedRevision);
  return {
    hold: {
      ...hold,
      status: 'RELEASED',
      releaseReason: input.reason,
      updatedAt: input.now,
      version: hold.version + 1,
    },
    freed: 'HELD',
  };
}

/** Staff override: frees a held or committed unit; terminal holds are a no-op (null). */
export function releaseByOperations(hold: HoldState, now: Date): ReleaseOutcome | null {
  if (hold.status === 'ACTIVE') {
    if (isDue(hold, now)) throw new Error('HOLD_DUE_MUST_EXPIRE_FIRST');
    return {
      hold: {
        ...hold,
        status: 'RELEASED',
        releaseReason: 'OPERATIONS_OVERRIDE',
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
        releaseReason: 'OPERATIONS_OVERRIDE',
        updatedAt: now,
        version: hold.version + 1,
      },
      freed: 'RESERVED',
    };
  }
  return null;
}

/**
 * Booking cancelled a committed booking: its reserved unit comes back.
 *
 * Replay policy: a hold already given back for the SAME booking (by Booking,
 * or earlier by a staff override) answers with the hold and frees nothing
 * again. A hold that is not (or no longer) committed to this booking is refused.
 */
export function releaseCommitment(
  hold: HoldState,
  input: { readonly bookingId: string; readonly now: Date },
): { readonly hold: HoldState; readonly replay: boolean } {
  if (hold.bookingId !== input.bookingId) {
    throw new SchedulingError('COMMITMENT_NOT_FOUND', 'The hold is not committed to the booking.');
  }
  // A hold the booking was moved away from is not its commitment any more.
  if (hold.status === 'CANCELLED' && hold.releaseReason !== 'RESCHEDULED') {
    return { hold, replay: true };
  }
  if (hold.status !== 'CONFIRMED') {
    throw new SchedulingError('COMMITMENT_NOT_FOUND', 'The hold is not committed to the booking.');
  }
  return {
    hold: {
      ...hold,
      status: 'CANCELLED',
      releaseReason: 'BOOKING_CANCELLED',
      updatedAt: input.now,
      version: hold.version + 1,
    },
    replay: false,
  };
}

export interface CommitmentReplacement {
  /** The previously committed hold, now CANCELLED with reason RESCHEDULED. */
  readonly from: HoldState;
  /** The new hold, now CONFIRMED for the same booking. */
  readonly to: HoldState;
  readonly replay: boolean;
}

/**
 * Reschedule: move a booking's commitment from one hold to another in ONE
 * decision, so capacity is never held twice for it nor lost in between.
 *
 * The new hold must be live, at the expected revision, and belong to the same
 * beneficiary as the committed one (another principal's hold is reported as
 * absent). A replacement that already happened for this booking is a replay.
 */
export function replaceCommitment(
  from: HoldState,
  to: HoldState,
  input: {
    readonly bookingId: string;
    readonly expectedRevision: number;
    readonly now: Date;
  },
): CommitmentReplacement {
  if (from.id === to.id) throw invalid('The new hold must differ from the committed one.');
  if (
    from.status === 'CANCELLED' &&
    from.releaseReason === 'RESCHEDULED' &&
    from.bookingId === input.bookingId &&
    to.status === 'CONFIRMED' &&
    to.bookingId === input.bookingId
  ) {
    return { from, to, replay: true };
  }
  if (from.status !== 'CONFIRMED' || from.bookingId !== input.bookingId) {
    throw new SchedulingError('COMMITMENT_NOT_FOUND', 'The hold is not committed to the booking.');
  }
  if (
    to.beneficiaryKind !== from.beneficiaryKind ||
    to.beneficiarySubject !== from.beneficiarySubject
  ) {
    throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
  }
  assertLive(to, input.now);
  assertRevision(to, input.expectedRevision);
  return {
    from: {
      ...from,
      status: 'CANCELLED',
      releaseReason: 'RESCHEDULED',
      updatedAt: input.now,
      version: from.version + 1,
    },
    to: {
      ...to,
      status: 'CONFIRMED',
      bookingId: input.bookingId,
      updatedAt: input.now,
      version: to.version + 1,
    },
    replay: false,
  };
}
