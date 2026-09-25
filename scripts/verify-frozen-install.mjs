#!/usr/bin/env node
/**
 * Proves that `pnpm-lock.yaml` is a genuine pnpm resolution and that a frozen
 * install reproduces from it.
 *
 * Two different things can go wrong, so there are two different checks.
 *
 * 1. AUDIT (offline). A lockfile can be edited by hand - to silence a conflict,
 *    to "fix" a version, or to paste an integrity hash. That produces a file
 *    which still parses and still installs, while no longer describing what the
 *    manifests ask for. The audit compares every importer entry against the
 *    manifest that owns it and checks the shape of every integrity hash.
 *
 * 2. CLEAN INSTALL. `pnpm install --frozen-lockfile` inside a warm workspace is
 *    close to a no-op: pnpm sees an up-to-date node_modules and skips the work.
 *    That is not evidence of reproducibility. So the manifests, the lockfile and
 *    `.npmrc` are copied into a throwaway directory with NO node_modules, and
 *    the frozen install is run there. It reuses the global content-addressable
 *    store, so it is fast, and it never touches the real dependency tree - this
 *    script cannot damage a developer's working state.
 *
 *   node scripts/verify-frozen-install.mjs              audit + clean install
 *   node scripts/verify-frozen-install.mjs --audit-only offline checks only
 *   node scripts/verify-frozen-install.mjs --json       machine-readable
 *
 * Scope: this proves resolution and fetch integrity. It deliberately runs the
 * clean install with --ignore-scripts, so it does NOT prove that an approved
 * lifecycle script (a Prisma engine download) succeeds; `pnpm generate` and the
 * image build are what cover that.
 */
import { readFile, mkdtemp, mkdir, rm, cp } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The lockfile format this checker understands. A new major needs a re-read. */
const SUPPORTED_LOCKFILE_VERSION = '9.0';
/** sha512 in base64: 64 raw bytes -> 86 base64 chars plus '=='. */
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
function option(name, fallback = null) {
  const at = args.indexOf(`--${name}`);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
}

const root = path.resolve(option('root', REPO));
const auditOnly = flag('audit-only');
const asJson = flag('json');

const checks = [];
const pass = (name, detail) => checks.push({ name, ok: true, detail });
const fail = (name, detail) => checks.push({ name, ok: false, detail });

function read(relative) {
  const target = path.join(root, relative);
  return existsSync(target) ? readFile(target, 'utf8') : Promise.resolve(null);
}

/**
 * A narrow reader for the parts of a pnpm v9 lockfile this check needs, rather
 * than a YAML dependency added to the root for one script. It understands
 * exactly three shapes - `importers:` entries, `overrides:` and `resolution:`
 * lines - and reports a parse it does not recognise instead of guessing.
 */
function readLockfile(text) {
  const lines = text.split('\n');
  const version = /^lockfileVersion:\s*'?([^'\s]+)'?/m.exec(text)?.[1] ?? null;

  const overrides = {};
  const importers = {};
  const integrities = [];
  const tarballs = [];

  let section = null;
  let importer = null;
  let block = null;
  let dependency = null;

  for (const raw of lines) {
    if (/^[a-zA-Z]/.test(raw)) {
      section = raw.replace(/:.*$/, '');
      importer = null;
      continue;
    }
    if (section === 'overrides') {
      const entry = /^ {2}([^:]+):\s*'?([^']+?)'?\s*$/.exec(raw);
      if (entry) overrides[entry[1].replace(/^'|'$/g, '')] = entry[2];
      continue;
    }
    if (section === 'importers') {
      const head = /^ {2}(\S+):\s*$/.exec(raw);
      if (head) {
        importer = head[1].replace(/^'|'$/g, '');
        importers[importer] = {};
        block = null;
        continue;
      }
      if (!importer) continue;
      const group = /^ {4}(dependencies|devDependencies|optionalDependencies):\s*$/.exec(raw);
      if (group) {
        block = group[1];
        continue;
      }
      const name = /^ {6}('[^']+'|[^\s:]+):\s*$/.exec(raw);
      if (name) {
        dependency = name[1].replace(/^'|'$/g, '');
        continue;
      }
      const specifier = /^ {8}specifier:\s*(.+?)\s*$/.exec(raw);
      if (specifier && dependency && block) {
        importers[importer][dependency] = {
          block,
          specifier: specifier[1].replace(/^'|'$/g, ''),
        };
      }
      continue;
    }
    // `packages:` and `snapshots:`
    const resolution = /^\s*resolution:\s*\{(.+)\}\s*$/.exec(raw);
    if (resolution) {
      const integrity = /integrity:\s*([^,}\s]+)/.exec(resolution[1]);
      const tarball = /tarball:\s*([^,}\s]+)/.exec(resolution[1]);
      integrities.push(integrity ? integrity[1] : null);
      if (tarball) tarballs.push(tarball[1]);
    }
  }
  return { version, overrides, importers, integrities, tarballs };
}

