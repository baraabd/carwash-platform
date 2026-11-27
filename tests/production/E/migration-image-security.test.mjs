import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMigrationScan } from '../../../scripts/production/E/release/scan-migration-image.mjs';

const imageId = `sha256:${'a'.repeat(64)}`;
const report = () => ({
  SchemaVersion: 2,
  ArtifactType: 'container_image',
  Metadata: { ImageID: imageId, OS: { Family: 'debian', Name: '12' } },
  Results: [{ Target: 'debian', Vulnerabilities: [], Secrets: [] }],
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
