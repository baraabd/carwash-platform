#!/usr/bin/env node
/** Scan the actual pulled migration digest; runtime-image evidence cannot replace this gate. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, tool, toolLock, git } from '../../../ci/runtime.mjs';
import { trivyFindings } from '../../../ci/policy.mjs';
import { assessUnfilteredImageScan } from '../../../ci/image-security.mjs';
import { MIGRATION_RUNTIME_PROBE, assertMigrationRuntimeProof } from './migration-runtime.mjs';

export function assessMigrationScan(report, imageId, migrationProof) {
  assert.match(imageId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    report?.ArtifactType,
    'container_image',
    'Migration scan must cover a container image',
  );
  assert.equal(report?.Metadata?.ImageID, imageId, 'Scan belongs to a different migration image');
  assert.ok(report.Metadata.OS?.Family, 'Migration OS inventory is missing');
  const findings = trivyFindings(report);
  let secretCount = 0;
  for (const result of report.Results) {
    assert.ok(result.Secrets === undefined || Array.isArray(result.Secrets));
    secretCount += result.Secrets?.length ?? 0;
  }
  // Without fresh proof from THIS migration image, every finding is blocking.
  // A runtime-only receipt cannot establish native Prisma/OS compatibility.
  if (migrationProof !== undefined) {
    assertMigrationRuntimeProof(migrationProof, imageId);
    const assessment = assessUnfilteredImageScan(report, 'amd64', migrationProof);
    return { findings, secretCount, blocking: assessment.unreviewedBlocking };
  }
  return { findings, secretCount, blocking: findings.filter((finding) => finding.blocking) };
}

async function run(partFile, reportFile) {
  assert.ok(partFile && reportFile, '--part and --report are required');
  const part = JSON.parse(readFileSync(partFile, 'utf8'));
  assert.equal(part.source.sha, git('rev-parse', 'HEAD'));
  assert.equal(part.source.tree, git('rev-parse', 'HEAD^{tree}'));
  const artifacts = part.artifacts.filter((artifact) => artifact.role === 'migration');
  assert.equal(artifacts.length, 1, 'This gate requires exactly one owner migration artifact');
  const artifact = artifacts[0];
  assert.equal(artifact.reference, `${artifact.repository}@${artifact.digest}`);
  assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/);
  const directory = mkdtempSync(path.join(tmpdir(), 'cw-migration-scan-'));
  const evidence = {
    schemaVersion: 1,
    sourceSha: part.source.sha,
    sourceTree: part.source.tree,
    target: artifact.id,
    role: 'migration',
    reference: artifact.reference,
    scannerVersion: toolLock.tools.trivy.version,
    accepted: false,
  };
  try {
    const inspected = await command('docker', ['image', 'inspect', artifact.reference], {
      capture: true,
    });
    assert.equal(inspected.code, 0, 'Migration image must first be pulled by its immutable digest');
    const [image] = JSON.parse(inspected.stdout);
    assert.ok(image.RepoDigests.includes(artifact.reference));
    assert.equal(image.Config.Labels['org.opencontainers.image.revision'], part.source.sha);
    assert.equal(image.Config.Labels['io.washgo.release.role'], 'migration');
    assert.equal(image.Config.Labels['io.washgo.release.target'], artifact.id);
    evidence.imageId = image.Id;
    assert.equal(image.Architecture, 'amd64', 'Migration ABI proof requires linux/amd64');
    const probe = await command(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--user',
        '1000:1000',
        '--entrypoint',
        '/usr/local/bin/node',
        artifact.reference,
        '-e',
        MIGRATION_RUNTIME_PROBE,
      ],
      { capture: true, timeoutMs: 30000 },
    );
    assert.equal(probe.code, 0, 'Migration native runtime/metadata proof failed');
    const migrationProof = { ...JSON.parse(probe.stdout.trim()), imageId: image.Id };
    assertMigrationRuntimeProof(migrationProof, image.Id);
    evidence.migrationRuntime = migrationProof;
    const output = path.join(directory, 'raw.json');
    const scanned = await command(
      tool('trivy'),
      [
        'image',
        '--scanners',
        'vuln,secret',
        '--format',
        'json',
        '--output',
        output,
        '--exit-code',
        '0',
        '--severity',
        'HIGH,CRITICAL,UNKNOWN',
        '--timeout',
        '10m',
        artifact.reference,
      ],
      { capture: true, timeoutMs: 720000 },
    );
    assert.equal(
      scanned.code,
      0,
      'Migration image scanner failed; incomplete scanning is not acceptance',
    );
    const assessment = assessMigrationScan(
      JSON.parse(readFileSync(output, 'utf8')),
      image.Id,
      migrationProof,
    );
    Object.assign(evidence, assessment);
    assert.equal(assessment.secretCount, 0, 'Migration image contains a secret finding');
    assert.deepEqual(assessment.blocking, [], 'Migration image has blocking vulnerabilities');
    evidence.accepted = true;
  } finally {
    // Persist only redacted inventory/counts, never secret matches or raw scan logs.
    writeFileSync(
      reportFile,
      `${JSON.stringify({ ...evidence, scannedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name) => {
    const index = process.argv.indexOf(`--${name}`);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  run(option('part'), option('report')).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
