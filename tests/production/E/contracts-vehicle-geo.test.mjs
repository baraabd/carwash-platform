// Executes the BUILT @carwash/contracts vehicle.v1 / geo.v1 modules (dist).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ContractViolation } = require('../../../packages/contracts/dist/common/wire.js');
const vehicle = require('../../../packages/contracts/dist/vehicle/v1.js');
const geo = require('../../../packages/contracts/dist/geo/v1.js');

const throwsCode = (fn, code) =>
  assert.throws(fn, (error) => error instanceof ContractViolation && error.code === code);

const ID = '11111111-1111-4111-8111-111111111111';
const ZONE = '22222222-2222-4222-8222-222222222222';
const OWNER = { kind: 'guest', subjectId: '33333333-3333-4333-8333-333333333333' };
const T0 = '2026-10-07T08:00:00.000Z';
const T1 = '2026-10-07T08:15:00.000Z';
const POINT = { latitude: '33.513800', longitude: '36.276500' };

const savedVehicle = {
  vehicleId: ID,
  revision: 3,
  type: 'suv',
  make: 'Kia',
  model: 'Sportage',
  color: 'أبيض',
  nickname: null,
  plate: { text: 'DAM 123456', region: 'دمشق' },
  archived: false,
  createdAt: T0,
  updatedAt: T1,
};

test('vehicle: valid saved vehicle round-trips; plate is optional', () => {
  assert.deepEqual(vehicle.parseVehicleV1(savedVehicle), savedVehicle);
  const noPlate = { ...savedVehicle, plate: null };
  assert.deepEqual(vehicle.parseVehicleV1(noPlate), noPlate);
  assert.equal(vehicle.VEHICLE_V1.id, 'vehicle.v1');
  assert.equal(vehicle.MAX_SAVED_VEHICLES, 10);
});

test('vehicle: plate text is normalized and constrained', () => {
  const input = {
    type: 'sedan',
    make: null,
    model: null,
    color: null,
    nickname: null,
    plate: { text: '  dam   ١٢٣٤ ', region: null },
  };
  assert.deepEqual(vehicle.parseVehicleInputV1(input).plate, { text: 'DAM ١٢٣٤', region: null });
  throwsCode(
    () => vehicle.parseVehicleInputV1({ ...input, plate: { text: 'ABC_123', region: null } }),
    'INVALID_FORMAT',
  );
  throwsCode(
    () => vehicle.parseVehicleInputV1({ ...input, plate: { text: 'A'.repeat(13), region: null } }),
    'INVALID_LENGTH',
  );
  throwsCode(
    () => vehicle.parseVehicleInputV1({ ...input, plate: { text: '   ', region: null } }),
    'INVALID_LENGTH',
  );
  assert.deepEqual(vehicle.parseInlineVehicleV1(input), vehicle.parseVehicleInputV1(input));
});

test('vehicle: unknown fields and invalid type are refused', () => {
  throwsCode(() => vehicle.parseVehicleV1({ ...savedVehicle, vin: 'x' }), 'UNEXPECTED_FIELD');
  throwsCode(() => vehicle.parseVehicleV1({ ...savedVehicle, type: 'truck' }), 'INVALID_ENUM');
  throwsCode(
    () => vehicle.parseVehicleV1({ ...savedVehicle, plate: { text: 'A1', region: null, x: 1 } }),
    'UNEXPECTED_FIELD',
  );
});

test('vehicle: snapshot saved vs inline invariant and resolve request', () => {
  const saved = {
    snapshotSchemaVersion: 1,
    source: 'saved',
    vehicleId: ID,
    vehicleRevision: 3,
    type: 'suv',
    make: 'Kia',
    model: null,
    color: null,
    plate: null,
    capturedAt: T0,
  };
  assert.deepEqual(vehicle.parseVehicleSnapshotV1(saved), saved);
  const inline = { ...saved, source: 'inline', vehicleId: null, vehicleRevision: null };
  assert.deepEqual(vehicle.parseVehicleSnapshotV1(inline), inline);
  throwsCode(
    () => vehicle.parseVehicleSnapshotV1({ ...inline, vehicleId: ID }),
    'INLINE_SNAPSHOT_HAS_VEHICLE',
  );
  throwsCode(() => vehicle.parseVehicleSnapshotV1({ ...saved, vehicleId: null }), 'INVALID_UUID');
  throwsCode(
    () => vehicle.parseVehicleSnapshotV1({ ...saved, snapshotSchemaVersion: 2 }),
    'UNSUPPORTED_SNAPSHOT',
  );
  const request = {
    owner: OWNER,
    vehicleId: ID,
    expectedRevision: null,
    purpose: 'booking-create',
  };
  assert.deepEqual(vehicle.parseResolveVehicleSnapshotRequestV1(request), request);
  throwsCode(
    () => vehicle.parseResolveVehicleSnapshotRequestV1({ ...request, purpose: 'marketing' }),
    'INVALID_ENUM',
  );
});

