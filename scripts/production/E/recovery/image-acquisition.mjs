import assert from 'node:assert/strict';
import {
  officialImagePullCandidates,
  pullImageWithMirrors,
} from '../../../lib/image-references.mjs';

/** Resolve once; alternate registries must serve the same immutable content. */
export async function acquireDrillImage(tag, execute) {
  const failures = [];
  for (const candidate of officialImagePullCandidates(tag)) {
    const result = await execute('docker', [
      'buildx',
      'imagetools',
      'inspect',
      candidate,
      '--format',
      '{{json .Manifest}}',
    ]);
    if (result.code !== 0 || (result.outcome && result.outcome !== 'exited')) {
      failures.push(`${candidate}: ${result.stderr.slice(-1000)}`);
      continue;
    }
    const { digest } = JSON.parse(result.stdout);
    assert.match(digest, /^sha256:[0-9a-f]{64}$/, `Invalid image digest: ${candidate}`);
    const reference = `${tag.replace(/:[^:/]+$/, '')}@${digest}`;
    const pulled = await pullImageWithMirrors(
      reference,
      (argv, options) => execute('docker', argv, options),
      { quiet: true, tagCanonical: false, timeoutMs: 900_000 },
    );
    return pulled.pullReference;
  }
  throw new Error(`Cannot resolve ${tag} to a digest:\n${failures.join('\n')}`);
}
