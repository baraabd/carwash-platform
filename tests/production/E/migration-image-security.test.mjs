import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMigrationScan } from '../../../scripts/production/E/release/scan-migration-image.mjs';
import {
  parseControl,
  parseNativeDependencies,
  validateRuntimeLock,
} from '../../../scripts/production/E/release/migration-rootfs.mjs';
import {
  MIGRATION_RUNTIME_LOCK,
  MIGRATION_RUNTIME_LOCK_SHA256,
  MIGRATION_REMOVED_CONVERTER_PATHS,
  assertMigrationRuntimeLock,
  assertMigrationRuntimeReceipt,
  parseNativeDependencyListing,
} from '../../../scripts/production/E/release/migration-runtime.mjs';

const imageId = `sha256:${'a'.repeat(64)}`;
const hash = 'b'.repeat(64);
const report = () => ({
  SchemaVersion: 2,
  ArtifactType: 'container_image',
  Metadata: { ImageID: imageId, OS: { Family: 'debian', Name: '12' } },
  Results: [{ Target: 'debian', Vulnerabilities: [], Secrets: [] }],
});

function receipt() {
  const files = new Map();
  const file = (name) => {
    files.set(name, { path: name, sha256: hash });
    return name;
  };
  const packages = MIGRATION_RUNTIME_LOCK.packages.map((item) => ({
    ...item,
    recordPath: file('/var/lib/dpkg/status.d/' + item.name),
    recordSha256: hash,
    originalControlPath: file('/usr/share/carwash/package-control/' + item.name),
    originalControlSha256: hash,
    md5sumsPath: file('/var/lib/dpkg/status.d/' + item.name + '.md5sums'),
    md5sumsSha256: hash,
    copyrightPath: file('/usr/share/doc/' + item.name + '/copyright'),
    copyrightRealPath: '/usr/share/doc/' + item.name + '/copyright',
    copyrightSha256: hash,
  }));
  const nativeLoader = file('/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2');
  const node = file('/usr/local/bin/node');
  const libc = file('/lib/x86_64-linux-gnu/libc.so.6');
  const ca = file('/etc/ssl/certs/ca-certificates.crt');
  return {
    schemaVersion: 1,
    kind: 'carwash-migration-runtime',
    lockSha256: MIGRATION_RUNTIME_LOCK_SHA256,
    nodeImage: MIGRATION_RUNTIME_LOCK.nodeImage,
    nodeVersion: '24.21.0',
    architecture: 'amd64',
    distribution: { id: 'debian', version: '12' },
    nativeLoader,
    packages,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    nativeDependencies: [
      {
        role: 'node',
        binary: node,
        libraries: [
          { name: 'ld-linux-x86-64.so.2', path: nativeLoader },
          { name: 'libc.so.6', path: libc },
        ],
      },
      {
        role: 'schema-engine',
        binary: '/migrate/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x',
        libraries: [
          { name: 'ld-linux-x86-64.so.2', path: nativeLoader },
          { name: 'libc.so.6', path: libc },
        ],
      },
    ],
    caBundle: { path: ca, sha256: hash, certificateCount: 1 },
  };
}

const migrationProof = () => ({
  imageId,
  schemaVersion: 2,
  role: 'migration',
  architecture: 'amd64',
  node: 'v24.21.0',
  prisma: '7.10.0',
  uid: 1000,
  lockSha256: MIGRATION_RUNTIME_LOCK_SHA256,
  receipt: receipt(),
  schemaEngine: true,
  crypto: true,
  tls: true,
  packageInventory: true,
  toolSurface: true,
  fileIntegrity: true,
  nativeClosure: true,
  unicode: true,
  arabic: true,
  intl: true,
  absentPaths: [...MIGRATION_REMOVED_CONVERTER_PATHS],
});

