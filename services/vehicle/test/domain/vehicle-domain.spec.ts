import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertBelowLimit,
  assertEditable,
  captureSnapshot,
  MAX_SAVED_VEHICLES,
  parsePlate,
  parseResolveRequest,
  parseVehicleInput,
  sameVehicleInput,
  vehicleInputOf,
  VehicleRuleError,
  VehicleValidationError,
  type Vehicle,
} from '../../src/domain';

function invalid(field: string, issue: string, work: () => unknown): void {
  assert.throws(
    work,
    (error: unknown) =>
      error instanceof VehicleValidationError && error.field === field && error.issue === issue,
    `${field} ${issue}`,
  );
}

function rule(reason: string, work: () => unknown): void {
  assert.throws(
    work,
    (error: unknown) => error instanceof VehicleRuleError && error.reason === reason,
  );
}

const input = {
  type: 'sedan',
  make: null,
  model: null,
  color: null,
  nickname: null,
  plate: null,
} as const;

const saved: Vehicle = {
  id: '5b0d1a3e-0c8b-4a35-9f39-1a2b3c4d5e01',
  owner: { kind: 'account', subject: '0e8f6a43-1f7b-4d44-8d38-3b8f4c2a9001' },
  type: 'sedan',
  make: 'Kia',
  model: 'Rio',
  color: null,
  nickname: null,
  plate: { text: '١٢٣ حلب', region: null },
  archived: false,
  revision: 3,
  createdAt: new Date('2026-10-07T08:00:00.000Z'),
  updatedAt: new Date('2026-10-07T08:00:00.000Z'),
  archivedAt: null,
};

test('plate: optional; normalised exactly as vehicle.v1 normalizePlateText', () => {
  assert.equal(parsePlate(null), null);
  assert.deepEqual(parsePlate({ text: '  ١٢٣   حلب ', region: null }), {
    text: '١٢٣ حلب',
    region: null,
  });
  assert.deepEqual(parsePlate({ text: 'ab-12', region: ' حلب ' }), {
    text: 'AB-12',
    region: 'حلب',
  });
  assert.deepEqual(parsePlate({ text: 'حلب', region: null }), { text: 'حلب', region: null });
  assert.deepEqual(parsePlate({ text: '7', region: null }), { text: '7', region: null });
});

test('plate: shape, alphabet and length are refused with contract issue codes', () => {
  invalid('$.plate', 'EXPECTED_OBJECT', () => parsePlate('123'));
  invalid('$.plate.region', 'MISSING_FIELD', () => parsePlate({ text: '123' }));
  invalid('$.plate.extra', 'UNEXPECTED_FIELD', () =>
    parsePlate({ text: '123', region: null, extra: 1 }),
  );
  invalid('$.plate.text', 'EXPECTED_STRING', () => parsePlate({ text: 123, region: null }));
  invalid('$.plate.text', 'INVALID_LENGTH', () => parsePlate({ text: '   ', region: null }));
  invalid('$.plate.text', 'INVALID_LENGTH', () =>
    parsePlate({ text: '1'.repeat(13), region: null }),
  );
  invalid('$.plate.text', 'INVALID_FORMAT', () => parsePlate({ text: '12#34', region: null }));
  invalid('$.plate.text', 'INVALID_FORMAT', () => parsePlate({ text: '12_34', region: null }));
  // Eastern Arabic-Indic (Persian) digits are outside the vehicle.v1 alphabet.
  invalid('$.plate.text', 'INVALID_FORMAT', () => parsePlate({ text: '۴۵۶', region: null }));
  invalid('$.plate.region', 'INVALID_LENGTH', () =>
    parsePlate({ text: '1', region: 'x'.repeat(31) }),
  );
});

