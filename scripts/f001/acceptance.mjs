#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const baseSHA = '0d6453fc65b62efd287ad3728930857d930e6601';
export const gatePlan = [
  { id: 'install-frozen', program: 'pnpm', args: ['install', '--frozen-lockfile', '--ignore-scripts'] },
  { id: 'toolchain', program: 'node', args: ['scripts/f001/toolchain.mjs'] },
  { id: 'strict-typecheck', program: 'pnpm', args: ['typecheck:ownership'] },
  { id: 'compile-ownership', program: 'pnpm', args: ['build:ownership'] },
  { id: 'catalog-and-real-pnpm-discovery', program: 'node', args: ['scripts/check-foundation.mjs', '--ci'] },
  { id: 'full-source-boundaries', program: 'node', args: ['scripts/check-ownership.mjs', '--ci', '--json'] },
  { id: 'legacy-foundation', program: 'pnpm', args: ['verify:foundation'], tests: true },
  { id: 'f001-regression-tests', program: 'pnpm', args: ['test:f001'], tests: true },
  { id: 'design-lock-tests', program: 'pnpm', args: ['test:design-lock'], tests: true },
  { id: 'lint', program: 'pnpm', args: ['lint:f001'] },
  { id: 'format', program: 'pnpm', args: ['format:f001:check'] },
  { id: 'independent-workspace-builds', program: 'pnpm', args: ['exec', 'turbo', 'run', 'build', '--force'] },
  { id: 'public-contract-entrypoints', program: 'pnpm', args: ['test:contracts'], tests: true },
  { id: 'dependency-audit', program: 'pnpm', args: ['audit', '--audit-level=low'] },
  { id: 'diff-whitespace', program: 'git', args: ['diff', '--check'] },
];
export function tapHasUnprovenTests(output) {
  const counts = Object.fromEntries(
    ['tests', 'fail', 'skipped', 'todo', 'cancelled'].map((field) => [
      field,
      [...output.matchAll(new RegExp(`^# ${field} (\\d+)\\s*$`, 'gm'))].map((match) => Number(match[1])),
    ]),
  );
  if (Object.values(counts).some((values) => !values.length)) return true;
  return (
    counts.tests.some((value) => value === 0) ||
    ['fail', 'skipped', 'todo', 'cancelled'].some((field) => counts[field].some((value) => value !== 0))
  );
}
export function verdict(gates, blockers, sourceDirty) {
  if (gates.some((gate) => gate.status === 'FAILED')) return 'FAILED';
  const required = ['design-before', ...gatePlan.map((gate) => gate.id), 'design-after'].sort();
  const actual = gates.map((gate) => gate.id).sort();
  if (
    blockers.length ||
    sourceDirty ||
    JSON.stringify(actual) !== JSON.stringify(required) ||
    gates.some((gate) => gate.status !== 'PASS')
  )
    return 'BLOCKED';
  return 'ACCEPTED';
}
function execute(program, args, cwd = root) {
  let command = program === 'node' ? process.execPath : program;
  let actualArgs = args;
  if (program === 'pnpm') {
    const script = process.env.npm_execpath;
    if (script && /\.(?:c?js)$/.test(script)) {
      command = process.execPath;
      actualArgs = [script, ...args];
    } else if (process.platform === 'win32') command = 'pnpm.cmd';
  }
  return spawnSync(command, actualArgs, {
    cwd,
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 32 * 1024 * 1024,
    shell: command.endsWith('.cmd'),
  });
}
export function main(args) {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      'base-ref': { type: 'string', default: baseSHA },
      'evidence-dir': { type: 'string' },
      ci: { type: 'boolean', default: false },
    },
  });
  if (!/^[0-9a-f]{40}$/.test(values['base-ref'])) throw new Error('--base-ref must be a full commit SHA.');
  const evidence = values['evidence-dir']
    ? path.resolve(values['evidence-dir'])
    : mkdtempSync(path.join(tmpdir(), 'washgo-F001-evidence-'));
  const relativeEvidence = path.relative(root, evidence);
  if (
    relativeEvidence === '' ||
    (!relativeEvidence.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeEvidence))
  )
    throw new Error('Evidence must be outside the source checkout.');
  mkdirSync(evidence, { recursive: true });
  const report = {
    sprint: 'F001',
    verdict: 'BLOCKED',
    baseSHA: values['base-ref'],
    testedSHA: null,
    sourceDirty: true,
    node: process.version,
    platform: process.platform,
    generatedAt: new Date().toISOString(),
    blockers: [],
    gates: [],
  };
  const record = (gate) => {
    const result = execute(gate.program, gate.args);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`;
    writeFileSync(path.join(evidence, `${gate.id}.log`), output);
    const good = !result.error && result.status === 0 && (!gate.tests || !tapHasUnprovenTests(output));
    report.gates.push({
      id: gate.id,
      command: [gate.program, ...gate.args],
      exitCode: result.status,
      status: good ? 'PASS' : 'FAILED',
    });
    console.log(`${good ? 'PASS' : 'FAILED'} ${gate.id}`);
    return good;
  };
  const head = execute('git', ['rev-parse', '--verify', 'HEAD']);
  if (head.status !== 0)
    report.blockers.push(
      'A complete Git checkout is required; an overlay or test fixture is not acceptance evidence.',
    );
  else report.testedSHA = head.stdout.trim();
  const status = execute('git', ['status', '--porcelain', '--untracked-files=normal']);
  report.sourceDirty = status.status !== 0 || status.stdout.trim().length > 0;
  if (values.ci && report.sourceDirty)
    report.blockers.push('Final-commit acceptance requires a clean checkout.');
  if (Number(process.versions.node.split('.')[0]) !== 24)
    report.blockers.push(`Node 24.x required; actual ${process.version}.`);
  const pnpm = execute('pnpm', ['--version']);
  if (pnpm.status !== 0 || pnpm.stdout.trim() !== '10.32.1')
    report.blockers.push('pnpm 10.32.1 is required.');
  if (!existsSync(path.join(root, 'pnpm-lock.yaml')))
    report.blockers.push(
      'pnpm-lock.yaml is missing. Resolve, install, build and audit with the target tools before committing a real lockfile.',
    );
  const trustedSource = execute('git', ['show', `${values['base-ref']}:scripts/check-design-reference.mjs`]);
  let trustedFile;
  if (trustedSource.status !== 0 || !trustedSource.stdout)
    report.blockers.push('Cannot read the original design guard from the trusted base SHA.');
  else {
    trustedFile = path.join(evidence, 'trusted-design-check.mjs');
    writeFileSync(trustedFile, trustedSource.stdout);
    record({
      id: 'design-before',
      program: 'node',
      args: [trustedFile, '--root', root, '--base-ref', values['base-ref']],
    });
  }
  if (!report.blockers.length && report.gates.every((gate) => gate.status === 'PASS')) {
    for (const gate of gatePlan) {
      const checkedGate =
        gate.id === 'diff-whitespace'
          ? { ...gate, args: ['diff', '--check', values['base-ref'], 'HEAD'] }
          : gate;
      if (
        !record(checkedGate) &&
        (gate.id === 'install-frozen' || gate.id === 'toolchain' || gate.id === 'compile-ownership')
      ) {
        report.blockers.push(`Cannot execute remaining gates after ${gate.id} failed.`);
        break;
      }
    }
  }
  if (trustedFile)
    record({
      id: 'design-after',
      program: 'node',
      args: [trustedFile, '--root', root, '--base-ref', values['base-ref']],
    });
  const finalHead = execute('git', ['rev-parse', '--verify', 'HEAD']);
  if (finalHead.status === 0 && finalHead.stdout.trim() !== report.testedSHA)
    report.blockers.push('HEAD changed during verification; rerun on one source commit.');
  const finalStatus = execute('git', ['status', '--porcelain', '--untracked-files=normal']);
  report.sourceDirty = report.sourceDirty || finalStatus.status !== 0 || finalStatus.stdout.trim().length > 0;
  report.verdict = verdict(report.gates, report.blockers, report.sourceDirty);
  writeFileSync(path.join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        verdict: report.verdict,
        testedSHA: report.testedSHA,
        sourceDirty: report.sourceDirty,
        blockers: report.blockers,
        evidence,
      },
      null,
      2,
    ),
  );
  return report.verdict === 'ACCEPTED' ? 0 : report.verdict === 'FAILED' ? 1 : 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
