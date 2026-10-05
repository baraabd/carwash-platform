import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolveCommand, run } from '../../../scripts/acceptance/lib/exec.mjs';

const fakeNode = 'C:\\Program Files\\nodejs\\node.exe';
const resolveWindows = (command, files, env = {}, args = []) =>
  resolveCommand(command, args, env, {
    platform: 'win32',
    nodeExecutable: fakeNode,
    fileExists: (file) => files.includes(file),
  });

test('Windows npm/npx resolve the standard Node install directly to Node plus the known CLI', () => {
  const directory = 'C:\\Program Files\\nodejs';
  for (const [command, cli] of [
    ['npm', 'npm-cli.js'],
    ['npx', 'npx-cli.js'],
  ]) {
    const entry = path.win32.join(directory, 'node_modules', 'npm', 'bin', cli);
    const result = resolveWindows(command, [entry], { Path: directory }, ['--version']);
    assert.deepEqual(result, { file: fakeNode, argv: [entry, '--version'] });
  }
});

test('Windows pnpm supports npm-global, Corepack, colocated CLI and npm_execpath layouts', () => {
  const directory = 'C:\\Users\\test\\AppData\\Roaming\\npm';
  for (const relative of [
    'node_modules/pnpm/bin/pnpm.cjs',
    'node_modules/corepack/dist/pnpm.js',
    'pnpm.cjs',
  ]) {
    const entry = path.win32.join(directory, ...relative.split('/'));
    assert.deepEqual(resolveWindows('pnpm', [entry], { PATH: directory }, ['install']), {
      file: fakeNode,
      argv: [entry, 'install'],
    });
  }
  const managed = 'C:\\Users\\test\\.tools\\pnpm\\10.32.1\\bin\\pnpm.cjs';
  assert.deepEqual(resolveWindows('pnpm', [managed], { npm_execpath: managed }, ['build']), {
    file: fakeNode,
    argv: [managed, 'build'],
  });
});

test('Windows Corepack aliases and explicit known .CMD aliases resolve without cmd.exe', () => {
  const directory = 'C:\\Program Files\\nodejs';
  const entry = path.win32.join(directory, 'node_modules/corepack/dist/corepack.js');
  assert.deepEqual(
    resolveWindows('corepack', [entry], { PATH: directory }, ['pnpm', '--version']),
    { file: fakeNode, argv: [entry, 'pnpm', '--version'] },
  );
  const pnpm = path.win32.join(directory, 'node_modules/corepack/dist/pnpm.js');
  assert.deepEqual(
    resolveWindows(path.win32.join(directory, 'pnpm.CMD'), [pnpm], {}, ['--version']),
    { file: fakeNode, argv: [pnpm, '--version'] },
  );
});

test('Windows native pnpm.exe remains a direct executable with literal argv', () => {
  const directory = 'C:\\pnpm';
  const executable = path.win32.join(directory, 'pnpm.exe');
  const args = ['a&whoami', '%CW_ATTACK%'];
  assert.deepEqual(resolveWindows('pnpm', [executable], { PATH: directory }, args), {
    file: executable,
    argv: args,
  });
});

test('unknown or unresolved batch shims fail closed instead of entering a shell', () => {
  assert.throws(() => resolveWindows('unrecognized.cmd', [], {}), /UNSUPPORTED_BATCH_COMMAND/);
  assert.throws(
    () => resolveWindows('pnpm', ['C:\\tools\\pnpm.cmd'], { PATH: 'C:\\tools' }),
    /PACKAGE_MANAGER_JS_CLI_NOT_FOUND/,
  );
  assert.throws(() => resolveWindows('npm.bat', [], {}), /PACKAGE_MANAGER_JS_CLI_NOT_FOUND/);
  assert.throws(
    () => resolveWindows('pnpm', [], { npm_execpath: 'C:\\tools\\pnpm.cmd' }),
    /PACKAGE_MANAGER_JS_CLI_NOT_FOUND/,
  );
});

test('an explicit shim or first PATH shim cannot silently select another installation', () => {
  const later = 'C:\\later\\node_modules\\pnpm\\bin\\pnpm.cjs';
  assert.throws(
    () => resolveWindows('C:\\first\\pnpm.cmd', [later], { npm_execpath: later }),
    /PACKAGE_MANAGER_JS_CLI_NOT_FOUND/,
  );
  assert.throws(
    () => resolveWindows('C:\\first\\pnpm.cmd', [later], { PATH: 'C:\\later' }),
    /PACKAGE_MANAGER_JS_CLI_NOT_FOUND/,
  );
  assert.throws(
    () => resolveWindows('pnpm', ['C:\\first\\pnpm.cmd', later], { PATH: 'C:\\first;C:\\later' }),
    /PACKAGE_MANAGER_JS_CLI_NOT_FOUND/,
  );
});

test('Windows PATH case aliases follow Node precedence and ComSpec is never used', () => {
  const entry = 'C:\\upper\\node_modules\\npm\\bin\\npm-cli.js';
  const result = resolveWindows(
    'npm',
    [entry],
    {
      PATH: 'C:\\upper',
      Path: 'C:\\different',
      ComSpec: 'C:\\attacker\\cmd.exe',
    },
    [],
  );
  assert.deepEqual(result, { file: fakeNode, argv: [entry] });
});

test('POSIX execution preserves direct executable and argv behavior', () => {
  const args = ['a b"&|;%value%'];
  assert.deepEqual(resolveCommand('pnpm', args, {}, { platform: 'linux' }), {
    file: 'pnpm',
    argv: args,
  });
  assert.deepEqual(resolveCommand(process.execPath, args, {}, { platform: 'linux' }), {
    file: process.execPath,
    argv: args,
  });
});

test('resolved package-manager CLI preserves hostile path/argv bytes in a real Node child', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'washgo cli &%probe% '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = path.join(directory, 'pnpm.cjs');
  const marker = path.join(directory, 'injected.txt');
  await writeFile(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  const args = [
    'x&whoami',
    '%CW_ATTACK%',
    'x|echo',
    'a "b"',
    'C:\\tmp\\A&B',
    `x&echo>${marker}`,
    '$(touch injected.txt)',
    'line\nsecond',
  ];
  const resolved = resolveCommand(
    'pnpm',
    args,
    { npm_execpath: entry, ComSpec: 'cmd.exe' },
    { platform: 'win32', nodeExecutable: process.execPath },
  );
  assert.equal(resolved.file, process.execPath);
  const result = await run(resolved.file, resolved.argv, {
    cwd: directory,
    env: { ...process.env, CW_ATTACK: `echo>${marker}` },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
  await assert.rejects(access(marker), /ENOENT/);
});
