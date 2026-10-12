#!/usr/bin/env node
/**
 * Verifies a release manifest against the registry and the source (P07-E1).
 *
 *   verify-release.mjs --manifest <file> [--pull true] [--report <file>]
 *   verify-release.mjs --part <part.json> ...   one target, coverage limited to it
 *
 * Checks, for every artifact, using ONLY the digest reference:
 *   - the manifest is structurally valid and covers every catalog target,
 *   - the registry serves that exact digest for linux/amd64,
 *   - the image config's revision label equals the manifest source commit,
 *   - an SPDX SBOM and SLSA provenance are attached in the registry and hash to
 *     the evidence recorded at build time,
 *   - the provenance names the source commit,
 *   - each migration image's migration set equals the set at that commit,
 *   - with --pull, `docker pull <repo>@<digest>` yields that digest locally.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, ROOT } from '../../../ci/policy.mjs';
import { command } from '../../../ci/runtime.mjs';
import { assembleParts, registryAttestations } from './build-release.mjs';
import { gitAt, manifestDigest, ownerMigrationSet, validateManifest } from './manifest.mjs';

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

export async function verifyManifest(
  manifest,
  { pull = false, expected = inventory().targets } = {},
) {
  const results = [];
  const { manifestDigest: recorded, ...body } = manifest;
  const structural = validateManifest(body, expected);
  results.push({ check: 'structure', ok: structural.length === 0, problems: structural });
  results.push({
    check: 'manifest-digest',
    ok: recorded === manifestDigest(body),
  });
  results.push({
    check: 'source-commit-present',
    ok: gitAt(ROOT, 'rev-parse', `${body.source.sha}^{tree}`) === body.source.tree,
  });

  for (const artifact of body.artifacts) {
    const key = `${artifact.id}/${artifact.role}`;
    const problems = [];
    try {
      const view = await registryAttestations(artifact.reference);
      if (view.indexDigest !== artifact.digest) problems.push('REGISTRY_DIGEST');
      if (view.platforms.join(',') !== artifact.platform) problems.push('PLATFORM');
      if (view.labels['org.opencontainers.image.revision'] !== body.source.sha) {
        problems.push('REVISION_LABEL');
      }
      if (view.labels['io.washgo.release.role'] !== artifact.role) problems.push('ROLE_LABEL');
      if (view.labels['io.washgo.release.target'] !== artifact.id) problems.push('TARGET_LABEL');
      if (!view.sbom?.SPDX) problems.push('SBOM_MISSING');
      if (!view.provenance?.SLSA) problems.push('PROVENANCE_MISSING');
      if (sha256(`${JSON.stringify(view.sbom, null, 2)}\n`) !== artifact.attestations.sbomSha256) {
        problems.push('SBOM_CHANGED');
      }
      const provenanceText = `${JSON.stringify(view.provenance, null, 2)}\n`;
      if (sha256(provenanceText) !== artifact.attestations.provenanceSha256) {
        problems.push('PROVENANCE_CHANGED');
      }
      if (!provenanceText.includes(body.source.sha)) problems.push('PROVENANCE_SOURCE');
      if (artifact.role === 'migration') {
        const set = ownerMigrationSet(ROOT, body.source.sha, `services/${artifact.id}`);
        if (set.digest !== artifact.migrationSet.digest) problems.push('MIGRATION_SET');
      }
      if (pull) {
        const pulled = await command('docker', ['pull', '--quiet', artifact.reference], {
          capture: true,
          timeoutMs: 1_800_000,
        });
        if (pulled.code !== 0) problems.push('PULL_BY_DIGEST');
        else {
          const inspected = await command(
            'docker',
            ['image', 'inspect', '--format', '{{json .RepoDigests}}', artifact.reference],
            { capture: true },
          );
          const digests = inspected.code === 0 ? JSON.parse(inspected.stdout) : [];
          if (!digests.includes(artifact.reference)) problems.push('PULLED_DIGEST');
        }
      }
    } catch (error) {
      problems.push(`REGISTRY_ERROR: ${error.message.slice(0, 300)}`);
    }
    results.push({
      check: `artifact ${key}`,
      reference: artifact.reference,
      ok: problems.length === 0,
      problems,
    });
  }
  return { accepted: results.every((r) => r.ok), results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const option = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = option('manifest');
  const partFile = option('part');
  assert.ok(Boolean(file) !== Boolean(partFile), 'exactly one of --manifest or --part is required');
  let manifest;
  let expected = inventory().targets;
  if (partFile) {
    // One target's part, verified on the runner that still reaches its registry.
    const part = JSON.parse(readFileSync(partFile, 'utf8'));
    expected = expected.filter((t) => t.id === part.artifacts[0]?.id);
    manifest = assembleParts([part], part.registry, expected);
  } else {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  }
  verifyManifest(manifest, { pull: option('pull') === 'true', expected })
    .then((report) => {
      const output = {
        manifestDigest: manifest.manifestDigest,
        sourceSha: manifest.source.sha,
        registry: manifest.registry,
        pulled: option('pull') === 'true',
        verifiedAt: new Date().toISOString(),
        ...report,
      };
      const reportFile = option('report');
      if (reportFile) writeFileSync(reportFile, `${JSON.stringify(output, null, 2)}\n`);
      for (const r of report.results) {
        console.log(
          `${r.ok ? 'PASS' : 'FAIL'} ${r.check}${r.ok ? '' : ` ${JSON.stringify(r.problems)}`}`,
        );
      }
      console.log(report.accepted ? 'RELEASE VERIFIED' : 'RELEASE NOT VERIFIED');
      process.exit(report.accepted ? 0 : 1);
    })
    .catch((error) => {
      console.error(error.stack ?? error.message);
      process.exit(1);
    });
}
