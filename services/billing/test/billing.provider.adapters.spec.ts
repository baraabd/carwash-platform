import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { Money } from '../src/domain';
import { NotificationRejected } from '../src/ports';
import {
  DOCUMENTATION_PENDING_CAPABILITIES,
  ProviderConfigurationError,
  StaticProviderRegistry,
  createShamCashProvider,
  createSyriatelCashProvider,
  merchantProviderConfigFromEnv,
  productionProviderRegistry,
} from '../src/infrastructure/providers/merchant-providers';
import { SecretUnavailable, SecretValue } from '../src/infrastructure/providers/secret-value';
import { FakeSignedProvider } from './support/fake-provider';
import { assertProviderContract } from './support/provider-contract';

/* Provider adapters, configuration and secret isolation. No network, no database. */

const configError = (code: string) => (error: unknown) =>
  error instanceof ProviderConfigurationError && error.code === code;

test('ShamCash / Syriatel Cash declare only what is possible without an official API', async () => {
  const env = {
    BILLING_SHAM_CASH_MERCHANT_ACCOUNTS: 'sham-main,sham-branch_2',
    BILLING_SYRIATEL_CASH_MERCHANT_ACCOUNTS: 'syr-01',
  };
  const sham = createShamCashProvider(env);
  const syriatel = createSyriatelCashProvider(env);
  for (const adapter of [sham, syriatel]) {
    assert.deepEqual(adapter.capabilities, DOCUMENTATION_PENDING_CAPABILITIES);
    assert.equal(adapter.diagnostics().integration, 'OFFICIAL_DOCUMENTATION_PENDING');
    assert.deepEqual(adapter.diagnostics().secretsConfigured, []);
  }
  await assertProviderContract(sham, { accounts: ['sham-main', 'sham-branch_2'], secrets: [] });
  await assertProviderContract(syriatel, { accounts: ['syr-01'], secrets: [] });
  assert.equal(sham.acceptsMerchantAccount('syr-01'), false, 'accounts are per provider');
});

test('merchant configuration fails closed and refuses automation without an adapter', () => {
  assert.deepEqual(merchantProviderConfigFromEnv('SHAM_CASH', {}).merchantAccounts, []);
  assert.deepEqual(
    merchantProviderConfigFromEnv('SHAM_CASH', { BILLING_SHAM_CASH_MERCHANT_ACCOUNTS: ' a , b ' })
      .merchantAccounts,
    ['a', 'b'],
  );
  assert.throws(
    () =>
      merchantProviderConfigFromEnv('SHAM_CASH', {
        BILLING_SHAM_CASH_MERCHANT_ACCOUNTS: 'ok,not ok',
      }),
    configError('BILLING_SHAM_CASH_MERCHANT_ACCOUNTS_INVALID'),
  );
  assert.throws(
    () =>
      merchantProviderConfigFromEnv('SYRIATEL_CASH', {
        BILLING_SYRIATEL_CASH_MERCHANT_ACCOUNTS: 'a,a',
      }),
    configError('BILLING_SYRIATEL_CASH_MERCHANT_ACCOUNTS_DUPLICATE'),
  );
  for (const setting of ['API_ORIGIN', 'API_KEY_FILE', 'WEBHOOK_SECRET', 'CLIENT_ID'])
    assert.throws(
      () => merchantProviderConfigFromEnv('SHAM_CASH', { [`BILLING_SHAM_CASH_${setting}`]: 'x' }),
      configError('BILLING_SHAM_CASH_AUTOMATION_NOT_IMPLEMENTED'),
    );
  // An unconfigured provider accepts no account at all.
  assert.equal(createShamCashProvider({}).acceptsMerchantAccount('anything'), false);
});

test('the registry holds exactly one adapter per provider', () => {
  const registry = productionProviderRegistry({});
  assert.deepEqual(
    registry.all().map((adapter) => adapter.provider),
    ['SHAM_CASH', 'SYRIATEL_CASH'],
  );
  assert.throws(
    () => new StaticProviderRegistry([createShamCashProvider({})]),
    configError('PROVIDER_MISSING_SYRIATEL_CASH'),
  );
  assert.throws(
    () =>
      new StaticProviderRegistry([
        createShamCashProvider({}),
        createShamCashProvider({}),
        createSyriatelCashProvider({}),
      ]),
    configError('PROVIDER_DUPLICATE'),
  );
});

