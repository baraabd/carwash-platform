import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGatewayApplication } = require('../../../apps/api-gateway/dist/index.js');
const {
  REQUIRED_GATEWAY_OWNERS,
} = require('../../../apps/api-gateway/dist/infrastructure/config.js');

async function owners(t) {
  const origins = {};
  const states = {};
  for (const owner of REQUIRED_GATEWAY_OWNERS) {
    const state = {
      status: 200,
      body: { service: owner, ready: true, businessReady: true },
      paths: [],
    };
    states[owner] = state;
    const server = createServer((req, res) => {
      state.paths.push(req.url);
      res.writeHead(state.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state.body));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origins[owner] = `http://127.0.0.1:${server.address().port}`;
    t.after(() => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    });
  }
  return { origins, states };
}

async function gateway(t, origins) {
  const app = await createGatewayApplication({
    origins,
    issuer: 'https://identity.readiness-fixture.invalid',
    audience: 'readiness-fixture',
    cookiePrefix: 'wg_',
    timeoutMs: 250,
    responseLimit: 4096,
    allowedOrigins: ['http://127.0.0.1:3000'],
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const origin = await app.getUrl();
  return async (route) => {
    const response = await fetch(origin + route);
    return { status: response.status, body: await response.json() };
  };
}

test('Gateway readiness requires every published route owner and validates the actual health body', async (t) => {
  const { origins, states } = await owners(t);
  const request = await gateway(t, origins);
  const live = await request('/health/live');
  assert.equal(live.status, 200);
  assert.equal(live.body.businessReady, true);
  assert.equal(
    Object.values(states).flatMap((state) => state.paths).length,
    0,
    'liveness performs no dependency calls',
  );
  assert.equal((await request('/health/ready')).status, 200);
  const owner = REQUIRED_GATEWAY_OWNERS.at(-1);
  for (const body of [
    { service: owner, ready: false, businessReady: true },
    { service: owner, ready: true, businessReady: false },
    { service: 'wrong-owner', ready: true, businessReady: true },
    { ok: true },
  ]) {
    states[owner].body = body;
    const result = await request('/health/ready');
    assert.equal(result.status, 503);
    assert.equal(result.body.ready, false);
    assert.equal(result.body.dependencies[owner], false);
  }
  states[owner].status = 503;
  states[owner].body = { service: owner, ready: true, businessReady: true };
  assert.equal((await request('/health/ready')).status, 503);
});

test('a healthy configured subset is not full routing readiness and cannot mark a static host ready', async (t) => {
  const { origins } = await owners(t);
  const request = await gateway(t, { identity: origins.identity });
  assert.equal((await request('/health/live')).body.businessReady, false);
  const response = await request('/health/ready');
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'UPSTREAMS_NOT_CONFIGURED');
  assert.equal(response.body.dependencies.identity, true);
  assert.deepEqual(
    response.body.missingOwners.sort(),
    REQUIRED_GATEWAY_OWNERS.filter((owner) => owner !== 'identity').sort(),
  );
});
