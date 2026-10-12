import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { parseEnvelopeV2 } from '@carwash/event-contracts';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaBillingRepository } from '../../src/infrastructure/persistence/prisma-billing.repository';
import {
  parseObligationCreatedData,
  parseObligationStatusChangedData,
} from '../../src/application';
import { FixedClock, SESSIONS, SUBJECTS, TOKENS } from '../support/billing-http-harness';
import {
  WORKLOADS,
  startBookingSagaHttp,
  startValidateStub,
  type BookingSagaHttp,
  type ValidateStub,
} from '../support/booking-saga-harness';
import {
  startIdentityStub,
  startPricingStub,
  type PricingStub,
  type Stub,
} from '../support/upstream-stubs';

/*
 * REAL PostgreSQL evidence for the billing.v1 booking-saga routes, run as the
 * least-privileged runtime role (cw_billing_app) on a database migrated by
 * cw_billing_migrate through scripts/production/B/postgres-acceptance.mjs
 * --service billing. Two replicas (separate pools) share the database to prove
 * concurrency. Identity and Pricing (getQuote, validateQuote) are local HTTP
 * test doubles; RabbitMQ is not used (outbox rows are asserted, the relay is
 * not started). No skip: missing configuration fails the run.
 */
const APP_URL = process.env.BILLING_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('BILLING_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;
const PATH = '/internal/v1/billing';
const BENEFICIARY = { kind: 'account', subjectId: SUBJECTS.customer } as const;

let prismaA: PrismaService;
let prismaB: PrismaService;
let identity: Stub;
let pricing: PricingStub;
let validate: ValidateStub;
let replicaA: BookingSagaHttp;
let replicaB: BookingSagaHttp;
let sql: Client;
let seq = 0;
const key = () => `pg-saga-key-${String(++seq).padStart(6, '0')}-${process.pid}`;

before(async () => {
  const clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  identity = await startIdentityStub(SESSIONS);
  pricing = await startPricingStub();
  validate = await startValidateStub();
  prismaA = new PrismaService(DATABASE_URL);
  prismaB = new PrismaService(DATABASE_URL);
  replicaA = await startBookingSagaHttp({
    repository: new PrismaBillingRepository(prismaA),
    clock,
    identity,
    pricing,
    validate,
  });
  replicaB = await startBookingSagaHttp({
    repository: new PrismaBillingRepository(prismaB),
    clock,
    identity,
    pricing,
    validate,
  });
  sql = new Client({ connectionString: DATABASE_URL.replace(/\?schema=app$/, '') });
  await sql.connect();
});

after(async () => {
  await replicaA?.close();
  await replicaB?.close();
  await prismaA?.onModuleDestroy();
  await prismaB?.onModuleDestroy();
  await identity?.close();
  await pricing?.close();
  await validate?.close();
  await sql?.end();
});

// ---------------------------------------------------------------- helpers

const code = (body: Record<string, unknown>) =>
  (body.error as { code?: unknown } | undefined)?.code;

function quote(
  overrides: Partial<{ total: string; status: 'USABLE' | 'EXPIRED'; revision: number }> = {},
) {
  const id = randomUUID();
  validate.quotes.set(id, {
    beneficiary: BENEFICIARY,
    status: overrides.status ?? 'USABLE',
    revision: overrides.revision ?? 1,
    currency: 'SYP',
    totalMinor: overrides.total ?? '150000',
  });
  return id;
}

function create(
  body: { quoteId: string; bookingId: string; beneficiary?: unknown },
  options: {
    key?: string;
    replica?: BookingSagaHttp;
    workload?: { clientId: string; token: string };
  } = {},
) {
  return (options.replica ?? replicaA).request('POST', `${PATH}/booking-obligations`, {
    workload: options.workload ?? WORKLOADS.booking,
    key: options.key ?? key(),
    body: {
      beneficiary: body.beneficiary ?? BENEFICIARY,
      quoteId: body.quoteId,
      bookingId: body.bookingId,
    },
  });
}

function voidIt(
  obligationId: unknown,
  expectedRevision: number,
  options: {
    key?: string;
    replica?: BookingSagaHttp;
    workload?: { clientId: string; token: string };
  } = {},
) {
  return (options.replica ?? replicaA).request(
    'POST',
    `${PATH}/booking-obligations/${String(obligationId)}/void`,
    {
      workload: options.workload ?? WORKLOADS.booking,
      key: options.key ?? key(),
      body: { expectedRevision },
    },
  );
}

async function created(total = '150000') {
  const bookingId = randomUUID();
  const quoteId = quote({ total });
  const reply = await create({ quoteId, bookingId });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return { bookingId, quoteId, obligation: reply.body };
}

async function rows(statement: string, values: unknown[]) {
  return (await sql.query(statement, values)).rows as Record<string, unknown>[];
}

async function outbox(obligationId: string) {
  const found = await rows(
    `SELECT event_type, payload FROM app.outbox_message
      WHERE payload::jsonb #>> '{aggregate,id}' = $1
      ORDER BY (payload::jsonb #>> '{aggregate,version}')::int`,
    [obligationId],
  );
  return found.map((row) => ({ type: String(row.event_type), payload: String(row.payload) }));
}

const OBLIGATION_EVENT = { producer: 'billing', aggregateType: 'billing-obligation' } as const;

// ------------------------------------------------------------------ create

test('create: 201 ObligationV1 for the beneficiary, Pricing total, link + journal + audit + outbox in one transaction', async () => {
  const { bookingId, quoteId, obligation } = await created('175000');
  const id = String(obligation.obligationId);
  assert.equal(obligation.quoteId, quoteId);
  assert.equal(obligation.status, 'OPEN');
  assert.equal(obligation.financialStatus, 'UNPAID');
  assert.equal(obligation.revision, 1);
  assert.deepEqual(obligation.amount, { currency: 'SYP', amountMinor: '175000', scale: 2 });
  assert.deepEqual(obligation.outstanding, { currency: 'SYP', amountMinor: '175000', scale: 2 });
  const [row] = await rows(
    `SELECT o.owner_kind, o.owner_subject::text, l.booking_id::text, l.client_id, l.voided_at
       FROM app.billing_obligation o JOIN app.booking_obligation l ON l.obligation_id = o.id
      WHERE o.id = $1`,
    [id],
  );
  assert.deepEqual(row, {
    owner_kind: 'account',
    owner_subject: SUBJECTS.customer,
    booking_id: bookingId,
    client_id: 'booking',
    voided_at: null,
  });
  const journals = await rows(`SELECT kind FROM app.ledger_journal WHERE obligation_id = $1`, [id]);
  assert.deepEqual(journals, [{ kind: 'OBLIGATION_BILLED' }]);
  const audit = await rows(
    `SELECT action, actor_subject::text, outcome FROM app.billing_audit_event WHERE obligation_id = $1`,
    [id],
  );
  assert.deepEqual(audit, [
    { action: 'billing.obligation.created', actor_subject: SUBJECTS.customer, outcome: 'OPEN' },
  ]);
  const events = await outbox(id);
  assert.deepEqual(
    events.map((event) => event.type),
    ['billing.obligation-created.v1'],
  );
  const data = parseEnvelopeV2(
    JSON.parse(events[0]?.payload ?? '{}'),
    { ...OBLIGATION_EVENT, eventType: 'billing.obligation-created.v1' },
    parseObligationCreatedData,
  ).data;
  assert.equal(data.quoteId, quoteId);
  assert.equal(data.amount.amountMinor, '175000');
  // The beneficiary created by the saga can read its own obligation.
  const read = await replicaA.request('GET', `${PATH}/obligations/${id}`, {
    token: TOKENS.customer,
  });
  assert.equal(read.status, 200);
  const stranger = await replicaA.request('GET', `${PATH}/obligations/${id}`, {
    token: TOKENS.otherCustomer,
  });
  assert.equal(stranger.status, 404);
});

test('create: same key replays (no second obligation, no Pricing call); same key with another body is 409', async () => {
  const bookingId = randomUUID();
  const quoteId = quote();
  const k = key();
  const first = await create({ quoteId, bookingId }, { key: k });
  assert.equal(first.status, 201);
  const calls = validate.calls.length;
  const again = await create({ quoteId, bookingId }, { key: k, replica: replicaB });
  assert.equal(again.status, 201);
  assert.equal(again.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(again.body, first.body);
  assert.equal(validate.calls.length, calls);
  const conflict = await create({ quoteId: quote(), bookingId }, { key: k });
  assert.equal(conflict.status, 409);
  assert.equal(code(conflict.body), 'IDEMPOTENCY_CONFLICT');
  const [count] = await rows(
    `SELECT count(*)::int AS n FROM app.booking_obligation WHERE booking_id = $1`,
    [bookingId],
  );
  assert.equal(count?.n, 1);
});

test('create: a new key for the same booking returns its obligation (200) without Pricing, even after the quote expired', async () => {
  const { bookingId, quoteId, obligation } = await created();
  validate.quotes.set(quoteId, { ...validate.quotes.get(quoteId)!, status: 'EXPIRED' });
  const calls = validate.calls.length;
  const retry = await create({ quoteId, bookingId });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.obligationId, obligation.obligationId);
  assert.equal(validate.calls.length, calls);
});

test('create: the same booking with another quote, beneficiary or workload is 409 OBLIGATION_ALREADY_EXISTS', async () => {
  const { bookingId, quoteId } = await created();
  const otherQuote = await create({ quoteId: quote(), bookingId });
  assert.equal(otherQuote.status, 409);
  assert.equal(code(otherQuote.body), 'OBLIGATION_ALREADY_EXISTS');
  const otherBeneficiary = await create({
    quoteId,
    bookingId,
    beneficiary: { kind: 'account', subjectId: SUBJECTS.otherCustomer },
  });
  assert.equal(otherBeneficiary.status, 409);
  const otherWorkload = await create({ quoteId, bookingId }, { workload: WORKLOADS.other });
  assert.equal(otherWorkload.status, 409);
});

test('create: a quote already obligated (customer route or another booking) cannot be adopted', async () => {
  const { quoteId } = await created();
  const reply = await create({ quoteId, bookingId: randomUUID() });
  assert.equal(reply.status, 409);
  assert.equal(code(reply.body), 'OBLIGATION_ALREADY_EXISTS');
});

test('create: an unusable quote is 409 and Pricing outage is 503; nothing is written', async () => {
  const bookingId = randomUUID();
  const expired = await create({ quoteId: quote({ status: 'EXPIRED' }), bookingId });
  assert.equal(expired.status, 409);
  assert.equal(code(expired.body), 'QUOTE_NOT_USABLE');
  const foreign = await create({
    quoteId: quote(),
    bookingId,
    beneficiary: { kind: 'guest', subjectId: SUBJECTS.guest },
  });
  assert.equal(foreign.status, 409);
  validate.mode = 'error-500';
  const down = await create({ quoteId: quote(), bookingId });
  validate.mode = 'hang';
  const hung = await create({ quoteId: quote(), bookingId });
  validate.mode = 'normal';
  assert.equal(down.status, 503);
  assert.equal(code(down.body), 'UPSTREAM_UNAVAILABLE');
  assert.equal(hung.status, 503);
  const [count] = await rows(
    `SELECT count(*)::int AS n FROM app.booking_obligation WHERE booking_id = $1`,
    [bookingId],
  );
  assert.equal(count?.n, 0);
  // The booking can still be obligated once Pricing answers.
  const ok = await create({ quoteId: quote(), bookingId });
  assert.equal(ok.status, 201);
});

test('create: a quote at a later revision is validated at the revision Pricing names', async () => {
  const reply = await create({
    quoteId: quote({ revision: 2, total: '90000' }),
    bookingId: randomUUID(),
  });
  assert.equal(reply.status, 201);
  assert.deepEqual(reply.body.amount, { currency: 'SYP', amountMinor: '90000', scale: 2 });
});

test('race: the same key on two replicas creates exactly one obligation; the loser replays it', async () => {
  for (let round = 0; round < 5; round++) {
    const bookingId = randomUUID();
    const quoteId = quote();
    const k = key();
    const replies = await Promise.all([
      create({ quoteId, bookingId }, { key: k, replica: replicaA }),
      create({ quoteId, bookingId }, { key: k, replica: replicaB }),
    ]);
    assert.deepEqual(
      replies.map((reply) => reply.status),
      [201, 201],
    );
    assert.equal(replies[0]?.body.obligationId, replies[1]?.body.obligationId);
    const [count] = await rows(
      `SELECT count(*)::int AS n FROM app.billing_obligation WHERE quote_id = $1`,
      [quoteId],
    );
    assert.equal(count?.n, 1);
  }
});

test('race: different keys for the same booking create exactly one obligation; both callers get it', async () => {
  for (let round = 0; round < 5; round++) {
    const bookingId = randomUUID();
    const quoteId = quote();
    const replies = await Promise.all([
      create({ quoteId, bookingId }, { replica: replicaA }),
      create({ quoteId, bookingId }, { replica: replicaB }),
    ]);
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 201]);
    assert.equal(replies[0]?.body.obligationId, replies[1]?.body.obligationId);
    const [count] = await rows(
      `SELECT count(*)::int AS n FROM app.booking_obligation WHERE booking_id = $1`,
      [bookingId],
    );
    assert.equal(count?.n, 1);
  }
});

