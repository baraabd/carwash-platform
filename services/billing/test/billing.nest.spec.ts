import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { HealthController, HEALTH_OPTIONS, type HealthOptions } from '@carwash/service-kit';
import { AppModule, BUSINESS_READY, SERVICE_NAME, postgresProbe } from '../src/app.module';
import { PrismaService, databaseUrlFromEnv } from '../src/prisma.service';
import { createHttpApplication } from '../src/transport/http/create-app';

const DSN = 'postgresql://cw_billing_app:placeholder@127.0.0.1:5432/cw_billing?schema=app';

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

test('billing: the application module compiles and wires its dependencies', async () => {
  const moduleRef = await compile();
  assert.ok(moduleRef.get(PrismaService) instanceof PrismaService);
  assert.ok(moduleRef.get(HealthController) instanceof HealthController);
  await moduleRef.close();
});

test('billing: the real HTTP adapter boots with distinct live/ready semantics', async () => {
  process.env.DATABASE_URL = DSN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const live = await fetch(url + '/health/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), {
      service: 'billing',
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

test('billing: liveness reports the process is running, and its real stage', async () => {
  const moduleRef = await compile();
  const controller = moduleRef.get(HealthController);
  assert.deepEqual(controller.live(), {
    service: 'billing',
    status: 'alive',
    stage: 'foundation-only',
  });
  await moduleRef.close();
});

test('billing: foundation readiness returns 503', async () => {
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

test('billing: a healthy dependency still does not make the shell ready', async () => {
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

test('billing: dependency failure is DOWN without credential leakage', async () => {
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

test('billing: the composed owner API fails closed without Identity configuration', async () => {
  process.env.DATABASE_URL = DSN;
  delete process.env.IDENTITY_SESSION_ORIGIN;
  delete process.env.PRICING_ORIGIN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const body = JSON.stringify({ quoteId: '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f' });
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': 'nest-spec-key-000001',
    };
    const anonymous = await fetch(url + '/internal/v1/billing/obligations', {
      method: 'POST',
      headers,
      body,
    });
    assert.equal(anonymous.status, 401);
    const unverifiable = await fetch(url + '/internal/v1/billing/obligations', {
      method: 'POST',
      headers: { ...headers, authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.c2ln' },
      body,
    });
    assert.equal(unverifiable.status, 503, 'no Identity origin means no decision, never a grant');
    const read = await fetch(
      url + '/internal/v1/billing/obligations/6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
      {
        headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.c2ln' },
      },
    );
    assert.equal(read.status, 503);
  } finally {
    await app.close();
  }
});

test('billing: the composed cash/custody API is mounted and fails closed', async () => {
  process.env.DATABASE_URL = DSN;
  delete process.env.IDENTITY_SESSION_ORIGIN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const id = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
    const bearer = 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.c2ln';
    const commands: [string, unknown][] = [
      [`/obligations/${id}/cash-collections`, { expectedRevision: 2, bookingId: id, amount: null }],
      [`/cash-receipts/${id}/reversal`, { expectedRevision: 1, reason: 'RECORDED_IN_ERROR' }],
      ['/custody/handovers', { receiptIds: [id], declaredAmount: null }],
      [`/custody/handovers/${id}/cancel`, { expectedRevision: 1 }],
      [`/custody/handovers/${id}/treasury-receipt`, { expectedRevision: 1 }],
      [`/custody/handovers/${id}/reconciliation`, { expectedRevision: 2 }],
    ];
    for (const [path, body] of commands) {
      const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'nest-custody-key-0001' },
        body: JSON.stringify(body),
      };
      const anonymous = await fetch(url + '/internal/v1/billing' + path, init);
      assert.equal(anonymous.status, 401, path);
      const unverifiable = await fetch(url + '/internal/v1/billing' + path, {
        ...init,
        headers: { ...init.headers, authorization: bearer },
      });
      assert.equal(unverifiable.status, 503, path);
    }
    for (const path of [
      `/cash-receipts/${id}`,
      `/custody/handovers/${id}`,
      '/custody/holders/me',
      `/custody/holders/${id}`,
      '/custody/reconciliation',
    ]) {
      const read = await fetch(url + '/internal/v1/billing' + path, {
        headers: { authorization: bearer },
      });
      assert.equal(read.status, 503, path);
    }
  } finally {
    await app.close();
  }
});

test('billing: the composed provider/refund API is mounted and fails closed', async () => {
  process.env.DATABASE_URL = DSN;
  delete process.env.IDENTITY_SESSION_ORIGIN;
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    const id = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
    const bearer = 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.c2ln';
    const commands: [string, unknown][] = [
      ['/provider-credits', { provider: 'SHAM_CASH' }],
      [`/provider-credits/${id}/decision`, { expectedRevision: 1 }],
      [`/payment-attempts/${id}/provider-verification`, {}],
      [`/provider-credits/${id}/refunds`, { expectedRevision: 1 }],
      [`/refunds/${id}/decision`, { expectedRevision: 1 }],
      [`/refunds/${id}/provider-execution`, { expectedRevision: 2 }],
      [`/refunds/${id}/manual-completion`, { expectedRevision: 2 }],
    ];
    for (const [path, body] of commands) {
      const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'nest-provider-key-001' },
        body: JSON.stringify(body),
      };
      const anonymous = await fetch(url + '/internal/v1/billing' + path, init);
      assert.equal(anonymous.status, 401, path);
      const unverifiable = await fetch(url + '/internal/v1/billing' + path, {
        ...init,
        headers: { ...init.headers, authorization: bearer },
      });
      assert.equal(unverifiable.status, 503, path);
    }
    for (const path of [
      '/providers',
      '/provider-credits?status=UNALLOCATED',
      `/provider-credits/${id}`,
      '/refunds?status=REQUESTED',
      `/refunds/${id}`,
    ]) {
      const read = await fetch(url + '/internal/v1/billing' + path, {
        headers: { authorization: bearer },
      });
      assert.equal(read.status, 503, path);
    }
    // Production adapters have no notification capability (no official API):
    // the provider callback is indistinguishable from a missing route.
    for (const provider of ['sham_cash', 'syriatel_cash', 'unknown']) {
      const callback = await fetch(
        `${url}/internal/v1/billing/providers/${provider}/notifications`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'credit.final' }),
        },
      );
      assert.equal(callback.status, 404, provider);
    }
  } finally {
    await app.close();
  }
});

