import test from 'node:test';
import { constants, symlinkSync } from 'node:fs';
import { readRegularFile } from '../../scripts/lib/read-regular-file.mjs';
import { loopbackIdentityPort } from '../identity/_proxy-target.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ROOT,
  REQUIRED_JOBS,
  inventory,
  affectedTargets,
  assertJobResults,
  assertEvidence,
  sarifFindings,
  trivyFindings,
  auditSummary,
  assertTap,
  runtimeEnvironment,
} from '../../scripts/ci/policy.mjs';
const green = () => Object.fromEntries(REQUIRED_JOBS.map((id) => [id, { result: 'success' }]));
const owners = [
  { id: 'one', path: 'services/one' },
  { id: 'two', path: 'services/two' },
];
test('aggregate accepts exactly the complete successful job set', () => assertJobResults(green()));
for (const status of ['failure', 'cancelled', 'skipped', 'neutral', 'pending', null, undefined])
  test(`aggregate rejects ${String(status)}`, () => {
    const x = green();
    x.integration.result = status;
    assert.throws(() => assertJobResults(x));
  });
test('aggregate rejects empty, partial and unexpected dependency sets', () => {
  assert.throws(() => assertJobResults({}));
  const x = green();
  delete x.security;
  assert.throws(() => assertJobResults(x));
  assert.throws(() => assertJobResults({ ...green(), surprise: { result: 'success' } }));
});
test('path-aware fast feedback selects owners and fails conservatively', () => {
  assert.deepEqual(affectedTargets(['services/one/src/a.ts'], owners), [owners[0]]);
  for (const file of [
    'packages/observability/src/x.ts',
    '.github/workflows/x.yml',
    'new-unknown-file',
    'pnpm-lock.yaml',
  ])
    assert.deepEqual(affectedTargets([file], owners), owners);
  assert.deepEqual(affectedTargets(['docs/F009_RUNBOOK.md'], owners), []);
  assert.throws(() => affectedTargets(['../outside'], owners));
  assert.throws(() => affectedTargets(['/root'], owners));
});
test('inventory discovers every actual service image and explicitly lists planned shells', () => {
  const scope = inventory();
  assert.equal(scope.targets.length, 23);
  assert.equal(scope.targets.filter((t) => t.database).length, 19);
  assert.equal(scope.apps.length, 3);
  assert.equal(scope.plannedServices.length, 0);
});
const expected = {
  ids: ['static'],
  sha: 'a'.repeat(40),
  tree: 'b'.repeat(40),
  runId: '12',
  runAttempt: '1',
};
const evidence = () => [
  {
    schemaVersion: 1,
    id: 'static',
    status: 'passed',
    sourceSha: expected.sha,
    sourceTree: expected.tree,
    runId: '12',
    runAttempt: '1',
    sourceDirty: false,
    steps: [{ id: 'unit', status: 'passed' }],
    tools: { node: 'v24.21.0', pnpm: '10.32.1' },
  },
];
test('aggregate validates source, tree, run and every stage', () =>
  assertEvidence(evidence(), expected));
for (const [key, value] of [
  ['sourceSha', 'c'.repeat(40)],
  ['sourceTree', 'c'.repeat(40)],
  ['runId', '11'],
  ['runAttempt', '2'],
  ['sourceDirty', true],
  ['status', 'skipped'],
  ['steps', []],
  ['id', 'other'],
])
  test(`aggregate rejects invalid evidence ${key}`, () => {
    const x = evidence();
    x[0][key] = value;
    assert.throws(() => assertEvidence(x, expected));
  });
test('aggregate rejects absent, duplicate and skipped-step evidence', () => {
  assert.throws(() => assertEvidence([], expected));
  assert.throws(() => assertEvidence([...evidence(), ...evidence()], expected));
  const x = evidence();
  x[0].steps[0].status = 'skipped';
  assert.throws(() => assertEvidence(x, expected));
});
const sarif = (score = '8.1', level = 'warning') => ({
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'CodeQL',
          rules: [{ id: 'x', properties: { 'security-severity': score } }],
        },
      },
      results: [{ ruleId: 'x', level }],
    },
  ],
});
test('CodeQL high findings fail even when the scanner exited successfully', () =>
  assert.equal(sarifFindings(sarif())[0].blocking, true));
