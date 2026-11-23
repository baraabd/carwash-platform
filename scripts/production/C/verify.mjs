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
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANE_SERVICES, readContext } from './stack.mjs';
import { run as execute } from '../../acceptance/lib/exec.mjs';
import { discoverServiceSpecs } from '../../lib/test-discovery.mjs';
import { testResults } from '../../lib/test-results.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const allowDirty = args.includes('--allow-dirty');
const services = args.filter((a) => !a.startsWith('--'));
if (services.length === 0) throw new Error('usage: verify.mjs <service...> [--allow-dirty]');
if (new Set(services).size !== services.length || services.some((s) => !LANE_SERVICES.includes(s)))
  throw new Error('INVALID_LANE_C_SERVICES');
if (args.some((a) => a.startsWith('--') && a !== '--allow-dirty'))
  throw new Error('UNKNOWN_VERIFY_OPTION');

async function run(command, argv, { cwd = ROOT, env = {} } = {}) {
  const result = await execute(command, argv, {
    cwd,
    env: { ...process.env, ...env },
    timeoutMs: 10 * 60_000,
  });
  return { ...result, output: result.stdout + result.stderr, ms: result.durationMs };
}

async function git(...argv) {
  const result = await run('git', argv);
  if (result.code !== 0 || result.outcome !== 'exited') throw new Error('SOURCE_PROVENANCE_FAILED');
  return result.stdout.trim();
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
    const counts = argv.includes('--test')
      ? testResults(result.stdout, result.code, result.signal)
      : null;
    const pass =
      result.code === 0 &&
      result.outcome === 'exited' &&
      !result.truncated &&
      (!counts || counts.accepted);
    families[name] = {
      status: pass ? 'PASSED' : 'FAILED',
      exitCode: result.code,
      ms: result.ms,
      ...(counts ?? {}),
    };
    if (!pass) {
      failed = true;
      console.error(`--- ${service}/${name} output (tail) ---\n${result.output.slice(-3000)}`);
    }
    console.log(
      `${service.padEnd(11)} ${name.padEnd(9)} ${families[name].status} ${counts ? `${counts.pass}/${counts.tests}` : ''} (${result.ms} ms)`,
    );
    return pass;
  };
  if (
    !(await step('generate', node, [prisma, 'generate'], { cwd: dir })) ||
    !(await step('build', node, [tsc, '-p', 'tsconfig.build.json'], { cwd: dir })) ||
    !(await step('buildTests', node, [tsc, '-p', 'tsconfig.json'], { cwd: dir }))
  ) {
    record.services[service] = families;
    continue;
  }
  let unit;
  let integration;
  try {
    unit = discoverServiceSpecs(dir);
    integration = discoverServiceSpecs(dir, { kind: 'integration' });
  } catch (error) {
    families.discovery = { status: 'FAILED', detail: error.message };
    failed = true;
    record.services[service] = families;
    continue;
  }
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
    await step(
      name,
      node,
      ['--test', '--test-reporter=spec', '--test-concurrency=1', '--test-timeout=240000', ...files],
      { env },
    );
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
