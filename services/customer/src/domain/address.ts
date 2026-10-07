import { parseCoordinates, type Coordinates } from './coordinates';
import { CustomerDomainError } from './errors';
import { codePointLength, hasControlCharacters, singleLine } from './text';

/**
 * A saved customer address. Customer is the only authority for addresses; Geo
 * may evaluate a coordinate but never stores or edits an address.
 *
 * A manual address has no coordinates and is therefore UNRESOLVED for
 * serviceability. It is never treated as serviceable by default. The approved
 * map artwork's x/y positions are drawing offsets, not coordinates, and are
 * refused by the strict location shape.
 */
export const ADDRESS_LABEL_MAX = 30;
export const ADDRESS_LINE_MAX = 160;
export const ACCESS_NOTE_MAX = 160;

export const LOCATION_SOURCES = ['pin', 'device', 'geocoder'] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

export type AddressLocation =
  | { readonly kind: 'manual' }
  | {
      readonly kind: 'coordinates';
      readonly source: LocationSource;
      readonly coordinates: Coordinates;
    };

export type AddressStatus = 'ACTIVE' | 'ARCHIVED';

export interface AddressDetails {
  readonly label: string;
  readonly line: string;
  readonly accessNote: string | null;
  readonly location: AddressLocation;
}

export interface Address extends AddressDetails {
  readonly id: string;
  readonly customerId: string;
  readonly status: AddressStatus;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function boundedText(
  raw: unknown,
  max: number,
  code: 'INVALID_ADDRESS_LABEL' | 'INVALID_ADDRESS_LINE',
  field: string,
): string {
  if (typeof raw !== 'string' || raw.length > max * 4) throw new CustomerDomainError(code, field);
  const value = singleLine(raw);
  const length = codePointLength(value);
  if (length < 1 || length > max || hasControlCharacters(value)) {
    throw new CustomerDomainError(code, field);
  }
  return value;
}

export function parseAccessNote(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length > ACCESS_NOTE_MAX * 4) {
    throw new CustomerDomainError('INVALID_ACCESS_NOTE', 'accessNote');
  }
  const value = singleLine(raw);
  if (value.length === 0) return null;
  if (codePointLength(value) > ACCESS_NOTE_MAX || hasControlCharacters(value)) {
    throw new CustomerDomainError('INVALID_ACCESS_NOTE', 'accessNote');
  }
  return value;
}

export function parseLocation(raw: unknown): AddressLocation {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CustomerDomainError('INVALID_LOCATION', 'location');
  }
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(',');
  if (value.kind === 'manual' && keys === 'kind') return { kind: 'manual' };
  if (value.kind === 'coordinates' && keys === 'coordinates,kind,source') {
    const source = LOCATION_SOURCES.find((candidate) => candidate === value.source);
    if (!source) throw new CustomerDomainError('INVALID_LOCATION', 'location.source');
    return { kind: 'coordinates', source, coordinates: parseCoordinates(value.coordinates) };
  }
  throw new CustomerDomainError('INVALID_LOCATION', 'location');
}

export function parseAddressDetails(raw: Readonly<Record<string, unknown>>): AddressDetails {
  return {
    label: boundedText(raw.label, ADDRESS_LABEL_MAX, 'INVALID_ADDRESS_LABEL', 'label'),
    line: boundedText(raw.line, ADDRESS_LINE_MAX, 'INVALID_ADDRESS_LINE', 'line'),
    accessNote: parseAccessNote(raw.accessNote),
    location: parseLocation(raw.location),
  };
}

/** Partial update: absent keys keep the current value; present keys are fully validated. */
export function applyAddressChanges(
  current: Address,
  changes: Readonly<Record<string, unknown>>,
): AddressDetails {
  if (current.status === 'ARCHIVED') throw new CustomerDomainError('ADDRESS_ARCHIVED');
  return parseAddressDetails({
    label: Object.hasOwn(changes, 'label') ? changes.label : current.label,
    line: Object.hasOwn(changes, 'line') ? changes.line : current.line,
    accessNote: Object.hasOwn(changes, 'accessNote') ? changes.accessNote : current.accessNote,
    location: Object.hasOwn(changes, 'location') ? changes.location : current.location,
  });
}

export function sameAddressDetails(a: AddressDetails, b: AddressDetails): boolean {
  return JSON.stringify(canonicalDetails(a)) === JSON.stringify(canonicalDetails(b));
}

function canonicalDetails(details: AddressDetails): unknown {
  const location =
    details.location.kind === 'manual'
      ? { kind: 'manual' }
      : {
          kind: 'coordinates',
          source: details.location.source,
          latitude: details.location.coordinates.latitude,
          longitude: details.location.coordinates.longitude,
        };
  return [details.label, details.line, details.accessNote, location];
}