test('CodeQL applies explicit medium/error and invalid-result policies', () => {
  assert.equal(sarifFindings(sarif('6.9'))[0].blocking, false);
  assert.equal(sarifFindings(sarif('3.0', 'error'))[0].blocking, true);
  for (const input of [{}, { version: '2.1.0', runs: [] }, sarif('not-a-score')])
    assert.throws(() => sarifFindings(input));
  const x = sarif();
  x.runs[0].invocations = [{ executionSuccessful: false }];
  assert.throws(() => sarifFindings(x));
});
test('CodeQL clean results are valid but missing results never are', () => {
  const x = sarif();
  x.runs[0].results = [];
  assert.deepEqual(sarifFindings(x), []);
  delete x.runs[0].results;
  assert.throws(() => sarifFindings(x));
});
test('Trivy retains only safe vulnerability fields and blocks high/unclassified risk', () => {
  const input = {
    SchemaVersion: 2,
    Results: [
      {
        Vulnerabilities: [
          {
            VulnerabilityID: 'CVE-fixture',
            PkgName: 'fixture',
            InstalledVersion: '1',
            Severity: 'HIGH',
            Secret: 'must-not-be-retained',
          },
        ],
      },
    ],
  };
  assert.equal(trivyFindings(input)[0].blocking, true);
  assert.ok(!JSON.stringify(trivyFindings(input)).includes('must-not-be-retained'));
  input.Results[0].Vulnerabilities[0].Severity = 'UNKNOWN';
  assert.equal(trivyFindings(input)[0].blocking, true);
  assert.throws(() => trivyFindings({ SchemaVersion: 2 }));
});
test('network/scanner error cannot masquerade as an empty dependency audit', () => {
  assert.throws(() => auditSummary({ error: 'offline' }));
  assert.throws(() => auditSummary({ metadata: { vulnerabilities: {} } }));
  assert.deepEqual(
    auditSummary({ metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } } }),
    { low: 0, moderate: 0, high: 0, critical: 0 },
  );
});
test('real boundary violation in a disposable fixture makes the aggregate CLI fail', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cw-f009-negative-'));
  try {
    for (const p of ['scripts', 'architecture', 'services/one/src', 'services/two/src'])
      mkdirSync(path.join(dir, p), { recursive: true });
    writeFileSync(
      path.join(dir, 'scripts/check-boundaries.mjs'),
      readFileSync(path.join(ROOT, 'scripts/check-boundaries.mjs')),
    );
    writeFileSync(
      path.join(dir, 'architecture/service-catalog.json'),
      JSON.stringify({
        services: owners.map((o) => ({
          ...o,
          database: o.id,
          runtimeRole: `${o.id}_app`,
          migrationRole: `${o.id}_migration`,
        })),
      }),
    );
    for (const owner of owners)
      writeFileSync(
        path.join(dir, owner.path, 'package.json'),
        JSON.stringify({ name: `@carwash/${owner.id}`, private: true }),
      );
    const bad = path.join(dir, 'services/one/src/negative.ts');
    writeFileSync(bad, "import { forbidden } from '@carwash/two/private';\n");
    const boundary = spawnSync(process.execPath, [path.join(dir, 'scripts/check-boundaries.mjs')], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(boundary.status, 1);
    assert.match(boundary.stderr, /Cross-service import/);
    const needs = green();
    needs.static.result = boundary.status === 0 ? 'success' : 'failure';
    const aggregate = spawnSync(process.execPath, [path.join(ROOT, 'scripts/ci/aggregate.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: path.join(dir, 'evidence'),
        NEEDS_JSON: JSON.stringify(needs),
      },
    });
    assert.equal(aggregate.status, 1);
    assert.match(aggregate.stderr, /static did not succeed/);
    writeFileSync(bad, 'export const allowed = true;\n');
    const repaired = spawnSync(process.execPath, [path.join(dir, 'scripts/check-boundaries.mjs')], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(repaired.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TAP acceptance rejects skipped, TODO, canceled, empty and duplicate summaries', () => {
  const valid = '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.equal(assertTap(valid).pass, 1);
  for (const key of ['cancelled', 'skipped', 'todo'])
    assert.throws(() => assertTap(valid.replace(`# ${key} 0`, `# ${key} 1`)));
  assert.throws(() => assertTap(valid + valid));
  assert.throws(() => assertTap(''));
  assert.throws(() => assertTap(valid.replace('# tests 1', '# tests 0')));
});

test('gateway uses its catalog identity and never receives a business database', () => {
  const targets = inventory().targets;
  const gateway = targets.find((t) => t.database === null);
  assert.equal(gateway.id, 'gateway');
  const env = runtimeEnvironment(gateway);
  assert.ok(env.some((v) => v.startsWith('GATEWAY_UPSTREAMS=')));
  assert.ok(!env.some((v) => v.startsWith('DATABASE_URL=')));
  for (const target of targets.filter((t) => t.database)) {
    const ownerEnv = runtimeEnvironment(target);
    assert.ok(ownerEnv.some((v) => v.startsWith(`DATABASE_URL=postgresql://cw_${target.id}_app:`)));
    assert.ok(!ownerEnv.some((v) => v.startsWith('GATEWAY_UPSTREAMS=')));
  }
});

test('CodeQL location evidence excludes messages, snippets and tainted payloads', () => {
  const value = sarif();
  value.runs[0].results[0].message = { text: 'private-marker' };
  value.runs[0].results[0].locations = [
    {
      physicalLocation: {
        artifactLocation: { uri: 'scripts/ci/example.mjs' },
        region: { startLine: 12, snippet: { text: 'private-marker' } },
      },
    },
  ];
  const result = sarifFindings(value);
  assert.deepEqual(result[0].locations, [{ path: 'scripts/ci/example.mjs', line: 12 }]);
  assert.ok(!JSON.stringify(result).includes('private-marker'));
  value.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri = '../private';
  assert.throws(() => sarifFindings(value));
});

test('all runtime Dockerfiles use the reviewed digest, numeric identity and exact Node copy', () => {
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'scripts/ci/tools.lock.json'), 'utf8'));
  for (const file of ['Dockerfile', ...inventory().targets.map((t) => `${t.path}/Dockerfile`)]) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(source.includes(`ARG RUNTIME_IMAGE=${lock.runtime.image}`));
    assert.ok(source.includes('FROM ${RUNTIME_IMAGE} AS runner'));
    assert.ok(source.includes('COPY --from=builder /usr/local/bin/node /usr/local/bin/node'));
    assert.match(source, /^USER 1000:1000$/m);
    assert.ok(source.includes('CMD ["node", "-e",'));
  }
});

