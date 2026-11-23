import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs, {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertCompleteSecretScan,
  prepareSecretSource,
  secretScanBasename,
  secretScans,
} from '../../scripts/ci/secret-scans.mjs';
import { tool } from '../../scripts/ci/runtime.mjs';
import {
  HISTORICAL_ASSESSMENT_PATH,
  prepareReviewedSecretIgnores,
  verifyReviewedSecretFinding,
} from '../../scripts/ci/reviewed-secret-finding.mjs';

function fixture(work) {
  const directory = mkdtempSync(path.join(tmpdir(), 'cw-secret-scan-test-'));
  const git = (...args) => {
    const result = spawnSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
    assert.equal(result.status, 0, 'Fixture Git command failed');
    return result.stdout.trim();
  };
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'Synthetic security regression fixture');
    return git('rev-parse', 'HEAD');
  };
  const secret = () => {
    // Generated, nonfunctional scanner bait; never commit a credential literal.
    const value = ['ghp', randomBytes(18).toString('hex')].join('_');
    writeFileSync(path.join(directory, 'fixture.txt'), `token = ${value}\n`);
  };
  const scan = (name, sourceSha = git('rev-parse', 'HEAD'), ignores) => {
    const args = secretScans(sourceSha, directory, ignores).find(([id]) => id === name)[1];
    const report = path.join(directory, `${name}-report.json`);
    const result = spawnSync(
      tool('gitleaks'),
      [
        ...args.map((arg) => (arg === '.' ? directory : arg)),
        '--redact=100',
        '--max-archive-depth=2',
        '--max-decode-depth=2',
        '--report-format=json',
        `--report-path=${report}`,
      ],
      { cwd: directory, encoding: 'utf8', timeout: 30000 },
    );
    assert.ok([0, 1].includes(result.status), 'Fixture scanner failed');
    const findings = JSON.parse(readFileSync(report, 'utf8'));
    assert.ok(Array.isArray(findings));
    return { code: result.status, count: findings.length };
  };
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Security Regression');
    git('config', 'user.email', 'security-regression@example.invalid');
    writeFileSync(path.join(directory, 'fixture.txt'), 'No credentials here.\n');
    const base = commit();
    work({ directory, git, commit, secret, scan, base });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const clean = (result) => assert.deepEqual(result, { code: 0, count: 0 });
const blocked = (result) => {
  assert.equal(result.code, 1);
  assert.ok(result.count > 0, 'Synthetic credential must be detected');
};

test('clean immutable source and full history pass the pinned scanner', () =>
  fixture(({ scan }) => {
    clean(scan('history'));
    clean(scan('source'));
  }));

test('unmerged refs cannot contaminate an immutable source verdict', () =>
  fixture(({ git, secret, commit, scan, base }) => {
    git('checkout', '-qb', 'unrelated');
    secret();
    const unrelated = commit();
    git('checkout', '-q', 'main');
    clean(scan('history', base));
    blocked(scan('history', unrelated));
  }));

test('credentials in the tested head block both history and source scans', () =>
  fixture(({ secret, commit, scan }) => {
    secret();
    commit();
    blocked(scan('history'));
    blocked(scan('source'));
  }));

test('deleting a credential does not hide it from complete ancestor scanning', () =>
  fixture(({ directory, secret, commit, scan }) => {
    secret();
    commit();
    writeFileSync(path.join(directory, 'fixture.txt'), 'Credential removed.\n');
    commit();
    blocked(scan('history'));
    clean(scan('source'));
  }));

test('credentials on a merged second parent remain blocking after removal', () =>
  fixture(({ directory, git, secret, commit, scan }) => {
    git('checkout', '-qb', 'merged');
    secret();
    commit();
    writeFileSync(path.join(directory, 'fixture.txt'), 'Credential removed.\n');
    commit();
    git('checkout', '-q', 'main');
    writeFileSync(path.join(directory, 'main.txt'), 'Independent main work.\n');
    commit();
    git('merge', '-q', '--no-ff', '-m', 'Merge regression fixture', 'merged');
    blocked(scan('history'));
    clean(scan('source'));
  }));