test('migration native proof cannot exempt any blocking finding, including removed converters', () => {
  const value = report();
  for (const [id, name] of [
    ['CVE-2026-121758', 'libc6'],
    ['CVE-2026-107494', 'libssl3'],
    ['CVE-2026-124709', 'libssl3'],
    ['CVE-2026-124851', 'libzstd1'],
  ])
    value.Results[0].Vulnerabilities.push({
      VulnerabilityID: id,
      PkgName: name,
      InstalledVersion: 'observed-version',
      Severity: 'HIGH',
    });
  value.Results[0].Vulnerabilities.push({
    VulnerabilityID: 'CVE-2099-UNKNOWN',
    PkgName: 'libc6',
    Severity: 'UNKNOWN',
  });
  value.Results[0].Vulnerabilities.push({
    VulnerabilityID: 'CVE-2099-CRITICAL',
    PkgName: 'other',
    Severity: 'CRITICAL',
  });
  assert.equal(assessMigrationScan(value, imageId).blocking.length, 6);
  assert.equal(assessMigrationScan(value, imageId, migrationProof()).blocking.length, 6);
  for (const change of [
    { role: 'runtime' },
    { schemaVersion: 1 },
    { imageId: `sha256:${'c'.repeat(64)}` },
    { schemaEngine: false },
    { fileIntegrity: false },
    { nativeClosure: false },
    { packageInventory: false },
    { absentPaths: [] },
    { lockSha256: 'c'.repeat(64) },
    { prisma: '7.9.0' },
    { uid: 0 },
  ])
    assert.throws(() => assessMigrationScan(value, imageId, { ...migrationProof(), ...change }));
});

test('migration receipts reject donor, package, checksum and dependency provenance drift', () => {
  const verify = (value) =>
    assertMigrationRuntimeReceipt(value, MIGRATION_RUNTIME_LOCK, MIGRATION_RUNTIME_LOCK_SHA256);
  assert.doesNotThrow(() => verify(receipt()));
  for (const mutate of [
    (value) => {
      value.nodeImage = `docker.io/library/node@sha256:${'c'.repeat(64)}`;
    },
    (value) => {
      value.distribution.version = '13';
    },
    (value) => {
      value.packages[0].version = 'different';
    },
    (value) => {
      value.packages[0].originalControlSha256 = 'c'.repeat(64);
    },
    (value) => {
      value.packages[0].md5sumsPath = '/tmp/rewritten';
    },
    (value) => {
      value.packages[0].copyrightRealPath = '/tmp/untracked-license';
    },
    (value) => {
      value.packages.pop();
    },
    (value) => {
      value.files.push(value.files[0]);
    },
    (value) => {
      value.files = value.files.filter((item) => item.path !== '/usr/local/bin/node');
    },
    (value) => {
      value.nativeDependencies.pop();
    },
    (value) => {
      value.nativeDependencies[1].binary = '/deploy/engine';
    },
    (value) => {
      value.nativeDependencies[0].libraries[0].path = '/builder/libc.so.6';
    },
    (value) => {
      value.caBundle.certificateCount = 0;
    },
    (value) => {
      delete value.caBundle.sha256;
      value.files = value.files.filter((item) => item.path !== value.caBundle.path);
    },
  ]) {
    const changed = receipt();
    mutate(changed);
    assert.throws(() => verify(changed));
  }
});

test('migration lock rejects mutable, insecure or incomplete package inputs', () => {
  for (const mutate of [
    (value) => {
      value.nodeImage = 'node:24.21.0-bookworm-slim';
    },
    (value) => {
      value.packages[0].sha256 = 'unverified';
    },
    (value) => {
      value.packages[0].url = value.packages[0].url.replace('https:', 'http:');
    },
    (value) => {
      value.packages.push(value.packages[0]);
    },
    (value) => {
      value.packages = value.packages.filter((item) => item.name !== 'libssl3');
    },
  ]) {
    const changed = structuredClone(MIGRATION_RUNTIME_LOCK);
    mutate(changed);
    assert.throws(() => assertMigrationRuntimeLock(changed));
  }
});

test('native loader output must resolve every dependency without fallback or ambiguity', () => {
  assert.deepEqual(
    parseNativeDependencyListing(
      'linux-vdso.so.1 (0x00007ff)\n' +
        'libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007aa)\n' +
        '/lib64/ld-linux-x86-64.so.2 (0x00007bb)\n',
    ),
    [
      { name: 'ld-linux-x86-64.so.2', path: '/lib64/ld-linux-x86-64.so.2' },
      { name: 'libc.so.6', path: '/lib/x86_64-linux-gnu/libc.so.6' },
    ],
  );
  for (const invalid of [
    '',
    'linux-vdso.so.1 (0x00007ff)',
    'libssl.so.3 => not found',
    'libc.so.6 => relative/libc.so.6 (0x00007aa)',
    'unrecognized loader warning',
    'libc.so.6 => /a/libc.so.6 (0x00007aa)\nlibc.so.6 => /b/libc.so.6 (0x00007bb)',
  ])
    assert.throws(() => parseNativeDependencyListing(invalid));
});

