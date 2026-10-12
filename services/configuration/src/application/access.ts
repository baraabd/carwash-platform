import { AccessFault, type VerifiedSession } from '../ports/identity.ports';

/**
 * Permissions this service enforces. They are requested from Lane E
 * (CR-D-P01-01, refreshed as CR-D-P05-D5-04) and are not yet granted to any
 * Identity role, so every protected staff operation is denied until E
 * publishes them. Deny by default is intended: no unrelated existing
 * permission is borrowed to make the routes reachable.
 *
 * - read:    staff read of current policy, versions, history and diffs
 *            (and the superseded P01-D3 value reads)
 * - write:   create or withdraw a configuration.v1 draft
 *            (and the superseded P01-D3 propose/review/activate)
 * - approve: approve someone else's draft (four eyes)
 * - publish: publish an approved draft
 */
export const CONFIGURATION_PERMISSIONS = Object.freeze({
  read: 'configuration.read',
  write: 'configuration.write',
  approve: 'configuration.approve',
  publish: 'configuration.publish',
} as const);
export type ConfigurationPermission =
  (typeof CONFIGURATION_PERMISSIONS)[keyof typeof CONFIGURATION_PERMISSIONS];

export function requirePermission(
  session: VerifiedSession,
  permission: ConfigurationPermission,
): void {
  if (!session.permissions.includes(permission)) throw new AccessFault('AUTH_FORBIDDEN');
}
