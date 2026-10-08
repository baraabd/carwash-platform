import type { OwnerContract } from '../common/route';
import { parseCoordinates, type Coordinates } from '../common/coordinates';
import {
  parsePrincipalRef,
  parseResolvePurpose,
  type PrincipalRef,
  type ResolvePurpose,
} from '../common/principal';
import { parseSyrianMobile } from '../common/phone';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import {
  ContractViolation,
  boolean,
  closed,
  oneOf,
  optionalText,
  text,
  uuid,
} from '../common/wire';

/**
 * customer.v1 — owner: Customer service (Lane A).
 * Profile, contact preferences and saved addresses of a principal (account or guest).
 * Contact data is personal data: it never appears in events, URLs or logs.
 */
export const CUSTOMER_V1 = {
  id: 'customer.v1',
  owner: 'customer',
  prefix: '/internal/v1/customer',
  routes: {
    getProfile: { method: 'GET', path: '/me', access: 'principal' },
    bootstrapProfile: { method: 'PUT', path: '/me', access: 'principal', idempotent: true },
    updateProfile: {
      method: 'PATCH',
      path: '/me',
      access: 'principal',
      idempotent: true,
      revisioned: true,
    },
    listAddresses: { method: 'GET', path: '/me/addresses', access: 'principal', paged: true },
    createAddress: { method: 'POST', path: '/me/addresses', access: 'principal', idempotent: true },
    updateAddress: {
      method: 'PATCH',
      path: '/me/addresses/:addressId',
      access: 'principal',
      idempotent: true,
      revisioned: true,
    },
    archiveAddress: {
      method: 'POST',
      path: '/me/addresses/:addressId/archive',
      access: 'principal',
      idempotent: true,
      revisioned: true,
    },
    resolveAddressSnapshot: {
      method: 'POST',
      path: '/address-snapshots/resolve',
      access: 'service:customer.address-snapshot.resolve',
      safe: true,
    },
  },
  reasons: ['ADDRESS_ARCHIVED', 'ADDRESS_LIMIT_REACHED', 'PROFILE_NOT_FOUND'],
} as const satisfies OwnerContract;

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const MAX_SAVED_ADDRESSES = 20;

export interface CustomerContactV1 {
  readonly displayName: string | null;
  readonly phone: string | null;
  /** Ownership of the phone is not established by the customer typing it. */
  readonly phoneVerification: 'unverified' | 'verified';
}

