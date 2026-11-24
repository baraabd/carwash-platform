#!/usr/bin/env node
/**
 * Compiles and runs the NestJS framework tests for every service.
 *
 * It fails when a service has NO compiled spec. A recursive command that quietly
 * skips a package because its script or its output is missing looks identical to
 * a pass, and that is exactly how an untested service slips through.
 */
import path from 'node:path';
import { ROOT, SERVICES } from './acceptance/lib/context.mjs';
import { run } from './acceptance/lib/exec.mjs';
import { discoverServiceSpecs } from './lib/test-discovery.mjs';
import { testResults } from './lib/test-results.mjs';

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

const files = SERVICES.flatMap((service) =>
  discoverServiceSpecs(path.join(ROOT, 'services', service)),
);

const result = await run(process.execPath, ['--test', '--test-reporter=spec', ...files], {
  cwd: ROOT,
  timeoutMs: 20 * 60 * 1000,
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
const summary = testResults(result.stdout, result.code, result.signal);
if (!summary.accepted) process.stderr.write(`NEST_TESTS_INCOMPLETE: ${JSON.stringify(summary)}\n`);
process.exit(summary.accepted && result.outcome === 'exited' ? 0 : 1);
