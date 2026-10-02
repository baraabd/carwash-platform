/**
 * Give a destructive integration case an awaited recovery barrier.
 *
 * node:test may time out a test before its async body/finally finishes. Recovery
 * therefore belongs to the test's after hook, which is awaited before another
 * case can use the shared infrastructure. Never pass the cancelled test signal
 * into recovery, and never turn a failed recovery into a successful hook.
 */
export function recoveryScope(t, recover, { cleanupTimeoutMs = 60_000 } = {}) {
  t.after(recover, { timeout: cleanupTimeoutMs });

  return async function step(name, operation) {
    t.signal.throwIfAborted();
    t.diagnostic(`recovery-case stage start: ${name}`);
    const started = Date.now();
    try {
      const result = await operation(t.signal);
      // A late observer must not continue the test after its recovery hook ran.
      t.signal.throwIfAborted();
      t.diagnostic(`recovery-case stage pass: ${name} (${Date.now() - started}ms)`);
      return result;
    } catch (cause) {
      t.diagnostic(`recovery-case stage fail: ${name} (${Date.now() - started}ms)`);
      throw new Error(`RECOVERY_CASE_STAGE_FAILED: ${name}`, { cause });
    }
  };
}
