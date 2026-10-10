import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { parseEnvelopeV2 } from '@carwash/event-contracts';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaBillingRepository } from '../../src/infrastructure/persistence/prisma-billing.repository';
import {
  parseCashCollectedData,
  parseCashCollectionReversedData,
  parseCustodyHandoverChangedData,
  parseObligationStatusChangedData,
} from '../../src/application';
import {
  FixedClock,
  SESSIONS,
  SUBJECTS,
  TOKENS,
  startBillingHttp,
  type BillingHttpHarness,
  type HttpReply,
} from '../support/billing-http-harness';
import {
  startIdentityStub,
  startPricingStub,
  type PricingStub,
  type Stub,
} from '../support/upstream-stubs';
import { WorkDouble } from '../support/work-double';

/*
 * REAL PostgreSQL evidence for P03-B1 cash collection, custody, handover,
 * treasury receipt and settlement, run as the least-privileged runtime role
 * (cw_billing_app) through scripts/production/B/postgres-acceptance.mjs.
 * Two replicas (separate pools) share the database to prove concurrency.
 * Identity and Pricing are local HTTP test doubles; the lane C work owner is an
 * in-process double behind the WorkAuthority port (no published contract yet,
 * B-P03-01); a third replica uses the production fail-closed adapter.
 * RabbitMQ is not used: the relay is not started until E registers the events.
 */
const APP_URL = process.env.BILLING_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('BILLING_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;
const PATH = '/internal/v1/billing';

let prismaA: PrismaService;
let prismaB: PrismaService;
let identity: Stub;
let pricing: PricingStub;
let clock: FixedClock;
let work: WorkDouble;
let replicaA: BillingHttpHarness;
let replicaB: BillingHttpHarness;
let production: BillingHttpHarness;
let sql: Client;
let seq = 0;
const key = () => `pg-custody-key-${String(++seq).padStart(6, '0')}-${process.pid}`;
const reference = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}-${String(++seq)}`;

before(async () => {
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  identity = await startIdentityStub(SESSIONS);
  pricing = await startPricingStub();
  work = new WorkDouble();
  prismaA = new PrismaService(DATABASE_URL);
  prismaB = new PrismaService(DATABASE_URL);
  const common = { clock, identity, pricing };
  replicaA = await startBillingHttp({
    ...common,
    repository: new PrismaBillingRepository(prismaA),
    work,
  });
  replicaB = await startBillingHttp({
    ...common,
    repository: new PrismaBillingRepository(prismaB),
    work,
  });
  production = await startBillingHttp({
    ...common,
    repository: new PrismaBillingRepository(prismaA),
  });
  sql = new Client({ connectionString: DATABASE_URL.replace(/\?schema=app$/, '') });
  await sql.connect();
});

after(async () => {
  await replicaA?.close();
  await replicaB?.close();
  await production?.close();
  await prismaA?.onModuleDestroy();
  await prismaB?.onModuleDestroy();
  await identity?.close();
  await pricing?.close();
  await sql?.end();
});

// ---------------------------------------------------------------- helpers

type Options = { token?: string; key?: string; replica?: BillingHttpHarness };
const syp = (amountMinor: string) => ({ currency: 'SYP', amountMinor, scale: 2 });
const errorCode = (reply: HttpReply): unknown =>
  (reply.body.error as { code?: unknown } | undefined)?.code;
const post = (path: string, body: unknown, options: Options, token: string) =>
  (options.replica ?? replicaA).request('POST', `${PATH}${path}`, {
    token: options.token ?? token,
    key: options.key ?? key(),
    body,
  });
const get = (path: string, token: string, replica: BillingHttpHarness = replicaA) =>
  replica.request('GET', `${PATH}${path}`, { token });

interface CashJob {
  obligationId: string;
  quoteId: string;
  bookingId: string;
  revision: number;
  amount: string;
}

/** An obligation the customer chose to pay in cash, and its completed booking. */
async function cashJob(
  total = '150000',
  technician: string | null = SUBJECTS.technician,
): Promise<CashJob> {
  const quoteId = randomUUID();
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: total,
  });
  const created = await post('/obligations', { quoteId }, {}, TOKENS.customer);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const obligationId = String(created.body.obligationId);
  const intent = await post(
    `/obligations/${obligationId}/payment-intents`,
    { expectedRevision: 1, method: 'CASH_ON_COMPLETION' },
    {},
    TOKENS.customer,
  );
  assert.equal(intent.status, 201, JSON.stringify(intent.body));
  assert.equal(intent.body.financialStatus, 'AWAITING_CASH');
  const booking = work.book({ quoteId, technicianSubject: technician });
  return { obligationId, quoteId, bookingId: booking.bookingId, revision: 2, amount: total };
}

function collect(job: CashJob, options: Options & { amount?: string; revision?: number } = {}) {
  return post(
    `/obligations/${job.obligationId}/cash-collections`,
    {
      expectedRevision: options.revision ?? job.revision,
      bookingId: job.bookingId,
      amount: syp(options.amount ?? job.amount),
    },
    options,
    TOKENS.technician,
  );
}

async function collected(
  job: CashJob,
  token = TOKENS.technician,
): Promise<Record<string, unknown>> {
  const reply = await collect(job, { token });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return reply.body.receipt as Record<string, unknown>;
}

const reverse = (receiptId: unknown, revision: number, reason: string, options: Options = {}) =>
  post(
    `/cash-receipts/${String(receiptId)}/reversal`,
    { expectedRevision: revision, reason },
    options,
    TOKENS.corrector,
  );
const declare = (receiptIds: unknown[], declaredMinor: string, options: Options = {}) =>
  post(
    '/custody/handovers',
    { receiptIds, declaredAmount: syp(declaredMinor) },
    options,
    TOKENS.technician,
  );
const cancel = (handoverId: unknown, revision: number, options: Options = {}) =>
  post(
    `/custody/handovers/${String(handoverId)}/cancel`,
    { expectedRevision: revision },
    options,
    TOKENS.technician,
  );
const receive = (
  handoverId: unknown,
  revision: number,
  countedMinor: string,
  options: Options & { ref?: string } = {},
) =>
  post(
    `/custody/handovers/${String(handoverId)}/treasury-receipt`,
    {
      expectedRevision: revision,
      countedAmount: syp(countedMinor),
      treasuryReference: options.ref ?? reference('DEP'),
    },
    options,
    TOKENS.treasury,
  );
const settle = (handoverId: unknown, revision: number, options: Options & { ref?: string } = {}) =>
  post(
    `/custody/handovers/${String(handoverId)}/reconciliation`,
    { expectedRevision: revision, settlementReference: options.ref ?? reference('SET') },
    options,
    TOKENS.reconciler,
  );

async function count(table: string, where: string, values: unknown[]): Promise<number> {
  const result = await sql.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM app.${table} WHERE ${where}`,
    values,
  );
  return Number(result.rows[0]?.n);
}

