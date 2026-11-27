import assert from 'node:assert/strict';
import {
  HARDENED_NATIVE_IMAGE,
  HARDENED_RUNTIME_IMAGE,
  LEGACY_CONVERTER_RUNTIME_PROBE,
  assertLegacyConverterEvidence,
} from '../../../ci/runtime-hardening.mjs';

export const MIGRATION_RUNTIME_PROBE = String.raw`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
assert.equal(process.arch, 'x64');
assert.equal(process.version, 'v24.21.0');
assert.equal(process.getuid(), 1000);
for (const file of ['/bin/sh', '/usr/bin/apt', '/usr/bin/dpkg', '/usr/bin/perl', '/usr/local/bin/npm', '/usr/local/bin/npx'])
  assert.equal(fs.existsSync(file), false, 'Unexpected job tooling: ' + file);
const packages = ['libstdc++6', 'libgcc-s1', 'libssl3t64', 'zlib1g', 'libzstd1'];
for (const name of packages) {
  const record = fs.readFileSync('/var/lib/dpkg/status.d/' + name, 'utf8');
  assert.ok(record.split('\n').includes('Package: ' + name));
  assert.ok(record.split('\n').includes('Architecture: amd64'));
  assert.ok(fs.readFileSync('/usr/share/doc/' + name + '/copyright').length > 0);
}
for (const file of ['libssl.so.3', 'libcrypto.so.3', 'libz.so.1', 'libzstd.so.1'])
  assert.ok(fs.statSync('/usr/lib/x86_64-linux-gnu/' + file).isFile());
require('node:tls').createSecureContext();
assert.equal(crypto.createHash('sha256').update('migration').digest().length, 32);
${LEGACY_CONVERTER_RUNTIME_PROBE}
const local = require('node:module').createRequire('/migrate/package.json');
assert.equal(local('prisma/package.json').version, '7.10.0');
assert.equal(typeof local('pg').Client, 'function');
const prisma = require('node:module').createRequire(local.resolve('prisma/package.json'));
const engines = prisma('@prisma/engines');
const engine = path.join(engines.getEnginesPath(), 'schema-engine-debian-openssl-3.0.x');
const run = require('node:child_process').spawnSync(engine, ['--version'], { encoding: 'utf8', timeout: 10000, env: { PATH: '/usr/local/bin', HOME: '/tmp' } });
assert.equal(run.status, 0, 'Schema engine must actually execute with the job ABI');
assert.ok(run.stdout.includes(engines.enginesVersion), 'Wrong Prisma schema engine');
console.log(JSON.stringify({ role: 'migration', node: process.version, prisma: '7.10.0', uid: process.getuid(),
  schemaEngine: true, crypto: true, tls: true, packageInventory: true, toolSurface: true,
  runtimeImage: '${HARDENED_RUNTIME_IMAGE}', nativeImage: '${HARDENED_NATIVE_IMAGE}', ...legacyConverters }));
`;

/** Runtime evidence cannot substitute for executing this migration artifact. */
export function assertMigrationRuntimeProof(proof, imageId) {
  assert.equal(proof?.role, 'migration', 'Migration-native proof is required');
  assert.equal(proof.node, 'v24.21.0');
  assert.equal(proof.prisma, '7.10.0');
  assert.equal(proof.uid, 1000);
  assert.equal(proof.nativeImage, HARDENED_NATIVE_IMAGE);
  for (const key of ['schemaEngine', 'crypto', 'tls', 'packageInventory', 'toolSurface'])
    assert.equal(proof[key], true, `Missing migration runtime proof: ${key}`);
  assertLegacyConverterEvidence(proof, imageId);
}
