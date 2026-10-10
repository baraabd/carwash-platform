import { MediaError } from '../domain';
import type { Actor, MediaScope } from '../ports';

/**
 * Identity permissions this service relies on (published in
 * @carwash/contracts identity.ts). Deny by default.
 *   work.execute:assigned - a technician reserves, uploads and finalizes evidence
 *   work.read:assigned    - a technician reads back their own evidence
 * Service scopes (interim digest credentials, see infrastructure/security):
 *   media.object.read     - read an object view or a short-lived download URL
 *   media.object.claim    - record that a holder (Dispatch task evidence) keeps it
 */
export const WORK_READ = 'work.read:assigned';
export const WORK_EXECUTE = 'work.execute:assigned';

export type UserActor = Extract<Actor, { kind: 'USER' }>;

export function forbidden(): MediaError {
  return new MediaError('FORBIDDEN', 'Permission denied.');
}

export function requirePermission(actor: Actor, permission: string): UserActor {
  if (actor.kind !== 'USER' || !actor.permissions.includes(permission)) throw forbidden();
  return actor;
}

/** A user who may read their own technician work (either work permission). */
export function workReader(actor: Actor): UserActor | null {
  if (actor.kind !== 'USER') return null;
  return actor.permissions.includes(WORK_READ) || actor.permissions.includes(WORK_EXECUTE)
    ? actor
    : null;
}

export function hasScope(actor: Actor, scope: MediaScope): boolean {
  return actor.kind === 'SERVICE' && actor.scopes.includes(scope);
}

/** Stable key of the caller for idempotency scoping and rate budgets. */
export function actorKey(actor: Actor): string {
  if (actor.kind === 'USER') return `user:${actor.subject}`;
  if (actor.kind === 'SERVICE') return `service:${actor.clientId}`;
  return `system:${actor.component}`;
}
