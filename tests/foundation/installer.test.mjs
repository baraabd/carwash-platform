import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { applyPackage, validateManifest } from '../../scripts/f001/apply-patch.mjs';
const hash = (text) => createHash('sha256').update(text).digest('hex');
function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'washgo-F001-installer-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = path.join(directory, 'repo');
  mkdirSync(repo);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'F001 synthetic test');
  git('config', 'user.email', 'f001-test@example.invalid');
  git('remote', 'add', 'origin', 'https://github.com/baraabd/carwash-platform.git');
  const before = '{"name":"carwash-platform","private":true}\n';
  const after = '{"name":"carwash-platform","private":true,"version":"0.0.1"}\n';
  writeFileSync(path.join(repo, 'package.json'), before);
  writeFileSync(path.join(repo, 'notes.txt'), 'original\n');
  git('add', 'package.json', 'notes.txt');
  git('commit', '-m', 'synthetic fixture baseline, not the upstream source');
  const base = git('rev-parse', 'HEAD').trim();
  const marker = 'export {};\n';
  const patch = `diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-${before.trim()}\n+${after.trim()}\ndiff --git a/scripts/f001/marker.mjs b/scripts/f001/marker.mjs\nnew file mode 100644\n--- /dev/null\n+++ b/scripts/f001/marker.mjs\n@@ -0,0 +1 @@\n+export {};\n`;
  const patchFile = path.join(directory, 'candidate.patch');
  writeFileSync(patchFile, patch);
  const manifestFile = path.join(directory, 'manifest.json');
  const manifest = {
    repository: 'baraabd/carwash-platform',
    baseSHA: base,
    patchSha256: hash(patch),
    files: [
      {
        path: 'package.json',
        beforeBlobSHA: git('rev-parse', 'HEAD:package.json').trim(),
        sha256: hash(after),
      },
      { path: 'scripts/f001/marker.mjs', beforeBlobSHA: null, sha256: hash(marker) },
    ],
  };
  const save = () => writeFileSync(manifestFile, JSON.stringify(manifest));
  save();
  const options = { repo, worktree: path.join(directory, 'worktree'), patchFile, manifestFile };
  return { ...options, options, git, manifest, save, after };
}
test('installer applies in an independent worktree while preserving dirty files, untracked files and stash', (t) => {
  const f = setup(t);
  writeFileSync(path.join(f.repo, 'notes.txt'), 'stashed work\n');
  f.git('stash', 'push', '-m', 'preserve this fixture stash');
  writeFileSync(path.join(f.repo, 'package.json'), '{"name":"carwash-platform","userWork":true}\n');
  writeFileSync(path.join(f.repo, 'USER-NOTES.txt'), 'untracked user work\n');
  const originalStatus = f.git('status', '--porcelain=v1', '--untracked-files=all');
  const originalStash = f.git('stash', 'list');
  const result = applyPackage(f.options);
  assert.equal(result.filesApplied, 2);
  assert.equal(result.committed, false);
  assert.equal(result.pushed, false);
  assert.equal(f.git('status', '--porcelain=v1', '--untracked-files=all'), originalStatus);
  assert.equal(f.git('stash', 'list'), originalStash);
  assert.match(readFileSync(path.join(f.repo, 'package.json'), 'utf8'), /userWork/);
  assert.equal(readFileSync(path.join(f.worktree, 'package.json'), 'utf8'), f.after);
});
test('installer refuses a different repository without creating a worktree', (t) => {
  const f = setup(t);
  f.git('remote', 'set-url', 'origin', 'https://github.com/baraabd/homeservicemarketplace.git');
  assert.throws(() => applyPackage(f.options), /not baraabd\/carwash-platform/);
  assert.equal(existsSync(f.worktree), false);
});
test('installer refuses corrupted patch bytes', (t) => {
  const f = setup(t);
  writeFileSync(f.patchFile, 'not the package');
  assert.throws(() => applyPackage(f.options), /SHA-256 mismatch/);
  assert.equal(existsSync(f.worktree), false);
});
test('installer refuses an existing branch rather than resetting it', (t) => {
  const f = setup(t);
  f.git('branch', 'feat/F001-monorepo-ownership');
  assert.throws(() => applyPackage(f.options), /Branch already exists/);
  assert.equal(existsSync(f.worktree), false);
});
test('installer refuses an existing destination rather than overwriting it', (t) => {
  const f = setup(t);
  mkdirSync(f.worktree);
  writeFileSync(path.join(f.worktree, 'sentinel'), 'keep');
  assert.throws(() => applyPackage(f.options), /Destination already exists/);
  assert.equal(readFileSync(path.join(f.worktree, 'sentinel'), 'utf8'), 'keep');
});
test('installer refuses mismatched original blob provenance', (t) => {
  const f = setup(t);
  f.manifest.files[0].beforeBlobSHA = '0'.repeat(40);
  f.save();
  assert.throws(() => applyPackage(f.options), /Base source mismatch/);
  assert.equal(existsSync(f.worktree), false);
});
test('installer never reuses main as its target branch', (t) => {
  const f = setup(t);
  assert.throws(() => applyPackage({ ...f.options, branch: 'main' }), /dedicated feat/);
});
test('delivery manifest rejects protected design, policy, secret and traversal paths', () => {
  for (const file of [
    'AGENTS.md',
    '.github/CODEOWNERS',
    '.github/workflows/reference-integrity.yml',
    'design/reference/approved/file.html',
    'apps/customer-web/prototype/index.html',
    'services/customer/.env.local',
    '../escape',
    '/tmp/escape',
    '.git/config',
  ]) {
    assert.throws(
      () =>
        validateManifest({
          repository: 'baraabd/carwash-platform',
          baseSHA: 'a'.repeat(40),
          patchSha256: 'b'.repeat(64),
          files: [{ path: file, sha256: 'c'.repeat(64), beforeBlobSHA: null }],
        }),
      undefined,
      file,
    );
  }
});
test('delivery manifest rejects rewriting existing app/service/shared implementation', () => {
  assert.throws(
    () =>
      validateManifest({
        repository: 'baraabd/carwash-platform',
        baseSHA: 'a'.repeat(40),
        patchSha256: 'b'.repeat(64),
        files: [
          { path: 'services/billing/src/main.ts', sha256: 'c'.repeat(64), beforeBlobSHA: 'd'.repeat(40) },
        ],
      }),
    /cannot rewrite/,
  );
});
