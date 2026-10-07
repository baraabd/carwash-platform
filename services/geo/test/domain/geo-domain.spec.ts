import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateServiceability,
  GeoDomainError,
  makePoint,
  parseCoordinates,
  parseRing,
  parseZoneDefinition,
  placePoint,
  ringFromStored,
  ringToJson,
  type Zone,
} from '../../src/domain';
import { FixedWindowRateLimit } from '../../src/transport/http/rate-limit';

/*
 * Synthetic geometry around (0, 0) only. These are test shapes, not service
 * areas; no real city boundary is represented anywhere in this suite.
 */
const square = [
  ['0', '0'],
  ['1', '0'],
  ['1', '1'],
  ['0', '1'],
  ['0', '0'],
];
// A concave "U": the notch (0.4..0.6, 0.5..1) is outside.
const concave = [
  ['0', '0'],
  ['1', '0'],
  ['1', '1'],
  ['0.6', '1'],
  ['0.6', '0.5'],
  ['0.4', '0.5'],
  ['0.4', '1'],
  ['0', '1'],
  ['0', '0'],
];

function refused(code: string, work: () => unknown): void {
  assert.throws(work, (error: unknown) => error instanceof GeoDomainError && error.code === code);
}

const at = (lng: string, lat: string) => makePoint(lat, lng);

function zone(code: string, polygon: string[][], revision = 1): Zone {
  return {
    id: `00000000-0000-4000-8000-${code.padStart(12, '0').slice(-12)}`,
    code,
    name: code,
    datasetRef: 'test-fixture:synthetic',
    ring: parseRing(polygon),
    status: 'ACTIVE',
    revision,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    retiredAt: null,
  };
}

test('coordinates: exact decimal strings only; NaN, Infinity, exponents and numbers refused', () => {
  assert.equal(
    parseCoordinates({ crs: 'EPSG:4326', latitude: '0.500000', longitude: '-0' }).latitude,
    '0.5',
  );
  for (const latitude of ['NaN', 'Infinity', '1e1', '90.000001', '0.1234567']) {
    refused('INVALID_COORDINATES', () =>
      parseCoordinates({ crs: 'EPSG:4326', latitude, longitude: '0' }),
    );
  }
  refused('INVALID_COORDINATES', () =>
    parseCoordinates({ crs: 'EPSG:4326', latitude: 0.5, longitude: '0' }),
  );
  refused('INVALID_COORDINATES', () => parseCoordinates({ latitude: '0', longitude: '0' }));
});

test('placement: exact inside / outside / boundary, including vertices and a concave notch', () => {
  const ring = parseRing(square);
  assert.equal(placePoint(ring, at('0.5', '0.5')), 'INSIDE');
  assert.equal(placePoint(ring, at('0.000001', '0.000001')), 'INSIDE');
  assert.equal(placePoint(ring, at('-0.000001', '0.5')), 'OUTSIDE');
  assert.equal(placePoint(ring, at('0', '0.5')), 'BOUNDARY');
  assert.equal(placePoint(ring, at('1', '1')), 'BOUNDARY');
  assert.equal(placePoint(ring, at('2', '0.5')), 'OUTSIDE');
  const u = parseRing(concave);
  assert.equal(placePoint(u, at('0.5', '0.75')), 'OUTSIDE');
  assert.equal(placePoint(u, at('0.5', '0.25')), 'INSIDE');
  assert.equal(placePoint(u, at('0.2', '0.75')), 'INSIDE');
  assert.equal(placePoint(u, at('0.5', '0.5')), 'BOUNDARY');
  // A ray through a vertex is counted once.
  assert.equal(placePoint(u, at('0.3', '0.5')), 'INSIDE');
});

test('rings: unclosed, too short, duplicate vertices, zero area, bow-tie and antimeridian refused', () => {
  refused('INVALID_POLYGON', () => parseRing(square.slice(0, -1)));
  refused('INVALID_POLYGON', () =>
    parseRing([
      ['0', '0'],
      ['1', '0'],
      ['0', '0'],
    ]),
  );
  refused('INVALID_POLYGON', () =>
    parseRing([
      ['0', '0'],
      ['1', '0'],
      ['1', '0'],
      ['0', '1'],
      ['0', '0'],
    ]),
  );
  refused('INVALID_POLYGON', () =>
    parseRing([
      ['0', '0'],
      ['1', '0'],
      ['2', '0'],
      ['0', '0'],
    ]),
  );
  refused('INVALID_POLYGON', () =>
    parseRing([
      ['0', '0'],
      ['1', '1'],
      ['1', '0'],
      ['0', '1'],
      ['0', '0'],
    ]),
  );
  refused('INVALID_POLYGON', () =>
    parseRing([
      ['-100', '0'],
      ['100', '0'],
      ['100', '1'],
      ['-100', '1'],
      ['-100', '0'],
    ]),
  );
  refused('INVALID_COORDINATES', () =>
    parseRing([
      ['0', '0'],
      ['1', 'NaN'],
      ['1', '1'],
      ['0', '0'],
    ]),
  );
  refused('INVALID_POLYGON', () => parseRing('not-a-ring'));
});

