import { AccessFault, type VerifiedSession } from '../ports/identity.ports';

/**
 * Permissions this service enforces. They are requested from Lane E as
 * CR-D-P01-01 and are not yet granted to any Identity role, so every protected
 * operation is denied until E publishes them. Deny by default is intended: no
 * unrelated existing permission is borrowed to make the routes reachable.
 */
export const CONFIGURATION_PERMISSIONS = Object.freeze({
  read: 'configuration.read',
  write: 'configuration.write',
} as const);
export type ConfigurationPermission =
  (typeof CONFIGURATION_PERMISSIONS)[keyof typeof CONFIGURATION_PERMISSIONS];

export function requirePermission(
  session: VerifiedSession,
  permission: ConfigurationPermission,
): void {
  if (!session.permissions.includes(permission)) throw new AccessFault('AUTH_FORBIDDEN');
}
