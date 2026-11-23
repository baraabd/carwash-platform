import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateWithUpgradeSentinels } from '../../scripts/production/B/upgrade-sentinels.mjs';

function fixture(overrides = {}) {
  const calls = [];
  return {
    calls,
    options: {
      service: 'billing',
      previousMigrations: ['20261009100000_p03b_cash_custody_settlement'],
      runtimeUrl: 'runtime-role',
      migrationUrl: 'migration-role',
      billingSentinel: {
        write: async (url) => calls.push(['billing-write', url]),
        verify: async (url) => calls.push(['billing-verify', url]),
      },
      deploy: async () => calls.push(['deploy']),
      ...overrides,
    },
  };
}

test('pre-P04 billing seeds with the owner, then verifies with the runtime after deploy', async () => {
  const { calls, options } = fixture();
  await migrateWithUpgradeSentinels(options);
  assert.deepEqual(calls, [
    ['billing-write', 'migration-role'],
    ['deploy'],
    ['billing-verify', 'runtime-role'],
  ]);
});

test('an installed P04 ledger repair requires runtime writes regardless of migration count', async () => {
  const { calls, options } = fixture({
    previousMigrations: ['20261010100000_p04b_provider_credits_refunds'],
  });
  await migrateWithUpgradeSentinels(options);
  assert.deepEqual(calls, [
    ['billing-write', 'runtime-role'],
    ['deploy'],
    ['billing-verify', 'runtime-role'],
  ]);
});

for (const service of ['catalog', 'pricing']) {
  test(`${service} hooks surround deployment and use only the runtime identity`, async () => {
    const { calls, options } = fixture({ service });
    options.writeUpgradeSentinel = async (url) => calls.push([`${service}-write`, url]);
    options.verifyUpgradeSentinel = async (url) => calls.push([`${service}-verify`, url]);
    await migrateWithUpgradeSentinels(options);
    assert.deepEqual(calls, [
      [`${service}-write`, 'runtime-role'],
      ['deploy'],
      [`${service}-verify`, 'runtime-role'],
    ]);
  });
}

test('services without sentinels still run deployment', async () => {
  const { calls, options } = fixture({ service: 'wallet' });
  await migrateWithUpgradeSentinels(options);
  assert.deepEqual(calls, [['deploy']]);
});

test('a billing sentinel failure cannot be bypassed by deploying', async () => {
  const { calls, options } = fixture();
  options.billingSentinel.write = async () => {
    throw new Error('runtime privilege denied');
  };
  await assert.rejects(migrateWithUpgradeSentinels(options), /runtime privilege denied/);
  assert.deepEqual(calls, []);
});

test('an owner-specific sentinel failure stops deployment and verification', async () => {
  const { calls, options } = fixture({ service: 'pricing' });
  options.writeUpgradeSentinel = async () => {
    throw new Error('old quote missing');
  };
  options.verifyUpgradeSentinel = async () => calls.push(['verified']);
  await assert.rejects(migrateWithUpgradeSentinels(options), /old quote missing/);
  assert.deepEqual(calls, []);
});

test('a failed deployment stops post-upgrade verification', async () => {
  const { calls, options } = fixture();
  options.deploy = async () => {
    throw new Error('migration failed');
  };
  await assert.rejects(migrateWithUpgradeSentinels(options), /migration failed/);
  assert.deepEqual(calls, [['billing-write', 'migration-role']]);
});

test('post-upgrade data loss remains a failure after successful deployment', async () => {
  const { calls, options } = fixture({ service: 'catalog' });
  options.verifyUpgradeSentinel = async () => {
    throw new Error('catalog data lost');
  };
  await assert.rejects(migrateWithUpgradeSentinels(options), /catalog data lost/);
  assert.deepEqual(calls, [['deploy']]);
});
