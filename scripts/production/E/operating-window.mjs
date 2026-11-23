// Initial operating window CLI (P08-E2).
//
//   node scripts/production/E/operating-window.mjs --policy release/receipts/ext.operating-window-policy.json \
//     --observations window/observations.json [--out window/report.json]
//
// --policy accepts the barrier receipt (uses its `details`). Exit 0 only for
// VERIFIED_IN_OPERATION, 3 for OBSERVING, 2 for ROLLBACK/STOP/FORWARD_RECOVERY,
// 1 for unusable input. The runbook acts on the decision; this tool does not.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { evaluateWindow, WindowInputError } from './release/window.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

try {
  const policyPath = option('--policy');
  const observationsPath = option('--observations');
  if (!policyPath || !observationsPath)
    throw new WindowInputError('--policy and --observations are required');
  const policyFile = JSON.parse(readFileSync(policyPath, 'utf8'));
  if (policyFile.family !== undefined && policyFile.family !== 'ext.operating-window-policy')
    throw new WindowInputError('policy receipt is not ext.operating-window-policy');
  if (policyFile.status !== undefined && policyFile.status !== 'PASSED')
    throw new WindowInputError('policy receipt is not PASSED');
  const report = evaluateWindow({
    policy: policyFile.details ?? policyFile,
    observations: JSON.parse(readFileSync(observationsPath, 'utf8')),
    now: Date.now(),
  });
  const out = option('--out');
  if (out) {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  }
  process.stdout.write(`${report.decision}: ${report.reason}\n`);
  process.exit(
    report.decision === 'VERIFIED_IN_OPERATION' ? 0 : report.decision === 'OBSERVING' ? 3 : 2,
  );
} catch (error) {
  process.stderr.write(
    `operating-window: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
