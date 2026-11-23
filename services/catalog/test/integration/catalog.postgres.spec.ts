import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { CATALOG_DEFINITIONS_PUBLISHED_V1 } from '@carwash/event-contracts';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaCatalogRepository } from '../../src/infrastructure/persistence/prisma-catalog.repository';
import { publishBody, type WireDefinition } from '../support/catalog-fixtures';
import { FixedClock } from '../support/in-memory-catalog.repository';
import {
  TOKENS,
  errorOf,
  startCatalogHttp,
  type CatalogHttpHarness,
} from '../support/catalog-http-harness';

/*
 * REAL PostgreSQL evidence. Runs as the least-privileged runtime role
 * (cw_catalog_app) against a database migrated by cw_catalog_migrate through
 * scripts/production/B/postgres-acceptance.mjs. Identity is a local HTTP stub.
 * There is deliberately no skip: missing configuration fails the run.
 *
 * The catalog is one chain shared by every run against the database, so each
 * test reads the current head and republishes the complete snapshot.
 */
const APP_URL = process.env.CATALOG_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('CATALOG_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;
const PATH = '/internal/v1/catalog';
const RUN = randomBytes(3).toString('hex');

let prismaA: PrismaService;
let prismaB: PrismaService;
let replicaA: CatalogHttpHarness;
let replicaB: CatalogHttpHarness;
let sql: Client;
let keySeq = 0;
let codeSeq = 0;

function key(): string {
  keySeq += 1;
  return `pg-catalog-${RUN}-${String(keySeq).padStart(6, '0')}`;
}

function newDefinition(overrides: Partial<WireDefinition> = {}): WireDefinition {
  codeSeq += 1;
  return {
    definitionId: randomUUID(),
    kind: 'PACKAGE',
    code: `pg-${RUN}-${codeSeq}`,
    name: { ar: 'غسيل اختبار', en: null },
    description: { ar: 'تعريف اختبار فقط', en: 'Test-only definition' },
    durationMinutes: 30,
    vehicleTypes: ['sedan'],
    status: 'PUBLISHED',
    sortOrder: 100 + codeSeq,
    ...overrides,
  };
}

/** The current snapshot as publishable drafts (revision stripped). */
async function current(): Promise<{ revision: number; drafts: WireDefinition[] }> {
  const response = await replicaA.request('GET', `${PATH}/definitions`);
  if (response.status === 404) return { revision: 0, drafts: [] };
  assert.equal(response.status, 200);
  const items = response.body.items as (WireDefinition & { revision: number })[];
  return {
    revision: response.body.catalogRevision as number,
    drafts: items.map((item) => ({
      definitionId: item.definitionId,
      kind: item.kind,
      code: item.code,
      name: item.name,
      description: item.description,
      durationMinutes: item.durationMinutes,
      vehicleTypes: item.vehicleTypes,
      status: item.status,
      sortOrder: item.sortOrder,
    })),
  };
}

before(async () => {
  const clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
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

async function sqlError(statements: string[], values: unknown[][] = []): Promise<string> {
  try {
    await sql.query('BEGIN');
    for (const [index, statement] of statements.entries())
      await sql.query(statement, values[index] ?? []);
    await sql.query('COMMIT');
  } catch (error: unknown) {
    await sql.query('ROLLBACK').catch(() => undefined);
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('EXPECTED_DATABASE_REJECTION');
}

test('postgres: a publication round-trips exactly across replicas with audit and outbox', async () => {
  const head = await current();
  const added = newDefinition({ vehicleTypes: ['pickup', 'sedan'] });
  const correlationId = randomUUID();
  const published = await replicaA.request('POST', `${PATH}/publications`, {
    token: TOKENS.admin,
    key: key(),
    body: publishBody(head.revision, [...head.drafts, added], 'PG_ROUND_TRIP'),
    correlationId,
  });
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const revision = published.body.catalogRevision as number;
  assert.equal(revision, head.revision + 1);

  const read = await replicaB.request('GET', `${PATH}/definitions`);
  assert.deepEqual(read.body, published.body);
  const one = await replicaB.request('GET', `${PATH}/definitions/${added.definitionId}`);
  assert.equal(one.status, 200);
  assert.deepEqual((one.body as { vehicleTypes: string[] }).vehicleTypes, ['sedan', 'pickup']);
  assert.equal((one.body as { revision: number }).revision, 1);

  const audit = await sql.query(
    `SELECT action, revision, reason_code FROM catalog_audit_event WHERE correlation_id = $1`,
    [correlationId],
  );
  assert.deepEqual(audit.rows, [
    { action: 'catalog.definitions.published', revision, reason_code: 'PG_ROUND_TRIP' },
  ]);
  const outbox = await sql.query(
    `SELECT payload, exchange, routing_key FROM outbox_message WHERE correlation_id = $1`,
    [correlationId],
  );
  assert.equal(outbox.rowCount, 1);
  assert.equal(outbox.rows[0].exchange, 'washgo.catalog.events');
  const event = CATALOG_DEFINITIONS_PUBLISHED_V1.parse(JSON.parse(outbox.rows[0].payload));
  assert.equal(event.aggregate.version, revision);
  assert.deepEqual(event.data.definitionIds, [added.definitionId]);
});

test('postgres: concurrent publishers on two replicas produce exactly one revision', async () => {
  const head = await current();
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, n) =>
      (n % 2 === 0 ? replicaA : replicaB).request('POST', `${PATH}/publications`, {
        token: TOKENS.admin,
        key: key(),
        body: publishBody(head.revision, [...head.drafts, newDefinition()], 'PG_RACE'),
      }),
    ),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 412, 412, 412, 412, 412], JSON.stringify(statuses));
  const after = await current();
  assert.equal(after.revision, head.revision + 1);
});

