import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertNativeSbom,
  NATIVE_PACKAGES,
  NATIVE_PACKAGE_VERSION,
  NATIVE_RUNTIME_PROBE,
} from '../../scripts/ci/native-runtime.mjs';
import { inventory } from '../../scripts/ci/policy.mjs';
import { renderServiceFiles } from '../../scripts/dev/service-template.mjs';
const load = (file) => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const lock = JSON.parse(load('scripts/ci/tools.lock.json'));
const complete = () => ({
  bomFormat: 'CycloneDX',
  components: NATIVE_PACKAGES.map((name) => ({
    name,
    version: NATIVE_PACKAGE_VERSION,
    purl: `pkg:deb/debian/${encodeURIComponent(name)}@${NATIVE_PACKAGE_VERSION}?arch=amd64&distro=debian-13.7`,
  })),
});
test('native ABI inventory is required even when vulnerability findings are empty', () => {
  assert.equal(assertNativeSbom(complete()).length, 2);
  for (const missing of [{}, { bomFormat: 'CycloneDX', components: [] }])
    assert.throws(() => assertNativeSbom(missing));
  for (const name of NATIVE_PACKAGES) {
    const value = complete();
    value.components = value.components.filter((c) => c.name !== name);
    assert.throws(() => assertNativeSbom(value), /Missing or duplicated/);
  }
});
test('native ABI inventory rejects duplicates and mismatched package versions', () => {
  const duplicated = complete();
  duplicated.components.push(duplicated.components[0]);
  assert.throws(() => assertNativeSbom(duplicated), /duplicated/);
  const wrong = complete();
  wrong.components[0].version = '12.2.0-14';
  assert.throws(() => assertNativeSbom(wrong), /version/);
});
test('native ABI package identity includes architecture and runtime distribution', () => {
  for (const change of [
    (p) => p.replace('amd64', 'arm64'),
    (p) => p.replace('debian-13.7', 'debian-12'),
    () => undefined,
  ]) {
    const wrong = complete();
    wrong.components[0].purl = change(wrong.components[0].purl);
    assert.throws(() => assertNativeSbom(wrong), /identity/);
  }
});
test('native inventory gate rejects accidentally reintroduced system OpenSSL', () => {
  const wrong = complete();
  wrong.components.push({ name: 'libssl3t64' });
  assert.throws(() => assertNativeSbom(wrong), /OpenSSL/);
});
test('every Dockerfile preserves original native package metadata and license provenance', () => {
  assert.match(lock.nativeLibraries.image, /distroless\/cc-debian13@sha256:[a-f0-9]{64}$/);
  assert.equal(lock.nativeLibraries.packageVersion, NATIVE_PACKAGE_VERSION);
  assert.deepEqual(lock.nativeLibraries.packages, [...NATIVE_PACKAGES]);
  const files = [
    load('Dockerfile'),
    ...inventory().targets.map((t) => load(t.path + '/Dockerfile')),
    renderServiceFiles('identity').get('Dockerfile'),
  ];
  // 19 service artifacts, Gateway, three web artifacts, root and template.
  assert.equal(files.length, 25);
  for (const source of files) {
    assert.ok(source.includes('ARG NATIVE_RUNTIME_IMAGE=' + lock.nativeLibraries.image));
    assert.ok(source.includes('FROM ${NATIVE_RUNTIME_IMAGE} AS native_libraries'));
    for (const name of NATIVE_PACKAGES) {
      for (const directory of ['/var/lib/dpkg/status.d/', '/usr/share/doc/']) {
        const file = directory + name;
        assert.ok(source.includes(`COPY --from=native_libraries ${file} ${file}`));
      }
    }
    assert.ok(
      source.includes('COPY --from=native_libraries /usr/lib/x86_64-linux-gnu/libgcc_s.so.1'),
    );
    assert.ok(
      source.includes('COPY --from=native_libraries /usr/lib/x86_64-linux-gnu/libstdc++.so.6'),
    );
    assert.ok(!source.includes('COPY --from=builder /usr/lib/x86_64-linux-gnu/libstdc++'));
  }
});
test('final image acceptance executes crypto and native identity checks before release', () => {
  const source = load('scripts/ci/image.mjs');
  assert.ok(source.includes("step('native-crypto-tls-and-package-inventory'"));
  assert.ok(source.includes('info.nativePackages = assertNativeSbom(sbom)'));
  assert.ok(NATIVE_RUNTIME_PROBE.includes('createSecureContext'));
  assert.ok(NATIVE_RUNTIME_PROBE.includes("own('argon2')"));
  assert.ok(NATIVE_RUNTIME_PROBE.includes('process.exitCode = 1'));
});
