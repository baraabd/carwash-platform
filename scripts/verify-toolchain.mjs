#!/usr/bin/env node
/**
 * Proves that ONE toolchain version is declared, and that every place which
 * consumes it agrees.
 *
 * The Node version in this repository is written down in five files: `.nvmrc`,
 * the Dockerfile base-image argument, the image-contract checker, the acceptance
 * context, and (indirectly) the CI workflows. Four of them can drift without
 * breaking anything visible until a build produces an artifact built against a
 * different runtime than the one the tests ran on. `.nvmrc` is the single
 * authority here; every other file is checked against it rather than trusted.
 *
 * The checks are grouped so a failure says which promise broke:
 *   declaration - the pins themselves are exact, stable and in the approved line,
 *   propagation - every consumer of a pin matches the authority,
 *   install     - the install is reproducible and lifecycle scripts stay narrow,
 *   runtime     - the interpreter and package manager actually in use match.
 *
 *   node scripts/verify-toolchain.mjs                 all checks
 *   node scripts/verify-toolchain.mjs --config-only   skip the runtime checks
 *   node scripts/verify-toolchain.mjs --json          machine-readable
 *
 * `--root`, `--observed-node` and `--observed-pnpm` exist so the guard can be
 * tested against fixtures that violate each rule. A guard with no failing test
 * is indistinguishable from no guard.
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The Node major line this project is approved for, and the pnpm major line.
 * These are deliberately NOT read from a file: they are the sprint's approved
 * decision, and the point of the check is to notice when a file wanders out of
 * them. Moving either number is a documented decision, not a silent edit.
 */
const APPROVED_NODE_MAJOR = 24;
const APPROVED_PNPM_MAJOR = 10;
/** The oldest TypeScript the strict baseline is known to hold on. */
const MIN_TYPESCRIPT = [5, 9, 0];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
function option(name, fallback = null) {
  const at = args.indexOf(`--${name}`);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
}

const root = path.resolve(option('root', REPO));
const configOnly = flag('config-only');
const asJson = flag('json');

const checks = [];
const pass = (group, name, detail) => checks.push({ group, name, ok: true, detail });
const fail = (group, name, detail) => checks.push({ group, name, ok: false, detail });

async function readIfPresent(relative) {
  const target = path.join(root, relative);
  if (!existsSync(target)) return null;
  return readFile(target, 'utf8');
}

