/**
 * P03-C5 operator-web evidence runner. Builds the app and runs the operator
 * suites, recording the exact source (HEAD, tree, dirty flag) and each
 * command's result under .acceptance/production-C/operator-web/acceptance.json.
 *
 * The browser suites run against FIXTURE DOUBLES through the gateway harness;
 * they are not evidence of the real services (see
 * docs/production/C/P03-C5-operator-web.md, "Evidence").
 *
 * Usage: node scripts/production/C/operator-web-acceptance.mjs [--skip-visual]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = `${ROOT}.acceptance/production-C/operator-web`;
const skipVisual = process.argv.includes('--skip-visual');
const isWindows = process.platform === 'win32';

const git = (...args) =>
  spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout.trim();

const STEPS = [
  ['typecheck', 'pnpm', ['--filter', '@carwash/operator-web', 'run', 'typecheck']],
  ['build', 'pnpm', ['--filter', '@carwash/operator-web', 'run', 'build']],
  ['runtime', 'pnpm', ['--filter', '@carwash/operator-web', 'run', 'test:runtime']],
  ['design-reference', 'node', ['scripts/check-design-reference.mjs']],
  ['journey', 'node', ['--test', 'tests/production/C/operator-web-journey.test.mjs']],
  ['a11y', 'node', ['--test', 'tests/production/C/operator-web-a11y.test.mjs']],
  ...(skipVisual
    ? []
    : [['visual', 'node', ['--test', 'tests/production/C/operator-web-visual.test.mjs']]]),
];

const counts = (text) => {
  const pick = (name) => Number(new RegExp(`ℹ ${name} (\\d+)`).exec(text)?.[1] ?? NaN);
  return { tests: pick('tests'), pass: pick('pass'), fail: pick('fail'), todo: pick('todo') };
};

const record = {
  schemaVersion: 1,
  label: 'P03-C5 operator-web acceptance (fixture doubles; not service integration)',
  sourceSha: git('rev-parse', 'HEAD'),
  sourceTree: git('rev-parse', 'HEAD^{tree}'),
  sourceDirty: git('status', '--porcelain') !== '',
  node: process.version,
  startedAt: new Date().toISOString(),
  steps: [],
};

let failed = false;
for (const [name, command, args] of STEPS) {
  const started = Date.now();
  const run = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: isWindows,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const step = {
    name,
    command: [command, ...args].join(' '),
    exitCode: run.status,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  if (args.includes('--test') || name === 'runtime') step.counts = counts(output);
  record.steps.push(step);
  console.log(
    `${run.status === 0 ? 'PASS' : 'FAIL'} ${name}${step.counts ? ' ' + JSON.stringify(step.counts) : ''}`,
  );
  if (run.status !== 0) {
    failed = true;
    console.log(output.split('\n').slice(-40).join('\n'));
  }
}
record.finishedAt = new Date().toISOString();
record.accepted = !failed && !record.sourceDirty;
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/acceptance.json`, JSON.stringify(record, null, 2) + '\n');
process.exitCode = failed ? 1 : 0;
