#!/usr/bin/env node
/**
 * Lane D real-infrastructure gate.
 *
 * Runs against an ALREADY provisioned acceptance stack (a real PostgreSQL and a
 * real RabbitMQ). It provisions nothing and tears nothing down:
 *
 *   node scripts/dev/acceptance-infra.mjs up
 *   pnpm generate && pnpm build            # dist/ is what the suites load
 *   node scripts/production/D/run-real-infra.mjs [--suite <file-prefix>] [--evidence <file>]
 *
 * Steps, each of which fails the gate on its own:
 *   1. apply every committed migration of the involved services with the
 *      MIGRATION identity (never the runtime identity),
 *   2. harden runtime privileges exactly as the acceptance runner does,
 *   3. prove replaying the migrations yields schema.prisma (no drift),
 *   4. run the selected node:test suites serially (they share one cluster).
 *
 * Scope: one real PostgreSQL server and one single-node broker for this run.
 * It is not a high-availability, browser, provider or production proof.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapSharedTopology } from '../../acceptance/lib/broker.mjs';
import { readContextFile } from '../../acceptance/lib/context.mjs';
import {
  createShadowDatabase,
  dropShadowDatabase,
  hardenPrivileges,
  migrateDeploy,
  migrationDrift,
} from '../../acceptance/lib/migrations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Every Lane D real-infrastructure suite is a file in tests/production/D.
 * Discovery (rather than a list) keeps this runner byte-identical across the
 * independent child branches, so they merge in any order without conflict.
 */
const SUITE_DIR = 'tests/production/D';

async function discoverSuites(filter) {
  const files = (await readdir(path.join(ROOT, SUITE_DIR)))
    .filter((name) => name.endsWith('.test.mjs') && (!filter || name.startsWith(filter)))
    .sort();
  return files.map((name) => `${SUITE_DIR}/${name}`);
}

/** The probe producer (catalog) is migrated because the broker suites drive it. */
const SERVICES = ['catalog', 'communications', 'reporting', 'configuration'];

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function contextFile() {
  if (process.env.CW_CONTEXT_FILE) return process.env.CW_CONTEXT_FILE;
  const pointer = path.join(ROOT, '.acceptance', 'current-dev-stack.json');
  const { contextFile: file } = JSON.parse(await readFile(pointer, 'utf8'));
  return file;
}

function must(result, step) {
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || '').slice(-2000);
    throw new Error(`${step} failed (exit ${result.code})\n${detail}`);
  }
}

async function prepareDatabases(context) {
  const steps = [];
  for (const service of SERVICES) {
    must(await migrateDeploy(context, service), `${service} migrate deploy`);
    must(await hardenPrivileges(context, service), `${service} privilege hardening`);
    const shadowName = `cw_shadow_d_${service}`;
    const shadowUrl = await createShadowDatabase(context, shadowName);
    try {
      must(await migrationDrift(context, service, { shadowUrl }), `${service} migration drift`);
    } finally {
      await dropShadowDatabase(context, shadowName);
    }
    steps.push({ service, migrateDeploy: 'PASSED', hardenPrivileges: 'PASSED', drift: 'NONE' });
  }
  return steps;
}

function runSuites(suites, env) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(
      process.execPath,
      [
        '--test',
        '--test-concurrency=1',
        '--test-timeout=240000',
        '--test-reporter=spec',
        ...suites,
      ],
      { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.on('close', (code, signal) => resolve({ code, signal, output }));
  });
}

async function main() {
  const file = await contextFile();
  // The context records the worktree that CREATED the stack. Migrations must
  // come from the tree under test, or a reused stack would be migrated from a
  // different checkout than the code the suites load.
  const context = { ...(await readContextFile(file)), root: ROOT };
  const suites = await discoverSuites(option('suite'));
  if (suites.length === 0) throw new Error('NO_SUITES_SELECTED');

  console.log(`Lane D real-infra gate: run ${context.runId}, suites ${suites.length}.`);
  const migrations = await prepareDatabases(context);
  // Shared exchange, declared by the infrastructure identity exactly as the
  // acceptance runner does before any producer or subscriber connects.
  await bootstrapSharedTopology(context);
  const result = await runSuites(suites, { ...process.env, CW_CONTEXT_FILE: file });
  const summary = (name) =>
    Number(new RegExp(`^ℹ ${name} (\\d+)`, 'm').exec(result.output)?.[1] ?? NaN);

  const evidence = {
    gate: 'lane-d-real-infra',
    runId: context.runId,
    images: context.images,
    suites,
    suiteSha256: Object.fromEntries(
      await Promise.all(
        suites.map(async (suite) => [
          suite,
          createHash('sha256')
            .update(await readFile(path.join(ROOT, suite)))
            .digest('hex'),
        ]),
      ),
    ),
    migrations,
    tests: { pass: summary('pass'), fail: summary('fail'), skipped: summary('skipped') },
    exitCode: result.code,
    scope:
      'Real PostgreSQL 16 and single-node RabbitMQ 4 for one ephemeral run. Not HA, not a ' +
      'provider, browser or production proof.',
  };
  const out = option('evidence');
  if (out) await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence.tests));
  process.exit(result.signal ? 1 : (result.code ?? 1));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