/** Net (debit - credit) of one account, optionally for one holder. */
async function accountNet(account: string, holder?: string): Promise<bigint> {
  const result = await sql.query<{ net: string }>(
    `SELECT COALESCE(SUM(CASE side WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS net
       FROM app.ledger_line WHERE account = $1 AND ($2::uuid IS NULL OR holder_subject = $2::uuid)`,
    [account, holder ?? null],
  );
  return BigInt(result.rows[0]?.net ?? 'x');
}

async function receivable(obligationId: string): Promise<string> {
  const result = await sql.query<{ net: string }>(
    `SELECT COALESCE(SUM(CASE l.side WHEN 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END), 0)::text AS net
       FROM app.ledger_line l JOIN app.ledger_journal j ON j.id = l.journal_id
      WHERE j.obligation_id = $1 AND l.account = 'CUSTOMER_RECEIVABLE'`,
    [obligationId],
  );
  return result.rows[0]?.net ?? 'missing';
}

async function custodyStatus(receiptId: unknown): Promise<string | undefined> {
  const result = await sql.query<{ status: string }>(
    'SELECT custody_status AS status FROM app.cash_receipt WHERE id = $1',
    [receiptId],
  );
  return result.rows[0]?.status;
}

/** Ordered by aggregate version: events of one command share created_at under the fixed clock. */
async function outbox(aggregateId: unknown): Promise<{ event_type: string; payload: string }[]> {
  const result = await sql.query<{ event_type: string; payload: string }>(
    `SELECT event_type, payload FROM app.outbox_message
      WHERE payload::jsonb #>> '{aggregate,id}' = $1
      ORDER BY created_at, (payload::jsonb #>> '{aggregate,version}')::int, event_type`,
    [aggregateId],
  );
  return result.rows;
}

/** Runs statements in one transaction and expects a statement or the COMMIT to fail. */
async function rejected(
  statements: (string | [string, unknown[]])[],
  pattern: RegExp,
): Promise<void> {
  await sql.query('BEGIN');
  try {
    for (const statement of statements)
      if (typeof statement === 'string') await sql.query(statement);
      else await sql.query(statement[0], statement[1]);
    await sql.query('COMMIT');
  } catch (error: unknown) {
    await sql.query('ROLLBACK').catch(() => undefined);
    assert.match(String((error as Error).message), pattern);
    return;
  }
  assert.fail(`expected ${String(pattern)} but the transaction committed`);
}

async function reportIsConsistent(): Promise<Record<string, unknown>> {
  const report = await get('/custody/reconciliation', TOKENS.finance);
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.equal(report.body.consistent, true, JSON.stringify(report.body));
  assert.deepEqual(report.body.holderMismatches, []);
  return report.body;
}

// ------------------------------------------------- the five separate facts

