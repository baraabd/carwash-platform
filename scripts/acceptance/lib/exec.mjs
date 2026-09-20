/**
 * Process execution for the acceptance harness.
 *
 * Deliberate properties, each of which has a regression test:
 *   - No shell. Arguments are passed as an argv array, so a value that contains
 *     spaces, quotes or shell metacharacters can never be re-parsed as syntax.
 *     `pnpm` on Windows is resolved to its .CMD shim explicitly rather than by
 *     switching the spawn to `shell: true`.
 *   - Process-TREE termination. Killing `pnpm` alone leaves `tsc`/`node`/`docker`
 *     children alive and the harness hangs; on Windows we use `taskkill /T /F`,
 *     elsewhere we signal the whole process group.
 *   - AbortSignal cancellation, so an interrupted run tears its children down.
 *   - stdout and stderr are captured SEPARATELY. Merging them makes it impossible
 *     to tell a tool's diagnostics from its result.
 *   - Bounded output and bounded time, so a runaway process cannot fill the disk
 *     or block the run forever.
 *   - Secret redaction on everything that is written to a log or a report.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';

export const MAX_STREAM_BYTES = 4 * 1024 * 1024;

/** Values registered here are replaced everywhere before anything is persisted. */
const secrets = new Set();

export function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 6) secrets.add(value);
}

export function clearSecrets() {
  secrets.clear();
}

const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^:/?#\s]+):([^@/?#\s]+)@/gi;

export function redact(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const secret of secrets) {
    if (secret && out.includes(secret)) out = out.split(secret).join('[REDACTED]');
  }
  // Catch credentials we were never told about (e.g. printed by a tool).
  return out.replace(URL_CREDENTIALS, '$1$2:[REDACTED]@');
}

class BoundedBuffer {
  #chunks = [];
  #bytes = 0;
  #truncated = false;

  push(chunk) {
    if (this.#truncated) return;
    if (this.#bytes + chunk.length > MAX_STREAM_BYTES) {
      this.#chunks.push(Buffer.from('\n[TRUNCATED: output limit reached]\n'));
      this.#truncated = true;
      return;
    }
    this.#chunks.push(chunk);
    this.#bytes += chunk.length;
  }

  get truncated() {
    return this.#truncated;
  }

  toString() {
    return redact(Buffer.concat(this.#chunks).toString('utf8'));
  }
}

/** Kill a process and everything it started. */
export function killTree(child) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    try {
      // /T = tree, /F = force. Detached from our own stdio so it cannot hang us.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } catch {
      child.kill('SIGKILL');
    }
    return;
  }
  try {
    // Negative pid = the process group created by detached:true.
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * Resolve a command to something spawnable without a shell.
 * On Windows, .CMD/.BAT shims are not executable images, so they are run through
 * cmd.exe with an argv array (NOT a concatenated command string).
 */
function resolveCommand(command, args, env) {
  if (process.platform !== 'win32') return { file: command, argv: args, windowsVerbatim: false };
  if (command === 'pnpm' || command === 'npm' || command === 'npx' || command === 'corepack') {
    const dir = (env.PATH ?? process.env.PATH ?? '')
      .split(path.delimiter)
      .find((entry) => entry && safeExists(path.join(entry, `${command}.CMD`)));
    const shim = dir ? path.join(dir, `${command}.CMD`) : `${command}.CMD`;
    return {
      file: process.env.ComSpec ?? 'cmd.exe',
      argv: ['/d', '/s', '/c', shim, ...args],
      windowsVerbatim: false,
    };
  }
  return { file: command, argv: args, windowsVerbatim: false };
}

function safeExists(p) {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Run a command to completion.
 * Never throws for a nonzero exit; the caller decides what a nonzero exit means.
 */
export async function run(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    timeoutMs = 20 * 60 * 1000,
    signal,
    input,
  } = options;

  const started = Date.now();
  const resolved = resolveCommand(command, args, env);
  const child = spawn(resolved.file, resolved.argv, {
    cwd,
    env,
    // A process group on POSIX so the whole tree can be signalled at once.
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdout = new BoundedBuffer();
  const stderr = new BoundedBuffer();
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  if (input !== undefined) {
    child.stdin.end(input);
  } else {
    child.stdin.end();
  }

  let outcome = 'exited';
  const timer = setTimeout(() => {
    outcome = 'timeout';
    killTree(child);
  }, timeoutMs);
  timer.unref?.();

  const onAbort = () => {
    outcome = 'cancelled';
    killTree(child);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let code;
  let signalCode;
  try {
    [code, signalCode] = await once(child, 'close');
  } catch (error) {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    return {
      command: `${command} ${args.join(' ')}`,
      code: null,
      signal: null,
      outcome: 'spawn-failed',
      stdout: stdout.toString(),
      stderr: redact(String(error?.message ?? error)),
      durationMs: Date.now() - started,
      truncated: false,
    };
  }
  clearTimeout(timer);
  signal?.removeEventListener('abort', onAbort);

  return {
    command: redact(`${command} ${args.join(' ')}`),
    code,
    signal: signalCode,
    outcome,
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    durationMs: Date.now() - started,
    truncated: stdout.truncated || stderr.truncated,
  };
}

/** Run and treat any nonzero exit, timeout or cancellation as a hard failure. */
export async function runOrThrow(command, args, options = {}) {
  const result = await run(command, args, options);
  if (result.code !== 0 || result.outcome !== 'exited') {
    const error = new Error(
      `COMMAND_FAILED: ${result.command} -> code=${result.code} outcome=${result.outcome}`,
    );
    error.result = result;
    throw error;
  }
  return result;
}
