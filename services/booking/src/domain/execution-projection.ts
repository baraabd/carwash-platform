import type { dispatchExecutionV1 } from '@carwash/contracts';
import type { BookingStatus } from './booking';

export interface ExecutionWatermark {
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly taskId: string | null;
  readonly taskRevision: number | null;
}

/**
 * Project one authoritative Dispatch snapshot, not an unverified milestone.
 * A source read can skip milestones; it does not invent them. Reassignment is
 * fenced by assignment revision, task mutations by the current task revision.
 */
export function projectExecution(
  status: BookingStatus,
  previous: ExecutionWatermark | null,
  current: dispatchExecutionV1.ExecutionV1,
): BookingStatus | 'STALE' {
  if (status === 'CANCELLED' || status === 'REJECTED' || status === 'EXPIRED') return 'STALE';
  if (status === 'PENDING_CONFIRMATION') throw new Error('BOOKING_CONFIRMATION_PENDING');
  if (previous) {
    if (previous.assignmentId !== current.assignmentId) throw new Error('ASSIGNMENT_ID_CHANGED');
    if (current.revision < previous.assignmentRevision) return 'STALE';
    if (current.revision === previous.assignmentRevision) {
      if (previous.taskId !== (current.task?.taskId ?? null))
        throw new Error('TASK_GENERATION_CONFLICT');
      if (
        current.task &&
        previous.taskRevision !== null &&
        current.task.revision < previous.taskRevision
      )
        return 'STALE';
    }
  }
  // Booking's cancellation saga owns cancellation and its reason. A Dispatch
  // cancellation must never manufacture it or reopen a completed booking.
  if (status === 'COMPLETED' || current.status === 'CANCELLED') return status;
  if (current.status !== 'ASSIGNED') return 'CONFIRMED';
  switch (current.task?.stage) {
    case 'ACCEPTED':
      return 'ASSIGNED';
    case 'EN_ROUTE':
      return 'EN_ROUTE';
    case 'ARRIVED':
      return 'ARRIVED';
    case 'IN_SERVICE':
    case 'DOCUMENTING':
    case 'FINISHED':
      return 'IN_PROGRESS';
    case 'CLOSED':
      if (!current.task.completedAt) throw new Error('COMPLETION_UNVERIFIED');
      return 'COMPLETED';
    default:
      throw new Error('LIVE_TASK_INCONSISTENT');
  }
}
