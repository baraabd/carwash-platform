import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { secretScans } from '../../scripts/ci/secret-scans.mjs';
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
