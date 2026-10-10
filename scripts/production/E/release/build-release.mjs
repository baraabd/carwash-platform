#!/usr/bin/env node
/**
 * Builds, pushes and records the immutable release artifacts (P07-E1).
 *
 *   build-release.mjs build    --target <id> --registry <host/ns> --out <dir>
 *   build-release.mjs assemble --registry <host/ns> --parts <dir> --out <file>
 *   build-release.mjs local-registry [--port 5000]   pull-request rehearsal only
 *
 * `build` produces, for one catalog target, its runtime image (from the
 * target's own Dockerfile, exactly what the F009 image gate builds) and - for a
 * database owner - its migration job image (infra/release/Dockerfile.migrate).
 * Each image is pushed with a BuildKit SBOM and max-mode SLSA provenance
 * attached, and only the pushed manifest digest is recorded.
 *
 * `assemble` merges the per-target parts into release-manifest.json, refusing
 * parts built from a different commit or different base images.
 *
 * Every build arg that names an image is a digest. The tag pushed alongside is
 * the full commit SHA and is never consumed by a deployment.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, ROOT } from '../../../ci/policy.mjs';
import { command } from '../../../ci/runtime.mjs';
import { officialImagePullCandidates } from '../../../lib/image-references.mjs';
import {
  MANIFEST_KIND,
  MANIFEST_SCHEMA_VERSION,
  blobAt,
  gitAt,
  manifestDigest,
  ownerMigrationSet,
  repositoryFor,
  validateManifest,
} from './manifest.mjs';

const SOURCE_URL = 'https://github.com/baraabd/carwash-platform';
const PLATFORM = 'linux/amd64';
const toolLock = JSON.parse(readFileSync(path.join(ROOT, 'scripts/ci/tools.lock.json'), 'utf8'));

function args(argv) {
  const out = { _: argv[0] };
  for (let i = 1; i < argv.length; i += 2) {
    assert.match(argv[i], /^--[a-z-]+$/, `Unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

async function docker(argv, options = {}) {
  const result = await command('docker', argv, { capture: true, timeoutMs: 3_600_000, ...options });
  if (result.code !== 0) {
    throw new Error(
      `docker ${argv[0]} ${argv[1] ?? ''} failed (${result.code}): ${result.stderr.slice(-4000)}`,
    );
  }
  return result.stdout.trim();
}

/** The source must be exactly a commit: nothing modified or untracked in the build context. */
export function assertCleanSource(root = ROOT) {
  const status = gitAt(
    root,
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    'tsconfig.base.json',
    'packages',
    'services',
    'apps',
    'infra/release',
    'Dockerfile',
    '.dockerignore',
  );
  assert.equal(status, '', `Build context differs from the commit:\n${status}`);
}

export function sourceRecord(root = ROOT) {
  const sha = gitAt(root, 'rev-parse', 'HEAD');
  return {
    repository: 'baraabd/carwash-platform',
    sha,
    tree: gitAt(root, 'rev-parse', 'HEAD^{tree}'),
    committedAt: gitAt(root, 'show', '-s', '--format=%cI', sha),
    lockfileBlob: blobAt(root, sha, 'pnpm-lock.yaml'),
    toolsLockBlob: blobAt(root, sha, 'scripts/ci/tools.lock.json'),
    migrationDockerfileBlob: blobAt(root, sha, 'infra/release/Dockerfile.migrate'),
    dirty: false,
  };
}

/** Resolves the pinned Node base tag to a manifest digest without trusting the tag later. */
async function resolveNodeBase() {
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const tag = (/^ARG NODE_IMAGE=(.+)$/m.exec(dockerfile) ?? [])[1];
  assert.ok(tag, 'Root Dockerfile must pin NODE_IMAGE');
  const failures = [];
  for (const candidate of officialImagePullCandidates(tag)) {
    const result = await command(
      'docker',
      ['buildx', 'imagetools', 'inspect', candidate, '--format', '{{json .Manifest}}'],
      { capture: true, timeoutMs: 300_000 },
    );
    if (result.code !== 0) {
      failures.push(`${candidate}: ${result.stderr.slice(-300)}`);
      continue;
    }
    const digest = JSON.parse(result.stdout).digest;
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
    const repository = candidate.replace(/:[^:/]+$/, '');
    return { tag, reference: `${repository}@${digest}` };
  }
  throw new Error(`Cannot resolve ${tag} to a digest:\n${failures.join('\n')}`);
}

function unwrapPlatform(value) {
  if (value && typeof value === 'object' && PLATFORM in value) return value[PLATFORM];
  return value;
}