test('lifecycle: completed service -> collected -> held -> handed over -> received -> reconciled', async () => {
  const tech = SUBJECTS.technician;
  const custodyBefore = await accountNet('CASH_IN_CUSTODY', tech);
  const treasuryBefore = await accountNet('TREASURY_CASH');
  const job = await cashJob('150000');

  // 2. Cash collected from the customer: obligation settled by CASH, not PAID.
  const collection = await collect(job, { replica: replicaB });
  assert.equal(collection.status, 201, JSON.stringify(collection.body));
  const receipt = collection.body.receipt as Record<string, unknown>;
  const obligation = collection.body.obligation as Record<string, unknown>;
  assert.equal(obligation.financialStatus, 'CASH_COLLECTED');
  assert.deepEqual(obligation.outstanding, syp('0'));
  assert.equal(obligation.revision, 3);
  assert.equal(receipt.custodyStatus, 'HELD');
  assert.equal(receipt.collector, tech);
  assert.equal(receipt.bookingId, job.bookingId);
  assert.equal(await receivable(job.obligationId), '0');
  const ownerView = await get(`/obligations/${job.obligationId}`, TOKENS.customer);
  assert.equal(ownerView.body.financialStatus, 'CASH_COLLECTED');
  assert.equal((ownerView.body.cashReceipt as { receiptId: string }).receiptId, receipt.receiptId);
  assert.equal(ownerView.body.status, 'SETTLED');

  // 3. Cash held by the technician: ledger custody and position both show it.
  assert.equal((await accountNet('CASH_IN_CUSTODY', tech)) - custodyBefore, 150000n);
  const mine = await get('/custody/holders/me', TOKENS.technician);
  assert.equal(mine.status, 200);
  type Wire = { amountMinor: string };
  const balance = (mine.body.balances as Record<string, unknown>[]).find(
    (entry) => entry.currency === 'SYP',
  );
  assert.ok(balance);
  const minor = (field: string) => BigInt((balance[field] as Wire).amountMinor);
  assert.equal(
    minor('ledgerCustody'),
    minor('held') + minor('inHandover'),
    'ledger = held + in handover',
  );
  assert.ok(minor('held') >= 150000n);

  // 4a. Handed to the company: declared, still not received.
  const declared = await declare([receipt.receiptId], '150000');
  assert.equal(declared.status, 201, JSON.stringify(declared.body));
  assert.equal(declared.body.status, 'PENDING');
  assert.equal(await custodyStatus(receipt.receiptId), 'IN_HANDOVER');
  assert.equal(
    (await accountNet('CASH_IN_CUSTODY', tech)) - custodyBefore,
    150000n,
    'still in custody',
  );
  const handoverId = declared.body.handoverId;

  // 4b. Counted by an independent treasury receiver.
  const received = await receive(handoverId, 1, '150000', { replica: replicaB });
  assert.equal(received.status, 200, JSON.stringify(received.body));
  assert.equal(received.body.status, 'RECEIVED');
  assert.deepEqual(received.body.shortage, syp('0'));
  assert.match(String(received.body.treasuryReference), /^…[A-Z0-9]{4}$/, 'reference is masked');
  assert.equal(await custodyStatus(receipt.receiptId), 'DEPOSITED');
  assert.equal((await accountNet('CASH_IN_CUSTODY', tech)) - custodyBefore, 0n);
  assert.equal((await accountNet('TREASURY_CASH')) - treasuryBefore, 0n, 'not reconciled yet');

  // 5. Settlement reconciled by a third person.
  const settled = await settle(handoverId, 2);
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.equal(settled.body.status, 'RECONCILED');
  assert.equal(await custodyStatus(receipt.receiptId), 'SETTLED');
  assert.equal((await accountNet('TREASURY_CASH')) - treasuryBefore, 150000n);

  // Audit trail and outbox rows per fact (relay not started: all unpublished).
  assert.equal(
    await count('billing_audit_event', 'receipt_id = $1 AND action = $2', [
      receipt.receiptId,
      'billing.cash.collected',
    ]),
    1,
  );
  assert.equal(
    await count('billing_audit_event', 'handover_id = $1', [handoverId]),
    3,
    'declared, received, reconciled',
  );
  const receiptEvents = await outbox(receipt.receiptId);
  assert.deepEqual(
    receiptEvents.map((row) => row.event_type),
    ['billing.cash-collected.v1'],
  );
  const cashEnvelope = parseEnvelopeV2(
    JSON.parse(receiptEvents[0]?.payload ?? '{}'),
    {
      eventType: 'billing.cash-collected.v1',
      producer: 'billing',
      aggregateType: 'billing-cash-receipt',
    },
    parseCashCollectedData,
  );
  assert.equal(cashEnvelope.data.custodyStatus, 'HELD');
  assert.deepEqual(cashEnvelope.actor, { kind: 'account', id: tech });
  const statusEvents = (await outbox(job.obligationId)).filter(
    (row) => row.event_type === 'billing.obligation-status-changed.v1',
  );
  const last = parseEnvelopeV2(
    JSON.parse(statusEvents.at(-1)?.payload ?? '{}'),
    {
      eventType: 'billing.obligation-status-changed.v1',
      producer: 'billing',
      aggregateType: 'billing-obligation',
    },
    parseObligationStatusChangedData,
  );
  assert.deepEqual(
    [last.data.previousFinancialStatus, last.data.financialStatus],
    ['AWAITING_CASH', 'CASH_COLLECTED'],
  );
  const handoverEvents = await outbox(handoverId);
  assert.deepEqual(
    handoverEvents.map(
      (row) =>
        parseEnvelopeV2(
          JSON.parse(row.payload),
          {
            eventType: 'billing.custody-handover-changed.v1',
            producer: 'billing',
            aggregateType: 'billing-custody-handover',
          },
          parseCustodyHandoverChangedData,
        ).data.status,
    ),
    ['PENDING', 'RECEIVED', 'RECONCILED'],
  );
  for (const row of handoverEvents)
    assert.doesNotMatch(row.payload, /DEP-|SET-|treasuryReference|settlementReference/);
  assert.equal(await count('outbox_message', 'published_at IS NOT NULL', []), 0);
  await reportIsConsistent();
});

