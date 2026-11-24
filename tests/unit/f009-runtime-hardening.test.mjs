import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { inventory, ROOT } from '../../scripts/ci/policy.mjs';
import { assessUnfilteredImageScan } from '../../scripts/ci/image-security.mjs';
import {
  assertHardenedRuntimeSbom,
  assertLegacyConverterEvidence,
  GLIBC_METADATA_SHA256,
  GLIBC_PURL,
  HARDENED_NATIVE_IMAGE,
  HARDENED_RUNTIME_IMAGE,
  REMOVED_CONVERTERS,
  REMOVED_CONVERTER_CVES,
  REMOVED_CONVERTER_PATHS,
  REMOVE_LEGACY_CONVERTERS,
  REMOVE_LEGACY_CONVERTERS_DOCKER,
} from '../../scripts/ci/runtime-hardening.mjs';
import { renderServiceFiles } from '../../scripts/dev/service-template.mjs';

const imageId = `sha256:${'a'.repeat(64)}`;
const proof = () => ({
  schemaVersion: 1,
  imageId,
  runtimeImage: HARDENED_RUNTIME_IMAGE,
  architecture: 'amd64',
  packagePurl: GLIBC_PURL,
  packageRecordSha256: GLIBC_METADATA_SHA256.record,
  packageChecksumsSha256: GLIBC_METADATA_SHA256.md5sums,
  absentPaths: [...REMOVED_CONVERTER_PATHS],
  unicode: true,
  arabic: true,
  intl: true,
  originalPackageMetadata: true,
});
const finding = (id) => ({
  VulnerabilityID: id,
  PkgName: 'libc6',
  InstalledVersion: '2.41-12+deb13u4',
  Severity: 'UNKNOWN',
  PkgIdentifier: { PURL: GLIBC_PURL },
});
const scan = (findings = REMOVED_CONVERTER_CVES.map(finding)) => ({
  SchemaVersion: 2,
  Metadata: { ImageID: imageId, OS: { Family: 'debian', Name: '13.7' } },
  Results: [{ Vulnerabilities: findings }],
});

test('all runtime Dockerfiles and the generator remove the same four modules before dropping privileges', () => {
  const files = [
    'Dockerfile',
    ...inventory().targets.map((target) => `${target.path}/Dockerfile`),
  ].map((file) => readFileSync(path.join(ROOT, file), 'utf8'));
  files.push(renderServiceFiles('identity').get('Dockerfile'));
  for (const source of files) {
    assert.ok(source.includes(`ARG RUNTIME_IMAGE=${HARDENED_RUNTIME_IMAGE}`));
    assert.ok(source.includes(`ARG NATIVE_RUNTIME_IMAGE=${HARDENED_NATIVE_IMAGE}`));
    const removal = source.indexOf(REMOVE_LEGACY_CONVERTERS_DOCKER);
    assert.ok(removal > source.indexOf('COPY --from=builder /usr/local/bin/node'));
    assert.ok(
      removal >
        source.indexOf('COPY --from=native_libraries /usr/lib/x86_64-linux-gnu/libstdc++.so.6'),
    );
    assert.ok(source.indexOf('USER 1000:1000', removal) > removal);
  }
});

test('build removal deletes vulnerable code while preserving other converters and package provenance', () => {
  const removed = [];
  const originals = REMOVED_CONVERTERS.map((name) => `/usr/lib/x86_64-linux-gnu/gconv/${name}`);
  const keep = [
    '/usr/lib/x86_64-linux-gnu/gconv/UTF-16.so',
    '/var/lib/dpkg/status.d/libc6',
    '/var/lib/dpkg/status.d/libc6.md5sums',
    '/usr/share/doc/libc6/copyright',
  ];
  const files = new Set([...originals, ...keep]);
  const fs = {
    lstatSync(file) {
      assert.ok(files.has(file));
      return { isFile: () => true };
    },
    unlinkSync(file) {
      assert.ok(files.delete(file));
      removed.push(file);
    },
  };
  runInNewContext(REMOVE_LEGACY_CONVERTERS, {
    require: (name) => {
      assert.equal(name, 'node:fs');
      return fs;
    },
  });
  assert.deepEqual(removed, originals);
  assert.deepEqual([...files], keep);
});

test('removal rejects a symlink or unexpected converter file instead of changing arbitrary targets', () => {
  let deleted = false;
  assert.throws(
    () =>
      runInNewContext(REMOVE_LEGACY_CONVERTERS, {
        require: () => ({
          lstatSync: () => ({ isFile: () => false }),
          unlinkSync: () => {
            deleted = true;
          },
        }),
      }),
    /UNEXPECTED_CONVERTER_FILE/,
  );
  assert.equal(deleted, false);
});

