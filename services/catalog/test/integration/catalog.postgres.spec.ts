import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { canonicalJson } from '../../src/application';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaCatalogRepository } from '../../src/infrastructure/persistence/prisma-catalog.repository';
import { Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import { definitionsFixture } from '../support/catalog-fixtures';
import { FixedClock } from '../support/in-memory-catalog.repository';
import { TOKENS, startCatalogHttp, type CatalogHttpHarness } from '../support/catalog-http-harness';

/*
 * REAL PostgreSQL evidence. Runs as the least-privileged runtime role
 * (cw_catalog_app) against a database migrated by cw_catalog_migrate through
 * scripts/production/B/postgres-acceptance.mjs. Identity is a local HTTP stub.
 * There is deliberately no skip: missing configuration fails the run.
 */
const APP_URL = process.env.CATALOG_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('CATALOG_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;
const PATH = '/internal/v1/catalog';
const HOUR = 3_600_000;

let prismaA: PrismaService;
let prismaB: PrismaService;
let clock: FixedClock;
let replicaA: CatalogHttpHarness;
let replicaB: CatalogHttpHarness;
let sql: Client;
let keySeq = 0;

function key(): string {
  keySeq += 1;
  return `pg-catalog-key-${String(keySeq).padStart(6, '0')}-${process.pid}`;
}

async function head(): Promise<number> {
  const response = await replicaA.request('GET', `${PATH}/revisions`, { token: TOKENS.admin });
  const revisions = response.body.revisions as { revision: number }[];
  return revisions[0]?.revision ?? 0;
}

before(async () => {
  // Every run starts at the current wall clock so a re-run against the same
  // database keeps effective dates increasing.
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  prismaA = new PrismaService(DATABASE_URL);
  prismaB = new PrismaService(DATABASE_URL);
  // Two independent connection pools behave like two service replicas.
  replicaA = await startCatalogHttp({ repository: new PrismaCatalogRepository(prismaA), clock });
  replicaB = await startCatalogHttp({ repository: new PrismaCatalogRepository(prismaB), clock });
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

test('postgres: published definitions round-trip exactly and the fingerprint is reproducible', async () => {
  const expected = await head();
  clock.advance(HOUR);
  const published = await replicaA.request('POST', `${PATH}/definitions`, {
    token: TOKENS.admin,
    key: key(),
    body: { expectedRevision: expected, effectiveFrom: null, definitions: definitionsFixture() },
  });
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const revision = published.body.revision as number;
  assert.equal(revision, expected + 1);

  // A different replica, with its own pool, reads the stored relational rows.
  const read = await replicaB.request('GET', `${PATH}/definitions/${revision}`, {
    token: TOKENS.customer,
  });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.definitions, published.body.definitions);
  const recomputed = new Sha256Hasher().sha256Hex(canonicalJson(read.body.definitions));
  assert.equal(recomputed, read.body.definitionsFingerprint);

  const rows = await sql.query(
    'SELECT published_by, correlation_id, effective_from FROM catalog_revision WHERE revision = $1',
    [revision],
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].published_by, '1d8b2c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d');
  const audit = await sql.query(
    "SELECT outcome FROM catalog_audit_event WHERE revision = $1 AND action = 'catalog.revision.published'",
    [revision],
  );
  assert.equal(audit.rowCount, 1);
});

test('postgres: concurrent publishers on two replicas create exactly one revision', async () => {
  const expected = await head();
  clock.advance(HOUR);
  const attempts = await Promise.all(
    Array.from({ length: 12 }, (_, n) =>
      (n % 2 === 0 ? replicaA : replicaB).request('POST', `${PATH}/definitions`, {
        token: TOKENS.admin,
        key: key(),
        body: {
          expectedRevision: expected,
          effectiveFrom: null,
          definitions: definitionsFixture(),
        },
      }),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === 201).length, 1);
  assert.equal(attempts.filter((r) => r.status === 409).length, 11);
  const count = await sql.query(
    'SELECT count(*)::int AS n FROM catalog_revision WHERE revision > $1',
    [expected],
  );
  assert.equal(count.rows[0].n, 1);
  const rejected = await sql.query(
    "SELECT count(*)::int AS n FROM catalog_idempotency_receipt WHERE response_status = 409 AND response_body->>'code' = 'REVISION_CONFLICT'",
  );
  assert.ok(rejected.rows[0].n >= 11, 'terminal rejections are durable receipts');
});

test('postgres: the same key raced across replicas has one effect and one recorded result', async () => {
  const expected = await head();
  clock.advance(HOUR);
  const shared = key();
  const body = {
    expectedRevision: expected,
    effectiveFrom: null,
    definitions: definitionsFixture(),
  };
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, n) =>
      (n % 2 === 0 ? replicaA : replicaB).request('POST', `${PATH}/definitions`, {
        token: TOKENS.admin,
        key: shared,
        body,
      }),
    ),
  );
  assert.ok(results.every((r) => r.status === 201 && r.body.revision === expected + 1));
  assert.equal(results.filter((r) => r.headers.get('idempotency-replayed') === 'false').length, 1);
  const conflict = await replicaB.request('POST', `${PATH}/definitions`, {
    token: TOKENS.admin,
    key: shared,
    body: { ...body, expectedRevision: expected + 1 },
  });
  assert.equal(conflict.status, 409);
  assert.equal((conflict.body.error as { code: string }).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(await head(), expected + 1, 'the conflicting payload had no effect');
});

