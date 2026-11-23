import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { HealthController, HEALTH_OPTIONS, type HealthOptions } from '@carwash/service-kit';
import {
  AppModule,
  BUSINESS_READY,
  SERVICE_NAME,
  postgresProbe,
  rateLimitFromEnv,
} from '../src/app.module';
import { PrismaService, databaseUrlFromEnv } from '../src/prisma.service';
import { createHttpApplication, trustedProxiesFromEnv } from '../src/transport/http/create-app';

const DSN = 'postgresql://cw_geo_app:placeholder@127.0.0.1:5432/cw_geo?schema=app';

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

test('geo: the application module compiles and wires its dependencies', async () => {
  const moduleRef = await compile();
  assert.ok(moduleRef.get(PrismaService) instanceof PrismaService);
  assert.ok(moduleRef.get(HealthController) instanceof HealthController);
  await moduleRef.close();
});

test('geo: the real HTTP adapter boots with distinct live/ready semantics', async () => {
  process.env.DATABASE_URL = DSN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const live = await fetch(url + '/health/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), {
      service: 'geo',
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

test('geo: liveness reports the process is running, and its real stage', async () => {
  const moduleRef = await compile();
  const controller = moduleRef.get(HealthController);
  assert.deepEqual(controller.live(), {
    service: 'geo',
    status: 'alive',
    stage: 'foundation-only',
  });
  await moduleRef.close();
});

test('geo: foundation readiness returns 503', async () => {
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

test('geo: a healthy dependency still does not make the shell ready', async () => {
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

test('geo: dependency failure is DOWN without credential leakage', async () => {
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

test('geo: the service is declared foundation-only, not business ready', () => {
  assert.equal(SERVICE_NAME, 'geo');
  assert.equal(BUSINESS_READY, false);
});

test('geo: a missing DATABASE_URL fails closed instead of guessing', () => {
  assert.throws(() => databaseUrlFromEnv({}), /DATABASE_URL_REQUIRED/);
  assert.throws(() => databaseUrlFromEnv({ DATABASE_URL: '' }), /DATABASE_URL_REQUIRED/);
});

test('geo: the postgres probe is wired to this service own client', async () => {
  const moduleRef = await compile();
  const probe = postgresProbe(moduleRef.get(PrismaService));
  assert.equal(probe.name, 'postgres');
  assert.equal(probe.kind, 'postgres');
  await moduleRef.close();
});

test('geo: an invalid serviceability rate limit stops startup instead of guessing', () => {
  assert.throws(
    () => rateLimitFromEnv({ GEO_SERVICEABILITY_RATE_PER_MINUTE: '0' }),
    /INVALID_GEO_RATE_LIMIT/,
  );
  assert.throws(
    () => rateLimitFromEnv({ GEO_SERVICEABILITY_RATE_PER_MINUTE: 'lots' }),
    /INVALID_GEO_RATE_LIMIT/,
  );
  assert.ok(rateLimitFromEnv({}));
});

interface Envelope {
  error: {
    code: string;
    retryable: boolean;
    requestId: string;
    correlationId: string;
    issues: { field: string; code: string }[];
  };
}

test('geo: serviceability fails closed without Identity; envelopes follow P01-E1', async () => {
  process.env.DATABASE_URL = DSN;
  delete process.env.GEO_IDENTITY_ORIGIN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const post = (route: string, body: string, headers: Record<string, string> = {}) =>
      fetch(url + '/internal/v1/geo' + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      });
    const unconfigured = await post(
      '/serviceability',
      JSON.stringify({ point: { latitude: '0.500000', longitude: '0.500000' } }),
      { authorization: 'Bearer anything', 'x-correlation-id': 'corr-1' },
    );
    assert.equal(unconfigured.status, 503);
    const body = (await unconfigured.json()) as Envelope;
    assert.equal(body.error.code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(body.error.retryable, true);
    assert.equal(body.error.correlationId, 'corr-1');
    assert.equal(unconfigured.headers.get('x-correlation-id'), 'corr-1');
    assert.equal(unconfigured.headers.get('cache-control'), 'no-store');

    const malformed = await post('/serviceability', '{"point":');
    assert.equal(malformed.status, 400);
    assert.equal(((await malformed.json()) as Envelope).error.code, 'REQUEST_INVALID');

    const validate = await post('/serviceability/validate', '{}', {
      'x-service-client': 'booking',
      'x-service-token': 'not-a-credential',
    });
    assert.equal(validate.status, 403, 'service routes stay closed without workload identity');
    assert.equal(((await validate.json()) as Envelope).error.code, 'AUTH_FORBIDDEN');

    const unknown = await fetch(url + '/internal/v1/geo/zones/admin');
    assert.equal(unknown.status, 404);
    assert.equal(((await unknown.json()) as Envelope).error.code, 'NOT_FOUND');
  } finally {
    await app.close();
  }
});

test('geo: proxy trust defaults off and permits only explicit IP hosts', () => {
  assert.equal(trustedProxiesFromEnv({}), false);
  assert.deepEqual(trustedProxiesFromEnv({ GEO_TRUSTED_PROXY_IPS: '127.0.0.1, ::1' }), [
    '127.0.0.1',
    '::1',
  ]);
  for (const value of ['true', '*', '1', 'loopback', '10.0.0.0/8', 'gateway', '127.0.0.1,']) {
    assert.throws(
      () => trustedProxiesFromEnv({ GEO_TRUSTED_PROXY_IPS: value }),
      /INVALID_GEO_TRUSTED_PROXY_IPS/,
    );
  }
});

async function clientRateStatuses(trustedProxy: string, forwarded: string[]) {
  const previousRate = process.env.GEO_SERVICEABILITY_RATE_PER_MINUTE;
  const previousProxies = process.env.GEO_TRUSTED_PROXY_IPS;
  process.env.DATABASE_URL = DSN;
  process.env.GEO_SERVICEABILITY_RATE_PER_MINUTE = '1';
  process.env.GEO_TRUSTED_PROXY_IPS = trustedProxy;
  const app = await createHttpApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const statuses = [];
    for (const address of forwarded) {
      const response = await fetch(base + '/internal/v1/geo/serviceability', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
        // Without an Identity origin every admitted request fails closed (503)
        // before any database access, which exercises the real limiter alone.
        body: JSON.stringify({ point: { latitude: '0.500000', longitude: '0.500000' } }),
      });
      statuses.push(response.status);
    }
    return statuses;
  } finally {
    await app.close();
    if (previousRate === undefined) delete process.env.GEO_SERVICEABILITY_RATE_PER_MINUTE;
    else process.env.GEO_SERVICEABILITY_RATE_PER_MINUTE = previousRate;
    if (previousProxies === undefined) delete process.env.GEO_TRUSTED_PROXY_IPS;
    else process.env.GEO_TRUSTED_PROXY_IPS = previousProxies;
  }
}

test('geo: clients behind one trusted proxy have independent rate budgets', async () => {
  assert.deepEqual(
    await clientRateStatuses('127.0.0.1', [
      '198.51.100.10',
      '198.51.100.10',
      '198.51.100.20',
      '198.51.100.20',
    ]),
    [503, 429, 503, 429],
  );
});

test('geo: an untrusted caller cannot rotate forwarded addresses to evade its rate limit', async () => {
  assert.deepEqual(await clientRateStatuses('', ['198.51.100.10', '198.51.100.20']), [503, 429]);
});

test('geo: spoofed prefixes cannot override the nearest untrusted forwarded hop', async () => {
  assert.deepEqual(
    await clientRateStatuses('127.0.0.1', [
      '198.51.100.99, 198.51.100.10',
      '198.51.100.98, 198.51.100.10',
    ]),
    [503, 429],
  );
});
