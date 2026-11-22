import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_PERMISSIONS, IDENTITY_ROLES } from '@carwash/contracts';
import { GUEST_PERMISSIONS, permissionsFor } from '../src/domain/auth-policy';

test('cash collection is a technician capability, never an implicit treasury grant', () => {
  const technician = permissionsFor(['technician']);
  assert.ok(technician.includes('billing.cash.collect'));
  for (const treasury of ['billing.read', 'billing.refund', 'billing.reconcile'])
    assert.ok(!technician.includes(treasury as (typeof technician)[number]));
  for (const role of IDENTITY_ROLES.filter((role) => !['technician', 'super-admin'].includes(role)))
    assert.ok(!permissionsFor([role]).includes('billing.cash.collect'), role);
  assert.ok(!GUEST_PERMISSIONS.includes('billing.cash.collect'));
});

test('subscription management is published and remains super-admin-only', () => {
  assert.ok(IDENTITY_PERMISSIONS.includes('subscription.manage'));
  assert.ok(permissionsFor(['super-admin']).includes('subscription.manage'));
  for (const role of IDENTITY_ROLES.filter((role) => role !== 'super-admin'))
    assert.ok(!permissionsFor([role]).includes('subscription.manage'), role);
  assert.ok(!GUEST_PERMISSIONS.includes('subscription.manage'));
  const combined = permissionsFor(['customer', 'technician', 'technician']);
  assert.equal(combined.length, new Set(combined).size);
});
