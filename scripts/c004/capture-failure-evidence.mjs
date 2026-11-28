// Preserve bounded capture evidence without changing the stable-capture decision.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureStable, DEFAULT_MAX_CAPTURES, DEFAULT_SETTLED_FRAMES } from './stable-capture.mjs';

export async function capturePairWithFailureEvidence(
  referenceCapture,
  candidateCapture,
  { unchanged, evidence, label },
) {
  const frames = { reference: [], candidate: [] };
  const saveFailure = (failedSide) => {
    for (const [side, captured] of Object.entries(frames)) {
      captured.forEach((image, index) => {
        const sequence = String(index + 1).padStart(2, '0');
        writeFileSync(resolve(evidence, `${label}.capture-failure.${side}.${sequence}.png`), image);
      });
    }
    writeFileSync(
      resolve(evidence, `${label}.capture-failure.json`),
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'capture-stability-failure',
          failedSide,
          maxCaptures: DEFAULT_MAX_CAPTURES,
          settledFrames: DEFAULT_SETTLED_FRAMES,
          counts: { reference: frames.reference.length, candidate: frames.candidate.length },
        },
        null,
        2,
      ) + '\n',
    );
  };
  const capturePage = async (side, capture) => {
    try {
      return await captureStable(
        async () => {
          const image = await capture();
          if (frames[side].length < DEFAULT_MAX_CAPTURES) frames[side].push(image);
          return image;
        },
        { unchanged },
      );
    } catch (error) {
      const failure = new Error(`${label}: ${side} ${error.message}`);
      try {
        saveFailure(side);
      } catch {
        failure.cause = new Error('CAPTURE_FAILURE_EVIDENCE_WRITE_FAILED');
      }
      throw failure;
    }
  };
  const referenceFrame = await capturePage('reference', referenceCapture);
  const candidateFrame = await capturePage('candidate', candidateCapture);
  return { referenceFrame, candidateFrame };
}