// ------------------------------------------------- authority for collection

test('collection: the work owner decides assignment and completion, never the body', async () => {
  const notDone = await cashJob();
  work.set(notDone.bookingId, { workState: 'IN_PROGRESS' });
  const early = await collect(notDone);
  assert.equal(early.status, 409);
  assert.equal(errorCode(early), 'WORK_NOT_COMPLETED');

  const foreign = await cashJob('150000', SUBJECTS.otherTechnician);
  const wrongTech = await collect(foreign);
  assert.equal(wrongTech.status, 403);
  assert.equal(errorCode(wrongTech), 'COLLECTOR_NOT_ASSIGNED');

  const unassigned = await cashJob('150000', null);
  assert.equal((await collect(unassigned)).status, 403);

  const other = await cashJob();
  const mismatched = await collect({ ...other, bookingId: notDone.bookingId });
  assert.equal(mismatched.status, 404, 'a booking for another quote cannot settle this obligation');
  const unknownBooking = await collect({ ...other, bookingId: randomUUID() });
  assert.equal(unknownBooking.status, 404);

  for (const job of [notDone, foreign, unassigned, other])
    assert.equal(await count('cash_receipt', 'obligation_id = $1', [job.obligationId]), 0);
  // The work owner is called with the caller's own token and correlation id.
  const call = work.calls.at(-1);
  assert.equal(call?.credential, `Bearer ${TOKENS.technician}`);
});

test('collection: work owner outage is 503 with no receipt; production fails closed until lane C', async () => {
  const job = await cashJob();
  work.unavailable = true;
  try {
    const down = await collect(job, { key: 'outage-retry-key-0001-' + process.pid });
    assert.equal(down.status, 503);
    assert.equal(errorCode(down), 'UPSTREAM_UNAVAILABLE');
  } finally {
    work.unavailable = false;
  }
  assert.equal(await count('cash_receipt', 'obligation_id = $1', [job.obligationId]), 0);
  // No receipt was stored for the failed key: the same key succeeds later.
  const retried = await collect(job, { key: 'outage-retry-key-0001-' + process.pid });
  assert.equal(retried.status, 201, JSON.stringify(retried.body));

  const blocked = await cashJob();
  const prod = await collect(blocked, { replica: production });
  assert.equal(prod.status, 503);
  assert.equal(errorCode(prod), 'UPSTREAM_UNAVAILABLE');
  assert.equal(await count('cash_receipt', 'obligation_id = $1', [blocked.obligationId]), 0);
});

test('collection: grants, principal kind, exact amount and cash intent are enforced', async () => {
  const job = await cashJob();
  const anonymous = await replicaA.request(
    'POST',
    `${PATH}/obligations/${job.obligationId}/cash-collections`,
    {
      key: key(),
      body: { expectedRevision: 2, bookingId: job.bookingId, amount: syp(job.amount) },
    },
  );
  assert.equal(anonymous.status, 401);
  assert.equal(
    (await collect(job, { token: TOKENS.customer })).status,
    403,
    'customers cannot record cash',
  );
  assert.equal((await collect(job, { token: TOKENS.treasury })).status, 403);
  assert.equal(
    (await collect(job, { token: TOKENS.guestCollector })).status,
    403,
    'a guest never holds cash',
  );
  const short = await collect(job, { amount: '149999' });
  assert.equal(short.status, 422);
  assert.equal(errorCode(short), 'AMOUNT_NOT_EQUAL_OUTSTANDING');
  const stale = await collect(job, { revision: 1 });
  assert.equal(stale.status, 412);
  const invalid = await post(
    `/obligations/${job.obligationId}/cash-collections`,
    {
      expectedRevision: 2,
      bookingId: job.bookingId,
      amount: { currency: 'SYP', amountMinor: '150000.5', scale: 2 },
    },
    {},
    TOKENS.technician,
  );
  assert.equal(invalid.status, 400);

  // An electronic intent cannot be settled with cash.
  const electronic = await cashJob();
  const switched = await post(
    `/obligations/${electronic.obligationId}/payment-intents`,
    { expectedRevision: 2, method: 'SHAM_CASH' },
    {},
    TOKENS.customer,
  );
  assert.equal(switched.status, 201);
  const notCash = await collect({ ...electronic, revision: 3 });
  assert.equal(notCash.status, 409);
  assert.equal(errorCode(notCash), 'INTENT_NOT_CASH');
  assert.equal(
    await count('cash_receipt', 'obligation_id IN ($1, $2)', [
      job.obligationId,
      electronic.obligationId,
    ]),
    0,
  );
});

// ------------------------------------------------------ retries and races

test('retry: the same key replays the original outcome on any replica (lost response)', async () => {
  const job = await cashJob();
  const k = key();
  const first = await collect(job, { key: k });
  assert.equal(first.status, 201);
  const replay = await collect(job, { key: k, replica: replicaB });
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(replay.body, first.body);
  const conflict = await collect(job, { key: k, amount: '1' });
  assert.equal(errorCode(conflict), 'IDEMPOTENCY_CONFLICT');
  assert.equal(await count('cash_receipt', 'obligation_id = $1', [job.obligationId]), 1);
  assert.equal(
    await count('ledger_journal', "obligation_id = $1 AND kind = 'CASH_COLLECTED'", [
      job.obligationId,
    ]),
    1,
  );
});

