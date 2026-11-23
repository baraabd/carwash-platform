import { SchedulingError } from '../domain';
import type { Actor, SchedulingScope } from '../ports';

/**
 * Server-side, deny-by-default authorization for scheduling.v1 access modes:
 *   public                   availability
 *   principal                hold create/read/release, own holds only
 *   service:<scope>          hold commit (Booking)
 *   permission:<name>        staff capacity management (owner-only surface)
 *
 * Staff capacity management uses Identity's `operations.dispatch` until a
 * narrower permission is published (CR-P02-C1).
 */
export const OPERATIONS_PERMISSION = 'operations.dispatch';

export type PrincipalActor = Extract<Actor, { kind: 'USER' }>;
export type ServiceActor = Extract<Actor, { kind: 'SERVICE' }>;

export function isOperations(actor: Actor): boolean {
  return actor.kind === 'USER' && actor.permissions.includes(OPERATIONS_PERMISSION);
}

export function requireOperations(actor: Actor): void {
  if (!isOperations(actor)) {
    throw new SchedulingError('FORBIDDEN', 'Operations permission required.');
  }
}

export function requirePrincipal(actor: Actor): PrincipalActor {
  if (actor.kind !== 'USER') throw new SchedulingError('FORBIDDEN', 'A principal is required.');
  return actor;
}

export function requireScope(actor: Actor, scope: SchedulingScope): ServiceActor {
  if (actor.kind !== 'SERVICE' || !actor.scopes.includes(scope)) {
    throw new SchedulingError('FORBIDDEN', 'Service scope required.');
  }
  return actor;
}

/** Idempotency scopes always include the authenticated actor (protocol rule). */
export function actorKey(actor: Actor): string {
  if (actor.kind === 'USER') return `${actor.principalKind}:${actor.subject}`;
  if (actor.kind === 'SERVICE') return `service:${actor.clientId}`;
  return `system:${actor.component}`;
}
