import { customerV1 } from '@carwash/contracts';
import {
  parseCoordinates,
  type Address,
  type AddressDetails,
  type CustomerProfile,
  type ProfileChanges,
} from '../domain';
import { ApplicationError } from './errors';

const {
  parseAddressSnapshotV1,
  parseAddressInputV1,
  parseAddressV1,
  parseCustomerProfileV1,
  parseProfileInputV1,
} = customerV1;
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

export function canonicalAddressInput(raw: unknown, previous?: Address): AddressDetails {
  const input = parseAddressInputV1(raw);
  return {
    label: input.label,
    line: input.location.description,
    accessNote: input.details,
    location:
      input.location.mode === 'manual'
        ? { kind: 'manual' }
        : {
            kind: 'coordinates',
            // Retain an existing provenance fact only if the actual point is unchanged.
            source:
              previous?.location.kind === 'coordinates' &&
              fixedCoordinate(previous.location.coordinates.latitude) ===
                input.location.point.latitude &&
              fixedCoordinate(previous.location.coordinates.longitude) ===
                input.location.point.longitude
                ? previous.location.source
                : null,
            coordinates: parseCoordinates({ crs: 'EPSG:4326', ...input.location.point }),
          },
  };
}

function addressLocation(address: Address): customerV1.AddressLocationV1 {
  if (
    address.location.kind === 'manual' &&
    (address.line === null || [...address.line].length < 3)
  ) {
    throw new ApplicationError('ADDRESS_MIGRATION_REQUIRED');
  }
  return address.location.kind === 'manual'
    ? { mode: 'manual', description: address.line! }
    : {
        mode: 'coordinates',
        point: {
          latitude: fixedCoordinate(address.location.coordinates.latitude),
          longitude: fixedCoordinate(address.location.coordinates.longitude),
        },
        description: address.line,
      };
}

export function canonicalAddressView(address: Address): customerV1.AddressV1 {
  return parseAddressV1({
    addressId: address.id,
    revision: address.revision,
    label: address.label,
    location: addressLocation(address),
    details: address.accessNote,
    archived: address.status === 'ARCHIVED',
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  });
}

export function addressSnapshotView(address: Address, capturedAt: Date): AddressSnapshotV1 {
  return parseAddressSnapshotV1({
    snapshotSchemaVersion: 1,
    addressId: address.id,
    addressRevision: address.revision,
    location: addressLocation(address),
    details: address.accessNote,
    capturedAt: capturedAt.toISOString(),
  });
}
