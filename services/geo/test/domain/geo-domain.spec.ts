import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decide,
  evaluateServiceability,
  fixedDecimal,
  GeoDomainError,
  makePoint,
  parseRing,
  parseWirePoint,
  reasonFor,
  validateDecision,
  wirePoint,
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
    nameEn: null,
    datasetRef: 'test-fixture:synthetic',
    ring: parseRing(polygon),
    status: 'ACTIVE',
    revision,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    retiredAt: null,
  };
}

test('wire point: exactly six fractional digits; numbers, NaN, Infinity, -0 and extras refused', () => {
  const point = parseWirePoint({ latitude: '36.202100', longitude: '-0.500000' });
  assert.deepEqual(wirePoint(point), { latitude: '36.202100', longitude: '-0.500000' });
  assert.equal(point.lat, 36_202_100n);
  for (const latitude of [
    'NaN',
    'Infinity',
    '-Infinity',
    '1e1',
    '0.5',
    '0.1234567',
    '-0.000000',
    ' 0.500000',
    '00.500000',
  ]) {
    refused('INVALID_COORDINATE', () => parseWirePoint({ latitude, longitude: '0.000000' }));
  }
  refused('COORDINATE_OUT_OF_RANGE', () =>
    parseWirePoint({ latitude: '90.000001', longitude: '0.000000' }),
  );
  refused('COORDINATE_OUT_OF_RANGE', () =>
    parseWirePoint({ latitude: '0.000000', longitude: '-180.000001' }),
  );
  refused('INVALID_COORDINATE', () => parseWirePoint({ latitude: 0.5, longitude: '0.000000' }));
  refused('INVALID_COORDINATE', () =>
    parseWirePoint({ latitude: Number.NaN, longitude: '0.000000' }),
  );
  refused('MISSING_FIELD', () => parseWirePoint({ latitude: '0.000000' }));
  refused('UNEXPECTED_FIELD', () =>
    parseWirePoint({ latitude: '0.000000', longitude: '0.000000', crs: 'EPSG:4326' }),
  );
  refused('EXPECTED_OBJECT', () => parseWirePoint(['0.000000', '0.000000']));
  assert.equal(fixedDecimal(0n), '0.000000');
  assert.equal(fixedDecimal(-1n), '-0.000001');
  assert.equal(fixedDecimal(180_000_000n), '180.000000');
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

const at6 = (latitude: string, longitude: string) => parseWirePoint({ latitude, longitude });
const T0 = new Date('2026-10-08T10:00:00.000Z');
const ZONE_ID = '00000000-0000-4000-8000-00000000000a';
const served = {
  result: 'SERVICEABLE' as const,
  zone: { zoneId: ZONE_ID, code: 'a', revision: 3 },
};

test('decision: wire shape follows geo.v1 consistency rules for every outcome', () => {
  const base = {
    id: '00000000-0000-4000-8000-0000000000d1',
    datasetRevision: 7,
    point: at6('0.500000', '0.500000'),
    checkedAt: T0,
    ttlMs: 30 * 60_000,
  };
  const ok = decide({ ...base, serviceability: served });
  assert.deepEqual(
    { outcome: ok.outcome, zone: ok.zone, reason: ok.reason },
    { outcome: 'SERVICEABLE', zone: { zoneId: ZONE_ID, revision: 3 }, reason: null },
  );
  assert.equal(ok.expiresAt.toISOString(), '2026-10-08T10:30:00.000Z');
  const outside = decide({ ...base, serviceability: { result: 'OUTSIDE_ZONE' } });
  assert.deepEqual([outside.zone, outside.reason], [null, null]);
  const none = decide({
    ...base,
    serviceability: { result: 'INDETERMINATE', reason: 'NO_APPROVED_ZONES' },
  });
  assert.deepEqual(
    [none.zone, none.reason, none.detail],
    [null, 'GEO_DATASET_UNAVAILABLE', 'NO_APPROVED_ZONES'],
  );
  assert.equal(reasonFor('ON_ZONE_BOUNDARY'), 'LOCATION_UNRESOLVED');
  assert.equal(reasonFor('OVERLAPPING_ZONES'), 'LOCATION_UNRESOLVED');
  assert.throws(() => decide({ ...base, serviceability: served, ttlMs: 59_999 }), /TTL/);
  assert.throws(() => decide({ ...base, serviceability: served, datasetRevision: 0 }), /DATASET/);
});

test('validation: not found, point mismatch, expiry (half-open), revision and current zone', () => {
  const point = at6('0.500000', '0.500000');
  const decision = decide({
    id: '00000000-0000-4000-8000-0000000000d2',
    serviceability: served,
    datasetRevision: 1,
    point,
    checkedAt: T0,
    ttlMs: 60_000,
  });
  const request = { decisionId: decision.id, expectedZoneRevision: 3, point };
  const before = new Date(T0.getTime() + 59_999);
  assert.deepEqual(validateDecision(decision, request, before, served), {
    valid: true,
    reason: null,
    zone: { zoneId: ZONE_ID, revision: 3 },
  });
  assert.equal(validateDecision(null, request, before, served).reason, 'DECISION_NOT_FOUND');
  const outside = decide({
    id: '00000000-0000-4000-8000-0000000000d3',
    serviceability: { result: 'OUTSIDE_ZONE' },
    datasetRevision: 1,
    point,
    checkedAt: T0,
    ttlMs: 60_000,
  });
  assert.equal(
    validateDecision(outside, request, before, served).reason,
    'DECISION_NOT_FOUND',
    'a non-serviceable decision never validates',
  );
  assert.equal(
    validateDecision(decision, { ...request, point: at6('0.500000', '0.500001') }, before, served)
      .reason,
    'POINT_MISMATCH',
  );
  assert.equal(
    validateDecision(decision, request, new Date(T0.getTime() + 60_000), served).reason,
    'DECISION_EXPIRED',
  );
  assert.equal(
    validateDecision(decision, { ...request, expectedZoneRevision: 2 }, before, served).reason,
    'ZONE_CHANGED',
  );
  const revised = { ...served, zone: { ...served.zone, revision: 4 } };
  assert.deepEqual(validateDecision(decision, request, before, revised), {
    valid: false,
    reason: 'ZONE_CHANGED',
    zone: { zoneId: ZONE_ID, revision: 4 },
  });
  assert.equal(
    validateDecision(decision, request, before, {
      result: 'INDETERMINATE',
      reason: 'OVERLAPPING_ZONES',
    }).reason,
    'ZONE_CHANGED',
  );
});

test('rate limit: per key, per window, bounded memory', () => {
  let now = 0;
  const limit = new FixedWindowRateLimit(2, 60_000, 2, () => now);
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), false);
  assert.equal(limit.take('b'), true);
  assert.equal(limit.take('c'), false, 'a new key beyond the key cap is refused, not stored');
  assert.equal(limit.retryAfterMs(), 60_000);
  now = 59_999;
  assert.equal(limit.retryAfterMs(), 1);
  now = 60_000;
  assert.equal(limit.take('a'), true);
  assert.throws(() => new FixedWindowRateLimit(0, 60_000), /INVALID_RATE_LIMIT/);
});
