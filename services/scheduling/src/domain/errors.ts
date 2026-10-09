/**
 * Scheduling rule violations.
 *
 * Framework-free: the transport maps each code to an HTTP status. A code is a
 * stable public identifier; the message is diagnostic text without personal data.
 */
export type SchedulingErrorCode =
  | 'INVALID_INPUT'
  | 'WINDOW_NOT_FOUND'
  | 'WINDOW_EXISTS'
  | 'WINDOW_OVERLAPS'
  | 'WINDOW_CLOSED'
  | 'WINDOW_STARTED'
  | 'CAPACITY_EXHAUSTED'
  | 'CAPACITY_BELOW_COMMITTED'
  | 'HOLD_NOT_FOUND'
  | 'HOLD_EXPIRED'
  | 'HOLD_NOT_ACTIVE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'VERSION_CONFLICT'
  | 'SLOT_UNAVAILABLE'
  | 'OUTSIDE_HORIZON'
  | 'HOLD_LIMIT_REACHED'
  | 'BOOKING_ALREADY_COMMITTED'
  | 'FORBIDDEN';

export class SchedulingError extends Error {
  constructor(
    readonly code: SchedulingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SchedulingError';
  }
}

export function invalid(message: string): SchedulingError {
  return new SchedulingError('INVALID_INPUT', message);
}
