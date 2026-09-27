import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, inventory, readJson, assertJobResults, assertEvidence } from './policy.mjs';
import { git, stage } from './runtime.mjs';
await stage('aggregate', async (step) => {
  await step('all-required-jobs-succeeded', () =>
    assertJobResults(JSON.parse(process.env.NEEDS_JSON ?? 'null')),
  );
  const directory = process.env.CI_DOWNLOADED_EVIDENCE;
  assert.ok(directory && path.isAbsolute(directory));
  const ids = [
    'plan',
    'targeted',
    'static',
    'integration',
    'security',
    'codeql',
    ...inventory(ROOT).targets.map((t) => `image-${t.id}`),
  ];
  const records = readdirSync(directory)
    .filter((f) => f.endsWith('.json') && ids.includes(f.slice(0, -5)))
    .map((f) => readJson(path.join(directory, f)));
  await step('exact-source-complete-evidence', () =>
    assertEvidence(records, {
      ids,
      sha: git('rev-parse', 'HEAD'),
      tree: git('rev-parse', 'HEAD^{tree}'),
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    }),
  );
  return {
    accepted: true,
    records: ids,
    note: 'Foundation only. No deployment, full app readiness or automatic merge.',
  };
});
