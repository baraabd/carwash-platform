import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, readJson } from './policy.mjs';
export const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
export const toolLock = readJson(path.join(ROOT, 'scripts/ci/tools.lock.json'));
export function tool(name) {
  const item = toolLock.tools[name];
  assert.ok(item, 'Unknown security tool');
  const binary = path.join(process.env.CI_TOOLS_DIR ?? '', name);
  assert.ok(path.isAbsolute(binary), 'Tool directory missing');
  assert.equal(
    createHash('sha256').update(readFileSync(binary)).digest('hex'),
    item.binarySha256,
    'Untrusted tool binary',
  );
  return binary;
}
export function command(
  command,
  args,
  { timeoutMs = 1200000, capture = false, cwd = ROOT, env = process.env } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    let exceeded = false;
    const timer = setTimeout(() => {
      exceeded = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    if (capture) {
      const consume = (kind) => (chunk) => {
        if (stdout.length + stderr.length + chunk.length > 64 * 1024 * 1024) {
          exceeded = true;
          child.kill('SIGKILL');
          return;
        }
        if (kind === 'out') stdout += chunk.toString();
        else stderr += chunk.toString();
      };
      child.stdout.on('data', consume('out'));
      child.stderr.on('data', consume('err'));
    }
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: exceeded || signal ? -1 : code, stdout, stderr });
    });
  });
}
export async function checked(cmd, args, opts) {
  const result = await command(cmd, args, opts);
  assert.equal(
    result.code,
    0,
    `${path.basename(cmd)} failed (exit ${result.code}); inspect the job log`,
  );
  return result.stdout.trim();
}
export function sourceDirty() {
  const tracked = git('diff', '--name-only', 'HEAD');
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
  const generated =
    /^evidence\/(?:acceptance\/[0-9]{8}-[a-f0-9]{8}\/(?:acceptance-report\.json|integration\.tap|logs\/(?:compose-ps\.json|postgres\.log|rabbitmq\.log))|(?:identity|gateway)\/cw-f006-[a-f0-9]+\/(?:acceptance-report\.json|integration\.tap|stderr\.log|infrastructure\.log))$/;
  return tracked !== '' || untracked.some((f) => !generated.test(f));
}
export function writeReport(id, status, steps, detail = {}) {
  assert.match(id, /^[a-z][a-z0-9-]*$/);
  const directory = process.env.CI_EVIDENCE_DIR;
  assert.ok(directory && path.isAbsolute(directory), 'CI_EVIDENCE_DIR must be absolute');
  mkdirSync(directory, { recursive: true });
  const dockerVersion = /^(?:image-|integration$)/.test(id)
    ? execFileSync('docker', ['--version'], { encoding: 'utf8' }).trim()
    : null;
  const report = {
    schemaVersion: 1,
    id,
    status,
    sourceSha: git('rev-parse', 'HEAD'),
    sourceTree: git('rev-parse', 'HEAD^{tree}'),
    sourceDirty: sourceDirty(),
    runId: process.env.GITHUB_RUN_ID ?? 'local',
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '1',
    tools: {
      node: process.version,
      docker: dockerVersion,
      platform: `${process.platform}/${process.arch}`,
      pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
    },
    steps,
    detail,
  };
  writeFileSync(path.join(directory, `${id}.json`), JSON.stringify(report, null, 2) + '\n');
  return report;
}
export async function stage(id, fn) {
  assert.ok(process.env.CI_EVIDENCE_DIR && path.isAbsolute(process.env.CI_EVIDENCE_DIR));
  mkdirSync(process.env.CI_EVIDENCE_DIR, { recursive: true });
  const steps = [];
  let detail = {};
  let status = 'failed';
  const step = async (name, work) => {
    assert.match(name, /^[a-z][a-z0-9-]*$/);
    const start = Date.now();
    try {
      const result = await work();
      steps.push({ id: name, status: 'passed', durationMs: Date.now() - start });
      return result;
    } catch (error) {
      steps.push({ id: name, status: 'failed', durationMs: Date.now() - start });
      throw error;
    }
  };
  try {
    detail = (await fn(step)) ?? {};
    status = 'passed';
  } catch (error) {
    console.error(`F009 ${id}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    writeReport(id, status, steps, detail);
  }
}
