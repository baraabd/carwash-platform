import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acceptancePlan, suiteAccepted } from '../../../scripts/production/A/acceptance-plan.mjs';

test('suite preflight rejects invalid selections and absent suites before infrastructure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lane-a-preflight-'));
  try {
    for (const args of [
      [],
      ['--services'],
      ['--services', 'vehicle,'],
      ['--services', 'vehicle,vehicle'],
      ['--services', '../geo'],
      ['--services', 'geo', '--unknown'],
    ]) {
      assert.throws(() => acceptancePlan(args, root));
    }
    assert.throws(
      () => acceptancePlan(['--services', 'vehicle'], root),
      /MISSING_ACCEPTANCE_SUITE/,
    );
    await mkdir(path.join(root, 'tests/production/A'), { recursive: true });
    await writeFile(path.join(root, 'tests/production/A/vehicle.integration.test.mjs'), '');
    assert.deepEqual(acceptancePlan(['--services', 'vehicle'], root).services, ['vehicle']);
    assert.throws(
      () => acceptancePlan(['--services', 'vehicle,geo'], root),
      /MISSING_ACCEPTANCE_SUITE/,
    );
    await writeFile(path.join(root, 'tests/production/A/geo.integration.test.mjs'), '');
    const geo = acceptancePlan(['--services', 'geo'], root);
    assert.match(geo.scope, /Real Identity Nest application and Redis/);
    const mixed = acceptancePlan(['--services', 'vehicle,geo', '--keep'], root);
    assert.match(mixed.scope, /Real Identity Nest application and Redis/);
    assert.match(mixed.scope, /OTP delivery port is captured/);
    assert.equal(mixed.keep, true);
    await writeFile(path.join(root, 'tests/production/A/customer.integration.test.mjs'), '');
    assert.throws(
      () => acceptancePlan(['--services', 'customer'], root),
      /MISSING_ACCEPTANCE_SUITE.*customer-contract/,
    );
    await writeFile(path.join(root, 'tests/production/A/customer-contract.http-pg.test.mjs'), '');
    const customer = acceptancePlan(['--services', 'customer'], root);
    assert.equal(customer.suites.length, 2);
    assert.match(customer.scope, /explicit Identity HTTP double/);
    assert.equal(customer.gatewayOwners, false);
    assert.throws(
      () => acceptancePlan(['--services', 'customer,vehicle'], root),
      /MISSING_ACCEPTANCE_SUITE.*gateway-owner/,
    );
    await writeFile(path.join(root, 'tests/production/A/gateway-owner.integration.test.mjs'), '');
    const gateway = acceptancePlan(['--services', 'customer,vehicle,geo'], root);
    assert.equal(gateway.gatewayOwners, true);
    assert.equal(gateway.suites.length, 5);
    assert.match(gateway.scope, /production Gateway-to-Identity\/Customer\/Vehicle/);
    assert.throws(
      () => acceptancePlan(['--services', 'customer', '--customer-browser'], root),
      /CUSTOMER_BROWSER_REQUIRES_REAL_OWNERS/,
    );
    assert.throws(
      () => acceptancePlan(['--services', 'customer,vehicle', '--customer-browser'], root),
      /MISSING_ACCEPTANCE_SUITE.*customer-production/,
    );
    await writeFile(path.join(root, 'tests/production/A/customer-production.browser.test.mjs'), '');
    const browser = acceptancePlan(['--services', 'customer,vehicle', '--customer-browser'], root);
    assert.equal(browser.customerBrowser, true);
    assert.match(browser.scope, /Real Chromium/);
    for (const args of [
      ['--services', 'booking'],
      ['--services', 'booking,billing'],
      ['--services', 'booking', '--booking-billing'],
      ['--services', 'booking,billing,customer', '--booking-billing'],
      ['--services', 'booking,billing', '--booking-billing', '--customer-browser'],
      ['--services', 'booking,billing', '--booking-billing', '--booking-billing'],
    ])
      assert.throws(() => acceptancePlan(args, root));
    assert.throws(
      () => acceptancePlan(['--services', 'booking,billing', '--booking-billing'], root),
      /MISSING_ACCEPTANCE_SUITE.*booking-billing/,
    );
    await writeFile(path.join(root, 'tests/production/A/booking-billing.integration.test.mjs'), '');
    const bookingBilling = acceptancePlan(
      ['--services', 'booking,billing', '--booking-billing'],
      root,
    );
    assert.equal(bookingBilling.bookingBilling, true);
    assert.equal(bookingBilling.customerBrowser, false);
    assert.deepEqual(bookingBilling.services, ['booking', 'billing']);
    assert.deepEqual(bookingBilling.suites, [
      'tests/production/A/booking-billing.integration.test.mjs',
    ]);
    assert.match(bookingBilling.scope, /Real Identity Nest application and Redis/);
    assert.match(bookingBilling.scope, /Production Booking adapter to Billing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('suite acceptance requires complete, nonempty execution without skipped or unknown counts', () => {
  const result = { code: 0, outcome: 'exited', signal: null };
  const counts = { tests: 5, pass: 5, fail: 0, skipped: 0, todo: 0, cancelled: 0 };
  assert.equal(suiteAccepted(result, counts), true);
  for (const field of ['fail', 'skipped', 'todo', 'cancelled']) {
    assert.equal(suiteAccepted(result, { ...counts, [field]: 1 }), false);
  }
  assert.equal(suiteAccepted(result, { ...counts, tests: 0, pass: 0 }), false);
  assert.equal(suiteAccepted(result, { ...counts, pass: NaN }), false);
  assert.equal(suiteAccepted({ ...result, signal: 'SIGTERM' }, counts), false);
  assert.equal(suiteAccepted({ ...result, outcome: 'timeout' }, counts), false);
  assert.equal(suiteAccepted({ ...result, code: 1 }, counts), false);
});
