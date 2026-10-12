import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { buildImage, imageBuildTimeout } from '../../scripts/check-images.mjs';
import { run, registerSecret, clearSecrets } from '../../scripts/acceptance/lib/exec.mjs';

const acquired = (stdout = '') => ({ code: 0, outcome: 'exited', stdout, stderr: '' });

function buildCommand(execute) {
  return (args, options) => {
    if (args[0] === 'build') return execute(args, options);
    if (args[0] === 'image') {
      const repository = args.at(-1).replace(/:[^:/]+$/, '');
      return acquired(JSON.stringify([`${repository}@sha256:${'a'.repeat(64)}`]));
    }
    return acquired();
  };
}

test('image build timeout rejects values that disable or overflow the process deadline', () => {
  for (const value of ['', 0, -1, 0.5, 'not-a-number', Infinity, 2 ** 31]) {
    assert.throws(() => imageBuildTimeout(value), /CW_IMAGE_TIMEOUT_MS/);
  }
  assert.equal(imageBuildTimeout('1200000'), 20 * 60 * 1000);
});

test('CI leaves a bounded control and cleanup budget outside the image build deadline', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/sprint-02-ci.yml', import.meta.url),
    'utf8',
  );
  const images = workflow.split('\n  images:\n')[1].split('\n  supply-chain:\n')[0];
  const jobTimeout = Number(/timeout-minutes: (\d+)/.exec(images)[1]) * 60_000;
  const buildTimeout = imageBuildTimeout(/CW_IMAGE_TIMEOUT_MS: '(\d+)'/.exec(images)[1]);
  assert.ok(buildTimeout <= jobTimeout - 15 * 60_000);
});

test('a stuck build returns timeout diagnostics and stops progress without a retry', async () => {
  const logs = [];
  let attempts = 0;
  const secret = 'split-build-secret-fixture';
  registerSecret(secret);
  try {
    const built = await buildImage(
      'wallet',
      'cw-test:timeout',
      buildCommand((args, options) => {
        attempts += 1;
        assert.ok(args.includes('--progress=plain'));
        // A real child remains blocked after emitting a build phase and a
        // credential in separate chunks. The ordinary execution harness must
        // enforce the passed deadline and preserve its output redaction.
        return run(
          process.execPath,
          [
            '-e',
            `
          process.stderr.write('#7 RUN pnpm install --frozen-lockfile\\n');
          process.stdout.write('split-build-');
          setTimeout(() => process.stdout.write('secret-fixture\\n'), 30);
          setInterval(() => {}, 1000);
        `,
          ],
          options,
        );
      }),
      { timeoutMs: 450, progressIntervalMs: 50, log: (line) => logs.push(line) },
    );
    assert.equal(attempts, 1);
    assert.equal(built.ok, false);
    assert.equal(built.outcome, 'timeout');
    assert.notEqual(built.code, 0);
    assert.match(built.stderr, /RUN pnpm install --frozen-lockfile/);
    assert.match(built.stdout, /\[REDACTED\]/);
    assert.ok(!built.stdout.includes(secret));
    assert.ok(logs.some((line) => line.includes('still building')));
    assert.match(logs.at(-1), /outcome=timeout/);
    const count = logs.length;
    await delay(100);
    assert.equal(logs.length, count, 'progress must stop when the process exits');
  } finally {
    clearSecrets();
  }
});

test('build errors and cancellation cannot become successful builds', async () => {
  for (const result of [
    { code: 2, outcome: 'exited', stderr: 'TypeScript compilation failed', stdout: '' },
    { code: 0, outcome: 'cancelled', stderr: '', stdout: '' },
  ]) {
    let attempts = 0;
    const built = await buildImage(
      'wallet',
      'cw-test:failure',
      buildCommand(() => {
        attempts += 1;
        return result;
      }),
      { log: () => {} },
    );
    assert.equal(attempts, 1);
    assert.equal(built.ok, false);
    assert.equal(built.code, result.code);
    assert.equal(built.outcome, result.outcome);
  }
});
