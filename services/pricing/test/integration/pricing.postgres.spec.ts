import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaPricingRepository } from '../../src/infrastructure/persistence/prisma-pricing.repository';
import { startCatalogStub, type CatalogStub } from '../support/catalog-stub';
import {
  CUSTOMER,
  DEF,
  FixedClock,
  FixedPolicy,
  priceBookRequest,
  quoteRequest,
} from '../support/pricing-fixtures';
import {
  SERVICE,
  TOKENS,
  startPricingHttp,
  type PricingHttpHarness,
} from '../support/pricing-http-harness';

/*
 * REAL PostgreSQL evidence, run as the least-privileged runtime role
 * (cw_pricing_app) on a database migrated by cw_pricing_migrate through
 * scripts/production/B/postgres-acceptance.mjs. Identity and Catalog are local
 * HTTP stubs of their published contracts. Two service replicas with separate
 * connection pools share the database to prove cross-replica races.
 * No skip: missing configuration fails the run.
 */
const APP_URL = process.env.PRICING_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('PRICING_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;
const PATH = '/internal/v1/pricing';

let prismaA: PrismaService;
let prismaB: PrismaService;
let catalog: CatalogStub;
let clock: FixedClock;
let replicaA: PricingHttpHarness;
let replicaB: PricingHttpHarness;
let sql: Client;
let seq = 0;
const key = () => `pg-pricing-key-${String(++seq).padStart(6, '0')}-${process.pid}`;

async function head(): Promise<number> {
  const result = await sql.query<{ revision: number | null }>(
    'SELECT max(revision) AS revision FROM price_book',
  );
  return result.rows[0]?.revision ?? 0;
}

async function publishNext(replica = replicaA) {
  const expected = (await head()) + 1;
  const r = await replica.request('POST', `${PATH}/price-books`, {
    token: TOKENS.admin,
    key: key(),
    body: priceBookRequest(expected),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r;
}

async function expectSqlError(statements: string[], pattern: RegExp): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await client.connect();
  try {
    await client.query('SET search_path TO app');
    await client.query('BEGIN');
    let failure: unknown = null;
    try {
      for (const statement of statements) await client.query(statement);
      await client.query('COMMIT');
    } catch (error: unknown) {
      failure = error;
      await client.query('ROLLBACK').catch(() => undefined);
    }
    assert.ok(failure instanceof Error, `expected ${String(pattern)}`);
    assert.match(failure.message, pattern);
  } finally {
    await client.end();
  }
}

before(async () => {
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  const policy = new FixedPolicy();
  catalog = await startCatalogStub();
  prismaA = new PrismaService(DATABASE_URL);
  prismaB = new PrismaService(DATABASE_URL);
  replicaA = await startPricingHttp({
    repository: new PrismaPricingRepository(prismaA),
    policy,
    clock,
    catalog,
  });
  replicaB = await startPricingHttp({
    repository: new PrismaPricingRepository(prismaB),
    policy,
    clock,
    catalog,
  });
  sql = new Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await sql.connect();
  await sql.query('SET search_path TO app');
});

after(async () => {
  await replicaA.close();
  await replicaB.close();
  await catalog.close();
  await prismaA.onModuleDestroy();
  await prismaB.onModuleDestroy();
  await sql.end();
});

test('pg: concurrent publications of the same revision from two replicas commit exactly one', async () => {
  const expected = (await head()) + 1;
  const results = await Promise.all(
    [replicaA, replicaB, replicaA, replicaB].map((replica) =>
      replica.request('POST', `${PATH}/price-books`, {
        token: TOKENS.admin,
        key: key(),
        body: priceBookRequest(expected),
      }),
    ),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 412, 412, 412], JSON.stringify(results.map((r) => r.body)));
  assert.equal(await head(), expected);
  const entries = await sql.query(
    'SELECT definition_id, vehicle_scope, unit_price_minor::text AS amount FROM price_book_entry WHERE revision = $1 ORDER BY 1, 2',
    [expected],
  );
  assert.deepEqual(
    entries.rows.map((r: { definition_id: string; vehicle_scope: string; amount: string }) => [
      r.definition_id,
      r.vehicle_scope,
      r.amount,
    ]),
    [
      [DEF.exterior, '*', '500000'],
      [DEF.exterior, 'suv', '650000'],
      [DEF.fullCare, '*', '1500000'],
      [DEF.tyreShine, '*', '75000'],
    ],
  );
  const audit = await sql.query(
    "SELECT action, outcome FROM pricing_audit_record WHERE action LIKE 'pricing.price-book.%'",
  );
  assert.equal(audit.rows.filter((r: { outcome: string }) => r.outcome === 'PUBLISHED').length, 1);
  assert.equal(
    audit.rows.filter((r: { outcome: string }) => r.outcome === 'REVISION_CONFLICT').length,
    3,
  );
});

test('pg: same-key publication replays across replicas without a second book', async () => {
  const k = key();
  const body = priceBookRequest((await head()) + 1);
  const [a, b] = await Promise.all([
    replicaA.request('POST', `${PATH}/price-books`, { token: TOKENS.admin, key: k, body }),
    replicaB.request('POST', `${PATH}/price-books`, { token: TOKENS.admin, key: k, body }),
  ]);
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.deepEqual(a.body, b.body);
  assert.deepEqual(
    [a.headers.get('idempotency-replayed'), b.headers.get('idempotency-replayed')].sort(),
    ['false', 'true'],
  );
  assert.equal(await head(), body.expectedPriceBookRevision);
});

test('pg: a quote is persisted exactly as served and read back by its beneficiary', async () => {
  const created = await replicaA.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: key(),
    body: quoteRequest({ zoneId: randomUUID() }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.quoteId as string;
  const read = await replicaB.request('GET', `${PATH}/quotes/${id}`, { token: TOKENS.customer });
  assert.deepEqual(read.body, created.body);
  const row = await sql.query(
    `SELECT q.total_minor::text AS total, q.price_book_revision, q.beneficiary_kind, q.requested_by,
            count(l.*)::int AS lines, sum(l.amount_minor)::text AS line_sum
       FROM pricing_quote q JOIN pricing_quote_line l ON l.quote_id = q.id
      WHERE q.id = $1 GROUP BY q.id`,
    [id],
  );
  assert.equal(row.rows[0].total, '800000');
  assert.equal(row.rows[0].line_sum, '800000');
  assert.equal(row.rows[0].lines, 2);
  assert.equal(row.rows[0].price_book_revision, await head());
  assert.equal(row.rows[0].beneficiary_kind, 'account');
  assert.equal(row.rows[0].requested_by, CUSTOMER.subjectId);
});

test('pg: concurrent same-key quotes across replicas create one quote', async () => {
  const k = key();
  const before = await sql.query('SELECT count(*)::int AS n FROM pricing_quote');
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      (i % 2 === 0 ? replicaA : replicaB).request('POST', `${PATH}/quotes`, {
        token: TOKENS.customer,
        key: k,
        body: quoteRequest(),
      }),
    ),
  );
  assert.ok(
    results.every((r) => r.status === 201),
    JSON.stringify(results.map((r) => r.body)),
  );
  assert.equal(new Set(results.map((r) => r.body.quoteId)).size, 1);
  const afterCount = await sql.query('SELECT count(*)::int AS n FROM pricing_quote');
  assert.equal(afterCount.rows[0].n, before.rows[0].n + 1);
});

