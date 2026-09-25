import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { collectReferences, type Reference } from './references.mjs';
import {
  discoverOwners,
  inside,
  isObject,
  relative,
  sourcePattern,
  type Diagnostic,
  type JsonObject,
  type Owner,
} from './model.mjs';
export interface ScanResult {
  readonly ok: boolean;
  readonly scope: 'static-source-ownership-only';
  readonly compilerVersion: string;
  readonly workspaces: number;
  readonly sourceFiles: number;
  readonly references: number;
  readonly diagnostics: readonly Diagnostic[];
}
interface Dependency {
  readonly name: string;
  readonly version: string;
  readonly field: string;
}
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;
const databasePackages = new Set([
  '@prisma/client',
  'prisma',
  'pg',
  'postgres',
  'mysql2',
  'mongodb',
  'mongoose',
  'typeorm',
  'sequelize',
  'knex',
  'better-sqlite3',
  'drizzle-orm',
]);
const defaults: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowJs: true,
  resolveJsonModule: true,
};
const packagePart = (specifier: string): string =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : (specifier.split('/')[0] ?? specifier);
const isTest = (file: string): boolean =>
  /(?:^|[/\\])(?:tests?|__tests__)(?:[/\\])|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file);
function flattenTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(flattenTargets);
  if (isObject(value)) return Object.values(value).flatMap(flattenTargets);
  return [];
}
function exported(manifest: JsonObject, subpath: string): boolean {
  const exports = manifest.exports;
  if (exports === undefined) return subpath === '.' && typeof manifest.main === 'string';
  if (typeof exports === 'string' || Array.isArray(exports))
    return subpath === '.' && flattenTargets(exports).length > 0;
  if (!isObject(exports)) return false;
  if (!Object.keys(exports).some((key) => key.startsWith('.')))
    return subpath === '.' && flattenTargets(exports).length > 0;
  if (Object.hasOwn(exports, subpath)) return flattenTargets(exports[subpath]).length > 0;
  // Exact exclusions take precedence; choose the most specific matching pattern.
  const keys = Object.keys(exports)
    .filter((key) => {
      if (!key.includes('*')) return false;
      const [prefix = '', suffix = ''] = key.split('*');
      return (
        subpath.startsWith(prefix) &&
        subpath.endsWith(suffix) &&
        subpath.length >= prefix.length + suffix.length
      );
    })
    .sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
  return keys[0] !== undefined && flattenTargets(exports[keys[0]]).length > 0;
}
/** Fail closed on unknown module paths. Does not execute source, DB queries or network requests. */
export function checkRepository(inputRoot: string): ScanResult {
  const root = realpathSync(inputRoot);
  const diagnostics: Diagnostic[] = [];
  const owners = discoverOwners(root, diagnostics);
  const byName = new Map(owners.map((owner) => [owner.name, owner]));
  const dependencies = new Map<Owner, Dependency[]>();
  const graph = new Map<Owner, Set<Owner>>(owners.map((owner) => [owner, new Set<Owner>()]));
  const optionsCache = new Map<string, ts.CompilerOptions>();
  let sourceFiles = 0;
  let referenceCount = 0;
  const add = (rule: string, file: string, message: string, reference?: Reference): void => {
    const location = reference ? { line: reference.line, column: reference.column } : {};
    diagnostics.push({ rule, file: relative(root, file), message, ...location });
  };
  const ownerOf = (file: string): Owner | undefined => owners.find((owner) => inside(owner.dir, file));
  const optionsFor = (file: string): ts.CompilerOptions => {
    let directory = path.dirname(file);
    while (inside(root, directory)) {
      const config = path.join(directory, 'tsconfig.json');
      if (existsSync(config)) {
        if (optionsCache.has(config)) return optionsCache.get(config)!;
        const parsed = ts.getParsedCommandLineOfConfigFile(
          config,
          {},
          {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: (error) =>
              add('INVALID_TSCONFIG', config, ts.flattenDiagnosticMessageText(error.messageText, '\n')),
          },
        );
        for (const error of parsed?.errors ?? []) {
          // No-input diagnostics do not change path resolution; actual source discovery is independent.
          if (error.code !== 18003)
            add('INVALID_TSCONFIG', config, ts.flattenDiagnosticMessageText(error.messageText, '\n'));
        }
        const options = { ...defaults, ...parsed?.options };
        optionsCache.set(config, options);
        for (const project of parsed?.projectReferences ?? []) {
          const target = path.resolve(project.path);
          if (ownerOf(config) !== ownerOf(target) || !ownerOf(target))
            add('CROSS_PROJECT_REFERENCE', config, 'Project references must not compile a different owner.');
        }
        return options;
      }
      if (directory === root) break;
      directory = path.dirname(directory);
    }
    return defaults;
  };
  const resolveDependency = (dependency: Dependency, owner: Owner): Owner | undefined => {
    if (byName.has(dependency.name)) return byName.get(dependency.name);
    const value = dependency.version;
    if (value.startsWith('npm:')) {
      const target = value.slice(4).replace(/@[^@/]*$/, '');
      return byName.get(target);
    }
    if (/^(?:file:|link:|workspace:\.{1,2}[/\\])/.test(value)) {
      return ownerOf(path.resolve(owner.dir, value.replace(/^(?:file:|link:|workspace:)/, '')));
    }
    if (value.startsWith('workspace:')) return byName.get(value.slice(10).replace(/@[^@/]*$/, ''));
    return undefined;
  };
  const allowedEdge = (
    from: Owner,
    to: Owner,
    file: string,
    reference?: Reference,
    development = false,
  ): void => {
    if (from === to) return;
    graph.get(from)!.add(to);
    if (to.kind !== 'shared') {
      add(
        'CROSS_OWNER_IMPORT',
        file,
        `${from.name} must not consume ${to.name}'s implementation. Use a versioned contract/API.`,
        reference,
      );
    } else if ((from.kind === 'service' || from.kind === 'gateway') && to.zone === 'ui') {
      add('UI_IN_BACKEND', file, 'Backend owners may not depend on UI packages.', reference);
    } else if (to.zone === 'test' && !development && !isTest(file)) {
      add(
        'TEST_UTILS_IN_RUNTIME',
        file,
        'test-utils is permitted only in test files/devDependencies.',
        reference,
      );
    } else if (
      from.kind === 'shared' &&
      from.zone === 'contracts' &&
      !['contracts', 'config'].includes(to.zone)
    ) {
      add(
        'CONTRACT_RUNTIME_DEPENDENCY',
        file,
        'Contracts may not pull technical runtimes, UI or domain behavior.',
        reference,
      );
    }
  };
  for (const owner of owners) {
    const list: Dependency[] = [];
    for (const field of dependencyFields) {
      const entries = owner.manifest[field];
      if (entries === undefined) continue;
      if (!isObject(entries)) {
        add('INVALID_DEPENDENCIES', path.join(owner.dir, 'package.json'), `${field} must be an object.`);
        continue;
      }
      for (const [name, version] of Object.entries(entries)) {
        if (typeof version !== 'string' || !version) {
          add('INVALID_DEPENDENCIES', path.join(owner.dir, 'package.json'), `Invalid dependency ${name}.`);
          continue;
        }
        list.push({ name, version, field });
      }
    }
    dependencies.set(owner, list);
  }
  for (const owner of owners) {
    const manifestFile = path.join(owner.dir, 'package.json');
    for (const dependency of dependencies.get(owner)!) {
      const target = resolveDependency(dependency, owner);
      const underlying = dependency.version.startsWith('npm:')
        ? dependency.version.slice(4).replace(/@[^@/]*$/, '')
        : dependency.name;
      if (owner.kind !== 'service' && databasePackages.has(underlying))
        add(
          'DATABASE_CLIENT_OUTSIDE_SERVICE',
          manifestFile,
          'Database clients belong to their owning service, not apps/gateway/shared packages.',
        );
      if (target) {
        allowedEdge(owner, target, manifestFile, undefined, dependency.field === 'devDependencies');
        if (
          target.kind === 'shared' &&
          !/^(?:workspace:(?:\*|\^|~|[\^~]?\d)|[\^~]?\d)/.test(dependency.version)
        ) {
          add(
            'UNVERSIONED_SHARED_DEPENDENCY',
            manifestFile,
            `${dependency.name} must use a version or workspace version, not a file/link/opaque alias.`,
          );
        }
      } else if (
        dependency.name.startsWith('@carwash/') ||
        underlying.startsWith('@carwash/') ||
        /^(?:file:|link:|workspace:)/.test(dependency.version)
      ) {
        add(
          'UNKNOWN_WORKSPACE_DEPENDENCY',
          manifestFile,
          `Unregistered local dependency: ${dependency.name}`,
        );
      }
    }
    // Validate every conditional branch, not just the branch resolved on this OS.
    for (const field of ['imports', 'exports'] as const) {
      for (const target of flattenTargets(owner.manifest[field])) {
        if (target.startsWith('.')) {
          if (!target.startsWith('./') || !inside(owner.dir, path.resolve(owner.dir, target)))
            add('MANIFEST_TARGET_ESCAPE', manifestFile, `${field} target escapes its owner.`);
        } else if (field === 'exports') {
          add('INVALID_PUBLIC_EXPORT', manifestFile, 'Public exports must use owner-local ./ targets.');
        } else {
          const targetOwner = byName.get(packagePart(target));
          if (targetOwner) allowedEdge(owner, targetOwner, manifestFile);
          else if (target.startsWith('@carwash/'))
            add('UNKNOWN_WORKSPACE_DEPENDENCY', manifestFile, `Unknown imports target ${target}.`);
        }
      }
    }
  }
  const inspect = (owner: Owner, file: string, reference: Reference): void => {
    const specifier = reference.specifier;
    if (specifier === null) {
      add(
        'OPAQUE_MODULE_REFERENCE',
        file,
        `${reference.kind} cannot be statically checked; use a literal public import.`,
        reference,
      );
      return;
    }
    if (
      !specifier ||
      specifier.includes('\\') ||
      (!specifier.startsWith('.') && specifier.split('/').some((part) => part === '..' || part === '.')) ||
      specifier.includes('%') ||
      (/^(?:[a-z]+:|\/)/i.test(specifier) && !specifier.startsWith('node:'))
    ) {
      add(
        'UNSUPPORTED_MODULE_PATH',
        file,
        'Absolute paths, URL loaders and backslash specifiers are not allowed.',
        reference,
      );
      return;
    }
    if (isBuiltin(specifier)) return;
    const externalName = packagePart(specifier);
    if (databasePackages.has(externalName) && owner.kind !== 'service') {
      add(
        'DATABASE_CLIENT_OUTSIDE_SERVICE',
        file,
        'Database clients may only be imported by a service.',
        reference,
      );
    }
    const dependency = dependencies.get(owner)!.find((entry) => entry.name === externalName);
    const packageOwner =
      byName.get(externalName) ?? (dependency ? resolveDependency(dependency, owner) : undefined);
    if (packageOwner) {
      // A tsconfig alias can shadow even a registered package's public name.
      // Check the effective owner as well as the declared dependency owner.
      const resolved = ts.resolveModuleName(specifier, file, optionsFor(file), ts.sys).resolvedModule;
      if (resolved) {
        const effectivePath = existsSync(resolved.resolvedFileName)
          ? realpathSync(resolved.resolvedFileName)
          : path.resolve(resolved.resolvedFileName);
        const effectiveOwner = ownerOf(effectivePath);
        if (effectiveOwner && effectiveOwner !== packageOwner) {
          allowedEdge(owner, effectiveOwner, file, reference);
          add(
            'PACKAGE_NAME_SHADOWED',
            file,
            `The configured resolver redirects ${specifier} to another owner.`,
            reference,
          );
        } else if (!effectiveOwner && !effectivePath.split(path.sep).includes('node_modules')) {
          add(
            'OWNER_ESCAPE',
            file,
            'The registered package name resolves outside declared owners.',
            reference,
          );
        }
      }
      allowedEdge(owner, packageOwner, file, reference);
      if (packageOwner !== owner && packageOwner.kind === 'shared') {
        if (!dependency)
          add(
            'UNDECLARED_SHARED_DEPENDENCY',
            file,
            `Declare ${externalName} with a version in this workspace.`,
            reference,
          );
        const subpath = specifier === externalName ? '.' : `.${specifier.slice(externalName.length)}`;
        if (!exported(packageOwner.manifest, subpath))
          add('PRIVATE_SHARED_IMPORT', file, `${specifier} is not a declared public export.`, reference);
      }
      return;
    }
    if (specifier.startsWith('@carwash/')) {
      add('UNKNOWN_WORKSPACE_DEPENDENCY', file, `Unknown workspace import: ${specifier}`, reference);
      return;
    }
    const base = specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : undefined;
    if (base) {
      const to = ownerOf(base);
      if (!to) {
        add('OWNER_ESCAPE', file, 'Relative import leaves all declared ownership roots.', reference);
        return;
      }
      if (to !== owner) {
        allowedEdge(owner, to, file, reference);
        if (to.kind === 'shared')
          add(
            'PRIVATE_SHARED_IMPORT',
            file,
            'Cross-owner relative imports bypass package versions/public exports.',
            reference,
          );
        return;
      }
    }
    const resolved = ts.resolveModuleName(specifier, file, optionsFor(file), ts.sys).resolvedModule;
    if (resolved) {
      const resolvedPath = existsSync(resolved.resolvedFileName)
        ? realpathSync(resolved.resolvedFileName)
        : path.resolve(resolved.resolvedFileName);
      const to = ownerOf(resolvedPath);
      if (to && !resolvedPath.split(path.sep).includes('node_modules')) {
        if (to !== owner) {
          allowedEdge(owner, to, file, reference);
          if (to.kind === 'shared')
            add(
              'PRIVATE_SHARED_IMPORT',
              file,
              'A path alias must not bypass the shared package public API.',
              reference,
            );
        }
        return;
      }
      if (!dependency)
        add('OWNER_ESCAPE', file, 'Resolved module is outside its declared owner/dependencies.', reference);
      return;
    }
    // Installed external dependencies need not be loaded to perform this static source check.
    if (dependency && !base && !specifier.startsWith('#')) return;
    // CSS/JSON/image imports remain owner-local; they are not TS modules.
    if (base && existsSync(base) && statSync(base).isFile() && inside(owner.dir, realpathSync(base))) return;
    add('UNRESOLVED_MODULE_REFERENCE', file, `Cannot prove the owner of ${specifier}.`, reference);
  };
  for (const owner of owners) {
    for (const file of owner.files) {
      if (!sourcePattern.test(file)) continue;
      sourceFiles++;
      optionsFor(file); // Validate project references even when the source has no imports.
      const parsed = collectReferences(file, readFileSync(file, 'utf8'));
      for (const error of parsed.syntaxErrors) add('INVALID_SOURCE_SYNTAX', file, error);
      referenceCount += parsed.references.length;
      for (const reference of parsed.references) inspect(owner, file, reference);
    }
  }
  const visited = new Set<Owner>();
  const active = new Set<Owner>();
  const visit = (owner: Owner): void => {
    if (active.has(owner)) {
      add(
        'WORKSPACE_DEPENDENCY_CYCLE',
        path.join(owner.dir, 'package.json'),
        `Dependency cycle reaches ${owner.name}.`,
      );
      return;
    }
    if (visited.has(owner)) return;
    active.add(owner);
    for (const child of graph.get(owner)!) visit(child);
    active.delete(owner);
    visited.add(owner);
  };
  for (const owner of owners) visit(owner);
  const stable = [
    ...new Map(diagnostics.map((diagnostic) => [JSON.stringify(diagnostic), diagnostic])).values(),
  ].sort(
    (a, b) =>
      a.file.localeCompare(b.file, 'en') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0) ||
      a.rule.localeCompare(b.rule, 'en') ||
      a.message.localeCompare(b.message, 'en'),
  );
  return {
    ok: stable.length === 0,
    scope: 'static-source-ownership-only',
    compilerVersion: ts.version,
    workspaces: owners.length,
    sourceFiles,
    references: referenceCount,
    diagnostics: stable,
  };
}