/** Exact `X.Y.Z` only. A floating major is not a pin. */
const EXACT = /^(\d+)\.(\d+)\.(\d+)$/;
function parseExact(value) {
  const match = EXACT.exec(String(value).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// -------------------------------------------------------------- declaration --

const nvmrcRaw = await readIfPresent('.nvmrc');
let nodePin = null;
if (nvmrcRaw === null) {
  fail('declaration', '.nvmrc present', 'missing: there is no authoritative Node version');
} else {
  const value = nvmrcRaw.trim();
  nodePin = parseExact(value);
  if (!nodePin) {
    fail('declaration', '.nvmrc is an exact version', `found "${value}", expected X.Y.Z`);
  } else if (nodePin[0] !== APPROVED_NODE_MAJOR) {
    fail(
      'declaration',
      '.nvmrc is in the approved Node line',
      `found major ${nodePin[0]}, approved ${APPROVED_NODE_MAJOR}`,
    );
  } else {
    pass('declaration', '.nvmrc is an exact approved Node version', value);
  }
}
const nodeVersion = nodePin ? nodePin.join('.') : null;

const manifestRaw = await readIfPresent('package.json');
const manifest = manifestRaw ? JSON.parse(manifestRaw) : null;
let pnpmPin = null;
if (!manifest) {
  fail('declaration', 'root package.json present', 'missing');
} else {
  const declared = String(manifest.packageManager ?? '');
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(declared);
  if (!match) {
    fail(
      'declaration',
      'packageManager pins pnpm exactly',
      `found "${declared}", expected pnpm@X.Y.Z`,
    );
  } else {
    pnpmPin = parseExact(match[1]);
    if (pnpmPin[0] !== APPROVED_PNPM_MAJOR) {
      fail(
        'declaration',
        'packageManager is in the approved pnpm line',
        `found major ${pnpmPin[0]}, approved ${APPROVED_PNPM_MAJOR}`,
      );
    } else {
      pass('declaration', 'packageManager pins pnpm exactly', declared);
    }
  }
}
const pnpmVersion = pnpmPin ? pnpmPin.join('.') : null;

/**
 * An engines range must admit the pin and stop at the next major. `>=24` alone
 * would let a Node 25 machine install and then fail somewhere less obvious.
 */
function checkEnginesRange(name, range, pin) {
  if (!pin) return;
  if (typeof range !== 'string') {
    fail('declaration', `engines.${name} declared`, 'missing');
    return;
  }
  const match = /^>=\s*(\d+(?:\.\d+\.\d+)?)\s+<\s*(\d+)$/.exec(range.trim());
  if (!match) {
    fail(
      'declaration',
      `engines.${name} is bounded`,
      `found "${range}", expected ">=<pin> <${pin[0] + 1}"`,
    );
    return;
  }
  const lower = match[1].includes('.') ? parseExact(match[1]) : [Number(match[1]), 0, 0];
  const upper = Number(match[2]);
  if (compare(lower, pin) > 0) {
    fail('declaration', `engines.${name} admits the pin`, `${range} excludes ${pin.join('.')}`);
  } else if (upper !== pin[0] + 1) {
    fail(
      'declaration',
      `engines.${name} stops at the next major`,
      `found upper bound <${upper}, expected <${pin[0] + 1}`,
    );
  } else {
    pass('declaration', `engines.${name} admits the pin and stops at the next major`, range);
  }
}
checkEnginesRange('node', manifest?.engines?.node, nodePin);
checkEnginesRange('pnpm', manifest?.engines?.pnpm, pnpmPin);

/**
 * Foundation-critical tooling is pinned exactly and never to a prerelease.
 * "Newer" is not a reason to run the core stack on a release candidate: an RC
 * can change behaviour between builds, which is the one thing a locked
 * toolchain exists to prevent.
 */
const PRERELEASE = /-(?:alpha|beta|rc|next|canary|dev|pre|experimental)/i;
if (manifest) {
  const devDependencies = manifest.devDependencies ?? {};
  const floating = [];
  const prerelease = [];
  for (const [name, range] of Object.entries(devDependencies)) {
    if (PRERELEASE.test(range)) prerelease.push(`${name}@${range}`);
    else if (!EXACT.test(String(range).trim())) floating.push(`${name}@${range}`);
  }
  const total = Object.keys(devDependencies).length;
  if (prerelease.length > 0) {
    fail(
      'declaration',
      'no prerelease in the root toolchain',
      `prerelease specifier(s): ${prerelease.join(', ')}`,
    );
  } else {
    pass('declaration', 'no prerelease in the root toolchain', `${total} stable release(s)`);
  }
  if (floating.length > 0) {
    fail(
      'declaration',
      'root toolchain versions are exact',
      `unpinned specifier(s): ${floating.join(', ')}`,
    );
  } else {
    pass('declaration', 'root toolchain versions are exact', 'every root devDependency is X.Y.Z');
  }

  const typescript = parseExact(devDependencies.typescript ?? '');
  if (!typescript) {
    fail('declaration', 'TypeScript is pinned exactly', `found "${devDependencies.typescript}"`);
  } else if (compare(typescript, MIN_TYPESCRIPT) < 0) {
    fail(
      'declaration',
      'TypeScript meets the strict baseline',
      `found ${typescript.join('.')}, minimum ${MIN_TYPESCRIPT.join('.')}`,
    );
  } else {
    pass('declaration', 'TypeScript meets the strict baseline', typescript.join('.'));
  }
}

// -------------------------------------------------------------- propagation --

/**
 * Every file that names a Node runtime must name the authoritative one. The
 * expected base image is derived from `.nvmrc`, so bumping Node is a one-line
 * change plus whatever this check then reports as stale.
 */
const expectedImage = nodeVersion ? `node:${nodeVersion}-bookworm-slim` : null;
const IMAGE_CONSUMERS = [
  ['Dockerfile', /^ARG NODE_IMAGE=(\S+)$/m],
  ['scripts/check-images.mjs', /^const NODE_IMAGE = '([^']+)';$/m],
  ['scripts/acceptance/lib/context.mjs', /^\s*node: '([^']+)',$/m],
];
for (const [relative, pattern] of IMAGE_CONSUMERS) {
  const text = await readIfPresent(relative);
  if (text === null) {
    // Absent is not a violation: the guard must still work on a fixture that
    // does not ship the container tooling.
    pass('propagation', `${relative} base image`, 'not present in this tree; skipped');
    continue;
  }
  const match = pattern.exec(text);
  if (!match) {
    fail('propagation', `${relative} base image`, 'no recognisable Node image declaration found');
  } else if (expectedImage && match[1] !== expectedImage) {
    fail(
      'propagation',
      `${relative} base image matches .nvmrc`,
      `found "${match[1]}", expected "${expectedImage}"`,
    );
  } else {
    pass('propagation', `${relative} base image matches .nvmrc`, match[1]);
  }
}