test('race: concurrent collections (same key and different keys, two replicas) collect once', async () => {
  const sameKey = await cashJob();
  const k = key();
  const pair = await Promise.all([
    collect(sameKey, { key: k }),
    collect(sameKey, { key: k, replica: replicaB }),
  ]);
  assert.deepEqual(
    pair.map((reply) => reply.status),
    [201, 201],
  );
  assert.equal(await count('cash_receipt', 'obligation_id = $1', [sameKey.obligationId]), 1);

  const job = await cashJob();
  const replies = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      collect(job, { replica: index % 2 ? replicaB : replicaA }),
    ),
  );
  const winners = replies.filter((reply) => reply.status === 201);
  assert.equal(winners.length, 1, JSON.stringify(replies.map((r) => [r.status, errorCode(r)])));
  for (const loser of replies.filter((reply) => reply.status !== 201))
    assert.ok(
      ['REVISION_CONFLICT', 'OBLIGATION_SETTLED', 'COLLECTION_ALREADY_RECORDED'].includes(
        String(errorCode(loser)),
      ),
      String(errorCode(loser)),
    );
  assert.equal(await count('cash_receipt', 'obligation_id = $1', [job.obligationId]), 1);
  assert.equal(
    await count('ledger_journal', "obligation_id = $1 AND kind = 'CASH_COLLECTED'", [
      job.obligationId,
    ]),
    1,
  );
  assert.equal(await receivable(job.obligationId), '0');
  await reportIsConsistent();
});

// ------------------------------------------------------------- reversal

test('reversal: a linked correction reopens the obligation; history is kept; cash can be collected again', async () => {
  const job = await cashJob();
  const receipt = await collected(job);
  const reversed = await reverse(receipt.receiptId, 1, 'RECORDED_IN_ERROR');
  assert.equal(reversed.status, 200, JSON.stringify(reversed.body));
  const view = reversed.body.receipt as Record<string, unknown>;
  assert.equal(view.custodyStatus, 'REVERSED');
  assert.equal((view.reversal as { reason: string }).reason, 'RECORDED_IN_ERROR');
  const obligation = reversed.body.obligation as Record<string, unknown>;
  assert.equal(obligation.financialStatus, 'AWAITING_CASH');
  assert.deepEqual(obligation.outstanding, syp(job.amount));
  assert.equal(obligation.revision, 4);
  assert.equal(await receivable(job.obligationId), job.amount);
  assert.equal(await count('cash_receipt_reversal', 'receipt_id = $1', [receipt.receiptId]), 1);
  assert.equal(
    await count('cash_receipt', 'obligation_id = $1', [job.obligationId]),
    1,
    'the original is kept',
  );

  const again = await collect({ ...job, revision: 4 });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(await count('cash_receipt', 'obligation_id = $1', [job.obligationId]), 2);
  assert.equal(
    await count('cash_receipt', 'obligation_id = $1 AND active_slot = 1', [job.obligationId]),
    1,
  );
  const events = await outbox(receipt.receiptId);
  assert.deepEqual(
    events.map((row) => row.event_type),
    ['billing.cash-collected.v1', 'billing.cash-collection-reversed.v1'],
  );
  parseEnvelopeV2(
    JSON.parse(events[1]?.payload ?? '{}'),
    {
      eventType: 'billing.cash-collection-reversed.v1',
      producer: 'billing',
      aggregateType: 'billing-cash-receipt',
    },
    parseCashCollectionReversedData,
  );
  await reportIsConsistent();
});

test('reversal: never by the collector, never twice, never once cash left the holder', async () => {
  const job = await cashJob();
  const receipt = await collected(job);
  const self = await reverse(receipt.receiptId, 1, 'RECORDED_IN_ERROR', {
    token: TOKENS.selfCorrector,
  });
  assert.equal(self.status, 403);
  assert.equal(errorCode(self), 'SEPARATION_OF_DUTIES');
  assert.equal(
    (await reverse(receipt.receiptId, 1, 'RECORDED_IN_ERROR', { token: TOKENS.technician })).status,
    403,
  );
  assert.equal((await reverse(receipt.receiptId, 1, 'free text reason')).status, 400);
  assert.equal((await reverse(receipt.receiptId, 1, 'WRONG_BOOKING')).status, 200);
  const twice = await reverse(receipt.receiptId, 2, 'WRONG_BOOKING');
  assert.equal(twice.status, 409);
  assert.equal(errorCode(twice), 'RECEIPT_ALREADY_REVERSED');

  const moving = await cashJob();
  const inHandover = await collected(moving);
  assert.equal((await declare([inHandover.receiptId], moving.amount)).status, 201);
  const late = await reverse(inHandover.receiptId, 2, 'RECORDED_IN_ERROR');
  assert.equal(late.status, 409);
  assert.equal(errorCode(late), 'RECEIPT_NOT_HELD');
});

