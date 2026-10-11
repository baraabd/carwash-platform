import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { CustodyProjector, type ProjectionOutcome } from '../../src/application';
import { ProjectionDeferred } from '../../src/domain';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaWalletRepository } from '../../src/infrastructure/persistence/prisma-wallet.repository';
import { RandomIds } from '../../src/infrastructure/system/system.adapters';
import { FixedClock, collected, handover, reversed, syp } from '../support/billing-events';
import { TOKENS, startWalletHttp, type WalletHttpHarness } from '../support/wallet-http-harness';

/*
 * REAL PostgreSQL evidence, run as the least-privileged runtime role
 * (cw_wallet_app) on a database migrated by cw_wallet_migrate through
 * scripts/production/B/postgres-acceptance.mjs. Two projector replicas with
 * separate connection pools share one database. Events are built in the exact
 * registered Billing envelope-v2 shape and parsed by @carwash/event-contracts;
 * Billing itself and the broker are not running here. No skip.
 */
const APP_URL = process.env.WALLET_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('WALLET_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;

let prismaA: PrismaService;
let prismaB: PrismaService;
let replicaA: CustodyProjector;
let replicaB: CustodyProjector;
let http: WalletHttpHarness;
let sql: Client;

type Event = Record<string, unknown>;

function holderOf(): string {
  return randomUUID();
}

async function account(holder: string): Promise<Record<string, number> | null> {
  const row = await sql.query(
    `SELECT held_minor, in_handover_minor, deposited_minor, settled_minor, shortage_minor, overage_minor, version
       FROM custody_account WHERE holder_subject = $1 AND currency = 'SYP'`,
    [holder],
  );
  if (row.rowCount === 0) return null;
  const r = row.rows[0] as Record<string, string | number>;
  return {
    held: Number(r.held_minor),
    inHandover: Number(r.in_handover_minor),
    deposited: Number(r.deposited_minor),
    settled: Number(r.settled_minor),
    shortage: Number(r.shortage_minor),
    overage: Number(r.overage_minor),
    version: Number(r.version),
  };
}

async function movementSum(holder: string): Promise<{ held: number; count: number }> {
  const row = await sql.query(
    `SELECT COALESCE(sum(held_delta), 0) AS held, count(*) AS count FROM custody_movement WHERE holder_subject = $1`,
    [holder],
  );
  return { held: Number(row.rows[0].held), count: Number(row.rows[0].count) };
}

async function attack(statement: string, values: unknown[]): Promise<string | null> {
  const client = new Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await client.connect();
  try {
    await client.query('SET search_path TO app');
    await client.query('BEGIN');
    await client.query(statement, values);
    await client.query('COMMIT');
    return null;
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    return error instanceof Error ? error.message : String(error);
  } finally {
    await client.end();
  }
}

before(async () => {
  const clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  prismaA = new PrismaService(DATABASE_URL);
  prismaB = new PrismaService(DATABASE_URL);
  replicaA = new CustodyProjector({
    repository: new PrismaWalletRepository(prismaA),
    clock,
    ids: new RandomIds(),
  });
  replicaB = new CustodyProjector({
    repository: new PrismaWalletRepository(prismaB),
    clock,
    ids: new RandomIds(),
  });
  http = await startWalletHttp(new PrismaWalletRepository(prismaA));
  sql = new Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await sql.connect();
  await sql.query('SET search_path TO app');
});

after(async () => {
  await http?.close();
  await prismaA?.onModuleDestroy();
  await prismaB?.onModuleDestroy();
  await sql?.end();
});

test('runs as the runtime role, which cannot change the schema', async () => {
  const who = await sql.query('SELECT current_user');
  assert.equal(who.rows[0].current_user, 'cw_wallet_app');
  await assert.rejects(sql.query('CREATE TABLE app.intruder (id int)'));
});

test('lifecycle: collections, handover declared, counted with shortage, reconciled', async () => {
  const holder = holderOf();
  const first = collected({ holder, amount: syp(100_000) });
  const second = collected({ holder, amount: syp(50_000) });
  assert.equal((await replicaA.project(first)).outcome, 'APPLIED');
  assert.equal((await replicaB.project(second)).outcome, 'APPLIED');
  const handoverId = randomUUID();
  const base = { handoverId, holder, declared: syp(150_000), receiptCount: 2 };
  assert.equal(
    (
      await replicaA.project(
        handover({ ...base, version: 1, previousStatus: null, status: 'PENDING' }),
      )
    ).outcome,
    'APPLIED',
  );
  assert.deepEqual(
    [(await account(holder))?.held, (await account(holder))?.inHandover],
    [0, 150_000],
  );
  const receivedEvent = handover({
    ...base,
    version: 2,
    previousStatus: 'PENDING',
    status: 'RECEIVED',
    counted: syp(149_000),
    shortage: syp(1_000),
    overage: syp(0),
  });
  assert.equal((await replicaB.project(receivedEvent)).outcome, 'APPLIED');
  assert.equal(
    (
      await replicaA.project(
        handover({
          ...base,
          version: 3,
          previousStatus: 'RECEIVED',
          status: 'RECONCILED',
          counted: syp(149_000),
          shortage: syp(1_000),
          overage: syp(0),
        }),
      )
    ).outcome,
    'APPLIED',
  );
  assert.deepEqual(await account(holder), {
    held: 0,
    inHandover: 0,
    deposited: 0,
    settled: 149_000,
    shortage: 1_000,
    overage: 0,
    version: 5,
  });
  const movements = await sql.query(
    `SELECT kind, event_id FROM custody_movement WHERE holder_subject = $1 ORDER BY recorded_at, kind`,
    [holder],
  );
  assert.equal(movements.rowCount, 5);
  assert.ok(
    movements.rows.some((m: { event_id: string }) => m.event_id === receivedEvent.eventId),
    'each movement cites its Billing event',
  );
});

test('race: one event delivered concurrently by two replicas applies exactly once', async () => {
  for (let round = 0; round < 5; round += 1) {
    const holder = holderOf();
    const event = collected({ holder, amount: syp(7_000) });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? replicaA : replicaB).project(event)),
    );
    const outcomes = results.map((r) => r.outcome).sort();
    assert.deepEqual(
      outcomes,
      [
        'APPLIED',
        'DUPLICATE',
        'DUPLICATE',
        'DUPLICATE',
        'DUPLICATE',
        'DUPLICATE',
        'DUPLICATE',
        'DUPLICATE',
      ],
      `round ${round}`,
    );
    assert.equal((await account(holder))?.held, 7_000);
    assert.deepEqual(await movementSum(holder), { held: 7_000, count: 1 });
  }
});

