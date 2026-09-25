import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, serviceKit } from './_load.mjs';
import { renderServiceFiles } from '../../scripts/dev/service-template.mjs';

function run(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return {
    code: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function snapshot(service) {
  const serialized = [...renderServiceFiles(service)]
    .map(([file, contents]) => `${file}\0${contents}`)
    .join('\0');
  return createHash('sha256').update(serialized).digest('hex');
}

test('F003 renderer snapshot and structure are deterministic', () => {
  assert.equal(renderServiceFiles('identity').size, 13);
  assert.deepEqual(
    [...renderServiceFiles('identity').keys()],
    [
      'src/domain/index.ts',
      'src/application/index.ts',
      'src/ports/index.ts',
      'src/infrastructure/persistence/prisma.service.ts',
      'src/prisma.service.ts',
      'src/app.module.ts',
      'src/transport/http/create-app.ts',
      'src/transport/messaging/consumer.ts',
      'src/main.ts',
      'test/domain/.gitkeep',
      'test/unit/.gitkeep',
      'test/integration/.gitkeep',
      'Dockerfile',
    ],
  );
  assert.equal(
    snapshot('identity'),
    '5b4670e93c378a090a311bea51203285162e888bf53df34e22fe04a8f9f6d022',
  );
  assert.equal(
    snapshot('catalog'),
    'c9aff4ffbc010b2fa60b82236b9fbc2c0a7ab8f4c6178342de3820bd20d4520e',
  );
  assert.equal(
    snapshot('communications'),
    'b782bb45869781193d1e95cd628977113a211f35616af5de5c3431ad77835089',
  );
});

test('F003 committed service shells exactly match the generator', () => {
  const result = run('scripts/dev/generate-service-shells.mjs', ['--check']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /10 service shell\(s\), no drift/);
});

test('F003 clean-layer guard passes the committed services', () => {
  const result = run('scripts/check-layers.mjs');
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Layer guard passed: 10 service\(s\)/);
});

async function withLayerFixture(applicationSource, body) {
  const root = await mkdtemp(path.join(tmpdir(), 'cw-f003-layer-'));
  try {
    await mkdir(path.join(root, 'architecture'), { recursive: true });
    await writeFile(
      path.join(root, 'architecture/service-catalog.json'),
      JSON.stringify({ services: [{ id: 'fixture' }] }),
    );
    for (const layer of ['domain', 'application', 'ports', 'infrastructure', 'transport']) {
      await mkdir(path.join(root, 'services/fixture/src', layer), { recursive: true });
      await writeFile(path.join(root, 'services/fixture/src', layer, 'index.ts'), 'export {};\n');
    }
    for (const testLayer of ['domain', 'unit', 'integration']) {
      await mkdir(path.join(root, 'services/fixture/test', testLayer), { recursive: true });
    }
    await writeFile(path.join(root, 'services/fixture/test/fixture.nest.spec.ts'), 'export {};\n');
    await writeFile(
      path.join(root, 'services/fixture/src/application/use-case.ts'),
      applicationSource,
    );
    await writeFile(
      path.join(root, 'services/fixture/src/app.module.ts'),
      'export const BUSINESS_READY = false;\n',
    );
    await writeFile(
      path.join(root, 'services/fixture/Dockerfile'),
      [
        'FROM node:24 AS builder',
        'RUN pnpm install --frozen-lockfile',
        'FROM node:24 AS runner',
        'USER node',
        '',
      ].join('\n'),
    );
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('F003 layer guard rejects Nest imports from application code', async () => {
  await withLayerFixture(
    "import { Injectable } from '@nestjs/common';\nexport const value = Injectable;\n",
    async (root) => {
      const result = run('scripts/check-layers.mjs', ['--root', root]);
      assert.equal(result.code, 1, result.output);
      assert.match(
        result.output,
        /application layer imports framework\/IO dependency @nestjs\/common/,
      );
    },
  );
});

test('F003 layer guard rejects infrastructure imports from application code', async () => {
  await withLayerFixture("import '../infrastructure/index';\n", async (root) => {
    const result = run('scripts/check-layers.mjs', ['--root', root]);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /application layer imports outward layer infrastructure/);
  });
});

test('runtime configuration validates bounded startup and shutdown budgets', () => {
  assert.equal(serviceKit.parseDurationMs(undefined, 1234, 'INVALID'), 1234);
  assert.equal(serviceKit.parseDurationMs('2500', 1234, 'INVALID'), 2500);
  assert.throws(() => serviceKit.parseDurationMs('0', 1234, 'INVALID'), /INVALID/);
  assert.throws(() => serviceKit.parseDurationMs('99', 1234, 'INVALID'), /INVALID/);
  assert.throws(() => serviceKit.parseDurationMs('300001', 1234, 'INVALID'), /INVALID/);
});

test('standard error mapping never echoes an unknown internal message', () => {
  const body = serviceKit.toErrorResponse(
    new Error('connect postgresql://admin:super-secret@db/prod'),
    '11111111-1111-4111-8111-111111111111',
  );
  assert.equal(body.error.status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(body), /super-secret|postgresql/);
});

test('message consumer adapter delegates to the application and classifies failure', async () => {
  let seen;
  const ok = serviceKit.createMessageConsumerAdapter({
    service: 'fixture',
    handler: {
      async handle(message) {
        seen = message;
      },
    },
  });
  const handled = await ok.consume({ id: '1', type: 'probe.v1', payload: { ok: true } });
  assert.equal(handled.kind, 'handled');
  assert.equal(seen.id, '1');
  assert.match(seen.correlationId, /^[0-9a-f-]{36}$/);

  const failing = serviceKit.createMessageConsumerAdapter({
    service: 'fixture',
    handler: {
      async handle() {
        throw new Error('driver detail must stay private');
      },
    },
  });
  const failed = await failing.consume({ id: '2', type: 'probe.v1', payload: {} });
  assert.deepEqual(
    {
      kind: failed.kind,
      code: failed.code,
      status: failed.status,
      retryable: failed.retryable,
    },
    { kind: 'failed', code: 'INTERNAL_ERROR', status: 500, retryable: true },
  );
});

test('shared bootstrap installs transport policy and closes cleanly', async () => {
  const state = { middleware: 0, filters: 0, listen: [], close: 0 };
  const fakeApp = {
    use() {
      state.middleware += 1;
      return fakeApp;
    },
    useGlobalFilters() {
      state.filters += 1;
      return fakeApp;
    },
    async listen(port, host) {
      state.listen.push([port, host]);
    },
    async close() {
      state.close += 1;
    },
  };
  const runtime = await serviceKit.bootstrapService({
    service: 'fixture',
    businessReady: false,
    createApplication: async () => fakeApp,
    installSignalHandlers: false,
    env: {
      PORT: '4321',
      HOST: '127.0.0.1',
      STARTUP_TIMEOUT_MS: '1000',
      SHUTDOWN_TIMEOUT_MS: '1000',
      LOG_LEVEL: 'error',
    },
  });
  assert.deepEqual(state.listen, [[4321, '127.0.0.1']]);
  assert.equal(state.middleware, 1);
  assert.equal(state.filters, 1);
  await runtime.shutdown('TEST');
  assert.equal(state.close, 1);
});

test('shared bootstrap bounds a hanging shutdown', async () => {
  const fakeApp = {
    use() {
      return fakeApp;
    },
    useGlobalFilters() {
      return fakeApp;
    },
    async listen() {},
    close() {
      return new Promise(() => {});
    },
  };
  const runtime = await serviceKit.bootstrapService({
    service: 'fixture',
    businessReady: false,
    createApplication: async () => fakeApp,
    installSignalHandlers: false,
    env: { STARTUP_TIMEOUT_MS: '1000', SHUTDOWN_TIMEOUT_MS: '100', LOG_LEVEL: 'error' },
  });
  await assert.rejects(runtime.shutdown('TEST'), /SHUTDOWN_TIMEOUT/);
});
