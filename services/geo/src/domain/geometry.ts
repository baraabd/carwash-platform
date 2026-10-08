/**
 * Exact planar geometry on WGS 84 (EPSG:4326) micro-degrees.
 *
 * Every coordinate is an exact decimal string with at most six fractional
 * digits, converted to an integer number of micro-degrees (bigint). All
 * predicates below are therefore exact: there is no floating point rounding
 * that could put a point on the wrong side of a zone edge.
 *
 * Zones are small, simple rings that do not cross the antimeridian (enforced).
 * Treating longitude/latitude as a plane is exact for "which side of this
 * stored edge" questions; it is not a geodesic distance computation.
 */
export class GeoDomainError extends Error {
  constructor(
    readonly code: GeoErrorCode,
    readonly field?: string,
  ) {
    super(code);
    this.name = 'GeoDomainError';
  }
}

export type GeoErrorCode =
  | 'INVALID_INPUT'
  // geo.v1 wire refusals, named as the published parsers name them.
  | 'EXPECTED_OBJECT'
  | 'MISSING_FIELD'
  | 'UNEXPECTED_FIELD'
  | 'INVALID_UUID'
  | 'INVALID_ENUM'
  | 'INVALID_REVISION'
  | 'INVALID_COORDINATE'
  | 'COORDINATE_OUT_OF_RANGE'
  // Zone dataset (operator) refusals.
  | 'INVALID_COORDINATES'
  | 'INVALID_POLYGON'
  | 'INVALID_ZONE_CODE'
  | 'INVALID_ZONE_NAME'
  | 'INVALID_DATASET_REF'
  | 'ZONE_CODE_CONFLICT'
  | 'ZONE_RETIRED';

const SCALE = 1_000_000n;
const DECIMAL = /^-?(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,6})?$/;

export interface Point {
  /** Canonical decimal strings, as stored and returned. */
  readonly latitude: string;
  readonly longitude: string;
  /** Exact micro-degrees. */
  readonly lat: bigint;
  readonly lng: bigint;
}

export function canonicalDecimal(value: string): string {
  let [whole = '0', fraction = ''] = value.split('.');
  fraction = fraction.replace(/0+$/, '');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const zero = /^0*$/.test(digits) && fraction.length === 0;
  whole = (negative && !zero ? '-' : '') + digits;
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function micro(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
  return negative ? -units : units;
}

export function microToDecimal(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const text = `${abs / SCALE}.${(abs % SCALE).toString().padStart(6, '0')}`;
  return canonicalDecimal(negative ? `-${text}` : text);
}

function axis(raw: unknown, limitDegrees: bigint, field: string): { text: string; units: bigint } {
  if (typeof raw !== 'string' || !DECIMAL.test(raw)) {
    throw new GeoDomainError('INVALID_COORDINATES', field);
  }
  const units = micro(raw);
  if (units < -limitDegrees * SCALE || units > limitDegrees * SCALE) {
    throw new GeoDomainError('INVALID_COORDINATES', field);
  }
  return { text: canonicalDecimal(raw), units };
}

export function makePoint(latitude: unknown, longitude: unknown, field = 'coordinates'): Point {
  const lat = axis(latitude, 90n, `${field}.latitude`);
  const lng = axis(longitude, 180n, `${field}.longitude`);
  return { latitude: lat.text, longitude: lng.text, lat: lat.units, lng: lng.units };
}

/** geo.v1 wire decimal: exactly six fractional digits (~0.11 m), e.g. "36.202100". */
const WIRE_DECIMAL = /^-?(0|[1-9][0-9]{0,2})\.[0-9]{6}$/;

function wireAxis(raw: unknown, limitDegrees: bigint, field: string): bigint {
  if (typeof raw !== 'string' || !WIRE_DECIMAL.test(raw) || raw === '-0.000000') {
    throw new GeoDomainError('INVALID_COORDINATE', field);
  }
  const units = BigInt(raw.replace('.', ''));
  if (units < -limitDegrees * SCALE || units > limitDegrees * SCALE) {
    throw new GeoDomainError('COORDINATE_OUT_OF_RANGE', field);
  }
  return units;
}

/** Micro-degrees in the fixed six-digit wire form; zero is always "0.000000". */
export function fixedDecimal(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  return `${negative ? '-' : ''}${abs / SCALE}.${(abs % SCALE).toString().padStart(6, '0')}`;
}

/**
 * The geo.v1 point `{latitude, longitude}`: a closed object of decimal strings
 * with exactly six fractional digits. Numbers, NaN/Infinity spellings,
 * exponents, "-0.000000", extra precision and out-of-range values are refused,
 * never rounded or clamped: rounding would silently move a customer's pin.
 */
export function parseWirePoint(raw: unknown, field = '$.point'): Point {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GeoDomainError('EXPECTED_OBJECT', field);
  }
  const value = raw as Record<string, unknown>;
  for (const key of ['latitude', 'longitude']) {
    if (!Object.hasOwn(value, key)) throw new GeoDomainError('MISSING_FIELD', `${field}.${key}`);
  }
  const extra = Object.keys(value).find((key) => key !== 'latitude' && key !== 'longitude');
  if (extra !== undefined) throw new GeoDomainError('UNEXPECTED_FIELD', `${field}.${extra}`);
  const lat = wireAxis(value.latitude, 90n, `${field}.latitude`);
  const lng = wireAxis(value.longitude, 180n, `${field}.longitude`);
  return { latitude: fixedDecimal(lat), longitude: fixedDecimal(lng), lat, lng };
}

