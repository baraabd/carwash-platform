import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { retainBrowserDiagnostics } from '../../scripts/production/acceptance-diagnostics.mjs';
import {
  BUSINESS_SUITES,
  HOSTED_BROKER_ACCEPTANCE_CASE,
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
    steps: [
      { name: 'tests', status: 'PASSED' },
      ...(suite === 'a-customer-browser'
        ? [{ name: 'customer-client-offline', status: 'PASSED' }]
        : []),
    ],
    evidence: [
      { name: 'nonempty-test-family', file: 'child.json' },
      ...(suite === 'a-customer-browser'
        ? [
            {
              name: 'customer-client-offline',
              files: ['production-booking', 'production-customer', 'production-membership'].map(
                (name) => `apps/customer-web/test/${name}.test.mjs`,
              ),
              counts: {
                tests: 3,
                pass: 3,
                fail: 0,
                cancelled: 0,
                skipped: 0,
                todo: 0,
                accepted: true,
              },
            },
          ]
        : []),
      ...(suite === 'b-reporting-broker'
        ? [
            {
              name: 'hosted-broker-definitions',
              names: [HOSTED_BROKER_ACCEPTANCE_CASE],
              counts: {
                tests: 1,
                pass: 1,
                fail: 0,
                cancelled: 0,
                skipped: 0,
                todo: 0,
                accepted: true,
              },
            },
          ]
        : []),
    ],
    cleanup: 'PASSED',
  }));

test('browser diagnostics retain only fresh declared synthetic visual files and summaries', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cw-browser-diagnostics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const visual = path.join(root, '.acceptance/production-C/operator-web/visual');
  const output = path.join(root, 'output');
  await mkdir(visual, { recursive: true });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  await writeFile(path.join(visual, 'task-assigned-390-candidate.png'), png);
  await writeFile(path.join(visual, 'visual-summary.json'), JSON.stringify({ changed: 3 }));
  await writeFile(path.join(visual, 'context.json'), 'Private generated infrastructure context');
  await writeFile(path.join(visual, 'cookies.json'), 'Private generated browser state');
  await writeFile(path.join(visual, 'recording.har'), 'Private HTTP transcript');
  await writeFile(path.join(visual, 'recovery-codes.png'), png);
  await writeFile(path.join(visual, 'old-390-candidate.png'), png);
  await utimes(path.join(visual, 'old-390-candidate.png'), new Date(0), new Date(0));
  await symlink(path.join(visual, 'context.json'), path.join(visual, 'linked-390-candidate.png'));
  const retained = await retainBrowserDiagnostics(
    root,
    'c-operator-fixtures',
    output,
    '2020-01-01T00:00:00Z',
  );
  assert.deepEqual(retained.map((entry) => path.basename(entry.file)).sort(), [
    'task-assigned-390-candidate.png',
    'visual-summary.json',
  ]);
  assert.ok(retained.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.deepEqual((await readdir(path.join(output, 'diagnostics/operator-visual'))).sort(), [
    'task-assigned-390-candidate.png',
    'visual-summary.json',
  ]);
  assert.deepEqual(
    await retainBrowserDiagnostics(root, 'a-customer-browser', output, '2020-01-01T00:00:00Z'),
    [],
  );
});

test('mislabelled screenshot bytes cannot be uploaded as visual evidence', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cw-browser-diagnostics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const visual = path.join(root, 'docs/production/D/evidence/p02-d2');
  await mkdir(visual, { recursive: true });
  await writeFile(path.join(visual, 'bookings-390-candidate.png'), 'This is not a PNG');
  await assert.rejects(
    retainBrowserDiagnostics(
      root,
      'd-admin-browser',
      path.join(root, 'output'),
      '2020-01-01T00:00:00Z',
    ),
    /Invalid PNG/,
  );
});

