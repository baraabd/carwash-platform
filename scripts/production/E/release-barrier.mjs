// Final release barrier CLI (P08-E1).
//
//   node scripts/production/E/release-barrier.mjs \
//     --candidate release/candidate.json --receipts release/receipts --out report.json
//
// Exit 0 = GO, 2 = NO_GO, 1 = unusable input. GO does not deploy anything: it
// only permits the reviewed runbook to run with the identical artifact
// manifest named in the report. Refs must be fetched before running.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateBarrier, BarrierInputError } from './release/barrier.mjs';
import { gitIo } from './release/io.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// --root exists for the barrier's own tests (a disposable git repository).
const root = path.resolve(option('--root') ?? repoRoot);

export function loadReceipts(directory) {
  return readdirSync(directory)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const source = path.join(directory, f);
      try {
        return {
          source: path.relative(root, source).replaceAll('\\', '/'),
          receipt: JSON.parse(readFileSync(source, 'utf8')),
        };
      } catch {
        return { source: path.relative(root, source).replaceAll('\\', '/'), receipt: null };
      }
    });
}

export function summary(report) {
  const lines = [
    `# Release barrier: ${report.verdict}`,
    '',
    `Candidate ${report.candidate.sha} (tree ${report.candidate.tree}), evaluated ${report.evaluatedAt}.`,
    `Deployment: ${report.deployment}.`,
    '',
    '| Family | Status | Owner | Action |',
    '| --- | --- | --- | --- |',
    ...report.families.map(
      (f) =>
        `| ${f.family} | ${f.status} | ${f.owner} | ${f.status === 'PASSED' ? '' : f.action} |`,
    ),
  ];
  for (const c of report.candidateChecks.filter((c) => c.status !== 'PASSED'))
    lines.push('', `Candidate check ${c.check} FAILED: ${c.reason}`);
  for (const u of report.unknownReceipts)
    lines.push('', `Unknown receipt ${u.source} (family ${u.family})`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const candidatePath = option('--candidate');
    const receiptsDir = option('--receipts');
    if (!candidatePath || !receiptsDir)
      throw new BarrierInputError('--candidate and --receipts are required');
    const policy = JSON.parse(
      readFileSync(path.join(repoRoot, 'architecture/release-barrier.json'), 'utf8'),
    );
    const report = evaluateBarrier({
      policy,
      candidate: JSON.parse(readFileSync(candidatePath, 'utf8')),
      receipts: loadReceipts(receiptsDir),
      io: gitIo(root),
      now: Date.now(),
    });
    const out = option('--out');
    if (out) {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
      writeFileSync(out.replace(/\.json$/, '') + '.md', summary(report));
    }
    process.stdout.write(summary(report));
    process.exit(report.verdict === 'GO' ? 0 : 2);
  } catch (error) {
    process.stderr.write(
      `release-barrier: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
