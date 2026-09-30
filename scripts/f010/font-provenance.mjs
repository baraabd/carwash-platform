import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ROOT } from './reference-registry.mjs';

const evidence =
  process.env.F010_EVIDENCE_DIR ?? resolve(ROOT, '.tmp/f010-evidence-not-for-commit');
const patterns = ['Segoe UI', 'Tahoma', 'Arial', 'sans-serif', 'sans-serif:charset=0639'];

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const matches = {};
for (const pattern of patterns) {
  const file = execFileSync('fc-match', ['--format=%{file}', pattern], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!file) throw new Error(`F010_FONT_NOT_RESOLVED:${pattern}`);
  matches[pattern] = { fileName: file.split('/').at(-1), sha256: hash(file) };
}
const result = {
  schemaVersion: 1,
  platform: process.platform,
  architecture: process.arch,
  runnerImage: process.env.ImageOS ?? process.env.RUNNER_OS ?? 'local',
  matches,
  note: 'Font names and hashes only. Font binaries are never retained.',
};
mkdirSync(evidence, { recursive: true });
writeFileSync(resolve(evidence, 'fonts.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