test('race: reversal vs handover of the same receipt - exactly one wins, invariants hold', async () => {
  for (let round = 0; round < 3; round += 1) {
    const job = await cashJob();
    const receipt = await collected(job);
    const [reversal, handover] = await Promise.all([
      reverse(receipt.receiptId, 1, 'RECORDED_IN_ERROR', { replica: replicaB }),
      declare([receipt.receiptId], job.amount),
    ]);
    const outcomes = [reversal.status === 200, handover.status === 201];
    assert.equal(
      outcomes.filter(Boolean).length,
      1,
      JSON.stringify([reversal.body, handover.body]),
    );
    assert.equal(
      await custodyStatus(receipt.receiptId),
      reversal.status === 200 ? 'REVERSED' : 'IN_HANDOVER',
    );
  }
  await reportIsConsistent();
});

// -------------------------------------------------------------- handover

test('handover: only own HELD receipts, exact declared total, a set without duplicates', async () => {
  const mine = await cashJob('20000');
  const mineReceipt = await collected(mine);
  const theirs = await cashJob('30000', SUBJECTS.otherTechnician);
  const theirReceipt = await collected(theirs, TOKENS.otherTechnician);

  const foreign = await declare([mineReceipt.receiptId, theirReceipt.receiptId], '50000');
  assert.equal(foreign.status, 409);
  assert.equal(errorCode(foreign), 'RECEIPT_NOT_HELD');
  const wrongTotal = await declare([mineReceipt.receiptId], '19999');
  assert.equal(errorCode(wrongTotal), 'DECLARED_TOTAL_MISMATCH');
  const duplicate = await declare([mineReceipt.receiptId, mineReceipt.receiptId], '40000');
  assert.equal(errorCode(duplicate), 'HANDOVER_DUPLICATE_RECEIPT');
  assert.equal((await declare([], '1')).status, 422);
  assert.equal(
    (await declare([mineReceipt.receiptId], '20000', { token: TOKENS.treasury })).status,
    403,
  );
  assert.equal(await custodyStatus(mineReceipt.receiptId), 'HELD');

  // The holder can read their handover; another technician cannot.
  const ok = await declare([mineReceipt.receiptId], '20000');
  assert.equal(ok.status, 201);
  assert.equal(
    (await get(`/custody/handovers/${String(ok.body.handoverId)}`, TOKENS.technician)).status,
    200,
  );
  assert.equal(
    (await get(`/custody/handovers/${String(ok.body.handoverId)}`, TOKENS.otherTechnician)).status,
    404,
  );
  assert.equal(
    (await get(`/cash-receipts/${String(mineReceipt.receiptId)}`, TOKENS.otherTechnician)).status,
    404,
  );
  assert.equal(
    (await get(`/cash-receipts/${String(mineReceipt.receiptId)}`, TOKENS.finance)).status,
    200,
  );
});

test('race: two handovers claiming the same receipt - one wins', async () => {
  const job = await cashJob();
  const receipt = await collected(job);
  const replies = await Promise.all([
    declare([receipt.receiptId], job.amount),
    declare([receipt.receiptId], job.amount, { replica: replicaB }),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await count('custody_handover_item', 'receipt_id = $1', [receipt.receiptId]), 1);
});

test('race: the same handover key on two replicas declares once and replays', async () => {
  const job = await cashJob();
  const receipt = await collected(job);
  const k = key();
  const replies = await Promise.all([
    declare([receipt.receiptId], job.amount, { key: k }),
    declare([receipt.receiptId], job.amount, { key: k, replica: replicaB }),
  ]);
  assert.deepEqual(
    replies.map((reply) => reply.status),
    [201, 201],
  );
  assert.deepEqual(replies[0]?.body, replies[1]?.body);
  assert.equal(await count('custody_handover_item', 'receipt_id = $1', [receipt.receiptId]), 1);
});

test('cancel: the holder withdraws a pending handover and the cash is held again', async () => {
  const job = await cashJob();
  const receipt = await collected(job);
  const declared = await declare([receipt.receiptId], job.amount);
  const handoverId = declared.body.handoverId;
  assert.equal((await cancel(handoverId, 1, { token: TOKENS.otherTechnician })).status, 404);
  const cancelled = await cancel(handoverId, 1);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, 'CANCELLED');
  assert.equal(await custodyStatus(receipt.receiptId), 'HELD');
  assert.equal(errorCode(await receive(handoverId, 2, job.amount)), 'HANDOVER_NOT_PENDING');
  const again = await declare([receipt.receiptId], job.amount);
  assert.equal(again.status, 201, 'a cancelled handover releases the receipt');
  await reportIsConsistent();
});

test('race: treasury receipt vs holder cancel on one handover - exactly one applies', async () => {
  for (let round = 0; round < 3; round += 1) {
    const job = await cashJob();
    const receipt = await collected(job);
    const declared = await declare([receipt.receiptId], job.amount);
    const [received, cancelled] = await Promise.all([
      receive(declared.body.handoverId, 1, job.amount),
      cancel(declared.body.handoverId, 1, { replica: replicaB }),
    ]);
    assert.equal([received.status, cancelled.status].filter((s) => s === 200).length, 1);
    assert.equal(
      await custodyStatus(receipt.receiptId),
      received.status === 200 ? 'DEPOSITED' : 'HELD',
    );
  }
  await reportIsConsistent();
});

// ------------------------------------------------- treasury and settlement

