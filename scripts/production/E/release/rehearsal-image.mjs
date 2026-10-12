import assert from 'node:assert/strict';
import {
  officialImagePullCandidates,
  pullImageWithMirrors,
} from '../../../lib/image-references.mjs';

/**
 * Resolve once, then acquire that exact digest through the configured mirrors.
 * A successful manifest lookup does not mean the same registry will serve its
 * layers: public registries can rate-limit the subsequent Docker pull.
 * Never resolve the tag again after selecting a digest, or silently run a tag.
 */
export async function pullRehearsalImage(tag, docker) {
  assert.match(tag, /^[a-z0-9][a-z0-9._-]*:[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/);
  const failures = [];
  for (const candidate of officialImagePullCandidates(tag)) {
    const result = await docker(
      ['buildx', 'imagetools', 'inspect', candidate, '--format', '{{json .Manifest}}'],
      { capture: true, timeoutMs: 300_000 },
    );
    if (result.code !== 0) {
      failures.push(`${candidate}: ${result.stderr.slice(-1000)}`);
      continue;
    }
    const { digest } = JSON.parse(result.stdout);
    assert.match(digest, /^sha256:[0-9a-f]{64}$/, `Invalid digest for ${candidate}`);
    const reference = `${tag.replace(/:[^:]+$/, '')}@${digest}`;
    const pulled = await pullImageWithMirrors(reference, docker, {
      capture: true,
      timeoutMs: 300_000,
      tagCanonical: false,
    });
    return pulled.pullReference;
  }
  throw new Error(`Cannot resolve ${tag} to a digest:\n${failures.join('\n')}`);
}