/*
 * Run the frozen install under the interpreter that is running this script.
 *
 * The `pnpm` launcher is a shim that hardcodes a sibling Node, so on a machine
 * with several installed runtimes it can silently install under a different
 * version than the caller chose. That matters here more than usual: `.npmrc`
 * sets engine-strict, so the answer to "does a frozen install work" depends on
 * which Node asks. Corepack ships with every supported Node distribution, so
 * invoking its pnpm entry point directly with `process.execPath` pins both the
 * runtime and the pnpm version from `packageManager`.
 *
 * If corepack is not where either layout puts it, fall back to the shim rather
 * than skipping the check, and let the output say which Node answered.
 */
function resolveCorepackPnpm() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    // Windows distributions and nvm-windows.
    path.join(nodeDir, 'node_modules/corepack/dist/pnpm.js'),
    // POSIX prefix layout: <prefix>/bin/node with <prefix>/lib/node_modules.
    path.join(nodeDir, '../lib/node_modules/corepack/dist/pnpm.js'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runFrozenInstall(cwd) {
  const flags = ['install', '--frozen-lockfile', '--ignore-scripts', '--reporter=append-only'];
  const env = { ...process.env, CI: 'true', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
  const corepackPnpm = resolveCorepackPnpm();
  if (corepackPnpm) {
    return spawnSync(process.execPath, [corepackPnpm, ...flags], { cwd, encoding: 'utf8', env });
  }
  // A single command string, not an args array: pnpm is a shim on Windows, so a
  // shell is needed, and passing args alongside `shell: true` is deprecated.
  return spawnSync(`pnpm ${flags.join(' ')}`, { cwd, encoding: 'utf8', shell: true, env });
}

const lockText = await read('pnpm-lock.yaml');
const manifestText = await read('package.json');
const workspaceText = await read('pnpm-workspace.yaml');

if (lockText === null || manifestText === null || workspaceText === null) {
  console.error(
    'Missing pnpm-lock.yaml, package.json or pnpm-workspace.yaml: there is nothing to verify.',
  );
  process.exit(1);
}

const manifest = JSON.parse(manifestText);
const lock = readLockfile(lockText);

// --------------------------------------------------------------------- audit --

if (lock.version === SUPPORTED_LOCKFILE_VERSION) {
  pass('lockfile format is the expected version', `lockfileVersion ${lock.version}`);
} else {
  fail(
    'lockfile format is the expected version',
    `found ${lock.version ?? 'none'}, expected ${SUPPORTED_LOCKFILE_VERSION}`,
  );
}

/**
 * The importer set must be exactly the workspace packages. A missing importer
 * means a package was added without resolving; an extra one means a package was
 * removed and the lockfile still carries its tree.
 */
const globs = [...workspaceText.matchAll(/^\s*-\s*'?([^'\s]+)'?\s*$/gm)]
  .map((match) => match[1])
  .filter((entry) => entry.endsWith('/*'));
const expectedImporters = new Set(['.']);
for (const glob of globs) {
  // 'services/*' -> the prefix 'services/', keeping the separator the lockfile
  // uses in its importer keys.
  const prefix = glob.slice(0, -1);
  const dir = path.join(root, prefix);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    // A directory with no manifest is not a workspace package; several app
    // directories in this repo are boundary definitions only.
    if (existsSync(path.join(dir, name, 'package.json'))) {
      expectedImporters.add(`${prefix}${name}`);
    }
  }
}
const actualImporters = new Set(Object.keys(lock.importers));
const missing = [...expectedImporters].filter((entry) => !actualImporters.has(entry));
const extra = [...actualImporters].filter((entry) => !expectedImporters.has(entry));
if (missing.length === 0 && extra.length === 0) {
  pass('every workspace package is resolved', `${actualImporters.size} importer(s)`);
} else {
  fail(
    'every workspace package is resolved',
    [
      missing.length ? `not in the lockfile: ${missing.join(', ')}` : null,
      extra.length ? `no longer a workspace package: ${extra.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('; '),
  );
}

/**
 * Each recorded specifier must equal what the manifest declares today. This is
 * the check that catches both a hand-edited lockfile and a manifest bumped
 * without re-running pnpm.
 */
const specifierProblems = [];
let specifiersCompared = 0;
for (const importer of actualImporters) {
  const manifestPath = path.join(root, importer, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const owner = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const [name, entry] of Object.entries(lock.importers[importer])) {
    const declared = owner[entry.block]?.[name];
    specifiersCompared++;
    if (declared === undefined) {
      specifierProblems.push(`${importer}: ${name} is locked but no longer declared`);
    } else if (declared !== entry.specifier) {
      specifierProblems.push(
        `${importer}: ${name} declares ${declared}, lockfile recorded ${entry.specifier}`,
      );
    }
  }
}
if (specifierProblems.length === 0) {
  pass(
    'locked specifiers match the manifests',
    `${specifiersCompared} declared dependency specifier(s) agree`,
  );
} else {
  fail('locked specifiers match the manifests', specifierProblems.join('; '));
}

/** The overrides pnpm recorded must be the overrides the root asks for. */
const declaredOverrides = manifest.pnpm?.overrides ?? {};
const overrideProblems = [];
for (const [name, range] of Object.entries(declaredOverrides)) {
  if (lock.overrides[name] !== range) {
    overrideProblems.push(`${name}: declared ${range}, lockfile ${lock.overrides[name] ?? 'none'}`);
  }
}
for (const name of Object.keys(lock.overrides)) {
  if (!(name in declaredOverrides)) overrideProblems.push(`${name}: in lockfile but not declared`);
}
if (overrideProblems.length === 0) {
  pass(
    'security overrides are recorded as declared',
    `${Object.keys(declaredOverrides).length} override(s)`,
  );
} else {
  fail('security overrides are recorded as declared', overrideProblems.join('; '));
}

/**
 * Every resolution must carry a well-formed sha512. A hash of the wrong length
 * or alphabet is not something pnpm writes; it is something a person typed.
 */
const badIntegrity = lock.integrities.filter((value) => value === null || !INTEGRITY.test(value));
if (lock.integrities.length === 0) {
  fail('every resolution carries a verifiable integrity hash', 'no resolutions found');
} else if (badIntegrity.length > 0) {
  fail(
    'every resolution carries a verifiable integrity hash',
    `${badIntegrity.length} malformed or missing of ${lock.integrities.length}`,
  );
} else {
  pass(
    'every resolution carries a verifiable integrity hash',
    `${lock.integrities.length} sha512 resolution(s)`,
  );
}

/** Nothing may be fetched from somewhere other than the pinned registry. */
const offRegistry = lock.tarballs.filter((url) => !url.startsWith('https://registry.npmjs.org/'));
if (offRegistry.length > 0) {
  fail('all tarballs come from the pinned registry', offRegistry.slice(0, 5).join(', '));
} else {
  pass(
    'all tarballs come from the pinned registry',
    lock.tarballs.length === 0
      ? 'no explicit tarball URLs; all resolved from the registry default'
      : `${lock.tarballs.length} explicit URL(s) on registry.npmjs.org`,
  );
}

// ----------------------------------------------------------- clean install --

if (auditOnly) {
  pass('clean-state frozen install', 'skipped by --audit-only');
} else {
  const mirror = await mkdtemp(path.join(tmpdir(), 'cw-frozen-'));
  try {
    // Only the files that decide resolution. No node_modules, no sources: if the
    // lockfile is complete, this is everything pnpm needs.
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc']) {
      if (existsSync(path.join(root, file))) {
        await cp(path.join(root, file), path.join(mirror, file));
      }
    }
    for (const importer of actualImporters) {
      if (importer === '.') continue;
      await mkdir(path.join(mirror, importer), { recursive: true });
      await cp(
        path.join(root, importer, 'package.json'),
        path.join(mirror, importer, 'package.json'),
      );
    }

    const install = runFrozenInstall(mirror);
    const output = `${install.stdout ?? ''}${install.stderr ?? ''}`.trim();
    if (install.status === 0) {
      pass(
        'clean-state frozen install',
        'pnpm install --frozen-lockfile succeeded in a tree with no node_modules',
      );

      // If the install had to change the lockfile, --frozen-lockfile should
      // already have refused. Asserting the bytes makes that guarantee visible
      // instead of implied. Only meaningful once the install actually ran: an
      // install that failed early leaves the file untouched for the wrong reason.
      const after = await readFile(path.join(mirror, 'pnpm-lock.yaml'), 'utf8');
      if (after === lockText) {
        pass('lockfile is byte-identical after a clean install', 'resolution is reproducible');
      } else {
        fail(
          'lockfile is byte-identical after a clean install',
          'the install rewrote pnpm-lock.yaml, so the committed lockfile is not what pnpm resolves',
        );
      }
    } else {
      fail(
        'clean-state frozen install',
        `exit ${install.status}: ${output.split('\n').slice(-12).join(' | ')}`,
      );
      fail(
        'lockfile is byte-identical after a clean install',
        'not determined: the clean install did not complete',
      );
    }
  } finally {
    await rm(mirror, { recursive: true, force: true }).catch(() => {});
  }
}

// -------------------------------------------------------------------- report --

const failures = checks.filter((check) => !check.ok);

if (asJson) {
  console.log(JSON.stringify({ ok: failures.length === 0, checks }, null, 2));
} else {
  for (const check of checks) {
    console.log(
      `  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`,
    );
  }
  console.log(
    `\n${checks.length - failures.length}/${checks.length} checks passed. This proves the` +
      ' lockfile is a real pnpm resolution that reinstalls reproducibly. It does not prove that' +
      ' approved lifecycle scripts, builds or tests succeed, and it is not a vulnerability audit.',
  );
}

if (failures.length > 0) {
  console.error(`\nFrozen-install verification failed: ${failures.length} check(s).`);
  process.exit(1);
}
