import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePairWithFailureEvidence } from '../../scripts/c004/capture-failure-evidence.mjs';

function evidenceDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'cw-capture-evidence-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function capturedFiles(directory, side) {
  return readdirSync(directory)
    .filter((name) => name.includes(`.capture-failure.${side}.`) && name.endsWith('.png'))
    .sort()
    .map((name) => readFileSync(join(directory, name)));
}

test('reference instability retains each actual bounded frame before propagating the failure', async (t) => {
  const evidence = evidenceDirectory(t);
  const frames = [];
  let candidateCalls = 0;
  await assert.rejects(
    capturePairWithFailureEvidence(
      async () => {
        const image = Buffer.from(`reference-frame-${frames.length}`);
        frames.push(image);
        return image;
      },
      async () => {
        candidateCalls += 1;
        return Buffer.from('candidate');
      },
      { evidence, label: 'reference-case@430' },
    ),
    {
      message:
        'reference-case@430: reference page did not settle: no 3 consecutive captures matched in 8',
    },
  );
  assert.equal(frames.length, 8);
  assert.equal(candidateCalls, 0);
  assert.deepEqual(capturedFiles(evidence, 'reference'), frames);
  assert.deepEqual(capturedFiles(evidence, 'candidate'), []);
  assert.equal(readdirSync(evidence).length, 9);
  assert.deepEqual(
    JSON.parse(readFileSync(join(evidence, 'reference-case@430.capture-failure.json'))),
    {
      schemaVersion: 1,
      kind: 'capture-stability-failure',
      failedSide: 'reference',
      maxCaptures: 8,
      settledFrames: 3,
      counts: { reference: 8, candidate: 0 },
    },
  );
});

test('candidate instability preserves the earlier reference frames and every bounded candidate frame', async (t) => {
  const evidence = evidenceDirectory(t);
  const reference = Buffer.from('settled-reference');
  const candidates = [];
  await assert.rejects(
    capturePairWithFailureEvidence(
      async () => reference,
      async () => {
        const image = Buffer.from(`candidate-frame-${candidates.length}`);
        candidates.push(image);
        return image;
      },
      { evidence, label: 'candidate-case@430' },
    ),
    {
      message:
        'candidate-case@430: candidate page did not settle: no 3 consecutive captures matched in 8',
    },
  );
  assert.deepEqual(capturedFiles(evidence, 'reference'), [reference, reference, reference]);
  assert.deepEqual(capturedFiles(evidence, 'candidate'), candidates);
  assert.equal(candidates.length, 8);
  assert.equal(readdirSync(evidence).length, 12);
  assert.deepEqual(
    JSON.parse(readFileSync(join(evidence, 'candidate-case@430.capture-failure.json'))),
    {
      schemaVersion: 1,
      kind: 'capture-stability-failure',
      failedSide: 'candidate',
      maxCaptures: 8,
      settledFrames: 3,
      counts: { reference: 3, candidate: 8 },
    },
  );
});

test('successful capture preserves returned buffers and writes no failure evidence', async (t) => {
  const evidence = evidenceDirectory(t);
  const reference = Buffer.from('reference');
  const candidate = Buffer.from('candidate');
  const compared = [];
  const result = await capturePairWithFailureEvidence(
    async () => reference,
    async () => candidate,
    {
      evidence,
      label: 'settled@430',
      unchanged: async (previous, next) => {
        compared.push([previous, next]);
        return previous.equals(next);
      },
    },
  );
  assert.equal(result.referenceFrame.image, reference);
  assert.equal(result.candidateFrame.image, candidate);
  assert.deepEqual([result.referenceFrame.captures, result.candidateFrame.captures], [3, 3]);
  assert.deepEqual(compared, [
    [reference, reference],
    [reference, reference],
    [candidate, candidate],
    [candidate, candidate],
  ]);
  assert.deepEqual(readdirSync(evidence), []);
});

test('an evidence write failure cannot replace the original capture failure', async (t) => {
  const directory = evidenceDirectory(t);
  const evidence = join(directory, 'not-a-directory');
  writeFileSync(evidence, 'fixture');
  let captures = 0;
  await assert.rejects(
    capturePairWithFailureEvidence(
      async () => Buffer.from(String(captures++)),
      async () => Buffer.from('candidate'),
      { evidence, label: 'unwritable@430' },
    ),
    (error) => {
      assert.equal(
        error.message,
        'unwritable@430: reference page did not settle: no 3 consecutive captures matched in 8',
      );
      assert.equal(error.cause?.message, 'CAPTURE_FAILURE_EVIDENCE_WRITE_FAILED');
      return true;
    },
  );
  assert.equal(captures, 8);
});