test('input: closed VehicleInputV1; every key required; free text trimmed and bounded', () => {
  assert.deepEqual(parseVehicleInput(input), input);
  assert.deepEqual(
    parseVehicleInput({
      ...input,
      type: 'suv',
      make: '  تويوتا ',
      model: 'راف\t4',
      color: ' أبيض ',
      nickname: 'سيارة  العائلة',
      plate: { text: ' 77-ب ', region: null },
    }),
    {
      type: 'suv',
      make: 'تويوتا',
      model: 'راف 4',
      color: 'أبيض',
      nickname: 'سيارة العائلة',
      plate: { text: '77-ب', region: null },
    },
  );
  invalid('$', 'EXPECTED_OBJECT', () => parseVehicleInput([]));
  invalid('$.make', 'MISSING_FIELD', () => parseVehicleInput({ type: 'sedan' }));
  invalid('$.ownerSubject', 'UNEXPECTED_FIELD', () =>
    parseVehicleInput({ ...input, ownerSubject: 'someone-else' }),
  );
  invalid('$.type', 'INVALID_ENUM', () => parseVehicleInput({ ...input, type: 'truck' }));
  invalid('$.make', 'INVALID_LENGTH', () => parseVehicleInput({ ...input, make: 'x'.repeat(41) }));
  invalid('$.color', 'INVALID_LENGTH', () => parseVehicleInput({ ...input, color: '   ' }));
  invalid('$.nickname', 'EXPECTED_STRING', () => parseVehicleInput({ ...input, nickname: 7 }));
  invalid('$.model', 'INVALID_CHARACTERS', () =>
    parseVehicleInput({ ...input, model: 'a\u000bb' }),
  );
  invalid('$.make', 'MISSING_FIELD', () =>
    parseVehicleInput({ type: 'sedan', model: null, color: null, nickname: null, plate: null }),
  );
});

test('rules: active limit is vehicle.v1 MAX_SAVED_VEHICLES; archived is read-only', () => {
  assert.equal(MAX_SAVED_VEHICLES, 10);
  assertBelowLimit(9);
  rule('VEHICLE_LIMIT_REACHED', () => assertBelowLimit(10));
  assertEditable(saved);
  rule('VEHICLE_ARCHIVED', () => assertEditable({ ...saved, archived: true }));
});

test('equality compares every input field including the plate region', () => {
  const current = vehicleInputOf(saved);
  assert.ok(sameVehicleInput(current, { ...current }));
  assert.ok(!sameVehicleInput(current, { ...current, plate: { text: '١٢٣ حلب', region: 'حلب' } }));
  assert.ok(!sameVehicleInput(current, { ...current, plate: null }));
  assert.ok(!sameVehicleInput(current, { ...current, nickname: 'x' }));
});

test('snapshot: immutable copy of the saved vehicle; archived only for display', () => {
  const at = new Date('2026-10-08T09:00:00.000Z');
  const snapshot = captureSnapshot(saved, 'booking-quote', at);
  assert.deepEqual(snapshot, {
    snapshotSchemaVersion: 1,
    source: 'saved',
    vehicleId: saved.id,
    vehicleRevision: 3,
    type: 'sedan',
    make: 'Kia',
    model: 'Rio',
    color: null,
    plate: { text: '١٢٣ حلب', region: null },
    capturedAt: at,
  });
  const archived = { ...saved, archived: true };
  rule('VEHICLE_ARCHIVED', () => captureSnapshot(archived, 'booking-create', at));
  rule('VEHICLE_ARCHIVED', () => captureSnapshot(archived, 'booking-quote', at));
  assert.equal(captureSnapshot(archived, 'booking-display', at).vehicleId, saved.id);
});

test('resolve request: closed, owner principal, revision and purpose are validated', () => {
  const request = {
    owner: { kind: 'guest', subjectId: '0E8F6A43-1F7B-4D44-8D38-3B8F4C2A9001' },
    vehicleId: saved.id,
    expectedRevision: null,
    purpose: 'booking-create',
  };
  assert.deepEqual(parseResolveRequest(request), {
    owner: { kind: 'guest', subject: '0e8f6a43-1f7b-4d44-8d38-3b8f4c2a9001' },
    vehicleId: saved.id,
    expectedRevision: null,
    purpose: 'booking-create',
  });
  assert.equal(parseResolveRequest({ ...request, expectedRevision: 4 }).expectedRevision, 4);
  invalid('$.owner.kind', 'INVALID_ENUM', () =>
    parseResolveRequest({ ...request, owner: { ...request.owner, kind: 'staff' } }),
  );
  invalid('$.owner.subjectId', 'INVALID_UUID', () =>
    parseResolveRequest({ ...request, owner: { ...request.owner, subjectId: 'x' } }),
  );
  invalid('$.expectedRevision', 'INVALID_INTEGER', () =>
    parseResolveRequest({ ...request, expectedRevision: 0 }),
  );
  invalid('$.purpose', 'INVALID_ENUM', () => parseResolveRequest({ ...request, purpose: 'ads' }));
  invalid('$.extra', 'UNEXPECTED_FIELD', () => parseResolveRequest({ ...request, extra: true }));
});