export interface CustomerProfileV1 {
  readonly customerId: string;
  readonly principal: PrincipalRef;
  readonly revision: number;
  readonly status: 'ACTIVE' | 'CLOSED';
  readonly contact: CustomerContactV1;
  readonly preferences: { readonly locale: Locale };
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface ProfileInputV1 {
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly locale: Locale;
}

export type AddressLocationV1 =
  | { readonly mode: 'manual'; readonly description: string }
  | {
      readonly mode: 'coordinates';
      readonly point: Coordinates;
      readonly description: string | null;
    };

export interface AddressInputV1 {
  readonly label: string;
  readonly location: AddressLocationV1;
  /** Building/floor/landmark hints for the technician. */
  readonly details: string | null;
}

export interface AddressV1 extends AddressInputV1 {
  readonly addressId: string;
  readonly revision: number;
  readonly archived: boolean;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

/** Immutable copy captured into a booking. Later address edits never change it. */
export interface AddressSnapshotV1 {
  readonly snapshotSchemaVersion: 1;
  readonly addressId: string;
  readonly addressRevision: number;
  readonly location: AddressLocationV1;
  readonly details: string | null;
  readonly capturedAt: UtcTimestamp;
}

export interface ResolveAddressSnapshotRequestV1 {
  readonly owner: PrincipalRef;
  readonly addressId: string;
  readonly expectedRevision: number | null;
  readonly purpose: ResolvePurpose;
}

function displayName(value: unknown, path: string): string | null {
  return optionalText(value, path, { max: 80 });
}

function phone(value: unknown, path: string): string | null {
  if (value === null) return null;
  return parseSyrianMobile(value, path);
}

export function parseProfileInputV1(value: unknown): ProfileInputV1 {
  const v = closed(value, '$', ['displayName', 'phone', 'locale']);
  return {
    displayName: displayName(v.displayName, '$.displayName'),
    phone: phone(v.phone, '$.phone'),
    locale: oneOf(v.locale, '$.locale', LOCALES),
  };
}

export function parseCustomerProfileV1(value: unknown, path = '$'): CustomerProfileV1 {
  const v = closed(value, path, [
    'customerId',
    'principal',
    'revision',
    'status',
    'contact',
    'preferences',
    'createdAt',
    'updatedAt',
  ]);
  const c = closed(v.contact, `${path}.contact`, ['displayName', 'phone', 'phoneVerification']);
  const p = closed(v.preferences, `${path}.preferences`, ['locale']);
  return {
    customerId: uuid(v.customerId, `${path}.customerId`),
    principal: parsePrincipalRef(v.principal, `${path}.principal`),
    revision: parseRevision(v.revision, `${path}.revision`),
    status: oneOf(v.status, `${path}.status`, ['ACTIVE', 'CLOSED'] as const),
    contact: {
      displayName: displayName(c.displayName, `${path}.contact.displayName`),
      phone: phone(c.phone, `${path}.contact.phone`),
      phoneVerification: oneOf(c.phoneVerification, `${path}.contact.phoneVerification`, [
        'unverified',
        'verified',
      ] as const),
    },
    preferences: { locale: oneOf(p.locale, `${path}.preferences.locale`, LOCALES) },
    createdAt: parseUtc(v.createdAt, `${path}.createdAt`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

export function parseAddressLocationV1(value: unknown, path: string): AddressLocationV1 {
  const mode = closed(value, path, ['mode'], ['description', 'point']).mode;
  if (mode === 'manual') {
    const v = closed(value, path, ['mode', 'description']);
    return { mode, description: text(v.description, `${path}.description`, { min: 3, max: 300 }) };
  }
  if (mode === 'coordinates') {
    const v = closed(value, path, ['mode', 'point', 'description']);
    return {
      mode,
      point: parseCoordinates(v.point, `${path}.point`),
      description: optionalText(v.description, `${path}.description`, { max: 300 }),
    };
  }
  throw new ContractViolation('INVALID_ENUM', `${path}.mode`);
}

export function parseAddressInputV1(value: unknown, path = '$'): AddressInputV1 {
  const v = closed(value, path, ['label', 'location', 'details']);
  return {
    label: text(v.label, `${path}.label`, { max: 40 }),
    location: parseAddressLocationV1(v.location, `${path}.location`),
    details: optionalText(v.details, `${path}.details`, { max: 300 }),
  };
}

export function parseAddressV1(value: unknown, path = '$'): AddressV1 {
  const v = closed(value, path, [
    'addressId',
    'revision',
    'label',
    'location',
    'details',
    'archived',
    'createdAt',
    'updatedAt',
  ]);
  const input = parseAddressInputV1(
    { label: v.label, location: v.location, details: v.details },
    path,
  );
  return {
    addressId: uuid(v.addressId, `${path}.addressId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    ...input,
    archived: boolean(v.archived, `${path}.archived`),
    createdAt: parseUtc(v.createdAt, `${path}.createdAt`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

export function parseResolveAddressSnapshotRequestV1(
  value: unknown,
): ResolveAddressSnapshotRequestV1 {
  const v = closed(value, '$', ['owner', 'addressId', 'expectedRevision', 'purpose']);
  return {
    owner: parsePrincipalRef(v.owner, '$.owner'),
    addressId: uuid(v.addressId, '$.addressId'),
    expectedRevision:
      v.expectedRevision === null ? null : parseRevision(v.expectedRevision, '$.expectedRevision'),
    purpose: parseResolvePurpose(v.purpose, '$.purpose'),
  };
}

export function parseAddressSnapshotV1(value: unknown, path = '$'): AddressSnapshotV1 {
  const v = closed(value, path, [
    'snapshotSchemaVersion',
    'addressId',
    'addressRevision',
    'location',
    'details',
    'capturedAt',
  ]);
  if (v.snapshotSchemaVersion !== 1) {
    throw new ContractViolation('UNSUPPORTED_SNAPSHOT', `${path}.snapshotSchemaVersion`);
  }
  return {
    snapshotSchemaVersion: 1,
    addressId: uuid(v.addressId, `${path}.addressId`),
    addressRevision: parseRevision(v.addressRevision, `${path}.addressRevision`),
    location: parseAddressLocationV1(v.location, `${path}.location`),
    details: optionalText(v.details, `${path}.details`, { max: 300 }),
    capturedAt: parseUtc(v.capturedAt, `${path}.capturedAt`),
  };
}