test('race: different events for one holder from two replicas all apply, totals equal movements', async () => {
  const holder = holderOf();
  const events = Array.from({ length: 12 }, (_, i) =>
    collected({ holder, amount: syp(1_000 + i) }),
  );
  const results = await Promise.all(
    events.map((event, i) => (i % 2 === 0 ? replicaA : replicaB).project(event)),
  );
  assert.ok(results.every((r: ProjectionOutcome) => r.outcome === 'APPLIED'));
  const expected = events.reduce((sum, _e, i) => sum + 1_000 + i, 0);
  const state = await account(holder);
  assert.deepEqual([state?.held, state?.version], [expected, 12]);
  assert.deepEqual(await movementSum(holder), { held: expected, count: 12 });
});

test('ordering: early events are deferred (not recorded), stale versions are recorded no-ops', async () => {
  const holder = holderOf();
  const receiptId = randomUUID();
  const reversal = reversed({ receiptId, amount: syp(9_000), version: 4 });
  await assert.rejects(replicaA.project(reversal), ProjectionDeferred);
  const handoverId = randomUUID();
  const received = handover({
    handoverId,
    holder,
    version: 2,
    previousStatus: 'PENDING',
    status: 'RECEIVED',
    declared: syp(9_000),
    counted: syp(9_000),
    shortage: syp(0),
    overage: syp(0),
  });
  await assert.rejects(replicaA.project(received), ProjectionDeferred);
  const pending = handover({
    handoverId,
    holder,
    version: 1,
    previousStatus: null,
    status: 'PENDING',
    declared: syp(9_000),
  });
  await assert.rejects(
    replicaA.project(pending),
    ProjectionDeferred,
    'nothing held yet: declared cash cannot go negative',
  );
  const inbox = await sql.query(
    `SELECT count(*)::int AS n FROM wallet_inbox WHERE event_id = ANY($1::uuid[])`,
    [[reversal.eventId, received.eventId, pending.eventId]],
  );
  assert.equal(
    inbox.rows[0].n,
    0,
    'deferred deliveries leave no trace, so redelivery applies them',
  );

  // Redelivery after the earlier events arrive applies everything in order.
  assert.equal(
    (await replicaA.project(collected({ receiptId, holder, amount: syp(9_000) }))).outcome,
    'APPLIED',
  );
  assert.equal((await replicaB.project(reversal)).outcome, 'APPLIED');
  assert.equal(
    (await replicaA.project(collected({ holder, amount: syp(9_000) }))).outcome,
    'APPLIED',
  );
  assert.equal((await replicaA.project(pending)).outcome, 'APPLIED');
  assert.equal((await replicaB.project(received)).outcome, 'APPLIED');
  const stale = handover({
    handoverId,
    holder,
    version: 1,
    previousStatus: null,
    status: 'PENDING',
    declared: syp(9_000),
  });
  assert.equal((await replicaA.project(stale)).outcome, 'STALE');
  const recorded = await sql.query(`SELECT outcome, reason FROM wallet_inbox WHERE event_id = $1`, [
    stale.eventId,
  ]);
  assert.deepEqual(recorded.rows[0], { outcome: 'STALE', reason: 'VERSION_NOT_NEWER' });
  assert.deepEqual(await account(holder), {
    held: 0,
    inHandover: 0,
    deposited: 9_000,
    settled: 0,
    shortage: 0,
    overage: 0,
    // One version per APPLIED event: collect, reverse, collect, pending, received.
    version: 5,
  });
});

