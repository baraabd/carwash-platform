import assert from 'node:assert/strict';
import path from 'node:path';

export function secretScans(sourceSha, sourceDirectory) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  assert.ok(path.isAbsolute(sourceDirectory), 'Source archive directory must be absolute');
  return [
    // Scan every ancestor, including each merge parent. Unrelated fetched refs
    // must not change the security verdict for this immutable source commit.
    ['history', ['git', `--log-opts=--full-history -m ${sourceSha}`, '.']],
    ['source', ['dir', sourceDirectory]],
  ];
}
