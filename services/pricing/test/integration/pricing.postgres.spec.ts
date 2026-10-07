import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client, Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaPricingRepository } from '../../src/infrastructure/persistence/prisma-pricing.repository';
import {
  FakeCatalogReader,
  ADMIN_SUBJECT,
  FixedClock,
  FixedPolicy,
  TEST_POLICY,
  ratesFixture,
  snapshotFixture,
} from '../support/pricing-fixtures';
import { TOKENS, startPricingHttp, type PricingHttpHarness } from '../support/pricing-http-harness';

/*
 * REAL PostgreSQL evidence, run as the least-privileged runtime role
 * (cw_pricing_app) on a database migrated by cw_pricing_migrate through
 * scripts/production/B/postgres-acceptance.mjs. Identity is a local HTTP stub
 * and the Catalog reader is a test double (the real contract is pending on E).
 * No skip: missing configuration fails the run.
 */
const APP_URL = process.env.PRICING_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('PRICING_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;
const PATH = '/internal/v1/pricing';
const HOUR = 3_600_000;

let prismaA: PrismaService;
let prismaB: PrismaService;
let clock: FixedClock;
let replicaA: PricingHttpHarness;
let replicaB: PricingHttpHarness;
let sql: Client;
let seq = 0;
const key = () => `pg-pricing-key-${String(++seq).padStart(6, '0')}-${process.pid}`;
const selection = (overrides: Record<string, unknown> = {}) => ({
  catalogRevision: 1,
  categoryId: 'suv',
  packageId: 'exterior',
  addonIds: ['tyre-shine'],
  ...overrides,
});

async function head(): Promise<number> {
  const list = await replicaA.request('GET', `${PATH}/price-versions`, { token: TOKENS.admin });
  return (list.body.versions as { version: number }[])[0]?.version ?? 0;
}

async function publish(rates = ratesFixture()): Promise<number> {
  const expected = await head();
  clock.advance(HOUR);
  const response = await replicaA.request('POST', `${PATH}/prices`, {
    token: TOKENS.admin,
    key: key(),
    body: { expectedVersion: expected, effectiveFrom: null, catalogRevision: 1, rates },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.version as number;
}

before(async () => {
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  const catalog = new FakeCatalogReader();
  catalog.snapshots.set(1, snapshotFixture(1));
  const policy = new FixedPolicy();
  prismaA = new PrismaService(DATABASE_URL);
  prismaB = new PrismaService(DATABASE_URL);
  replicaA = await startPricingHttp({
    repository: new PrismaPricingRepository(prismaA),
    catalog,
    policy,
    clock,
  });
  replicaB = await startPricingHttp({
    repository: new PrismaPricingRepository(prismaB),
    catalog,
    policy,
    clock,
  });
  sql = new Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await sql.connect();
  await sql.query('SET search_path TO app');
});

after(async () => {
  await replicaA?.close();
  await replicaB?.close();
  await prismaA?.onModuleDestroy();
  await prismaB?.onModuleDestroy();
  await sql?.end();
});

test('postgres: price version and quote round-trip with exact amounts beyond 2^53', async () => {
  const huge = ratesFixture().map((r) =>
    r.definitionId === 'exterior' ? { ...r, amountMinor: '450000000000000001' } : r,
  );
  const version = await publish(huge);
  const quote = await replicaA.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: key(),
    body: selection(),
  });
  assert.equal(quote.status, 201, JSON.stringify(quote.body));
  assert.equal(quote.body.priceVersion, version);
  // 450000000000000001 + 20000 + 15000, exactly.
  assert.deepEqual(quote.body.total, {
    amountMinor: '450000000000035001',
    currency: TEST_POLICY.currency,
  });
  const stored = await sql.query('SELECT total_minor::text AS total FROM quote WHERE id = $1', [
    quote.body.quoteId,
  ]);
  assert.equal(stored.rows[0].total, '450000000000035001');
  const lines = await sql.query(
    'SELECT sum(amount_minor)::text AS sum, count(*)::int AS n FROM quote_line WHERE quote_id = $1',
    [quote.body.quoteId],
  );
  assert.deepEqual(lines.rows[0], { sum: '450000000000035001', n: 3 });
  // Another replica reads the identical immutable snapshot.
  const read = await replicaB.request('GET', `${PATH}/quotes/${quote.body.quoteId as string}`, {
    token: TOKENS.customer,
  });
  assert.deepEqual({ ...read.body, evaluatedAt: null }, { ...quote.body, evaluatedAt: null });
  const audit = await sql.query(
    'SELECT count(*)::int AS n FROM pricing_audit_event WHERE version = $1',
    [version],
  );
  assert.equal(audit.rows[0].n, 1);
});

test('postgres: concurrent publishers on two replicas create exactly one version', async () => {
  const expected = await head();
  clock.advance(HOUR);
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, n) =>
      (n % 2 ? replicaA : replicaB).request('POST', `${PATH}/prices`, {
        token: TOKENS.admin,
        key: key(),
        body: {
          expectedVersion: expected,
          effectiveFrom: null,
          catalogRevision: 1,
          rates: ratesFixture(),
        },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 9);
  assert.equal(await head(), expected + 1);
});

test('postgres: the same quote key raced across replicas yields one quote', async () => {
  await publish();
  const k = key();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, n) =>
      (n % 2 ? replicaA : replicaB).request('POST', `${PATH}/quotes`, {
        token: TOKENS.customer,
        key: k,
        body: selection(),
      }),
    ),
  );
  assert.ok(
    results.every((r) => r.status === 201),
    JSON.stringify(results.map((r) => r.status)),
  );
  const ids = new Set(results.map((r) => r.body.quoteId));
  assert.equal(ids.size, 1);
  const rows = await sql.query('SELECT count(*)::int AS n FROM quote WHERE id = $1', [[...ids][0]]);
  assert.equal(rows.rows[0].n, 1);
  const receipts = await sql.query(
    'SELECT count(*)::int AS n FROM pricing_idempotency_receipt WHERE idempotency_key = $1',
    [k],
  );
  assert.equal(receipts.rows[0].n, 1);
  const conflict = await replicaB.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: k,
    body: selection({ addonIds: [] }),
  });
  assert.equal(conflict.status, 409);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('postgres: quote waits for publication and caps expiry at the committed successor', async () => {
  const version = await publish();
  const repository = new PrismaPricingRepository(prismaB);
  const current = await repository.version(version);
  assert.ok(current);
  const effectiveFrom = new Date(clock.now().getTime() + 60_000);
  const staged = deferred();
  const release = deferred();
  const publication = repository.transaction(async (uow) => {
    await uow.lockHead();
    await uow.insertPriceVersion({
      ...current,
      version: version + 1,
      effectiveFrom,
      publishedAt: clock.now(),
      publishedBy: ADMIN_SUBJECT,
      correlationId: randomUUID(),
    });
    staged.resolve();
    await release.promise;
  });
  await Promise.race([staged.promise, publication]);
  const quote = replicaA.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: key(),
    body: selection(),
  });
  try {
    // Observe the real row-lock wait rather than depending on request timing.
    let waiting = false;
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const result = await sql.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user AND wait_event_type = 'Lock' AND query LIKE '%pricing_publication_lock%'",
      );
      if (result.rows[0].n > 0) {
        waiting = true;
        break;
      }
      await delay(10);
    }
    assert.equal(waiting, true, 'the quote must wait for the uncommitted publisher');
    release.resolve();
    await publication;
    const response = await quote;
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.priceVersion, version);
    assert.equal(response.body.expiresAt, effectiveFrom.toISOString());
  } finally {
    release.resolve();
    await publication;
    await quote;
  }
});

