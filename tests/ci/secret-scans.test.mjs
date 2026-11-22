import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const scan = (name, sourceSha = git('rev-parse', 'HEAD')) => {
    const args = secretScans(sourceSha, directory).find(([id]) => id === name)[1];
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