test('credentials introduced only in a merge commit remain blocking after removal', () =>
  fixture(({ directory, git, secret, commit, scan }) => {
    git('checkout', '-qb', 'merged');
    writeFileSync(path.join(directory, 'branch.txt'), 'Independent branch work.\n');
    commit();
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '--no-commit', 'merged');
    secret();
    commit();
    writeFileSync(path.join(directory, 'fixture.txt'), 'Credential removed.\n');
    commit();
    blocked(scan('history'));
    clean(scan('source'));
  }));

function sourceFixture(t) {
  const parent = mkdtempSync(path.join(tmpdir(), 'cw-source-scan-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const source = path.join(parent, 'source');
  mkdirSync(source);
  const scan = () => {
    const scanned = path.join(parent, 'scanned');
    const manifest = prepareSecretSource(source, scanned);
    const output = path.join(parent, 'report.json');
    const result = spawnSync(
      tool('gitleaks'),
      [
        'dir',
        scanned,
        '--redact=100',
        '--max-archive-depth=2',
        '--max-decode-depth=2',
        '--report-format=json',
        `--report-path=${output}`,
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    const report = JSON.parse(readFileSync(output, 'utf8'));
    return {
      result: { code: result.status, stdout: result.stdout, stderr: result.stderr },
      report,
      manifest,
      scanned,
    };
  };
  return { parent, source, scan };
}

test('scan names preserve real archive suffixes and encode misleading archive substrings without collisions', () => {
  assert.equal(secretScanBasename('admin.browser.mjs'), 'admin%2Ebrowser%2Emjs');
  assert.equal(secretScanBasename('admin.browser.tar.gz'), 'admin%2Ebrowser.tar.gz');
  assert.equal(secretScanBasename('fixture.tar.gz'), 'fixture.tar.gz');
  assert.equal(secretScanBasename('fixture.br'), 'fixture.br');
  assert.equal(secretScanBasename('pnpm-lock.yaml'), 'pnpm-lock.yaml');
  assert.notEqual(
    secretScanBasename('admin%2Ebrowser%2Emjs'),
    secretScanBasename('admin.browser.mjs'),
  );
});

test('clean browser source is scanned byte-for-byte with no archive read errors', (t) => {
  const { source, scan } = sourceFixture(t);
  const bytes = Buffer.from(
    '/** Browser acceptance — العربية */\n' + 'const value = 1;\n'.repeat(2500),
  );
  writeFileSync(path.join(source, 'admin.browser.mjs'), bytes);
  const outcome = scan();
  assert.deepEqual(readFileSync(path.join(outcome.scanned, 'admin%2Ebrowser%2Emjs')), bytes);
  assert.deepEqual(readFileSync(path.join(source, 'admin.browser.mjs')), bytes);
  assert.equal(outcome.manifest.totalBytes, bytes.length);
  assert.equal(outcome.manifest.files.length, 1);
  assert.equal(outcome.manifest.renamed, 1);
  assertCompleteSecretScan(outcome.result, outcome.report);
});

test('a source replaced with a symlink after its file check cannot enter scan evidence', (t) => {
  const { parent, source } = sourceFixture(t);
  const victim = path.join(source, 'source.mjs');
  const privateFile = path.join(parent, 'outside.txt');
  const scanned = path.join(parent, 'scanned');
  writeFileSync(victim, 'original source');
  writeFileSync(privateFile, 'private file outside the source snapshot');
  let replaced = false;
  const replaceAfterCheck =
    (original) =>
    (...args) => {
      const result = original(...args);
      if (!replaced) {
        replaced = true;
        unlinkSync(victim);
        symlinkSync(privateFile, victim);
      }
      return result;
    };
  // Exercise a real pathname substitution at either the old pathname check or
  // the new descriptor check. No source/secret contents are printed on failure.
  t.mock.method(fs, 'lstatSync', replaceAfterCheck(fs.lstatSync));
  t.mock.method(fs, 'fstatSync', replaceAfterCheck(fs.fstatSync));
  syncBuiltinESMExports();
  try {
    assert.throws(() => prepareSecretSource(source, scanned), /snapshot changed|ELOOP/);
    assert.equal(replaced, true);
    assert.equal(fs.existsSync(path.join(scanned, 'source.mjs')), false);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('a credential near the end of misleadingly named browser source remains blocking', (t) => {
  const { source, scan } = sourceFixture(t);
  const token = ['ghp', randomBytes(18).toString('hex')].join('_');
  writeFileSync(
    path.join(source, 'admin.browser.mjs'),
    '// benign fixture\n'.repeat(8000) + `token = ${token}\n`,
  );
  const outcome = scan();
  assert.equal(outcome.result.code, 1);
  assert.ok(outcome.report.length > 0);
  assert.throws(() => assertCompleteSecretScan(outcome.result, outcome.report));
});

test('real compressed archive traversal still detects embedded credentials after safe naming', (t) => {
  const { parent, source, scan } = sourceFixture(t);
  const nested = path.join(parent, 'nested');
  mkdirSync(nested);
  const token = ['ghp', randomBytes(18).toString('hex')].join('_');
  writeFileSync(path.join(nested, 'fixture.txt'), `token = ${token}\n`);
  const tar = spawnSync(
    'tar',
    ['-czf', path.join(source, 'fixtures.browser.tar.gz'), '-C', nested, 'fixture.txt'],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(tar.status, 0);
  const outcome = scan();
  assert.equal(outcome.manifest.files[0].scannedPath, 'fixtures%2Ebrowser.tar.gz');
  assert.equal(outcome.result.code, 1);
  assert.ok(outcome.report.length > 0, 'The credential inside the genuine tar.gz must be detected');
  assert.throws(() => assertCompleteSecretScan(outcome.result, outcome.report));
});

test('corrupt real archive errors cannot be accepted as a clean source scan', (t) => {
  const { source, scan } = sourceFixture(t);
  writeFileSync(path.join(source, 'broken.tar.gz'), 'This is not a gzip archive.\n');
  const outcome = scan();
  assert.throws(() => assertCompleteSecretScan(outcome.result, outcome.report));
});

test('zero-exit read errors, skipped input and missing counts are fail-closed', () => {
  const valid = {
    code: 0,
    stdout: '',
    stderr: 'INF scanned ~123 bytes (123 B)\nINF no leaks found\n',
  };
  assert.deepEqual(assertCompleteSecretScan(valid, []), { findings: 0, scannedBytes: 123 });
  for (const diagnostic of [
    'ERR could not read until safe boundary: unexpected EOF',
    'WRN skipping archive: exceeds max archive depth',
    'ERR permission denied',
  ])
    assert.throws(() =>
      assertCompleteSecretScan({ ...valid, stderr: valid.stderr + diagnostic }, []),
    );
  assert.throws(() => assertCompleteSecretScan({ ...valid, stderr: 'INF no leaks found' }, []));
  assert.throws(() => assertCompleteSecretScan({ ...valid, stderr: 'INF scanned ~0 bytes' }, []));
  assert.throws(() => assertCompleteSecretScan({ ...valid, code: null }, []));
});

test('source mirror refuses symlinks and an empty source snapshot', (t) => {
  const { parent, source } = sourceFixture(t);
  assert.throws(() => prepareSecretSource(source, path.join(parent, 'empty')), /Empty immutable/);
  writeFileSync(path.join(parent, 'outside.txt'), 'Out of scope\n');
  symlinkSync(path.join(parent, 'outside.txt'), path.join(source, 'link.txt'));
  assert.throws(() => prepareSecretSource(source, path.join(parent, 'linked')), /symlinks/);
});

const ROOT = path.resolve(import.meta.dirname, '../..');
const assessment = JSON.parse(readFileSync(path.join(ROOT, HISTORICAL_ASSESSMENT_PATH), 'utf8'));
function committed(repository, ...args) {
  const result = spawnSync('git', args, {
    cwd: repository,
    timeout: 10000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  assert.equal(result.status, 0, 'Security fixture Git command failed');
  return result.stdout;
}
const currentSha = () => committed(ROOT, 'rev-parse', 'HEAD').toString('utf8').trim();

function reviewedFixture(t) {
  const parent = mkdtempSync(path.join(tmpdir(), 'cw-reviewed-finding-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const repository = path.join(parent, 'repository');
  committed(ROOT, 'clone', '--quiet', '--shared', '--no-checkout', ROOT, repository);
  committed(repository, 'checkout', '--quiet', '--detach', currentSha());
  committed(repository, 'config', 'user.name', 'Security Regression');
  committed(repository, 'config', 'user.email', 'security-regression@example.invalid');
  const target = path.join(repository, HISTORICAL_ASSESSMENT_PATH);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(assessment, null, 2) + '\n');
  committed(repository, 'add', HISTORICAL_ASSESSMENT_PATH);
  committed(repository, 'commit', '--quiet', '--allow-empty', '-m', 'Committed assessment fixture');
  const sha = committed(repository, 'rev-parse', 'HEAD').toString('utf8').trim();
  const output = path.join(parent, 'ignore-files');
  mkdirSync(output);
  const ignores = prepareReviewedSecretIgnores(repository, sha, output);
  return { parent, repository, sha, output, ignores, target };
}

test('reviewed public event assessment is bound to immutable raw source, context and published exports', () => {
  const result = verifyReviewedSecretFinding(ROOT, currentSha(), assessment);
  assert.equal(result.fingerprint, assessment.fingerprint);
  assert.equal(result.literalSha256, assessment.literalSha256);
  assert.equal(result.classification, 'published-event-name');
});

test('any changed assessment binding, digest, proof or broadened field fails before an ignore is emitted', () => {
  const mutations = [
    ['schemaVersion', 2],
    ['classification', 'credential'],
    ['fingerprint', assessment.fingerprint.replace(':136', ':139')],
    ['commit', currentSha()],
    ['file', 'tests/unit/another.test.mjs'],
    ['ruleId', 'github-pat'],
    ['line', 139],
    ['blobSha256', '0'.repeat(64)],
    ['lineSha256', '0'.repeat(64)],
    ['literalSha256', '0'.repeat(64)],
    ['context.line', 136],
    ['context.lineSha256', '0'.repeat(64)],
    ['contract.commit', currentSha()],
    ['contract.file', 'packages/event-contracts/src/index.ts'],
    ['contract.blobSha256', '0'.repeat(64)],
    ['contract.exportName', 'ANOTHER_EVENT'],
    ['contract.declarationLine', 148],
    ['contract.declarationLineSha256', '0'.repeat(64)],
    ['contract.eventLine', 147],
    ['contract.eventLineSha256', '0'.repeat(64)],
    ['contract.packageExportFile', 'packages/contracts/src/index.ts'],
    ['contract.packageExportBlobSha256', '0'.repeat(64)],
    ['contract.packageExportLine', 8],
    ['contract.packageExportLineSha256', '0'.repeat(64)],
    ['allowPaths', ['tests/']],
    ['contract.allowRules', ['generic-api-key']],
  ];
  for (const [field, value] of mutations) {
    const altered = structuredClone(assessment);
    const names = field.split('.');
    const parent = names.length === 1 ? altered : altered[names[0]];
    parent[names.at(-1)] = value;
    assert.throws(
      () => verifyReviewedSecretFinding(ROOT, currentSha(), altered),
      `Changed ${field} must fail`,
    );
  }
  const missing = structuredClone(assessment);
  delete missing.contract;
  assert.throws(() => verifyReviewedSecretFinding(ROOT, currentSha(), missing));
  const beforeFinding = committed(ROOT, 'rev-parse', `${assessment.commit}^`)
    .toString('utf8')
    .trim();
  assert.throws(
    () => verifyReviewedSecretFinding(ROOT, beforeFinding, assessment),
    /intact committed Git evidence/,
  );
});

test('ignore files contain one exact historical fingerprint and no source exception, read from committed assessment only', (t) => {
  const { parent, repository, sha, ignores, target } = reviewedFixture(t);
  assert.equal(readFileSync(ignores.history, 'utf8'), `${assessment.fingerprint}\n`);
  assert.equal(readFileSync(ignores.source, 'utf8'), '');
  assert.equal(fs.statSync(ignores.history).mode & 0o777, 0o600);
  const altered = { ...assessment, literalSha256: '0'.repeat(64) };
  writeFileSync(target, JSON.stringify(altered));
  const immutable = path.join(parent, 'immutable');
  mkdirSync(immutable);
  assert.equal(
    prepareReviewedSecretIgnores(repository, sha, immutable).assessment.fingerprint,
    assessment.fingerprint,
  );
  committed(repository, 'add', HISTORICAL_ASSESSMENT_PATH);
  committed(repository, 'commit', '--quiet', '-m', 'Invalid assessment fixture');
  const badSha = committed(repository, 'rev-parse', 'HEAD').toString('utf8').trim();
  const refused = path.join(parent, 'refused');
  mkdirSync(refused);
  assert.throws(() => prepareReviewedSecretIgnores(repository, badSha, refused), /event literal/);
  assert.deepEqual(fs.readdirSync(refused), [], 'No ignore file may precede proof validation');
});

test('pinned scanner recognizes the exact historical false positive and only the verified fingerprint removes it', (t) => {
  const { parent, ignores } = reviewedFixture(t);
  for (const approved of [false, true]) {
    const output = path.join(parent, `historical-${approved}.json`);
    const result = spawnSync(
      tool('gitleaks'),
      [
        'git',
        `--log-opts=--full-history -m ${assessment.commit}^..${assessment.commit}`,
        ROOT,
        '--ignore-gitleaks-allow',
        `--gitleaks-ignore-path=${approved ? ignores.history : ignores.source}`,
        '--redact=100',
        '--max-archive-depth=2',
        '--max-decode-depth=2',
        '--report-format=json',
        `--report-path=${output}`,
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    const report = JSON.parse(readFileSync(output, 'utf8'));
    if (approved) {
      assertCompleteSecretScan(
        { code: result.status, stdout: result.stdout, stderr: result.stderr },
        report,
      );
    } else {
      assert.equal(result.status, 1);
      assert.deepEqual(
        report.map((item) => item.Fingerprint),
        [assessment.fingerprint],
      );
    }
  }
});

test('same event text at another commit remains blocking in history and current source', (t) => {
  const { ignores } = reviewedFixture(t);
  const historical = committed(ROOT, 'cat-file', 'blob', `${assessment.commit}:${assessment.file}`);
  fixture(({ directory, commit, scan }) => {
    const file = path.join(directory, assessment.file);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, historical);
    const changedCommit = commit();
    assert.notEqual(changedCommit, assessment.commit);
    blocked(scan('history', changedCommit, ignores));
    blocked(scan('source', changedCommit, ignores));
  });
});

test('verified historical exception cannot suppress unrelated credentials or inline allow comments', (t) => {
  const { ignores } = reviewedFixture(t);
  fixture(({ directory, secret, commit, scan }) => {
    secret();
    const file = path.join(directory, 'fixture.txt');
    writeFileSync(file, readFileSync(file, 'utf8').trimEnd() + ' // gitleaks:allow\n');
    const head = commit();
    blocked(scan('history', head, ignores));
    blocked(scan('source', head, ignores));
  });
});

test('history review cannot collapse history/source ignore files or alter complete ancestry/archive scope', (t) => {
  const { ignores } = reviewedFixture(t);
  const scans = secretScans(currentSha(), ROOT, ignores);
  assert.equal(scans[0][1][1], `--log-opts=--full-history -m ${currentSha()}`);
  assert.ok(scans[0][1].includes(`--gitleaks-ignore-path=${ignores.history}`));
  assert.ok(scans[1][1].includes(`--gitleaks-ignore-path=${ignores.source}`));
  assert.throws(() =>
    secretScans(currentSha(), ROOT, { history: ignores.history, source: ignores.history }),
  );
  assert.throws(() =>
    assertCompleteSecretScan(
      { code: 0, stderr: 'INF scanned ~123 bytes\nERR could not read archive' },
      [],
    ),
  );
});
