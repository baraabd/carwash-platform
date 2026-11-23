import { CustomerDomainError } from './errors';

/**
 * WGS 84 coordinates (EPSG:4326) as exact decimal strings.
 *
 * Coordinates arrive and leave as strings so no binary floating point value is
 * ever authoritative. At most six fractional digits are accepted (~0.11 m); a
 * longer value is refused rather than silently rounded, because rounding would
 * move a customer's pin without telling them. NaN, Infinity, exponent notation
 * and out-of-range values are refused here and again by database CHECKs.
 */
export const COORDINATE_SCALE = 6;
export const CRS = 'EPSG:4326' as const;

export interface Coordinates {
  readonly crs: typeof CRS;
  readonly latitude: string;
  readonly longitude: string;
}

const DECIMAL = /^-?(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,6})?$/;

/** Canonical form: no trailing zeros beyond the integer part, no "-0". */
export function canonicalDecimal(value: string): string {
  let [whole = '0', fraction = ''] = value.split('.');
  fraction = fraction.replace(/0+$/, '');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const zero = /^0*$/.test(digits) && fraction.length === 0;
  whole = (negative && !zero ? '-' : '') + digits;
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function scaled(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const units =
    BigInt(whole) * 10n ** BigInt(COORDINATE_SCALE) +
    BigInt(fraction.padEnd(COORDINATE_SCALE, '0'));
  return negative ? -units : units;
}

function parseAxis(raw: unknown, limit: bigint, field: string): string {
  if (typeof raw !== 'string' || !DECIMAL.test(raw)) {
    throw new CustomerDomainError('INVALID_COORDINATES', field);
  }
  const units = scaled(raw);
  const bound = limit * 10n ** BigInt(COORDINATE_SCALE);
  if (units < -bound || units > bound) {
    throw new CustomerDomainError('INVALID_COORDINATES', field);
  }
  return canonicalDecimal(raw);
}

export function parseCoordinates(raw: unknown): Coordinates {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CustomerDomainError('INVALID_COORDINATES', 'coordinates');
  }
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'crs,latitude,longitude' || value.crs !== CRS) {
    throw new CustomerDomainError('INVALID_COORDINATES', 'coordinates');
  }
  return {
    crs: CRS,
    latitude: parseAxis(value.latitude, 90n, 'coordinates.latitude'),
    longitude: parseAxis(value.longitude, 180n, 'coordinates.longitude'),
  };
}
