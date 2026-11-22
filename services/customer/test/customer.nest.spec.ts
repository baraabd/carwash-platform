import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { Test } from '@nestjs/testing';
import {
  bootstrapService,
  HealthController,
  HEALTH_OPTIONS,
  type HealthOptions,
} from '@carwash/service-kit';
import { parseApiErrorEnvelope } from '@carwash/contracts';
import {
  AppModule,
  BUSINESS_READY,
  SERVICE_NAME,
  identityAuthorizerFromEnv,
  postgresProbe,
} from '../src/app.module';
import { PrismaService, databaseUrlFromEnv } from '../src/prisma.service';
import { createHttpApplication } from '../src/transport/http/create-app';
import { CustomerTransportExceptionFilter } from '../src/transport/http/customer-contract.filter';

const DSN = 'postgresql://cw_customer_app:placeholder@127.0.0.1:5432/cw_customer?schema=app';

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

test('customer: the application module compiles and wires its dependencies', async () => {
  const moduleRef = await compile();
  assert.ok(moduleRef.get(PrismaService) instanceof PrismaService);
  assert.ok(moduleRef.get(HealthController) instanceof HealthController);
  await moduleRef.close();
});

test('customer: the real HTTP adapter boots with distinct live/ready semantics', async () => {
  process.env.DATABASE_URL = DSN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const live = await fetch(url + '/health/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), {
      service: 'customer',
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

test('customer: liveness reports the process is running, and its real stage', async () => {
  const moduleRef = await compile();
  const controller = moduleRef.get(HealthController);
  assert.deepEqual(controller.live(), {
    service: 'customer',
    status: 'alive',
    stage: 'foundation-only',
  });
  await moduleRef.close();
});

test('customer: foundation readiness returns 503', async () => {
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

test('customer: a healthy dependency still does not make the shell ready', async () => {
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

test('customer: dependency failure is DOWN without credential leakage', async () => {
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

test('customer: the service is declared foundation-only, not business ready', () => {
  assert.equal(SERVICE_NAME, 'customer');
  assert.equal(BUSINESS_READY, false);
});

test('customer: a missing DATABASE_URL fails closed instead of guessing', () => {
  assert.throws(() => databaseUrlFromEnv({}), /DATABASE_URL_REQUIRED/);
  assert.throws(() => databaseUrlFromEnv({ DATABASE_URL: '' }), /DATABASE_URL_REQUIRED/);
});

test('customer: the postgres probe is wired to this service own client', async () => {
  const moduleRef = await compile();
  const probe = postgresProbe(moduleRef.get(PrismaService));
  assert.equal(probe.name, 'postgres');
  assert.equal(probe.kind, 'postgres');
  await moduleRef.close();
});

test('customer: business routes fail closed when Identity is not configured', async () => {
  process.env.DATABASE_URL = DSN;
  delete process.env.CUSTOMER_IDENTITY_ORIGIN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const response = await fetch(url + '/internal/v1/customer/me', {
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

test('customer: an unreachable Identity is IDENTITY_UNAVAILABLE, never a session', async () => {
  process.env.DATABASE_URL = DSN;
  // Port 9 (discard) on loopback is not served in the test environment.
  process.env.CUSTOMER_IDENTITY_ORIGIN = 'http://127.0.0.1:9';
  process.env.CUSTOMER_IDENTITY_TIMEOUT_MS = '500';
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const anonymous = await fetch(url + '/internal/v1/customer/me');
    assert.equal(anonymous.status, 401, 'no credential is refused before Identity is asked');
    const response = await fetch(url + '/internal/v1/customer/me', {
      headers: { authorization: 'Bearer some-token' },
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'DEPENDENCY_UNAVAILABLE');
  } finally {
    await app.close();
    delete process.env.CUSTOMER_IDENTITY_ORIGIN;
    delete process.env.CUSTOMER_IDENTITY_TIMEOUT_MS;
  }
});

test('customer: an invalid Identity origin stops startup instead of guessing', () => {
  assert.throws(
    () => identityAuthorizerFromEnv({ CUSTOMER_IDENTITY_ORIGIN: 'http://identity.example' }),
    /INVALID_IDENTITY_ORIGIN/,
  );
  assert.throws(
    () =>
      identityAuthorizerFromEnv({
        CUSTOMER_IDENTITY_ORIGIN: 'https://identity.example',
        CUSTOMER_IDENTITY_TIMEOUT_MS: '0',
      }),
    /INVALID_IDENTITY_TIMEOUT/,
  );
});

test('customer: deployed bootstrap preserves canonical parser failures and legacy routes', async () => {
  process.env.DATABASE_URL = DSN;
  delete process.env.CUSTOMER_IDENTITY_ORIGIN;
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  const runtime = await bootstrapService({
    service: SERVICE_NAME,
    businessReady: BUSINESS_READY,
    createApplication: createHttpApplication,
    createExceptionFilter: (logger) => new CustomerTransportExceptionFilter(logger),
    installSignalHandlers: false,
    env: { PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'error' },
  });
  const correlationId = '299b2abb-099b-4f6f-a25d-e29a83f9618c';
  try {
    const base = await runtime.app.getUrl();
    for (const [method, path] of [
      ['PUT', '/internal/v1/customer/me'],
      ['PATCH', '/INTERNAL/V1/CUSTOMER/ME/?check=parser'],
      ['POST', '/internal/v1/customer/me/addresses'],
      ['PATCH', '/internal/v1/customer/me/addresses/address-id'],
      ['POST', '/internal/v1/customer/me/addresses/address-id/archive/'],
      ['POST', '/internal/v1/customer/address-snapshots/resolve'],
    ] as const) {
      for (const body of ['{', JSON.stringify({ contactValue: 'x'.repeat(17 * 1024) })]) {
        const response = await fetch(base + path, {
          method,
          headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
          body,
        });
        assert.equal(response.status, 400, `${method} ${path}`);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-correlation-id'), correlationId);
        const wire: unknown = await response.json();
        assert.equal(parseApiErrorEnvelope(wire).error.code, 'REQUEST_INVALID');
        assert.ok(!JSON.stringify(wire).includes('contactValue'));
      }
    }
    const legacy = await fetch(base + '/legacy/me/addresses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(legacy.status, 400);
    const legacyBody = (await legacy.json()) as { error: { code: string } };
    assert.equal(legacyBody.error.code, 'BAD_REQUEST');
    assert.equal((await fetch(base + '/health/live')).status, 200);
  } finally {
    await runtime.shutdown('TEST');
  }
});
