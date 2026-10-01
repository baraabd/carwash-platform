import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCustomerManifest,
  validateCustomerBehaviorManifest,
} from '../../scripts/c001/customer-behavior-manifest.mjs';

test('C001 customer behavior manifest matches the immutable prototype authority', () => {
  const result = validateCustomerBehaviorManifest(loadCustomerManifest());
  assert.equal(result.ok, true);
  assert.equal(result.screens, 7);
  assert.equal(result.bookingSteps, 7);
  assert.equal(result.forms, 6);
  assert.ok(result.actions >= 80);
});

test('C001 rejects an omitted customer action', () => {
  const changed = globalThis.structuredClone(loadCustomerManifest());
  changed.actions = changed.actions.slice(1);
  assert.throws(() => validateCustomerBehaviorManifest(changed), /C001_ACTION_INVENTORY/);
});

test('C001 rejects booking-flow reordering or relabeling', () => {
  const changed = globalThis.structuredClone(loadCustomerManifest());
  [changed.bookingFlow[0], changed.bookingFlow[1]] = [
    changed.bookingFlow[1],
    changed.bookingFlow[0],
  ];
  assert.throws(
    () => validateCustomerBehaviorManifest(changed),
    /C001_FLOW_INDEXES|C001_FLOW_LABELS/,
  );

  const relabeled = globalThis.structuredClone(loadCustomerManifest());
  relabeled.bookingFlow[5].label = 'دفع';
  assert.throws(() => validateCustomerBehaviorManifest(relabeled), /C001_FLOW_LABELS/);
});

test('C001 rejects backend-readiness claims that the HTML prototype does not prove', () => {
  for (const key of [
    'serverCalls',
    'createsRealBookings',
    'processesRealPayments',
    'liveTechnicianTracking',
    'cloudAccount',
    'authoritativePricing',
    'authoritativeAvailability',
  ]) {
    const changed = globalThis.structuredClone(loadCustomerManifest());
    changed.prototypeTruth[key] = true;
    assert.throws(() => validateCustomerBehaviorManifest(changed), /OVERCLAIM/);
  }
});

test('C001 rejects reference authority drift', () => {
  const changed = globalThis.structuredClone(loadCustomerManifest());
  changed.reference.sha256 = '0'.repeat(64);
  assert.throws(() => validateCustomerBehaviorManifest(changed), /C001_REFERENCE_SHA256/);
});

test('C001 inventories class-only payment configuration forms', () => {
  const changed = globalThis.structuredClone(loadCustomerManifest());
  changed.forms = changed.forms.filter((form) => form.id !== 'pay-config-form:sham');
  assert.throws(() => validateCustomerBehaviorManifest(changed), /C001_FORM_INVENTORY/);
});

test('C001 rejects capability removal and owner reassignment', () => {
  const removed = globalThis.structuredClone(loadCustomerManifest());
  delete removed.capabilityOwnership.paymentVerificationAndRefund;
  assert.throws(() => validateCustomerBehaviorManifest(removed), /C001_CAPABILITY_SET/);

  const swapped = globalThis.structuredClone(loadCustomerManifest());
  [
    swapped.capabilityOwnership.vehicles,
    swapped.capabilityOwnership.paymentVerificationAndRefund,
  ] = [
    swapped.capabilityOwnership.paymentVerificationAndRefund,
    swapped.capabilityOwnership.vehicles,
  ];
  assert.throws(
    () => validateCustomerBehaviorManifest(swapped),
    /C001_OWNER_MISMATCH:vehicles:vehicle/,
  );
});
