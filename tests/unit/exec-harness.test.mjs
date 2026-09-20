import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT } from './_load.mjs';
import {
  run,
  redact,
  registerSecret,
  clearSecrets,
  MAX_STREAM_BYTES,
} from '../../scripts/acceptance/lib/exec.mjs';

/**
 * The acceptance harness is the thing that decides whether the sprint passes,
 * so its own failure modes are regression-tested. A harness that loses a child
 * process, merges stderr into stdout or prints a password would corrupt every
 * result it reports.
 */

const node = process.execPath;

test('harness: stdout and stderr are captured separately', async () => {
  const result = await run(node, [
    '-e',
    'process.stdout.write("OUT"); process.stderr.write("ERR");',
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'OUT');
  assert.equal(result.stderr, 'ERR');
});

test('harness: a nonzero exit is reported, not thrown', async () => {
  const result = await run(node, ['-e', 'process.exit(3)']);
  assert.equal(result.code, 3);
  assert.equal(result.outcome, 'exited');
});

test('harness: arguments containing spaces and quotes are never re-parsed as shell syntax', async () => {
  // If the harness built a command string, the child would receive a truncated
  // argument and the rest would run as separate shell commands. Exact
  // round-tripping is the proof that it did not: the value arrives as ONE
  // argument, byte for byte, and nothing else is produced.
  const hostile = 'a b" ; echo INJECTED ; #';
  const result = await run(node, ['-e', 'process.stdout.write(process.argv[1])', hostile]);
  assert.equal(result.stdout, hostile, 'the argument must arrive intact as a single argv entry');
  assert.equal(result.stderr, '', 'no shell should have interpreted anything');
  assert.equal(result.code, 0);
});

test('harness: a run that exceeds its timeout is marked timeout, not success', async () => {
  const result = await run(node, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 });
  assert.equal(result.outcome, 'timeout');
  assert.notEqual(result.code, 0);
});

test('harness: an AbortSignal cancels the child', async () => {
  const controller = new AbortController();
  const pending = run(node, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
  await delay(150);
  controller.abort();
  const result = await pending;
  assert.equal(result.outcome, 'cancelled');
});

test('harness: killing a parent also kills the grandchild process it spawned', async () => {
  // A child that leaks its own children makes the harness hang forever. The
  // grandchild appends to a file; if it survived the kill it would keep writing.
  //
  // The marker path travels in the ENVIRONMENT, not inside the script text.
  // Interpolating it would pass a Windows path through two levels of JavaScript
  // string parsing: the outer script consumes one layer of escaping and the
  // inner one then reads "C:\Users\..." where \U and \L are not valid escapes,
  // so the backslashes are dropped and the result is the drive-relative path
  // "C:Users..." - a file written into the repository, while the test looked in
  // %TEMP% and found nothing. Both sizes were 0 and the assertion passed
  // whether or not the grandchild had actually been killed.
  const marker = path.join(process.env.TEMP ?? '/tmp', `cw-tree-${process.pid}-${Date.now()}.txt`);
  const script = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => require("node:fs").appendFileSync(process.env.CW_TREE_MARKER, "x"), 50)'], { stdio: 'ignore' });
    process.stdout.write(String(child.pid));
    setInterval(() => {}, 1000);
  `;
  const controller = new AbortController();
  const pending = run(node, ['-e', script], {
    signal: controller.signal,
    env: { ...process.env, CW_TREE_MARKER: marker },
  });
  await delay(800);

  const { readFileSync, existsSync, rmSync } = await import('node:fs');
  try {
    // Guard against a vacuous pass: unless the grandchild really was writing,
    // "it stopped writing" proves nothing at all.
    assert.ok(
      existsSync(marker),
      'the grandchild never wrote its marker, so the test proves nothing',
    );
    const sizeWhileAlive = readFileSync(marker).length;
    assert.ok(sizeWhileAlive > 0, 'the grandchild produced no output while it was alive');

    controller.abort();
    await pending;
    await delay(400);

    const sizeAfterKill = readFileSync(marker).length;
    await delay(600);
    const sizeLater = readFileSync(marker).length;
    assert.equal(
      sizeLater,
      sizeAfterKill,
      'the grandchild kept running after its parent was killed',
    );
  } finally {
    rmSync(marker, { force: true });
  }
});

test('harness: output beyond the limit is truncated instead of filling memory', async () => {
  const result = await run(node, [
    '-e',
    `const chunk = "x".repeat(1024 * 64); for (let i = 0; i < ${Math.ceil(MAX_STREAM_BYTES / (1024 * 64)) + 8}; i += 1) process.stdout.write(chunk);`,
  ]);
  assert.equal(result.truncated, true);
  assert.ok(result.stdout.includes('[TRUNCATED: output limit reached]'));
  assert.ok(result.stdout.length <= MAX_STREAM_BYTES + 1024);
});

test('harness: a registered secret never appears in captured output', async () => {
  clearSecrets();
  const secret = 'sup3r-s3cret-value-123';
  registerSecret(secret);
  try {
    const result = await run(node, ['-e', `process.stdout.write(${JSON.stringify(secret)})`]);
    assert.ok(!result.stdout.includes(secret));
    assert.ok(result.stdout.includes('[REDACTED]'));
  } finally {
    clearSecrets();
  }
});

test('harness: credentials in a URL are redacted even when never registered', async () => {
  clearSecrets();
  const result = await run(node, [
    '-e',
    'process.stdout.write("postgresql://cw_app:neverRegistered@127.0.0.1:5432/db")',
  ]);
  assert.ok(!result.stdout.includes('neverRegistered'));
});

test('harness: redact leaves ordinary text untouched', () => {
  clearSecrets();
  assert.equal(redact('nothing sensitive here'), 'nothing sensitive here');
});

test('harness: a missing executable is reported as spawn-failed, never as pass', async () => {
  const result = await run('definitely-not-a-real-command-xyz', ['--version'], { timeoutMs: 5000 });
  assert.notEqual(result.code, 0);
  assert.ok(['spawn-failed', 'exited'].includes(result.outcome));
});

test('harness: the command line recorded in the result is redacted', async () => {
  clearSecrets();
  const secret = 'another-secret-value-abc';
  registerSecret(secret);
  try {
    const result = await run(node, ['-e', 'process.exit(0)', secret]);
    assert.ok(!result.command.includes(secret));
  } finally {
    clearSecrets();
  }
});

test('harness: ROOT resolves to the repository root', async () => {
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync(path.join(ROOT, 'pnpm-workspace.yaml')));
});
