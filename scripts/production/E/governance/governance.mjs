#!/usr/bin/env node
/**
 * Repository governance for `main` (P07-E4).
 *
 *   governance.mjs check                       read-only: desired vs live, exit 1 on drift
 *   governance.mjs apply --authorization <ref> create/update the ruleset (repository admin)
 *
 * The desired policy is architecture/governance/main-ruleset.json. It may only
 * be STRENGTHENED by review: validatePolicy() rejects a policy that drops a
 * mandatory rule, allows force-push/deletion, adds a bypass actor, or requires
 * a status check that a pull request to main cannot actually produce (which
 * would block every merge, or silently be ignored if mistyped).
 *
 * `apply` refuses without an explicit owner authorization reference, which is
 * recorded in the evidence file. It never deletes another ruleset and never
 * edits classic branch protection.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const POLICY_FILE = 'architecture/governance/main-ruleset.json';
const REPOSITORY = 'baraabd/carwash-platform';
const GITHUB_ACTIONS_APP = 15368;
const MANDATORY_RULES = [
  'deletion',
  'non_fast_forward',
  'pull_request',
  'required_status_checks',
  'code_scanning',
];

export function readPolicy(root = ROOT) {
  return JSON.parse(readFileSync(path.join(root, POLICY_FILE), 'utf8'));
}

/**
 * Check contexts that a pull request to main always produces: jobs of workflows
 * triggered by pull_request on main with no path filter, that are not
 * conditionally skipped (an `if:` other than always()), and not matrix-named.
 */
export function pullRequestCheckContexts(root = ROOT) {
  const dir = path.join(root, '.github/workflows');
  const contexts = new Map();
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    const [header, body = ''] = text.split(/\njobs:\n/);
    const pr = /\n {2}pull_request:\n((?: {4}.*\n)*)/.exec(`${header}\n`);
    if (!pr) continue;
    const prBlock = pr[1];
    if (/paths(-ignore)?:/.test(prBlock)) continue;
    const branches = /branches:\s*\[([^\]]*)\]/.exec(prBlock);
    if (
      branches &&
      !branches[1]
        .split(',')
        .map((b) => b.trim().replace(/'/g, ''))
        .includes('main')
    ) {
      continue;
    }
    for (const match of body.matchAll(/^ {2}([a-z0-9_-]+):\n((?: {4}.*\n|\s*\n)*)/gm)) {
      const [, id, block] = match;
      const name = (/^ {4}name: (.+)$/m.exec(block) ?? [])[1]?.trim() ?? id;
      const condition = (/^ {4}if: (.+)$/m.exec(block) ?? [])[1]?.trim();
      if (name.includes('${{')) continue;
      const unconditional = !condition || /^\$?\{?\{?\s*always\(\)\s*\}?\}?$/.test(condition);
      // Two jobs with one name are one ambiguous context: either can satisfy it.
      const ambiguous = contexts.has(name);
      contexts.set(name, { workflow: file, job: id, unconditional, ambiguous });
    }
  }
  return contexts;
}

export function validatePolicy(policy, contexts) {
  const problems = [];
  const fail = (code, detail = {}) => problems.push({ code, ...detail });
  if (policy.enforcement !== 'active') fail('NOT_ACTIVE');
  if (policy.target !== 'branch') fail('TARGET');
  if (JSON.stringify(policy.conditions?.ref_name?.include) !== '["~DEFAULT_BRANCH"]') {
    fail('NOT_DEFAULT_BRANCH');
  }
  if ((policy.bypass_actors ?? []).length > 0) fail('BYPASS_ACTORS_PRESENT');
  const types = (policy.rules ?? []).map((r) => r.type);
  for (const rule of MANDATORY_RULES) if (!types.includes(rule)) fail('RULE_MISSING', { rule });
  const pr = policy.rules?.find((r) => r.type === 'pull_request')?.parameters ?? {};
  if (pr.dismiss_stale_reviews_on_push !== true) fail('STALE_REVIEWS_KEPT');
  if (pr.required_review_thread_resolution !== true) fail('THREADS_NOT_REQUIRED');
  if (
    !Number.isInteger(pr.required_approving_review_count) ||
    pr.required_approving_review_count < 0
  ) {
    fail('APPROVAL_COUNT');
  }
  const checks = policy.rules?.find((r) => r.type === 'required_status_checks')?.parameters ?? {};
  if (checks.strict_required_status_checks_policy !== true) fail('NOT_STRICT');
  const required = checks.required_status_checks ?? [];
  if (required.length === 0) fail('NO_REQUIRED_CHECKS');
  for (const check of required) {
    const known = contexts.get(check.context);
    if (!known) fail('CHECK_NOT_PRODUCED_BY_PULL_REQUESTS', { context: check.context });
    else if (!known.unconditional) fail('CHECK_CONDITIONALLY_SKIPPED', { context: check.context });
    else if (known.ambiguous) fail('CHECK_NAME_AMBIGUOUS', { context: check.context });
    if (check.integration_id !== GITHUB_ACTIONS_APP)
      fail('CHECK_SOURCE', { context: check.context });
  }
  for (const mandatory of [
    'Foundation release gate',
    'Frozen design reference',
    'F001 final-source acceptance',
    'Static gates, builds and offline tests',
    'Real PostgreSQL and RabbitMQ acceptance',
    'Dependency and secret scanning',
  ]) {
    if (!required.some((c) => c.context === mandatory))
      fail('MANDATORY_CHECK_MISSING', { mandatory });
  }
  const scanning = policy.rules?.find((r) => r.type === 'code_scanning')?.parameters;
  const codeql = scanning?.code_scanning_tools?.find((t) => t.tool === 'CodeQL');
  if (!codeql) fail('CODEQL_RULE_MISSING');
  else if (
    !['high_or_higher', 'medium_or_higher', 'all'].includes(codeql.security_alerts_threshold)
  ) {
    fail('CODEQL_THRESHOLD_TOO_LOW');
  }
  return problems;
}