test('pg: service validation is audited with caller and purpose; expiry uses server time', async () => {
  const created = await replicaA.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: key(),
    body: quoteRequest(),
  });
  const id = created.body.quoteId as string;
  const body = { expectedRevision: 1, beneficiary: CUSTOMER, purpose: 'booking-create' };
  let r = await replicaB.request('POST', `${PATH}/quotes/${id}/validate`, {
    service: SERVICE.booking,
    body,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.valid, true);
  clock.advance(900_000);
  r = await replicaA.request('POST', `${PATH}/quotes/${id}/validate`, {
    service: SERVICE.booking,
    body,
  });
  assert.equal(r.body.reason, 'QUOTE_EXPIRED');
  const audit = await sql.query(
    `SELECT actor, purpose, outcome FROM pricing_audit_record
      WHERE subject_ref = $1 ORDER BY occurred_at`,
    [`quote:${id}`],
  );
  assert.deepEqual(
    audit.rows.map((x: { actor: string; purpose: string; outcome: string }) => [
      x.actor,
      x.purpose,
      x.outcome,
    ]),
    [
      ['service:booking', 'booking-create', 'VALID'],
      ['service:booking', 'booking-create', 'QUOTE_EXPIRED'],
    ],
  );
});

test('pg: issued quotes keep their snapshot when a newer book is published', async () => {
  const old = await replicaA.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: key(),
    body: quoteRequest(),
  });
  const next = (await head()) + 1;
  const raised = priceBookRequest(next);
  (raised.entries as { unitPrice: { amountMinor: string } }[])[1]!.unitPrice.amountMinor = '700000';
  const published = await replicaB.request('POST', `${PATH}/price-books`, {
    token: TOKENS.admin,
    key: key(),
    body: raised,
  });
  assert.equal(published.status, 201);
  const fresh = await replicaA.request('POST', `${PATH}/quotes`, {
    token: TOKENS.customer,
    key: key(),
    body: quoteRequest(),
  });
  assert.equal(fresh.body.priceBookRevision, next);
  assert.equal((fresh.body.total as { amountMinor: string }).amountMinor, '850000');
  const reread = await replicaB.request('GET', `${PATH}/quotes/${old.body.quoteId as string}`, {
    token: TOKENS.customer,
  });
  assert.deepEqual(reread.body.total, old.body.total);
  assert.equal(reread.body.priceBookRevision, old.body.priceBookRevision);
});