const serviceable = {
  decisionId: ID,
  decision: 'SERVICEABLE',
  zoneId: ZONE,
  zoneRevision: 4,
  datasetRevision: 9,
  point: POINT,
  checkedAt: T0,
  expiresAt: T1,
  reason: null,
};

test('geo: valid decisions of every kind parse', () => {
  assert.deepEqual(geo.parseServiceabilityDecisionV1(serviceable), serviceable);
  const outside = { ...serviceable, decision: 'OUTSIDE_ZONE', zoneId: null, zoneRevision: null };
  assert.deepEqual(geo.parseServiceabilityDecisionV1(outside), outside);
  const unknown = { ...outside, decision: 'INDETERMINATE', reason: 'GEO_DATASET_UNAVAILABLE' };
  assert.deepEqual(geo.parseServiceabilityDecisionV1(unknown), unknown);
  const zone = { zoneId: ZONE, revision: 1, name: { ar: 'دمشق', en: null }, status: 'ACTIVE' };
  assert.deepEqual(geo.parseServiceZoneV1(zone), zone);
});

test('geo: each decision invariant is enforced', () => {
  const bad = (patch, code) =>
    throwsCode(() => geo.parseServiceabilityDecisionV1({ ...serviceable, ...patch }), code);
  bad({ zoneId: null, zoneRevision: null }, 'INCONSISTENT_DECISION');
  bad({ reason: 'LOCATION_UNRESOLVED' }, 'INCONSISTENT_DECISION');
  bad({ decision: 'OUTSIDE_ZONE' }, 'INCONSISTENT_DECISION');
  bad({ decision: 'INDETERMINATE', zoneId: null, zoneRevision: null }, 'INCONSISTENT_DECISION');
  bad({ decision: 'INDETERMINATE', reason: 'GEO_DATASET_UNAVAILABLE' }, 'INCONSISTENT_DECISION');
  bad({ zoneRevision: null }, 'INCONSISTENT_ZONE');
  bad({ expiresAt: T0 }, 'INVALID_EXPIRY');
  bad({ reason: 'TIMEOUT' }, 'INVALID_ENUM');
  bad({ polygon: [] }, 'UNEXPECTED_FIELD');
});

test('geo: coordinates must be finite fixed-6 strings in range', () => {
  const req = (point) => geo.parseServiceabilityRequestV1({ point });
  assert.deepEqual(req(POINT), { point: POINT });
  throwsCode(
    () => req({ latitude: '90.000001', longitude: '0.000000' }),
    'COORDINATE_OUT_OF_RANGE',
  );
  throwsCode(
    () => req({ latitude: '0.000000', longitude: '180.000001' }),
    'COORDINATE_OUT_OF_RANGE',
  );
  throwsCode(() => req({ latitude: '-0.000000', longitude: '0.000000' }), 'INVALID_COORDINATE');
  throwsCode(() => req({ latitude: 33.5138, longitude: '36.276500' }), 'INVALID_COORDINATE');
  throwsCode(() => req({ latitude: 'NaN', longitude: '36.276500' }), 'INVALID_COORDINATE');
  throwsCode(() => req({ latitude: '33.51', longitude: '36.276500' }), 'INVALID_COORDINATE');
});

test('geo: validate request and result valid/reason consistency', () => {
  const request = {
    decisionId: ID,
    expectedZoneRevision: 4,
    point: POINT,
    purpose: 'booking-create',
  };
  assert.deepEqual(geo.parseValidateDecisionRequestV1(request), request);
  const ok = { decisionId: ID, valid: true, reason: null, zoneId: ZONE, zoneRevision: 4 };
  assert.deepEqual(geo.parseValidateDecisionResultV1(ok), ok);
  const expired = {
    ...ok,
    valid: false,
    reason: 'DECISION_EXPIRED',
    zoneId: null,
    zoneRevision: null,
  };
  assert.deepEqual(geo.parseValidateDecisionResultV1(expired), expired);
  throwsCode(
    () => geo.parseValidateDecisionResultV1({ ...ok, reason: 'ZONE_CHANGED' }),
    'INCONSISTENT_VALIDATION',
  );
  throwsCode(
    () => geo.parseValidateDecisionResultV1({ ...expired, valid: true }),
    'INCONSISTENT_VALIDATION',
  );
  throwsCode(
    () => geo.parseValidateDecisionResultV1({ ...ok, zoneId: null, zoneRevision: null }),
    'INCONSISTENT_ZONE',
  );
});
