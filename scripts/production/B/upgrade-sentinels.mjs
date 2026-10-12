const BILLING_RUNTIME_LEDGER_FIX = '20261010100000_p04b_provider_credits_refunds';

/** Preserve old rows before the final migration and verify them after it. */
export async function migrateWithUpgradeSentinels({
  service,
  previousMigrations,
  runtimeUrl,
  migrationUrl,
  billingSentinel,
  writeUpgradeSentinel,
  verifyUpgradeSentinel,
  deploy,
}) {
  if (service === 'billing') {
    // Only the historical pre-P04 fixture needs the owner: its runtime role
    // cannot invoke the ledger guards yet. Never downgrade a repaired baseline.
    const writerUrl = previousMigrations.includes(BILLING_RUNTIME_LEDGER_FIX)
      ? runtimeUrl
      : migrationUrl;
    await billingSentinel.write(writerUrl);
  }
  await writeUpgradeSentinel?.(runtimeUrl);
  await deploy();
  if (service === 'billing') await billingSentinel.verify(runtimeUrl);
  await verifyUpgradeSentinel?.(runtimeUrl);
}
