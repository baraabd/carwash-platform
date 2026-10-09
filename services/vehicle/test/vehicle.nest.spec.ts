import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import {
  AppExceptionFilter,
  HealthController,
  HEALTH_OPTIONS,
  type HealthOptions,
} from '@carwash/service-kit';
import {
  AppModule,
  BUSINESS_READY,
  SERVICE_NAME,
  identityAuthorizerFromEnv,
  postgresProbe,
} from '../src/app.module';
import { PrismaService, databaseUrlFromEnv } from '../src/prisma.service';
import { createHttpApplication } from '../src/transport/http/create-app';

const DSN = 'postgresql://cw_vehicle_app:placeholder@127.0.0.1:5432/cw_vehicle?schema=app';

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

test('vehicle: the application module compiles and wires its dependencies', async () => {
  const moduleRef = await compile();
  assert.ok(moduleRef.get(PrismaService) instanceof PrismaService);
  assert.ok(moduleRef.get(HealthController) instanceof HealthController);
  await moduleRef.close();
});

test('vehicle: the real HTTP adapter boots with distinct live/ready semantics', async () => {
  process.env.DATABASE_URL = DSN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const live = await fetch(url + '/health/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), {
      service: 'vehicle',
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

test('vehicle: liveness reports the process is running, and its real stage', async () => {
  const moduleRef = await compile();
  const controller = moduleRef.get(HealthController);
  assert.deepEqual(controller.live(), {
    service: 'vehicle',
    status: 'alive',
    stage: 'foundation-only',
  });
  await moduleRef.close();
});

test('vehicle: foundation readiness returns 503', async () => {
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

test('vehicle: a healthy dependency still does not make the shell ready', async () => {
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

test('vehicle: dependency failure is DOWN without credential leakage', async () => {
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

test('vehicle: the service is declared foundation-only, not business ready', () => {
  assert.equal(SERVICE_NAME, 'vehicle');
  assert.equal(BUSINESS_READY, false);
});

test('vehicle: a missing DATABASE_URL fails closed instead of guessing', () => {
  assert.throws(() => databaseUrlFromEnv({}), /DATABASE_URL_REQUIRED/);
  assert.throws(() => databaseUrlFromEnv({ DATABASE_URL: '' }), /DATABASE_URL_REQUIRED/);
});

test('vehicle: the postgres probe is wired to this service own client', async () => {
  const moduleRef = await compile();
  const probe = postgresProbe(moduleRef.get(PrismaService));
  assert.equal(probe.name, 'postgres');
  assert.equal(probe.kind, 'postgres');
  await moduleRef.close();
});

test('vehicle: business routes fail closed when Identity is not configured', async () => {
  process.env.DATABASE_URL = DSN;
  delete process.env.VEHICLE_IDENTITY_ORIGIN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const response = await fetch(url + '/internal/v1/vehicle/mine', {
      headers: { authorization: 'Bearer not-checked-without-identity' },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'DEPENDENCY_UNAVAILABLE');
  } finally {
    await app.close();
  }
});

test('vehicle: an unreachable Identity is DEPENDENCY_UNAVAILABLE, never a session', async () => {
  process.env.DATABASE_URL = DSN;
  // Port 9 (discard) on loopback is not served in the test environment.
  process.env.VEHICLE_IDENTITY_ORIGIN = 'http://127.0.0.1:9';
  process.env.VEHICLE_IDENTITY_TIMEOUT_MS = '500';
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const anonymous = await fetch(url + '/internal/v1/vehicle/mine');
    assert.equal(anonymous.status, 401, 'no credential is refused before Identity is asked');
    const response = await fetch(url + '/internal/v1/vehicle/mine', {
      headers: { authorization: 'Bearer some-token' },
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'DEPENDENCY_UNAVAILABLE');
  } finally {
    await app.close();
    delete process.env.VEHICLE_IDENTITY_ORIGIN;
    delete process.env.VEHICLE_IDENTITY_TIMEOUT_MS;
  }
});

test('vehicle: an invalid Identity origin stops startup instead of guessing', () => {
  assert.throws(
    () => identityAuthorizerFromEnv({ VEHICLE_IDENTITY_ORIGIN: 'http://identity.example' }),
    /INVALID_IDENTITY_ORIGIN/,
  );
  assert.throws(
    () =>
      identityAuthorizerFromEnv({
        VEHICLE_IDENTITY_ORIGIN: 'https://identity.example',
        VEHICLE_IDENTITY_TIMEOUT_MS: '0',
      }),
    /INVALID_IDENTITY_TIMEOUT/,
  );
});

const ENVELOPE_KEYS = [
  'code',
  'correlationId',
  'issues',
  'message',
  'reason',
  'requestId',
  'retryAfterMs',
  'retryable',
];

test('vehicle: contract routes answer in the vehicle.v1 envelope even under the platform filter', async () => {
  process.env.DATABASE_URL = DSN;
  delete process.env.VEHICLE_IDENTITY_ORIGIN;
  const app = await createHttpApplication();
  // bootstrapService registers the platform filter after createHttpApplication.
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(0, '127.0.0.1');
  try {
    const url = (await app.getUrl()) + '/internal/v1/vehicle';
    const cases: [string, string, RequestInit, number, string][] = [
      [
        'malformed JSON',
        '/mine',
        { method: 'POST', body: '{bad', headers: { 'content-type': 'application/json' } },
        400,
        'REQUEST_INVALID',
      ],
      [
        'oversized body',
        '/mine',
        {
          method: 'POST',
          body: JSON.stringify({ x: 'y'.repeat(20_000) }),
          headers: { 'content-type': 'application/json' },
        },
        400,
        'REQUEST_INVALID',
      ],
      ['no credential', '/mine', {}, 503, 'DEPENDENCY_UNAVAILABLE'],
      [
        'closed service route',
        '/vehicle-snapshots/resolve',
        { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
        401,
        'AUTH_REQUIRED',
      ],
      [
        'session is not a workload',
        '/vehicle-snapshots/resolve',
        {
          method: 'POST',
          body: '{}',
          headers: { 'content-type': 'application/json', authorization: 'Bearer user' },
        },
        403,
        'AUTH_FORBIDDEN',
      ],
    ];
    for (const [name, path, init, status, code] of cases) {
      const response = await fetch(url + path, init);
      assert.equal(response.status, status, name);
      assert.equal(response.headers.get('cache-control'), 'no-store', name);
      const body = (await response.json()) as { error: Record<string, unknown> };
      assert.deepEqual(Object.keys(body.error).sort(), ENVELOPE_KEYS, name);
      assert.equal(body.error.code, code, name);
      assert.equal(body.error.retryable, code === 'DEPENDENCY_UNAVAILABLE', name);
    }
  } finally {
    await app.close();
  }
});