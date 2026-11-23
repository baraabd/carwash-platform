import { DAY_MS, type PlanTerms } from './plan';

/**
 * A customer SUBSCRIPTION holds a snapshot of one plan revision's terms and a
 * sequence of entitlement PERIODS. Each period grants a fixed number of wash
 * units for [start, end). A unit is RESERVED for one booking, then COMMITTED
 * (consumed) or RELEASED (returned); a committed unit can only be returned by
 * an audited staff REVERSAL.
 *
 * Invariant per period (enforced here, by CHECK constraints and by a COMMIT-time
 * ledger assertion): 0 <= reserved, 0 <= consumed, reserved + consumed <= granted,
 * and the counters equal the sum of the period's append-only movements.
 *
 * Persisted statuses are PENDING_ACTIVATION, ACTIVE, FROZEN and CANCELLED.
 * EXPIRED is derived: an ACTIVE/FROZEN subscription whose current period has
 * ended. There is no automatic renewal or debit (B-09 approves none): a new
 * period exists only when staff record a renewal against a payment reference.
 */
export const SUBSCRIPTION_STATUSES = [
  'PENDING_ACTIVATION',
  'ACTIVE',
  'FROZEN',
  'CANCELLED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type SubscriptionView = SubscriptionStatus | 'EXPIRED';
export const OPEN_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'PENDING_ACTIVATION',
  'ACTIVE',
  'FROZEN',
];

