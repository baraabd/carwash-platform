import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { amountOf, positionOf, type HandoverState, type ReceiptState } from '../../src/domain';
import { CustodyProjectionService, WalletApplicationError } from '../../src/application';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaCustodyStore } from '../../src/infrastructure/persistence/prisma-custody.store';
import { RandomIds, Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import {
  BillingCustodyModel,
  prng,
  shuffle,
  type Currency,
  type Envelope,
} from '../support/billing-history';
import { SUBJECTS, TOKENS, startIdentityStub, type IdentityStub } from '../support/identity-stub';
import { startWalletHttp, type WalletHttpHarness } from '../support/wallet-http-harness';

/*
 * REAL PostgreSQL evidence for the P06-B3 custody projection, run as the
 * least-privileged runtime role (cw_wallet_app) through
 * scripts/production/B/postgres-acceptance.mjs --service wallet.
 * Two replicas (separate pools) share the database to prove concurrency.
 * Billing events are produced by a test model of Billing's custody state
 * machine and validated with the shared billing.v1 parsers. RabbitMQ is NOT
 * used: the broker binding waits on CR-W-01 (platform-messaging dependency).
 */
const APP_URL = process.env.WALLET_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('WALLET_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;

const clock = { now: () => new Date(Math.floor(Date.now())) };
let prismaA: PrismaService;
let prismaB: PrismaService;
let storeA: PrismaCustodyStore;
let replicaA: CustodyProjectionService;
let replicaB: CustodyProjectionService;
let identity: IdentityStub;
let http: WalletHttpHarness;
let sql: Client;

const projection = (store: PrismaCustodyStore) =>
  new CustodyProjectionService({ store, clock, hasher: new Sha256Hasher(), ids: new RandomIds() });
const deliver = (replica: CustodyProjectionService, e: Envelope) =>
  replica.apply({ id: e.eventId, type: e.eventType, payload: JSON.stringify(e) });
const aggregateId = (e: Envelope) => (e.aggregate as { id: string }).id;
/** A fresh holder per test keeps parallel spec files independent. */
const holder = () => randomUUID();

before(async () => {
  prismaA = new PrismaService(DATABASE_URL);
  prismaB = new PrismaService(DATABASE_URL);
  storeA = new PrismaCustodyStore(prismaA);
  replicaA = projection(storeA);
  replicaB = projection(new PrismaCustodyStore(prismaB));
  identity = await startIdentityStub();
  http = await startWalletHttp({ store: storeA, identity, clock });
  sql = new Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await sql.connect();
});

after(async () => {
  await http.close();
  await identity.close();
  await sql.end();
  await prismaA.onModuleDestroy();
  await prismaB.onModuleDestroy();
});

async function account(subject: string, currency: Currency = 'SYP') {
  const rows = await sql.query(
    `SELECT id, collected_minor, reversed_minor, in_handover_minor, received_minor, settled_minor,
            shortage_minor, overage_minor, revision
       FROM app.wallet_accounts WHERE holder_subject = $1 AND currency = $2`,
    [subject, currency],
  );
  return rows.rows[0] as Record<string, string | number> | undefined;
}

async function movements(subject: string) {
  const rows = await sql.query(
    `SELECT m.kind, m.event_id, m.amount_minor FROM app.wallet_movements m
       JOIN app.wallet_accounts a ON a.id = m.account_id
      WHERE a.holder_subject = $1 ORDER BY m.account_revision, m.kind`,
    [subject],
  );
  return rows.rows as { kind: string; event_id: string; amount_minor: string }[];
}

test('pg: collection, duplicate and conflicting redelivery leave exactly one movement', async () => {
  const h = holder();
  const model = new BillingCustodyModel();
  const e = model.collect(h, 'SYP', 150_000n);
  assert.equal(await deliver(replicaA, e), 'APPLIED');
  assert.equal(await deliver(replicaB, e), 'DUPLICATE');
  const tampered = {
    ...e,
    data: { ...(e.data as object), amount: { currency: 'SYP', amountMinor: '1', scale: 2 } },
  };
  await assert.rejects(
    replicaA.handle({ id: e.eventId, type: e.eventType, payload: tampered }),
    (error: unknown) => error instanceof WalletApplicationError && error.status === 409,
  );
  const conflicts = await sql.query(
    'SELECT count(*)::int AS n FROM app.wallet_inbox_conflict WHERE event_id = $1',
    [e.eventId],
  );
  assert.equal(conflicts.rows[0].n, 1);
  assert.equal((await movements(h)).length, 1);
  const a = await account(h);
  assert.equal(a?.collected_minor, '150000');
  assert.equal(a?.revision, 1);
});

test('pg: the same event delivered concurrently by two replicas applies once', async () => {
  const h = holder();
  const model = new BillingCustodyModel();
  const events = Array.from({ length: 10 }, (_, i) => model.collect(h, 'SYP', BigInt(1000 + i)));
  const outcomes = await Promise.all(
    events.flatMap((e) => [deliver(replicaA, e), deliver(replicaB, e), deliver(replicaA, e)]),
  );
  assert.equal(outcomes.filter((o) => o === 'APPLIED').length, 10);
  assert.equal(outcomes.filter((o) => o === 'DUPLICATE').length, 20);
  assert.equal((await movements(h)).length, 10);
  const a = await account(h);
  assert.equal(a?.collected_minor, String(events.reduce((s, _e, i) => s + 1000 + i, 0)));
  assert.equal(a?.revision, 10);
});

test('pg: a reversal before its collection is attributed when the collection arrives', async () => {
  const h = holder();
  const model = new BillingCustodyModel();
  const c = model.collect(h, 'USD', 4_200n);
  const r = model.reverse({ id: aggregateId(c) });
  assert.equal(await deliver(replicaA, r), 'APPLIED');
  assert.equal(await account(h, 'USD'), undefined);
  const orphan = await sql.query(
    'SELECT holder_subject FROM app.wallet_custody_receipt WHERE receipt_id = $1',
    [aggregateId(c)],
  );
  assert.equal(orphan.rows[0].holder_subject, null);
  assert.equal(await deliver(replicaB, c), 'APPLIED');
  const a = await account(h, 'USD');
  assert.equal(a?.collected_minor, '4200');
  assert.equal(a?.reversed_minor, '4200');
  assert.deepEqual(
    (await movements(h)).map((m) => [m.kind, m.event_id]),
    [
      ['CASH_COLLECTED', c.eventId],
      ['COLLECTION_REVERSED', r.eventId],
    ],
  );
});

test('pg: handover lifecycle out of order converges; regressions are STALE', async () => {
  const h = holder();
  const model = new BillingCustodyModel();
  const c1 = model.collect(h, 'SYP', 60_000n);
  const c2 = model.collect(h, 'SYP', 40_000n);
  const declared = model.declare(h, 'SYP', [aggregateId(c1), aggregateId(c2)]);
  if (!declared) throw new Error('setup');
  const received = model.receive(aggregateId(declared), 99_000n);
  const reconciled = model.reconcile(aggregateId(declared));
  assert.equal(await deliver(replicaA, reconciled), 'APPLIED');
  assert.equal(await deliver(replicaB, received), 'STALE');
  assert.equal(await deliver(replicaA, declared), 'STALE');
  let a = await account(h);
  assert.equal(a?.settled_minor, '100000');
  assert.equal(a?.shortage_minor, '1000');
  const early = await http.get(`/custody/holders/${h}`, TOKENS.finance);
  const [position] = early.body.positions as Record<string, unknown>[];
  assert.equal(position?.complete, false, 'collections not yet seen');
  await deliver(replicaB, c1);
  await deliver(replicaA, c2);
  a = await account(h);
  assert.equal(a?.collected_minor, '100000');
  const late = await http.get(`/custody/holders/${h}`, TOKENS.finance);
  const [final] = late.body.positions as Record<string, unknown>[];
  assert.deepEqual(final?.held, { currency: 'SYP', amountMinor: '0', scale: 2 });
  assert.deepEqual(final?.settled, { currency: 'SYP', amountMinor: '100000', scale: 2 });
  assert.equal(final?.complete, true);
});

test('pg: poison, ignored and contradictory events are recorded without effects', async () => {
  const id = randomUUID();
  assert.equal(
    await replicaA.apply({ id, type: 'billing.cash-collected.v1', payload: '{"broken"' }),
    'POISON',
  );
  assert.equal(
    await replicaB.apply({ id, type: 'billing.cash-collected.v1', payload: '{"broken"' }),
    'DUPLICATE',
  );
  const other = randomUUID();
  assert.equal(
    await replicaA.apply({ id: other, type: 'billing.obligation-created.v1', payload: {} }),
    'IGNORED',
  );
  const rows = await sql.query(
    'SELECT outcome, reason FROM app.wallet_inbox WHERE event_id = ANY($1::uuid[]) ORDER BY outcome',
    [[id, other]],
  );
  assert.deepEqual(rows.rows, [
    { outcome: 'IGNORED', reason: 'NOT_CUSTODY_EVENT' },
    { outcome: 'POISON', reason: 'PAYLOAD_NOT_JSON' },
  ]);
  const h = holder();
  const model = new BillingCustodyModel();
  const c = model.collect(h, 'SYP', 500n);
  await deliver(replicaA, c);
  const r = model.reverse({ id: aggregateId(c) });
  const wrong = {
    ...r,
    data: { ...(r.data as object), amount: { currency: 'SYP', amountMinor: '499', scale: 2 } },
  };
  assert.equal(await deliver(replicaB, wrong as Envelope), 'POISON');
  assert.equal((await account(h))?.reversed_minor, '0');
});

test('pg: history tables are append-only and state rows cannot regress for the runtime role', async () => {
  const h = holder();
  const model = new BillingCustodyModel();
  const c = model.collect(h, 'SYP', 700n);
  await deliver(replicaA, c);
  const declared = model.declare(h, 'SYP', [aggregateId(c)]);
  if (!declared) throw new Error('setup');
  await deliver(replicaA, declared);
  const reject = async (statement: string, values: unknown[], code: RegExp) =>
    assert.rejects(sql.query(statement, values), code);
  await reject(
    'UPDATE app.wallet_inbox SET outcome = $2 WHERE event_id = $1',
    [c.eventId, 'STALE'],
    /WALLET_APPEND_ONLY/,
  );
  await reject(
    'DELETE FROM app.wallet_inbox WHERE event_id = $1',
    [c.eventId],
    /WALLET_APPEND_ONLY/,
  );
  await reject(
    `UPDATE app.wallet_movements SET amount_minor = 1 WHERE event_id = $1`,
    [c.eventId],
    /WALLET_APPEND_ONLY/,
  );
  await reject(
    'DELETE FROM app.wallet_accounts WHERE holder_subject = $1',
    [h],
    /WALLET_APPEND_ONLY/,
  );
  await reject(
    'UPDATE app.wallet_custody_receipt SET amount_minor = 1 WHERE receipt_id = $1',
    [aggregateId(c)],
    /WALLET_RECEIPT_REWRITE/,
  );
  await reject(
    'UPDATE app.wallet_custody_handover SET status = $2, version = version - 1 WHERE handover_id = $1',
    [aggregateId(declared), 'CANCELLED'],
    /WALLET_HANDOVER_REWRITE/,
  );
  await reject(
    `UPDATE app.wallet_custody_handover SET status = 'RECEIVED', version = version + 1 WHERE handover_id = $1`,
    [aggregateId(declared)],
    /wallet_custody_handover_counted/,
  );
  await reject(
    `INSERT INTO app.wallet_accounts (id, holder_subject, currency, purpose, collected_minor, reversed_minor,
       in_handover_minor, received_minor, settled_minor, shortage_minor, overage_minor, revision, created_at, updated_at)
     VALUES ($1, $2, 'SYP', 'CUSTOMER_STORED_VALUE', 0, 0, 0, 0, 0, 0, 0, 0, now(), now())`,
    [randomUUID(), randomUUID()],
    /wallet_accounts_purpose/,
  );
  const ddl = await sql.query(
    "SELECT has_schema_privilege(current_user, 'app', 'CREATE') AS can_create",
  );
  assert.equal(ddl.rows[0].can_create, false);
});

test('pg: model-based concurrent shuffled delivery matches Billing truth and the domain fold', async () => {
  const currencies: Currency[] = ['SYP', 'USD'];
  for (let seed = 101; seed <= 106; seed++) {
    const random = prng(seed);
    const holders = [holder(), holder(), holder()];
    const model = new BillingCustodyModel(random);
    for (let i = 0; i < 60; i++) model.step(holders, currencies);
    const deliveries = shuffle(
      [...model.events, ...model.events.filter(() => random() < 0.4)],
      random,
    );
    // Four concurrent lanes alternating between the two replicas.
    const lanes = [0, 1, 2, 3].map((lane) => deliveries.filter((_e, i) => i % 4 === lane));
    const outcomes = (
      await Promise.all(
        lanes.map(async (lane, index) => {
          const replica = index % 2 === 0 ? replicaA : replicaB;
          const out: string[] = [];
          for (const e of lane) out.push(await deliver(replica, e));
          return out;
        }),
      )
    ).flat();
    assert.ok(!outcomes.includes('CONFLICT') && !outcomes.includes('POISON'), `seed ${seed}`);
    for (const h of holders) {
      const receipts = await sql.query(
        `SELECT receipt_id, holder_subject, currency, amount_minor, collected_event_id, reversed_event_id, version
           FROM app.wallet_custody_receipt WHERE holder_subject = $1`,
        [h],
      );
      const handovers = await sql.query(
        `SELECT * FROM app.wallet_custody_handover WHERE holder_subject = $1`,
        [h],
      );
      const rs: ReceiptState[] = receipts.rows.map((r) => ({
        receiptId: r.receipt_id,
        holder: r.holder_subject,
        amount: amountOf(r.currency, BigInt(r.amount_minor)),
        collectedEventId: r.collected_event_id,
        reversedEventId: r.reversed_event_id,
        version: r.version,
      }));
      const opt = (cur: Currency, v: string | null) =>
        v === null ? null : amountOf(cur, BigInt(v));
      const hs: HandoverState[] = handovers.rows.map((r) => ({
        handoverId: r.handover_id,
        holder: r.holder_subject,
        status: r.status,
        receiptCount: r.receipt_count,
        declared: amountOf(r.currency, BigInt(r.declared_minor)),
        counted: opt(r.currency, r.counted_minor),
        shortage: opt(r.currency, r.shortage_minor),
        overage: opt(r.currency, r.overage_minor),
        version: r.version,
        lastEventId: r.last_event_id,
      }));
      for (const currency of currencies) {
        const truth = model.truth(h, currency);
        const a = await account(h, currency);
        if (truth.collected === 0n) {
          assert.equal(a, undefined);
          continue;
        }
        const fold = positionOf(h, currency, rs, hs);
        const stored = {
          collected: BigInt(a?.collected_minor ?? -1),
          reversed: BigInt(a?.reversed_minor ?? -1),
          inHandover: BigInt(a?.in_handover_minor ?? -1),
          receivedByTreasury: BigInt(a?.received_minor ?? -1),
          settled: BigInt(a?.settled_minor ?? -1),
          shortage: BigInt(a?.shortage_minor ?? -1),
          overage: BigInt(a?.overage_minor ?? -1),
        };
        const expected = {
          collected: truth.collected,
          reversed: truth.reversed,
          inHandover: truth.inHandover,
          receivedByTreasury: truth.receivedByTreasury,
          settled: truth.settled,
          shortage: truth.shortage,
          overage: truth.overage,
        };
        assert.deepEqual(stored, expected, `seed ${seed} stored vs truth`);
        assert.equal(fold.held, truth.held, `seed ${seed} fold held`);
        assert.equal(fold.collected, truth.collected, `seed ${seed} fold collected`);
      }
    }
    // Every Billing event was recorded exactly once.
    const recorded = await sql.query(
      'SELECT count(*)::int AS n FROM app.wallet_inbox WHERE event_id = ANY($1::uuid[])',
      [model.events.map((e) => e.eventId)],
    );
    assert.equal(recorded.rows[0].n, model.events.length);
  }
});

test('pg: the HTTP read path serves the technician their own stored projection', async () => {
  const model = new BillingCustodyModel();
  const e = model.collect(SUBJECTS.technician, 'SYP', 12_345n);
  await deliver(replicaA, e);
  const reply = await http.get('/custody/holders/me', TOKENS.technician);
  assert.equal(reply.status, 200);
  const [position] = reply.body.positions as Record<string, unknown>[];
  assert.ok(position);
  assert.equal((position.source as { lastEventId: string }).lastEventId, e.eventId);
  const denied = await http.get(`/custody/holders/${SUBJECTS.technician}`, TOKENS.otherTechnician);
  assert.equal(denied.status, 403);
});
