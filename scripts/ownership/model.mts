import { readCatalog } from './catalog.mjs';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
export type JsonObject = Record<string, unknown>;
export type Kind = 'service' | 'app' | 'gateway' | 'shared';
export interface Diagnostic {
  readonly rule: string;
  readonly file: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}
export interface Owner {
  readonly id: string;
  readonly name: string;
  readonly dir: string;
  readonly kind: Kind;
  readonly zone: string;
  readonly manifest: JsonObject;
  readonly files: readonly string[];
}
export const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const ignoredDirectories = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage']);
const sharedZones: Readonly<Record<string, string>> = {
  'event-contracts': 'contracts',
  contracts: 'contracts',
  'api-clients': 'contracts',
  ui: 'ui',
  'design-tokens': 'ui',
  observability: 'technical',
  'security-kit': 'technical',
  'test-utils': 'test',
  'eslint-config': 'config',
  tsconfig: 'config',
};
export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
export function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}
export function jsonFile(file: string, root: string, diagnostics: Diagnostic[]): JsonObject | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isObject(value)) throw new Error('Expected a JSON object.');
    return value;
  } catch (error) {
    diagnostics.push({
      rule: 'INVALID_MANIFEST',
      file: relative(root, file),
      message: error instanceof Error ? error.message : 'Cannot read JSON.',
    });
    return undefined;
  }
}
export function walkOwned(dir: string, root: string, diagnostics: Diagnostic[]): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  )) {
    if (ignoredDirectories.has(entry.name) && entry.isDirectory()) continue;
    // pnpm node_modules links are intentionally outside this source traversal.
    if (entry.name === 'node_modules') continue;
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      diagnostics.push({
        rule: 'SOURCE_SYMLINK',
        file: relative(root, file),
        message: 'Source symlinks can bypass ownership; use a declared public package.',
      });
    } else if (entry.isDirectory()) {
      files.push(...walkOwned(file, root, diagnostics));
    } else if (entry.isFile()) {
      files.push(file);
    }
  }
  return files;
}
/** Preserve V1 test compatibility; a V2 catalog must pass the complete F001 schema and semantic gate. */
export function discoverOwners(root: string, diagnostics: Diagnostic[]): Owner[] {
  const catalogFile = path.join(root, 'architecture/service-catalog.json');
  const catalog = jsonFile(catalogFile, root, diagnostics);
  if (!catalog || !Array.isArray(catalog.services) || !catalog.services.length) {
    diagnostics.push({
      rule: 'INVALID_CATALOG',
      file: relative(root, catalogFile),
      message: 'A nonempty services array is required.',
    });
    return [];
  }
  if (catalog.schemaVersion !== 1 && catalog.schemaVersion !== 2) {
    diagnostics.push({
      rule: 'INVALID_CATALOG',
      file: relative(root, catalogFile),
      message: 'Unsupported catalog schemaVersion.',
    });
    return [];
  }
  if (catalog.schemaVersion === 2) {
    const validated = readCatalog(root);
    for (const message of validated.errors)
      diagnostics.push({ rule: 'INVALID_CATALOG', file: relative(root, catalogFile), message });
    if (!validated.catalog) return [];
  }
  const definitions: {
    id: string;
    dir: string;
    kind: Kind;
    zone: string;
  }[] = [];
  const unique = new Map<string, Set<string>>();
  const register = (field: string, value: unknown): void => {
    if (typeof value !== 'string' || !value) {
      diagnostics.push({
        rule: 'INVALID_CATALOG',
        file: relative(root, catalogFile),
        message: `Missing or invalid ${field}.`,
      });
      return;
    }
    const values = unique.get(field) ?? new Set<string>();
    if (values.has(value))
      diagnostics.push({
        rule: 'DUPLICATE_OWNERSHIP',
        file: relative(root, catalogFile),
        message: `Duplicated ${field}: ${value}`,
      });
    values.add(value);
    unique.set(field, values);
  };
  for (const service of catalog.services) {
    if (!isObject(service) || typeof service.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(service.id)) {
      diagnostics.push({
        rule: 'INVALID_CATALOG',
        file: relative(root, catalogFile),
        message: 'Every service needs a safe, unique id.',
      });
      continue;
    }
    for (const key of ['id', 'database']) register(key, service[key]);
    register('databaseRole', service.runtimeRole);
    register('databaseRole', service.migrationRole);
    if (!Array.isArray(service.owns) || !service.owns.length) {
      diagnostics.push({
        rule: 'INVALID_CATALOG',
        file: relative(root, catalogFile),
        message: `${service.id} must declare data ownership.`,
      });
    } else {
      for (const resource of service.owns) register('dataResource', resource);
    }
    definitions.push({
      id: service.id,
      dir: path.join(root, 'services', service.id),
      kind: 'service',
      zone: 'domain',
    });
  }
  for (const id of ['customer-web', 'operator-web', 'admin-web']) {
    definitions.push({ id, dir: path.join(root, 'apps', id), kind: 'app', zone: 'ui' });
  }
  const ingress = catalog.publicIngress;
  if (ingress !== 'api-gateway') {
    diagnostics.push({
      rule: 'INVALID_CATALOG',
      file: relative(root, catalogFile),
      message: 'The existing public ingress must remain api-gateway.',
    });
  }
  definitions.push({
    id: 'api-gateway',
    dir: path.join(root, 'apps/api-gateway'),
    kind: 'gateway',
    zone: 'technical',
  });
  for (const topLevel of ['apps', 'services', 'packages']) {
    const directory = path.join(root, topLevel);
    if (
      !existsSync(directory) ||
      !lstatSync(directory).isDirectory() ||
      lstatSync(directory).isSymbolicLink()
    ) {
      diagnostics.push({
        rule: 'MISSING_WORKSPACE_ROOT',
        file: topLevel,
        message: 'A real workspace root directory is required.',
      });
      continue;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        if (sourcePattern.test(entry.name))
          diagnostics.push({
            rule: 'UNOWNED_SOURCE',
            file: `${topLevel}/${entry.name}`,
            message: 'Source must belong to one declared workspace.',
          });
        continue;
      }
      const dir = path.join(directory, entry.name);
      if (topLevel === 'packages' && Object.hasOwn(sharedZones, entry.name)) {
        definitions.push({ id: entry.name, dir, kind: 'shared', zone: sharedZones[entry.name]! });
      } else if (!definitions.some((definition) => definition.dir === dir)) {
        diagnostics.push({
          rule: 'UNREGISTERED_WORKSPACE',
          file: relative(root, dir),
          message: 'Undeclared service/app or uncontrolled shared package.',
        });
      }
    }
  }
  const names = new Set<string>();
  const dirs = new Set<string>();
  const owners: Owner[] = [];
  for (const definition of definitions) {
    if (dirs.has(definition.dir)) continue; // Duplicate remains a failure above.
    dirs.add(definition.dir);
    if (
      !existsSync(definition.dir) ||
      !lstatSync(definition.dir).isDirectory() ||
      lstatSync(definition.dir).isSymbolicLink()
    ) {
      diagnostics.push({
        rule: 'MISSING_WORKSPACE',
        file: relative(root, definition.dir),
        message: 'Declared workspace is missing or is a symlink.',
      });
      continue;
    }
    const manifestFile = path.join(definition.dir, 'package.json');
    if (!existsSync(manifestFile)) {
      diagnostics.push({
        rule: 'MISSING_WORKSPACE_MANIFEST',
        file: relative(root, manifestFile),
        message: 'F001 must add the missing package skeleton; do not silently skip it.',
      });
      continue;
    }
    if (lstatSync(manifestFile).isSymbolicLink()) {
      diagnostics.push({
        rule: 'SOURCE_SYMLINK',
        file: relative(root, manifestFile),
        message: 'Workspace manifest must not be a symlink.',
      });
      continue;
    }
    const manifest = jsonFile(manifestFile, root, diagnostics);
    if (!manifest) continue;
    const name = manifest.name;
    if (typeof name !== 'string' || !/^@carwash\/[a-z0-9-]+$/.test(name)) {
      diagnostics.push({
        rule: 'INVALID_PACKAGE_NAME',
        file: relative(root, manifestFile),
        message: 'Expected a scoped @carwash workspace name.',
      });
      continue;
    }
    if (names.has(name))
      diagnostics.push({
        rule: 'DUPLICATE_PACKAGE',
        file: relative(root, manifestFile),
        message: `Duplicated workspace name: ${name}`,
      });
    names.add(name);
    if (
      typeof manifest.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
    ) {
      diagnostics.push({
        rule: 'INVALID_PACKAGE_VERSION',
        file: relative(root, manifestFile),
        message: 'A concrete version is required for every package.',
      });
    }
    const files = walkOwned(definition.dir, root, diagnostics);
    for (const file of files) {
      if (path.basename(file) === 'package.json' && file !== manifestFile) {
        diagnostics.push({
          rule: 'NESTED_WORKSPACE',
          file: relative(root, file),
          message: 'Nested package boundaries must not escape canonical workspace discovery.',
        });
      }
    }
    owners.push({ ...definition, name, manifest, files });
  }
  return owners.sort((a, b) => a.dir.localeCompare(b.dir, 'en'));
}
