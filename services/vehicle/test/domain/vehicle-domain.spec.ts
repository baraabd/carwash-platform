import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVehicleChanges,
  parsePlate,
  parseVehicleDetails,
  VehicleDomainError,
  type Vehicle,
} from '../../src/domain';

function refused(code: string, work: () => unknown): void {
  assert.throws(
    work,
    (error: unknown) => error instanceof VehicleDomainError && error.code === code,
  );
}

const saved: Vehicle = {
  id: '5b0d1a3e-0c8b-4a35-9f39-1a2b3c4d5e01',
  owner: { kind: 'account', subject: '0e8f6a43-1f7b-4d44-8d38-3b8f4c2a9001' },
  type: 'sedan',
  displayName: null,
  plate: '123 حلب',
  color: null,
  status: 'ACTIVE',
  revision: 1,
  createdAt: new Date('2026-10-07T08:00:00.000Z'),
  updatedAt: new Date('2026-10-07T08:00:00.000Z'),
  archivedAt: null,
};

test('plate: optional; Arabic-Indic digits normalised, trimmed, inner spaces collapsed', () => {
  assert.equal(parsePlate(undefined), null);
  assert.equal(parsePlate(null), null);
  assert.equal(parsePlate(''), null);
  assert.equal(parsePlate('  ١٢٣   حلب '), '123 حلب');
  assert.equal(parsePlate('ab-۴۵۶'), 'ab-456');
  assert.equal(parsePlate('Ab 12'), 'Ab 12', 'letter case is kept as typed');
});

test('plate: whitespace-only, no digit, foreign characters and over-long values are refused', () => {
  refused('INVALID_PLATE', () => parsePlate('   '));
  refused('INVALID_PLATE', () => parsePlate('حلب'));
  refused('INVALID_PLATE', () => parsePlate('1'));
  refused('INVALID_PLATE', () => parsePlate('12#34'));
  refused('INVALID_PLATE', () => parsePlate('12_34'));
  refused('INVALID_PLATE', () => parsePlate('1'.repeat(21)));
  refused('INVALID_PLATE', () => parsePlate(1234));
});

test('details: approved type alphabet, optional name and colour, unknown keys refused', () => {
  assert.deepEqual(parseVehicleDetails({ type: 'pickup' }), {
    type: 'pickup',
    displayName: null,
    plate: null,
    color: null,
  });
  assert.deepEqual(
    parseVehicleDetails({
      type: 'suv',
      displayName: '  تويوتا   راف ',
      color: ' أبيض ',
      plate: ' 77-ب ',
    }),
    { type: 'suv', displayName: 'تويوتا راف', color: 'أبيض', plate: '77-ب' },
  );
  refused('INVALID_VEHICLE_TYPE', () => parseVehicleDetails({ type: 'truck' }));
  refused('INVALID_VEHICLE_TYPE', () => parseVehicleDetails({}));
  refused('INVALID_DISPLAY_NAME', () =>
    parseVehicleDetails({ type: 'sedan', displayName: 'x'.repeat(61) }),
  );
  refused('INVALID_COLOR', () => parseVehicleDetails({ type: 'sedan', color: 'x'.repeat(31) }));
  refused('INVALID_INPUT', () =>
    parseVehicleDetails({ type: 'sedan', ownerSubject: 'someone-else' }),
  );
});

test('changes: partial update keeps other fields; plate can be cleared; archived is read-only', () => {
  assert.deepEqual(applyVehicleChanges(saved, { color: 'أسود' }), {
    type: 'sedan',
    displayName: null,
    plate: '123 حلب',
    color: 'أسود',
  });
  assert.equal(applyVehicleChanges(saved, { plate: null }).plate, null);
  refused('INVALID_INPUT', () => applyVehicleChanges(saved, {}));
  refused('INVALID_INPUT', () => applyVehicleChanges(saved, { ownerKind: 'guest' }));
  refused('VEHICLE_ARCHIVED', () =>
    applyVehicleChanges({ ...saved, status: 'ARCHIVED' }, { color: 'x' }),
  );
});