// -------------------------------------------------------------------- void

test('void: 200 VOIDED with journal, link stamp, audit and status-changed event; replay is exact', async () => {
  const { obligation } = await created();
  const id = String(obligation.obligationId);
  const k = key();
  const voided = await voidIt(id, 1, { key: k });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(voided.body.status, 'VOIDED');
  assert.equal(voided.body.financialStatus, 'VOIDED');
  assert.equal(voided.body.revision, 2);
  const replay = await voidIt(id, 1, { key: k, replica: replicaB });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  const [link] = await rows(
    `SELECT voided_at IS NOT NULL AS voided FROM app.booking_obligation WHERE obligation_id = $1`,
    [id],
  );
  assert.equal(link?.voided, true);
  const journals = await rows(
    `SELECT kind FROM app.ledger_journal WHERE obligation_id = $1 ORDER BY kind`,
    [id],
  );
  assert.deepEqual(journals, [{ kind: 'OBLIGATION_BILLED' }, { kind: 'OBLIGATION_VOIDED' }]);
  const events = await outbox(id);
  assert.deepEqual(
    events.map((event) => event.type),
    ['billing.obligation-created.v1', 'billing.obligation-status-changed.v1'],
  );
  const change = parseEnvelopeV2(
    JSON.parse(events[1]?.payload ?? '{}'),
    { ...OBLIGATION_EVENT, eventType: 'billing.obligation-status-changed.v1' },
    parseObligationStatusChangedData,
  ).data;
  assert.equal(change.previousFinancialStatus, 'UNPAID');
  assert.equal(change.financialStatus, 'VOIDED');
  // A second, different void command on a voided obligation is refused.
  const again = await voidIt(id, 2);
  assert.equal(again.status, 409);
  assert.equal(code(again.body), 'OBLIGATION_VOIDED');
});

