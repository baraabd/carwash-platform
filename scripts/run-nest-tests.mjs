#!/usr/bin/env node
/**
 * Compiles and runs the NestJS framework tests for every service.
 *
 * It fails when a service has NO compiled spec. A recursive command that quietly
 * skips a package because its script or its output is missing looks identical to
 * a pass, and that is exactly how an untested service slips through.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, SERVICES } from './acceptance/lib/context.mjs';
import { run } from './acceptance/lib/exec.mjs';

async function specsFor(service) {
  const dir = path.join(ROOT, 'services', service, 'dist-tests', 'test');
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith('.spec.js')).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

const skipBuild = process.argv.includes('--no-build');

if (!skipBuild) {
  const build = await run(
    'pnpm',
    ['--filter', './services/*', '--sequential', 'run', 'build:tests'],
    {
      cwd: ROOT,
      timeoutMs: 30 * 60 * 1000,
    },
  );
  process.stdout.write(build.stdout);
  if (build.code !== 0) {
    process.stderr.write(build.stderr);
    process.stderr.write('\nNEST_TEST_BUILD_FAILED\n');
    process.exit(1);
  }
}

const files = [];
const missing = [];
for (const service of SERVICES) {
  const found = await specsFor(service);
  if (found.length === 0) missing.push(service);
  files.push(...found);
}

if (missing.length > 0) {
  process.stderr.write(
    `NEST_TESTS_MISSING for: ${missing.join(', ')}\n` +
      'Every service must have at least one compiled Nest spec. A silently skipped\n' +
      'service is not a passing service.\n',
  );
  process.exit(1);
}

for (const file of files) {
  // Guard against a stale or empty artifact being counted as a test run.
  const info = await stat(file);
  if (info.size === 0) {
    process.stderr.write(`EMPTY_SPEC_ARTIFACT: ${file}\n`);
    process.exit(1);
  }
}

const result = await run(process.execPath, ['--test', '--test-reporter=spec', ...files], {
  cwd: ROOT,
  timeoutMs: 20 * 60 * 1000,
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.code ?? 1);
