#!/usr/bin/env node
/** Run one P01–P06 test family on disposable infrastructure, with exact-source evidence. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { globSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT,
  createRunContext,
  readContextFile,
  writeContextFile,
} from '../acceptance/lib/context.mjs';
import {
  bootstrapRabbitIdentities,
  composeDown,
  composeUp,
  dockerEnvironment,
  resolveImageDigests,
  waitForPostgresReady,
  waitForRabbitReady,
} from '../acceptance/lib/infra.mjs';
import { redact, run } from '../acceptance/lib/exec.mjs';
import { discoverServiceSpecs } from '../lib/test-discovery.mjs';
import { testResults } from '../lib/test-results.mjs';
import { BUSINESS_SUITES, assertBusinessEvidence, businessSuite } from './acceptance-plan.mjs';
import { retainBrowserDiagnostics } from './acceptance-diagnostics.mjs';

const node = process.execPath;
const directory = (suite) => path.join(ROOT, '.acceptance', 'business', suite);
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const writeJson = (file, value) => writeFile(file, `${redact(JSON.stringify(value, null, 2))}\n`);

async function checked(command, args, options = {}) {
  options.signal?.throwIfAborted();
  const result = await run(command, args, { cwd: ROOT, timeoutMs: 10 * 60_000, ...options });
  if (result.code !== 0 || result.outcome !== 'exited' || result.truncated) {
    const error = new Error(
      `COMMAND_FAILED: ${command} ${args.join(' ')} (${result.outcome}/${result.code})`,
    );
    error.result = result;
    throw error;
  }
  return result;
}

async function git(...args) {
  return (await checked('git', args)).stdout.trim();
}

export async function cleanupSuite(suite) {
  businessSuite(suite);
  const file = path.join(directory(suite), 'owned.json');
  let owned;
  try {
    owned = await json(file);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  assert.equal(owned.suite, suite);
  assert.match(owned.runId, /^business-[a-f0-9]{16}$/);
  if (owned.cleaned) return;
  if (owned.contextFile) {
    const context = await readContextFile(owned.contextFile);
    assert.equal(context.runId, owned.runId);
    assert.equal(context.project, `cw-s02-${owned.runId}`);
    const result = await composeDown(context);
    assert.equal(result.code, 0, `Scoped compose cleanup failed: ${result.stderr}`);
    await rm(context.workDir, { recursive: true, force: true });
  }
  const label = `label=carwash.business-acceptance.run=${owned.runId}`;
  for (const [listArgs, removeArgs] of [
    [
      ['ps', '-aq', '--filter', label],
      ['rm', '-f', '-v'],
    ],
    [
      ['network', 'ls', '-q', '--filter', label],
      ['network', 'rm'],
    ],
  ]) {
    const result = await checked('docker', listArgs, { timeoutMs: 60_000 });
    const ids = result.stdout.trim().split(/\s+/).filter(Boolean);
    if (ids.length) await checked('docker', [...removeArgs, ...ids], { timeoutMs: 120_000 });
  }
  owned.cleaned = true;
  await writeJson(file, owned);
}

async function acceptance(suite) {
  const plan = businessSuite(suite);
  const work = directory(suite);
  const out = path.join(work, 'evidence');
  await mkdir(out, { recursive: true });
  const owned = { suite, runId: `business-${randomBytes(8).toString('hex')}`, cleaned: false };
  const report = {
    schemaVersion: 1,
    suite,
    scope: plan.scope,
    node: process.version,
    source: {
      sha: await git('rev-parse', 'HEAD'),
      tree: await git('rev-parse', 'HEAD^{tree}'),
      dirty: (await git('status', '--porcelain', '--untracked-files=all')) !== '',
    },
    github: {
      runId: process.env.GITHUB_RUN_ID ?? null,
      attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    },
    startedAt: new Date().toISOString(),
    steps: [],
    evidence: [],
    cleanup: 'NOT_RUN',
    accepted: false,
  };
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Acceptance interrupted'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const deadline = setTimeout(cancel, 22 * 60_000);
  deadline.unref();
  const env = { ...process.env, CW_BUSINESS_ACCEPTANCE_RUN: owned.runId };
  let infrastructureUsed = false;
  let failed = false;

  const step = async (name, operation) => {
    controller.signal.throwIfAborted();
    const started = Date.now();
    try {
      const value = await operation();
      report.steps.push({ name, status: 'PASSED', durationMs: Date.now() - started });
      console.log(`[PASS] ${suite}/${name}`);
      return value;
    } catch (error) {
      if (error.result)
        await writeFile(
          path.join(out, `${name}.log`),
          redact(error.result.stdout + error.result.stderr),
        );
      report.steps.push({
        name,
        status: 'FAILED',
        durationMs: Date.now() - started,
        detail: redact(error.message),
      });
      throw error;
    }
  };
  const command = async (name, executable, args, extra = {}) =>
    step(name, async () => {
      const result = await checked(executable, args, { env, signal: controller.signal, ...extra });
      await writeFile(path.join(out, `${name}.log`), redact(result.stdout + result.stderr));
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      return result;
    });
  const tests = async (name, files) => {
    assert.ok(files.length > 0, `Missing test family: ${name}`);
    await step(name, async () => {
      const result = await checked(
        node,
        [
          '--test',
          '--test-reporter=spec',
          '--test-concurrency=1',
          '--test-timeout=240000',
          ...files,
        ],
        {
          env,
          signal: controller.signal,
        },
      );
      await writeFile(path.join(out, `${name}.log`), redact(result.stdout + result.stderr));
      process.stdout.write(result.stdout);
      const counts = testResults(result.stdout, result.code, result.signal);
      assert.equal(
        counts.accepted,
        true,
        `Incomplete test family: ${name}: ${JSON.stringify(counts)}`,
      );
      report.evidence.push({
        name,
        files: files.map((f) => path.relative(ROOT, path.resolve(ROOT, f))),
        counts,
      });
    });
  };
  const childEvidence = async (name, file, check) => {
    const value = await json(file);
    check(value);
    await writeJson(path.join(out, `${name}.json`), value);
    report.evidence.push({ name, file: `${name}.json` });
  };
  const freshReport = (before, pattern) => {
    const added = globSync(pattern, { cwd: ROOT }).filter((file) => !before.has(file));
    assert.equal(added.length, 1, `Expected exactly one fresh report for ${pattern}`);
    return path.join(ROOT, added[0]);
  };
  const sourceMatches = (sha, tree, dirty) => {
    assert.equal(sha, report.source.sha);
    assert.equal(tree, report.source.tree);
    assert.equal(dirty, false);
  };

  try {
    await step('clean-source', async () =>
      assert.equal(
        report.source.dirty,
        false,
        'Commit the candidate before producing exact-source evidence',
      ),
    );
    await command('design-before', node, ['scripts/check-design-reference.mjs']);
    await command('shared-build', 'pnpm', ['build:packages']);
    for (const service of plan.services) {
      for (const task of ['generate', 'build', 'build:tests'])
        await command(`${service}-${task.replace(':', '-')}`, 'pnpm', [
          '--filter',
          `@carwash/${service}`,
          'run',
          task,
        ]);
    }
    if (suite === 'c-p06')
      await command('operator-build', 'pnpm', [
        '--filter',
        '@carwash/operator-web',
        'run',
        'build',
      ]);
    if (plan.lane === 'D')
      await command('api-gateway-build', 'pnpm', [
        '--filter',
        '@carwash/api-gateway',
        'run',
        'build',
      ]);
    if (suite === 'd-admin-browser') {
      await command('admin-web-build', 'pnpm', ['--filter', '@carwash/admin-web', 'run', 'build']);
      await tests('admin-console-offline', [
        'apps/admin-web/test/console.test.mjs',
        'apps/admin-web/test/runtime.test.mjs',
      ]);
    }
    if (plan.services.length && !suite.startsWith('c-'))
      await tests(
        'owner-offline',
        plan.services.flatMap((s) => discoverServiceSpecs(path.join(ROOT, 'services', s))),
      );

    // Written before starting any resources; --cleanup remains usable after cancellation.
    await writeJson(path.join(work, 'owned.json'), owned);
    if (plan.lane === 'A') {
      await tests('provider-contract', [
        'tests/production/A/acceptance-plan.test.mjs',
        'tests/production/A/vehicle.contract.test.mjs',
      ]);
      const pattern = 'docs/production/A/evidence/cw-p01a-*.json';
      const before = new Set(globSync(pattern, { cwd: ROOT }));
      infrastructureUsed = true;
      await command('real-owners', node, [
        'scripts/production/A/acceptance-a.mjs',
        '--services',
        ...(suite === 'a-customer-browser'
          ? ['customer,vehicle', '--customer-browser']
          : ['customer,vehicle,geo']),
      ]);
      await childEvidence('owners', freshReport(before, pattern), (value) => {
        assert.equal(value.result, 'PASSED');
        sourceMatches(value.source.head, value.source.tree, value.source.dirtyTrackedFiles !== 0);
        assert.ok(
          value.suites.length > 0 &&
            value.suites.every(
              (s) =>
                s.tests > 0 &&
                s.pass === s.tests &&
                ['fail', 'skipped', 'todo', 'cancelled'].every((key) => s[key] === 0),
            ),
        );
      });
    } else if (plan.lane === 'B') {
      const service = plan.services[0];
      const extra = {
        catalog: 'catalog-v1-provider',
        pricing: 'pricing-v1-conformance',
        billing: 'finance-matrix',
      }[service];
      if (extra) await tests('provider-contract', [`tests/production/B/${extra}.test.mjs`]);
      const pattern = '.acceptance/cw-*/report.json';
      const before = new Set(globSync(pattern, { cwd: ROOT }));
      infrastructureUsed = true;
      await command(
        'real-persistence',
        node,
        suite === 'b-wallet-broker'
          ? ['scripts/production/B/wallet-broker-acceptance.mjs']
          : ['scripts/production/B/postgres-acceptance.mjs', '--service', service],
      );
      await childEvidence('owner-persistence', freshReport(before, pattern), (value) => {
        assert.equal(value.accepted, true);
        sourceMatches(value.sourceSHA, value.sourceTree, value.sourceDirty);
        const counts = value.tests.summary;
        assert.ok(
          counts.tests > 0 &&
            counts.pass === counts.tests &&
            ['fail', 'skipped', 'todo', 'cancelled'].every((key) => counts[key] === 0),
        );
      });
    } else if (suite === 'c-operator-fixtures') {
      await command('operator-fixture-acceptance', node, [
        'scripts/production/C/operator-web-acceptance.mjs',
      ]);
      await childEvidence(
        'operator-fixtures',
        path.join(ROOT, '.acceptance/production-C/operator-web/acceptance.json'),
        (value) => {
          assert.equal(value.accepted, true);
          sourceMatches(value.sourceSha, value.sourceTree, value.sourceDirty);
          assert.ok(value.steps.filter((s) => s.counts).length > 0);
          assert.ok(value.steps.filter((s) => s.counts).every((s) => s.counts.accepted));
        },
      );
    } else if (plan.lane === 'C') {
      infrastructureUsed = true;
      await command('lane-stack-up', node, ['scripts/production/C/stack.mjs', 'up']);
      if (suite === 'c-p06')
        await tests('technician-real-services', ['tests/production/C/p06c-real-services.test.mjs']);
      else {
        const owner = suite.slice(2);
        await command('owner-verification', node, ['scripts/production/C/verify.mjs', owner]);
        await childEvidence(
          'owner-verification',
          path.join(
            ROOT,
            '.acceptance/production-C/evidence',
            `${owner}-${report.source.sha.slice(0, 12)}.json`,
          ),
          (value) => {
            assert.equal(value.result, 'PASSED');
            sourceMatches(value.head, value.tree, value.dirty);
            for (const name of ['unit', 'postgres', 'lane'])
              assert.equal(value.services[owner][name].accepted, true);
          },
        );
      }
      await command('lane-stack-down', node, ['scripts/production/C/stack.mjs', 'down']);
    } else {
      infrastructureUsed = true;
      const context = await createRunContext({ runId: owned.runId });
      owned.contextFile = await writeContextFile(context);
      await writeJson(path.join(work, 'owned.json'), owned);
      await step('identify-disposable-infrastructure', () => dockerEnvironment(context));
      await step('resolve-images', () => resolveImageDigests(context));
      await writeContextFile(context);
      await step('start-disposable-infrastructure', () => composeUp(context, controller.signal));
      await step('postgres-ready', () => waitForPostgresReady(context));
      await step('rabbitmq-ready', () => waitForRabbitReady(context));
      await step('broker-identities', async () => {
        const result = await bootstrapRabbitIdentities(context);
        assert.equal(result.code, 0, result.stderr);
      });
      env.CW_CONTEXT_FILE = owned.contextFile;
      const file = path.join(out, 'lane-d.json');
      await command('lane-d-real-services', node, [
        'scripts/production/D/run-real-infra.mjs',
        ...(plan.browser ? ['--browser'] : []),
        '--evidence',
        file,
      ]);
      const value = await json(file);
      assert.equal(value.tests.accepted, true);
      sourceMatches(value.sourceSha, value.sourceTree, value.sourceDirty);
      report.evidence.push({
        name: plan.browser ? 'real-admin-browser' : 'real-owner-services',
        file: 'lane-d.json',
      });
    }
    await command('design-after', node, ['scripts/check-design-reference.mjs']);
    await step('source-remained-unchanged', async () => {
      const changed = (await git('diff', '--name-only', 'HEAD')).split('\n').filter(Boolean);
      assert.deepEqual(
        changed.filter(
          (f) => !/^(docs\/production\/[A-E]\/evidence\/|evidence\/acceptance\/)/.test(f),
        ),
        [],
        'Source changed during acceptance',
      );
    });
  } catch (error) {
    failed = true;
    report.error = redact(error.message);
    console.error(report.error);
    if (error.result) console.error(redact(error.result.stdout + error.result.stderr).slice(-8000));
  } finally {
    clearTimeout(deadline);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    try {
      report.diagnostics = await retainBrowserDiagnostics(ROOT, suite, out, report.startedAt);
    } catch (error) {
      failed = true;
      report.diagnosticsError = redact(error.message);
      console.error(report.diagnosticsError);
    }
    try {
      if (infrastructureUsed) await cleanupSuite(suite);
      else {
        owned.cleaned = true;
        await writeJson(path.join(work, 'owned.json'), owned);
      }
      report.cleanup = 'PASSED';
    } catch (error) {
      failed = true;
      report.cleanup = 'FAILED';
      report.cleanupError = redact(error.message);
      console.error(report.cleanupError);
    }
    report.finishedAt = new Date().toISOString();
    report.accepted = !failed && !controller.signal.aborted && report.evidence.length > 0;
    await writeJson(path.join(out, 'summary.json'), report);
  }
  console.log(`${report.accepted ? 'PASSED' : 'FAILED'} ${suite}: ${path.relative(ROOT, out)}`);
  process.exitCode = report.accepted ? 0 : 1;
}

async function main() {
  const [mode, arg, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0, 'Unexpected arguments');
  if (mode === '--list') console.log(JSON.stringify(BUSINESS_SUITES, null, 2));
  else if (mode === '--suite') await acceptance(arg);
  else if (mode === '--cleanup') await cleanupSuite(arg);
  else if (mode === '--aggregate') {
    const files = globSync('**/summary.json', { cwd: path.resolve(arg) });
    const reports = await Promise.all(files.map((file) => json(path.resolve(arg, file))));
    assertBusinessEvidence(reports, {
      sha: await git('rev-parse', 'HEAD'),
      tree: await git('rev-parse', 'HEAD^{tree}'),
      runId: process.env.GITHUB_RUN_ID ?? null,
      attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    });
    console.log(
      `Accepted ${reports.length} current-source business test families. Their declared scopes remain in each report; this is not a production release approval.`,
    );
  } else
    throw new Error(
      'usage: acceptance.mjs --suite <id> | --cleanup <id> | --aggregate <artifact-directory> | --list',
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(redact(error.stack ?? error.message));
    process.exitCode = 1;
  });
