import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './_load.mjs';

/**
 * Regression tests for the ARCHITECTURAL rules in the boundary checker.
 *
 * A guard that never fails is indistinguishable from no guard at all, so each
 * rule is exercised with a fixture that violates it and a fixture that does not.
 */

async function withFixture(build) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cw-arch-'));
  try {
    for (const sub of [
      'architecture',
      'scripts',
      'services/one/src',
      'services/one/prisma',
      'services/two/src',
      'packages',
      'apps',
    ]) {
      await mkdir(path.join(dir, sub), { recursive: true });
    }
    await writeFile(
      path.join(dir, 'scripts/check-boundaries.mjs'),
      await readFile(path.join(ROOT, 'scripts/check-boundaries.mjs')),
    );
    await writeFile(
      path.join(dir, 'architecture/service-catalog.json'),
      JSON.stringify({
        services: [
          { id: 'one', database: 'cw_one', runtimeRole: 'one_app', migrationRole: 'one_migrate' },
          { id: 'two', database: 'cw_two', runtimeRole: 'two_app', migrationRole: 'two_migrate' },
        ],
      }),
    );
    for (const name of ['one', 'two']) {
      await writeFile(
        path.join(dir, `services/${name}/package.json`),
        JSON.stringify({ name: `@carwash/${name}`, private: true }),
      );
      await writeFile(
        path.join(dir, `services/${name}/src/app.module.ts`),
        'export const BUSINESS_READY = false;\n',
      );
    }
    await build(dir);
    return spawnSync(process.execPath, [path.join(dir, 'scripts/check-boundaries.mjs')], {
      encoding: 'utf8',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('architecture guard: a clean fixture passes', async () => {
  const result = await withFixture(async () => {});
  assert.equal(result.status, 0, result.stderr);
});

test('architecture guard: a shared package owning a database client is rejected', async () => {
  // The single change that would re-create a shared business database layer.
  const result = await withFixture(async (dir) => {
    await mkdir(path.join(dir, 'packages/database'), { recursive: true });
    await writeFile(
      path.join(dir, 'packages/database/package.json'),
      JSON.stringify({ name: '@carwash/database', dependencies: { '@prisma/client': '7.10.0' } }),
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not depend on @prisma\/client/);
});

test('architecture guard: a shared package owning a Prisma schema is rejected', async () => {
  const result = await withFixture(async (dir) => {
    await mkdir(path.join(dir, 'packages/shared/prisma'), { recursive: true });
    await writeFile(
      path.join(dir, 'packages/shared/package.json'),
      JSON.stringify({ name: '@carwash/shared' }),
    );
    await writeFile(path.join(dir, 'packages/shared/prisma/schema.prisma'), 'datasource db {}');
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not own a Prisma schema/);
});

test('architecture guard: a gateway app owning business data is rejected', async () => {
  const result = await withFixture(async (dir) => {
    await mkdir(path.join(dir, 'apps/api-gateway'), { recursive: true });
    await writeFile(
      path.join(dir, 'apps/api-gateway/package.json'),
      JSON.stringify({ name: '@carwash/api-gateway', dependencies: { prisma: '7.10.0' } }),
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /gateway and admin own no business data/);
});

test('architecture guard: event contracts depending on a database library are rejected', async () => {
  const result = await withFixture(async (dir) => {
    await mkdir(path.join(dir, 'packages/event-contracts'), { recursive: true });
    await writeFile(
      path.join(dir, 'packages/event-contracts/package.json'),
      JSON.stringify({
        name: '@carwash/event-contracts',
        dependencies: { '@prisma/client': '7.10.0' },
      }),
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not depend on/);
});

for (const [label, source] of [
  ['a migrate deploy call', "const cmd = 'prisma migrate deploy';"],
  ['a raw CREATE TABLE', "await prisma.$executeRawUnsafe('CREATE TABLE app.x (id int)');"],
  ['a raw DROP TABLE', "await prisma.$executeRawUnsafe('DROP TABLE app.x');"],
]) {
  test(`architecture guard: ${label} in service runtime code is rejected`, async () => {
    const result = await withFixture(async (dir) => {
      await writeFile(path.join(dir, 'services/one/src/startup.ts'), source);
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not run migrations/);
  });
}

test('architecture guard: a foundation shell claiming business readiness is rejected', async () => {
  const result = await withFixture(async (dir) => {
    await writeFile(
      path.join(dir, 'services/one/src/app.module.ts'),
      'export const BUSINESS_READY = true;\n',
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BUSINESS_READY = false/);
});

test('architecture guard: a schema naming another service database is rejected', async () => {
  const result = await withFixture(async (dir) => {
    await writeFile(
      path.join(dir, 'services/one/prisma/schema.prisma'),
      'datasource db {\n  provider = "postgresql"\n}\n// joins cw_two for reporting\n',
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references another service database/);
});

test('architecture guard: a schema embedding a connection URL is rejected', async () => {
  // A URL in the schema erases the distinction between the migration identity
  // and the runtime identity.
  const result = await withFixture(async (dir) => {
    await writeFile(
      path.join(dir, 'services/one/prisma/schema.prisma'),
      'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n',
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not embed a connection URL/);
});
