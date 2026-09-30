import assert from 'node:assert/strict';

export const NATIVE_PACKAGES = Object.freeze(['libgcc-s1', 'libstdc++6']);
export const NATIVE_PACKAGE_VERSION = '14.2.0-19';

/** Missing native package inventory is a gate failure, not a clean scan. */
export function assertNativeSbom(sbom) {
  assert.equal(sbom?.bomFormat, 'CycloneDX');
  assert.ok(Array.isArray(sbom.components));
  const native = NATIVE_PACKAGES.map((name) => {
    const found = sbom.components.filter((component) => component?.name === name);
    assert.equal(found.length, 1, `Missing or duplicated native SBOM package: ${name}`);
    const [component] = found;
    assert.equal(
      component.version,
      NATIVE_PACKAGE_VERSION,
      `Wrong native package version: ${name}`,
    );
    assert.equal(
      component.purl,
      `pkg:deb/debian/${encodeURIComponent(name)}@${NATIVE_PACKAGE_VERSION}?arch=amd64&distro=debian-13.7`,
      `Wrong native package identity: ${name}`,
    );
    return { name, version: component.version, purl: component.purl };
  });
  assert.ok(
    !sbom.components.some((component) => component?.name === 'libssl3t64'),
    'System OpenSSL must not be reintroduced into the nossl runtime',
  );
  return native;
}

// Executed by Node inside the final image, with no host shell or network.
// This checks bundled TLS/crypto and the actual native password module,
// not merely that the HTTP process can reach its health route.
export const NATIVE_RUNTIME_PROBE = String.raw`
(async () => {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  require('node:tls').createSecureContext();
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const input = Buffer.from('native-runtime-check');
  assert.ok(crypto.verify('sha256', input, keys.publicKey, crypto.sign('sha256', input, keys.privateKey)));
  for (const name of ['libgcc-s1', 'libstdc++6']) {
    const record = fs.readFileSync('/var/lib/dpkg/status.d/' + name, 'utf8').split(String.fromCharCode(10));
    assert.ok(record.includes('Package: ' + name));
    assert.ok(record.includes('Version: 14.2.0-19'));
    assert.ok(record.includes('Architecture: amd64'));
  }
  for (const file of ['libssl.so.3', 'libcrypto.so.3'])
    assert.ok(!fs.existsSync('/usr/lib/x86_64-linux-gnu/' + file));
  const identity = process.argv[1] === 'identity';
  if (identity) {
    const own = require('node:module').createRequire(require.resolve('@carwash/security-kit'));
    const argon2 = own('argon2');
    const hash = await argon2.hash('native-runtime-check', { memoryCost: 8192, timeCost: 1, parallelism: 1 });
    assert.equal(await argon2.verify(hash, 'native-runtime-check'), true);
    assert.equal(await argon2.verify(hash, 'different-fixture'), false);
  }
  console.log(JSON.stringify({ node: process.version, openssl: process.versions.openssl,
    uid: process.getuid(), crypto: true, tls: true, argon2: identity, packageInventory: true }));
})().catch(() => { console.error('NATIVE_RUNTIME_PROBE_FAILED'); process.exitCode = 1; });
`;
