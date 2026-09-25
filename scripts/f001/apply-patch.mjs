import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const repository = 'baraabd/carwash-platform';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function git(cwd, args, allowFailure = false) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.status !== 0))
    throw new Error(`git ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result;
}
export function validateManifest(manifest) {
  if (
    !manifest ||
    manifest.repository !== repository ||
    !/^[0-9a-f]{40}$/.test(manifest.baseSHA) ||
    !/^[0-9a-f]{64}$/.test(manifest.patchSha256) ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw new Error('Invalid F001 delivery manifest.');
  const rootFiles = new Set([
    'package.json',
    '.gitignore',
    '.npmrc',
    '.prettierrc.f001.json',
    'eslint.f001.config.mjs',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'tsconfig.ownership.json',
    'turbo.json',
  ]);
  const seen = new Set();
  for (const entry of manifest.files) {
    const file = entry?.path;
    if (
      typeof file !== 'string' ||
      !/^[A-Za-z0-9_./-]+$/.test(file) ||
      file.startsWith('/') ||
      file
        .split('/')
        .some(
          (part) => !part || part === '..' || part === '.' || part === '.git' || /^\.env(?:\.|$)/.test(part),
        )
    )
      throw new Error('Unsafe delivery path.');
    if (!(
      rootFiles.has(file) ||
      /^(?:architecture|scripts|tests)\//.test(file) ||
      /^(?:apps|services|packages)\//.test(file) ||
      file === '.github/workflows/f001-ownership.yml'
    ))
      throw new Error(`Path is outside F001 ownership: ${file}`);
    if (/(?:^|\/)prototype\//.test(file) || /\.(?:html|png|jpg|svg|zip)$/i.test(file))
      throw new Error(`Frozen or unrelated visual asset: ${file}`);
    if (
      !/^[0-9a-f]{64}$/.test(entry.sha256) ||
      !(entry.beforeBlobSHA === null || /^[0-9a-f]{40}$/.test(entry.beforeBlobSHA))
    )
      throw new Error(`Missing source provenance: ${file}`);
    if (/^(?:apps|services|packages)\//.test(file) && entry.beforeBlobSHA !== null)
      throw new Error(`F001 cannot rewrite existing implementation files: ${file}`);
    if (seen.has(file)) throw new Error(`Duplicate delivery path: ${file}`);
    seen.add(file);
  }
}
export function applyPackage({
  repo,
  worktree,
  patchFile,
  manifestFile,
  branch = 'feat/F001-monorepo-ownership',
}) {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  validateManifest(manifest);
  const patch = readFileSync(patchFile);
  if (sha256(patch) !== manifest.patchSha256) throw new Error('Patch SHA-256 mismatch; nothing was applied.');
  const inputRoot = realpathSync(path.resolve(repo));
  const root = realpathSync(git(inputRoot, ['rev-parse', '--show-toplevel']).stdout.trim());
  const remote = git(root, ['remote', 'get-url', 'origin']).stdout.trim();
  if (
    !/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)baraabd\/carwash-platform(?:\.git)?\/?$/.test(
      remote,
    )
  )
    throw new Error('origin is not baraabd/carwash-platform; refusing to modify another repository.');
  for (const operation of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    const name = git(root, ['rev-parse', '--git-path', operation]).stdout.trim();
    if (existsSync(path.resolve(root, name)))
      throw new Error(`An in-progress Git operation exists (${operation}); it was preserved.`);
  }
  if (!/^feat\/F001-[a-z0-9-]+$/.test(branch))
    throw new Error('Use a dedicated feat/F001-* branch, never main or develop.');
  git(root, ['check-ref-format', '--branch', branch]);
  const existing = git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], true);
  if (existing.status !== 1)
    throw new Error('Branch already exists or cannot be checked; no branch was reset.');
  git(root, ['cat-file', '-e', `${manifest.baseSHA}^{commit}`]);
  const basePackage = JSON.parse(git(root, ['show', `${manifest.baseSHA}:package.json`]).stdout);
  if (basePackage.name !== 'carwash-platform')
    throw new Error('The selected source commit belongs to an unexpected project.');
  const destinationInput = path.resolve(worktree);
  if (existsSync(destinationInput))
    throw new Error('Destination already exists; it will not be overwritten.');
  const destination = path.join(
    realpathSync(path.dirname(destinationInput)),
    path.basename(destinationInput),
  );
  const relative = path.relative(root, destination);
  if (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
    throw new Error('The new worktree must be outside the original checkout.');
  for (const entry of manifest.files) {
    const base = git(root, ['rev-parse', '--verify', `${manifest.baseSHA}:${entry.path}`], true);
    if (entry.beforeBlobSHA === null && base.status === 0)
      throw new Error(`A supposedly new path already exists at the base: ${entry.path}`);
    if (entry.beforeBlobSHA !== null && (base.status !== 0 || base.stdout.trim() !== entry.beforeBlobSHA))
      throw new Error(`Base source mismatch: ${entry.path}`);
  }
  const paths = git(root, ['apply', '--numstat', path.resolve(patchFile)])
    .stdout.trim()
    .split('\n')
    .map((line) => {
      const parts = line.split('\t');
      if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1]))
        throw new Error('Only auditable text-file changes are allowed.');
      return parts[2];
    })
    .sort();
  if (JSON.stringify(paths) !== JSON.stringify(manifest.files.map((entry) => entry.path).sort()))
    throw new Error('The patch changes paths not described by its manifest.');
  const original = {
    head: git(root, ['rev-parse', 'HEAD']).stdout,
    status: git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout,
    stashes: git(root, ['stash', 'list']).stdout,
  };
  git(root, ['worktree', 'add', '-b', branch, destination, manifest.baseSHA]);
  // From this point failures leave the new worktree available for inspection.
  // There is deliberately no automatic reset, clean, branch deletion or removal.
  git(destination, ['apply', '--check', '--whitespace=error-all', path.resolve(patchFile)]);
  git(destination, ['apply', '--whitespace=error-all', path.resolve(patchFile)]);
  for (const entry of manifest.files) {
    const file = path.join(destination, entry.path);
    if (lstatSync(file).isSymbolicLink() || sha256(readFileSync(file)) !== entry.sha256)
      throw new Error(`Applied source hash mismatch: ${entry.path}`);
  }
  const changed = git(destination, ['status', '--porcelain=v1', '--untracked-files=all'])
    .stdout.trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
    .sort();
  if (JSON.stringify(changed) !== JSON.stringify(paths))
    throw new Error(
      'Unexpected changes appeared in the new worktree; inspect it without deleting user work.',
    );
  if (
    git(root, ['rev-parse', 'HEAD']).stdout !== original.head ||
    git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout !== original.status ||
    git(root, ['stash', 'list']).stdout !== original.stashes
  )
    throw new Error('Original repository state changed during application; inspect both worktrees.');
  return {
    repository,
    branch,
    baseSHA: manifest.baseSHA,
    worktree: destination,
    filesApplied: paths.length,
    committed: false,
    pushed: false,
    merged: false,
  };
}
