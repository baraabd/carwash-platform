/**
 * Booking rule violations.
 *
 * Framework-free: the transport maps each code to the platform error envelope.
 * The code is a stable machine value; the message is diagnostic English that
 * never carries personal data (no name, phone, plate or address text).
 */
export type BookingErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'BOOKING_NOT_FOUND'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'HOLD_ALREADY_BOOKED'
  | 'QUOTE_ALREADY_BOOKED'
  | 'QUOTE_NOT_USABLE'
  | 'QUOTE_MISMATCH'
  | 'VEHICLE_NOT_USABLE'
  | 'ADDRESS_NOT_USABLE'
  | 'DEPENDENCY_UNAVAILABLE'
  /** Dispatch could not confirm the caller's assignment: fail closed, never allow. */
  | 'ASSIGNMENT_UNVERIFIED'
  | 'INVALID_TRANSITION'
  | 'VERSION_CONFLICT'
  /** The client's expectedRevision is stale (412). */
  | 'REVISION_CONFLICT'
  | 'BOOKING_NOT_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'CHANGE_IN_PROGRESS'
  | 'CHANGE_NOT_FOUND'
  | 'HOLD_NOT_USABLE';

export class BookingError extends Error {
  constructor(
    readonly code: BookingErrorCode,
    message: string,
    /** Owner-allowlisted refinement for the error envelope, e.g. QUOTE_EXPIRED. */
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

export function invalid(message: string): BookingError {
  return new BookingError('INVALID_INPUT', message);
}
