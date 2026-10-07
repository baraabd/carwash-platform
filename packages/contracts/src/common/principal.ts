import { closed, oneOf, uuid } from './wire';

/**
 * Who a business record belongs to. A guest is a first-class principal issued
 * by Identity (no account creation required); a matching phone or name never
 * turns a guest into an account or grants access to its records.
 */
export const PRINCIPAL_KINDS = ['account', 'guest'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export interface PrincipalRef {
  readonly kind: PrincipalKind;
  /** Identity subject UUID. Opaque; never a phone, email or name. */
  readonly subjectId: string;
}

export function parsePrincipalRef(value: unknown, path: string): PrincipalRef {
  const v = closed(value, path, ['kind', 'subjectId']);
  return {
    kind: oneOf(v.kind, `${path}.kind`, PRINCIPAL_KINDS),
    subjectId: uuid(v.subjectId, `${path}.subjectId`),
  };
}

/**
 * Service-to-service read/resolve calls state WHY they need owner data. The
 * owner authorizes (caller service scope, purpose, beneficiary) together and
 * records the purpose in its audit.
 */
export const RESOLVE_PURPOSES = ['booking-quote', 'booking-create', 'booking-display'] as const;
export type ResolvePurpose = (typeof RESOLVE_PURPOSES)[number];

export function parseResolvePurpose(value: unknown, path: string): ResolvePurpose {
  return oneOf(value, path, RESOLVE_PURPOSES);
}