/**
 * CI must read `.nvmrc` rather than repeat the number. A literal
 * `node-version: '24'` is how a pipeline ends up testing a different patch
 * release than the Dockerfile builds against.
 */
const workflowDir = path.join(root, '.github/workflows');
const TOOLCHAIN_OWNERSHIP_EXEMPT_WORKFLOWS = new Set([
  // This workflow is byte-frozen by the approved design-reference policy.
  // F002 must not modify it just to propagate a patch pin; its own guard
  // verifies that the file remains identical to the trusted baseline.
  'reference-integrity.yml',
  // F001 owns this branch-only environment diagnostic. It does not run on
  // main/develop/PR builds and is not part of the F002 reproducible build path.
  'f001-environment-probe.yml',
]);
if (!existsSync(workflowDir)) {
  pass('propagation', 'CI reads .nvmrc', 'no workflows in this tree; skipped');
} else {
  for (const file of (await readdir(workflowDir)).filter((f) => /\.ya?ml$/.test(f))) {
    const text = await readFile(path.join(workflowDir, file), 'utf8');
    if (!text.includes('actions/setup-node')) continue;
    if (TOOLCHAIN_OWNERSHIP_EXEMPT_WORKFLOWS.has(file)) {
      pass(
        'propagation',
        `${file} remains outside F002 ownership`,
        'frozen by the design-reference guard; left byte-identical to the approved baseline',
      );
      continue;
    }
    const literal = /^\s*node-version:\s*(.+)$/m.exec(text);
    if (literal) {
      fail(
        'propagation',
        `${file} reads .nvmrc`,
        `hardcoded node-version: ${literal[1].trim()} - use node-version-file: .nvmrc`,
      );
    } else if (!/^\s*node-version-file:\s*\.nvmrc\s*$/m.test(text)) {
      fail('propagation', `${file} reads .nvmrc`, 'sets up Node without node-version-file: .nvmrc');
    } else {
      pass('propagation', `${file} reads .nvmrc`, 'node-version-file: .nvmrc');
    }
  }
}

// ------------------------------------------------------------------ install --

/**
 * The install settings that make a wrong toolchain fail loudly instead of
 * quietly producing a different tree.
 */
const npmrc = await readIfPresent('.npmrc');
if (npmrc === null) {
  fail('install', '.npmrc present', 'missing: install settings are not pinned');
} else {
  const lines = npmrc.split('\n').map((line) => line.trim());
  const required = [
    ['engine-strict=true', 'an install under an undeclared Node major would be allowed'],
    ['package-manager-strict=true', 'a different pnpm version could run the install'],
    ['registry=https://registry.npmjs.org/', 'the registry is not pinned to the official one'],
  ];
  for (const [setting, why] of required) {
    if (lines.includes(setting)) pass('install', `.npmrc sets ${setting}`, 'present');
    else fail('install', `.npmrc sets ${setting}`, why);
  }
  // Lifecycle scripts are allowed per package in pnpm-workspace.yaml, never
  // globally. A global switch re-enables arbitrary install-time code execution
  // for the entire dependency graph at once.
  const globalEnable = /^\s*(enable-pre-post-scripts|unsafe-perm)\s*=\s*true\s*$/m.exec(npmrc);
  if (globalEnable) {
    fail(
      'install',
      'lifecycle scripts are not enabled globally',
      `.npmrc sets ${globalEnable[1]}=true`,
    );
  } else {
    pass('install', 'lifecycle scripts are not enabled globally', 'no global enable in .npmrc');
  }
}

/**
 * Every lifecycle-script exception must be justified in the dependency policy.
 * Allowing a package to run install-time code is a supply-chain decision, so it
 * cannot be added by editing one line of YAML and saying nothing.
 */
const workspaceYaml = await readIfPresent('pnpm-workspace.yaml');
const policy = await readIfPresent('docs/DEPENDENCY_POLICY_AR.md');
if (workspaceYaml === null) {
  fail('install', 'pnpm-workspace.yaml present', 'missing');
} else {
  const block = /^onlyBuiltDependencies:\n((?:[ \t]*-[ \t]*.+\n?)+)/m.exec(workspaceYaml);
  const allowed = block ? [...block[1].matchAll(/-\s*'?([^'\s]+)'?/g)].map((m) => m[1]) : [];
  if (!block) {
    // No exceptions at all is the safest possible state, not a failure.
    pass('install', 'lifecycle-script allowlist', 'no package may run install scripts');
  } else if (policy === null) {
    fail(
      'install',
      'lifecycle-script exceptions are documented',
      `docs/DEPENDENCY_POLICY_AR.md is missing, so ${allowed.length} exception(s) are unreviewed`,
    );
  } else {
    const undocumented = allowed.filter((name) => !policy.includes(name));
    if (undocumented.length > 0) {
      fail(
        'install',
        'lifecycle-script exceptions are documented',
        `not justified in docs/DEPENDENCY_POLICY_AR.md: ${undocumented.join(', ')}`,
      );
    } else {
      pass(
        'install',
        'lifecycle-script exceptions are documented',
        `${allowed.length} reviewed: ${allowed.join(', ')}`,
      );
    }
  }
}

