import { WorkforceError } from '../domain';
import type { Actor, WorkforceScope } from '../ports';

export function requireUser(actor: Actor): Extract<Actor, { kind: 'USER' }> {
  if (actor.kind !== 'USER') throw new WorkforceError('FORBIDDEN', 'User caller required.');
  return actor;
}

export function requirePermission(actor: Actor, permission: string): Extract<Actor, { kind: 'USER' }> {
  const user = requireUser(actor);
  if (!user.permissions.includes(permission)) {
    throw new WorkforceError('FORBIDDEN', 'Permission denied.');
  }
  return user;
}

export function requireScope(actor: Actor, scope: WorkforceScope): Extract<Actor, { kind: 'SERVICE' }> {
  if (actor.kind !== 'SERVICE' || !actor.scopes.includes(scope)) {
    throw new WorkforceError('FORBIDDEN', 'Service scope denied.');
  }
  return actor;
}

export function requireSelf(actor: Actor, subject: string): Extract<Actor, { kind: 'USER' }> {
  const user = requireUser(actor);
  if (user.subject !== subject) throw new WorkforceError('FORBIDDEN', 'Operator ownership required.');
  return user;
}
