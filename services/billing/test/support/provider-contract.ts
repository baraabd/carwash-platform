import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { Money } from '../../src/domain';
import { ProviderCapabilityMissing, type PaymentProviderAdapter } from '../../src/ports';

/**
 * Provider-adapter CONTRACT checks that every PaymentProviderAdapter must pass,
 * whatever provider it speaks to. They do not contact a provider: they prove
 * the adapter honours its declared capabilities, accepts only configured
 * merchant accounts and never exposes accounts or secrets in diagnostics.
 */
export async function assertProviderContract(
  adapter: PaymentProviderAdapter,
  configured: { readonly accounts: readonly string[]; readonly secrets: readonly string[] },
): Promise<void> {
  const { capabilities } = adapter;
  assert.equal(typeof capabilities.notifications, 'boolean');
  assert.equal(typeof capabilities.creditQuery, 'boolean');
  assert.equal(typeof capabilities.statementEvidence, 'boolean');
  assert.ok(['PROVIDER_API', 'MANUAL_OUT_OF_BAND'].includes(capabilities.refunds));

  for (const account of configured.accounts)
    assert.equal(adapter.acceptsMerchantAccount(account), true);
  assert.equal(adapter.acceptsMerchantAccount('not-a-configured-account'), false);
  assert.equal(adapter.acceptsMerchantAccount(''), false);

  const missing = (error: unknown) => error instanceof ProviderCapabilityMissing;
  const instruction = {
    refundId: '0b0e2c58-7a39-4f4e-9f6e-0d5f0c1b2a39',
    merchantAccount: configured.accounts[0] ?? 'none',
    originalReference: 'ABCD1234',
    amount: Money.of('SYP', 1n),
  };
  if (!capabilities.notifications)
    await assert.rejects(
      adapter.authenticateNotification(
        { rawBody: new Uint8Array([123, 125]), headers: {} },
        new Date(),
      ),
      missing,
    );
  if (!capabilities.creditQuery)
    await assert.rejects(adapter.queryCredit('ABCD1234', 'corr'), missing);
  if (capabilities.refunds !== 'PROVIDER_API') {
    await assert.rejects(adapter.submitRefund(instruction, 'corr'), missing);
    await assert.rejects(adapter.refundStatus(instruction, 'corr'), missing);
  }

  const diagnostics = adapter.diagnostics();
  assert.equal(diagnostics.provider, adapter.provider);
  assert.deepEqual(diagnostics.capabilities, { ...capabilities });
  assert.equal(diagnostics.merchantAccountCount, configured.accounts.length);
  const rendered = JSON.stringify(diagnostics) + inspect(diagnostics, { depth: 5 });
  for (const account of configured.accounts) assert.doesNotMatch(rendered, new RegExp(account));
  for (const secret of configured.secrets) assert.equal(rendered.includes(secret), false);
}
