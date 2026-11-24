import assert from 'node:assert/strict';

// Resolved from the official distroless registry and checked against its layer
// digests. This refresh includes Debian's ca-certificates 20250419+deb13u1.
export const HARDENED_RUNTIME_IMAGE =
  'gcr.io/distroless/base-nossl-debian13@sha256:89815d620ac01d8de13cdaf04d19ed874447ca2296d4985b14b818f6e5e47854';
export const HARDENED_NATIVE_IMAGE =
  'gcr.io/distroless/cc-debian13@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2';
export const GLIBC_PURL = 'pkg:deb/debian/libc6@2.41-12%2Bdeb13u4?arch=amd64&distro=debian-13.7';
export const GLIBC_METADATA_SHA256 = Object.freeze({
  record: '77d08ed11ba8db4ea027adfdaf1b84a64a3d233d065fd839ce0ec7b0f4d99bc1',
  md5sums: '8a91f27df9121bec724110bf9e5c25268514bc6df2d95c058e469ca97522f287',
});
export const REMOVED_CONVERTERS = Object.freeze([
  'UHC.so',
  'ISO-2022-CN-EXT.so',
  'IBM1390.so',
  'IBM1399.so',
]);
export const REMOVED_CONVERTER_CVES = Object.freeze([
  'CVE-2026-121757',
  'CVE-2026-121758',
  'CVE-2026-124024',
]);
export const REMOVED_CONVERTER_PATHS = Object.freeze(
  ['/usr/lib/x86_64-linux-gnu/gconv', '/lib/x86_64-linux-gnu/gconv'].flatMap((directory) =>
    REMOVED_CONVERTERS.map((name) => `${directory}/${name}`),
  ),
);

// Build-time removal executes the exact pinned Node binary after its ABI
// libraries have been copied. No shell or package manager enters the runtime.
// Package records, checksums and licences remain intact for a truthful SBOM.
export const REMOVE_LEGACY_CONVERTERS =
  `const fs=require('node:fs');for(const name of ${JSON.stringify(REMOVED_CONVERTERS)})` +
  `{const file='/usr/lib/x86_64-linux-gnu/gconv/'+name;` +
  `if(!fs.lstatSync(file).isFile())throw Error('UNEXPECTED_CONVERTER_FILE');fs.unlinkSync(file);}`;
export const REMOVE_LEGACY_CONVERTERS_DOCKER = `USER 0\nRUN ${JSON.stringify(['/usr/local/bin/node', '-e', REMOVE_LEGACY_CONVERTERS])}`;

// Runs inside the final immutable image, before the unfiltered scanner is
// evaluated. UTF-8, Arabic and ICU remain functional after removing these
// unused system iconv converters. Neither package metadata nor findings vanish.
export const LEGACY_CONVERTER_RUNTIME_PROBE = String.raw`
  const converterPaths = ${JSON.stringify(REMOVED_CONVERTER_PATHS)};
  for (const file of converterPaths) {
    assert.equal(fs.existsSync(file), false, 'LEGACY_CONVERTER_PRESENT: ' + file);
    assert.throws(() => fs.lstatSync(file), { code: 'ENOENT' });
  }
  const libcRecord = fs.readFileSync('/var/lib/dpkg/status.d/libc6');
  const libcChecksums = fs.readFileSync('/var/lib/dpkg/status.d/libc6.md5sums');
  assert.equal(crypto.createHash('sha256').update(libcRecord).digest('hex'), '${GLIBC_METADATA_SHA256.record}');
  assert.equal(crypto.createHash('sha256').update(libcChecksums).digest('hex'), '${GLIBC_METADATA_SHA256.md5sums}');
  assert.ok(fs.readFileSync('/usr/share/doc/libc6/copyright').length > 0);
  for (const name of ${JSON.stringify(REMOVED_CONVERTERS)})
    assert.ok(libcChecksums.toString().includes('usr/lib/x86_64-linux-gnu/gconv/' + name));
  const unicodeSample = 'غسيل سيارات WashGo — العربية ١٢٣';
  assert.equal(Buffer.from(unicodeSample, 'utf8').toString('utf8'), unicodeSample);
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(unicodeSample)), unicodeSample);
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.of(0xc0, 0xaf)));
  assert.equal(new Intl.NumberFormat('ar', { useGrouping: false, numberingSystem: 'arab' }).format(123), '١٢٣');
  const dateParts = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date('2026-11-22T12:00:00.000Z'));
  assert.equal(dateParts.find(part => part.type === 'year').value, '2026');
  assert.equal(dateParts.find(part => part.type === 'month').value, '11');
  assert.equal(dateParts.find(part => part.type === 'day').value, '22');
  const legacyConverters = {
    schemaVersion: 1, architecture: process.arch === 'x64' ? 'amd64' : process.arch,
    packagePurl: '${GLIBC_PURL}',
    packageRecordSha256: crypto.createHash('sha256').update(libcRecord).digest('hex'),
    packageChecksumsSha256: crypto.createHash('sha256').update(libcChecksums).digest('hex'),
    absentPaths: converterPaths, unicode: true, arabic: true, intl: true, originalPackageMetadata: true,
  };
`;

/** A missing proof, another image, or a changed package cannot activate VEX. */
export function assertLegacyConverterEvidence(evidence, imageId) {
  assert.match(imageId ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidence?.imageId, imageId, 'Hardening proof must name the scanned image');
  assert.equal(evidence?.runtimeImage, HARDENED_RUNTIME_IMAGE);
  assert.equal(evidence?.schemaVersion, 1);
  assert.equal(evidence?.architecture, 'amd64');
  assert.equal(evidence?.packagePurl, GLIBC_PURL);
  assert.equal(evidence?.packageRecordSha256, GLIBC_METADATA_SHA256.record);
  assert.equal(evidence?.packageChecksumsSha256, GLIBC_METADATA_SHA256.md5sums);
  assert.deepEqual(evidence?.absentPaths, [...REMOVED_CONVERTER_PATHS]);
  for (const field of ['unicode', 'arabic', 'intl', 'originalPackageMetadata'])
    assert.equal(evidence?.[field], true, `Missing hardening proof: ${field}`);
}

export function assertHardenedRuntimeSbom(sbom) {
  assert.equal(sbom?.bomFormat, 'CycloneDX');
  assert.ok(Array.isArray(sbom.components));
  const libc = sbom.components.filter((component) => component.name === 'libc6');
  assert.equal(libc.length, 1, 'Original libc6 inventory must remain visible');
  assert.equal(libc[0].version, '2.41-12+deb13u4');
  assert.equal(libc[0].purl, GLIBC_PURL);
  const certificates = sbom.components.filter((component) => component.name === 'ca-certificates');
  assert.equal(certificates.length, 1, 'Missing CA certificate package inventory');
  assert.equal(certificates[0].version, '20250419+deb13u1');
  return { libc: libc[0].purl, caCertificates: certificates[0].version };
}
