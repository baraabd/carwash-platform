import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const MIGRATION_RUNTIME_LOCK_PATH =
  'scripts/production/E/release/migration-runtime.lock.json';
export const MIGRATION_RECEIPT_PATH = '/usr/share/carwash/migration-runtime.json';
export const MIGRATION_REMOVED_CONVERTER_PATHS = Object.freeze(
  ['/usr/lib/x86_64-linux-gnu/gconv', '/lib/x86_64-linux-gnu/gconv'].flatMap((directory) =>
    ['UHC.so', 'ISO-2022-CN-EXT.so', 'IBM1390.so', 'IBM1399.so'].map(
      (name) => `${directory}/${name}`,
    ),
  ),
);

export function assertMigrationRuntimeLock(lock) {
  assert.equal(lock?.schemaVersion, 1);
  assert.equal(lock.architecture, 'amd64');
  assert.deepEqual(lock.distribution, { id: 'debian', version: '12' });
  assert.match(lock.nodeImage ?? '', /^docker\.io\/library\/node@sha256:[a-f0-9]{64}$/);
  assert.ok(Array.isArray(lock.packages) && lock.packages.length > 0);
  const names = new Set();
  for (const item of lock.packages) {
    assert.match(item.name ?? '', /^[a-z0-9][a-z0-9+.-]+$/);
    assert.ok(!names.has(item.name), 'Duplicate migration package');
    names.add(item.name);
    assert.ok(typeof item.version === 'string' && item.version.length > 0);
    assert.ok(['amd64', 'all'].includes(item.architecture));
    assert.match(item.sha256 ?? '', /^[a-f0-9]{64}$/);
    const source = new URL(item.url);
    assert.equal(source.protocol, 'https:');
    assert.ok(
      ['deb.debian.org', 'security.debian.org', 'snapshot.debian.org'].includes(source.hostname),
    );
    assert.equal(source.username + source.password + source.port + source.search + source.hash, '');
    assert.match(source.pathname, /\/pool\/.+\.deb$/);
  }
  for (const name of [
    'base-files',
    'ca-certificates',
    'libc6',
    'libstdc++6',
    'libgcc-s1',
    'libssl3',
  ])
    assert.ok(names.has(name), 'Missing migration package: ' + name);
  assert.match(lock.packages.find((item) => item.name === 'libssl3').version, /^3\.0\./);
  return lock;
}

const lockBytes = readFileSync(new URL('./migration-runtime.lock.json', import.meta.url));
export const MIGRATION_RUNTIME_LOCK = assertMigrationRuntimeLock(JSON.parse(lockBytes));
export const MIGRATION_RUNTIME_LOCK_SHA256 = createHash('sha256').update(lockBytes).digest('hex');