async function inspect(reference, field) {
  const output = await docker([
    'buildx',
    'imagetools',
    'inspect',
    reference,
    '--format',
    `{{json .${field}}}`,
  ]);
  return unwrapPlatform(JSON.parse(output));
}

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

/** Attestation evidence pulled back FROM THE REGISTRY, not from the local build. */
export async function registryAttestations(reference) {
  const index = await inspect(reference, 'Manifest');
  const manifests = index?.manifests ?? [];
  const attestationManifests = manifests.filter(
    (m) => m.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest',
  );
  const platforms = manifests
    .filter((m) => m.platform && m.platform.os !== 'unknown')
    .map((m) => `${m.platform.os}/${m.platform.architecture}`);
  const sbom = await inspect(reference, 'SBOM');
  const provenance = await inspect(reference, 'Provenance');
  const image = await inspect(reference, 'Image');
  return {
    indexDigest: index?.digest ?? null,
    platforms,
    attestationManifests: attestationManifests.length,
    sbom,
    provenance,
    labels: image?.config?.Labels ?? {},
  };
}

async function buildOne({ target, role, registry, source, nodeBase, out, work }) {
  const repository = repositoryFor(registry, target.id, role);
  const dockerfile =
    role === 'migration' ? 'infra/release/Dockerfile.migrate' : `${target.path}/Dockerfile`;
  const metadataFile = path.join(work, `${target.id}-${role}.metadata.json`);
  const buildArgs = ['--build-arg', `NODE_IMAGE=${nodeBase.reference}`];
  if (role === 'runtime') {
    buildArgs.push('--build-arg', `RUNTIME_IMAGE=${toolLock.runtime.image}`);
    buildArgs.push('--build-arg', `NATIVE_RUNTIME_IMAGE=${toolLock.nativeLibraries.image}`);
  } else {
    buildArgs.push('--build-arg', `SERVICE=${target.id}`);
  }
  const epoch = String(Math.floor(Date.parse(source.committedAt) / 1000));
  await docker(
    [
      'buildx',
      'build',
      '--platform',
      PLATFORM,
      '--file',
      dockerfile,
      ...buildArgs,
      '--build-arg',
      `SOURCE_DATE_EPOCH=${epoch}`,
      '--label',
      `org.opencontainers.image.revision=${source.sha}`,
      '--label',
      `org.opencontainers.image.source=${SOURCE_URL}`,
      '--label',
      `org.opencontainers.image.title=${repository.split('/').pop()}`,
      '--label',
      `io.washgo.release.target=${target.id}`,
      '--label',
      `io.washgo.release.role=${role}`,
      '--provenance=mode=max',
      '--sbom=true',
      '--metadata-file',
      metadataFile,
      '--tag',
      `${repository}:${source.sha}`,
      '--push',
      '.',
    ],
    { cwd: ROOT, capture: false, env: { ...process.env, SOURCE_DATE_EPOCH: epoch } },
  );
  const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  const digest = metadata['containerimage.digest'];
  assert.match(digest, /^sha256:[0-9a-f]{64}$/, 'Build metadata must carry the pushed digest');
  const reference = `${repository}@${digest}`;

  const registryView = await registryAttestations(reference);
  assert.equal(registryView.indexDigest, digest, 'Registry digest differs from the pushed digest');
  assert.deepEqual(registryView.platforms, [PLATFORM]);
  assert.equal(registryView.labels['org.opencontainers.image.revision'], source.sha);
  const sbomText = `${JSON.stringify(registryView.sbom, null, 2)}\n`;
  const provenanceText = `${JSON.stringify(registryView.provenance, null, 2)}\n`;
  const hasSbom = Boolean(registryView.sbom?.SPDX);
  const hasProvenance = Boolean(registryView.provenance?.SLSA);
  assert.ok(hasSbom, `No SPDX SBOM attached to ${reference}`);
  assert.ok(hasProvenance, `No SLSA provenance attached to ${reference}`);
  const evidenceDir = path.join(out, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const sbomFile = `${target.id}-${role}.sbom.spdx.json`;
  const provenanceFile = `${target.id}-${role}.provenance.json`;
  writeFileSync(path.join(evidenceDir, sbomFile), sbomText);
  writeFileSync(path.join(evidenceDir, provenanceFile), provenanceText);

  const artifact = {
    id: target.id,
    kind: target.kind,
    role,
    dockerfile,
    repository,
    digest,
    reference,
    platform: PLATFORM,
    tag: source.sha,
    attestations: {
      sbom: hasSbom,
      provenance: hasProvenance,
      registryAttestationManifests: registryView.attestationManifests,
      sbomFile,
      sbomSha256: sha256(sbomText),
      provenanceFile,
      provenanceSha256: sha256(provenanceText),
    },
  };
  if (role === 'migration') {
    artifact.migrationSet = ownerMigrationSet(ROOT, source.sha, target.path);
    artifact.migrationRole = target.migrationRole;
    artifact.runtimeRole = target.runtimeRole;
    artifact.database = target.database;
  }
  return artifact;
}

async function build(options) {
  const { target: id, registry, out } = options;
  assert.ok(id && registry && out, 'build requires --target, --registry and --out');
  const target = inventory().targets.find((t) => t.id === id);
  assert.ok(target, `Unknown catalog target ${id}`);
  assertCleanSource();
  const source = sourceRecord();
  const nodeBase = await resolveNodeBase();
  mkdirSync(out, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), 'cw-release-'));
  try {
    const roles =
      target.kind === 'service' && target.database ? ['runtime', 'migration'] : ['runtime'];
    const artifacts = [];
    for (const role of roles) {
      artifacts.push(await buildOne({ target, role, registry, source, nodeBase, out, work }));
    }
    const part = {
      source,
      registry,
      baseImages: {
        node: nodeBase.reference,
        runtime: toolLock.runtime.image,
        nativeLibraries: toolLock.nativeLibraries.image,
      },
      artifacts,
    };
    writeFileSync(path.join(out, `part-${id}.json`), `${JSON.stringify(part, null, 2)}\n`);
    console.log(JSON.stringify({ target: id, artifacts: artifacts.map((a) => a.reference) }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function assembleParts(parts, registry, expected) {
  assert.ok(parts.length > 0, 'No release parts');
  const [first] = parts;
  for (const part of parts) {
    assert.deepEqual(part.source, first.source, 'Parts were built from different sources');
    assert.deepEqual(part.baseImages, first.baseImages, 'Parts used different base images');
    assert.equal(part.registry, registry, 'Part pushed to a different registry');
  }
  const manifest = {
    kind: MANIFEST_KIND,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    source: first.source,
    registry,
    baseImages: first.baseImages,
    artifacts: parts
      .flatMap((part) => part.artifacts)
      .sort((a, b) => `${a.id}/${a.role}`.localeCompare(`${b.id}/${b.role}`)),
  };
  const problems = validateManifest(manifest, expected);
  assert.deepEqual(problems, [], `Release manifest invalid: ${JSON.stringify(problems)}`);
  return { ...manifest, manifestDigest: manifestDigest(manifest) };
}

function assemble(options) {
  const { registry, parts: dir, out } = options;
  assert.ok(registry && dir && out, 'assemble requires --registry, --parts and --out');
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /(^|[\\/])part-[a-z0-9-]+\.json$/.test(f));
  const parts = files.map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  const manifest = assembleParts(parts, registry, inventory().targets);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify({
      manifest: out,
      manifestDigest: manifest.manifestDigest,
      artifacts: manifest.artifacts.length,
    }),
  );
}

/**
 * Rehearsal registry for pull-request runs: the official registry image,
 * resolved to a digest and run by digest on loopback. Pull requests never get
 * credentials for the real registry.
 */
async function localRegistry(options) {
  const port = options.port ?? '5000';
  assert.match(port, /^[0-9]{2,5}$/);
  let reference;
  for (const candidate of officialImagePullCandidates('registry:3.0.0')) {
    const result = await command(
      'docker',
      ['buildx', 'imagetools', 'inspect', candidate, '--format', '{{json .Manifest}}'],
      { capture: true, timeoutMs: 300_000 },
    );
    if (result.code !== 0) continue;
    reference = `${candidate.replace(/:[^:/]+$/, '')}@${JSON.parse(result.stdout).digest}`;
    break;
  }
  assert.ok(reference, 'Cannot resolve registry:3.0.0 to a digest');
  await docker([
    'run',
    '-d',
    '--name',
    'cw-release-registry',
    '--publish',
    `127.0.0.1:${port}:5000`,
    reference,
  ]);
  console.log(JSON.stringify({ registryImage: reference, endpoint: `localhost:${port}` }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = args(process.argv.slice(2));
  const run = { build, assemble, 'local-registry': localRegistry }[options._];
  if (!run) {
    console.error('usage: build-release.mjs build|assemble|local-registry ...');
    process.exit(2);
  }
  Promise.resolve(run(options)).catch((error) => {
    console.error(error.stack ?? error.message);
    process.exit(1);
  });
}
