/**
 * Process execution for the acceptance harness.
 *
 * Deliberate properties, each of which has a regression test:
 *   - No shell. Arguments are passed as an argv array, so a value that contains
 *     spaces, quotes or shell metacharacters can never be re-parsed as syntax.
 *     Windows package-manager shims are resolved to their known JavaScript CLI
 *     entrypoints and run with Node; batch files never enter cmd.exe.
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
import { statSync } from 'node:fs';
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
 * Resolve known Windows package-manager layouts without interpreting a shim.
 * cmd.exe reparses argv as shell syntax, so an argv array cannot make .CMD/.BAT
 * invocation safe. A missing JavaScript entrypoint is an explicit failure.
 * The optional platform/filesystem parameters support portable resolver tests;
 * production callers always use the actual platform and filesystem.
 */
export function resolveCommand(command, args, env = process.env, options = {}) {
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? safeFileExists;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const name = path.win32.basename(command).toLowerCase();
  const batch = /\.(?:cmd|bat)$/i.test(name);
  const manager = batch ? name.replace(/\.(?:cmd|bat)$/i, '') : name;
  const layouts = {
    pnpm: ['node_modules/pnpm/bin/pnpm.cjs', 'node_modules/corepack/dist/pnpm.js', 'pnpm.cjs'],
    npm: ['node_modules/npm/bin/npm-cli.js', 'node_modules/corepack/dist/npm.js', 'npm-cli.js'],
    npx: ['node_modules/npm/bin/npx-cli.js', 'node_modules/corepack/dist/npx.js', 'npx-cli.js'],
    corepack: ['node_modules/corepack/dist/corepack.js', 'corepack.js'],
  };
  if (batch && !Object.hasOwn(layouts, manager)) {
    throw new Error('UNSUPPORTED_BATCH_COMMAND');
  }
  if (platform !== 'win32') {
    if (batch) throw new Error('UNSUPPORTED_BATCH_COMMAND');
    return { file: command, argv: args };
  }
  if (!Object.hasOwn(layouts, manager)) return { file: command, argv: args };

  // npm_execpath is a normal package-manager launch context. Accept only the
  // exact known CLI basename for the requested tool, never a .cmd/.bat path or
  // a command string. Its bytes remain an argv entry, including % and &.
  const entryNames = {
    pnpm: ['pnpm.cjs', 'pnpm.js'],
    npm: ['npm-cli.js', 'npm.js'],
    npx: ['npx-cli.js', 'npx.js'],
    corepack: ['corepack.js'],
  };
  const currentCli = windowsEnvValue(env, 'npm_execpath');
  const explicitShim = batch && /[\\/]/.test(command);
  if (
    !explicitShim &&
    currentCli &&
    path.win32.isAbsolute(currentCli) &&
    entryNames[manager].includes(path.win32.basename(currentCli).toLowerCase()) &&
    fileExists(currentCli)
  ) {
    return { file: nodeExecutable, argv: [currentCli, ...args] };
  }

  const directories = explicitShim
    ? [path.win32.dirname(command)]
    : (windowsEnvValue(env, 'PATH') ?? '').split(';').filter(Boolean);
  // Node's standard Windows install also hosts npm/Corepack. This fallback
  // does not apply to an explicitly named shim from a different installation.
  if (!explicitShim) directories.push(path.win32.dirname(nodeExecutable));
  for (const directory of [...new Set(directories)]) {
    const native = path.win32.join(directory, `${manager}.exe`);
    if (!batch && fileExists(native)) return { file: native, argv: args };
    for (const relative of layouts[manager]) {
      const candidate = path.win32.join(directory, ...relative.split('/'));
      if (fileExists(candidate)) return { file: nodeExecutable, argv: [candidate, ...args] };
    }
    // Do not silently bypass an earlier unknown shim with a later install.
    if (
      fileExists(path.win32.join(directory, `${manager}.cmd`)) ||
      fileExists(path.win32.join(directory, `${manager}.bat`))
    ) {
      throw new Error(`PACKAGE_MANAGER_JS_CLI_NOT_FOUND: ${manager}`);
    }
  }
  throw new Error(`PACKAGE_MANAGER_JS_CLI_NOT_FOUND: ${manager}`);
}

function windowsEnvValue(env, name) {
  // Match Node's first lexicographic key when PATH/Path aliases coexist.
  const key = Object.keys(env)
    .sort()
    .find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

function safeFileExists(p) {
  try {
    return statSync(p).isFile();
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
    shell: false,
    windowsVerbatimArguments: false,
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
