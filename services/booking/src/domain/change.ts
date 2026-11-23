import type { SlotSnapshot } from './snapshots';
import { backoffMs } from './saga';

/**
 * Change saga (process manager) for a CONFIRMED booking: pure decisions only
 * (P04-C, decision P04-C-D2). Booking owns the change request and its history;
 * Dispatch decides whether work has progressed (P04-C-D1), Scheduling owns the
 * capacity and Billing the money.
 *
 * CANCELLATION
 *   DISPATCH_CANCEL   PIVOT. Dispatch cancels the job (or tombstones it) unless
 *                     the technician has left (WORK_STARTED) or finished
 *                     (WORK_COMPLETED): that refusal ends the change REFUSED and
 *                     nothing was changed anywhere. Once Dispatch accepted, the
 *                     booking becomes CANCELLED (+ booking.cancelled.v1) in the
 *                     same local transaction that records the pivot.
 *   RELEASE_CAPACITY  Scheduling frees the committed unit. Forward only.
 *   SETTLE_BILLING    Billing voids the obligation or opens a refund case
 *                     (late or earlier payment). Forward only.
 *
 * RESCHEDULE
 *   DISPATCH_REBIND     Dispatch moves the job to the new (held) slot, pending.
 *                       WORK_* / BOOKING_CANCELLED refusals end it REFUSED.
 *   REPLACE_COMMITMENT  PIVOT. Scheduling moves the commitment atomically. The
 *                       booking's schedule changes (+ booking.rescheduled.v1)
 *                       in the transaction that records the pivot.
 *   DISPATCH_CONFIRM    The pending binding becomes final. Forward only.
 *   DISPATCH_REVERT     Compensation when the replace was refused or the new
 *                       hold's deadline passed before the pivot: the job goes
 *                       back to the original slot; the change ends FAILED.
 *
 * UNKNOWN outcomes (timeout, 5xx, no answer) never count as success: the step
 * is retried with the same change id (every owner command is replay-safe by
 * it). Before a pivot a deadline may end the attempt (reschedule only: the new
 * hold expires); after the pivot was attempted there is no deadline, only
 * retries, and `attention` is raised once a step keeps failing.
 */
