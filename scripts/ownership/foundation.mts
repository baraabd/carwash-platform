import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { catalogDefinitions, readCatalog, type WorkspaceDefinition } from './catalog.mjs';
export interface FoundationResult {
  readonly ok: boolean;
  readonly scope: string;
  readonly workspaces: number;
  readonly errors: readonly string[];
}
const canonicalWorkspaceGlobs = ['apps/*', 'services/*', 'packages/*'] as const;
function workspaceGlobs(text: string): string[] {
  const block = /^packages:\n((?: {2}- [^\n]+\n)+)/m.exec(text.replaceAll('\r\n', '\n'));
  const body = block?.[1];
  if (body === undefined) return [];
  return [...body.matchAll(/^ {2}- ['"]([^'"]+)['"]\s*$/gm)].map((match) => match[1]!);
}
function json(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Expected JSON object: ${file}`);
  return value as Record<string, unknown>;
}
export function comparePnpmDiscovery(
  root: string,
  definitions: readonly WorkspaceDefinition[],
  rows: unknown,
): string[] {
  if (!Array.isArray(rows)) return ['pnpm discovery: expected a JSON array'];
  const errors: string[] = [];
  const expected = new Map(definitions.map((entry) => [path.resolve(root, entry.path), entry.packageName]));
  const seenPaths = new Set<string>();
  const seenNames = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.path !== 'string' || typeof row.name !== 'string') {
      errors.push('pnpm discovery: malformed workspace row');
      continue;
    }
    const directory = path.resolve(row.path);
    if (seenPaths.has(directory) || seenNames.has(row.name))
      errors.push(`pnpm discovery: duplicate ${row.name}`);
    seenPaths.add(directory);
    seenNames.add(row.name);
    if (directory === path.resolve(root)) {
      if (row.name !== 'carwash-platform') errors.push('pnpm discovery: invalid root package');
    } else if (expected.get(directory) !== row.name)
      errors.push(`pnpm discovery: undeclared or mismatched workspace ${row.name}`);
  }
  for (const [directory, name] of expected)
    if (!seenPaths.has(directory)) errors.push(`pnpm discovery: missing ${name}`);
  return errors;
}
export function checkFoundation(root: string, checkPnpm = false): FoundationResult {
  const result = readCatalog(root);
  const errors = [...result.errors];
  if (!result.catalog) return { ok: false, scope: 'F001-catalog-and-workspace', workspaces: 0, errors };
  const definitions = catalogDefinitions(result.catalog);
  try {
    const globs = workspaceGlobs(readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'));
    if (JSON.stringify(globs) !== JSON.stringify(canonicalWorkspaceGlobs))
      errors.push(
        'pnpm-workspace.yaml: canonical workspace discovery must remain apps/*, services/*, packages/* exactly once',
      );
    const expectedPaths = new Set(definitions.map((entry) => entry.path));
    const ignore = new Set(['node_modules', 'dist', '.turbo', '.git', 'coverage']);
    const nested = (directory: string, workspace: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (ignore.has(entry.name)) continue;
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          errors.push(`workspace symlink forbidden: ${path.relative(root, file)}`);
          continue;
        }
        if (entry.isDirectory()) nested(file, workspace);
        else if (entry.name === 'package.json' && file !== path.join(workspace, 'package.json'))
          errors.push(`nested workspace manifest: ${path.relative(root, file)}`);
      }
    };
    for (const top of ['apps', 'services', 'packages']) {
      const directory = path.join(root, top);
      if (
        !existsSync(directory) ||
        lstatSync(directory).isSymbolicLink() ||
        !lstatSync(directory).isDirectory()
      ) {
        errors.push(`Missing/linked workspace root: ${top}`);
        continue;
      }
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          if (!expectedPaths.has(`${top}/${entry.name}`))
            errors.push(`Undeclared workspace directory: ${top}/${entry.name}`);
        } else if (/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(entry.name))
          errors.push(`Unowned top-level source: ${top}/${entry.name}`);
      }
    }
    const seenNames = new Set<string>();
    for (const entry of definitions) {
      const directory = path.join(root, entry.path);
      if (
        !existsSync(directory) ||
        lstatSync(directory).isSymbolicLink() ||
        !lstatSync(directory).isDirectory()
      ) {
        errors.push(`Missing/linked workspace: ${entry.path}`);
        continue;
      }
      if (realpathSync(directory) !== path.join(realpathSync(root), entry.path))
        errors.push(`Workspace realpath escapes canonical root: ${entry.path}`);
      const manifestFile = path.join(directory, 'package.json');
      if (!existsSync(manifestFile) || lstatSync(manifestFile).isSymbolicLink()) {
        errors.push(`Missing/linked manifest: ${entry.path}`);
        continue;
      }
      const manifest = json(manifestFile);
      if (manifest.name !== entry.packageName || seenNames.has(entry.packageName))
        errors.push(`Mismatched or duplicate package identity: ${entry.path}`);
      seenNames.add(entry.packageName);
      if (
        typeof manifest.version !== 'string' ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
      )
        errors.push(`Unversioned workspace: ${entry.path}`);
      if (manifest.private !== true) errors.push(`Workspace must remain private: ${entry.path}`);
      const shared = result.catalog.sharedPackages.find((item) => item.path === entry.path);
      if (shared && shared.version !== manifest.version) errors.push(`Shared version drift: ${entry.path}`);
      nested(directory, directory);
    }
    if (checkPnpm) {
      const args = ['list', '--recursive', '--depth', '-1', '--json'];
      const execPath = process.env.npm_execpath;
      const command =
        execPath?.endsWith('.cjs') || execPath?.endsWith('.js')
          ? process.execPath
          : process.platform === 'win32'
            ? 'pnpm.cmd'
            : 'pnpm';
      const runArgs = command === process.execPath && execPath ? [execPath, ...args] : args;
      // On Windows only the fixed pnpm command/flags pass through cmd; root is cwd, not command text.
      const run = spawnSync(command, runArgs, {
        cwd: root,
        encoding: 'utf8',
        timeout: 60_000,
        shell: command.endsWith('.cmd'),
      });
      if (run.error || run.status !== 0)
        errors.push(`pnpm discovery did not run successfully: ${run.error?.message ?? run.stderr.trim()}`);
      else errors.push(...comparePnpmDiscovery(root, definitions, JSON.parse(run.stdout)));
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Workspace validation error');
  }
  return {
    ok: !errors.length,
    scope: checkPnpm ? 'F001-catalog-and-real-pnpm-workspace' : 'F001-catalog-and-static-workspace-only',
    workspaces: definitions.length,
    errors,
  };
}
