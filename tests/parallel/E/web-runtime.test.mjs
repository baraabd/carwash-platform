import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createWebRuntime as customerRuntime } from '../../../infra/web-runtime.mjs';
import { createWebRuntime as operatorRuntime } from '../../../apps/operator-web/server.mjs';
import { createWebRuntime as adminRuntime } from '../../../apps/admin-web/server.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const runtimes = [
  ['customer-web', customerRuntime],
  ['operator-web', operatorRuntime],
  ['admin-web', adminRuntime],
];

function checkedAssetRequestUrl(serverOrigin, assetPath) {
  // Built HTML is input, not authority to read an arbitrary file or choose a
  // request destination. Match the exact flat static asset surface the server
  // exposes before using the path for either operation.
  if (!/^\/assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:js|css|svg|png|webp)$/.test(assetPath)) {
    throw new Error('UNSAFE_BUILT_ASSET_PATH');
  }
  const expectedOrigin = new URL(serverOrigin);
  const requestUrl = new URL(assetPath, expectedOrigin);
  if (
    requestUrl.protocol !== 'http:' ||
    requestUrl.hostname !== '127.0.0.1' ||
    requestUrl.origin !== expectedOrigin.origin ||
    requestUrl.username !== '' ||
    requestUrl.password !== '' ||
    requestUrl.pathname !== assetPath ||
    requestUrl.search !== '' ||
    requestUrl.hash !== ''
  ) {
    throw new Error('BUILT_ASSET_ORIGIN_MISMATCH');
  }
  return requestUrl;
}

async function withServer(createRuntime, documentRoot, run) {
  const server = createRuntime({ documentRoot });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withFixture(createRuntime, app, run) {
  const fixture = await mkdtemp(path.join(tmpdir(), 'washgo-w01-' + app + '-'));
  try {
    await mkdir(path.join(fixture, 'assets'));
    await writeFile(
      path.join(fixture, 'index.html'),
      '<html lang="ar" dir="rtl">Labeled technical fixture</html>',
    );
    await writeFile(path.join(fixture, 'assets', 'index-AbC123.js'), '/* technical fixture */');
    await withServer(createRuntime, fixture, (url) => run(url, fixture));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

for (const [app, createRuntime] of runtimes) {
  test(app + ': real HTTP liveness remains independent of foundation readiness', async () => {
    await withFixture(createRuntime, app, async (url) => {
      const live = await fetch(url + '/health/live');
      assert.equal(live.status, 200);
      assert.deepEqual(await live.json(), {
        app,
        stage: 'foundation-only',
        businessReady: false,
        status: 'alive',
      });
      const ready = await fetch(url + '/health/ready');
      assert.equal(ready.status, 503);
      assert.deepEqual(await ready.json(), {
        app,
        stage: 'foundation-only',
        businessReady: false,
        ready: false,
        code: 'FOUNDATION_NOT_READY',
      });
    });
  });

  test(app + ': source, business routes and traversal paths stay private', async () => {
    await withFixture(createRuntime, app, async (url) => {
      for (const suffix of [
        '/package.json',
        '/server.mjs',
        '/src/index.ts',
        '/api/bookings',
        '/assets/%2e%2e%2fpackage.json',
      ]) {
        assert.equal((await fetch(url + suffix)).status, 404, suffix);
      }
      const malformed = await fetch(url + '/assets/%ZZ.js');
      assert.equal(malformed.status, 400);
      const mutation = await fetch(url + '/health/ready', { method: 'POST' });
      assert.equal(mutation.status, 405);
      assert.equal(mutation.headers.get('allow'), 'GET, HEAD');
    });
  });

  test(app + ': a missing boot artifact cannot become a successful response', async () => {
    await withFixture(createRuntime, app, async (url, fixture) => {
      await rm(path.join(fixture, 'index.html'));
      const missing = await fetch(url);
      assert.equal(missing.status, 503);
      assert.deepEqual(await missing.json(), {
        code: 'BOOT_ARTIFACT_UNAVAILABLE',
        businessReady: false,
      });
    });
  });

  // This scope test consumes the actual app build. It proves static HTTP
  // artifact delivery only: it does not execute browser JS or assert UI parity.
  test(app + ': real built entry and emitted assets are independently served', async () => {
    const documentRoot = path.join(root, 'apps', app, 'dist');
    const builtHtml = await readFile(path.join(documentRoot, 'index.html'), 'utf8');
    const assets = [...builtHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.ok(assets.length > 0, 'An actual Vite build must emit at least one bundled asset');
    await withServer(createRuntime, documentRoot, async (url) => {
      const page = await fetch(url);
      assert.equal(page.status, 200);
      assert.equal(await page.text(), builtHtml);
      assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
      assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      for (const forbidden of [
        '/assets/../index.html',
        '/assets/%2e%2e%2fpackage.json',
        '/assets/index.js?destination=https://example.invalid',
        '/assets/index.js#fragment',
        '/assets/index.js.map',
        '//example.invalid/assets/index.js',
        'https://example.invalid/assets/index.js',
      ]) {
        assert.throws(() => checkedAssetRequestUrl(url, forbidden), /UNSAFE_BUILT_ASSET_PATH/);
      }
      assert.throws(
        () => checkedAssetRequestUrl('http://example.invalid', '/assets/index.js'),
        /BUILT_ASSET_ORIGIN_MISMATCH/,
      );
      for (const asset of new Set(assets)) {
        const requestUrl = checkedAssetRequestUrl(url, asset);
        const response = await fetch(requestUrl, { redirect: 'error' });
        assert.equal(response.status, 200, asset);
        const builtAsset = await readFile(path.join(documentRoot, asset.slice(1)));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), builtAsset);
      }
      const head = await fetch(url, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
    });
  });
}