test('void: another workload, a customer obligation and an unknown id are 404; a stale revision is 412', async () => {
  const { obligation } = await created();
  const id = String(obligation.obligationId);
  const other = await voidIt(id, 1, { workload: WORKLOADS.other });
  assert.equal(other.status, 404);
  assert.equal((await voidIt(randomUUID(), 1)).status, 404);
  const stale = await voidIt(id, 7);
  assert.equal(stale.status, 412);
  // An obligation the customer created directly is not a booking obligation.
  const quoteId = randomUUID();
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: '120000',
  });
  const direct = await replicaA.request('POST', `${PATH}/obligations`, {
    token: TOKENS.customer,
    key: key(),
    body: { quoteId },
  });
  assert.equal(direct.status, 201, JSON.stringify(direct.body));
  assert.equal((await voidIt(direct.body.obligationId, 1)).status, 404);
});

test('void: the customer cannot void a booking obligation through the customer route', async () => {
  const { obligation } = await created();
  const reply = await replicaA.request(
    'POST',
    `${PATH}/obligations/${String(obligation.obligationId)}/void`,
    { token: TOKENS.customer, key: key(), body: { expectedRevision: 1 } },
  );
  assert.equal(reply.status, 409);
  assert.equal(code(reply.body), 'VOID_NOT_ALLOWED');
});