test('postgres: effective windows switch exactly at the boundary', async () => {
  const expected = await head();
  clock.advance(HOUR);
  const boundary = new Date(clock.now().getTime() + 30 * 60_000);
  const scheduled = await replicaA.request('POST', `${PATH}/definitions`, {
    token: TOKENS.admin,
    key: key(),
    body: {
      expectedRevision: expected,
      effectiveFrom: boundary.toISOString(),
      definitions: definitionsFixture(),
    },
  });
  assert.equal(scheduled.status, 201);
  const repository = new PrismaCatalogRepository(prismaA);
  assert.equal(
    (await repository.revisionInForce(new Date(boundary.getTime() - 1)))?.revision,
    expected,
  );
  assert.equal((await repository.revisionInForce(boundary))?.revision, expected + 1);
  const current = await replicaA.request('GET', `${PATH}/definitions`, { token: TOKENS.customer });
  assert.equal(current.body.revision, expected);
  assert.equal(current.body.effectiveUntil, boundary.toISOString());
  // Publishing "now" while a later revision is scheduled is rejected, not reordered.
  const backwards = await replicaA.request('POST', `${PATH}/definitions`, {
    token: TOKENS.admin,
    key: key(),
    body: {
      expectedRevision: expected + 1,
      effectiveFrom: null,
      definitions: definitionsFixture(),
    },
  });
  assert.equal(backwards.status, 422);
  assert.equal(
    (backwards.body.error as { code: string }).code,
    'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS',
  );
  clock.current = new Date(boundary.getTime());
});

async function rejectsSql(statement: string, params: unknown[], pattern: RegExp): Promise<void> {
  await sql.query('BEGIN');
  try {
    await assert.rejects(sql.query(statement, params), pattern);
  } finally {
    await sql.query('ROLLBACK');
  }
}

test('postgres: published rows are immutable even for the runtime role', async () => {
  const revision = await head();
  assert.ok(revision >= 1);
  const immutable = /CATALOG_IMMUTABLE/;
  await rejectsSql(
    "UPDATE catalog_package SET label_ar = 'x' WHERE revision = $1",
    [revision],
    immutable,
  );
  await rejectsSql('DELETE FROM catalog_package_addon WHERE revision = $1', [revision], immutable);
  await rejectsSql('DELETE FROM catalog_revision WHERE revision = $1', [revision], immutable);
  await rejectsSql(
    'UPDATE catalog_revision SET effective_from = now() WHERE revision = $1',
    [revision],
    immutable,
  );
  await rejectsSql('UPDATE catalog_idempotency_receipt SET response_status = 200', [], immutable);
  await rejectsSql('DELETE FROM catalog_audit_event', [], immutable);
  await rejectsSql('DELETE FROM catalog_publication_lock', [], immutable);
  await rejectsSql(
    "INSERT INTO catalog_vehicle_category (revision, id, label_ar, label_en, extra_duration_minutes, sort_order) VALUES ($1, 'late-add', 'متأخر', NULL, 0, 0)",
    [revision],
    /CATALOG_REVISION_IMMUTABLE/,
  );
  await rejectsSql('TRUNCATE catalog_audit_event', [], /permission denied/);
  await rejectsSql('CREATE TABLE app.rogue (id int)', [], /permission denied/);
});

test('postgres: chain, uniqueness and value constraints hold without the application', async () => {
  const revision = await head();
  const row = await sql.query('SELECT effective_from FROM catalog_revision WHERE revision = $1', [
    revision,
  ]);
  const last = row.rows[0].effective_from as Date;
  const insert =
    "INSERT INTO catalog_revision (revision, previous_revision, effective_from, published_at, published_by, correlation_id, definitions_fingerprint) VALUES ($1, $2, $3, $4, gen_random_uuid(), gen_random_uuid(), repeat('a', 64))";
  // Skipping a revision number breaks the linear chain.
  await rejectsSql(
    insert,
    [revision + 2, revision, new Date(last.getTime() + HOUR), last],
    /catalog_revision_linear_chain/,
  );
  // A second successor of the same revision is a uniqueness violation.
  await rejectsSql(
    insert,
    [revision, revision - 1, new Date(last.getTime() + HOUR), last],
    /duplicate key/,
  );
  // Effective dates must strictly increase along the chain.
  await rejectsSql(
    insert,
    [revision + 1, revision, last, last],
    /CATALOG_EFFECTIVE_FROM_NOT_INCREASING/,
  );
  // Retroactive publication is impossible.
  await rejectsSql(
    insert,
    [revision + 1, revision, new Date(last.getTime() + HOUR), new Date(last.getTime() + 2 * HOUR)],
    /catalog_revision_not_retroactive/,
  );
  // Within one new revision: relation vocabulary, duplicate pairs and bounds.
  await sql.query('BEGIN');
  try {
    await sql.query(insert, [revision + 1, revision, new Date(last.getTime() + HOUR), last]);
    await sql.query(
      "INSERT INTO catalog_vehicle_category VALUES ($1, 'sedan', 'سيدان', NULL, 0, 0)",
      [revision + 1],
    );
    await sql.query('SAVEPOINT s');
    await assert.rejects(
      sql.query("INSERT INTO catalog_package VALUES ($1, 'p', 'باقة', NULL, NULL, 0, 0, '{}')", [
        revision + 1,
      ]),
      /catalog_package_duration|catalog_package_id_format/,
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
      WHERE n.nspname = 'app' AND starts_with(p.proname, 'catalog_')`,
  );
  assert.equal(rows.rowCount, 3);
  for (const row of rows.rows) {
    assert.equal(row.runtime, false, row.proname);
    assert.doesNotMatch(row.acl, /(^|,)=X/, `${row.proname} must not grant EXECUTE to PUBLIC`);
  }
});