export const RESERVATION_STATUSES = ['RESERVED', 'COMMITTED', 'RELEASED', 'REVERSED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const MOVEMENT_KINDS = ['GRANT', 'RESERVE', 'COMMIT', 'RELEASE', 'REVERSE'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const CANCEL_REASONS = [
  'CUSTOMER_REQUEST',
  'PAYMENT_NOT_RECEIVED',
  'RECORDED_IN_ERROR',
  'PLAN_WITHDRAWN',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const FREEZE_REASONS = ['CUSTOMER_REQUEST', 'SERVICE_SUSPENDED', 'UNDER_REVIEW'] as const;
export type FreezeReason = (typeof FREEZE_REASONS)[number];

export const RELEASE_REASONS = [
  'BOOKING_CANCELLED',
  'BOOKING_FAILED',
  'BOOKING_RESCHEDULED_OUTSIDE_PERIOD',
  'SAGA_COMPENSATION',
] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

export const REVERSE_REASONS = ['SERVICE_NOT_DELIVERED', 'RECORDED_IN_ERROR', 'GOODWILL'] as const;
export type ReverseReason = (typeof REVERSE_REASONS)[number];

export type SubscriptionRuleCode =
  | 'SUBSCRIPTION_NOT_PENDING'
  | 'SUBSCRIPTION_NOT_ACTIVE'
  | 'SUBSCRIPTION_NOT_FROZEN'
  | 'SUBSCRIPTION_CLOSED'
  | 'SUBSCRIPTION_FROZEN'
  | 'PERIOD_NOT_ENDED'
  | 'PERIOD_ENDED'
  | 'SCHEDULE_OUTSIDE_PERIOD'
  | 'PACKAGE_NOT_COVERED'
  | 'ENTITLEMENT_EXHAUSTED'
  | 'RESERVATION_NOT_RESERVED'
  | 'RESERVATION_NOT_COMMITTED'
  | 'RESERVATION_PACKAGE_MISMATCH'
  | 'VERSION_CONFLICT'
  | 'CUSTOMER_MAY_ONLY_CANCEL_PENDING';

export class SubscriptionRuleError extends Error {
  constructor(readonly code: SubscriptionRuleCode) {
    super(code);
    this.name = 'SubscriptionRuleError';
  }
}

export interface PeriodState {
  readonly periodNo: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly granted: number;
  readonly reserved: number;
  readonly consumed: number;
}

export interface SubscriptionState {
  readonly status: SubscriptionStatus;
  readonly version: number;
  readonly terms: PlanTerms;
  /** null until activated. */
  readonly currentPeriod: PeriodState | null;
}

export function available(period: PeriodState): number {
  return period.granted - period.reserved - period.consumed;
}

export function periodEnded(period: PeriodState, now: Date): boolean {
  return now.getTime() >= period.endsAt.getTime();
}

export function viewStatus(state: SubscriptionState, now: Date): SubscriptionView {
  if (
    (state.status === 'ACTIVE' || state.status === 'FROZEN') &&
    state.currentPeriod &&
    periodEnded(state.currentPeriod, now)
  )
    return 'EXPIRED';
  return state.status;
}

function expectVersion(state: SubscriptionState, expectedVersion: number): void {
  if (state.version !== expectedVersion) throw new SubscriptionRuleError('VERSION_CONFLICT');
}

/** A new period [now, now + periodDays) granting the snapshotted units. */
export function newPeriod(terms: PlanTerms, periodNo: number, now: Date): PeriodState {
  return {
    periodNo,
    startsAt: now,
    endsAt: new Date(now.getTime() + terms.periodDays * DAY_MS),
    granted: terms.washUnits,
    reserved: 0,
    consumed: 0,
  };
}

/** PENDING_ACTIVATION -> ACTIVE with period 1, after staff verified payment. */
export function planActivation(
  state: SubscriptionState,
  expectedVersion: number,
  now: Date,
): PeriodState {
  expectVersion(state, expectedVersion);
  if (state.status !== 'PENDING_ACTIVATION')
    throw new SubscriptionRuleError('SUBSCRIPTION_NOT_PENDING');
  return newPeriod(state.terms, 1, now);
}

/**
 * Renewal starts the next period only after the current one ended: periods never
 * overlap, and unused units of an ended period are not carried over (no rollover
 * policy is approved). The renewed period uses the terms of the plan revision in
 * force at renewal, supplied by the caller.
 */
export function planRenewal(
  state: SubscriptionState,
  expectedVersion: number,
  terms: PlanTerms,
  now: Date,
): PeriodState {
  expectVersion(state, expectedVersion);
  if (state.status !== 'ACTIVE' || !state.currentPeriod)
    throw new SubscriptionRuleError('SUBSCRIPTION_NOT_ACTIVE');
  if (!periodEnded(state.currentPeriod, now)) throw new SubscriptionRuleError('PERIOD_NOT_ENDED');
  return newPeriod(terms, state.currentPeriod.periodNo + 1, now);
}

/** Freezing blocks NEW reservations only; it does not move the period end. */
export function planFreeze(state: SubscriptionState, expectedVersion: number, now: Date): void {
  expectVersion(state, expectedVersion);
  if (state.status !== 'ACTIVE' || !state.currentPeriod)
    throw new SubscriptionRuleError('SUBSCRIPTION_NOT_ACTIVE');
  if (periodEnded(state.currentPeriod, now)) throw new SubscriptionRuleError('PERIOD_ENDED');
}

export function planUnfreeze(state: SubscriptionState, expectedVersion: number): void {
  expectVersion(state, expectedVersion);
  if (state.status !== 'FROZEN') throw new SubscriptionRuleError('SUBSCRIPTION_NOT_FROZEN');
}

/**
 * Staff may cancel any open subscription; a customer may only withdraw a
 * request that was never activated (refund of a paid plan is a Billing/B-06
 * decision, not something Subscription can grant). Reservations already made
 * stay settleable (commit/release) so in-flight bookings are not stranded.
 */
export function planCancel(
  state: SubscriptionState,
  expectedVersion: number,
  byCustomer: boolean,
): void {
  expectVersion(state, expectedVersion);
  if (state.status === 'CANCELLED') throw new SubscriptionRuleError('SUBSCRIPTION_CLOSED');
  if (byCustomer && state.status !== 'PENDING_ACTIVATION')
    throw new SubscriptionRuleError('CUSTOMER_MAY_ONLY_CANCEL_PENDING');
}

/**
 * Reserving one unit for a booking: the subscription is ACTIVE, the current
 * period has not ended, the booking's scheduled start lies inside the period,
 * the package is covered and a unit is still available.
 */
export function planReservation(input: {
  readonly state: SubscriptionState;
  readonly packageId: string;
  readonly scheduledFor: Date;
  readonly now: Date;
}): PeriodState {
  const { state, now } = input;
  if (state.status === 'FROZEN') throw new SubscriptionRuleError('SUBSCRIPTION_FROZEN');
  if (state.status !== 'ACTIVE' || !state.currentPeriod)
    throw new SubscriptionRuleError('SUBSCRIPTION_NOT_ACTIVE');
  const period = state.currentPeriod;
  if (periodEnded(period, now)) throw new SubscriptionRuleError('PERIOD_ENDED');
  if (
    input.scheduledFor.getTime() < period.startsAt.getTime() ||
    input.scheduledFor.getTime() >= period.endsAt.getTime()
  )
    throw new SubscriptionRuleError('SCHEDULE_OUTSIDE_PERIOD');
  if (!state.terms.coveredPackageIds.includes(input.packageId))
    throw new SubscriptionRuleError('PACKAGE_NOT_COVERED');
  if (available(period) < 1) throw new SubscriptionRuleError('ENTITLEMENT_EXHAUSTED');
  return { ...period, reserved: period.reserved + 1 };
}

export interface MovementDelta {
  readonly kind: MovementKind;
  readonly granted: number;
  readonly reserved: number;
  readonly consumed: number;
}

export type SettlementKind = Exclude<MovementKind, 'GRANT'>;

/** A GRANT movement carries the period's whole grant; see grantDelta. */
export function grantDelta(units: number): MovementDelta {
  return { kind: 'GRANT', granted: units, reserved: 0, consumed: 0 };
}

export const DELTAS: Readonly<Record<SettlementKind, MovementDelta>> = {
  RESERVE: { kind: 'RESERVE', granted: 0, reserved: 1, consumed: 0 },
  COMMIT: { kind: 'COMMIT', granted: 0, reserved: -1, consumed: 1 },
  RELEASE: { kind: 'RELEASE', granted: 0, reserved: -1, consumed: 0 },
  REVERSE: { kind: 'REVERSE', granted: 0, reserved: 0, consumed: -1 },
};

/** Applies one settlement movement to a period, refusing any broken invariant. */
export function applyMovement(period: PeriodState, kind: SettlementKind): PeriodState {
  const delta = DELTAS[kind];
  const next = {
    ...period,
    reserved: period.reserved + delta.reserved,
    consumed: period.consumed + delta.consumed,
  };
  if (next.reserved < 0 || next.consumed < 0 || next.reserved + next.consumed > next.granted)
    throw new SubscriptionRuleError('ENTITLEMENT_EXHAUSTED');
  return next;
}

/** Legal reservation transitions; anything else is refused (idempotent replays are handled by callers). */
export function nextReservationStatus(
  current: ReservationStatus,
  kind: 'COMMIT' | 'RELEASE' | 'REVERSE',
): ReservationStatus {
  if (kind === 'REVERSE') {
    if (current !== 'COMMITTED') throw new SubscriptionRuleError('RESERVATION_NOT_COMMITTED');
    return 'REVERSED';
  }
  if (current !== 'RESERVED') throw new SubscriptionRuleError('RESERVATION_NOT_RESERVED');
  return kind === 'COMMIT' ? 'COMMITTED' : 'RELEASED';
}
