import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeAcceptance } from '../../../scripts/parallel/E/finalize-acceptance.mjs';

function harness(cleanup, options = {}) {
  const records = [{ name: 'owned runtime checks', status: 'PASS' }];
  let persisted;
  const report = { record: (name, status, detail) => records.push({ name, status, ...detail }) };
  const promise = finalizeAcceptance({
    report,
    context: { project: 'owned-test-project' },
    provisioned: true,
    keep: false,
    cleanup,
    redact: (message) => message.replaceAll('private-sentinel', '[redacted]'),
    finish: () => {
      persisted = {
        accepted: records.every((record) => record.status === 'PASS'),
        phases: structuredClone(records),
      };
      return persisted;
    },
    ...options,
  });
  return { promise, persisted: () => persisted };
}

test('an unfinished teardown cannot produce or persist an accepted report', async () => {
  let release;
  const deferred = new Promise((resolve) => {
    release = resolve;
  });
  const run = harness(() => deferred);
  await Promise.resolve();
  assert.equal(run.persisted(), undefined);
  release({ code: 0 });
  const report = await run.promise;
  assert.equal(report.accepted, true);
  assert.equal(report.phases.at(-1).name, 'infra: teardown');
  assert.equal(report.phases.at(-1).status, 'PASS');
});

test('nonzero cleanup fails the persisted report and redacts its diagnostics', async () => {
  const run = harness(async () => ({ code: 1, stderr: 'private-sentinel' }));
  const report = await run.promise;
  assert.equal(report.accepted, false);
  assert.equal(report.phases.at(-1).status, 'FAIL');
  assert.equal(report.phases.at(-1).stderr, '[redacted]');
});

test('a thrown cleanup error also blocks acceptance', async () => {
  const report = await harness(async () => {
    throw new Error('private-sentinel');
  }).promise;
  assert.equal(report.accepted, false);
  assert.equal(report.phases.at(-1).note, '[redacted]');
});

test('keeping the owned stack is a skipped cleanup, never an accepted run', async () => {
  let cleaned = false;
  const report = await harness(
    async () => {
      cleaned = true;
    },
    { keep: true },
  ).promise;
  assert.equal(cleaned, false);
  assert.equal(report.accepted, false);
  assert.equal(report.phases.at(-1).status, 'SKIPPED');
});
