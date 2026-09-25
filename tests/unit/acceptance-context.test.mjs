import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createRunContext } from '../../scripts/acceptance/lib/context.mjs';

test('acceptance credentials are URL-safe and safe as CLI positional arguments', async () => {
  const context = await createRunContext({
    runId: `unit-credential-shape-${process.pid}`,
  });

  try {
    const credentials = Object.values(context.credentials);
    assert.ok(credentials.length > 0);
    for (const credential of credentials) {
      assert.match(credential, /^[0-9a-f]{48}$/);
      assert.ok(!credential.startsWith('-'));
    }
  } finally {
    await rm(context.workDir, { recursive: true, force: true });
    await rm(context.evidenceDir, { recursive: true, force: true });
  }
});
