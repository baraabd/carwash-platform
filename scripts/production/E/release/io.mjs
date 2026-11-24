// Real effects for the release barrier: git object resolution and evidence
// digests. Kept separate from barrier.mjs so the rules stay pure.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, openSync, fstatSync, closeSync, constants, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  classifyServiceRuntime,
  classifyWebRuntime,
  selectRuntimeServices,
} from '../../../../architecture/runtime-lifecycle.mjs';
import { configDigest } from './configuration.mjs';
import { ownerMigrationSet, parseDigestReference, SOURCE_BLOBS } from './manifest.mjs';

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function git(cwd, ...args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Evidence paths are relative to the repository root and may not escape it. */
export function evidenceReader(root) {
  const base = realpathSync(root);
  return (relative) => {
    const resolved = path.resolve(base, relative);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
    let fd;
    try {
      const canonical = realpathSync(resolved);
      if (canonical !== base && !canonical.startsWith(base + path.sep)) return null;
      // Inspect and read the same opened file: replacing its path cannot change
      // the evidence being hashed. Do not follow a substituted leaf symlink or
      // block indefinitely if the leaf is a FIFO instead of a regular file.
      fd = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      if (!fstatSync(fd).isFile()) return null;
      return readFileSync(fd);
    } catch {
      return null;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
}

export function evidenceDigester(root) {
  const read = evidenceReader(root);
  return (relative) => {
    const bytes = read(relative);
    return bytes === null ? null : `sha256:${sha256Hex(bytes)}`;
  };
}

/** Authoritative inputs are resolved from the candidate's immutable git objects. */
export function releaseSourceContext(root, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return null;
  try {
    const readAt = (file) => JSON.parse(git(root, 'show', `${sha}:${file}`));
    const catalog = readAt('architecture/service-catalog.json');
    const policy = readAt('architecture/release-barrier.json');
    const governance = readAt('architecture/governance/main-ruleset.json');
    const toolLock = readAt('scripts/ci/tools.lock.json');
    const baseImages = {
      runtime: toolLock?.runtime?.image,
      nativeLibraries: toolLock?.nativeLibraries?.image,
    };
    if (Object.values(baseImages).some((reference) => !parseDigestReference(reference)))
      return null;
    const checks = governance?.rules?.find((rule) => rule.type === 'required_status_checks')
      ?.parameters?.required_status_checks;
    const approvals = governance?.rules?.find((rule) => rule.type === 'pull_request')?.parameters
      ?.required_approving_review_count;
    if (
      governance?.target !== 'branch' ||
      governance?.enforcement !== 'active' ||
      !Array.isArray(checks) ||
      checks.length === 0 ||
      checks.some((check) => typeof check?.context !== 'string' || !check.context.trim()) ||
      new Set(checks.map((check) => check.context)).size !== checks.length ||
      !Number.isInteger(approvals) ||
      approvals < 0
    )
      return null;
    const services = selectRuntimeServices(catalog);
    if (!classifyServiceRuntime(catalog.gateway).runtime || !Array.isArray(catalog.apps))
      return null;
    const targets = [
      ...services.map((service) => ({ ...service, kind: 'service' })),
      { ...catalog.gateway, kind: 'gateway' },
      ...catalog.apps
        .filter((app) => classifyWebRuntime(app).runtime)
        .map((app) => ({ ...app, kind: 'web-app' })),
    ];
    if (new Set(targets.map((target) => target.id)).size !== targets.length) return null;
    for (const target of targets) {
      const expectedPath =
        target.kind === 'service'
          ? `services/${target.id}`
          : target.kind === 'gateway'
            ? 'apps/api-gateway'
            : `apps/${target.id}`;
      if (target.path !== expectedPath) return null;
    }
    const source = {
      repository: 'baraabd/carwash-platform',
      sha,
      tree: git(root, 'rev-parse', `${sha}^{tree}`),
      committedAt: git(root, 'show', '-s', '--format=%cI', sha),
      ...Object.fromEntries(
        Object.entries(SOURCE_BLOBS).map(([name, file]) => [
          name,
          git(root, 'rev-parse', `${sha}:${file}`),
        ]),
      ),
      configDigest: configDigest(root, sha),
      dirty: false,
    };
    if (
      !source.configDigest ||
      !source.tree ||
      Object.keys(SOURCE_BLOBS).some((name) => !source[name])
    )
      return null;
    const migrationSets = Object.fromEntries(
      targets
        .filter((target) => target.kind === 'service' && target.database)
        .map((target) => [target.id, ownerMigrationSet(root, sha, target.path)]),
    );
    return { source, policy, governance, targets, migrationSets, baseImages };
  } catch {
    return null;
  }
}

export function gitIo(root) {
  const readEvidence = evidenceReader(root);
  return {
    resolveTree: (sha) => git(root, 'rev-parse', '--verify', '--quiet', `${sha}^{tree}`),
    resolveRef: (ref) => git(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`),
    digestEvidence: evidenceDigester(root),
    readEvidence: (relative) => {
      const bytes = readEvidence(relative);
      return bytes === null
        ? null
        : {
            sha256: `sha256:${sha256Hex(bytes)}`,
            content: bytes.toString('utf8'),
          };
    },
    sourceContext: (sha) => releaseSourceContext(root, sha),
    sha256: sha256Hex,
  };
}