/** Compares the fields GitHub returns for a ruleset with the desired policy. */
export function compareRuleset(desired, live) {
  if (!live) return [{ code: 'RULESET_ABSENT', name: desired.name }];
  const pick = (r) => ({
    enforcement: r.enforcement,
    target: r.target,
    conditions: r.conditions,
    bypass_actors: (r.bypass_actors ?? []).map((a) => ({
      actor_id: a.actor_id ?? null,
      actor_type: a.actor_type,
      bypass_mode: a.bypass_mode,
    })),
    rules: [...(r.rules ?? [])]
      .map((rule) => ({ type: rule.type, parameters: rule.parameters ?? null }))
      .sort((a, b) => a.type.localeCompare(b.type)),
  });
  const drift = [];
  const want = pick(desired);
  const have = pick(live);
  for (const key of Object.keys(want)) {
    if (JSON.stringify(normalize(want[key])) !== JSON.stringify(normalize(have[key]))) {
      drift.push({ code: 'DRIFT', field: key });
    }
  }
  return drift;
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, normalize(value[k])]),
    );
  }
  return value;
}

function gh(args, input) {
  return execFileSync('gh', args, {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
  });
}

function liveRuleset(name) {
  const list = JSON.parse(gh(['api', `repos/${REPOSITORY}/rulesets?includes_parents=false`]));
  const summary = list.find((r) => r.name === name);
  if (!summary) return null;
  return JSON.parse(gh(['api', `repos/${REPOSITORY}/rulesets/${summary.id}`]));
}

function evidence(name, payload) {
  const dir = path.join(ROOT, '.acceptance', 'governance');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const policy = readPolicy();
  const problems = validatePolicy(policy, pullRequestCheckContexts());
  if (problems.length > 0) {
    console.error(`Policy invalid: ${JSON.stringify(problems)}`);
    process.exit(1);
  }
  const live = liveRuleset(policy.name);
  const drift = compareRuleset(policy, live);
  const classic = (() => {
    try {
      gh(['api', `repos/${REPOSITORY}/branches/main/protection`]);
      return 'present';
    } catch {
      return 'absent';
    }
  })();
  if (mode === 'check') {
    const file = evidence('check', {
      checkedAt: new Date().toISOString(),
      drift,
      classic,
      liveId: live?.id ?? null,
    });
    for (const d of drift) console.log(`DRIFT ${d.code} ${d.field ?? d.name ?? ''}`);
    console.log(drift.length === 0 ? 'GOVERNANCE MATCHES POLICY' : 'GOVERNANCE DRIFT');
    console.log(`classic branch protection: ${classic}; evidence ${path.relative(ROOT, file)}`);
    process.exit(drift.length === 0 ? 0 : 1);
  }
  if (mode === 'apply') {
    const i = rest.indexOf('--authorization');
    const authorization = i >= 0 ? rest[i + 1] : undefined;
    assert.ok(
      authorization && authorization.trim().length >= 8,
      'apply requires --authorization <owner decision reference>',
    );
    const body = JSON.stringify(policy);
    const result = live
      ? gh(
          ['api', '--method', 'PUT', `repos/${REPOSITORY}/rulesets/${live.id}`, '--input', '-'],
          body,
        )
      : gh(['api', '--method', 'POST', `repos/${REPOSITORY}/rulesets`, '--input', '-'], body);
    const applied = JSON.parse(result);
    const after = compareRuleset(policy, liveRuleset(policy.name));
    const file = evidence('apply', {
      appliedAt: new Date().toISOString(),
      authorization,
      rulesetId: applied.id,
      previous: live ? 'updated' : 'created',
      driftAfterApply: after,
    });
    console.log(
      `ruleset ${applied.id} ${live ? 'updated' : 'created'}; drift after apply: ${after.length}`,
    );
    console.log(`evidence ${path.relative(ROOT, file)}`);
    process.exit(after.length === 0 ? 0 : 1);
  }
  console.error('usage: governance.mjs check | apply --authorization <ref>');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