test('secrets come from mounted files only and never render', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'billing-secret-'));
  try {
    const file = path.join(dir, 'secret');
    writeFileSync(file, 'tops3cret-value\n');
    const secret = SecretValue.fromFileEnv('BILLING_TEST_SECRET', {
      BILLING_TEST_SECRET_FILE: file,
    });
    assert.ok(secret);
    assert.equal(secret.reveal(), 'tops3cret-value');
    for (const rendered of [
      String(secret),
      `${secret.toString()}`,
      JSON.stringify({ secret }),
      inspect(secret),
      inspect({ nested: { secret } }, { depth: 5 }),
    ])
      assert.equal(rendered.includes('tops3cret'), false, rendered);
    assert.equal(SecretValue.fromFileEnv('BILLING_TEST_SECRET', {}), null);
    assert.throws(
      () => SecretValue.fromFileEnv('BILLING_TEST_SECRET', { BILLING_TEST_SECRET: 'inline' }),
      SecretUnavailable,
    );
    assert.throws(
      () =>
        SecretValue.fromFileEnv('BILLING_TEST_SECRET', {
          BILLING_TEST_SECRET_FILE: path.join(dir, 'missing'),
        }),
      (error: unknown) => error instanceof SecretUnavailable && !error.message.includes(dir),
    );
    const large = path.join(dir, 'large');
    writeFileSync(large, 'x'.repeat(5_000));
    assert.throws(
      () => SecretValue.fromFileEnv('BILLING_TEST_SECRET', { BILLING_TEST_SECRET_FILE: large }),
      SecretUnavailable,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fake signed provider (test double): authentication, replay window and contract', async () => {
  const secret = SecretValue.of('FAKE_WEBHOOK_SECRET', 'fake-secret-for-tests');
  const fake = new FakeSignedProvider('SHAM_CASH', ['fake-merchant'], secret);
  await assertProviderContract(fake, {
    accounts: ['fake-merchant'],
    secrets: ['fake-secret-for-tests'],
  });
  const now = new Date('2026-10-10T10:00:00.000Z');
  const credit = {
    merchantAccount: 'fake-merchant',
    reference: 'tx-1234-abcd',
    amount: Money.of('SYP', 150_000n),
    occurredAt: new Date('2026-10-10T09:59:00.000Z'),
  };
  const signed = fake.sign(FakeSignedProvider.creditBody(credit), now);
  const body = new TextEncoder().encode(signed.raw);
  const accepted = await fake.authenticateNotification(
    { rawBody: body, headers: signed.headers },
    now,
  );
  assert.equal(accepted.kind, 'CREDIT_FINAL');
  if (accepted.kind === 'CREDIT_FINAL') {
    assert.equal(accepted.fact.reference, 'TX1234ABCD');
    assert.match(accepted.evidenceDigest, /^[0-9a-f]{64}$/);
  }
  const rejected = (error: unknown) => error instanceof NotificationRejected;
  const tampered = new TextEncoder().encode(signed.raw.replace('150000', '150001'));
  await assert.rejects(
    fake.authenticateNotification({ rawBody: tampered, headers: signed.headers }, now),
    rejected,
  );
  await assert.rejects(
    fake.authenticateNotification(
      { rawBody: body, headers: signed.headers },
      new Date(now.getTime() + 5 * 60_000 + 1),
    ),
    rejected,
    'outside the replay window',
  );
  const forged = fake.sign(
    FakeSignedProvider.creditBody(credit),
    now,
    SecretValue.of('OTHER', 'other-secret'),
  );
  await assert.rejects(
    fake.authenticateNotification(
      { rawBody: new TextEncoder().encode(forged.raw), headers: forged.headers },
      now,
    ),
    rejected,
  );
  await assert.rejects(
    fake.authenticateNotification({ rawBody: body, headers: {} }, now),
    rejected,
  );
  const pending = fake.sign(FakeSignedProvider.creditBody(credit, 'credit.pending'), now);
  assert.deepEqual(
    await fake.authenticateNotification(
      { rawBody: new TextEncoder().encode(pending.raw), headers: pending.headers },
      now,
    ),
    { kind: 'IGNORED' },
  );
});
