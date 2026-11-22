import { customerV1 } from '@carwash/contracts';
import type { Address, CustomerProfile, ProfileChanges } from '../domain';
import { ApplicationError } from './errors';

const { parseAddressSnapshotV1, parseCustomerProfileV1, parseProfileInputV1 } = customerV1;
type AddressSnapshotV1 = customerV1.AddressSnapshotV1;
type CustomerProfileV1 = customerV1.CustomerProfileV1;

/** The canonical contract never infers a country or claims phone ownership. */
export function canonicalProfileView(profile: CustomerProfile): CustomerProfileV1 {
  if (profile.phone !== null && !/^\+9639[0-9]{8}$/.test(profile.phone)) {
    throw new ApplicationError('PROFILE_CONTACT_MIGRATION_REQUIRED');
  }
  return parseCustomerProfileV1({
    customerId: profile.id,
    principal: { kind: profile.principal.kind, subjectId: profile.principal.subject },
    revision: profile.revision,
    // This owner has no profile-close operation; every existing profile is active.
    status: 'ACTIVE',
    contact: {
      displayName: profile.displayName,
      phone: profile.phone,
      phoneVerification: 'unverified',
    },
    preferences: { locale: profile.preferredLocale },
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  });
}

export function canonicalProfileChanges(raw: unknown): ProfileChanges {
  const input = parseProfileInputV1(raw);
  return {
    displayName: input.displayName,
    phone: input.phone,
    preferredLocale: input.locale,
  };
}

/** Domain coordinates already have at most six decimals; padding is exact. */
function fixedCoordinate(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(6, '0')}`;
}

export function addressSnapshotView(address: Address, capturedAt: Date): AddressSnapshotV1 {
  if (address.location.kind === 'manual' && [...address.line].length < 3) {
    throw new ApplicationError('ADDRESS_MIGRATION_REQUIRED');
  }
  return parseAddressSnapshotV1({
    snapshotSchemaVersion: 1,
    addressId: address.id,
    addressRevision: address.revision,
    location:
      address.location.kind === 'manual'
        ? { mode: 'manual', description: address.line }
        : {
            mode: 'coordinates',
            point: {
              latitude: fixedCoordinate(address.location.coordinates.latitude),
              longitude: fixedCoordinate(address.location.coordinates.longitude),
            },
            description: address.line,
          },
    details: address.accessNote,
    capturedAt: capturedAt.toISOString(),
  });
}