test('poison and unattributable events are recorded as rejected and never applied', async () => {
  const holder = holderOf();
  const poison: Event = { ...collected({ holder }), data: { amount: 'NaN' } };
  const fromService = collected({ holder, actor: { kind: 'system', id: null } });
  const wrongAmount = { first: collected({ holder, amount: syp(500) }) };
  for (const event of [poison, fromService]) {
    const result = await replicaA.project(event);
    assert.equal(result.outcome, 'REJECTED');
    assert.equal((await replicaB.project(event)).outcome, 'DUPLICATE');
  }
  assert.equal((await replicaA.project(wrongAmount.first)).outcome, 'APPLIED');
  const mismatch = reversed({
    receiptId: (wrongAmount.first.aggregate as { id: string }).id,
    amount: syp(600),
  });
  const rejected = await replicaA.project(mismatch);
  assert.deepEqual(
    [rejected.outcome, rejected.outcome === 'REJECTED' ? rejected.reason : null],
    ['REJECTED', 'AMOUNT_MISMATCH'],
  );
  const rows = await sql.query(
    `SELECT reason FROM wallet_inbox WHERE event_id = ANY($1::uuid[]) ORDER BY reason`,
    [[poison.eventId, fromService.eventId, mismatch.eventId]],
  );
  assert.deepEqual(
    rows.rows.map((r: { reason: string }) => r.reason),
    ['AMOUNT_MISMATCH', 'EVENT_INVALID', 'HOLDER_UNATTRIBUTABLE'],
  );
  assert.equal((await account(holder))?.held, 500);
});