test('treasury: shortage and overage are explicit ledger facts, never absorbed', async () => {
  const tech = SUBJECTS.technician;
  const shortageBefore = await accountNet('CUSTODY_SHORTAGE_RECEIVABLE', tech);
  const overageBefore = await accountNet('CUSTODY_OVERAGE_SUSPENSE');
  const a = await cashJob('10000');
  const b = await cashJob('5000');
  const ra = await collected(a);
  const rb = await collected(b);
  const short = await declare([ra.receiptId, rb.receiptId], '15000');
  const counted = await receive(short.body.handoverId, 1, '14000');
  assert.equal(counted.status, 200, JSON.stringify(counted.body));
  assert.deepEqual([counted.body.shortage, counted.body.overage], [syp('1000'), syp('0')]);
  assert.equal((await accountNet('CUSTODY_SHORTAGE_RECEIVABLE', tech)) - shortageBefore, 1000n);
  const position = await get(`/custody/holders/${tech}`, TOKENS.finance);
  const syps = (
    position.body.balances as { currency: string; shortageOutstanding: unknown }[]
  ).find((x) => x.currency === 'SYP');
  assert.ok(BigInt((syps?.shortageOutstanding as { amountMinor: string }).amountMinor) >= 1000n);
  assert.equal(
    (await settle(short.body.handoverId, 2)).status,
    200,
    'settlement does not hide the shortage',
  );
  assert.equal((await accountNet('CUSTODY_SHORTAGE_RECEIVABLE', tech)) - shortageBefore, 1000n);

  const c = await cashJob('7000');
  const rc = await collected(c);
  const over = await declare([rc.receiptId], '7000');
  const extra = await receive(over.body.handoverId, 1, '7500');
  assert.deepEqual([extra.body.shortage, extra.body.overage], [syp('0'), syp('500')]);
  assert.equal(
    (await accountNet('CUSTODY_OVERAGE_SUSPENSE')) - overageBefore,
    -500n,
    'credit balance',
  );

  // Nothing counted at all: full shortage, settlement posts no treasury journal.
  const d = await cashJob('3000');
  const rd = await collected(d);
  const empty = await declare([rd.receiptId], '3000');
  const zero = await receive(empty.body.handoverId, 1, '0');
  assert.equal(zero.status, 200);
  const settledZero = await settle(empty.body.handoverId, 2);
  assert.equal(settledZero.status, 200, JSON.stringify(settledZero.body));
  assert.equal(
    await count('ledger_journal', "handover_id = $1 AND kind = 'CUSTODY_RECONCILED'", [
      empty.body.handoverId,
    ]),
    0,
  );
  const report = await reportIsConsistent();
  assert.ok(Number(report.handoversWithDiscrepancy) >= 3);
});

test('separation of duties: holder, receiver and reconciler are three different people', async () => {
  const job = await cashJob();
  const receipt = await collected(job);
  const declared = await declare([receipt.receiptId], job.amount);
  const handoverId = declared.body.handoverId;
  assert.equal(
    (await receive(handoverId, 1, job.amount, { token: TOKENS.technician })).status,
    403,
  );
  const receivedByDual = await receive(handoverId, 1, job.amount, {
    token: TOKENS.treasuryReconciler,
  });
  assert.equal(receivedByDual.status, 200);
  const selfSettle = await settle(handoverId, 2, { token: TOKENS.treasuryReconciler });
  assert.equal(selfSettle.status, 403);
  assert.equal(errorCode(selfSettle), 'SEPARATION_OF_DUTIES');
  assert.equal(
    (await settle(handoverId, 2, { token: TOKENS.finance })).status,
    403,
    'billing.read alone cannot settle',
  );
  assert.equal((await settle(handoverId, 2)).status, 200);
  const twice = await settle(handoverId, 3);
  assert.equal(errorCode(twice), 'HANDOVER_NOT_RECEIVED');
});

test('treasury and settlement references are claimed once; competing receipts apply once', async () => {
  const ref = reference('DEP');
  const first = await cashJob();
  const second = await cashJob();
  const h1 = await declare([(await collected(first)).receiptId], first.amount);
  const h2 = await declare([(await collected(second)).receiptId], second.amount);
  assert.equal((await receive(h1.body.handoverId, 1, first.amount, { ref })).status, 200);
  const reused = await receive(h2.body.handoverId, 1, second.amount, { ref: ref.toLowerCase() });
  assert.equal(reused.status, 409);
  assert.equal(errorCode(reused), 'TREASURY_REFERENCE_TAKEN');

  const replies = await Promise.all([
    receive(h2.body.handoverId, 1, second.amount),
    receive(h2.body.handoverId, 1, second.amount, { replica: replicaB }),
  ]);
  assert.equal(
    replies.filter((r) => r.status === 200).length,
    1,
    JSON.stringify(replies.map((r) => r.body)),
  );
  assert.equal(
    await count('ledger_journal', "handover_id = $1 AND kind = 'CUSTODY_RECEIVED'", [
      h2.body.handoverId,
    ]),
    1,
  );
  await reportIsConsistent();
});

// --------------------------------------------- database-enforced invariants

