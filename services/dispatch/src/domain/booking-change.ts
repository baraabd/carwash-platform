import { DispatchError } from './errors';
import type { JobSlot } from './assignment';
import { FIELD_STAGES, type TaskState } from './task';

/**
 * A change Booking asked Dispatch to apply to a booking's job (P04-C2).
 *
 * Decision P04-C-D1: Dispatch is the work-progress gate. Whether a booking can
 * still be cancelled or moved is decided here, under the assignment row lock,
 * in the same transaction that withdraws the offer and ends a not-started
 * task, so a technician step and a change have exactly one winner.
 *
 *   CANCELLATION: CANCELLED (job cancelled) | NOT_OPENED (no job yet: a
 *                 tombstone that stops a late COMMITTED event from opening one)
 *   REBIND:       REBOUND -> CONFIRMED | REVERTED
 *                 REVERTED without a rebind (the revert arrived first) is a
 *                 tombstone that refuses a late rebind with the same change id.
 *
 * The record is keyed by Booking's change id, which makes every command
 * replay-safe across lost responses, whatever Idempotency-Key the retry uses.
 */
export type BookingChangeKind = 'CANCELLATION' | 'REBIND';
export type BookingChangeState = 'CANCELLED' | 'NOT_OPENED' | 'REBOUND' | 'CONFIRMED' | 'REVERTED';

export interface BookingChange {
  readonly changeId: string;
  readonly bookingId: string;
  readonly kind: BookingChangeKind;
  readonly state: BookingChangeState;
  readonly assignmentId: string | null;
  /** REBIND only: the slot the job was bound to before, restored by a revert. */
  readonly from: JobSlot | null;
  /** REBIND only: the slot the job was moved to. */
  readonly to: JobSlot | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type WorkProgress = 'NOT_STARTED' | 'STARTED' | 'COMPLETED';

/** Progress of the job's live task (null = no task, or it ended). */
export function workProgress(task: TaskState | null): WorkProgress {
  if (task === null || task.stage === 'ACCEPTED') return 'NOT_STARTED';
  if (task.stage === 'CLOSED') return 'COMPLETED';
  if (FIELD_STAGES.includes(task.stage)) return 'STARTED';
  // RELEASED / WITHDRAWN / CANCELLED are not live; lockLiveTask never returns them.
  return 'NOT_STARTED';
}

/** A booking whose technician has left, or whose work is done, cannot be changed. */
export function assertChangeable(task: TaskState | null): void {
  const progress = workProgress(task);
  if (progress === 'STARTED') {
    throw new DispatchError('WORK_STARTED', 'The technician has already started this job.');
  }
  if (progress === 'COMPLETED') {
    throw new DispatchError('WORK_COMPLETED', 'This job was already completed.');
  }
}

export function assertSameChange(
  change: BookingChange,
  bookingId: string,
  kind: BookingChangeKind,
): void {
  if (change.bookingId !== bookingId || change.kind !== kind) {
    throw new DispatchError('CHANGE_MISMATCH', 'The change id belongs to another request.');
  }
}