test('F009 descriptor reader handles empty files, exact limits and bounded overflow', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'cw-f009-file-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'input');
  writeFileSync(file, '');
  assert.equal(readRegularFile(file, 8).length, 0);
  writeFileSync(file, '12345678');
  assert.equal(readRegularFile(file, 8).toString(), '12345678');
  assert.throws(() => readRegularFile(file, 7), /FILE_LIMIT_EXCEEDED/);
  assert.throws(() => readRegularFile(file, 0), /INVALID_FILE_LIMIT/);
  assert.throws(() => readRegularFile(root, 8), /NOT_A_REGULAR_FILE/);
});

test('F009 descriptor reader refuses symlink targets in the Linux CI environment', (t) => {
  assert.ok(constants.O_NOFOLLOW, 'This Linux-specific acceptance requires O_NOFOLLOW');
  const root = mkdtempSync(path.join(tmpdir(), 'cw-f009-symlink-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'target');
  const link = path.join(root, 'link');
  writeFileSync(target, 'must not be read through the link');
  symlinkSync(target, link);
  assert.throws(() => readRegularFile(link, 100), { code: 'ELOOP' });
  assert.equal(readRegularFile(target, 100).toString(), 'must not be read through the link');
});

test('F009 browser proxy accepts only the explicit local Identity fixture port', () => {
  assert.equal(loopbackIdentityPort('http://127.0.0.1:49152'), 49152);
  for (const value of [
    'https://127.0.0.1:49152',
    'http://remote.invalid:49152',
    'http://127.0.0.1:0',
    'http://127.0.0.1',
    'http://u:p@127.0.0.1:49152',
    'http://127.0.0.1:49152/other',
    'http://127.0.0.1:49152/?x=y',
  ])
    assert.throws(() => loopbackIdentityPort(value));
});
