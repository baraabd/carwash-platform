import assert from 'node:assert/strict';
import { trivyFindings } from './policy.mjs';

// Narrow the existing VEX preflight: never exempt a different package,
// version, distribution or architecture simply because its CVE matches.
export function assessUnfilteredImageScan(report, architecture) {
  const findings = trivyFindings(report);
  const raw = report.Results.flatMap((result) => result.Vulnerabilities ?? []);
  const reviewed = (finding, index) =>
    architecture === 'amd64' &&
    report.Metadata?.OS?.Family === 'debian' &&
    report.Metadata?.OS?.Name === '13.7' &&
    finding.id === 'CVE-2026-97399' &&
    finding.package === 'libc6' &&
    finding.installed === '2.41-12+deb13u4' &&
    raw[index]?.PkgIdentifier?.PURL ===
      'pkg:deb/debian/libc6@2.41-12%2Bdeb13u4?arch=amd64&distro=debian-13.7';
  const secretCount = report.Results.reduce((sum, result) => {
    assert.ok(result.Secrets === undefined || Array.isArray(result.Secrets));
    return sum + (result.Secrets?.length ?? 0);
  }, 0);
  return {
    findings,
    secretCount,
    unreviewedBlocking: findings.filter(
      (finding, index) => finding.blocking && !reviewed(finding, index),
    ),
    reviewedFindingCount: findings.filter(
      (finding, index) => finding.blocking && reviewed(finding, index),
    ).length,
  };
}