test('postgres: concurrent quotes complete through a single-connection pool', async () => {
  await publish();
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const client = new PrismaClient({
    adapter: new PrismaPg(pool, { schema: 'app', disposeExternalPool: true }),
  });
  const catalog = new FakeCatalogReader();
  const http = await startPricingHttp({
    repository: new PrismaPricingRepository({
      client,
      onModuleDestroy: () => client.$disconnect(),
    }),
    catalog,
    policy: new FixedPolicy(),
    clock,
  });
  try {
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        http.request('POST', `${PATH}/quotes`, {
          token: TOKENS.customer,
          key: key(),
          body: selection(),
        }),
      ),
    );
    assert.ok(
      responses.every((response) => response.status === 201),
      JSON.stringify(responses),
    );
    assert.equal(new Set(responses.map((response) => response.body.quoteId)).size, 3);
  } finally {
    await http.close();
    await client.$disconnect();
  }
});

test('postgres: expiry, validation and catalog-revision mismatch use server state', async () => {
  await publish();
  const quote = await replicaA.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: key(),
    body: selection(),
  });
  const id = quote.body.quoteId as string;
  const ok = await replicaB.request('POST', `${PATH}/quotes/${id}/validate`, {
    token: TOKENS.customer,
    body: selection(),
  });
  assert.equal(ok.status, 200);
  clock.advance(15 * 60_000);
  const expired = await replicaB.request('POST', `${PATH}/quotes/${id}/validate`, {
    token: TOKENS.customer,
    body: selection(),
  });
  assert.equal(expired.status, 409);
  assert.equal((expired.body.error as { code: string }).code, 'QUOTE_EXPIRED');
  const mismatch = await replicaA.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: key(),
    body: selection({ catalogRevision: 2 }),
  });
  assert.equal(mismatch.status, 409);
  assert.equal((mismatch.body.error as { code: string }).code, 'CATALOG_REVISION_MISMATCH');
  assert.equal(
    (await replicaA.request('GET', `${PATH}/quotes/${id}`, { token: TOKENS.otherCustomer })).status,
    404,
  );
});