test('customer design diagnostics require synthetic provenance and retain only three declared previews', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cw-customer-design-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const visual = path.join(root, '.acceptance/production-A/customer-access-design');
  const output = path.join(root, 'output');
  await mkdir(visual, { recursive: true });
  const files = [
    'guest-entry-390-candidate.png',
    'guest-recovery-390-candidate.png',
    'guest-receipt-390-candidate.png',
  ];
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  for (const file of [...files, 'real-recovery-390-candidate.png'])
    await writeFile(path.join(visual, file), png);
  await writeFile(path.join(visual, 'cookies.json'), 'Private browser state');
  await assert.rejects(
    retainBrowserDiagnostics(root, 'a-customer-browser', output, '2020-01-01T00:00:00Z'),
    /Synthetic customer design manifest is required/,
  );
  const report = {
    status: 'UNAPPROVED_CUSTOMER_ACCESS_DESIGN',
    ownerJourneyEvidence: false,
    forwardedApiRequests: 0,
    containsRealCredentials: false,
    actualIdentityIssued: false,
    acceptedDesign: false,
    files,
  };
  const manifest = path.join(visual, 'design-review.json');
  await writeFile(manifest, JSON.stringify({ ...report, containsRealCredentials: true }));
  await assert.rejects(
    retainBrowserDiagnostics(root, 'a-customer-browser', output, '2020-01-01T00:00:00Z'),
  );
  await writeFile(manifest, JSON.stringify(report));
  const retained = await retainBrowserDiagnostics(
    root,
    'a-customer-browser',
    output,
    '2020-01-01T00:00:00Z',
  );
  assert.deepEqual(
    retained.map((entry) => path.basename(entry.file)).sort(),
    ['design-review.json', ...files].sort(),
  );
});

test('oversized diagnostic files fail before their contents are retained', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cw-browser-diagnostics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const visual = path.join(root, 'docs/production/D/evidence/p02-d2');
  await mkdir(visual, { recursive: true });
  const file = await open(path.join(visual, 'bookings-390-candidate.png'), 'wx');
  try {
    await file.truncate(20 * 1024 * 1024 + 1);
  } finally {
    await file.close();
  }
  await assert.rejects(
    retainBrowserDiagnostics(
      root,
      'd-admin-browser',
      path.join(root, 'output'),
      '2020-01-01T00:00:00Z',
    ),
    /oversized visual diagnostic/,
  );
});

test('the aggregate accepts exactly all current-source business families', () => {
  assertBusinessEvidence(complete(), invocation);
  assert.throws(() => businessSuite('../unexpected'), /Unknown business/);
});

test('missing and duplicated matrix results fail instead of silently reducing coverage', () => {
  for (const records of [[], complete().slice(1), [...complete(), complete()[0]]])
    assert.throws(() => assertBusinessEvidence(records, invocation));
});

test('the required business gate rejects absent, partial or incomplete Customer session client proof', () => {
  for (const mutate of [
    (report) => report.steps.pop(),
    (report) => report.evidence.pop(),
    (report) => report.evidence.push(structuredClone(report.evidence.at(-1))),
    (report) => report.evidence.at(-1).files.pop(),
    (report) => {
      report.evidence.at(-1).counts.tests = 0;
    },
    (report) => {
      report.evidence.at(-1).counts.pass = 2;
    },
    (report) => {
      report.evidence.at(-1).counts.skipped = 1;
    },
    (report) => {
      report.evidence.at(-1).counts.accepted = false;
    },
  ]) {
    const records = complete();
    mutate(records.find((report) => report.suite === 'a-customer-browser'));
    assert.throws(() => assertBusinessEvidence(records, invocation));
  }
});

test('required Reporting evidence rejects an omitted, duplicated, skipped or incomplete hosted transport case', () => {
  for (const mutate of [
    (report) => report.evidence.pop(),
    (report) => report.evidence.push(structuredClone(report.evidence.at(-1))),
    (report) => {
      report.evidence.at(-1).names = [];
    },
    (report) => {
      report.evidence.at(-1).names = ['unrelated successful test'];
    },
    (report) => {
      report.evidence.at(-1).names.push(HOSTED_BROKER_ACCEPTANCE_CASE);
    },
    (report) => {
      report.evidence.at(-1).counts.tests = 0;
    },
    (report) => {
      report.evidence.at(-1).counts.pass = 0;
    },
    (report) => {
      report.evidence.at(-1).counts.fail = 1;
    },
    (report) => {
      report.evidence.at(-1).counts.skipped = 1;
    },
    (report) => {
      report.evidence.at(-1).counts.cancelled = 1;
    },
    (report) => {
      report.evidence.at(-1).counts.todo = 1;
    },
    (report) => {
      report.evidence.at(-1).counts.accepted = false;
    },
  ]) {
    const reports = complete();
    mutate(reports.find((report) => report.suite === 'b-reporting-broker'));
    assert.throws(() => assertBusinessEvidence(reports, invocation));
  }
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
