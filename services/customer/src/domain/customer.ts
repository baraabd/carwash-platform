import { parseDisplayName, parseLocale, parsePhone, type Locale } from './contact';
import { CustomerDomainError } from './errors';

/**
 * The authenticated party a customer profile belongs to.
 *
 * `subject` is the Identity subject. The customer id is a different, Customer-
 * owned identifier. A profile maps one-to-one to a principal. `guest` exists in
 * the model because Identity is expected to issue guest sessions; until it does,
 * no transport path produces a guest principal, and nothing ever links a guest
 * and an account by matching a phone, name or plate.
 */
export type PrincipalKind = 'account' | 'guest';

export interface Principal {
  readonly kind: PrincipalKind;
  readonly subject: string;
}

export interface CustomerProfile {
  readonly id: string;
  readonly principal: Principal;
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly preferredLocale: Locale;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProfileChanges {
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly preferredLocale: Locale;
}

const MUTABLE = ['displayName', 'phone', 'preferredLocale'] as const;

/** Absent keys keep the current value; null clears an optional contact field. */
export function applyProfileChanges(
  current: CustomerProfile,
  raw: Readonly<Record<string, unknown>>,
): ProfileChanges {
  const unknownKey = Object.keys(raw).find((key) => !(MUTABLE as readonly string[]).includes(key));
  if (unknownKey !== undefined || Object.keys(raw).length === 0) {
    throw new CustomerDomainError('INVALID_INPUT', unknownKey);
  }
  return {
    displayName: Object.hasOwn(raw, 'displayName')
      ? raw.displayName === null
        ? null
        : parseDisplayName(raw.displayName)
      : current.displayName,
    phone: Object.hasOwn(raw, 'phone')
      ? raw.phone === null
        ? null
        : parsePhone(raw.phone)
      : current.phone,
    preferredLocale: Object.hasOwn(raw, 'preferredLocale')
      ? parseLocale(raw.preferredLocale)
      : current.preferredLocale,
  };
}

export function profileUnchanged(current: CustomerProfile, next: ProfileChanges): boolean {
  return (
    current.displayName === next.displayName &&
    current.phone === next.phone &&
    current.preferredLocale === next.preferredLocale
  );
}

/** Whether the change touches personal contact data; such changes are audited. */
export function contactChanged(current: CustomerProfile, next: ProfileChanges): boolean {
  return current.displayName !== next.displayName || current.phone !== next.phone;
}