test('rings: each refusal names its reason (symmetric bow-tie has zero area)', () => {
  const reason = (polygon: string[][]) => {
    try {
      parseRing(polygon);
      return 'accepted';
    } catch (error) {
      return error instanceof GeoDomainError ? (error.field ?? error.code) : 'unexpected';
    }
  };
  assert.equal(
    reason([
      ['0', '0'],
      ['1', '1'],
      ['1', '0'],
      ['0', '1'],
      ['0', '0'],
    ]),
    'polygon.area',
  );
  assert.equal(
    reason([
      ['20', '20'],
      ['23', '21'],
      ['23', '20'],
      ['20', '22'],
      ['20', '20'],
    ]),
    'polygon.selfIntersection',
  );
  assert.equal(reason(square.slice(0, -1)), 'polygon.closed');
  assert.equal(
    reason([
      ['0', '0'],
      ['1', '0'],
      ['1', '0'],
      ['0', '1'],
      ['0', '0'],
    ]),
    'polygon.duplicateVertex',
  );
  assert.equal(reason(square), 'accepted');
});

test('rings: stored form round-trips without the quadratic check', () => {
  const ring = parseRing(concave);
  const restored = ringFromStored(ringToJson(ring));
  assert.deepEqual(restored.bounds, ring.bounds);
  assert.equal(placePoint(restored, at('0.5', '0.75')), 'OUTSIDE');
});

test('zone definition: provenance, code and name are required; unknown keys refused', () => {
  const valid = {
    code: 'test-a',
    name: 'منطقة اختبار',
    datasetRef: 'test-fixture:synthetic',
    polygon: square,
  };
  assert.equal(parseZoneDefinition(valid).code, 'test-a');
  refused('INVALID_DATASET_REF', () => parseZoneDefinition({ ...valid, datasetRef: undefined }));
  refused('INVALID_DATASET_REF', () => parseZoneDefinition({ ...valid, datasetRef: 'x' }));
  refused('INVALID_ZONE_CODE', () => parseZoneDefinition({ ...valid, code: 'Bad Code' }));
  refused('INVALID_ZONE_NAME', () => parseZoneDefinition({ ...valid, name: ' ' }));
  refused('INVALID_INPUT', () => parseZoneDefinition({ ...valid, serviceable: true }));
});

test('serviceability: no zones and every unclear case fail closed as INDETERMINATE', () => {
  const point = at('0.5', '0.5');
  assert.deepEqual(evaluateServiceability(false, [], point), {
    result: 'INDETERMINATE',
    reason: 'NO_APPROVED_ZONES',
  });
  const a = zone('a', square, 3);
  assert.deepEqual(evaluateServiceability(true, [a], point), {
    result: 'SERVICEABLE',
    zone: { zoneId: a.id, code: 'a', revision: 3 },
  });
  assert.deepEqual(evaluateServiceability(true, [a], at('5', '5')), { result: 'OUTSIDE_ZONE' });
  assert.deepEqual(evaluateServiceability(true, [a], at('1', '0.5')), {
    result: 'INDETERMINATE',
    reason: 'ON_ZONE_BOUNDARY',
  });
  const overlapping = zone('b', [
    ['0.25', '0.25'],
    ['2', '0.25'],
    ['2', '2'],
    ['0.25', '2'],
    ['0.25', '0.25'],
  ]);
  assert.deepEqual(evaluateServiceability(true, [a, overlapping], point), {
    result: 'INDETERMINATE',
    reason: 'OVERLAPPING_ZONES',
  });
});

test('rate limit: per key, per window, bounded memory', () => {
  let now = 0;
  const limit = new FixedWindowRateLimit(2, 60_000, 2, () => now);
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), false);
  assert.equal(limit.take('b'), true);
  assert.equal(limit.take('c'), false, 'a new key beyond the key cap is refused, not stored');
  now = 60_000;
  assert.equal(limit.take('a'), true);
  assert.throws(() => new FixedWindowRateLimit(0, 60_000), /INVALID_RATE_LIMIT/);
});