test('complete hardening proof is bound to the immutable image and original package bytes', () => {
  assert.doesNotThrow(() => assertLegacyConverterEvidence(proof(), imageId));
  for (const change of [
    { imageId: `sha256:${'b'.repeat(64)}` },
    { runtimeImage: HARDENED_NATIVE_IMAGE },
    { schemaVersion: 2 },
    { architecture: 'arm64' },
    { packagePurl: GLIBC_PURL.replace('deb13u4', 'deb13u5') },
    { packageRecordSha256: '0'.repeat(64) },
    { packageChecksumsSha256: '0'.repeat(64) },
    { absentPaths: REMOVED_CONVERTER_PATHS.slice(1) },
    { absentPaths: [...REMOVED_CONVERTER_PATHS, REMOVED_CONVERTER_PATHS[0]] },
    { unicode: false },
    { arabic: false },
    { intl: false },
    { originalPackageMetadata: false },
  ])
    assert.throws(() => assertLegacyConverterEvidence({ ...proof(), ...change }, imageId));
  assert.throws(() => assertLegacyConverterEvidence(undefined, imageId));
  assert.throws(() => assertLegacyConverterEvidence(proof(), undefined));
});

test('unmodified upstream glibc findings remain blocking without final filesystem proof', () => {
  const result = assessUnfilteredImageScan(scan(), 'amd64');
  assert.equal(result.unreviewedBlocking.length, 3);
  assert.equal(result.reviewedFindingCount, 0);
});

test('only exact removed-code findings can be reviewed after complete matching proof', () => {
  const result = assessUnfilteredImageScan(scan(), 'amd64', proof());
  assert.deepEqual(result.unreviewedBlocking, []);
  assert.equal(result.reviewedFindingCount, 3);
  assert.equal(result.findings.length, 3, 'Unfiltered findings must remain in the evidence');
  assert.ok(result.findings.every((item) => item.blocking));
});

test('a copied proof from another image or incomplete proof cannot certify a scan', () => {
  const other = scan();
  other.Metadata.ImageID = `sha256:${'b'.repeat(64)}`;
  assert.throws(() => assessUnfilteredImageScan(other, 'amd64', proof()));
  assert.throws(() => assessUnfilteredImageScan(scan(), 'amd64', { ...proof(), absentPaths: [] }));
});

test('package, version, distribution, architecture and unknown CVEs still block', () => {
  for (const change of [
    { PkgName: 'other-package' },
    { InstalledVersion: '2.41-12+deb13u5' },
    { PkgIdentifier: undefined },
    { PkgIdentifier: { PURL: GLIBC_PURL.replace('amd64', 'arm64') } },
    { VulnerabilityID: 'CVE-2099-99999' },
  ]) {
    const result = assessUnfilteredImageScan(
      scan([{ ...finding(REMOVED_CONVERTER_CVES[0]), ...change }]),
      'amd64',
      proof(),
    );
    assert.equal(result.unreviewedBlocking.length, 1);
  }
  for (const architecture of ['arm64', undefined])
    assert.equal(
      assessUnfilteredImageScan(scan(), architecture, proof()).unreviewedBlocking.length,
      3,
    );
  for (const os of [
    { Family: 'ubuntu', Name: '13.7' },
    { Family: 'debian', Name: '14' },
  ]) {
    const value = scan();
    value.Metadata.OS = os;
    assert.equal(assessUnfilteredImageScan(value, 'amd64', proof()).unreviewedBlocking.length, 3);
  }
});

test('runtime SBOM retains original libc identity and the patched CA certificate package', () => {
  const sbom = () => ({
    bomFormat: 'CycloneDX',
    components: [
      { name: 'libc6', version: '2.41-12+deb13u4', purl: GLIBC_PURL },
      { name: 'ca-certificates', version: '20250419+deb13u1' },
    ],
  });
  assert.doesNotThrow(() => assertHardenedRuntimeSbom(sbom()));
  for (const mutate of [
    (value) => value.components.shift(),
    (value) => value.components.push(value.components[0]),
    (value) => {
      value.components[0].version = 'patched-unrecorded';
    },
    (value) => {
      value.components[0].purl = 'pkg:deb/debian/libc6';
    },
    (value) => {
      value.components[1].version = '20250419';
    },
  ]) {
    const value = sbom();
    mutate(value);
    assert.throws(() => assertHardenedRuntimeSbom(value));
  }
});

test('new VEX statements name only the exact package and three removed legacy converter vulnerabilities', () => {
  const vex = JSON.parse(
    readFileSync(path.join(ROOT, 'security/vex/removed-legacy-converters.openvex.json'), 'utf8'),
  );
  assert.deepEqual(
    vex.statements.map((statement) => statement.vulnerability.name),
    [...REMOVED_CONVERTER_CVES],
  );
  for (const statement of vex.statements) {
    assert.deepEqual(statement.products, [{ '@id': GLIBC_PURL }]);
    assert.equal(statement.justification, 'vulnerable_code_not_present');
    assert.match(statement.impact_statement, /mandatory absence checks/);
    assert.match(statement.impact_statement, /does not apply to the upstream distroless image/);
  }
});
