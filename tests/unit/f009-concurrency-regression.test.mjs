import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REQUIRED_JOBS, assertJobResults } from '../../scripts/ci/policy.mjs';

const workflow = readFileSync(
  new URL('../../.github/workflows/f009-foundation.yml', import.meta.url),
  'utf8',
);
const match = workflow.match(/^concurrency:\n  group: ([^\r\n]+)\n  cancel-in-progress: true$/m);
assert.ok(match, 'F009 must retain explicit cancel-in-progress concurrency');
const eventExpression = '${{ github.event_name }}';
const ownerExpression = '${{ github.event.pull_request.head.repo.full_name || github.repository }}';
const subjectExpression = '${{ github.event.pull_request.number || github.ref }}';
const repository = 'baraabd/carwash-platform';
const branch = 'refs/heads/feat/F009-ci-security';
const prRef = 'refs/pull/16/merge';

// Model only the three literal expressions below, never execute workflow code.
// actionlint validates syntax; real push and PR runs prove runner behavior.
function groupFor(event, ref, number = 0, owner = repository) {
  const group = match[1]
    .replace(eventExpression, event)
    .replace(ownerExpression, owner)
    .replace(subjectExpression, String(number || ref));
  assert.ok(!group.includes('${{'), 'Unexpected concurrency expression');
  return group.toLowerCase();
}

test('F009 concurrency contract isolates event, repository and PR or full ref', () => {
  assert.equal(match[1], `f009-${eventExpression}-${ownerExpression}-${subjectExpression}`);
  assert.match(workflow, /  aggregate:\n    name: Foundation release gate\n    if: always\(\)/);
});

test('push and pull_request for the same head cannot cancel each other', () => {
  assert.notEqual(groupFor('push', branch), groupFor('pull_request', prRef, 16));
});

test('manual verification cannot cancel push or pull_request verification', () => {
  const groups = [
    groupFor('push', branch),
    groupFor('pull_request', prRef, 16),
    groupFor('workflow_dispatch', branch),
  ];
  assert.equal(new Set(groups).size, groups.length);
});

test('updates to one PR still supersede old work without canceling a different PR', () => {
  assert.equal(
    groupFor('pull_request', prRef, 16),
    groupFor('pull_request', 'refs/pull/16/head', 16),
  );
  assert.notEqual(
    groupFor('pull_request', prRef, 16),
    groupFor('pull_request', 'refs/pull/17/merge', 17),
  );
});

test('full refs and source repositories retain independent concurrency scopes', () => {
  assert.notEqual(groupFor('push', 'refs/heads/main'), groupFor('push', 'refs/tags/main'));
  assert.notEqual(groupFor('push', 'refs/heads/main'), groupFor('push', 'refs/heads/develop'));
  assert.notEqual(
    groupFor('pull_request', prRef, 16),
    groupFor('pull_request', prRef, 16, 'example/carwash-platform'),
  );
});

test('cancelled plan and every other unsuccessful dependency still block acceptance', () => {
  const green = () => Object.fromEntries(REQUIRED_JOBS.map((id) => [id, { result: 'success' }]));
  assert.doesNotThrow(() => assertJobResults(green()));
  for (const job of REQUIRED_JOBS) {
    for (const result of ['cancelled', 'failure', 'skipped']) {
      const needs = green();
      needs[job].result = result;
      assert.throws(() => assertJobResults(needs), new RegExp(`${job} did not succeed`));
    }
  }
});
