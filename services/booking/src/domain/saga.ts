import type { RejectionReason } from './booking';

/**
 * Creation saga (process manager) for one booking: pure decisions only.
 *
 * Order of the remote steps, and why:
 *
 *   VALIDATE_QUOTE     safe read (Pricing). Nothing to compensate.
 *   CREATE_OBLIGATION  Billing obligation, idempotent by booking. Compensable:
 *                      VOID_OBLIGATION.
 *   COMMIT_HOLD        PIVOT (Scheduling). scheduling.v1 gives Booking no way to
 *                      undo a commit, so it runs last among the remote steps and
 *                      everything after it only moves forward.
 *   (local)            booking CONFIRMED + BookingCreated in the outbox, one
 *                      local transaction.
 *
 * Failure handling:
 *   - before the pivot, a definitive refusal rejects the booking (after voiding
 *     an obligation that may exist); unavailability retries with backoff until
 *     the deadline, then rejects with DEADLINE_EXCEEDED;
 *   - once COMMIT_HOLD has been attempted its outcome may be COMMITTED even if
 *     the response was lost, so the deadline no longer applies: the commit is
 *     replayed (same booking id) until Scheduling gives a definitive answer;
 *   - a committed hold that does not match the requested slot is never
 *     confirmed: the saga stops in NEEDS_RECONCILIATION for operations.
 */
export const SAGA_STEPS = [
  'VALIDATE_QUOTE',
  'CREATE_OBLIGATION',
  'COMMIT_HOLD',
  'VOID_OBLIGATION',
  'DONE',
  'NEEDS_RECONCILIATION',
] as const;
export type SagaStep = (typeof SAGA_STEPS)[number];

export type SagaOutcome = 'CONFIRMED' | 'REJECTED';

export interface SagaState {
  readonly bookingId: string;
  readonly step: SagaStep;
  readonly outcome: SagaOutcome | null;
  /** Why the booking will be rejected once compensation finishes. */
  readonly pendingRejection: RejectionReason | null;
  readonly obligationId: string | null;
  /** True once COMMIT_HOLD was sent at least once: no deadline-based rejection after it. */
  readonly pivotAttempted: boolean;
  /** Attempts of the current step. */
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  /** Before the pivot, unavailability past this instant rejects the booking. */
  readonly deadlineAt: Date;
  readonly lastError: string | null;
  /** Fencing token: bumped on every lease, checked on every write. */
  readonly fence: number;
  readonly version: number;
  readonly updatedAt: Date;
}

export const SAGA_POLICY = Object.freeze({
  /** Bound for reaching the pivot; the scheduling.v1 hold lives 10 minutes. */
  deadlineMs: 10 * 60_000,
  baseDelayMs: 500,
  maxDelayBeforePivotMs: 30_000,
  maxDelayAfterPivotMs: 5 * 60_000,
});

export function newSaga(bookingId: string, now: Date): SagaState {
  return {
    bookingId,
    step: 'VALIDATE_QUOTE',
    outcome: null,
    pendingRejection: null,
    obligationId: null,
    pivotAttempted: false,
    attempts: 0,
    nextAttemptAt: now,
    deadlineAt: new Date(now.getTime() + SAGA_POLICY.deadlineMs),
    lastError: null,
    fence: 0,
    version: 1,
    updatedAt: now,
  };
}

export function isTerminal(step: SagaStep): boolean {
  return step === 'DONE' || step === 'NEEDS_RECONCILIATION';
}

/**
 * Exponential backoff with full jitter. `random` is injected (0 <= r < 1) so
 * tests are deterministic; the floor keeps a hot loop impossible.
 */
export function backoffMs(attempts: number, afterPivot: boolean, random: number): number {
  const ceiling = Math.min(
    afterPivot ? SAGA_POLICY.maxDelayAfterPivotMs : SAGA_POLICY.maxDelayBeforePivotMs,
    SAGA_POLICY.baseDelayMs * 2 ** Math.min(Math.max(attempts, 0), 16),
  );
  return Math.max(100, Math.floor(random * ceiling));
}

function advance(
  saga: SagaState,
  step: SagaStep,
  now: Date,
  patch: Partial<SagaState> = {},
): SagaState {
  return {
    ...saga,
    step,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    ...patch,
    version: saga.version + 1,
    updatedAt: now,
  };
}

/** The booking ends REJECTED once nothing that may exist remotely is left behind. */
function rejectOrCompensate(saga: SagaState, reason: RejectionReason, now: Date): SagaState {
  if (saga.step === 'CREATE_OBLIGATION' || saga.obligationId !== null) {
    // An obligation may exist (created, or its creation outcome unknown).
    return advance(saga, 'VOID_OBLIGATION', now, { pendingRejection: reason });
  }
  return advance(saga, 'DONE', now, { outcome: 'REJECTED', pendingRejection: reason });
}

