import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { requireReleaseWorkflow } from '../../../scripts/production/E/governance/release-workflow-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('release artifact selection permits publication only on non-PR main runs', () => {
  for (const eventName of ['pull_request', 'push', 'workflow_dispatch']) {
    for (const ref of ['refs/heads/main', 'refs/heads/develop', 'refs/pull/149/merge']) {
      const publication = eventName !== 'pull_request' && ref === 'refs/heads/main';
      assert.deepEqual(
        requireReleaseWorkflow({
          eventName,
          ref,
          rehearse: publication ? 'skipped' : 'success',
          publish: publication ? 'success' : 'skipped',
        }),
        { accepted: true, mode: publication ? 'publication' : 'rehearsal' },
      );
    }
  }
});

test('missing, skipped, failed or cancelled required work never turns the gate green', () => {
  for (const eventName of ['pull_request', 'push']) {
    for (const state of [undefined, 'skipped', 'failure', 'cancelled', 'neutral', 'pending']) {
      const publication = eventName === 'push';
      assert.throws(() =>
        requireReleaseWorkflow({
          eventName,
          ref: 'refs/heads/main',
          rehearse: publication ? 'skipped' : state,
          publish: publication ? state : 'skipped',
        }),
      );
    }
  }
  assert.throws(() =>
    requireReleaseWorkflow({
      eventName: 'pull_request',
      ref: 'refs/pull/149/merge',
      rehearse: 'success',
      publish: 'success',
    }),
  );
});

test('artifact and recovery rehearsals run on every main/develop PR and use the actual head', () => {
  for (const name of ['p07-release-artifacts.yml', 'p07-recovery-drill.yml']) {
    const source = readFileSync(path.join(root, '.github/workflows', name), 'utf8');
    const header = source.split('\njobs:')[0];
    assert.match(header, /pull_request:\n {4}branches: \[main, develop\]/);
    assert.doesNotMatch(header, /paths(?:-ignore)?:/);
    assert.match(
      source,
      /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
    );
  }
  const build = readFileSync(path.join(root, '.github/workflows/p07-release-build.yml'), 'utf8');
  const checkouts = build.split(/uses: actions\/checkout@[a-f0-9]{40}/).slice(1);
  assert.equal(checkouts.length, 3);
  for (const checkout of checkouts)
    assert.match(
      checkout.split(/\n {6}- /)[0],
      /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
    );
});
