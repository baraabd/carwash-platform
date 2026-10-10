// Production smoke CLI (P08-E2). Read-only; run only against a target the
// owner authorized (see docs/production/E/P08-E2_SMOKE_AND_OPERATING_WINDOW.md).
//
//   node scripts/production/E/production-smoke.mjs --target target.json [--ca ca.pem] [--out report.json]
//
// Secret references resolve only from `env://NAME` (the operator injects the
// value from the secret store into the environment); values never enter the
// target file or the report. Exit 0 = PASSED, 2 = FAILED, 1 = unusable input.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { runSmoke, defaultIo, SmokeInputError } from './release/smoke.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

export function envSecretRef(ref) {
  const match = /^env:\/\/([A-Z][A-Z0-9_]*)$/.exec(ref ?? '');
  const value = match ? process.env[match[1]] : undefined;
  return value && value.length > 0 ? value : null;
}

try {
  const targetPath = option('--target');
  if (!targetPath) throw new SmokeInputError('--target is required');
  const caPath = option('--ca');
  const report = await runSmoke(
    JSON.parse(readFileSync(targetPath, 'utf8')),
    defaultIo({ ca: caPath ? readFileSync(caPath) : undefined, readSecretRef: envSecretRef }),
  );
  const out = option('--out');
  if (out) {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  }
  for (const r of report.results)
    process.stdout.write(`${r.status.padEnd(14)} ${r.check}${r.reason ? ` — ${r.reason}` : ''}\n`);
  process.stdout.write(`smoke ${report.verdict}\n`);
  process.exit(report.verdict === 'PASSED' ? 0 : 2);
} catch (error) {
  process.stderr.write(
    `production-smoke: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