export const CHANGE_KINDS = ['CANCELLATION', 'RESCHEDULE'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_STEPS = [
  'DISPATCH_CANCEL',
  'RELEASE_CAPACITY',
  'SETTLE_BILLING',
  'DISPATCH_REBIND',
  'REPLACE_COMMITMENT',
  'DISPATCH_CONFIRM',
  'DISPATCH_REVERT',
  'DONE',
] as const;
export type ChangeStep = (typeof CHANGE_STEPS)[number];

export type ChangeOutcome = 'COMPLETED' | 'REFUSED' | 'FAILED';

export const CUSTOMER_CANCELLATION_REASONS = ['CUSTOMER_REQUEST'] as const;
export const STAFF_CANCELLATION_REASONS = [
  'OPERATIONS_REQUEST',
  'CUSTOMER_REQUEST_BY_PHONE',
  'SERVICE_UNAVAILABLE',
] as const;
export type CancellationReason =
  (typeof CUSTOMER_CANCELLATION_REASONS)[number] | (typeof STAFF_CANCELLATION_REASONS)[number];

export type ChangeRefusal =
  | 'WORK_STARTED'
  | 'WORK_COMPLETED'
  | 'BOOKING_CANCELLED'
  | 'HOLD_EXPIRED'
  | 'HOLD_NOT_ACTIVE'
  | 'HOLD_UNAVAILABLE'
  | 'DISPATCH_NOT_READY';

export type Settlement = 'PENDING' | 'VOIDED' | 'REFUND_PENDING' | 'NOTHING_DUE';

export type Requester =
  | { readonly kind: 'account' | 'guest'; readonly subjectId: string }
  | { readonly kind: 'staff'; readonly subjectId: string };

export interface TargetSlot extends SlotSnapshot {
  readonly holdRevision: number;
  /** The hold's deadline: the reschedule must reach its pivot before it. */
  readonly expiresAt: Date;
}

export interface ChangeState {
  readonly changeId: string;
  readonly bookingId: string;
  readonly kind: ChangeKind;
  readonly step: ChangeStep;
  readonly outcome: ChangeOutcome | null;
  readonly reason: CancellationReason | null;
  readonly refusal: ChangeRefusal | null;
  readonly requester: Requester;
  /** The slot the booking had when the change was requested. */
  readonly from: SlotSnapshot;
  /** RESCHEDULE only. */
  readonly to: TargetSlot | null;
  /** CANCELLATION only, once Billing answered (PENDING until then). */
  readonly settlement: Settlement | null;
  /** True once the pivot request was sent at least once: no deadline after it. */
  readonly pivotAttempted: boolean;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  /** RESCHEDULE: the new hold's deadline. CANCELLATION: none. */
  readonly deadlineAt: Date | null;
  readonly lastError: string | null;
  /** Raised when a step keeps failing; operations look at it. Never success. */
  readonly attention: boolean;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

export const CHANGE_POLICY = Object.freeze({
  /** Attempts of one step after which the change is flagged for operations. */
  attentionAfterAttempts: 8,
});

export function newCancellation(input: {
  readonly changeId: string;
  readonly bookingId: string;
  readonly reason: CancellationReason;
  readonly requester: Requester;
  readonly from: SlotSnapshot;
  readonly now: Date;
}): ChangeState {
  return base({
    ...input,
    kind: 'CANCELLATION',
    step: 'DISPATCH_CANCEL',
    to: null,
    deadlineAt: null,
  });
}

export function newReschedule(input: {
  readonly changeId: string;
  readonly bookingId: string;
  readonly requester: Requester;
  readonly from: SlotSnapshot;
  readonly to: TargetSlot;
  readonly now: Date;
}): ChangeState {
  return base({
    ...input,
    kind: 'RESCHEDULE',
    step: 'DISPATCH_REBIND',
    reason: null,
    deadlineAt: input.to.expiresAt,
  });
}

function base(input: {
  readonly changeId: string;
  readonly bookingId: string;
  readonly kind: ChangeKind;
  readonly step: ChangeStep;
  readonly reason: CancellationReason | null;
  readonly requester: Requester;
  readonly from: SlotSnapshot;
  readonly to: TargetSlot | null;
  readonly deadlineAt: Date | null;
  readonly now: Date;
}): ChangeState {
  return {
    changeId: input.changeId,
    bookingId: input.bookingId,
    kind: input.kind,
    step: input.step,
    outcome: null,
    reason: input.reason,
    refusal: null,
    requester: input.requester,
    from: input.from,
    to: input.to,
    settlement: input.kind === 'CANCELLATION' ? 'PENDING' : null,
    pivotAttempted: false,
    attempts: 0,
    nextAttemptAt: input.now,
    deadlineAt: input.deadlineAt,
    lastError: null,
    attention: false,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
    completedAt: null,
  };
}

export function isChangeOpen(change: ChangeState): boolean {
  return change.step !== 'DONE';
}

function expectStep(change: ChangeState, step: ChangeStep): void {
  if (change.step !== step) throw new Error(`CHANGE_STEP_MISMATCH_${change.step}_${step}`);
}

function advance(
  change: ChangeState,
  step: ChangeStep,
  now: Date,
  patch: Partial<ChangeState> = {},
): ChangeState {
  const finished = step === 'DONE';
  return {
    ...change,
    step,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    attention: false,
    ...patch,
    completedAt: finished ? now : change.completedAt,
    version: change.version + 1,
    updatedAt: now,
  };
}

function retry(change: ChangeState, error: string, now: Date, random: number): ChangeState {
  const attempts = change.attempts + 1;
  return {
    ...change,
    attempts,
    lastError: error,
    attention: change.attention || attempts >= CHANGE_POLICY.attentionAfterAttempts,
    nextAttemptAt: new Date(now.getTime() + backoffMs(attempts, true, random)),
    version: change.version + 1,
    updatedAt: now,
  };
}

/** The deadline of a reschedule passed before its pivot. */
function pastDeadline(change: ChangeState, now: Date): boolean {
  return (
    !change.pivotAttempted &&
    change.deadlineAt !== null &&
    now.getTime() >= change.deadlineAt.getTime()
  );
}

// -------------------------------------------------------------- cancellation

export type DispatchCancelResult =
  | { readonly kind: 'CANCELLED' }
  /** No job existed yet; Dispatch recorded a tombstone so none will open. */
  | { readonly kind: 'NOT_OPENED' }
  | { readonly kind: 'REFUSED'; readonly reason: 'WORK_STARTED' | 'WORK_COMPLETED' }
  | { readonly kind: 'UNKNOWN'; readonly error: string };

/** Marks the pivot as attempted BEFORE the request leaves (persisted first). */
export function beginPivot(change: ChangeState, now: Date): ChangeState {
  if (change.pivotAttempted) return change;
  return { ...change, pivotAttempted: true, version: change.version + 1, updatedAt: now };
}

export function onDispatchCancel(
  change: ChangeState,
  result: DispatchCancelResult,
  now: Date,
  random: number,
): ChangeState {
  expectStep(change, 'DISPATCH_CANCEL');
  if (result.kind === 'CANCELLED' || result.kind === 'NOT_OPENED') {
    return advance(change, 'RELEASE_CAPACITY', now);
  }
  if (result.kind === 'REFUSED') {
    return advance(change, 'DONE', now, {
      outcome: 'REFUSED',
      refusal: result.reason,
      settlement: null,
    });
  }
  return retry(change, result.error, now, random);
}

export type CapacityReleaseResult =
  | { readonly kind: 'RELEASED' }
  /** The hold is not (or no longer) committed to the booking: nothing of ours to free. */
  | { readonly kind: 'NOT_COMMITTED' }
  | { readonly kind: 'UNKNOWN'; readonly error: string };

export function onCapacityReleased(
  change: ChangeState,
  result: CapacityReleaseResult,
  now: Date,
  random: number,
): ChangeState {
  expectStep(change, 'RELEASE_CAPACITY');
  if (result.kind === 'RELEASED') return advance(change, 'SETTLE_BILLING', now);
  if (result.kind === 'NOT_COMMITTED') {
    // Recorded for reconciliation; the booking is cancelled either way.
    return advance(change, 'SETTLE_BILLING', now, { lastError: 'CAPACITY_NOT_COMMITTED' });
  }
  return retry(change, result.error, now, random);
}

export type SettlementResult =
  | { readonly kind: 'SETTLED'; readonly settlement: Exclude<Settlement, 'PENDING'> }
  | { readonly kind: 'UNKNOWN'; readonly error: string };

export function onSettled(
  change: ChangeState,
  result: SettlementResult,
  now: Date,
  random: number,
): ChangeState {
  expectStep(change, 'SETTLE_BILLING');
  if (result.kind === 'SETTLED') {
    return advance(change, 'DONE', now, { outcome: 'COMPLETED', settlement: result.settlement });
  }
  return retry(change, result.error, now, random);
}

// ---------------------------------------------------------------- reschedule

export type RebindResult =
  | { readonly kind: 'REBOUND' }
  | {
      readonly kind: 'REFUSED';
      readonly reason: 'WORK_STARTED' | 'WORK_COMPLETED' | 'BOOKING_CANCELLED';
    }
  /** Dispatch has not opened the job yet (its COMMITTED event is in flight). */
  | { readonly kind: 'NOT_READY' }
  | { readonly kind: 'UNKNOWN'; readonly error: string };

export function onRebind(
  change: ChangeState,
  result: RebindResult,
  now: Date,
  random: number,
): ChangeState {
  expectStep(change, 'DISPATCH_REBIND');
  if (result.kind === 'REBOUND') return advance(change, 'REPLACE_COMMITMENT', now);
  if (result.kind === 'REFUSED') {
    return advance(change, 'DONE', now, { outcome: 'REFUSED', refusal: result.reason });
  }
  if (pastDeadline(change, now)) {
    // The rebind may have been applied (UNKNOWN); the revert is replay-safe and
    // leaves a tombstone otherwise, so a late rebind can never stick.
    return advance(change, 'DISPATCH_REVERT', now, {
      refusal: result.kind === 'NOT_READY' ? 'DISPATCH_NOT_READY' : 'HOLD_EXPIRED',
    });
  }
  return retry(
    change,
    result.kind === 'NOT_READY' ? 'DISPATCH_NOT_READY' : result.error,
    now,
    random,
  );
}

export type ReplaceResult =
  | { readonly kind: 'REPLACED'; readonly slot: SlotSnapshot }
  | {
      readonly kind: 'REFUSED';
      readonly reason: 'HOLD_EXPIRED' | 'HOLD_NOT_ACTIVE' | 'HOLD_UNAVAILABLE';
    }
  | { readonly kind: 'UNKNOWN'; readonly error: string };

export function onReplace(
  change: ChangeState,
  result: ReplaceResult,
  now: Date,
  random: number,
): ChangeState {
  expectStep(change, 'REPLACE_COMMITMENT');
  if (!change.pivotAttempted) throw new Error('CHANGE_PIVOT_NOT_RECORDED');
  if (result.kind === 'REPLACED') return advance(change, 'DISPATCH_CONFIRM', now);
  if (result.kind === 'REFUSED') {
    return advance(change, 'DISPATCH_REVERT', now, { refusal: result.reason });
  }
  // The replace may have happened: replay it (by booking) until Scheduling answers.
  return retry(change, result.error, now, random);
}

export type ConfirmResult =
  { readonly kind: 'CONFIRMED' } | { readonly kind: 'UNKNOWN'; readonly error: string };

export function onConfirm(
  change: ChangeState,
  result: ConfirmResult,
  now: Date,
  random: number,
): ChangeState {
  expectStep(change, 'DISPATCH_CONFIRM');
  if (result.kind === 'CONFIRMED') return advance(change, 'DONE', now, { outcome: 'COMPLETED' });
  return retry(change, result.error, now, random);
}

export type RevertResult =
  { readonly kind: 'REVERTED' } | { readonly kind: 'UNKNOWN'; readonly error: string };

export function onRevert(
  change: ChangeState,
  result: RevertResult,
  now: Date,
  random: number,
): ChangeState {
  expectStep(change, 'DISPATCH_REVERT');
  if (result.kind === 'REVERTED') return advance(change, 'DONE', now, { outcome: 'FAILED' });
  // Compensation must finish; it is retried without a deadline.
  return retry(change, result.error, now, random);
}

/**
 * The step whose success changes the booking itself: the transition that
 * leaves it must commit together with the booking update and its event.
 */
export function isPivotExit(before: ChangeState, after: ChangeState): boolean {
  return (
    (before.step === 'DISPATCH_CANCEL' && after.step === 'RELEASE_CAPACITY') ||
    (before.step === 'REPLACE_COMMITMENT' && after.step === 'DISPATCH_CONFIRM')
  );
}
