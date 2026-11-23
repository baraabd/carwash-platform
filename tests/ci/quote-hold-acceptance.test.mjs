import test from 'node:test';
import assert from 'node:assert/strict';
import { laneServicesForEnv, LANE_SERVICES } from '../../scripts/production/C/stack.mjs';
import { businessSuite } from '../../scripts/production/acceptance-plan.mjs';

test('cross-owner acceptance adds only explicitly selected allowlisted databases', () => {
  assert.deepEqual(laneServicesForEnv({}), [...LANE_SERVICES]);
  assert.deepEqual(laneServicesForEnv({ CW_PROD_C_EXTRA_SERVICES: 'catalog,pricing' }), [
    ...LANE_SERVICES,
    'catalog',
    'pricing',
  ]);
  for (const value of [
    'billing',
    'identity',
    'catalog,catalog',
    '../billing',
    'catalog,',
    'pricing;other',
    ' catalog',
  ]) {
    assert.throws(
      () => laneServicesForEnv({ CW_PROD_C_EXTRA_SERVICES: value }),
      /INVALID_LANE_C_EXTRA_SERVICES/,
    );
  }
  const plan = businessSuite('c-quote-hold');
  assert.deepEqual(plan.services, [...LANE_SERVICES, 'catalog', 'pricing']);
  assert.equal(plan.browser, false);
  assert.match(plan.scope, /Identity is an explicit HTTP double/);
});
