import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createWebRuntime } from '../server.mjs';

async function withRuntime(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'washgo-operator-web-'));
  await mkdir(path.join(root, 'assets'));
  await writeFile(
    path.join(root, 'index.html'),
    '<html lang="ar" dir="rtl">Technical fixture only</html>',
  );
  await writeFile(
    path.join(root, 'assets', 'index-AbC123.js'),
    'document.body.dataset.boot = "foundation-only";',
  );
  const server = createWebRuntime({ documentRoot: root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    await run(url, root);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

test('operator-web: real HTTP liveness does not imply business readiness', async () => {
  await withRuntime(async (url) => {
    const live = await fetch(url + '/health/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), {
      app: 'operator-web',
      stage: 'foundation-only',
      businessReady: false,
      status: 'alive',
    });
    const ready = await fetch(url + '/health/ready');
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), {
      app: 'operator-web',
      stage: 'foundation-only',
      businessReady: false,
      ready: false,
      code: 'FOUNDATION_NOT_READY',
    });
  });
});

test('operator-web: serves only its document and bundled assets', async () => {
  await withRuntime(async (url) => {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const script = await fetch(url + '/assets/index-AbC123.js');
    assert.equal(script.status, 200);
    assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
    for (const suffix of [
      '/package.json',
      '/server.mjs',
      '/src/index.ts',
      '/api/bookings',
      '/assets/%2e%2e%2fpackage.json',
    ]) {
      assert.equal((await fetch(url + suffix)).status, 404, suffix);
    }
  });
});

test('operator-web: never fabricates an unavailable artifact or mutation endpoint', async () => {
  await withRuntime(async (url, root) => {
    await rm(path.join(root, 'index.html'));
    const missing = await fetch(url);
    assert.equal(missing.status, 503);
    assert.deepEqual(await missing.json(), {
      code: 'BOOT_ARTIFACT_UNAVAILABLE',
      businessReady: false,
    });
    const mutation = await fetch(url + '/health/ready', { method: 'POST' });
    assert.equal(mutation.status, 405);
    assert.equal(mutation.headers.get('allow'), 'GET, HEAD');
  });
});