test('billing: provider automation settings without an adapter fail startup', async () => {
  process.env.DATABASE_URL = DSN;
  process.env.BILLING_SHAM_CASH_WEBHOOK_SECRET_FILE = '/run/secrets/never-read';
  try {
    await assert.rejects(compile(), /BILLING_SHAM_CASH_AUTOMATION_NOT_IMPLEMENTED/);
  } finally {
    delete process.env.BILLING_SHAM_CASH_WEBHOOK_SECRET_FILE;
  }
});

test('billing: the service is declared foundation-only, not business ready', () => {
  assert.equal(SERVICE_NAME, 'billing');
  assert.equal(BUSINESS_READY, false);
});

test('billing: a missing DATABASE_URL fails closed instead of guessing', () => {
  assert.throws(() => databaseUrlFromEnv({}), /DATABASE_URL_REQUIRED/);
  assert.throws(() => databaseUrlFromEnv({ DATABASE_URL: '' }), /DATABASE_URL_REQUIRED/);
});

test('billing: the postgres probe is wired to this service own client', async () => {
  const moduleRef = await compile();
  const probe = postgresProbe(moduleRef.get(PrismaService));
  assert.equal(probe.name, 'postgres');
  assert.equal(probe.kind, 'postgres');
  await moduleRef.close();
});