/** The point exactly as geo.v1 carries it. */
export function wirePoint(point: Point): { latitude: string; longitude: string } {
  return { latitude: fixedDecimal(point.lat), longitude: fixedDecimal(point.lng) };
}

export function samePoint(a: Point, b: Point): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

export const MAX_RING_VERTICES = 1000;

export interface Ring {
  /** Closed ring: first vertex repeated as the last one. */
  readonly vertices: readonly Point[];
  readonly bounds: {
    readonly minLat: bigint;
    readonly maxLat: bigint;
    readonly minLng: bigint;
    readonly maxLng: bigint;
  };
}

/** Sign of the cross product (b - a) x (c - a): >0 left, <0 right, 0 collinear. */
function orientation(a: Point, b: Point, c: Point): number {
  const value = (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  return value > 0n ? 1 : value < 0n ? -1 : 0;
}

function within(a: bigint, b: bigint, c: bigint): boolean {
  return (a <= c && c <= b) || (b <= c && c <= a);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return orientation(a, b, p) === 0 && within(a.lng, b.lng, p.lng) && within(a.lat, b.lat, p.lat);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  );
}

/**
 * GeoJSON-style ring: an array of `[longitude, latitude]` decimal-string pairs,
 * closed, at least three distinct vertices, simple (no self-intersection), with
 * non-zero area and narrower than 180 degrees of longitude (no antimeridian).
 */