test('native loader parser accepts only the known absolute interpreter alias', () => {
  const target = '/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2';
  assert.deepEqual(
    parseNativeDependencyListing(`/lib64/ld-linux-x86-64.so.2 => ${target} (0x7aa)\n`),
    [{ name: 'ld-linux-x86-64.so.2', path: target }],
  );
  for (const alias of [
    '/tmp/ld-linux-x86-64.so.2',
    '/lib64/libc.so.6',
    '/lib64/../lib64/ld-linux-x86-64.so.2',
  ])
    assert.throws(() => parseNativeDependencyListing(`${alias} => ${target} (0x7aa)\n`));
});

test('migration security refuses empty, wrong-image and absent OS evidence', () => {
  assert.throws(() => assessMigrationScan({}, imageId));
  assert.throws(() => assessMigrationScan({ ...report(), Results: [] }, imageId));
  assert.throws(() => assessMigrationScan(report(), `sha256:${'c'.repeat(64)}`));
  const absent = report();
  delete absent.Metadata.OS;
  assert.throws(() => assessMigrationScan(absent, imageId));
  const wrongDistribution = report();
  wrongDistribution.Metadata.OS.Name = '13.7';
  assert.throws(() => assessMigrationScan(wrongDistribution, imageId, migrationProof()));
});

test('migration scan retains all findings but only counts secrets in retained evidence', () => {
  const value = report();
  value.Results[0].Vulnerabilities.push({
    VulnerabilityID: 'CVE-2099-HIGH',
    PkgName: 'libc6',
    InstalledVersion: '2.36',
    Severity: 'HIGH',
  });
  value.Results[0].Secrets.push({ Match: 'never include this value in retained evidence' });
  const assessed = assessMigrationScan(value, imageId, migrationProof());
  assert.equal(assessed.blocking.length, 1);
  assert.equal(assessed.secretCount, 1);
  assert.ok(!JSON.stringify(assessed).includes('never include'));
  assert.deepEqual(assessMigrationScan(report(), imageId, migrationProof()), {
    findings: [],
    secretCount: 0,
    blocking: [],
  });
});

test('original package copyright aliases retain an inventoried canonical target', () => {
  const value = receipt();
  const item = value.packages.find((entry) => entry.name === 'libstdc++6');
  item.copyrightRealPath = '/usr/share/doc/gcc-12-base/copyright';
  value.files = value.files.filter((entry) => entry.path !== item.copyrightPath);
  assert.doesNotThrow(() =>
    assertMigrationRuntimeReceipt(value, MIGRATION_RUNTIME_LOCK, MIGRATION_RUNTIME_LOCK_SHA256),
  );
});

test('rootfs builder validates the committed package lock and refuses malformed controls', () => {
  assert.doesNotThrow(() => validateRuntimeLock(MIGRATION_RUNTIME_LOCK));
  assert.deepEqual(
    parseControl(
      'Package: libssl3\nVersion: 3.0.22-1~deb12u2\nArchitecture: amd64\n' +
        'Description: original description\n continuation retained in original bytes\n',
    ),
    {
      Package: 'libssl3',
      Version: '3.0.22-1~deb12u2',
      Architecture: 'amd64',
      Description: 'original description',
    },
  );
  assert.throws(() => parseControl('Package: libc6\nPackage: altered\n'));
  assert.throws(() => parseControl('not a control field\n'));
});

test('rootfs native closure rejects host fallback, unresolved libraries and escaping symlinks', () => {
  const output =
    'linux-vdso.so.1 (0x7ff)\n' +
    'libc.so.6 => /rootfs/lib/x86_64-linux-gnu/libc.so.6 (0x7aa)\n' +
    '/lib64/ld-linux-x86-64.so.2 (0x7bb)\n';
  const resolve = (value) => value;
  assert.deepEqual(parseNativeDependencies(output, '/rootfs', resolve), [
    { name: 'ld-linux-x86-64.so.2', path: '/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2' },
    { name: 'libc.so.6', path: '/lib/x86_64-linux-gnu/libc.so.6' },
  ]);
  for (const invalid of [
    output.replace('/rootfs/lib/x86_64-linux-gnu/libc.so.6', '/lib/x86_64-linux-gnu/libc.so.6'),
    'libssl.so.3 => not found',
    'linux-vdso.so.1 (0x7ff)',
    output + 'libc.so.6 => /rootfs/lib/x86_64-linux-gnu/libc.so.6 (0x7cc)\n',
  ])
    assert.throws(() => parseNativeDependencies(invalid, '/rootfs', resolve));
  assert.throws(() =>
    parseNativeDependencies(output, '/rootfs', () => '/builder/lib/x86_64-linux-gnu/libc.so.6'),
  );
});
