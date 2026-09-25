#!/usr/bin/env node
/**
 * Sprint 0.2 acceptance runner.
 *
 * Provisions an ephemeral, per-run PostgreSQL + RabbitMQ stack, applies each
 * service's migrations with its OWN migration identity, hardens the runtime
 * privileges, declares the shared broker topology, runs the real-infrastructure
 * suites against it, writes evidence, and tears the stack down again.
 *
 * Safety properties, all inherited from scripts/acceptance/lib:
 *   - every container, volume and network is scoped to a per-run compose project,
 *     so teardown can never touch anything this run did not create,
 *   - credentials are generated per run, written only to the git-ignored
 *     .acceptance/ directory, and redacted from everything that is persisted,
 *   - teardown runs even when a phase fails, and a failed teardown is reported
 *     as a failure rather than swallowed,
 *   - no phase is allowed to report PASS because it was skipped. A phase that
 *     does not run is recorded as SKIPPED and fails the gate.
 *
 * Usage:
 *   node scripts/acceptance.mjs --preflight     read-only environment check
 *   node scripts/acceptance.mjs --run           full acceptance run
 *     --keep            leave the stack running for debugging
 *     --run-id <id>     use a specific run id
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT,
  IMAGES,
  SERVICES,
  createRunContext,
  childEnv,
  writeContextFile,
} from './acceptance/lib/context.mjs';
import { killTree, redact } from './acceptance/lib/exec.mjs';
import {
  bootstrapRabbitIdentities,
  composeDown,
  composeLogs,
  composePs,
  composeUp,
  dockerEnvironment,
  resolveImageDigests,
  waitForPostgresReady,
  waitForRabbitReady,
} from './acceptance/lib/infra.mjs';
import {
  hardenPrivileges,
  migrateDeploy,
  stampServiceMarker,
} from './acceptance/lib/migrations.mjs';
import { bootstrapSharedTopology } from './acceptance/lib/broker.mjs';
import { INTEGRATION_SUITES } from './run-integration-tests.mjs';

const SCHEMA_REV = 1;

/* ------------------------------- reporting ------------------------------- */

class Report {
  #phases = [];
  #started = Date.now();

  /** A phase is PASS only if it actually ran and actually succeeded. */
  record(name, status, detail = {}) {
    const entry = { name, status, ...detail };
    this.#phases.push(entry);
    const mark = { PASS: 'PASS', FAIL: 'FAIL', SKIPPED: 'SKIP' }[status] ?? status;
    console.log(`[${mark}] ${name}${detail.note ? ` - ${detail.note}` : ''}`);
    return entry;
  }

  get phases() {
    return this.#phases;
  }

  get failed() {
    return this.#phases.filter((p) => p.status !== 'PASS');
  }

  summary(context, extra = {}) {
    return {
      runId: context?.runId ?? null,
      startedAt: context?.startedAt ?? null,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - this.#started,
      // The gate is green only when every phase is PASS. A SKIPPED phase is a
      // hole in the evidence, so it is never counted as success.
      accepted: this.#phases.length > 0 && this.#phases.every((p) => p.status === 'PASS'),
      phases: this.#phases,
      ...extra,
    };
  }
}

/** Run a phase, recording FAIL (not an exception) so later phases still report. */
async function phase(report, name, fn) {
  try {
    const detail = (await fn()) ?? {};
    report.record(name, 'PASS', detail);
    return { ok: true, detail };
  } catch (error) {
    const detail = {
      note: error.message,
      stdout: redact(error.result?.stdout ?? ''),
      stderr: redact(error.result?.stderr ?? ''),
    };
    report.record(name, 'FAIL', detail);
    return { ok: false, error };
  }
}

/* ------------------------------- preflight ------------------------------- */

function checkToolchain() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major !== 24) {
    throw new Error(
      `Node 24 is required by package.json engines; this process is ${process.version}.`,
    );
  }
  return { note: `node ${process.version}` };
}

