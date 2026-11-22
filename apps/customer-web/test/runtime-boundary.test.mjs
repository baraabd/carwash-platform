import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');

async function builtModules(mode) {
  const result = await build({
    root,
    ...(mode ? { mode } : {}),
    logLevel: 'error',
    build: { write: false, sourcemap: false, minify: false },
  });
  assert.ok(!Array.isArray(result) && 'output' in result);
  return result.output.filter((entry) => entry.type === 'chunk');
}

test('default production and non-parity bundles omit every scenario initializer', async () => {
  for (const mode of [undefined, 'staging', 'development']) {
    const chunks = await builtModules(mode);
    const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules));
    assert.ok(modules.some((name) => name.endsWith('/state/emptySession.ts')));
    assert.ok(!modules.some((name) => name.endsWith('/app/initialSession.ts')), String(mode));
    assert.ok(!modules.some((name) => /\/fixtures\/customer\w+Scenarios\.ts$/.test(name)));
    for (const chunk of chunks) {
      assert.doesNotMatch(chunk.code, /WG-DEMO-RUNNING|WG-DEMO-DONE|home-returning-customer/);
    }
  }
});

test('explicit parity build retains the fixture selector for the approved comparison harness', async () => {
  const chunks = await builtModules('parity');
  const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules));
  assert.ok(modules.some((name) => name.endsWith('/app/initialSession.ts')));
  assert.ok(modules.some((name) => name.endsWith('/fixtures/customerReviewScenarios.ts')));
  assert.match(chunks.map((chunk) => chunk.code).join('\n'), /WG-DEMO-RUNNING/);
});
