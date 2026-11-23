import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EvidenceArtifactInputError,
  validateEvidenceArtifactIds,
} from '../../scripts/f010/evidence-artifacts.mjs';

const CLI = fileURLToPath(new URL('../../scripts/f010/evidence-artifacts.mjs', import.meta.url));
const retainedStaticId = '14810121797';
const retriedBrowserId = '14810164475';
const producers = () => ({
  static: {
    result: 'success',
    outputs: { evidence_artifact_id: retainedStaticId, producer_attempt: '1' },
  },
  browser: {
    result: 'success',
    outputs: { evidence_artifact_id: retriedBrowserId, producer_attempt: '2' },
  },
});

test('a partial rerun selects the actual artifact IDs from both successful producer attempts', () => {
  const needs = producers();
  assert.deepEqual(validateEvidenceArtifactIds(needs), [retainedStaticId, retriedBrowserId]);
  needs.static.outputs.producer_attempt = '2';
  needs.browser.outputs.producer_attempt = '1';
  assert.deepEqual(validateEvidenceArtifactIds(needs), [retainedStaticId, retriedBrowserId]);
});

test('both static and browser must report success before any evidence can be downloaded', () => {
  for (const name of ['static', 'browser']) {
    const missing = producers();
    delete missing[name];
    assert.throws(() => validateEvidenceArtifactIds(missing), EvidenceArtifactInputError);
    for (const result of ['failure', 'cancelled', 'timed_out', 'skipped', 'pending', undefined]) {
      const needs = producers();
      needs[name].result = result;
      assert.throws(
        () => validateEvidenceArtifactIds(needs),
        new RegExp(`${name} did not succeed`),
      );
    }
  }
  for (const needs of [null, undefined, {}, [], 'success'])
    assert.throws(() => validateEvidenceArtifactIds(needs), EvidenceArtifactInputError);
});

test('empty, malformed, imprecise or duplicated artifact IDs fail closed', () => {
  for (const name of ['static', 'browser']) {
    const noOutputs = producers();
    delete noOutputs[name].outputs;
    assert.throws(() => validateEvidenceArtifactIds(noOutputs), /positive artifact ID/);
    for (const id of [
      undefined,
      null,
      '',
      123,
      0,
      '0',
      '-1',
      '01',
      '1.0',
      '1e2',
      ' 1',
      '1,2',
      '1\nartifact_ids=2',
      '9007199254740992',
      {},
      [],
    ]) {
      const needs = producers();
      needs[name].outputs.evidence_artifact_id = id;
      assert.throws(() => validateEvidenceArtifactIds(needs), /positive artifact ID/);
    }
  }
  const duplicate = producers();
  duplicate.browser.outputs.evidence_artifact_id = retainedStaticId;
  assert.throws(() => validateEvidenceArtifactIds(duplicate), /distinct artifact IDs/);
});

test('the runner command emits exact IDs for mixed attempts, independent of its current attempt', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'f010-artifact-inputs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'github-output');
  const result = spawnSync(process.execPath, [CLI], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NEEDS_JSON: JSON.stringify(producers()),
      GITHUB_OUTPUT: output,
      GITHUB_RUN_ATTEMPT: '3',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(output, 'utf8'),
    `artifact_ids=${retainedStaticId},${retriedBrowserId}\n`,
  );
});

test('invalid producer inputs exit nonzero without emitting a broad download input', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'f010-artifact-denied-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'github-output');
  const failed = producers();
  failed.browser.result = 'failure';
  for (const input of ['not JSON', '{}', JSON.stringify(failed)]) {
    const result = spawnSync(process.execPath, [CLI], {
      encoding: 'utf8',
      env: { ...process.env, NEEDS_JSON: input, GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 1);
    assert.equal(existsSync(output), false);
  }
  const missingOutput = spawnSync(process.execPath, [CLI], {
    encoding: 'utf8',
    env: { ...process.env, NEEDS_JSON: JSON.stringify(producers()), GITHUB_OUTPUT: '' },
  });
  assert.equal(missingOutput.status, 1);
  assert.match(missingOutput.stderr, /GITHUB_OUTPUT is required/);
});