test('pg: the database refuses mutation of books, quotes, lines and audit (runtime role)', async () => {
  await publishNext();
  const quoteId = (
    await sql.query<{ id: string }>('SELECT id FROM pricing_quote ORDER BY issued_at LIMIT 1')
  ).rows[0]!.id;
  const revision = await head();
  for (const statement of [
    `UPDATE pricing_quote SET total_minor = 1 WHERE id = '${quoteId}'`,
    `DELETE FROM pricing_quote_line WHERE quote_id = '${quoteId}'`,
    `UPDATE price_book SET currency = 'USD' WHERE revision = ${revision}`,
    `DELETE FROM price_book_entry WHERE revision = ${revision}`,
    `UPDATE pricing_audit_record SET outcome = 'X'`,
    `UPDATE pricing_idempotency_receipt SET response_status = 200`,
  ])
    await expectSqlError([statement], /PRICING_IMMUTABLE/);
  await expectSqlError(
    [
      `INSERT INTO price_book_entry (revision, definition_id, vehicle_scope, unit_price_minor)
       VALUES (${revision}, '${randomUUID()}', '*', 1)`,
    ],
    /PRICE_BOOK_IMMUTABLE/,
  );
  await expectSqlError(
    [
      `INSERT INTO pricing_quote_line (quote_id, line_no, line_id, kind, definition_id, quantity, unit_price_minor, amount_minor)
       VALUES ('${quoteId}', 9, '${randomUUID()}', 'EXTRA', '${DEF.tyreShine}', 1, 0, 0)`,
    ],
    /QUOTE_IMMUTABLE/,
  );
});

