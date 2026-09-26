/** Public Identity V1 wire vocabulary. No credentials, signing keys or persistence. */
export const IDENTITY_V1 = '/internal/v1/identity' as const;
export const IDENTITY_ROLES = [
  'customer',
  'technician',
  'operations',
  'finance',
  'support',
  'reviewer',
  'super-admin',
] as const;
export type IdentityRole = (typeof IDENTITY_ROLES)[number];
export const IDENTITY_PERMISSIONS = [
  'profile.read:self',
  'profile.write:self',
  'bookings.read:self',
  'bookings.create:self',
  'work.read:assigned',
  'work.execute:assigned',
  'operations.dispatch',
  'billing.read',
  'billing.refund',
  'support.cases.read',
  'support.cases.write',
  'verification.review',
  'identity.accounts.suspend',
  'identity.roles.assign',
] as const;
export type IdentityPermission = (typeof IDENTITY_PERMISSIONS)[number];
export type AccountStatus = 'ACTIVE' | 'SUSPENDED';
export interface AccessPrincipal {
  readonly subject: string;
  readonly sessionId: string;
  readonly authVersion: number;
}
export interface IdentitySessionView extends AccessPrincipal {
  readonly roles: readonly IdentityRole[];
  readonly permissions: readonly IdentityPermission[];
}
export interface ChallengeReceipt {
  readonly challengeId: string;
  readonly expiresIn: number;
  readonly resendAfter: number;
}
export type AuthErrorCode =
  | 'AUTH_INVALID'
  | 'AUTH_CHALLENGE_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_CSRF'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_UNAVAILABLE'
  | 'AUTH_INVALID_REQUEST';
export interface AuthErrorEnvelope {
  readonly error: {
    readonly code: AuthErrorCode;
    readonly message: string;
    readonly requestId: string;
  };
}
export function isIdentityRole(value: unknown): value is IdentityRole {
  return typeof value === 'string' && IDENTITY_ROLES.some((role) => role === value);
}
export function isIdentityPermission(value: unknown): value is IdentityPermission {
  return (
    typeof value === 'string' && IDENTITY_PERMISSIONS.some((permission) => permission === value)
  );
}
export function isAccessPrincipal(value: unknown): value is AccessPrincipal {
  if (typeof value !== 'object' || value === null) return false;
  const x = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return (
    typeof x.subject === 'string' &&
    uuid.test(x.subject) &&
    typeof x.sessionId === 'string' &&
    uuid.test(x.sessionId) &&
    typeof x.authVersion === 'number' &&
    Number.isSafeInteger(x.authVersion) &&
    x.authVersion >= 1
  );
}
