import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { HealthController, HEALTH_OPTIONS, type HealthOptions } from '@carwash/service-kit';
import {
  AppModule,
  BUSINESS_READY,
  SERVICE_NAME,
  postgresProbe,
  runtimeCapabilities,
} from '../src/app.module';
import { PrismaService, databaseUrlFromEnv } from '../src/prisma.service';
import { createHttpApplication } from '../src/transport/http/create-app';

const DSN = 'postgresql://cw_reporting_app:placeholder@127.0.0.1:5432/cw_reporting?schema=app';

function fakeResponse() {
  const captured: { code: number | null; body: unknown } = { code: null, body: null };
  const res = {
    status(code: number) {
      captured.code = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return body;
    },
  };
  return { res, captured };
}

async function compile() {
  process.env.DATABASE_URL = DSN;
  process.env.IDENTITY_ORIGIN = 'http://127.0.0.1:9';
  return Test.createTestingModule({ imports: [AppModule] }).compile();
}

test('reporting: the application module compiles and wires its dependencies', async () => {
  const moduleRef = await compile();
  assert.ok(moduleRef.get(PrismaService) instanceof PrismaService);
  assert.ok(moduleRef.get(HealthController) instanceof HealthController);
  await moduleRef.close();
});

test('reporting: the real HTTP adapter boots with distinct live/ready semantics', async () => {
  process.env.DATABASE_URL = DSN;
  process.env.IDENTITY_ORIGIN = 'http://127.0.0.1:9';
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const live = await fetch(url + '/health/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), {
      service: 'reporting',
      status: 'alive',
      stage: 'business',
    });

    const ready = await fetch(url + '/health/ready');
    assert.equal(ready.status, 503, 'configured HTTP capability cannot replace a live database');
    const body = (await ready.json()) as {
      businessReady: boolean;
      dependenciesReady: boolean;
      ready: boolean;
      code: string;
      scope: string;
      dependencies: { name: string; status: string }[];
    };
    assert.equal(body.businessReady, true);
    assert.equal(body.dependenciesReady, false);
    assert.equal(body.ready, false);
    assert.equal(body.code, 'DEPENDENCY_DOWN');
    assert.equal(body.scope, 'http-api');
    assert.deepEqual(
      body.dependencies.map(({ name, status }) => ({ name, status })),
      [
        { name: 'postgres', status: 'DOWN' },
        { name: 'postgres-schema', status: 'DOWN' },
      ],
    );
  } finally {
    await app.close();
  }
});

test('reporting: liveness reports configured HTTP capability without probing dependencies', async () => {
  const moduleRef = await compile();
  const options = moduleRef.get<HealthOptions>(HEALTH_OPTIONS);
  let checks = 0;
  const controller = new HealthController({
    ...options,
    dependencies: [
      {
        name: 'postgres',
        kind: 'postgres',
        check: () => {
          checks += 1;
          return Promise.reject(new Error('offline dependency'));
        },
      },
    ],
  });
  assert.deepEqual(controller.live(), {
    service: 'reporting',
    status: 'alive',
    stage: 'business',
  });
  assert.equal(checks, 0, 'liveness never calls readiness probes');
  await moduleRef.close();
});

test('reporting: missing Identity capability stays unready despite healthy database probes', async () => {
  const moduleRef = await compile();
  const options = moduleRef.get<HealthOptions>(HEALTH_OPTIONS);
  assert.ok(options.dependencies, 'the real composition must register owner probes');
  const controller = new HealthController({
    ...options,
    runtimeCapabilities: runtimeCapabilities({}),
    dependencies: options.dependencies.map((probe) => ({
      ...probe,
      check: () => Promise.resolve(),
    })),
  });
  const { res, captured } = fakeResponse();
  await controller.ready(res);
  assert.equal(captured.code, 503, 'healthy dependencies cannot replace required configuration');
  const body = captured.body as {
    businessReady: boolean;
    dependenciesReady: boolean;
    ready: boolean;
    code: string;
    capabilities: { name: string; required: boolean; available: boolean; code: string }[];
  };
  assert.equal(body.businessReady, false);
  assert.equal(body.dependenciesReady, true);
  assert.equal(body.ready, false);
  assert.equal(body.code, 'FOUNDATION_NOT_READY');
  assert.equal(controller.live().stage, 'foundation-only');
  assert.deepEqual(body.capabilities, [
    {
      name: 'identity-authority',
      required: true,
      available: false,
      code: 'NOT_CONFIGURED_OR_IMPLEMENTED',
    },
  ]);
  await moduleRef.close();
});

