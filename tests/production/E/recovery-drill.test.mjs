// P07-E3a: static guards for the recovery drill. The drill itself runs against
// real servers in .github/workflows/p07-recovery-drill.yml.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const drill = readFileSync(path.join(root, 'scripts/production/E/recovery/drill.mjs'), 'utf8');
// Formatting may wrap lines; structural assertions read whitespace-normalized source.
const flat = drill.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/,? \)/g, ')');
const workflow = readFileSync(path.join(root, '.github/workflows/p07-recovery-drill.yml'), 'utf8');

test('every drill image is a fixed version resolved to a digest before use', () => {
  const tags = [...drill.matchAll(/^ {2}[a-z]+: '([^']+)',$/gm)].map((m) => m[1]);
  assert.ok(tags.length >= 6);
  for (const tag of tags) assert.match(tag, /:v?\d+\.\d+(\.\d+)?(-[a-z0-9.-]+)?$/, tag);
  assert.doesNotMatch(drill, /:latest\b/);
  assert.match(drill, /resolveImage = byDigest/);
  assert.match(drill, /images\[key\] = await resolveImage\(tag\)/);
  assert.match(flat, /SEAWEED = 'chrislusf\/seaweedfs@sha256:[0-9a-f]{64}'/);
});

test('acceptance needs every component; a skipped component is a failure', () => {
  assert.match(
    flat,
    /\['postgres', 'rabbitmq', 'redis', 'objects', 'alerts'\]\.every\(\(c\) => report\.components\[c\]\?\.ok === true\)/,
  );
  assert.match(drill, /report\.components\[component\] = \{ ok: false \}/);
});

test('failures are injected, not simulated, and the restore is isolated', () => {
  assert.match(drill, /'kill', '--signal', 'KILL', primary/);
  assert.match(drill, /network\(name\('pg-restore-net'\), \{ internal: true \}\)/);
  assert.match(drill, /restoreNetworkIsolated/);
  assert.match(drill, /allOwnersRuntimeDdlDeniedAfterRestore/);
  assert.match(drill, /ledgerHasNoGaps/);
});

test('no RPO/RTO target is invented: only measured values are reported', () => {
  assert.match(drill, /targets: 'NOT APPROVED: measured values only/);
  assert.doesNotMatch(drill, /rpoTarget|rtoTarget|maxRpo|maxRto/i);
});

test('drill workflow is pinned, read-only and keeps its evidence', () => {
  for (const [, ref] of workflow.matchAll(/uses: ([^\s]+)/g)) assert.match(ref, /@[0-9a-f]{40}$/);
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(workflow, /:\s*write/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /node-version-file: \.nvmrc/);
});
