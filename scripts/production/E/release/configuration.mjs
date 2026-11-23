// Source-bound release configuration shared by the producer and final barrier.
// Read git objects, not the mutable checkout, so every participant hashes the
// same deployment inputs and policy for the exact candidate commit.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const CONFIG_PATHS = Object.freeze([
  'infra',
  'architecture/service-catalog.json',
  'architecture/release-barrier.json',
  'architecture/governance/main-ruleset.json',
]);

export function configDigest(root, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return null;
  try {
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    for (const file of CONFIG_PATHS) {
      const kind = git('cat-file', '-t', `${sha}:${file}`);
      if (kind !== (file === 'infra' ? 'tree' : 'blob')) return null;
    }
    const listing = git('ls-tree', '-r', '--full-tree', sha, '--', ...CONFIG_PATHS);
    if (!listing) return null;
    return `sha256:${createHash('sha256').update(listing).digest('hex')}`;
  } catch {
    return null;
  }
}
