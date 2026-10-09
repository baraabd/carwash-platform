/**
 * P02-A2 provider verification of vehicle.v1 WITHOUT infrastructure.
 *
 * Runs the BUILT vehicle service code against the BUILT published contract
 * (@carwash/contracts dist). The service cannot depend on the contracts
 * package yet (request A-P02-01, lockfile owned by Lane E), so this suite is
 * where the two are proven to agree:
 *   - every route the contract declares is served at exactly that method/path;
 *   - every body the contract parser refuses, the provider refuses too;
 *   - everything the provider emits (vehicle, page, snapshot, error) parses
 *     with the published parser.
 * The same parsers check real HTTP responses in vehicle.integration.test.mjs.
 *
 *   node --test tests/production/A/vehicle.contract.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const contracts = createRequire(path.join(ROOT, 'packages/contracts/package.json'))(
  './dist/index.js',
);
const own = createRequire(path.join(ROOT, 'services/vehicle/package.json'));
own('reflect-metadata');
const domain = own('./dist/domain/index.js');
const application = own('./dist/application/index.js');
const { VehicleController, VEHICLE_V1 } = own('./dist/transport/http/vehicle.controller.js');
const { classify, contractEnvelope } = own('./dist/transport/http/contract-errors.js');

const { vehicleV1 } = contracts;
const valid = {
  type: 'sedan',
  make: null,
  model: null,
  color: null,
  nickname: null,
  plate: null,
};

/** Inputs around every boundary of VehicleInputV1. */
const corpus = [
  valid,
  { ...valid, type: 'pickup', make: 'Kia', model: 'Rio', color: 'أبيض', nickname: 'x'.repeat(40) },
  { ...valid, nickname: 'x'.repeat(41) },
  { ...valid, make: '' },
  { ...valid, make: '   ' },
  { ...valid, make: 'a\u000bb' },
  { ...valid, make: 'a\u0000b' },
  { ...valid, make: 'a\tb' },
  { ...valid, make: 7 },
  { ...valid, type: 'truck' },
  { ...valid, type: undefined },
  { ...valid, extra: 1 },
  { type: 'sedan' },
  { ...valid, plate: { text: '١٢٣ حلب', region: null } },
  { ...valid, plate: { text: '  ab   12 ', region: 'Aleppo' } },
  { ...valid, plate: { text: 'حلب', region: null } },
  { ...valid, plate: { text: '7', region: null } },
  { ...valid, plate: { text: '1'.repeat(12), region: null } },
  { ...valid, plate: { text: '1'.repeat(13), region: null } },
  { ...valid, plate: { text: '12#3', region: null } },
  { ...valid, plate: { text: '۴۵۶', region: null } },
  { ...valid, plate: { text: '', region: null } },
  { ...valid, plate: { text: '   ', region: null } },
  { ...valid, plate: { text: 12, region: null } },
  { ...valid, plate: { text: '12' } },
  { ...valid, plate: { text: '12', region: null, x: 1 } },
  { ...valid, plate: { text: '12', region: 'r'.repeat(31) } },
  { ...valid, plate: '12' },
  [],
  null,
  'sedan',
];

function contractAccepts(parse, value) {
  try {
    parse(value);
    return true;
  } catch {
    return false;
  }
}

function asSaved(input, overrides = {}) {
  return {
    id: '5b0d1a3e-0c8b-4a35-9f39-1a2b3c4d5e01',
    owner: { kind: 'guest', subject: '0e8f6a43-1f7b-4d44-8d38-3b8f4c2a9001' },
    ...input,
    archived: false,
    revision: 1,
    createdAt: new Date('2026-10-08T08:00:00.000Z'),
    updatedAt: new Date('2026-10-08T08:00:00.000Z'),
    archivedAt: null,
    ...overrides,
  };
}

test('routes: the controller serves exactly the vehicle.v1 route table', () => {
  assert.equal(VEHICLE_V1, vehicleV1.VEHICLE_V1.prefix);
  // @nestjs/common RequestMethod: GET=0, POST=1, PUT=2, DELETE=3, PATCH=4.
  const methods = { 0: 'GET', 1: 'POST', 2: 'PUT', 3: 'DELETE', 4: 'PATCH' };
  const served = Object.getOwnPropertyNames(VehicleController.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => VehicleController.prototype[name])
    .filter((handler) => Reflect.getMetadata('path', handler) !== undefined)
    .map((handler) => {
      const route = Reflect.getMetadata('path', handler).replace(/^\/?/, '/');
      return `${methods[Reflect.getMetadata('method', handler)]} ${route}`;
    })
    .sort();
  const declared = Object.values(vehicleV1.VEHICLE_V1.routes)
    .map((route) => `${route.method} ${route.path}`)
    .sort();
  assert.deepEqual(served, declared);
});

