import {
  IDENTITY_PERMISSIONS,
  isIdentityRole,
  type AuthErrorCode,
  type IdentityPermission,
  type IdentityRole,
} from '@carwash/contracts';

export const AUTH_POLICY = Object.freeze({
  challengeTtlMs: 300_000,
  resendMs: 30_000,
  challengeAttempts: 5,
  sessionTtlMs: 604_800_000,
  accessTtlSeconds: 300,
  issueAccountLimit: 8,
  issueIpLimit: 30,
  issueWindowMs: 900_000,
  verifyIpLimit: 60,
  verifyWindowMs: 60_000,
  /**
   * Guest lifetime is absolute from creation; sessions never outlive it.
   * 30 days is an engineering default pending the owner's retention decision.
   */
  guestTtlMs: 2_592_000_000,
  guestCreateIpLimit: 10,
  guestRecoverIpLimit: 10,
  guestWindowMs: 900_000,
});
/** Self-service only; a guest has no roles and can never gain staff permissions. */
export const GUEST_PERMISSIONS: readonly IdentityPermission[] = Object.freeze([
  'profile.read:self',
  'profile.write:self',
  'bookings.read:self',
  'bookings.create:self',
]);
/** Recovery codes are 43-char base64url opaque secrets (256-bit), shown once. */
export function recoveryCodeInput(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw))
    throw new AuthFault('AUTH_INVALID_REQUEST');
  return raw;
}
const ROLE_PERMISSIONS: Readonly<Record<IdentityRole, readonly IdentityPermission[]>> = {
  customer: [
    'profile.read:self',
    'profile.write:self',
    'bookings.read:self',
    'bookings.create:self',
  ],
  technician: [
    'profile.read:self',
    'profile.write:self',
    'work.read:assigned',
    'work.execute:assigned',
  ],
  operations: ['operations.dispatch'],
  // billing.reconcile stays separate from billing.read (CR-B-03). catalog.publish
  // and pricing.publish are held only by super-admin until the owner approves a
  // narrower staff mapping (decision E-P03-D1).
  finance: ['billing.read', 'billing.refund', 'billing.reconcile'],
  support: ['support.cases.read', 'support.cases.write'],
  reviewer: ['verification.review'],
  'super-admin': IDENTITY_PERMISSIONS,
};
export class AuthFault extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthFault';
  }
}
export function permissionsFor(roles: readonly IdentityRole[]): IdentityPermission[] {
  return [...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]))];
}
export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') throw new AuthFault('AUTH_INVALID_REQUEST');
  const email = raw.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email)
  )
    throw new AuthFault('AUTH_INVALID_REQUEST');
  return email;
}
export function passwordInput(raw: unknown): string {
  // Passwords are not trimmed or normalized: every supplied character is significant.
  if (typeof raw !== 'string' || raw.length < 12 || raw.length > 128 || raw.includes('\0'))
    throw new AuthFault('AUTH_INVALID_REQUEST');
  return raw;
}
export function uuidInput(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
  )
    throw new AuthFault('AUTH_INVALID_REQUEST');
  return raw;
}
export function rolesInput(raw: unknown): IdentityRole[] {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length > 7 ||
    !raw.every(isIdentityRole) ||
    new Set(raw).size !== raw.length
  )
    throw new AuthFault('AUTH_INVALID_REQUEST');
  return [...raw];
}
export function objectInput(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new AuthFault('AUTH_INVALID_REQUEST');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value)))
    throw new AuthFault('AUTH_INVALID_REQUEST');
  return value;
}
