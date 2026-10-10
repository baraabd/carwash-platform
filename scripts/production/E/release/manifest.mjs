/**
 * Release manifest (P07-E1): the single record that binds an exact source
 * commit to the immutable artifacts built from it.
 *
 * A deployable reference is ALWAYS `<repository>@sha256:<digest>`. Tags are
 * recorded only as a human convenience and are never read by a deployment.
 *
 * The manifest is validated structurally here (pure, testable) and against the
 * registry by verify-release.mjs.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const MANIFEST_KIND = 'carwash.release-manifest';
export const MANIFEST_SCHEMA_VERSION = 1;

const SHA1 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
// registry[:port]/path/name - lower-case, no tag component on the last segment.
const REPOSITORY = /^[a-z0-9.-]+(?::[0-9]{1,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;
const ROLES = new Set(['runtime', 'migration']);
const KINDS = new Set(['service', 'gateway', 'web-app']);

export function repositoryFor(registry, id, role) {
  const name = role === 'migration' ? `carwash-${id}-migrate` : `carwash-${id}`;
  return `${registry.replace(/\/+$/, '')}/${name}`;
}

/** Splits `repo@sha256:..`; returns null for anything that is not by digest. */
export function parseDigestReference(reference) {
  if (typeof reference !== 'string') return null;
  const at = reference.lastIndexOf('@');
  if (at < 0) return null;
  const repository = reference.slice(0, at);
  const digest = reference.slice(at + 1);
  if (!REPOSITORY.test(repository) || !DIGEST.test(digest)) return null;
  return { repository, digest };
}

/**
 * Deterministic, platform-independent digest of an owner's migration set:
 * the git blob ids of every file under prisma/migrations plus schema.prisma at
 * the exact commit. Line-ending conversion on a checkout cannot change it.
 */
export function migrationSetDigest(lsTreeOutput) {
  const lines = lsTreeOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d{6}) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
      if (!match) throw new Error(`UNEXPECTED_LS_TREE_LINE: ${line}`);
      return `${match[3]}\0${match[2]}`;
    })
    .sort();
  if (lines.length === 0) throw new Error('EMPTY_MIGRATION_SET');
  return `sha256:${createHash('sha256').update(lines.join('\n')).digest('hex')}`;
}

export function migrationNames(lsTreeOutput) {
  const names = new Set();
  for (const line of lsTreeOutput.split('\n')) {
    const match = /\tservices\/[^/]+\/prisma\/migrations\/([^/]+)\/migration\.sql$/.exec(
      line.trim(),
    );
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

export function gitAt(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

/** Migration set of one owner at an exact commit, read from git objects only. */
export function ownerMigrationSet(root, sha, servicePath) {
  const listing = gitAt(
    root,
    'ls-tree',
    '-r',
    sha,
    '--',
    `${servicePath}/prisma/migrations`,
    `${servicePath}/prisma/schema.prisma`,
  );
  return { digest: migrationSetDigest(listing), migrations: migrationNames(listing) };
}

export function blobAt(root, sha, file) {
  return gitAt(root, 'rev-parse', `${sha}:${file}`);
}

/**
 * Structural validation. Returns a list of problems; an empty list means the
 * manifest is internally consistent and covers every expected target.
 *
 * expected: [{ id, kind, database }] from the catalog inventory.
 */
export function validateManifest(manifest, expected) {
  const problems = [];
  const fail = (code, detail = {}) => problems.push({ code, ...detail });

  if (manifest?.kind !== MANIFEST_KIND) fail('KIND');
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION) fail('SCHEMA_VERSION');
  const source = manifest?.source ?? {};
  if (!SHA1.test(source.sha ?? '')) fail('SOURCE_SHA');
  if (!SHA1.test(source.tree ?? '')) fail('SOURCE_TREE');
  if (!SHA1.test(source.lockfileBlob ?? '')) fail('LOCKFILE_BLOB');
  if (source.dirty !== false) fail('SOURCE_NOT_CLEAN');
  if (typeof manifest?.registry !== 'string' || !REPOSITORY.test(`${manifest.registry}/x`)) {
    fail('REGISTRY');
  }
  for (const [name, reference] of Object.entries(manifest?.baseImages ?? {})) {
    if (!parseDigestReference(reference)) fail('BASE_IMAGE_NOT_BY_DIGEST', { name });
  }
  if (!manifest?.baseImages?.node) fail('BASE_IMAGE_MISSING', { name: 'node' });

  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  if (artifacts.length === 0) fail('NO_ARTIFACTS');
  const seen = new Set();
  for (const artifact of artifacts) {
    const key = `${artifact.id}/${artifact.role}`;
    if (seen.has(key)) fail('DUPLICATE_ARTIFACT', { key });
    seen.add(key);
    if (!ROLES.has(artifact.role)) fail('ROLE', { key });
    if (!KINDS.has(artifact.kind)) fail('ARTIFACT_KIND', { key });
    const parsed = parseDigestReference(artifact.reference);
    if (!parsed) {
      fail('REFERENCE_NOT_BY_DIGEST', { key, reference: artifact.reference });
      continue;
    }
    if (parsed.digest !== artifact.digest) fail('DIGEST_MISMATCH', { key });
    if (parsed.repository !== repositoryFor(manifest.registry, artifact.id, artifact.role)) {
      fail('REPOSITORY_MISMATCH', { key });
    }
    if (artifact.platform !== 'linux/amd64') fail('PLATFORM', { key });
    if (artifact.attestations?.sbom !== true || artifact.attestations?.provenance !== true) {
      fail('ATTESTATIONS_MISSING', { key });
    }
    if (artifact.role === 'migration') {
      if (!DIGEST.test(artifact.migrationSet?.digest ?? '')) fail('MIGRATION_SET', { key });
      if (!Array.isArray(artifact.migrationSet?.migrations)) fail('MIGRATION_NAMES', { key });
    }
  }

  for (const target of expected) {
    if (!seen.has(`${target.id}/runtime`)) fail('RUNTIME_ARTIFACT_MISSING', { id: target.id });
    const needsMigration = target.kind === 'service' && Boolean(target.database);
    const hasMigration = seen.has(`${target.id}/migration`);
    if (needsMigration && !hasMigration) fail('MIGRATION_ARTIFACT_MISSING', { id: target.id });
    if (!needsMigration && hasMigration) fail('UNEXPECTED_MIGRATION_ARTIFACT', { id: target.id });
  }
  const expectedIds = new Set(expected.map((t) => t.id));
  for (const artifact of artifacts) {
    if (!expectedIds.has(artifact.id)) fail('UNKNOWN_TARGET', { id: artifact.id });
  }
  return problems;
}

/** Stable serialisation so the manifest digest is reproducible. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function manifestDigest(manifest) {
  return `sha256:${createHash('sha256').update(canonicalJson(manifest)).digest('hex')}`;
}
