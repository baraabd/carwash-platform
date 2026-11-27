import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMigrationScan } from '../../../scripts/production/E/release/scan-migration-image.mjs';
import {
  HARDENED_NATIVE_IMAGE,
  HARDENED_RUNTIME_IMAGE,
  GLIBC_PURL,
  GLIBC_METADATA_SHA256,
  REMOVED_CONVERTER_PATHS,
} from '../../../scripts/ci/runtime-hardening.mjs';

const imageId = `sha256:${'a'.repeat(64)}`;
const report = () => ({
  SchemaVersion: 2,
  ArtifactType: 'container_image',
  Metadata: { ImageID: imageId, OS: { Family: 'debian', Name: '12' } },
  Results: [{ Target: 'debian', Vulnerabilities: [], Secrets: [] }],
});

const migrationProof = () => ({
  imageId,
  role: 'migration',
  schemaVersion: 1,
  architecture: 'amd64',
  runtimeImage: HARDENED_RUNTIME_IMAGE,
  nativeImage: HARDENED_NATIVE_IMAGE,
  node: 'v24.21.0',
  prisma: '7.10.0',
  uid: 1000,
  schemaEngine: true,
  crypto: true,
  tls: true,
  packageInventory: true,
  toolSurface: true,
  packagePurl: GLIBC_PURL,
  packageRecordSha256: GLIBC_METADATA_SHA256.record,
  packageChecksumsSha256: GLIBC_METADATA_SHA256.md5sums,
  absentPaths: [...REMOVED_CONVERTER_PATHS],
  unicode: true,
  arabic: true,
  intl: true,
  originalPackageMetadata: true,
});

test('migration hardening applies only with its own bound native proof and exact absent code', () => {
  const value = report();
  value.Metadata.OS.Name = '13.7';
  value.Results[0].Vulnerabilities.push({
    VulnerabilityID: 'CVE-2026-121758',
    PkgName: 'libc6',
    InstalledVersion: '2.41-12+deb13u4',
    Severity: 'UNKNOWN',
    PkgIdentifier: { PURL: GLIBC_PURL },
  });
  assert.equal(assessMigrationScan(value, imageId).blocking.length, 1);
  assert.equal(assessMigrationScan(value, imageId, migrationProof()).blocking.length, 0);
  for (const change of [
    { role: 'runtime' },
    { imageId: `sha256:${'b'.repeat(64)}` },
    { schemaEngine: false },
    { absentPaths: [] },
    { packageRecordSha256: 'changed' },
    { nativeImage: 'unreviewed' },
    { prisma: '7.9.0' },
    { uid: 0 },
  ])
    assert.throws(() => assessMigrationScan(value, imageId, { ...migrationProof(), ...change }));
  value.Results[0].Vulnerabilities.push({
    VulnerabilityID: 'CVE-2099-UNRELATED',
    PkgName: 'libssl3t64',
    InstalledVersion: '3.5.9',
    Severity: 'CRITICAL',
  });
  assert.equal(assessMigrationScan(value, imageId, migrationProof()).blocking.length, 1);
  value.Results[0].Vulnerabilities[0].PkgIdentifier.PURL = 'another-package';
  assert.equal(assessMigrationScan(value, imageId, migrationProof()).blocking.length, 2);
});

test('migration security refuses empty, wrong-image and absent OS evidence', () => {
  assert.throws(() => assessMigrationScan({}, imageId));
  assert.throws(() => assessMigrationScan({ ...report(), Results: [] }, imageId));
  assert.throws(() => assessMigrationScan(report(), `sha256:${'b'.repeat(64)}`));
  const absent = report();
  delete absent.Metadata.OS;
  assert.throws(() => assessMigrationScan(absent, imageId));
});
test('migration image has no runtime-only CVE exceptions and reports secrets only as counts', () => {
  const value = report();
  value.Results[0].Vulnerabilities.push({
    VulnerabilityID: 'CVE-2026-97399',
    PkgName: 'libc6',
    InstalledVersion: '2.41-12+deb13u4',
    Severity: 'HIGH',
  });
  value.Results[0].Secrets.push({ Match: 'never include this value in retained evidence' });
  const assessed = assessMigrationScan(value, imageId);
  assert.equal(assessed.blocking.length, 1);
  assert.equal(assessed.secretCount, 1);
  assert.ok(!JSON.stringify(assessed).includes('never include'));
  assert.deepEqual(assessMigrationScan(report(), imageId), {
    findings: [],
    secretCount: 0,
    blocking: [],
  });
});
