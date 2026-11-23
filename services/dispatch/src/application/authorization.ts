import { DispatchError } from '../domain';
import type { Actor, DispatchScope } from '../ports';

/**
 * Identity permissions this service relies on (published in
 * @carwash/contracts identity.ts). Deny by default.
 *   operations.dispatch     - operations staff: offer, reassign, unassign, read jobs
 *   work.read:assigned      - a technician reads the offers addressed to them
 *   work.execute:assigned   - a technician accepts or declines those offers
 */
export const OPERATIONS_DISPATCH = 'operations.dispatch';
export const WORK_READ = 'work.read:assigned';
export const WORK_EXECUTE = 'work.execute:assigned';

export type UserActor = Extract<Actor, { kind: 'USER' }>;

export function requirePermission(actor: Actor, permission: string): UserActor {
  if (actor.kind !== 'USER' || !actor.permissions.includes(permission)) {
    throw new DispatchError('FORBIDDEN', 'Permission denied.');
  }
  return actor;
}

export function isOperations(actor: Actor): boolean {
  return actor.kind === 'USER' && actor.permissions.includes(OPERATIONS_DISPATCH);
}

export function hasScope(actor: Actor, scope: DispatchScope): boolean {
  return actor.kind === 'SERVICE' && actor.scopes.includes(scope);
}

/** Stable key of the caller for idempotency scoping and rate budgets. */
export function actorKey(actor: Actor): string {
  if (actor.kind === 'USER') return `user:${actor.subject}`;
  if (actor.kind === 'SERVICE') return `service:${actor.clientId}`;
  return `system:${actor.component}`;
}