async function rejectsSql(statements: [string, unknown[]][], pattern: RegExp): Promise<void> {
  await sql.query('BEGIN');
  try {
    let failure: unknown;
    try {
      for (const [statement, params] of statements) await sql.query(statement, params);
      await sql.query('COMMIT');
    } catch (error: unknown) {
      failure = error;
    }
    assert.ok(failure instanceof Error, 'the database must reject this');
    assert.match(failure.message, pattern);
  } finally {
    await sql.query('ROLLBACK').catch(() => undefined);
  }
}

test('postgres: versions, rates, quotes and receipts are immutable for the runtime role', async () => {
  const version = await head();
  const quote = (await sql.query('SELECT id FROM quote LIMIT 1')).rows[0].id as string;
  const immutable = /PRICING_IMMUTABLE/;
  await rejectsSql([['UPDATE quote SET total_minor = 1 WHERE id = $1', [quote]]], immutable);
  await rejectsSql([['DELETE FROM quote_line WHERE quote_id = $1', [quote]]], immutable);
  await rejectsSql(
    [['UPDATE price_rate SET amount_minor = 1 WHERE version = $1', [version]]],
    immutable,
  );
  await rejectsSql([['DELETE FROM price_version WHERE version = $1', [version]]], immutable);
  await rejectsSql(
    [['UPDATE pricing_idempotency_receipt SET response_status = 200', []]],
    immutable,
  );
  await rejectsSql([['DELETE FROM pricing_audit_event', []]], immutable);
  await rejectsSql(
    [["INSERT INTO price_rate VALUES ($1, 'ADDON', 'late-wax', 1)", [version]]],
    /PRICE_VERSION_IMMUTABLE/,
  );
  await rejectsSql(
    [["INSERT INTO quote_line VALUES ($1, 9, 'ADDON', 'late-wax', 1, false)", [quote]]],
    /QUOTE_IMMUTABLE/,
  );
  await rejectsSql([['TRUNCATE quote_line', []]], /permission denied/);
});

const QUOTE_INSERT =
  "INSERT INTO quote VALUES ($1, gen_random_uuid(), $2, $3, $4, 'XTS', 2, 'sedan', 'exterior', '{}', $5, $5, 35, repeat('b', 64), now(), now() + interval '1 minute', gen_random_uuid())";
const LINE_INSERT = 'INSERT INTO quote_line VALUES ($1, $2, $3, $4, $5, $6)';