async function preflight() {
  const report = new Report();
  let context;

  await phase(report, 'toolchain: Node 24', async () => checkToolchain());

  const created = await phase(report, 'context: per-run identity and free ports', async () => {
    context = await createRunContext();
    return { note: `run ${context.runId}, project ${context.project}` };
  });
  if (!created.ok) return finish(report, context, { mode: 'preflight' });

  const docker = await phase(report, 'docker: daemon reachable', async () => {
    const environment = await dockerEnvironment(context);
    return {
      note: `context=${environment.context} server=${environment.daemon.serverVersion} compose=${environment.composeVersion}`,
      environment,
    };
  });

  if (docker.ok) {
    await phase(report, 'docker: pinned images resolve to digests', async () => {
      const digests = await resolveImageDigests(context);
      return {
        note: Object.entries(digests)
          .map(([key, value]) => `${key}=${value.repoDigests?.[0] ?? value.imageId}`)
          .join(' '),
        digests,
      };
    });
  }

  console.log('\nPreflight only: no container was started and no database was written.');
  return finish(report, context, { mode: 'preflight' });
}

/* ---------------------------------- run ---------------------------------- */

async function acceptanceRun({ keep = false, runId } = {}) {
  const report = new Report();
  let context;
  let provisioned = false;

  await phase(report, 'toolchain: Node 24', async () => checkToolchain());

  const created = await phase(report, 'context: per-run identity and free ports', async () => {
    context = await createRunContext({ runId });
    return { note: `run ${context.runId}, project ${context.project}` };
  });
  if (!created.ok) return finish(report, context, { mode: 'run' });

  let environment;
  let digests;

  try {
    const docker = await phase(report, 'docker: daemon reachable', async () => {
      environment = await dockerEnvironment(context);
      return {
        note: `context=${environment.context} server=${environment.daemon.serverVersion}`,
        environment,
      };
    });
    if (!docker.ok) return finish(report, context, { mode: 'run', environment });

    const pulled = await phase(report, 'docker: pinned images resolve to digests', async () => {
      digests = await resolveImageDigests(context);
      return {
        note: Object.entries(digests)
          .map(([key, value]) => `${key}=${value.repoDigests?.[0] ?? value.imageId}`)
          .join(' '),
        digests,
      };
    });
    if (!pulled.ok) return finish(report, context, { mode: 'run', environment });

    const up = await phase(report, 'infra: compose up (ephemeral, loopback only)', async () => {
      await composeUp(context);
      provisioned = true;
      await waitForPostgresReady(context);
      await waitForRabbitReady(context);
      return { note: `postgres :${context.ports.postgres}, rabbitmq :${context.ports.rabbitmq}` };
    });
    if (!up.ok) return finish(report, context, { mode: 'run', environment, digests, provisioned });

    const identities = await phase(report, 'rabbitmq: least-privilege identities', async () => {
      const result = await bootstrapRabbitIdentities(context);
      if (result.code !== 0) {
        const error = new Error('RABBITMQ_BOOTSTRAP_FAILED');
        error.result = result;
        throw error;
      }
      return { note: `vhost ${context.vhost}, ${context.brokerServices.length} broker identities` };
    });

    // Migrations: a separate job per service, run by the migration identity.
    const migrated = await phase(
      report,
      'postgres: migrate as the migration identity',
      async () => {
        const applied = [];
        for (const service of SERVICES) {
          const deploy = await migrateDeploy(context, service);
          if (deploy.code !== 0) {
            const error = new Error(`MIGRATE_FAILED: ${service}`);
            error.result = deploy;
            throw error;
          }
          const marker = await stampServiceMarker(context, service, SCHEMA_REV);
          if (marker.code !== 0) {
            const error = new Error(`MARKER_FAILED: ${service}`);
            error.result = marker;
            throw error;
          }
          applied.push(service);
        }
        return { note: `${applied.length} services migrated`, services: applied };
      },
    );

    if (migrated.ok) {
      await phase(report, 'postgres: harden runtime privileges', async () => {
        for (const service of SERVICES) {
          const hardened = await hardenPrivileges(context, service);
          if (hardened.code !== 0) {
            const error = new Error(`HARDEN_FAILED: ${service}`);
            error.result = hardened;
            throw error;
          }
        }
        return { note: 'app roles stripped of DDL and of _prisma_migrations' };
      });
    }

    if (identities.ok) {
      await phase(report, 'rabbitmq: shared topology declared by infra identity', async () => {
        await bootstrapSharedTopology(context);
        return { note: 'durable exchanges asserted' };
      });
    }

    await phase(report, 'context: write run context for the test processes', async () => {
      const file = await writeContextFile(context);
      return { note: path.relative(ROOT, file) };
    });

    // The suites only mean anything if every prerequisite phase passed.
    if (report.failed.length > 0) {
      report.record('integration: real PostgreSQL and RabbitMQ suites', 'SKIPPED', {
        note: 'prerequisite phase failed; suites not run, and a skip is not a pass',
      });
    } else {
      await phase(report, 'integration: real PostgreSQL and RabbitMQ suites', async () => {
        const result = await runStreamingTest(INTEGRATION_SUITES, {
          cwd: ROOT,
          env: childEnv(context, { CW_CONTEXT_FILE: path.join(context.workDir, 'context.json') }),
          timeoutMs: 30 * 60 * 1000,
          tapFile: path.join(context.evidenceDir, 'integration.tap'),
        });
        const counts = parseTap(result.stdout);
        process.stdout.write(summariseTap(result.stdout));
        if (result.code !== 0 || result.outcome !== 'exited') {
          const error = new Error(
            `INTEGRATION_SUITES_FAILED: ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped`,
          );
          error.result = result;
          throw error;
        }
        if (counts.skip > 0) {
          const error = new Error(`INTEGRATION_SUITES_SKIPPED: ${counts.skip} skipped`);
          error.result = result;
          throw error;
        }
        return { note: `${counts.pass} passed, 0 failed, 0 skipped`, counts };
      });
    }

    await captureLogs(context, report);

    return finish(report, context, {
      mode: 'run',
      environment,
      digests,
      provisioned,
      keep,
    });
  } finally {
    if (provisioned && !keep) {
      const down = await composeDown(context);
      if (down.code !== 0) {
        // A stack left behind is a real problem, not a cosmetic one.
        report.record('infra: teardown', 'FAIL', {
          note: 'compose down failed; the ephemeral stack may still be running',
          stderr: redact(down.stderr),
        });
      } else {
        report.record('infra: teardown', 'PASS', { note: `project ${context.project} removed` });
      }
    } else if (provisioned && keep) {
      report.record('infra: teardown', 'SKIPPED', {
        note: `--keep was passed; tear down with: docker compose -p ${context.project} -f infra/compose.acceptance.yml --env-file ${context.envFile} down -v`,
      });
    }
  }
}