test('void: after a payment was reported the obligation cannot be voided', async () => {
  const { obligation } = await created();
  const id = String(obligation.obligationId);
  const intent = await replicaA.request('POST', `${PATH}/obligations/${id}/payment-intents`, {
    token: TOKENS.customer,
    key: key(),
    body: { expectedRevision: 1, method: 'SHAM_CASH' },
  });
  assert.equal(intent.status, 201, JSON.stringify(intent.body));
  const attempt = await replicaA.request('POST', `${PATH}/obligations/${id}/payment-attempts`, {
    token: TOKENS.customer,
    key: key(),
    body: { expectedRevision: 2, providerReference: `SAGA${Date.now()}${seq}` },
  });
  assert.equal(attempt.status, 202, JSON.stringify(attempt.body));
  const reply = await voidIt(id, 3);
  assert.equal(reply.status, 409);
  assert.equal(code(reply.body), 'VOID_NOT_ALLOWED');
});

test('race: saga void vs customer payment report on the same revision; exactly one wins', async () => {
  for (let round = 0; round < 5; round++) {
    const { obligation } = await created();
    const id = String(obligation.obligationId);
    const intent = await replicaA.request('POST', `${PATH}/obligations/${id}/payment-intents`, {
      token: TOKENS.customer,
      key: key(),
      body: { expectedRevision: 1, method: 'SYRIATEL_CASH' },
    });
    assert.equal(intent.status, 201);
    const [voided, reported] = await Promise.all([
      voidIt(id, 2, { replica: replicaA }),
      replicaB.request('POST', `${PATH}/obligations/${id}/payment-attempts`, {
        token: TOKENS.customer,
        key: key(),
        body: { expectedRevision: 2, providerReference: `RACE${round}${Date.now()}` },
      }),
    ]);
    const wins = [voided.status === 200, reported.status === 202].filter(Boolean).length;
    assert.equal(wins, 1, `void ${voided.status} report ${reported.status}`);
    assert.ok([409, 412].includes(voided.status === 200 ? reported.status : voided.status));
    const [state] = await rows(
      `SELECT o.status, (SELECT count(*)::int FROM app.payment_attempt a WHERE a.obligation_id = o.id) AS attempts,
              l.voided_at IS NOT NULL AS link_voided
         FROM app.billing_obligation o JOIN app.booking_obligation l ON l.obligation_id = o.id
        WHERE o.id = $1`,
      [id],
    );
    if (voided.status === 200)
      assert.deepEqual(state, { status: 'VOIDED', attempts: 0, link_voided: true });
    else assert.deepEqual(state, { status: 'OPEN', attempts: 1, link_voided: false });
  }
});