test('database refuses tampering by the runtime role (direct SQL)', async () => {
  const holder = holderOf();
  const event = collected({ holder, amount: syp(2_000) });
  await replicaA.project(event);
  const cases: [string, string, unknown[], RegExp][] = [
    [
      'balance edit',
      `UPDATE custody_account SET held_minor = held_minor + 1, version = version + 1 WHERE holder_subject = $1`,
      [holder],
      /CUSTODY_PROJECTION_UNBALANCED/,
    ],
    [
      'negative balance',
      `UPDATE custody_account SET held_minor = -1 WHERE holder_subject = $1`,
      [holder],
      /custody_account_non_negative/,
    ],
    [
      'movement delete',
      `DELETE FROM custody_movement WHERE holder_subject = $1`,
      [holder],
      /WALLET_APPEND_ONLY/,
    ],
    [
      'inbox rewrite',
      `UPDATE wallet_inbox SET outcome = 'REJECTED', reason = 'X' WHERE event_id = $1`,
      [event.eventId],
      /WALLET_APPEND_ONLY/,
    ],
    // The runtime role holds no TRUNCATE grant; the trigger is the second line of defence.
    ['inbox truncate', `TRUNCATE wallet_inbox CASCADE`, [], /permission denied|WALLET_APPEND_ONLY/],
    [
      'account delete',
      `DELETE FROM custody_account WHERE holder_subject = $1`,
      [holder],
      /WALLET_APPEND_ONLY/,
    ],
    [
      'forged movement',
      `INSERT INTO custody_movement (id, holder_subject, currency, kind, held_delta, in_handover_delta, deposited_delta, settled_delta,
         shortage_delta, overage_delta, event_id, event_type, source_kind, source_id, source_version, occurred_at, recorded_at)
       SELECT gen_random_uuid(), holder_subject, currency, 'CASH_COLLECTED', 5, 0, 0, 0, 0, 0, event_id, event_type, source_kind,
              source_id, source_version, now(), now() FROM custody_movement WHERE holder_subject = $1`,
      [holder],
      /custody_movement_event_key|MOVEMENT_WITHOUT_APPLIED_EVENT/,
    ],
    [
      'source holder swap',
      `UPDATE custody_source SET holder_subject = gen_random_uuid(), last_version = last_version + 1 WHERE holder_subject = $1`,
      [holder],
      /SOURCE_IDENTITY_IMMUTABLE/,
    ],
  ];
  for (const [name, statement, values, expected] of cases)
    assert.match((await attack(statement, values)) ?? 'COMMITTED', expected, name);
  assert.deepEqual(await movementSum(holder), { held: 2_000, count: 1 });
  assert.equal((await account(holder))?.held, 2_000);
});

test('HTTP: finance reads any holder, technicians only themselves, customers nothing (deny by default)', async () => {
  const { HOLDER } = await import('../support/billing-events');
  await replicaA.project(collected({ holder: HOLDER, amount: syp(3_000) }));
  const staff = await http.get(`/custody/holders/${HOLDER}`, TOKENS.finance);
  assert.equal(staff.status, 200);
  const accounts = staff.body.accounts as { balances: { held: { amountMinor: string } } }[];
  assert.ok(Number(accounts[0]?.balances.held.amountMinor) >= 3_000);
  assert.equal(
    (await http.get(`/custody/holders/${HOLDER}/movements`, TOKENS.finance)).status,
    200,
  );
  const mine = await http.get('/custody/me', TOKENS.technician);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.holder, HOLDER);
  const otherMine = await http.get('/custody/me', TOKENS.otherTechnician);
  assert.deepEqual([otherMine.status, (otherMine.body.accounts as unknown[]).length], [200, 0]);
  assert.equal(
    (await http.get(`/custody/holders/${HOLDER}`, TOKENS.technician)).status,
    403,
    'a technician cannot read another holder',
  );
  assert.equal((await http.get('/custody/me', TOKENS.customer)).status, 403);
  assert.equal((await http.get(`/custody/holders/${HOLDER}`, TOKENS.customer)).status, 403);
  assert.equal((await http.get('/custody/me')).status, 401);
  assert.equal((await http.get('/custody/me', TOKENS.unknown)).status, 401);
  assert.equal((await http.get('/custody/holders/not-a-uuid', TOKENS.finance)).status, 404);
  assert.equal((await http.get(`/custody/holders/${randomUUID()}`, TOKENS.finance)).status, 404);
  http.identity.mode = 'error-500';
  try {
    assert.equal(
      (await http.get('/custody/me', TOKENS.technician)).status,
      503,
      'Identity outage fails closed',
    );
  } finally {
    http.identity.mode = 'normal';
  }
});

test('trigger functions are not executable by the runtime role or PUBLIC', async () => {
  const rows = await sql.query(
    `SELECT p.proname,
            has_function_privilege(current_user, p.oid, 'EXECUTE') AS runtime,
            coalesce(array_to_string(p.proacl, ','), '') AS acl
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app'`,
  );
  assert.ok(rows.rowCount && rows.rowCount >= 4);
  for (const row of rows.rows as { proname: string; runtime: boolean; acl: string }[]) {
    assert.equal(row.runtime, false, row.proname);
    assert.doesNotMatch(row.acl, /(^|,)=X/, `${row.proname} must not grant EXECUTE to PUBLIC`);
  }
});