test('reporting: configured capability and both healthy probe doubles permit HTTP readiness', async () => {
  const moduleRef = await compile();
  const options = moduleRef.get<HealthOptions>(HEALTH_OPTIONS);
  assert.ok(options.dependencies, 'the real composition must register owner probes');
  const withHealthyDependency = new HealthController({
    ...options,
    dependencies: options.dependencies.map((probe) => ({
      ...probe,
      check: () => Promise.resolve(),
    })),
  });
  const { res, captured } = fakeResponse();
  await withHealthyDependency.ready(res);
  assert.equal(captured.code, 200);
  const body = captured.body as {
    businessReady: boolean;
    dependenciesReady: boolean;
    dependencies: { name: string; status: string }[];
    ready: boolean;
    code: string;
    scope: string;
  };
  assert.deepEqual(
    body.dependencies.map(({ name, status }) => ({ name, status })),
    [
      { name: 'postgres', status: 'UP' },
      { name: 'postgres-schema', status: 'UP' },
    ],
  );
  assert.equal(body.businessReady, true);
  assert.equal(body.dependenciesReady, true);
  assert.equal(body.ready, true);
  assert.equal(body.code, 'READY');
  assert.equal(body.scope, 'http-api');
  await moduleRef.close();
});

test('reporting: configured capability with no dependency probes remains unready', async () => {
  const moduleRef = await compile();
  const options = moduleRef.get<HealthOptions>(HEALTH_OPTIONS);
  const controller = new HealthController({ ...options, dependencies: [] });
  const { res, captured } = fakeResponse();
  await controller.ready(res);
  const body = captured.body as {
    businessReady: boolean;
    dependenciesReady: boolean | null;
    ready: boolean;
    code: string;
    dependencies: unknown[];
  };
  assert.equal(captured.code, 503);
  assert.equal(body.businessReady, true);
  assert.equal(body.dependenciesReady, null, 'an absent probe is unchecked, not healthy');
  assert.equal(body.ready, false);
  assert.equal(body.code, 'DEPENDENCY_DOWN');
  assert.deepEqual(body.dependencies, []);
  await moduleRef.close();
});

test('reporting: dependency failure is DOWN without credential leakage', async () => {
  const moduleRef = await compile();
  const options = moduleRef.get<HealthOptions>(HEALTH_OPTIONS);
  const controller = new HealthController({
    ...options,
    dependencies: [
      {
        name: 'postgres',
        kind: 'postgres',
        check: () => Promise.reject(new Error('connect ECONNREFUSED ' + DSN)),
      },
    ],
  });
  const { res, captured } = fakeResponse();
  await controller.ready(res);
  assert.equal(captured.code, 503);
  const body = captured.body as {
    code: string;
    dependencies: { status: string; error?: string }[];
  };
  assert.equal(body.code, 'DEPENDENCY_DOWN');
  assert.equal(body.dependencies.length, 1);
  const [dependency] = body.dependencies;
  assert.equal(dependency?.status, 'DOWN');
  assert.ok(
    !JSON.stringify(body).includes('placeholder'),
    'the probe error must not carry credentials',
  );
  await moduleRef.close();
});

test('reporting: the unconfigured foundation fallback remains false', () => {
  assert.equal(SERVICE_NAME, 'reporting');
  assert.equal(BUSINESS_READY, false);
});

test('reporting: a missing DATABASE_URL fails closed instead of guessing', () => {
  assert.throws(() => databaseUrlFromEnv({}), /DATABASE_URL_REQUIRED/);
  assert.throws(() => databaseUrlFromEnv({ DATABASE_URL: '' }), /DATABASE_URL_REQUIRED/);
});

test('reporting: the postgres probe is wired to this service own client', async () => {
  const moduleRef = await compile();
  const probe = postgresProbe(moduleRef.get(PrismaService));
  assert.equal(probe.name, 'postgres');
  assert.equal(probe.kind, 'postgres');
  await moduleRef.close();
});

test('reporting: without an Identity origin it boots and refuses every read with 503', async () => {
  process.env.DATABASE_URL = DSN;
  delete process.env.IDENTITY_ORIGIN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    assert.equal((await fetch(url + '/health/live')).status, 200);
    const read = await fetch(url + '/internal/v1/reporting/operations/freshness', {
      headers: { authorization: `Bearer ${'a'.repeat(40)}` },
    });
    assert.equal(read.status, 503);
    const body = (await read.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'AUTH_UNAVAILABLE');
  } finally {
    await app.close();
  }
});