test('database: receipts are immutable facts with guarded transitions', async () => {
  const job = await cashJob();
  const receipt = await collected(job);
  const id = receipt.receiptId;
  await rejected(
    [[`DELETE FROM app.cash_receipt WHERE id = $1`, [id]]],
    /BILLING_APPEND_ONLY|permission denied/,
  );
  await rejected(
    [
      [
        `UPDATE app.cash_receipt SET amount_minor = amount_minor + 1, revision = revision + 1 WHERE id = $1`,
        [id],
      ],
    ],
    /CASH_RECEIPT_IMMUTABLE_FIELD/,
  );
  await rejected(
    [
      [
        `UPDATE app.cash_receipt SET custody_status = 'REVERSED', active_slot = NULL, revision = revision + 1 WHERE id = $1`,
        [id],
      ],
    ],
    /CASH_RECEIPT_INVALID_TRANSITION/,
  );
  await rejected(
    [
      [
        `UPDATE app.billing_obligation SET status = 'OPEN', verified_minor = 0, revision = revision + 1 WHERE id = $1`,
        [job.obligationId],
      ],
    ],
    /BILLING_OBLIGATION_TERMINAL/,
  );
  await rejected(['TRUNCATE app.cash_receipt CASCADE'], /BILLING_APPEND_ONLY|permission denied/);
  const fresh = await cashJob();
  await rejected(
    [
      [
        `INSERT INTO app.cash_receipt (id, obligation_id, intent_id, booking_id, assignment_id, assignment_revision,
           collector_subject, currency, amount_minor, custody_status, active_slot, revision, collected_at, updated_at, correlation_id)
         SELECT gen_random_uuid(), i.obligation_id, i.id, gen_random_uuid(), gen_random_uuid(), 1, $2, 'SYP', 1, 'HELD', 1, 1, now(), now(), gen_random_uuid()
           FROM app.payment_intent i WHERE i.obligation_id = $1 AND i.active_slot = 1`,
        [fresh.obligationId, SUBJECTS.technician],
      ],
    ],
    /CASH_RECEIPT_INCONSISTENT/,
  );
});

test('database: a stray journal or a custody edit without its fact never commits', async () => {
  const job = await cashJob();
  await collected(job);
  const journal = randomUUID();
  await rejected(
    [
      [
        `INSERT INTO app.ledger_journal (id, kind, business_ref, obligation_id, posted_at, correlation_id)
         VALUES ($1, 'CASH_COLLECTED', $2, $3, now(), gen_random_uuid())`,
        [journal, `receipt:${randomUUID()}:collected`, job.obligationId],
      ],
      [
        `INSERT INTO app.ledger_line (journal_id, line_no, account, side, currency, amount_minor, holder_subject)
         VALUES ($1, 0, 'CASH_IN_CUSTODY', 'DEBIT', 'SYP', 100, $2), ($1, 1, 'CUSTOMER_RECEIVABLE', 'CREDIT', 'SYP', 100, NULL)`,
        [journal, SUBJECTS.technician],
      ],
    ],
    /LEDGER_MISMATCH/,
  );
  await rejected(
    [
      [
        `INSERT INTO app.ledger_journal (id, kind, business_ref, obligation_id, posted_at, correlation_id)
         VALUES ($1, 'CASH_COLLECTED', $2, $3, now(), gen_random_uuid())`,
        [journal, `receipt:${randomUUID()}:collected`, job.obligationId],
      ],
      [
        `INSERT INTO app.ledger_line (journal_id, line_no, account, side, currency, amount_minor, holder_subject)
         VALUES ($1, 0, 'CASH_IN_CUSTODY', 'DEBIT', 'SYP', 100, NULL), ($1, 1, 'CUSTOMER_RECEIVABLE', 'CREDIT', 'SYP', 100, NULL)`,
        [journal],
      ],
    ],
    /ledger_line_holder/,
  );
});

test('database: received counts are immutable and separation of duties is a CHECK', async () => {
  const job = await cashJob();
  const receipt = await collected(job);
  const declared = await declare([receipt.receiptId], job.amount);
  const id = declared.body.handoverId;
  assert.equal((await receive(id, 1, job.amount)).status, 200);
  await rejected(
    [
      [
        `UPDATE app.custody_handover SET counted_minor = counted_minor + 1, overage_minor = 1, revision = revision + 1 WHERE id = $1`,
        [id],
      ],
    ],
    /CUSTODY_HANDOVER_IMMUTABLE_FIELD/,
  );
  await rejected(
    [
      [
        `UPDATE app.custody_handover SET status = 'RECONCILED', settlement_reference = 'SELF1234',
            reconciled_by_subject = received_by_subject, reconciled_at = now(), revision = revision + 1 WHERE id = $1`,
        [id],
      ],
    ],
    /custody_handover_separation/,
  );
  await rejected(
    [[`DELETE FROM app.custody_handover_item WHERE handover_id = $1`, [id]]],
    /BILLING_APPEND_ONLY|permission denied/,
  );
});

test('reconciliation report: Billing facts agree across holders, receipts and treasury', async () => {
  const report = await reportIsConsistent();
  assert.ok(Number(report.holdersChecked) >= 2);
  assert.equal(report.receiptsWithoutSettledObligation, 0);
  assert.equal(report.cashSettlementsWithoutReceipt, 0);
  assert.equal((await get('/custody/reconciliation', TOKENS.technician)).status, 403);
  assert.equal(
    (await get(`/custody/holders/${SUBJECTS.technician}`, TOKENS.technician)).status,
    403,
  );
  assert.equal((await get('/custody/holders/me', TOKENS.customer)).status, 403);
});