/**
 * A frozen lockfile is only a guarantee while nothing opts out of it. These
 * flags turn CI from "the lockfile is authoritative" into "resolve whatever is
 * newest today", which is exactly the failure this sprint removes.
 */
const FORBIDDEN_INSTALL_FLAGS = [/--no-frozen-lockfile/, /pnpm\s+install[^\n]*--force/];
const scanned = [];
for (const dir of ['.github/workflows', 'scripts']) {
  const base = path.join(root, dir);
  if (!existsSync(base)) continue;
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(ya?ml|mjs|js)$/.test(entry.name)) continue;
    // This file names the flags in order to forbid them.
    if (entry.name === 'verify-toolchain.mjs') continue;
    scanned.push(path.join(dir, entry.name));
  }
}
const optOuts = [];
for (const relative of scanned) {
  const text = await readFile(path.join(root, relative), 'utf8');
  for (const pattern of FORBIDDEN_INSTALL_FLAGS) {
    if (pattern.test(text)) optOuts.push(`${relative} (${pattern.source})`);
  }
}
if (optOuts.length > 0) {
  fail('install', 'nothing opts out of the frozen lockfile', optOuts.join(', '));
} else {
  pass(
    'install',
    'nothing opts out of the frozen lockfile',
    `${scanned.length} workflow/script file(s) scanned`,
  );
}

// ------------------------------------------------------------------ runtime --

if (configOnly) {
  pass('runtime', 'runtime checks', 'skipped by --config-only');
} else {
  const observedNode = (option('observed-node') ?? process.versions.node).replace(/^v/, '');
  if (nodeVersion && observedNode !== nodeVersion) {
    fail(
      'runtime',
      'running Node matches .nvmrc',
      `running ${observedNode}, declared ${nodeVersion}. Switch to the pinned runtime` +
        ' (nvm/fnm read .nvmrc) rather than changing the pin.',
    );
  } else if (nodeVersion) {
    pass('runtime', 'running Node matches .nvmrc', observedNode);
  }

  let observedPnpm = option('observed-pnpm');
  if (observedPnpm === null) {
    // The launcher a developer actually types, so its own reported version is
    // the honest answer here. A single command string rather than an args array:
    // pnpm is a shim on Windows, so a shell is required, and passing args
    // alongside `shell: true` is deprecated.
    const probe = spawnSync('pnpm --version', { encoding: 'utf8', shell: true });
    observedPnpm = probe.status === 0 ? probe.stdout.trim() : null;
  }
  if (observedPnpm === null) {
    fail(
      'runtime',
      'pnpm matches packageManager',
      'pnpm could not be run. Enable corepack so the pinned version is activated.',
    );
  } else if (pnpmVersion && observedPnpm !== pnpmVersion) {
    fail(
      'runtime',
      'pnpm matches packageManager',
      `running ${observedPnpm}, declared ${pnpmVersion}. corepack activates the pin;` +
        ' do not install a different pnpm globally.',
    );
  } else if (pnpmVersion) {
    pass('runtime', 'pnpm matches packageManager', observedPnpm);
  }
}

// ------------------------------------------------------------------- report --

const failures = checks.filter((check) => !check.ok);

if (asJson) {
  const report = {
    node: nodeVersion,
    pnpm: pnpmVersion,
    image: expectedImage,
    ok: failures.length === 0,
    checks,
  };
  console.log(JSON.stringify(report, null, 2));
} else {
  let group = null;
  for (const check of checks) {
    if (check.group !== group) {
      group = check.group;
      console.log(`\n${group}`);
    }
    const detail = check.detail ? ` - ${check.detail}` : '';
    console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}${detail}`);
  }
  console.log(
    `\nAuthoritative toolchain: Node ${nodeVersion ?? '?'}, pnpm ${pnpmVersion ?? '?'},` +
      ` base image ${expectedImage ?? '?'}.`,
  );
  console.log(
    `${checks.length - failures.length}/${checks.length} checks passed. This verifies declared` +
      ' and propagated versions, not that any build or test suite succeeds.',
  );
}

if (failures.length > 0) {
  console.error(`\nToolchain verification failed: ${failures.length} check(s).`);
  process.exit(1);
}
