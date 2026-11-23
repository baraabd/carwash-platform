// P07-E4: the main-branch governance policy can only be strengthened, and every
// required check must be one a pull request to main actually produces.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareRuleset,
  pullRequestCheckContexts,
  readPolicy,
  validatePolicy,
} from '../../../scripts/production/E/governance/governance.mjs';

const contexts = pullRequestCheckContexts();
const codes = (p) => p.map((x) => x.code);
const mutate = (fn) => {
  const policy = structuredClone(readPolicy());
  fn(policy);
  return codes(validatePolicy(policy, contexts));
};
const rule = (policy, type) => policy.rules.find((r) => r.type === type);

test('the committed policy is valid against the real workflows', () => {
  assert.deepEqual(validatePolicy(readPolicy(), contexts), []);
});

test('every required check is produced unconditionally by a pull request to main', () => {
  for (const check of rule(readPolicy(), 'required_status_checks').parameters
    .required_status_checks) {
    const known = contexts.get(check.context);
    assert.ok(known, check.context);
    assert.equal(known.unconditional, true, check.context);
    assert.equal(known.ambiguous, false, check.context);
  }
});

test('weakening the policy is rejected', () => {
  assert.ok(mutate((p) => (p.enforcement = 'evaluate')).includes('NOT_ACTIVE'));
  assert.ok(
    mutate((p) => (p.rules = p.rules.filter((r) => r.type !== 'non_fast_forward'))).includes(
      'RULE_MISSING',
    ),
  );
  assert.ok(
    mutate((p) => (p.rules = p.rules.filter((r) => r.type !== 'deletion'))).includes(
      'RULE_MISSING',
    ),
  );
  assert.ok(
    mutate((p) => (p.rules = p.rules.filter((r) => r.type !== 'code_scanning'))).includes(
      'RULE_MISSING',
    ),
  );
  assert.ok(
    mutate((p) =>
      p.bypass_actors.push({ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }),
    ).includes('BYPASS_ACTORS_PRESENT'),
  );
  assert.ok(
    mutate(
      (p) =>
        (rule(p, 'required_status_checks').parameters.strict_required_status_checks_policy = false),
    ).includes('NOT_STRICT'),
  );
  assert.ok(
    mutate(
      (p) => (rule(p, 'pull_request').parameters.dismiss_stale_reviews_on_push = false),
    ).includes('STALE_REVIEWS_KEPT'),
  );
  assert.ok(
    mutate((p) => {
      const c = rule(p, 'required_status_checks').parameters;
      c.required_status_checks = c.required_status_checks.filter(
        (x) => x.context !== 'Foundation release gate',
      );
    }).includes('MANDATORY_CHECK_MISSING'),
  );
  assert.ok(
    mutate(
      (p) =>
        (rule(p, 'code_scanning').parameters.code_scanning_tools[0].security_alerts_threshold =
          'none'),
    ).includes('CODEQL_THRESHOLD_TOO_LOW'),
  );
  assert.ok(
    mutate((p) => (p.conditions.ref_name.include = ['refs/heads/release'])).includes(
      'NOT_DEFAULT_BRANCH',
    ),
  );
});

test('a mistyped, path-filtered or ambiguous check cannot be required', () => {
  const add = (context) =>
    mutate((p) =>
      rule(p, 'required_status_checks').parameters.required_status_checks.push({
        context,
        integration_id: 15368,
      }),
    );
  assert.ok(add('Foundation release gat').includes('CHECK_NOT_PRODUCED_BY_PULL_REQUESTS'));
  // p01 geo acceptance is path-filtered, so it would block unrelated PRs forever.
  assert.ok(
    add('Geo HTTP CLI and PostgreSQL acceptance').includes('CHECK_NOT_PRODUCED_BY_PULL_REQUESTS'),
  );
  // f009 and f010 both have a job called "static".
  assert.ok(add('static').includes('CHECK_NAME_AMBIGUOUS'));
  assert.ok(
    mutate(
      (p) =>
        (rule(p, 'required_status_checks').parameters.required_status_checks[0].integration_id = 1),
    ).includes('CHECK_SOURCE'),
  );
});

test('drift detection compares live ruleset fields with the policy', () => {
  const desired = readPolicy();
  assert.deepEqual(compareRuleset(desired, null), [{ code: 'RULESET_ABSENT', name: desired.name }]);
  const live = { ...structuredClone(desired), id: 7, rules: [...desired.rules].reverse() };
  assert.deepEqual(compareRuleset(desired, live), []);
  live.enforcement = 'disabled';
  live.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];
  assert.deepEqual(
    compareRuleset(desired, live).map((d) => d.field),
    ['enforcement', 'bypass_actors'],
  );
});
