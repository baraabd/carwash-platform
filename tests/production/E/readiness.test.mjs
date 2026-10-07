// Readiness semantics of the BUILT @carwash/service-kit HealthController.
// Dependency probes open real TCP connections (node:net) to a live listener or
// to a closed port; nothing about the dependency state is faked.
import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { HealthController } = require('../../../packages/service-kit/dist/health.js');

function tcpProbe(name, port) {
  return {
    name,
    kind: 'postgres',
    check: () =>
      new Promise((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port }, () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
      }),
  };
}

async function listener(t) {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function readiness(options) {
  const captured = {};
  const res = {
    status(code) {
      captured.status = code;
      return res;
    },
    json(body) {
      captured.body = body;
      return body;
    },
  };
  await new HealthController(options).ready(res);
  return captured;
}

test('matrix: business readiness and dependency readiness are reported independently', async (t) => {
  const up = await listener(t);
  const down = await closedPort();
  const cases = [
    { businessReady: false, port: up, status: 503, code: 'FOUNDATION_NOT_READY', deps: true },
    { businessReady: false, port: down, status: 503, code: 'FOUNDATION_NOT_READY', deps: false },
    { businessReady: true, port: up, status: 200, code: 'READY', deps: true },
    { businessReady: true, port: down, status: 503, code: 'DEPENDENCY_DOWN', deps: false },
  ];
  for (const c of cases) {
    const { status, body } = await readiness({
      service: 'demo',
      businessReady: c.businessReady,
      dependencies: [tcpProbe('db', c.port)],
    });
    const label = JSON.stringify(c);
    assert.equal(status, c.status, label);
    assert.equal(body.code, c.code, label);
    assert.equal(body.businessReady, c.businessReady, label);
    assert.equal(body.dependenciesReady, c.deps, label);
    assert.equal(body.ready, c.status === 200, label);
  }
});

test('no registered probe reports dependenciesReady null, never a vacuous true', async () => {
  for (const businessReady of [false, true]) {
    const { body } = await readiness({ service: 'demo', businessReady, dependencies: [] });
    assert.equal(body.dependenciesReady, null);
  }
});

test('a hanging dependency times out as DOWN and never reads as ready', async () => {
  const { status, body } = await readiness({
    service: 'demo',
    businessReady: true,
    probeTimeoutMs: 100,
    dependencies: [{ name: 'broker', kind: 'rabbitmq', check: () => new Promise(() => {}) }],
  });
  assert.equal(status, 503);
  assert.equal(body.code, 'DEPENDENCY_DOWN');
  assert.equal(body.dependencies[0].status, 'DOWN');
  assert.equal(body.dependencies[0].error, 'Error');
});

test('probe errors never leak connection strings into the readiness body', async () => {
  const { body } = await readiness({
    service: 'demo',
    businessReady: true,
    dependencies: [
      {
        name: 'db',
        kind: 'postgres',
        check: async () => {
          throw new TypeError('connect postgresql://user:hunter2@db:5432/x failed');
        },
      },
    ],
  });
  assert.equal(body.dependencies[0].error, 'TypeError');
  assert.doesNotMatch(JSON.stringify(body), /hunter2|postgresql:\/\//);
});
