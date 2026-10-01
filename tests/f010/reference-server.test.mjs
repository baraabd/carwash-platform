import test from 'node:test';
import assert from 'node:assert/strict';
import { startReferenceServer } from '../../scripts/f010/reference-server.mjs';

test('F010 reference server exposes all authorities read-only on loopback', async (t) => {
  const server = await startReferenceServer();
  t.after(() => server.close());
  for (const app of ['customer', 'technician', 'admin']) {
    const response = await fetch(`${server.origin}/${app}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /<!doctype html>/i);
    const head = await fetch(`${server.origin}/${app}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
  assert.equal((await fetch(`${server.origin}/healthz`)).status, 200);
  assert.equal((await fetch(`${server.origin}/missing`)).status, 404);
  assert.equal((await fetch(`${server.origin}/customer`, { method: 'POST' })).status, 405);
});

test('F010 reference server refuses non-loopback binding', async () => {
  await assert.rejects(() => startReferenceServer({ host: '0.0.0.0' }), /MUST_BIND_LOOPBACK/);
});
