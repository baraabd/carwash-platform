import { SchedulingError } from '../domain';
import type { Actor, SchedulingScope } from '../ports';

/**
 * Server-side, deny-by-default authorization.
 *
 * Capacity management uses Identity's `operations.dispatch` permission because
 * Identity V1 publishes no narrower permission yet; a dedicated
 * `scheduling.capacity.manage` permission is requested from Lane E (CR-C1).
 */
export const OPERATIONS_PERMISSION = 'operations.dispatch';
export const CUSTOMER_BOOKING_PERMISSION = 'bookings.create:self';

export function isOperations(actor: Actor): boolean {
  return actor.kind === 'USER' && actor.permissions.includes(OPERATIONS_PERMISSION);
}

export function hasScope(actor: Actor, scope: SchedulingScope): boolean {
  return actor.kind === 'SERVICE' && actor.scopes.includes(scope);
}

export function requireOperations(actor: Actor): void {
  if (!isOperations(actor))
    throw new SchedulingError('FORBIDDEN', 'Operations permission required.');
}

export function requireScope(
  actor: Actor,
  scope: SchedulingScope,
): Extract<Actor, { kind: 'SERVICE' }> {
  if (actor.kind !== 'SERVICE' || !actor.scopes.includes(scope)) {
    throw new SchedulingError('FORBIDDEN', 'Service scope required.');
  }
  return actor;
}

export type AvailabilityAudience = 'CUSTOMER' | 'DETAILED';

export function availabilityAudience(actor: Actor): AvailabilityAudience {
  if (isOperations(actor) || hasScope(actor, 'scheduling.availability.read')) return 'DETAILED';
  if (actor.kind === 'USER' && actor.permissions.includes(CUSTOMER_BOOKING_PERMISSION)) {
    return 'CUSTOMER';
  }
  throw new SchedulingError('FORBIDDEN', 'Not allowed to read availability.');
}