test('pg: commit-time invariants refuse partial, inconsistent or unapproved quotes and books', async () => {
  const revision = await head();
  const book = (
    await sql.query(
      'SELECT currency, scale, catalog_revision, policy_revision FROM price_book WHERE revision = $1',
      [revision],
    )
  ).rows[0] as {
    currency: string;
    scale: number;
    catalog_revision: number;
    policy_revision: string;
  };
  const quoteInsert = (id: string, total: number, overrides: Partial<typeof book> = {}) => {
    const v = { ...book, ...overrides };
    return `INSERT INTO pricing_quote (id, revision, beneficiary_kind, beneficiary_subject, requested_by,
        vehicle_type, zone_id, currency, scale, price_book_revision, catalog_revision, policy_revision,
        total_minor, issued_at, expires_at, correlation_id)
      VALUES ('${id}', 1, 'account', '${CUSTOMER.subjectId}', '${CUSTOMER.subjectId}', 'suv', NULL,
        '${v.currency}', ${v.scale}, ${revision}, ${v.catalog_revision}, '${v.policy_revision}', ${total},
        now(), now() + interval '15 minutes', '${randomUUID()}')`;
  };
  const line = (id: string, no: number, kind: string, unit: number, qty: number, amount: number) =>
    `INSERT INTO pricing_quote_line (quote_id, line_no, line_id, kind, definition_id, quantity, unit_price_minor, amount_minor)
     VALUES ('${id}', ${no}, '${randomUUID()}', '${kind}', '${DEF.exterior}', ${qty}, ${unit}, ${amount})`;

  let id = randomUUID();
  await expectSqlError([quoteInsert(id, 100)], /QUOTE_LINES_INCONSISTENT/);
  id = randomUUID();
  await expectSqlError(
    [quoteInsert(id, 100), line(id, 0, 'PACKAGE', 90, 1, 90)],
    /QUOTE_LINES_INCONSISTENT/,
  );
  id = randomUUID();
  await expectSqlError(
    [
      quoteInsert(id, 200),
      line(id, 0, 'PACKAGE', 100, 1, 100),
      line(id, 1, 'PACKAGE', 100, 1, 100),
    ],
    /QUOTE_LINES_INCONSISTENT/,
  );
  id = randomUUID();
  await expectSqlError(
    [
      quoteInsert(id, 100, { policy_revision: 'other-policy' }),
      line(id, 0, 'PACKAGE', 100, 1, 100),
    ],
    /QUOTE_PRICE_BOOK_INCONSISTENT/,
  );
  id = randomUUID();
  await expectSqlError(
    [quoteInsert(id, 100), line(id, 0, 'PACKAGE', 100, 1, 100), line(id, 1, 'DISCOUNT', 0, 1, 0)],
    /pricing_quote_line_kind/,
  );
  id = randomUUID();
  await expectSqlError(
    [quoteInsert(id, 300), line(id, 0, 'PACKAGE', 100, 2, 300)],
    /pricing_quote_line_amount/,
  );
  const next = revision + 1;
  const bookInsert = (currency: string, scale: number) =>
    `INSERT INTO price_book (revision, previous_revision, currency, scale, policy_revision, catalog_revision,
        catalog_fingerprint, catalog_view, entries_fingerprint, published_at, published_by, correlation_id)
      VALUES (${next}, ${revision}, '${currency}', ${scale}, 'test-policy-1', 1, '${'a'.repeat(64)}', '{}',
        '${'b'.repeat(64)}', now(), '${randomUUID()}', '${randomUUID()}')`;
  await expectSqlError([bookInsert('SYP', 2)], /PRICE_BOOK_EMPTY/);
  await expectSqlError([bookInsert('XTS', 2)], /price_book_contract_currency/);
  await expectSqlError([bookInsert('SYP', 0)], /price_book_contract_currency/);
  await expectSqlError(
    [bookInsert('SYP', 2).replace(`, ${revision}, 'SYP'`, `, NULL, 'SYP'`)],
    /price_book_linear_chain/,
  );
  // The P01-B2 chain had the same NULL hole; the P06-B2 migration tightened it.
  await expectSqlError(
    [
      `INSERT INTO price_version (version, previous_version, effective_from, published_at, published_by,
          correlation_id, catalog_revision, catalog_fingerprint, catalog_snapshot, policy_revision, currency,
          minor_unit_exponent, rates_fingerprint)
        VALUES (99, NULL, now() + interval '2 hours', now(), '${randomUUID()}', '${randomUUID()}', 1,
          '${'a'.repeat(64)}', '{}', 'legacy', 'XTS', 2, '${'a'.repeat(64)}')`,
    ],
    /price_version_linear_chain/,
  );
  assert.equal(await head(), revision);
});

test('pg: the runtime role cannot execute the trigger functions directly', async () => {
  await expectSqlError(['SELECT app.pricing_check_pricing_quote()'], /permission denied|trigger/);
});