/** A receipt is inventory, not a substitute for executing the final image. */
export function assertMigrationRuntimeReceipt(receipt, lock, lockSha256) {
  assertMigrationRuntimeLock(lock);
  assert.match(lockSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(receipt?.schemaVersion, 1);
  assert.equal(receipt.kind, 'carwash-migration-runtime');
  assert.equal(receipt.lockSha256, lockSha256);
  assert.equal(receipt.nodeImage, lock.nodeImage);
  assert.equal(receipt.nodeVersion, '24.21.0');
  assert.equal(receipt.architecture, 'amd64');
  assert.deepEqual(receipt.distribution, lock.distribution);
  assert.equal(receipt.nativeLoader, '/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2');
  assert.ok(Array.isArray(receipt.files) && receipt.files.length > 0);
  const files = new Map();
  for (const file of receipt.files) {
    assert.ok(
      typeof file.path === 'string' &&
        file.path.startsWith('/') &&
        path.posix.normalize(file.path) === file.path &&
        !file.path.includes('\0'),
      'Invalid retained file path',
    );
    assert.ok(!files.has(file.path), 'Duplicate retained file');
    assert.match(file.sha256 ?? '', /^[a-f0-9]{64}$/);
    files.set(file.path, file.sha256);
  }
  assert.ok(files.has('/usr/local/bin/node'), 'Node must be part of the inventoried rootfs');
  assert.ok(files.has(receipt.nativeLoader), 'Native loader must be inventoried');
  assert.ok(Array.isArray(receipt.packages));
  assert.equal(receipt.packages.length, lock.packages.length);
  const names = new Set();
  for (const expected of lock.packages) {
    const item = receipt.packages.find((entry) => entry.name === expected.name);
    assert.ok(item && !names.has(item.name), 'Missing or duplicate package receipt');
    names.add(item.name);
    for (const key of ['name', 'version', 'architecture', 'url', 'sha256'])
      assert.equal(item[key], expected[key], 'Package differs from migration lock: ' + key);
    const fields = [
      ['recordPath', 'recordSha256', '/var/lib/dpkg/status.d/' + item.name],
      [
        'originalControlPath',
        'originalControlSha256',
        '/usr/share/carwash/package-control/' + item.name,
      ],
      ['md5sumsPath', 'md5sumsSha256', '/var/lib/dpkg/status.d/' + item.name + '.md5sums'],
    ];
    for (const [fileKey, hashKey, expectedPath] of fields) {
      assert.equal(item[fileKey], expectedPath);
      assert.match(item[hashKey] ?? '', /^[a-f0-9]{64}$/);
      assert.equal(files.get(expectedPath), item[hashKey], 'Package provenance is not inventoried');
    }
    assert.equal(item.copyrightPath, '/usr/share/doc/' + item.name + '/copyright');
    assert.match(item.copyrightSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(
      files.get(item.copyrightRealPath),
      item.copyrightSha256,
      'Original copyright target is not inventoried',
    );
  }
  assert.ok(Array.isArray(receipt.nativeDependencies));
  assert.deepEqual(
    receipt.nativeDependencies.map((entry) => entry.role).sort(),
    ['node', 'schema-engine'],
  );
  for (const entry of receipt.nativeDependencies) {
    if (entry.role === 'node') assert.equal(entry.binary, '/usr/local/bin/node');
    else
      assert.match(
        entry.binary ?? '',
        /^\/migrate\/node_modules\/.+\/schema-engine-debian-openssl-3\.0\.x$/,
      );
    assert.ok(Array.isArray(entry.libraries) && entry.libraries.length > 0);
    const libraries = new Set();
    for (const library of entry.libraries) {
      assert.match(library.name ?? '', /^[a-zA-Z0-9_.+-]+$/);
      assert.ok(!libraries.has(library.name), 'Duplicate native dependency');
      libraries.add(library.name);
      assert.ok(files.has(library.path), 'Native dependency is outside the inventoried rootfs');
    }
  }
  assert.equal(receipt.caBundle?.path, '/etc/ssl/certs/ca-certificates.crt');
  assert.match(receipt.caBundle.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(files.get(receipt.caBundle.path), receipt.caBundle.sha256);
  assert.ok(
    Number.isSafeInteger(receipt.caBundle.certificateCount) &&
      receipt.caBundle.certificateCount > 0,
  );
  return receipt;
}

/** Parse the actual loader output; missing or ambiguous dependencies are never accepted. */
export function parseNativeDependencyListing(output) {
  assert.ok(typeof output === 'string' && output.trim(), 'Missing native loader output');
  const dependencies = [];
  const names = new Set();
  for (const line of output.trim().split('\n')) {
    if (/^\s*linux-vdso\.so\.1\s+\(0x[0-9a-f]+\)\s*$/i.test(line)) continue;
    const mapped = /^\s*(\S+)\s+=>\s+(\/\S+)\s+\(0x[0-9a-f]+\)\s*$/i.exec(line);
    const direct = /^\s*(\/\S+)\s+\(0x[0-9a-f]+\)\s*$/i.exec(line);
    assert.ok(mapped || direct, 'Unresolved or unexpected native dependency: ' + line);
    if (mapped)
      assert.ok(
        /^[a-zA-Z0-9_.+-]+$/.test(mapped[1]) || mapped[1] === '/lib64/ld-linux-x86-64.so.2',
        'Unexpected mapped native dependency name',
      );
    const file = mapped ? mapped[2] : direct[1];
    const name = path.posix.basename(mapped ? mapped[1] : file);
    assert.ok(!names.has(name), 'Duplicate native loader dependency');
    names.add(name);
    dependencies.push({ name, path: file });
  }
  assert.ok(dependencies.length > 0, 'Empty native dependency closure');
  return dependencies.sort((a, b) => a.name.localeCompare(b.name));
}

export const MIGRATION_RUNTIME_PROBE = String.raw`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const spawnSync = require('node:child_process').spawnSync;
${assertMigrationRuntimeLock.toString()}
${assertMigrationRuntimeReceipt.toString()}
${parseNativeDependencyListing.toString()}
const lock = ${JSON.stringify(MIGRATION_RUNTIME_LOCK)};
const lockSha256 = '${MIGRATION_RUNTIME_LOCK_SHA256}';
const receipt = JSON.parse(fs.readFileSync('${MIGRATION_RECEIPT_PATH}', 'utf8'));
assertMigrationRuntimeReceipt(receipt, lock, lockSha256);
assert.equal(process.arch, 'x64');
assert.equal(process.version, 'v24.21.0');
assert.equal(process.getuid(), 1000);
const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
assert.match(osRelease, /^ID=debian$/m);
assert.match(osRelease, /^VERSION_ID="?12"?$/m);
for (const file of ['/bin/sh', '/usr/bin/apt', '/usr/bin/dpkg', '/usr/bin/perl', '/usr/local/bin/npm', '/usr/local/bin/npx'])
  assert.throws(() => fs.lstatSync(file), { code: 'ENOENT' }, 'Unexpected job tooling: ' + file);
for (const file of receipt.files) {
  assert.ok(fs.lstatSync(file.path).isFile(), 'Retained file is not regular: ' + file.path);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'), file.sha256, 'Retained file changed: ' + file.path);
}
for (const item of receipt.packages) {
  const record = fs.readFileSync(item.recordPath, 'utf8').split('\n');
  const original = fs.readFileSync(item.originalControlPath, 'utf8').split('\n');
  for (const field of ['Package: ' + item.name, 'Version: ' + item.version, 'Architecture: ' + item.architecture]) {
    assert.ok(record.includes(field), 'Installed package record is wrong: ' + field);
    assert.ok(original.includes(field), 'Original package control is wrong: ' + field);
  }
  assert.ok(fs.readFileSync(item.md5sumsPath).length > 0);
  assert.equal(fs.realpathSync(item.copyrightPath), item.copyrightRealPath);
  const copyright = fs.readFileSync(item.copyrightPath);
  assert.ok(copyright.length > 0);
  assert.equal(crypto.createHash('sha256').update(copyright).digest('hex'), item.copyrightSha256);
}
const ca = fs.readFileSync(receipt.caBundle.path, 'utf8');
assert.equal((ca.match(/-----BEGIN CERTIFICATE-----/g) || []).length, receipt.caBundle.certificateCount);
require('node:tls').createSecureContext({ ca });
assert.equal(crypto.createHash('sha256').update('migration').digest().length, 32);
const absentPaths = ${JSON.stringify(MIGRATION_REMOVED_CONVERTER_PATHS)};
for (const file of absentPaths) assert.throws(() => fs.lstatSync(file), { code: 'ENOENT' });
const sample = 'غسيل سيارات WashGo — العربية ١٢٣';
assert.equal(Buffer.from(sample, 'utf8').toString('utf8'), sample);
assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(sample)), sample);
assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.of(0xc0, 0xaf)));
assert.equal(new Intl.NumberFormat('ar', { useGrouping: false, numberingSystem: 'arab' }).format(123), '١٢٣');
const local = require('node:module').createRequire('/migrate/package.json');
assert.equal(local('prisma/package.json').version, '7.10.0');
assert.equal(typeof local('pg').Client, 'function');
const prisma = require('node:module').createRequire(local.resolve('prisma/package.json'));
const engines = prisma('@prisma/engines');
const engine = path.join(engines.getEnginesPath(), 'schema-engine-debian-openssl-3.0.x');
assert.equal(receipt.nativeDependencies.find((entry) => entry.role === 'schema-engine').binary, engine);
const environment = { PATH: '/usr/local/bin', HOME: '/tmp' };
for (const entry of receipt.nativeDependencies) {
  const listing = spawnSync(receipt.nativeLoader, ['--inhibit-cache', '--library-path', '/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu:/lib64', '--list', entry.binary], { encoding: 'utf8', timeout: 10000, env: environment });
  assert.equal(listing.status, 0, 'Native dependency listing failed: ' + listing.stderr);
  const actual = parseNativeDependencyListing(listing.stdout).map((item) => ({ ...item, path: fs.realpathSync(item.path) }));
  const expected = entry.libraries.map((item) => ({ ...item, path: fs.realpathSync(item.path) })).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(actual, expected, 'Final native closure differs from the assembled rootfs');
}
const run = spawnSync(engine, ['--version'], { encoding: 'utf8', timeout: 10000, env: environment });
assert.equal(run.status, 0, 'Schema engine must actually execute with the job ABI: ' + run.stderr);
assert.ok(run.stdout.includes(engines.enginesVersion), 'Wrong Prisma schema engine');
console.log(JSON.stringify({ schemaVersion: 2, role: 'migration', architecture: 'amd64',
  node: process.version, prisma: '7.10.0', uid: process.getuid(), lockSha256, receipt,
  schemaEngine: true, crypto: true, tls: true, packageInventory: true, toolSurface: true,
  fileIntegrity: true, nativeClosure: true, unicode: true, arabic: true, intl: true, absentPaths }));
`;

/** A proof from another image or the ordinary runtime cannot establish migration safety. */
export function assertMigrationRuntimeProof(proof, imageId) {
  assert.match(imageId ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.equal(proof?.imageId, imageId, 'Migration proof must name the scanned image');
  assert.equal(proof.role, 'migration');
  assert.equal(proof.schemaVersion, 2);
  assert.equal(proof.architecture, 'amd64');
  assert.equal(proof.node, 'v24.21.0');
  assert.equal(proof.prisma, '7.10.0');
  assert.equal(proof.uid, 1000);
  assert.equal(proof.lockSha256, MIGRATION_RUNTIME_LOCK_SHA256);
  assertMigrationRuntimeReceipt(
    proof.receipt,
    MIGRATION_RUNTIME_LOCK,
    MIGRATION_RUNTIME_LOCK_SHA256,
  );
  assert.deepEqual(proof.absentPaths, [...MIGRATION_REMOVED_CONVERTER_PATHS]);
  for (const key of [
    'schemaEngine',
    'crypto',
    'tls',
    'packageInventory',
    'toolSurface',
    'fileIntegrity',
    'nativeClosure',
    'unicode',
    'arabic',
    'intl',
  ])
    assert.equal(proof[key], true, 'Missing migration runtime proof: ' + key);
}
