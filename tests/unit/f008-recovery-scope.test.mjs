import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { recoveryScope } from '../../scripts/acceptance/lib/recovery.mjs';

const moduleUrl = new URL('../../scripts/acceptance/lib/recovery.mjs', import.meta.url).href;

function fakeContext() {
  const controller = new AbortController();
  const hooks = [];
  const diagnostics = [];
  return {
    controller,
    hooks,
    diagnostics,
    t: {
      signal: controller.signal,
      after(fn, options) {
        hooks.push({ fn, options });
      },
      diagnostic(message) {
        diagnostics.push(message);
      },
    },
  };
}

test('recovery is registered before a destructive operation and has its own budget', async () => {
  const ctx = fakeContext();
  let recovered = 0;
  const step = recoveryScope(ctx.t, async () => {
    recovered += 1;
  });
  assert.equal(ctx.hooks.length, 1);
  assert.deepEqual(ctx.hooks[0].options, { timeout: 60_000 });
  assert.equal(recovered, 0);
  assert.equal(await step('probe', async (signal) => signal === ctx.t.signal), true);
  await ctx.hooks[0].fn();
  assert.equal(recovered, 1);
  assert.match(ctx.diagnostics[0], /stage start: probe/);
  assert.match(ctx.diagnostics[1], /stage pass: probe/);
});

test('a failed stage retains its cause instead of reporting a generic timeout', async () => {
  const ctx = fakeContext();
  const step = recoveryScope(ctx.t, async () => {});
  const cause = new Error('CONTROL_COMMAND_FAILED');
  await assert.rejects(
    step('stop broker', async () => {
      throw cause;
    }),
    (error) => error.message === 'RECOVERY_CASE_STAGE_FAILED: stop broker' && error.cause === cause,
  );
  assert.match(ctx.diagnostics.at(-1), /stage fail: stop broker/);
});

test('a cancelled test cannot start another mutation', async () => {
  const ctx = fakeContext();
  const step = recoveryScope(ctx.t, async () => {});
  ctx.controller.abort();
  let called = false;
  await assert.rejects(
    step('start broker', async () => (called = true)),
    { name: 'AbortError' },
  );
  assert.equal(called, false);
});

test('a late successful observation cannot continue a cancelled test', async () => {
  const ctx = fakeContext();
  const step = recoveryScope(ctx.t, async () => {});
  await assert.rejects(
    step('consumer reconnect', async () => {
      ctx.controller.abort();
      return 'late connection';
    }),
    (error) => error.cause?.name === 'AbortError',
  );
});

test('recovery runs despite cancellation and its failure is not swallowed', async () => {
  const ctx = fakeContext();
  const failure = new Error('BROKER_STILL_UNAVAILABLE');
  recoveryScope(ctx.t, async () => {
    throw failure;
  });
  ctx.controller.abort();
  await assert.rejects(ctx.hooks[0].fn(), (error) => error === failure);
});

/** Exercises real node:test cancellation, not a mocked test-runner lifecycle. */
function cancellationFixture(useRecoveryHook) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cw-recovery-scope-'));
  const fixture = path.join(dir, 'cancel.test.mjs');
  const code = `
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { recoveryScope } from ${JSON.stringify(moduleUrl)};
let brokerUp = true;
let continuedAfterCancellation = false;
let release;
let recovered = 0;
const restore = async () => {
  await delay(15);
  brokerUp = true;
  recovered += 1;
  release?.();
};
test('interrupted restart', { timeout: 40 }, async (t) => {
  brokerUp = false;
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  if (${useRecoveryHook}) {
    const step = recoveryScope(t, restore, { cleanupTimeoutMs: 1000 });
    await step('connection wait', () => new Promise((resolve) => { release = resolve; }));
    continuedAfterCancellation = true;
  } else {
    try {
      await new Promise((resolve) => { release = resolve; });
    } finally {
      await restore();
    }
  }
});
test('next case sees restored broker', () => {
  assert.equal(brokerUp, true);
  assert.equal(recovered, 1);
  assert.equal(continuedAfterCancellation, false);
});
`;
  try {
    writeFileSync(fixture, code);
    // A nested test process must not inherit the parent runner's IPC mode.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-concurrency=1', '--test-reporter=tap', fixture],
      { encoding: 'utf8', timeout: 5000, env },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    // The first case is intentionally cancelled; it must never become a pass.
    assert.equal(result.status, 1);
    assert.match(result.stdout, /not ok 1 - interrupted restart/);
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('reproduces the old finally-only cleanup race after test cancellation', () => {
  assert.match(cancellationFixture(false), /not ok 2 - next case sees restored broker/);
});

test('the after-hook barrier restores infrastructure before the next case', () => {
  const tap = cancellationFixture(true);
  assert.match(tap, /\nok 2 - next case sees restored broker/);
  assert.doesNotMatch(tap, /not ok 2 - next case sees restored broker/);
});

test('A2 retains real same-process and database-effect assertions', () => {
  const source = readFileSync(
    new URL('../integration/outbox-inbox.test.mjs', import.meta.url),
    'utf8',
  );
  const a2 = source.slice(source.indexOf("test('Case A2:"), source.indexOf('/* -------- Case A3:'));
  assert.match(a2, /recoveryScope\(t,/);
  assert.match(a2, /second\.reconnected, true/);
  assert.match(a2, /consumer\.child\.pid, consumerPid/);
  assert.match(a2, /applyCount === 1/);
  assert.match(a2, /A2_RECOVERY_FAILED/);
  assert.doesNotMatch(a2, /\.catch\(\(\) => \{\}\)/);
});

test('lifecycle subprocesses are cancellable and bounded below the outer test timeout', () => {
  const source = readFileSync(
    new URL('../../scripts/acceptance/lib/infra.mjs', import.meta.url),
    'utf8',
  );
  const lifecycle = source.slice(
    source.indexOf('export async function stopService('),
    source.indexOf('export async function waitFor('),
  );
  assert.match(lifecycle, /options\.signal\?\.throwIfAborted\(\)/);
  assert.match(lifecycle, /\(timeoutSeconds \+ 20\) \* 1000/);
  assert.match(lifecycle, /options\.timeoutMs \?\? 30_000/);
  assert.doesNotMatch(lifecycle, /3 \* 60 \* 1000/);
  assert.match(source, /timeoutMs: Math\.min\(10_000, remainingMs\), signal/);
  assert.match(source, /timeoutMs, intervalMs: 2000, signal/);
});
