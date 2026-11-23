import { ContractViolation, closed } from './wire';

/**
 * WGS84 / EPSG:4326 point as fixed 6-decimal strings (~0.11 m). Strings, not
 * numbers, so NaN/Infinity/1e999 and float re-rounding cannot reach storage.
 */
export interface Coordinates {
  readonly latitude: string;
  readonly longitude: string;
}

const DECIMAL = /^-?(0|[1-9][0-9]{0,2})\.[0-9]{6}$/;

function axis(value: unknown, path: string, limit: number): string {
  if (typeof value !== 'string' || !DECIMAL.test(value) || value === '-0.000000') {
    throw new ContractViolation('INVALID_COORDINATE', path);
  }
  // Integer micro-degrees: exact range check without binary float.
  const micro = BigInt(value.replace('.', ''));
  const bound = BigInt(limit) * 1_000_000n;
  if (micro < -bound || micro > bound) throw new ContractViolation('COORDINATE_OUT_OF_RANGE', path);
  return value;
}

export function parseCoordinates(value: unknown, path: string): Coordinates {
  const v = closed(value, path, ['latitude', 'longitude']);
  return {
    latitude: axis(v.latitude, `${path}.latitude`, 90),
    longitude: axis(v.longitude, `${path}.longitude`, 180),
  };
}

/** Convert a device reading. Non-finite or out-of-range input is refused, never clamped. */
export function coordinatesFromDegrees(latitude: number, longitude: number): Coordinates {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ContractViolation('INVALID_COORDINATE', '$');
  }
  const fmt = (n: number): string => {
    const s = n.toFixed(6);
    return s === '-0.000000' ? '0.000000' : s;
  };
  return parseCoordinates({ latitude: fmt(latitude), longitude: fmt(longitude) }, '$');
}
