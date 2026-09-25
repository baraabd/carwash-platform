import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { HealthController, HEALTH_OPTIONS, type HealthOptions } from '@carwash/service-kit';
import { AppModule, BUSINESS_READY, SERVICE_NAME, postgresProbe } from '../src/app.module';
import { PrismaService, databaseUrlFromEnv } from '../src/prisma.service';
import { createHttpApplication } from '../src/transport/http/create-app';

const DSN = 'postgresql://cw_workforce_app:placeholder@127.0.0.1:5432/cw_workforce?schema=app';

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
  return Test.createTestingModule({ imports: [AppModule] }).compile();
}

test('workforce: the application module compiles and wires its dependencies', async () => {
  const moduleRef = await compile();
  assert.ok(moduleRef.get(PrismaService) instanceof PrismaService);
  assert.ok(moduleRef.get(HealthController) instanceof HealthController);
  await moduleRef.close();
});

test('workforce: the real HTTP adapter boots with distinct live/ready semantics', async () => {
  process.env.DATABASE_URL = DSN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const live = await fetch(url + '/health/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), {
      service: 'workforce',
      status: 'alive',
      stage: 'foundation-only',
    });

    const ready = await fetch(url + '/health/ready');
    assert.equal(ready.status, 503, 'foundation shell must not advertise business readiness');
    const body = (await ready.json()) as {
      businessReady: boolean;
      ready: boolean;
      code: string;
    };
    assert.equal(body.businessReady, false);
    assert.equal(body.ready, false);
    assert.equal(body.code, 'FOUNDATION_NOT_READY');
  } finally {
    await app.close();
  }
});

test('workforce: liveness reports the process is running, and its real stage', async () => {
  const moduleRef = await compile();
  const controller = moduleRef.get(HealthController);
  assert.deepEqual(controller.live(), {
    service: 'workforce',
    status: 'alive',
    stage: 'foundation-only',
  });
  await moduleRef.close();
});

test('workforce: foundation readiness returns 503', async () => {
  const moduleRef = await compile();
  const controller = moduleRef.get(HealthController);
  const { res, captured } = fakeResponse();
  await controller.ready(res);
  assert.equal(captured.code, 503, 'a foundation shell must never advertise readiness');
  const body = captured.body as { businessReady: boolean; ready: boolean; code: string };
  assert.equal(body.businessReady, false);
  assert.equal(body.ready, false);
  assert.equal(body.code, 'FOUNDATION_NOT_READY');
  await moduleRef.close();
});

test('workforce: a healthy dependency still does not make the shell ready', async () => {
  const moduleRef = await compile();
  const options = moduleRef.get<HealthOptions>(HEALTH_OPTIONS);
  const withHealthyDependency = new HealthController({
    ...options,
    dependencies: [{ name: 'postgres', kind: 'postgres', check: () => Promise.resolve() }],
  });
  const { res, captured } = fakeResponse();
  await withHealthyDependency.ready(res);
  assert.equal(captured.code, 503);
  const body = captured.body as { dependencies: { status: string }[]; ready: boolean };
  assert.equal(body.dependencies.length, 1);
  const [dependency] = body.dependencies;
  assert.equal(dependency?.status, 'UP', 'the dependency state is still reported honestly');
  assert.equal(body.ready, false);
  await moduleRef.close();
});

test('workforce: dependency failure is DOWN without credential leakage', async () => {
  const moduleRef = await compile();
  const options = moduleRef.get<HealthOptions>(HEALTH_OPTIONS);
  const controller = new HealthController({
    ...options,
    businessReady: true,
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

test('workforce: the service is declared foundation-only, not business ready', () => {
  assert.equal(SERVICE_NAME, 'workforce');
  assert.equal(BUSINESS_READY, false);
});

test('workforce: a missing DATABASE_URL fails closed instead of guessing', () => {
  assert.throws(() => databaseUrlFromEnv({}), /DATABASE_URL_REQUIRED/);
  assert.throws(() => databaseUrlFromEnv({ DATABASE_URL: '' }), /DATABASE_URL_REQUIRED/);
});

test('workforce: the postgres probe is wired to this service own client', async () => {
  const moduleRef = await compile();
  const probe = postgresProbe(moduleRef.get(PrismaService));
  assert.equal(probe.name, 'postgres');
  assert.equal(probe.kind, 'postgres');
  await moduleRef.close();
});
