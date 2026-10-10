// Real effects for the release barrier: git object resolution and evidence
// digests. Kept separate from barrier.mjs so the rules stay pure.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
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
  const base = path.resolve(root);
  return (relative) => {
    const resolved = path.resolve(base, relative);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
    if (!existsSync(resolved) || !statSync(resolved).isFile()) return null;
    return `sha256:${sha256Hex(readFileSync(resolved))}`;
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
