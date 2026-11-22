import assert from 'node:assert/strict';
import { trivyFindings } from './policy.mjs';
import {
  assertLegacyConverterEvidence,
  GLIBC_PURL,
  REMOVED_CONVERTER_CVES,
} from './runtime-hardening.mjs';

// Narrow the existing VEX preflight: never exempt a different package,
// version, distribution or architecture simply because its CVE matches.
export function assessUnfilteredImageScan(report, architecture, hardening) {
  const findings = trivyFindings(report);
  const raw = report.Results.flatMap((result) => result.Vulnerabilities ?? []);
  // A detached proof from a different build, partial paths, a different base or
  // modified package inventory cannot change the unfiltered verdict.
  let removedConverterProof = false;
  if (hardening !== undefined) {
    assertLegacyConverterEvidence(hardening, report.Metadata?.ImageID);
    removedConverterProof = true;
  }
  const reviewed = (finding, index) =>
    architecture === 'amd64' &&
    report.Metadata?.OS?.Family === 'debian' &&
    report.Metadata?.OS?.Name === '13.7' &&
    (finding.id === 'CVE-2026-97399' ||
      (removedConverterProof && REMOVED_CONVERTER_CVES.includes(finding.id))) &&
    finding.package === 'libc6' &&
    finding.installed === '2.41-12+deb13u4' &&
    raw[index]?.PkgIdentifier?.PURL === GLIBC_PURL;
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