test('input: the provider refuses everything the contract refuses, and emits parseable vehicles', () => {
  for (const value of corpus) {
    const label = JSON.stringify(value);
    const accepted = contractAccepts(vehicleV1.parseVehicleInputV1, value);
    let parsed;
    try {
      parsed = domain.parseVehicleInput(value);
    } catch (error) {
      assert.ok(error instanceof domain.VehicleValidationError, label);
      const envelope = contractEnvelope(classify(error), 'corr-1', 'req-1');
      assert.equal(envelope.status, 422, label);
      contracts.parseApiErrorEnvelope(envelope.body);
      continue;
    }
    assert.ok(accepted, `provider accepted what vehicle.v1 refuses: ${label}`);
    const view = application.vehicleView(asSaved(parsed));
    assert.deepEqual(vehicleV1.parseVehicleV1(view), view, label);
  }
});

test('page and snapshot views parse with the published parsers', () => {
  const saved = asSaved({ ...valid, plate: { text: '١٢٣', region: 'حلب' } }, { revision: 4 });
  const page = {
    items: [application.vehicleView(saved)],
    nextCursor: application.encodeCursor(saved),
    asOf: '2026-10-08T09:00:00.000Z',
  };
  const parsedPage = contracts.parsePage(page, '$', vehicleV1.parseVehicleV1);
  assert.equal(parsedPage.nextCursor, page.nextCursor);
  for (const purpose of ['booking-quote', 'booking-create', 'booking-display']) {
    const snapshot = application.snapshotView(
      domain.captureSnapshot(saved, purpose, new Date('2026-10-08T09:00:00.000Z')),
    );
    assert.deepEqual(vehicleV1.parseVehicleSnapshotV1(snapshot), snapshot);
  }
});

test('resolve request: the provider refuses everything the contract refuses', () => {
  const request = {
    owner: { kind: 'account', subjectId: '0e8f6a43-1f7b-4d44-8d38-3b8f4c2a9001' },
    vehicleId: '5b0d1a3e-0c8b-4a35-9f39-1a2b3c4d5e01',
    expectedRevision: null,
    purpose: 'booking-quote',
  };
  const cases = [
    request,
    { ...request, expectedRevision: 3 },
    { ...request, expectedRevision: 0 },
    { ...request, expectedRevision: 2_147_483_648 },
    { ...request, expectedRevision: '3' },
    { ...request, purpose: 'marketing' },
    { ...request, owner: { kind: 'service', subjectId: request.owner.subjectId } },
    { ...request, owner: { kind: 'guest' } },
    { ...request, vehicleId: 'not-a-uuid' },
    { ...request, extra: true },
    { owner: request.owner },
  ];
  for (const value of cases) {
    const accepted = contractAccepts(vehicleV1.parseResolveVehicleSnapshotRequestV1, value);
    let ok = true;
    try {
      domain.parseResolveRequest(value);
    } catch {
      ok = false;
    }
    assert.equal(ok, accepted, JSON.stringify(value));
  }
});

test('errors: every application refusal is a valid envelope with the contract status and reason', () => {
  const { ApplicationError } = application;
  const cases = [
    [new ApplicationError('REQUEST_INVALID', null, 'header.idempotency-key'), 400],
    [new ApplicationError('AUTH_REQUIRED'), 401],
    [new ApplicationError('AUTH_FORBIDDEN'), 403],
    [new ApplicationError('NOT_FOUND', 'VEHICLE_NOT_FOUND'), 404],
    [new ApplicationError('REVISION_CONFLICT'), 412],
    [new ApplicationError('REVISION_REQUIRED'), 428],
    [new ApplicationError('IDEMPOTENCY_KEY_REQUIRED'), 428],
    [new ApplicationError('IDEMPOTENCY_CONFLICT'), 409],
    [new ApplicationError('DEPENDENCY_UNAVAILABLE'), 503],
    [new domain.VehicleRuleError('VEHICLE_ARCHIVED'), 409],
    [new domain.VehicleRuleError('VEHICLE_LIMIT_REACHED'), 422],
    [new Error('boom'), 500],
  ];
  for (const [error, status] of cases) {
    const envelope = contractEnvelope(classify(error), 'corr-1', 'req-1');
    assert.equal(envelope.status, status, error.message);
    assert.equal(envelope.status, contracts.API_ERROR_STATUS[envelope.body.error.code]);
    const parsed = contracts.parseApiErrorEnvelope(envelope.body);
    if (parsed.error.reason !== null) {
      assert.ok(vehicleV1.VEHICLE_V1.reasons.includes(parsed.error.reason), parsed.error.reason);
    }
  }
});