test('race: two saga voids with different keys; exactly one applies', async () => {
  const { obligation } = await created();
  const id = String(obligation.obligationId);
  const replies = await Promise.all([
    voidIt(id, 1, { replica: replicaA }),
    voidIt(id, 1, { replica: replicaB }),
  ]);
  const statuses = replies.map((reply) => reply.status).sort();
  assert.equal(statuses[0], 200);
  assert.ok([409, 412].includes(statuses[1] ?? 0), JSON.stringify(statuses));
  const journals = await rows(
    `SELECT count(*)::int AS n FROM app.ledger_journal WHERE obligation_id = $1 AND kind = 'OBLIGATION_VOIDED'`,
    [id],
  );
  assert.equal(journals[0]?.n, 1);
});

// ------------------------------------------------------- database guards

test('database: the runtime role cannot rewrite, delete or adopt a booking link', async () => {
  const { bookingId } = await created();
  await assert.rejects(
    sql.query(`UPDATE app.booking_obligation SET client_id = 'dispatch' WHERE booking_id = $1`, [
      bookingId,
    ]),
    /BOOKING_LINK_IMMUTABLE_FIELD/,
  );
  await assert.rejects(
    sql.query(
      `UPDATE app.booking_obligation SET voided_at = now(), voided_correlation_id = $2 WHERE booking_id = $1`,
      [bookingId, randomUUID()],
    ),
    /BOOKING_LINK_INVALID_TRANSITION/,
  );
  await assert.rejects(
    sql.query(`DELETE FROM app.booking_obligation WHERE booking_id = $1`, [bookingId]),
    /BILLING_APPEND_ONLY/,
  );
  // An obligation committed earlier can never be linked to another booking.
  const { obligation: other } = await created();
  await assert.rejects(
    sql.query(
      `INSERT INTO app.booking_obligation (booking_id, obligation_id, client_id, created_at, created_correlation_id)
       VALUES ($1, $2, 'booking', now(), $3)`,
      [randomUUID(), String(other.obligationId), randomUUID()],
    ),
    /BOOKING_LINK_INVALID_INSERT|booking_obligation_obligation_id_key/,
  );
});
