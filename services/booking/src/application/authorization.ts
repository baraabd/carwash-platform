import { BookingError, type Booking, type PrincipalRef } from '../domain';
import type { Actor } from '../ports';

/**
 * Deny by default. Permissions are Identity's (see @carwash/contracts
 * identity): customers and guests act on their own bookings only; operations
 * staff may read any booking. Another principal's booking is reported as not
 * found, so existence is not disclosed.
 */
export const CREATE_PERMISSION = 'bookings.create:self';
export const READ_PERMISSION = 'bookings.read:self';
export const OPERATIONS_PERMISSION = 'operations.dispatch';

export function requirePrincipal(actor: Actor, permission: string): PrincipalRef {
  if (actor.kind !== 'USER' || !actor.permissions.includes(permission)) {
    throw new BookingError('FORBIDDEN', 'The operation is not allowed.');
  }
  return { kind: actor.principalKind, subjectId: actor.subject };
}

export function assertCanRead(actor: Actor, booking: Booking): void {
  if (actor.kind !== 'USER') throw new BookingError('FORBIDDEN', 'The operation is not allowed.');
  if (actor.permissions.includes(OPERATIONS_PERMISSION)) return;
  if (!actor.permissions.includes(READ_PERMISSION)) {
    throw new BookingError('FORBIDDEN', 'The operation is not allowed.');
  }
  const own =
    actor.principalKind === booking.beneficiary.kind &&
    actor.subject === booking.beneficiary.subjectId;
  if (!own) throw new BookingError('BOOKING_NOT_FOUND', 'Booking not found.');
}