test('postgres: a quote whose lines do not add up can never commit', async () => {
  const version = await head();
  const id = '7c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
  const policy = TEST_POLICY.revision;
  // Lines sum to 50000, subtotal claims 60000.
  await rejectsSql(
    [
      [QUOTE_INSERT, [id, version, 1, policy, 60000]],
      [LINE_INSERT, [id, 0, 'PACKAGE', 'exterior', 50000, false]],
      [LINE_INSERT, [id, 1, 'VEHICLE', 'sedan', 0, false]],
    ],
    /QUOTE_LINES_INCONSISTENT/,
  );
  // A quote without its vehicle line is incomplete.
  await rejectsSql(
    [
      [QUOTE_INSERT, [id, version, 1, policy, 50000]],
      [LINE_INSERT, [id, 0, 'PACKAGE', 'exterior', 50000, false]],
    ],
    /QUOTE_LINES_INCONSISTENT/,
  );
  // Two base lines of the same kind cannot substitute for one of each kind.
  for (const duplicateKind of ['PACKAGE', 'VEHICLE']) {
    await rejectsSql(
      [
        [QUOTE_INSERT, [id, version, 1, policy, 50000]],
        [LINE_INSERT, [id, 0, duplicateKind, 'first-base', 50000, false]],
        [LINE_INSERT, [id, 1, duplicateKind, 'second-base', 0, false]],
      ],
      /QUOTE_LINES_INCONSISTENT/,
    );
  }
  // A quote must match its price version's catalog revision and policy.
  await rejectsSql(
    [
      [QUOTE_INSERT, [id, version, 2, policy, 50000]],
      [LINE_INSERT, [id, 0, 'PACKAGE', 'exterior', 50000, false]],
      [LINE_INSERT, [id, 1, 'VEHICLE', 'sedan', 0, false]],
    ],
    /QUOTE_VERSION_INCONSISTENT/,
  );
  // An included add-on is free by construction.
  await rejectsSql(
    [
      [QUOTE_INSERT, [id, version, 1, policy, 50000]],
      [LINE_INSERT, [id, 0, 'ADDON', 'tyre-shine', 5, true]],
    ],
    /quote_line_included_is_free/,
  );
  await rejectsSql(
    [
      [
        "INSERT INTO quote VALUES ($1, gen_random_uuid(), $2, 1, $3, 'XTS', 2, 'sedan', 'exterior', '{}', 1, 1, 35, repeat('b', 64), now(), now(), gen_random_uuid())",
        [id, version, policy],
      ],
    ],
    /quote_expiry_after_issue/,
  );
  // And the consistent version of the same quote does commit.
  await sql.query('BEGIN');
  await sql.query(QUOTE_INSERT, [id, version, 1, policy, 50000]);
  await sql.query(LINE_INSERT, [id, 0, 'PACKAGE', 'exterior', 50000, false]);
  await sql.query(LINE_INSERT, [id, 1, 'VEHICLE', 'sedan', 0, false]);
  await sql.query('COMMIT');
});

test('postgres: price chain constraints hold without the application', async () => {
  const version = await head();
  const last = (
    await sql.query('SELECT effective_from FROM price_version WHERE version = $1', [version])
  ).rows[0].effective_from as Date;
  const insert =
    "INSERT INTO price_version VALUES ($1, $2, $3, $4, gen_random_uuid(), gen_random_uuid(), 1, repeat('a', 64), '{}'::jsonb, 'p', 'XTS', 2, repeat('a', 64))";
  await rejectsSql(
    [[insert, [version + 2, version, new Date(last.getTime() + HOUR), last]]],
    /price_version_linear_chain/,
  );
  await rejectsSql(
    [[insert, [version + 1, version, last, last]]],
    /PRICE_EFFECTIVE_FROM_NOT_INCREASING/,
  );
  await rejectsSql(
    [
      [
        insert,
        [
          version + 1,
          version,
          new Date(last.getTime() + HOUR),
          new Date(last.getTime() + 2 * HOUR),
        ],
      ],
    ],
    /price_version_not_retroactive/,
  );
  await rejectsSql(
    [[insert, [version, version - 1, new Date(last.getTime() + HOUR), last]]],
    /duplicate key/,
  );
  await sql.query('BEGIN');
  try {
    await sql.query(insert, [version + 1, version, new Date(last.getTime() + HOUR), last]);
    await assert.rejects(
      sql.query("INSERT INTO price_rate VALUES ($1, 'PACKAGE', 'exterior', -1)", [version + 1]),
      /price_rate_amount/,
    );
  } finally {
    await sql.query('ROLLBACK');
  }
});

test('postgres: trigger functions are not executable by the runtime role or PUBLIC', async () => {
  const rows = await sql.query(
    `SELECT p.proname,
            has_function_privilege(current_user, p.oid, 'EXECUTE') AS runtime,
            coalesce(array_to_string(p.proacl, ','), '') AS acl
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND starts_with(p.proname, 'pricing_')`,
  );
  assert.equal(rows.rowCount, 5);
  for (const row of rows.rows) {
    assert.equal(row.runtime, false, row.proname);
    assert.doesNotMatch(row.acl, /(^|,)=X/, `${row.proname} must not grant EXECUTE to PUBLIC`);
  }
});