test('postgres: the same key raced on two replicas commits once and replays identically', async () => {
  const head = await current();
  const shared = key();
  const body = publishBody(head.revision, [...head.drafts, newDefinition()], 'PG_REPLAY');
  const [a, b] = await Promise.all([
    replicaA.request('POST', `${PATH}/publications`, { token: TOKENS.admin, key: shared, body }),
    replicaB.request('POST', `${PATH}/publications`, { token: TOKENS.admin, key: shared, body }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.deepEqual(a.body, b.body);
  assert.deepEqual(
    [a.headers.get('idempotency-replayed'), b.headers.get('idempotency-replayed')].sort(),
    ['false', 'true'],
  );
  assert.equal((await current()).revision, head.revision + 1);
  const conflict = await replicaB.request('POST', `${PATH}/publications`, {
    token: TOKENS.admin,
    key: shared,
    body: { ...body, reasonCode: 'PG_OTHER' },
  });
  assert.equal(conflict.status, 409);
});

test('postgres: retirement is final and codes are never reused through the API', async () => {
  const head = await current();
  const victim = newDefinition({ kind: 'EXTRA' });
  const created = await replicaA.request('POST', `${PATH}/publications`, {
    token: TOKENS.admin,
    key: key(),
    body: publishBody(head.revision, [...head.drafts, victim], 'PG_ADD'),
  });
  assert.equal(created.status, 201);
  const retired = { ...victim, status: 'RETIRED' as const };
  const retire = await replicaA.request('POST', `${PATH}/publications`, {
    token: TOKENS.admin,
    key: key(),
    body: publishBody(head.revision + 1, [...head.drafts, retired], 'PG_RETIRE'),
  });
  assert.equal(retire.status, 201);
  const revive = await replicaA.request('POST', `${PATH}/publications`, {
    token: TOKENS.admin,
    key: key(),
    body: publishBody(head.revision + 2, [...head.drafts, victim], 'PG_REVIVE'),
  });
  assert.equal(revive.status, 422);
  assert.equal(errorOf(revive).reason, 'DEFINITION_RETIRED');
  const reuse = await replicaA.request('POST', `${PATH}/publications`, {
    token: TOKENS.admin,
    key: key(),
    body: publishBody(
      head.revision + 2,
      [...head.drafts, retired, { ...victim, definitionId: randomUUID() }],
      'PG_REUSE',
    ),
  });
  assert.equal(reuse.status, 422);
  assert.deepEqual(errorOf(reuse).issues, [{ field: '$.definitions', code: 'DUPLICATE_CODE' }]);
  const still = await replicaB.request('GET', `${PATH}/definitions/${victim.definitionId}`);
  assert.equal((still.body as { status: string }).status, 'RETIRED');
});

test('postgres: published rows are immutable for the runtime role', async () => {
  const head = await current();
  assert.ok(head.revision > 0);
  assert.match(
    await sqlError(
      [`UPDATE catalog_v1_publication SET reason_code = 'X_Y_Z' WHERE catalog_revision = $1`],
      [[head.revision]],
    ),
    /CATALOG_IMMUTABLE/,
  );
  assert.match(
    await sqlError(
      [`DELETE FROM catalog_v1_definition WHERE catalog_revision = $1`],
      [[head.revision]],
    ),
    /CATALOG_IMMUTABLE/,
  );
  assert.match(
    await sqlError([`UPDATE catalog_v1_definition_identity SET code = 'zz-renamed'`]),
    /CATALOG_IMMUTABLE/,
  );
  // A published revision can never gain rows later.
  const id = randomUUID();
  assert.match(
    await sqlError(
      [
        `INSERT INTO catalog_v1_definition_identity (definition_id, code, kind, first_catalog_revision) VALUES ($1, $2, 'PACKAGE', $3)`,
      ],
      [[id, `pg-${RUN}-late`, head.revision]],
    ),
    /CATALOG_REVISION_IMMUTABLE/,
  );
});

/** Starts a raw next publication row inside the open transaction. */
function nextPublication(revision: number): [string, unknown[]] {
  return [
    `INSERT INTO catalog_v1_publication (catalog_revision, previous_revision, published_at, published_by,
       correlation_id, reason_code, snapshot_fingerprint)
     VALUES ($1, $2, now(), $3, $4, 'RAW_SQL', $5)`,
    [revision + 1, revision, randomUUID(), randomUUID(), 'a'.repeat(64)],
  ];
}

function copyPrevious(revision: number, except: string | null = null): [string, unknown[]] {
  return [
    `INSERT INTO catalog_v1_definition
       SELECT $1, definition_id, revision, kind, code, name_ar, name_en, description_ar, description_en,
              duration_minutes, vehicle_types, status, sort_order
         FROM catalog_v1_definition
        WHERE catalog_revision = $2 AND ($3::uuid IS NULL OR definition_id <> $3::uuid)`,
    [revision + 1, revision, except],
  ];
}

async function rawPublication(statements: [string, unknown[]][]): Promise<string> {
  return sqlError(
    statements.map(([s]) => s),
    statements.map(([, v]) => v),
  );
}

test('postgres: the database enforces snapshot completeness, final retirement and identity', async () => {
  const head = await current();
  const any = head.drafts[0]!;
  const retired = head.drafts.find((d) => d.status === 'RETIRED');
  assert.ok(retired, 'the retirement test publishes a retired definition first');

  assert.match(await rawPublication([nextPublication(head.revision)]), /CATALOG_SNAPSHOT_EMPTY/);
  assert.match(
    await rawPublication([
      nextPublication(head.revision),
      copyPrevious(head.revision, any.definitionId),
    ]),
    /CATALOG_SNAPSHOT_INCOMPLETE/,
  );
  assert.match(
    await rawPublication([
      nextPublication(head.revision),
      copyPrevious(head.revision, retired.definitionId),
      [
        `INSERT INTO catalog_v1_definition
           SELECT $1, definition_id, revision + 1, kind, code, name_ar, name_en, description_ar, description_en,
                  duration_minutes, vehicle_types, 'PUBLISHED', sort_order
             FROM catalog_v1_definition WHERE catalog_revision = $2 AND definition_id = $3`,
        [head.revision + 1, head.revision, retired.definitionId],
      ],
    ]),
    /CATALOG_DEFINITION_RETIRED/,
  );
  assert.match(
    await rawPublication([
      nextPublication(head.revision),
      copyPrevious(head.revision, any.definitionId),
      [
        `INSERT INTO catalog_v1_definition
           SELECT $1, definition_id, revision + 2, kind, code, name_ar, name_en, description_ar, description_en,
                  duration_minutes, vehicle_types, status, sort_order
             FROM catalog_v1_definition WHERE catalog_revision = $2 AND definition_id = $3`,
        [head.revision + 1, head.revision, any.definitionId],
      ],
    ]),
    /CATALOG_DEFINITION_REVISION_GAP/,
  );
  // Kind drift breaks the composite identity foreign key.
  assert.match(
    await rawPublication([
      nextPublication(head.revision),
      copyPrevious(head.revision, any.definitionId),
      [
        `INSERT INTO catalog_v1_definition
           SELECT $1, definition_id, revision + 1, CASE kind WHEN 'PACKAGE' THEN 'EXTRA' ELSE 'PACKAGE' END,
                  code, name_ar, name_en, description_ar, description_en, duration_minutes, vehicle_types,
                  status, sort_order
             FROM catalog_v1_definition WHERE catalog_revision = $2 AND definition_id = $3`,
        [head.revision + 1, head.revision, any.definitionId],
      ],
    ]),
    /catalog_v1_definition_identity_fkey/,
  );
  // A retired code is still bound to its definition: a new identity cannot take it.
  assert.match(
    await rawPublication([
      nextPublication(head.revision),
      [
        `INSERT INTO catalog_v1_definition_identity (definition_id, code, kind, first_catalog_revision)
         VALUES ($1, $2, 'EXTRA', $3)`,
        [randomUUID(), retired.code, head.revision + 1],
      ],
    ]),
    /catalog_v1_definition_identity_code_key/,
  );
  assert.match(
    await sqlError([
      `INSERT INTO catalog_v1_definition (catalog_revision, definition_id, revision, kind, code, name_ar,
         description_ar, duration_minutes, vehicle_types, status, sort_order)
       VALUES (1, gen_random_uuid(), 1, 'PACKAGE', 'zz', 'x', 'x', 30, ARRAY['truck']::varchar(16)[], 'PUBLISHED', 0)`,
    ]),
    /catalog_v1_definition_vehicle_types|CATALOG_REVISION_IMMUTABLE/,
  );
  assert.equal((await current()).revision, head.revision);
});
