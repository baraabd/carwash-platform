import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './reference-registry.mjs';

const needs = JSON.parse(process.env.NEEDS_JSON ?? '{}');
for (const [name, value] of Object.entries(needs)) {
  assert.equal(value.result, 'success', `F010 dependency ${name} did not succeed: ${value.result}`);
}
const downloaded = resolve(process.env.F010_DOWNLOADED_EVIDENCE ?? '');
const browser = JSON.parse(readFileSync(resolve(downloaded, 'browser-summary.json'), 'utf8'));
const references = JSON.parse(readFileSync(resolve(downloaded, 'references.json'), 'utf8'));
const git = (...args) =>
  execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
const sourceSha = git('rev-parse', 'HEAD');
const sourceTree = git('rev-parse', 'HEAD^{tree}');
assert.equal(browser.accepted, true);
assert.equal(browser.sourceSha, sourceSha);
assert.equal(browser.sourceTree, sourceTree);
assert.equal(references.ok, true);
assert.equal(browser.captures.length, 18);
assert.equal(browser.captures.every((capture) => capture.pixelDeterminism.changedPixels === 0), true);
assert.equal(browser.captures.every((capture) => capture.accessibility.blocking === 0), true);
assert.equal(browser.driftProbe.detected, true);
const result = {
  schemaVersion: 1,
  accepted: true,
  sourceSha,
  sourceTree,
  dependencies: Object.fromEntries(Object.entries(needs).map(([name, value]) => [name, value.result])),
  referenceSet: browser.referenceSet,
  captures: browser.captures.length,
};
const evidence = resolve(process.env.F010_EVIDENCE_DIR ?? '');
mkdirSync(evidence, { recursive: true });
writeFileSync(resolve(evidence, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