export function parseRing(raw: unknown): Ring {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > MAX_RING_VERTICES + 1) {
    throw new GeoDomainError('INVALID_POLYGON', 'polygon');
  }
  const vertices = raw.map((pair, index) => {
    if (!Array.isArray(pair) || pair.length !== 2)
      throw new GeoDomainError('INVALID_POLYGON', `polygon[${index}]`);
    return makePoint(pair[1], pair[0], `polygon[${index}]`);
  });
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  if (!first || !last || first.lat !== last.lat || first.lng !== last.lng) {
    throw new GeoDomainError('INVALID_POLYGON', 'polygon.closed');
  }
  const open = vertices.slice(0, -1);
  if (new Set(open.map((p) => `${p.lng}:${p.lat}`)).size !== open.length) {
    throw new GeoDomainError('INVALID_POLYGON', 'polygon.duplicateVertex');
  }
  let twiceArea = 0n;
  for (let i = 0; i < open.length; i += 1) {
    const a = open[i] as Point;
    const b = open[(i + 1) % open.length] as Point;
    twiceArea += a.lng * b.lat - b.lng * a.lat;
  }
  if (twiceArea === 0n) throw new GeoDomainError('INVALID_POLYGON', 'polygon.area');
  const n = open.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // Adjacent edges share exactly one vertex; that is not an intersection.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = open[i] as Point;
      const b = open[(i + 1) % n] as Point;
      const c = open[j] as Point;
      const d = open[(j + 1) % n] as Point;
      if (segmentsIntersect(a, b, c, d))
        throw new GeoDomainError('INVALID_POLYGON', 'polygon.selfIntersection');
    }
  }
  const lats = open.map((p) => p.lat);
  const lngs = open.map((p) => p.lng);
  const min = (values: bigint[]) => values.reduce((x, y) => (y < x ? y : x));
  const max = (values: bigint[]) => values.reduce((x, y) => (y > x ? y : x));
  const bounds = { minLat: min(lats), maxLat: max(lats), minLng: min(lngs), maxLng: max(lngs) };
  if (bounds.maxLng - bounds.minLng >= 180n * SCALE) {
    throw new GeoDomainError('INVALID_POLYGON', 'polygon.antimeridian');
  }
  return { vertices, bounds };
}

export type PointPlacement = 'INSIDE' | 'OUTSIDE' | 'BOUNDARY';

/** Exact even-odd ray casting; a point on any edge or vertex is BOUNDARY. */
export function placePoint(ring: Ring, point: Point): PointPlacement {
  const { bounds } = ring;
  if (
    point.lat < bounds.minLat ||
    point.lat > bounds.maxLat ||
    point.lng < bounds.minLng ||
    point.lng > bounds.maxLng
  ) {
    return 'OUTSIDE';
  }
  let inside = false;
  const v = ring.vertices;
  for (let i = 0; i < v.length - 1; i += 1) {
    const a = v[i] as Point;
    const b = v[i + 1] as Point;
    if (onSegment(a, b, point)) return 'BOUNDARY';
    // Half-open rule on latitude so a vertex is counted exactly once.
    if (a.lat > point.lat !== b.lat > point.lat) {
      // lng of the edge at point.lat, compared without division:
      // point.lng < a.lng + (point.lat - a.lat) * (b.lng - a.lng) / (b.lat - a.lat)
      const lhs = (point.lng - a.lng) * (b.lat - a.lat);
      const rhs = (point.lat - a.lat) * (b.lng - a.lng);
      if (b.lat - a.lat > 0n ? lhs < rhs : lhs > rhs) inside = !inside;
    }
  }
  return inside ? 'INSIDE' : 'OUTSIDE';
}

/** Stored form: `[[lng, lat], ...]` canonical decimal strings. */
export function ringToJson(ring: Ring): [string, string][] {
  return ring.vertices.map((p) => [p.longitude, p.latitude]);
}

/**
 * Rebuilds a ring that was validated by `parseRing` before it was stored.
 * Coordinates, closure and bounds are re-checked; the O(n^2) simplicity check
 * is not repeated on every read.
 */
export function ringFromStored(raw: unknown): Ring {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > MAX_RING_VERTICES + 1) {
    throw new Error('CORRUPT_ZONE_RING');
  }
  const vertices = raw.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('CORRUPT_ZONE_RING');
    return makePoint(pair[1], pair[0]);
  });
  const first = vertices[0] as Point;
  const last = vertices[vertices.length - 1] as Point;
  if (first.lat !== last.lat || first.lng !== last.lng) throw new Error('CORRUPT_ZONE_RING');
  const open = vertices.slice(0, -1);
  let minLat = first.lat;
  let maxLat = first.lat;
  let minLng = first.lng;
  let maxLng = first.lng;
  for (const p of open) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { vertices, bounds: { minLat, maxLat, minLng, maxLng } };
}
