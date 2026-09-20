#!/usr/bin/env node
/**
 * Developer helper: start/stop an ephemeral acceptance infrastructure stack and
 * remember its context, so migrations can be authored against a real database.
 *
 * This is NOT the acceptance runner. It exists so that a developer does not have
 * to hand-craft credentials or ports, and so that every stack it starts is still
 * scoped to a run id and therefore still safe to tear down by project.
 *
 *   node scripts/dev/acceptance-infra.mjs up
 *   node scripts/dev/acceptance-infra.mjs down
 *   node scripts/dev/acceptance-infra.mjs print   # non-secret summary only
 */
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  createRunContext,
  writeContextFile,
  readContextFile,
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

const POINTER = path.join(ROOT, '.acceptance', 'current-dev-stack.json');

async function readPointer() {
  const raw = await readFile(POINTER, 'utf8');
  const { contextFile } = JSON.parse(raw);
  return readContextFile(contextFile);
}

function summary(context) {
  return {
    runId: context.runId,
    project: context.project,
    ports: context.ports,
    vhost: context.vhost,
    images: context.images,
    contextFile: path.join(context.workDir, 'context.json'),
  };
}

const command = process.argv[2] ?? 'print';

if (command === 'up') {
  const context = await createRunContext();
  const docker = await dockerEnvironment(context);
  console.log(`docker context=${docker.context} server=${docker.daemon.serverVersion}`);
  await resolveImageDigests(context);
  await composeUp(context);
  await waitForPostgresReady(context);
  await waitForRabbitReady(context);
  const bootstrap = await bootstrapRabbitIdentities(context);
  if (bootstrap.code !== 0) {
    console.error(bootstrap.stderr || bootstrap.stdout);
    throw new Error('RABBITMQ_BOOTSTRAP_FAILED');
  }
  const contextFile = await writeContextFile(context);
  await writeFile(POINTER, JSON.stringify({ contextFile }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(summary(context), null, 2));
} else if (command === 'down') {
  const context = await readPointer();
  const result = await composeDown(context);
  if (result.code !== 0) {
    console.error(result.stderr || result.stdout);
    process.exitCode = 1;
  }
  await rm(POINTER, { force: true });
  console.log(`torn down project ${context.project}`);
} else {
  const context = await readPointer();
  console.log(JSON.stringify(summary(context), null, 2));
}