/* -------------------------------- helpers -------------------------------- */

/**
 * Run the suites with their output STREAMED, not buffered.
 *
 * The buffered helper in lib/exec.mjs is right for short commands, but the
 * integration suites take minutes and spawn workers. Buffering them makes a hung
 * suite look exactly like a slow one until the timeout fires, which is the least
 * useful moment to find out. Streaming to both the console and the evidence file
 * means progress is visible live and the partial TAP survives a timeout.
 */
function runStreamingTest(suites, { cwd, env, timeoutMs, tapFile }) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', '--test-timeout=180000', '--test-reporter=tap', ...suites],
      { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const sink = createWriteStream(tapFile, { encoding: 'utf8' });
    let tap = '';
    let stderr = '';
    let outcome = 'exited';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      tap += chunk;
      sink.write(chunk);
      // TAP is noisy; surface only the lines a reader acts on.
      for (const line of chunk.split('\n')) {
        if (/^(not ok |ok \d|# (tests|pass|fail|skipped)|Bail out!)/.test(line)) {
          process.stdout.write(`    ${line}\n`);
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      outcome = 'timeout';
      killTree(child);
    }, timeoutMs);
    timer.unref?.();

    child.on('close', (code) => {
      clearTimeout(timer);
      sink.end();
      resolve({ code, outcome, stdout: redact(tap), stderr: redact(stderr) });
    });
  });
}

