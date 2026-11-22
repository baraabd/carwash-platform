import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUSINESS_SUITES,
  assertBusinessEvidence,
  businessSuite,
} from '../../scripts/production/acceptance-plan.mjs';

const source = { sha: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false };
const invocation = { sha: source.sha, tree: source.tree, runId: '123', attempt: '2' };
const complete = () =>
  Object.keys(BUSINESS_SUITES).map((suite) => ({
    schemaVersion: 1,
    suite,
    accepted: true,
    source: { ...source },
    github: { runId: invocation.runId, attempt: invocation.attempt },
    scope: businessSuite(suite).scope,
    steps: [{ name: 'tests', status: 'PASSED' }],
    evidence: [{ name: 'nonempty-test-family', file: 'child.json' }],
    cleanup: 'PASSED',
  }));

test('the aggregate accepts exactly all current-source business families', () => {
  assertBusinessEvidence(complete(), invocation);
  assert.throws(() => businessSuite('../unexpected'), /Unknown business/);
});

test('missing and duplicated matrix results fail instead of silently reducing coverage', () => {
  for (const records of [[], complete().slice(1), [...complete(), complete()[0]]])
    assert.throws(() => assertBusinessEvidence(records, invocation));
});

test('stale, dirty, failed, empty and partial evidence cannot be accepted', () => {
  for (const mutate of [
    (r) => {
      r.source.sha = 'c'.repeat(40);
    },
    (r) => {
      r.source.tree = 'c'.repeat(40);
    },
    (r) => {
      r.source.dirty = true;
    },
    (r) => {
      r.github.runId = 'old-run';
    },
    (r) => {
      r.github.attempt = '1';
    },
    (r) => {
      r.accepted = false;
    },
    (r) => {
      r.evidence = [];
    },
    (r) => {
      r.steps = [];
    },
    (r) => {
      r.steps[0].status = 'SKIPPED';
    },
    (r) => {
      r.cleanup = 'FAILED';
    },
    (r) => {
      r.scope = 'Production ready';
    },
  ]) {
    const records = complete();
    mutate(records[0]);
    assert.throws(() => assertBusinessEvidence(records, invocation));
  }
});

test('CI always covers every owner and browser family, including main push verification', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/p01-p06-business-acceptance.yml', import.meta.url),
    'utf8',
  );
  const selected = [...workflow.matchAll(/- suite: ([a-z0-9-]+)/g)].map((match) => match[1]);
  assert.deepEqual(selected.sort(), Object.keys(BUSINESS_SUITES).sort());
  assert.match(workflow, /pull_request:\s+branches: \[main, develop\]/);
  assert.match(workflow, /push:\s+branches: \[main, develop\]/);
  assert.doesNotMatch(workflow, /continue-on-error|paths-ignore:|\bpaths:/);
  assert.match(workflow, /if: always\(\)[\s\S]+--cleanup/);
  assert.match(workflow, /needs: acceptance/);
  assert.match(workflow, /--aggregate/);
});
