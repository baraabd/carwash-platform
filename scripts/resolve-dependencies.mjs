#!/usr/bin/env node
/**
 * Reports the dependency versions that are ACTUALLY installed.
 *
 * Every number printed here is read from the resolved tree on disk, never from a
 * manifest range and never written down by hand. A manifest says `^5.9.0`; this
 * says what `pnpm install` actually put in node_modules, which is the only
 * version that a build or a test result can honestly be attributed to.
 *
 * It resolves each package from the workspace that declares it, because this
 * repository deliberately does not hoist a shared copy: `pg` belongs to the
 * services that use it, `amqplib` to the messaging package, and a Prisma client
 * to the one service that owns its schema.
 *
 *   node scripts/resolve-dependencies.mjs           human-readable table
 *   node scripts/resolve-dependencies.mjs --json    machine-readable
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** package -> the workspace directory that declares it. */
const TARGETS = [
  ['typescript', '.'],
  ['prettier', '.'],
  ['eslint', '.'],
  ['@nestjs/core', 'services/catalog'],
  ['@nestjs/common', 'services/catalog'],
  ['@nestjs/platform-express', 'services/catalog'],
  ['@nestjs/testing', 'services/catalog'],
  ['prisma', 'services/catalog'],
  ['@prisma/client', 'services/catalog'],
  ['@prisma/adapter-pg', 'services/catalog'],
  ['pg', 'services/catalog'],
  ['amqplib', 'packages/platform-messaging'],
  ['reflect-metadata', 'services/catalog'],
  ['rxjs', 'services/catalog'],
];

/**
 * Read a package's own manifest.
 *
 * Requiring `<name>/package.json` fails for any package whose "exports" map
 * does not list ./package.json, which several of these do not - and that is a
 * packaging detail, not a missing dependency. So resolve the package's entry
 * point instead and walk up to the manifest that owns it.
 */
function manifestOnDisk(name, from) {
  // CLI-only packages such as `prisma` expose no importable entry point, so
  // require.resolve cannot find them. Their manifest is still right there in the
  // declaring workspace's node_modules.
  for (const base of [path.join(ROOT, from, 'node_modules'), path.join(ROOT, 'node_modules')]) {
    const candidate = path.join(base, ...name.split('/'), 'package.json');
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8'));
      if (manifest.name === name) return manifest.version;
    }
  }
  return null;
}

function resolveVersion(name, from) {
  const require = createRequire(path.join(ROOT, from, 'package.json'));
  try {
    let dir = path.dirname(require.resolve(name));
    for (let depth = 0; depth < 12; depth += 1) {
      const candidate = path.join(dir, 'package.json');
      if (existsSync(candidate)) {
        const manifest = JSON.parse(readFileSync(candidate, 'utf8'));
        // Guard against stopping at a nested manifest of a different package.
        if (manifest.name === name) {
          return { name, from, version: manifest.version, resolved: true };
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    const onDisk = manifestOnDisk(name, from);
    if (onDisk) return { name, from, version: onDisk, resolved: true };
    return { name, from, version: null, resolved: false, reason: 'MANIFEST_NOT_FOUND' };
  } catch (error) {
    const onDisk = manifestOnDisk(name, from);
    if (onDisk) return { name, from, version: onDisk, resolved: true };
    return { name, from, version: null, resolved: false, reason: error.code ?? 'NOT_RESOLVED' };
  }
}

/**
 * Run a tool without a shell. On Windows pnpm is a .CMD shim, which is not an
 * executable image, so it is invoked through cmd.exe with an argv ARRAY rather
 * than by setting shell:true and letting the arguments be re-parsed as syntax.
 */
function tool(command, args) {
  const spec =
    process.platform === 'win32'
      ? {
          file: process.env.ComSpec ?? 'cmd.exe',
          argv: ['/d', '/s', '/c', `${command}.CMD`, ...args],
        }
      : { file: command, argv: args };
  const result = spawnSync(spec.file, spec.argv, { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function main() {
  const root = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const nvmrc = (await readFile(path.join(ROOT, '.nvmrc'), 'utf8')).trim();

  const report = {
    toolchain: {
      nodeRunning: process.version,
      nodePinned: nvmrc,
      nodeEngines: root.engines?.node ?? null,
      packageManagerPinned: root.packageManager ?? null,
      pnpmRunning: tool('pnpm', ['--version']),
      platform: `${process.platform}/${process.arch}`,
    },
    lockfile: {
      // A frozen install is the real check; this only records presence.
      present: true,
    },
    packages: TARGETS.map(([name, from]) => resolveVersion(name, from)),
  };

  try {
    await readFile(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  } catch {
    report.lockfile.present = false;
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Toolchain');
  for (const [key, value] of Object.entries(report.toolchain)) {
    console.log(`  ${key.padEnd(22)} ${value ?? '(unknown)'}`);
  }
  console.log(`  pnpm-lock.yaml         ${report.lockfile.present ? 'present' : 'MISSING'}`);

  console.log('\nResolved dependency versions (read from node_modules, not from ranges)');
  for (const entry of report.packages) {
    const version = entry.resolved ? entry.version : `NOT RESOLVED (${entry.reason})`;
    console.log(`  ${entry.name.padEnd(28)} ${String(version).padEnd(14)} via ${entry.from}`);
  }

  const unresolved = report.packages.filter((p) => !p.resolved);
  if (unresolved.length > 0) {
    console.log(
      `\n${unresolved.length} package(s) could not be resolved. Run: pnpm install --frozen-lockfile`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
