// Partial reruns retain successful producer outputs from their original
// attempts. Download the immutable upload IDs those producers actually issued,
// rather than constructing names using the aggregate's newer run attempt.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export class EvidenceArtifactInputError extends Error {}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Pure validation of GitHub's static/browser `needs` results and job outputs. */
export function validateEvidenceArtifactIds(needs) {
  if (!object(needs)) throw new EvidenceArtifactInputError('F010 producer results are required');
  const ids = ['static', 'browser'].map((name) => {
    const producer = needs[name];
    if (!object(producer) || producer.result !== 'success')
      throw new EvidenceArtifactInputError(`F010 dependency ${name} did not succeed`);
    const id = producer.outputs?.evidence_artifact_id;
    if (typeof id !== 'string' || !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)))
      throw new EvidenceArtifactInputError(
        `F010 dependency ${name} must report a positive artifact ID`,
      );
    return id;
  });
  if (ids[0] === ids[1])
    throw new EvidenceArtifactInputError(
      'F010 static and browser evidence must have distinct artifact IDs',
    );
  return ids;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const ids = validateEvidenceArtifactIds(JSON.parse(process.env.NEEDS_JSON ?? '{}'));
    if (!process.env.GITHUB_OUTPUT)
      throw new EvidenceArtifactInputError('GITHUB_OUTPUT is required');
    // Only validated decimal IDs reach the action. An empty action input would
    // select all artifacts, so never emit output on any validation failure.
    appendFileSync(process.env.GITHUB_OUTPUT, `artifact_ids=${ids.join(',')}\n`);
    process.stdout.write('Validated exact static and browser evidence artifact IDs.\n');
  } catch (error) {
    process.stderr.write(
      `F010 evidence inputs: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
