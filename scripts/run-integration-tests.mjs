#!/usr/bin/env node
/**
 * Runs the real-infrastructure integration suites against an acceptance stack
 * that is ALREADY provisioned.
 *
 * It provisions nothing and tears nothing down. Either `scripts/acceptance.mjs
 * --run` drives it as one phase of a full run, or a developer points it at a
 * stack started with `scripts/dev/acceptance-infra.mjs up`.
 *
 * The suites are run with a concurrency of one on purpose: they share a single
 * PostgreSQL instance and a single broker, and several of them reset the slice
 * between assertions. Running them in parallel would not be a faster suite, it
 * would be a suite that reports races in the fixture as failures in the code.
 */
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every suite that needs a real PostgreSQL and a real RabbitMQ. */
export const INTEGRATION_SUITES = [
  'tests/integration/migrations.test.mjs',
  'tests/integration/postgres-isolation.test.mjs',
  'tests/integration/rabbitmq-acl.test.mjs',
  'tests/integration/messaging-delivery.test.mjs',
  'tests/integration/outbox-inbox.test.mjs',
];

/**
 * Artifacts the suites load directly. Without them node:test reports an import
 * error per file, which reads like a broken test rather than a missing build.
 */
const REQUIRED_BUILD_ARTIFACTS = [
  'packages/platform-messaging/dist/index.js',
  'services/catalog/dist/probe/probe.service.js',
  'services/catalog/dist/outbox/relay.runner.js',
  'services/communications/dist/inbox/consumer.runner.js',
  'services/reporting/dist/inbox/consumer.runner.js',
];

async function assertPrerequisites() {
  const contextFile = process.env.CW_CONTEXT_FILE;
  if (!contextFile) {
    throw new Error(
      'CW_CONTEXT_FILE is required.\n' +
        'Start a stack first:  node scripts/dev/acceptance-infra.mjs up\n' +
        'or run the full gate:  pnpm acceptance:run',
    );
  }
  try {
    await access(contextFile);
  } catch {
    throw new Error(`CW_CONTEXT_FILE points at a file that does not exist: ${contextFile}`);
  }

  // Fail with the actual remedy rather than five identical import stacks.
  const missing = [];
  for (const artifact of REQUIRED_BUILD_ARTIFACTS) {
    try {
      await access(path.join(ROOT, artifact));
    } catch {
      missing.push(artifact);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Build artifacts missing:\n  ${missing.join('\n  ')}\n` + 'Run: pnpm generate && pnpm build',
    );
  }

  const context = JSON.parse(await readFile(contextFile, 'utf8'));
  return context;
}

export function runIntegrationTests({ suites = INTEGRATION_SUITES, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--test',
        '--test-concurrency=1',
        '--test-timeout=180000',
        '--test-reporter=spec',
        ...suites,
      ],
      { cwd: ROOT, env, stdio: 'inherit', windowsHide: true },
    );
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
}

async function main() {
  const context = await assertPrerequisites();
  console.log(
    `Running ${INTEGRATION_SUITES.length} real-infrastructure suites against run ${context.runId} ` +
      `(postgres 127.0.0.1:${context.ports.postgres}, rabbitmq 127.0.0.1:${context.ports.rabbitmq}).`,
  );

  const { code, signal } = await runIntegrationTests();

  console.log(
    '\nScope: a real PostgreSQL server and a real single-node RabbitMQ broker provisioned for\n' +
      'this run. A single-node broker is NOT a high-availability deployment, and none of these\n' +
      'suites test browser behaviour, payments or production readiness.',
  );
  if (signal) {
    console.error(`Integration suites terminated by signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