function retry(saga: SagaState, error: string, now: Date, random: number): SagaState {
  const attempts = saga.attempts + 1;
  const afterPivot = saga.pivotAttempted || saga.step === 'VOID_OBLIGATION';
  return {
    ...saga,
    attempts,
    lastError: error,
    nextAttemptAt: new Date(now.getTime() + backoffMs(attempts, afterPivot, random)),
    version: saga.version + 1,
    updatedAt: now,
  };
}

/** Pre-pivot unavailability: retry, or give up once the deadline has passed. */
function retryBeforePivot(saga: SagaState, error: string, now: Date, random: number): SagaState {
  if (now.getTime() >= saga.deadlineAt.getTime()) {
    return rejectOrCompensate(saga, 'DEADLINE_EXCEEDED', now);
  }
  return retry(saga, error, now, random);
}

function expectStep(saga: SagaState, step: SagaStep): void {
  if (saga.step !== step) throw new Error(`SAGA_STEP_MISMATCH_${saga.step}_${step}`);
}

export type QuoteCheck =
  | { readonly kind: 'VALID' }
  | { readonly kind: 'INVALID'; readonly reason: RejectionReason }
  | { readonly kind: 'UNAVAILABLE'; readonly error: string };

export function onQuoteChecked(
  saga: SagaState,
  result: QuoteCheck,
  now: Date,
  random: number,
): SagaState {
  expectStep(saga, 'VALIDATE_QUOTE');
  if (result.kind === 'VALID') return advance(saga, 'CREATE_OBLIGATION', now);
  if (result.kind === 'INVALID') return rejectOrCompensate(saga, result.reason, now);
  return retryBeforePivot(saga, result.error, now, random);
}

export type ObligationResult =
  | { readonly kind: 'CREATED'; readonly obligationId: string }
  | { readonly kind: 'REJECTED' }
  /** Not sent, or sent with an unknown outcome. Creation is idempotent by booking. */
  | { readonly kind: 'UNAVAILABLE'; readonly error: string };

export function onObligation(
  saga: SagaState,
  result: ObligationResult,
  now: Date,
  random: number,
): SagaState {
  expectStep(saga, 'CREATE_OBLIGATION');
  if (result.kind === 'CREATED') {
    return advance(saga, 'COMMIT_HOLD', now, { obligationId: result.obligationId });
  }
  if (result.kind === 'REJECTED') {
    // Definitively refused: nothing exists to void.
    return advance(saga, 'DONE', now, {
      outcome: 'REJECTED',
      pendingRejection: 'OBLIGATION_REJECTED',
    });
  }
  return retryBeforePivot(saga, result.error, now, random);
}

/** Marks the pivot as attempted BEFORE the request leaves (persisted first). */
export function beginCommit(saga: SagaState, now: Date): SagaState {
  expectStep(saga, 'COMMIT_HOLD');
  if (saga.pivotAttempted) return saga;
  return { ...saga, pivotAttempted: true, version: saga.version + 1, updatedAt: now };
}

export type CommitResult =
  | { readonly kind: 'COMMITTED'; readonly matchesRequest: boolean }
  | { readonly kind: 'REFUSED'; readonly reason: 'HOLD_EXPIRED' | 'HOLD_UNAVAILABLE' }
  | { readonly kind: 'UNKNOWN'; readonly error: string };

export function onCommit(
  saga: SagaState,
  result: CommitResult,
  now: Date,
  random: number,
): SagaState {
  expectStep(saga, 'COMMIT_HOLD');
  if (!saga.pivotAttempted) throw new Error('SAGA_PIVOT_NOT_RECORDED');
  if (result.kind === 'COMMITTED') {
    if (!result.matchesRequest) {
      return advance(saga, 'NEEDS_RECONCILIATION', now, { lastError: 'COMMITTED_SLOT_MISMATCH' });
    }
    return advance(saga, 'DONE', now, { outcome: 'CONFIRMED' });
  }
  if (result.kind === 'REFUSED') return rejectOrCompensate(saga, result.reason, now);
  // The commit may have happened. Never reject on time here; replay it.
  return retry(saga, result.error, now, random);
}

export type VoidResult =
  { readonly kind: 'VOIDED' } | { readonly kind: 'UNAVAILABLE'; readonly error: string };

export function onVoid(saga: SagaState, result: VoidResult, now: Date, random: number): SagaState {
  expectStep(saga, 'VOID_OBLIGATION');
  if (result.kind === 'VOIDED') return advance(saga, 'DONE', now, { outcome: 'REJECTED' });
  // Compensation must finish; it is retried without a deadline.
  return retry(saga, result.error, now, random);
}
