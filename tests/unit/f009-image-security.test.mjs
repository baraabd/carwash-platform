import test from 'node:test';
import assert from 'node:assert/strict';
import { assessUnfilteredImageScan } from '../../scripts/ci/image-security.mjs';

const reviewedFinding = () => ({
  VulnerabilityID: 'CVE-2026-97399',
  PkgName: 'libc6',
  InstalledVersion: '2.41-12+deb13u4',
  Severity: 'UNKNOWN',
  PkgIdentifier: { PURL: 'pkg:deb/debian/libc6@2.41-12%2Bdeb13u4?arch=amd64&distro=debian-13.7' },
});
const report = (vulnerabilities = []) => ({
  SchemaVersion: 2,
  Metadata: { OS: { Family: 'debian', Name: '13.7' } },
  Results: [{ Vulnerabilities: vulnerabilities }],
});
test('unfiltered clean inventory is explicit rather than missing evidence', () => {
  assert.deepEqual(assessUnfilteredImageScan(report(), 'amd64'), {
    findings: [],
    secretCount: 0,
    unreviewedBlocking: [],
    reviewedFindingCount: 0,
  });
  for (const invalid of [{}, { SchemaVersion: 2, Results: [] }])
    assert.throws(() => assessUnfilteredImageScan(invalid, 'amd64'));
});
test('only the reviewed exact amd64 glibc finding is eligible for VEX evaluation', () => {
  const result = assessUnfilteredImageScan(report([reviewedFinding()]), 'amd64');
  assert.equal(result.findings[0].blocking, true);
  assert.equal(result.reviewedFindingCount, 1);
  assert.deepEqual(result.unreviewedBlocking, []);
});
test('both reported OpenSSL CVEs remain blocking alongside the reviewed finding', () => {
  const vulnerabilities = ['CVE-2026-75804', 'CVE-2026-84782'].map((id) => ({
    VulnerabilityID: id,
    PkgName: 'libssl3t64',
    InstalledVersion: '3.5.7-1~deb13u2',
    FixedVersion: '3.5.7-1~deb13u3',
    Severity: 'HIGH',
  }));
  const result = assessUnfilteredImageScan(
    report([reviewedFinding(), ...vulnerabilities]),
    'amd64',
  );
  assert.equal(result.reviewedFindingCount, 1);
  assert.equal(result.unreviewedBlocking.length, 2);
  assert.deepEqual(
    result.unreviewedBlocking.map((v) => v.id),
    vulnerabilities.map((v) => v.VulnerabilityID),
  );
});
test('UNKNOWN findings do not receive a blanket exemption', () => {
  const finding = { ...reviewedFinding(), VulnerabilityID: 'CVE-2099-10000' };
  assert.equal(assessUnfilteredImageScan(report([finding]), 'amd64').unreviewedBlocking.length, 1);
});
test('CVE matching cannot exempt another package, version or missing PURL', () => {
  for (const change of [
    { PkgName: 'other' },
    { InstalledVersion: '2.42-1' },
    { PkgIdentifier: undefined },
    { PkgIdentifier: { PURL: 'pkg:deb/debian/libc6?arch=ppc64el' } },
  ]) {
    const result = assessUnfilteredImageScan(
      report([{ ...reviewedFinding(), ...change }]),
      'amd64',
    );
    assert.equal(result.reviewedFindingCount, 0);
    assert.equal(result.unreviewedBlocking.length, 1);
  }
});
test('unproven architecture and distribution remain blocking', () => {
  for (const architecture of ['arm64', 'ppc64le', undefined])
    assert.equal(
      assessUnfilteredImageScan(report([reviewedFinding()]), architecture).unreviewedBlocking
        .length,
      1,
    );
  for (const metadata of [
    undefined,
    { OS: { Family: 'ubuntu', Name: '13.7' } },
    { OS: { Family: 'debian', Name: '14' } },
  ]) {
    const value = report([reviewedFinding()]);
    value.Metadata = metadata;
    assert.equal(assessUnfilteredImageScan(value, 'amd64').unreviewedBlocking.length, 1);
  }
});
test('secret evidence records counts without retaining credential snippets', () => {
  const value = report();
  value.Results[0].Secrets = [
    { Match: 'private-fixture-sentinel', Code: { Lines: ['private-fixture-sentinel'] } },
  ];
  const result = assessUnfilteredImageScan(value, 'amd64');
  assert.equal(result.secretCount, 1);
  assert.ok(!JSON.stringify(result).includes('private-fixture-sentinel'));
  value.Results[0].Secrets = 'malformed';
  assert.throws(() => assessUnfilteredImageScan(value, 'amd64'));
});