function parseTap(tap) {
  const number = (label) => {
    const match = tap.match(new RegExp(`^# ${label} (\\d+)$`, 'm'));
    return match ? Number(match[1]) : 0;
  };
  return {
    tests: number('tests'),
    pass: number('pass'),
    fail: number('fail'),
    skip: number('skipped'),
  };
}

function summariseTap(tap) {
  const failures = tap
    .split('\n')
    .filter((line) => /^not ok /.test(line))
    .slice(0, 40);
  const counts = parseTap(tap);
  return (
    `\nintegration: ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped ` +
    `(of ${counts.tests})\n` +
    (failures.length > 0 ? `${failures.join('\n')}\n` : '')
  );
}

async function captureLogs(context, report) {
  await phase(report, 'evidence: capture infrastructure logs', async () => {
    await mkdir(context.logsDir, { recursive: true });
    for (const service of ['postgres', 'rabbitmq']) {
      const logs = await composeLogs(context, service);
      await writeFile(
        path.join(context.logsDir, `${service}.log`),
        redact(`${logs.stdout}\n${logs.stderr}`),
        'utf8',
      );
    }
    const ps = await composePs(context);
    await writeFile(path.join(context.logsDir, 'compose-ps.json'), redact(ps.stdout), 'utf8');
    return { note: path.relative(ROOT, context.logsDir) };
  });
}

async function finish(report, context, extra) {
  const summary = report.summary(context, {
    ...extra,
    toolchain: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
    },
    images: IMAGES,
    // Stated explicitly so a reader never has to infer scope from a green tick.
    scope: {
      proves: [
        'per-service PostgreSQL role isolation on a real server',
        'migrations applied by a separate identity, replicas cannot migrate',
        'RabbitMQ ACL denial, fan-out and competing consumers on a real broker',
        'outbox/inbox behaviour across a real commit/publish/ack boundary',
      ],
      doesNotProve: [
        'high availability: the acceptance broker is a single node',
        'exactly-once delivery: the model is at-least-once plus idempotent consumption',
        'browser, mobile, payment or production readiness',
      ],
    },
  });

  if (context) {
    await mkdir(context.evidenceDir, { recursive: true });
    const file = path.join(context.evidenceDir, 'acceptance-report.json');
    await writeFile(file, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`\nEvidence: ${path.relative(ROOT, file)}`);
  }

  console.log(
    `\n${summary.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}: ` +
      `${summary.phases.filter((p) => p.status === 'PASS').length}/${summary.phases.length} phases passed.`,
  );
  if (!summary.accepted) {
    for (const failure of report.failed) {
      console.error(`  ${failure.status}: ${failure.name} - ${failure.note ?? ''}`);
    }
  }
  return summary;
}

/* ---------------------------------- cli ---------------------------------- */

async function main() {
  const argv = process.argv.slice(2);
  const allowed = new Set(['--preflight', '--run', '--keep', '--run-id']);
  for (let i = 0; i < argv.length; i += 1) {
    if (!allowed.has(argv[i])) throw new Error(`Unknown argument: ${argv[i]}`);
    if (argv[i] === '--run-id') i += 1;
  }

  const runIdIndex = argv.indexOf('--run-id');
  const options = {
    keep: argv.includes('--keep'),
    runId: runIdIndex >= 0 ? argv[runIdIndex + 1] : undefined,
  };

  const summary = argv.includes('--run') ? await acceptanceRun(options) : await preflight();
  process.exit(summary.accepted ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exit(1);
  });
}
