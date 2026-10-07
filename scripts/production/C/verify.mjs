#!/usr/bin/env node
/**
 * Lane C verification runner: executes every required test family for the
 * named services against the lane stack and records exact-source evidence.
 *
 *   node scripts/production/C/stack.mjs up
 *   node scripts/production/C/verify.mjs scheduling [--allow-dirty]
 *
 * Evidence is bound to `git rev-parse HEAD` and its tree. A dirty working tree
 * is refused unless --allow-dirty is given, in which case the record says so
 * and must not be quoted as exact-source evidence.
 *
 * Families per service (each must PASS; a missing suite is a FAILURE):
 *   generate  prisma client generation
 *   build     tsc release build (dist/)
 *   unit      domain/application/adapter unit tests
 *   postgres  real PostgreSQL integration + HTTP edge tests (runtime role)
 *   lane      tests/production/C/<service>-*.test.mjs (process restart, broker, S3 ...)
 */
import { spawn } from 'node:child_process';
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readContext } from './stack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const allowDirty = args.includes('--allow-dirty');
const services = args.filter((a) => !a.startsWith('--'));
if (services.length === 0) throw new Error('usage: verify.mjs <service...> [--allow-dirty]');

function run(command, argv, { cwd = ROOT, env = {} } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, argv, { cwd, env: { ...process.env, ...env }, windowsHide: true });
    let output = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    child.on('close', (code) => resolve({ code, output, ms: Date.now() - started }));
  });
}

function summarise(output) {
  const pick = (name) => Number(output.match(new RegExp(`ℹ ${name} (\\d+)`))?.[1] ?? 0);
  return { tests: pick('tests'), pass: pick('pass'), fail: pick('fail') };
}

async function git(...argv) {
  const { output } = await run('git', argv);
  return output.trim();
}

const head = await git('rev-parse', 'HEAD');
const tree = await git('rev-parse', 'HEAD^{tree}');
const dirty = (await git('status', '--porcelain', '--untracked-files=all')).length > 0;
if (dirty && !allowDirty) {
  console.error('Working tree is dirty; commit first or pass --allow-dirty (non-evidence run).');
  process.exit(2);
}
const context = await readContext();
const env = { CW_PROD_C_CONTEXT: path.join(context.workDir, 'context.json') };
const node = process.execPath;
const record = {
  head,
  tree,
  dirty,
  startedAt: new Date().toISOString(),
  stack: { runId: context.runId, images: context.images },
  services: {},
};

let failed = false;
for (const service of services) {
  const dir = path.join(ROOT, 'services', service);
  const tsc = path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc');
  const prisma = path.join(dir, 'node_modules', 'prisma', 'build', 'index.js');
  const families = {};
  const step = async (name, command, argv, options) => {
    const result = await run(command, argv, options);
    const counts = summarise(result.output);
    const pass = result.code === 0;
    families[name] = {
      status: pass ? 'PASSED' : 'FAILED',
      exitCode: result.code,
      ms: result.ms,
      ...counts,
    };
    if (!pass) {
      failed = true;
      console.error(`--- ${service}/${name} output (tail) ---\n${result.output.slice(-3000)}`);
    }
    console.log(
      `${service.padEnd(11)} ${name.padEnd(9)} ${families[name].status} ${counts.tests ? `${counts.pass}/${counts.tests}` : ''} (${result.ms} ms)`,
    );
    return pass;
  };
  await step('generate', node, [prisma, 'generate'], { cwd: dir });
  await step('build', node, [tsc, '-p', 'tsconfig.build.json'], { cwd: dir });
  await step('buildTests', node, [tsc, '-p', 'tsconfig.json'], { cwd: dir });
  const tests = async (sub) =>
    (await readdir(path.join(dir, 'dist-tests', 'test', sub)).catch(() => []))
      .filter((f) => f.endsWith('.spec.js'))
      .map((f) => path.join(dir, 'dist-tests', 'test', sub, f));
  const unit = await tests('unit');
  const integration = (await tests('integration')).filter((f) => f.endsWith('.pg.spec.js'));
  const lane = (await readdir(path.join(ROOT, 'tests', 'production', 'C')))
    .filter((f) => f.startsWith(`${service}-`) && f.endsWith('.test.mjs'))
    .map((f) => path.join(ROOT, 'tests', 'production', 'C', f));
  for (const [name, files] of [
    ['unit', unit],
    ['postgres', integration],
    ['lane', lane],
  ]) {
    if (files.length === 0) {
      families[name] = { status: 'MISSING' };
      failed = true;
      console.log(`${service.padEnd(11)} ${name.padEnd(9)} MISSING`);
      continue;
    }
    await step(name, node, ['--test', '--test-concurrency=1', ...files], { env });
  }
  record.services[service] = families;
}
record.finishedAt = new Date().toISOString();
record.result = failed ? 'FAILED' : 'PASSED';
const out = path.join(ROOT, '.acceptance', 'production-C', 'evidence');
await mkdir(out, { recursive: true });
const file = path.join(
  out,
  `${services.join('+')}-${head.slice(0, 12)}${dirty ? '-dirty' : ''}.json`,
);
await writeFile(file, JSON.stringify(record, null, 2));
console.log(
  `\n${record.result} head=${head} tree=${tree}${dirty ? ' (DIRTY - not evidence)' : ''}\nrecord: ${path.relative(ROOT, file)}`,
);
process.exit(failed ? 1 : 0);
