// Real effects for the release barrier: git object resolution and evidence
// digests. Kept separate from barrier.mjs so the rules stay pure.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, openSync, fstatSync, closeSync, constants, realpathSync } from 'node:fs';
import path from 'node:path';

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function git(cwd, ...args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Evidence paths are relative to the repository root and may not escape it. */
export function evidenceDigester(root) {
  const base = realpathSync(root);
  return (relative) => {
    const resolved = path.resolve(base, relative);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
    let fd;
    try {
      const canonical = realpathSync(resolved);
      if (canonical !== base && !canonical.startsWith(base + path.sep)) return null;
      // Inspect and read the same opened file: replacing its path cannot change
      // the evidence being hashed. Do not follow a substituted leaf symlink or
      // block indefinitely if the leaf is a FIFO instead of a regular file.
      fd = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      if (!fstatSync(fd).isFile()) return null;
      return `sha256:${sha256Hex(readFileSync(fd))}`;
    } catch {
      return null;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
}

export function gitIo(root) {
  return {
    resolveTree: (sha) => git(root, 'rev-parse', '--verify', '--quiet', `${sha}^{tree}`),
    resolveRef: (ref) => git(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`),
    digestEvidence: evidenceDigester(root),
    sha256: sha256Hex,
  };
}
