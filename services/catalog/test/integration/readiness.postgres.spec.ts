import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HealthController, type HealthOptions } from '@carwash/service-kit';
import { runtimeHealthOptions } from '../../src/app.module';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { createHttpApplication } from '../../src/transport/http/create-app';

const databaseUrl = process.env.CATALOG_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('CATALOG_TEST_DATABASE_URL_REQUIRED');
const appUrl: string = databaseUrl;

interface HealthBody {
  service: string;
  ready: boolean;
  businessReady: boolean;
  dependenciesReady: boolean;
  scope: string;
  code: string;
  dependencies: { name: string; status: string }[];
}

async function health(options: HealthOptions): Promise<{ status: number; body: HealthBody }> {
  let status = 0;
  let body: HealthBody | undefined;
  const response = {
    status(code: number) {
      status = code;
      return response;
    },
    json(value: unknown) {
      body = value as HealthBody;
      return value;
    },
  };
  await new HealthController(options).ready(response);
  assert.ok(body);
  return { status, body };
}

test('catalog readiness uses the real migrated owner database and its actual HTTP composition', async () => {
  const original = {
    database: process.env.DATABASE_URL,
    identity: process.env.IDENTITY_SESSION_ORIGIN,
  };
  process.env.DATABASE_URL = appUrl;
  // This probe validates local routing configuration only; Gateway separately
  // probes the real Identity runtime. No request to this test origin is made.
  process.env.IDENTITY_SESSION_ORIGIN = 'https://identity.readiness-fixture.invalid';
  const app = await createHttpApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch((await app.getUrl()) + '/health/ready');
    const body = (await response.json()) as HealthBody;
    assert.equal(response.status, 200);
    assert.equal(body.service, 'catalog');
    assert.equal(body.scope, 'http-api');
    assert.equal(body.ready, true);
    assert.equal(body.dependenciesReady, true);
    assert.deepEqual(
      body.dependencies.map(({ name, status }) => ({ name, status })),
      [
        { name: 'postgres', status: 'UP' },
        { name: 'postgres-schema', status: 'UP' },
      ],
    );
  } finally {
    await app.close();
    if (original.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original.database;
    if (original.identity === undefined) delete process.env.IDENTITY_SESSION_ORIGIN;
    else process.env.IDENTITY_SESSION_ORIGIN = original.identity;
  }
});

test('a healthy PostgreSQL never promotes missing owner configuration', async () => {
  const prisma = new PrismaService(appUrl);
  try {
    const result = await health(runtimeHealthOptions(prisma, appUrl, {}));
    assert.equal(result.status, 503);
    assert.equal(result.body.businessReady, false);
    assert.equal(result.body.dependenciesReady, true);
    assert.equal(result.body.code, 'FOUNDATION_NOT_READY');
  } finally {
    await prisma.onModuleDestroy();
  }
});

test('a connected database with an absent owner schema remains unready without changing tables', async () => {
  const url = new URL(appUrl);
  url.searchParams.set('schema', `readiness_absent_${randomUUID().replaceAll('-', '')}`);
  const prisma = new PrismaService(url.toString());
  try {
    const result = await health(
      runtimeHealthOptions(prisma, url.toString(), {
        IDENTITY_SESSION_ORIGIN: 'https://identity.readiness-fixture.invalid',
      }),
    );
    assert.equal(result.status, 503);
    assert.equal(result.body.businessReady, true);
    assert.equal(result.body.dependenciesReady, false);
    assert.equal(
      result.body.dependencies.find((dependency) => dependency.name === 'postgres')?.status,
      'UP',
    );
    assert.equal(
      result.body.dependencies.find((dependency) => dependency.name === 'postgres-schema')?.status,
      'DOWN',
    );
    assert.equal(result.body.code, 'DEPENDENCY_DOWN');
    assert.ok(!JSON.stringify(result.body).includes(url.password));
  } finally {
    await prisma.onModuleDestroy();
  }
});
