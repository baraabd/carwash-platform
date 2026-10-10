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
import { acceptanceProviders, approvedStatement } from '../support/provider-flows';

/*
 * REAL PostgreSQL evidence, run as the least-privileged runtime role
 * (cw_billing_app) on a database migrated by cw_billing_migrate through
 * scripts/production/B/postgres-acceptance.mjs --service billing.
 * Two replicas (separate pools) share the database to prove concurrency.
 * Identity and Pricing are local HTTP test doubles (real cross-service
 * acceptance is pending on Lane E). RabbitMQ is not used: the relay is not
 * started until E registers the billing events. No skip: missing configuration
 * fails the run.
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
let replicaA: BillingHttpHarness;
let replicaB: BillingHttpHarness;
let sql: Client;
let seq = 0;
const key = () => `pg-billing-key-${String(++seq).padStart(6, '0')}-${process.pid}`;

before(async () => {
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  identity = await startIdentityStub(SESSIONS);
  pricing = await startPricingStub();
  prismaA = new PrismaService(DATABASE_URL);
  prismaB = new PrismaService(DATABASE_URL);
  replicaA = await startBillingHttp({
    repository: new PrismaBillingRepository(prismaA),
    clock,
    identity,
    pricing,
    providers: acceptanceProviders(),
  });
  replicaB = await startBillingHttp({
    repository: new PrismaBillingRepository(prismaB),
    clock,
    identity,
    pricing,
    providers: acceptanceProviders(),
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
  await sql?.end();
});

// ---------------------------------------------------------------- helpers

function quote(
  overrides: Partial<{
    owner: string;
    total: string;
    status: 'USABLE' | 'EXPIRED' | 'REVOKED';
    currency: 'SYP' | 'USD';
  }> = {},
): string {
  const id = randomUUID();
  pricing.quotes.set(id, {
    ownerToken: overrides.owner ?? 'customer',
    status: overrides.status ?? 'USABLE',
    currency: overrides.currency ?? 'SYP',
    totalMinor: overrides.total ?? '150000',
  });
  return id;
}

const tokenOf = (owner: string): string =>
  ({ customer: TOKENS.customer, guest: TOKENS.guest, 'other-customer': TOKENS.otherCustomer })[
    owner
  ] ?? TOKENS.unknown;

function create(
  quoteId: string,
  options: { token?: string; key?: string; replica?: BillingHttpHarness } = {},
) {
  return (options.replica ?? replicaA).request('POST', `${PATH}/obligations`, {
    token: options.token ?? TOKENS.customer,
    key: options.key ?? key(),
    body: { quoteId },
  });
}

async function created(owner = 'customer', total = '150000'): Promise<Record<string, unknown>> {
  const response = await create(quote({ owner, total }), { token: tokenOf(owner) });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

function initialize(
  id: unknown,
  expectedRevision: number,
  method: string,
  options: { token?: string; key?: string; replica?: BillingHttpHarness } = {},
) {
  return (options.replica ?? replicaA).request(
    'POST',
    `${PATH}/obligations/${String(id)}/payment-intents`,
    {
      token: options.token ?? TOKENS.customer,
      key: options.key ?? key(),
      body: { expectedRevision, method },
    },
  );
}

function submit(
  id: unknown,
  expectedRevision: number,
  providerReference: string,
  options: { token?: string; key?: string; replica?: BillingHttpHarness } = {},
) {
  return (options.replica ?? replicaA).request(
    'POST',
    `${PATH}/obligations/${String(id)}/payment-attempts`,
    {
      token: options.token ?? TOKENS.customer,
      key: options.key ?? key(),
      body: { expectedRevision, providerReference },
    },
  );
}

function reconcile(
  attemptId: unknown,
  expectedRevision: number,
  outcome: string,
  observedAmount: unknown,
  options: { token?: string; key?: string; replica?: BillingHttpHarness } = {},
) {
  return (options.replica ?? replicaA).request(
    'POST',
    `${PATH}/payment-attempts/${String(attemptId)}/reconciliation`,
    {
      token: options.token ?? TOKENS.reconciler,
      key: options.key ?? key(),
      body: { expectedRevision, outcome, observedAmount },
    },
  );
}

function voidIt(
  id: unknown,
  expectedRevision: number,
  options: { token?: string; key?: string } = {},
) {
  return replicaA.request('POST', `${PATH}/obligations/${String(id)}/void`, {
    token: options.token ?? TOKENS.customer,
    key: options.key ?? key(),
    body: { expectedRevision },
  });
}

const errorCode = (reply: HttpReply): unknown =>
  (reply.body.error as { code?: unknown } | undefined)?.code;
const reference = () => `TX-${randomUUID().slice(0, 8)}-${String(++seq)}`.toUpperCase();
const syp = (amountMinor: string) => ({ currency: 'SYP', amountMinor, scale: 2 });

async function count(table: string, where: string, values: unknown[]): Promise<number> {
  const result = await sql.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM app.${table} WHERE ${where}`,
    values,
  );
  return Number(result.rows[0]?.n);
}

/** Receivable (debit - credit) booked against one obligation. */
async function receivable(obligationId: unknown): Promise<string> {
  const result = await sql.query<{ net: string }>(
    `SELECT COALESCE(SUM(CASE l.side WHEN 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END), 0)::text AS net
       FROM app.ledger_line l JOIN app.ledger_journal j ON j.id = l.journal_id
      WHERE j.obligation_id = $1 AND l.account = 'CUSTOMER_RECEIVABLE'`,
    [obligationId],
  );
  return result.rows[0]?.net ?? 'missing';
}

/** Runs statements in one transaction and expects the COMMIT (or a statement) to fail. */
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

// ---------------------------------------------------------------- creation

test('create: the obligation books a receivable only; no money is received', async () => {
  const quoteId = quote({ total: '150000' });
  const response = await create(quoteId);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const body = response.body;
  assert.equal(body.status, 'OPEN');
  assert.equal(body.financialStatus, 'UNPAID');
  assert.equal(body.revision, 1);
  assert.equal(body.quoteId, quoteId);
  assert.deepEqual(body.amount, syp('150000'));
  assert.deepEqual(body.verified, syp('0'));
  assert.deepEqual(body.outstanding, syp('150000'));
  assert.equal(body.activeIntent, null);
  assert.equal(await receivable(body.obligationId), '150000');
  assert.equal(
    await count('ledger_journal', "obligation_id = $1 AND kind = 'OBLIGATION_BILLED'", [
      body.obligationId,
    ]),
    1,
  );
  assert.equal(
    await count(
      'billing_audit_event',
      "obligation_id = $1 AND action = 'billing.obligation.created'",
      [body.obligationId],
    ),
    1,
  );
  const outbox = await sql.query<{
    payload: string;
    event_type: string;
    published_at: Date | null;
  }>(
    "SELECT payload, event_type, published_at FROM app.outbox_message WHERE payload::jsonb #>> '{aggregate,id}' = $1",
    [body.obligationId],
  );
  assert.equal(outbox.rowCount, 1);
  const row = outbox.rows[0];
  assert.equal(row?.event_type, 'billing.obligation-created.v1');
  assert.equal(row?.published_at, null, 'the relay is not started until E registers the event');
  const envelope = parseEnvelopeV2(
    JSON.parse(row?.payload ?? '{}'),
    {
      eventType: 'billing.obligation-created.v1',
      producer: 'billing',
      aggregateType: 'billing-obligation',
    },
    parseObligationCreatedData,
  );
  assert.deepEqual(envelope.actor, { kind: 'account', id: SUBJECTS.customer });
  assert.equal(envelope.data.financialStatus, 'UNPAID');
});

test('create: amounts beyond 2^53 are stored and returned exactly', async () => {
  const body = await created('customer', '450000000000035001');
  assert.deepEqual(body.amount, syp('450000000000035001'));
  const stored = await sql.query<{ amount: string }>(
    'SELECT amount_minor::text AS amount FROM app.billing_obligation WHERE id = $1',
    [body.obligationId],
  );
  assert.equal(stored.rows[0]?.amount, '450000000000035001');
});

test('create: guest principals own obligations as guests', async () => {
  const body = await created('guest');
  const stored = await sql.query<{ kind: string; subject: string }>(
    'SELECT owner_kind AS kind, owner_subject::text AS subject FROM app.billing_obligation WHERE id = $1',
    [body.obligationId],
  );
  assert.deepEqual(stored.rows[0], { kind: 'guest', subject: SUBJECTS.guest });
  const other = await replicaA.request('GET', `${PATH}/obligations/${String(body.obligationId)}`, {
    token: TOKENS.customer,
  });
  assert.equal(other.status, 404, 'an account never reads a guest obligation');
});

test('create: same key + same request replays; same key + different request conflicts', async () => {
  const quoteId = quote();
  const k = key();
  const first = await create(quoteId, { key: k });
  const replay = await create(quoteId, { key: k, replica: replicaB });
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(replay.body, first.body);
  assert.equal(await count('billing_obligation', 'quote_id = $1', [quoteId]), 1);
  const conflict = await create(quote(), { key: k });
  assert.equal(conflict.status, 409);
  assert.equal(errorCode(conflict), 'IDEMPOTENCY_CONFLICT');
});

test('create race: the same key on two replicas yields one obligation and one outcome', async () => {
  const quoteId = quote();
  const k = key();
  const results = await Promise.all([
    create(quoteId, { key: k, replica: replicaA }),
    create(quoteId, { key: k, replica: replicaB }),
    create(quoteId, { key: k, replica: replicaA }),
  ]);
  for (const result of results) assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(new Set(results.map((r) => r.body.obligationId)).size, 1);
  assert.equal(await count('billing_obligation', 'quote_id = $1', [quoteId]), 1);
  assert.equal(
    await count('ledger_journal', 'obligation_id = $1', [results[0]?.body.obligationId]),
    1,
  );
});

test('create race: different keys for one quote produce exactly one obligation', async () => {
  const quoteId = quote();
  const results = await Promise.all([
    create(quoteId, { replica: replicaA }),
    create(quoteId, { replica: replicaB }),
    create(quoteId, { replica: replicaA }),
    create(quoteId, { replica: replicaB }),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 200, 201], JSON.stringify(results.map((r) => r.body)));
  assert.equal(new Set(results.map((r) => r.body.obligationId)).size, 1, 'losers get the winner');
  assert.equal(await count('billing_obligation', 'quote_id = $1', [quoteId]), 1);
  assert.equal(
    await count('ledger_journal', 'obligation_id = $1', [results[0]?.body.obligationId]),
    1,
  );
  const later = await create(quoteId);
  assert.equal(later.status, 200, 'creating again returns the existing obligation');
  assert.equal(later.body.obligationId, results[0]?.body.obligationId);
});

test('create: Pricing decides existence, ownership, usability and amount (fail closed)', async () => {
  const notMine = await create(quote({ owner: 'other-customer' }));
  assert.equal(notMine.status, 404);
  const expired = await create(quote({ status: 'EXPIRED' }));
  assert.equal(expired.status, 409);
  assert.equal(errorCode(expired), 'QUOTE_NOT_USABLE');
  const zero = await create(quote({ total: '0' }));
  assert.equal(zero.status, 422);
  assert.equal(errorCode(zero), 'AMOUNT_INVALID');
  const quoteId = quote();
  const k = key();
  pricing.mode = 'hang';
  try {
    const down = await create(quoteId, { key: k });
    assert.equal(down.status, 503);
    assert.equal(errorCode(down), 'UPSTREAM_UNAVAILABLE');
  } finally {
    pricing.mode = 'normal';
  }
  assert.equal(
    await count('billing_obligation', 'quote_id = $1', [quoteId]),
    0,
    'a timeout is never success',
  );
  const retry = await create(quoteId, { key: k });
  assert.equal(retry.status, 201, 'no receipt was stored, so the same key retries safely');
});

test('create: authentication and permission are verified with Identity on every call', async () => {
  const quoteId = quote();
  assert.equal(
    (await replicaA.request('POST', `${PATH}/obligations`, { key: key(), body: { quoteId } }))
      .status,
    401,
  );
  assert.equal((await create(quoteId, { token: TOKENS.unknown })).status, 401);
  assert.equal((await create(quoteId, { token: TOKENS.finance })).status, 403);
  identity.mode = 'error-500';
  try {
    const down = await create(quoteId);
    assert.equal(down.status, 503);
    assert.equal(errorCode(down), 'AUTH_UNAVAILABLE');
  } finally {
    identity.mode = 'normal';
  }
  const invalidKey = await replicaA.request('POST', `${PATH}/obligations`, {
    token: TOKENS.customer,
    key: 'short',
    body: { quoteId },
  });
  assert.equal(errorCode(invalidKey), 'IDEMPOTENCY_KEY_INVALID');
  const clientAmount = await replicaA.request('POST', `${PATH}/obligations`, {
    token: TOKENS.customer,
    key: key(),
    body: { quoteId, amount: syp('1') },
  });
  assert.equal(clientAmount.status, 400, 'a client-supplied amount is never accepted');
  assert.equal(await count('billing_obligation', 'quote_id = $1', [quoteId]), 0);
});

// ---------------------------------------------------------------- intents

test('initialize: choosing a method never records money; cash awaits collection', async () => {
  const body = await created();
  const sham = await initialize(body.obligationId, 1, 'SHAM_CASH');
  assert.equal(sham.status, 201, JSON.stringify(sham.body));
  assert.equal(sham.body.financialStatus, 'AWAITING_PAYMENT');
  assert.equal(sham.body.revision, 2);
  assert.deepEqual(sham.body.verified, syp('0'));
  const intent = sham.body.activeIntent as { method: string; status: string; amount: unknown };
  assert.deepEqual([intent.method, intent.status], ['SHAM_CASH', 'AWAITING_CUSTOMER_PAYMENT']);
  assert.deepEqual(intent.amount, syp('150000'));
  const cash = await initialize(body.obligationId, 2, 'CASH_ON_COMPLETION');
  assert.equal(cash.status, 201);
  assert.equal(cash.body.financialStatus, 'AWAITING_CASH');
  assert.deepEqual(cash.body.verified, syp('0'));
  assert.equal(
    await count('payment_intent', "obligation_id = $1 AND status = 'SUPERSEDED'", [
      body.obligationId,
    ]),
    1,
  );
  assert.equal(
    await count('payment_intent', 'obligation_id = $1 AND active_slot = 1', [body.obligationId]),
    1,
  );
  assert.equal(await receivable(body.obligationId), '150000', 'the receivable is untouched');
  assert.equal(
    await count('ledger_journal', "obligation_id = $1 AND kind = 'PAYMENT_MATCHED'", [
      body.obligationId,
    ]),
    0,
  );
  const unchanged = await initialize(body.obligationId, 3, 'CASH_ON_COMPLETION');
  assert.equal(errorCode(unchanged), 'METHOD_UNCHANGED');
});

test('stale revision: a command against an old revision is rejected without effect', async () => {
  const body = await created();
  assert.equal((await initialize(body.obligationId, 1, 'SHAM_CASH')).status, 201);
  const stale = await initialize(body.obligationId, 1, 'SYRIATEL_CASH');
  assert.equal(stale.status, 412);
  assert.equal(errorCode(stale), 'REVISION_CONFLICT');
  const view = await replicaA.request('GET', `${PATH}/obligations/${String(body.obligationId)}`, {
    token: TOKENS.customer,
  });
  assert.equal((view.body.activeIntent as { method: string }).method, 'SHAM_CASH');
  assert.equal(view.body.revision, 2, 'the client refetches to learn the current revision');
});

test('revision race: concurrent commands on one revision commit exactly one', async () => {
  const body = await created();
  const results = await Promise.all([
    initialize(body.obligationId, 1, 'SHAM_CASH', { replica: replicaA }),
    initialize(body.obligationId, 1, 'SYRIATEL_CASH', { replica: replicaB }),
    initialize(body.obligationId, 1, 'CASH_ON_COMPLETION', { replica: replicaA }),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 412, 412], JSON.stringify(results.map((r) => r.body)));
  assert.equal(await count('payment_intent', 'obligation_id = $1', [body.obligationId]), 1);
  const stored = await sql.query<{ revision: number }>(
    'SELECT revision FROM app.billing_obligation WHERE id = $1',
    [body.obligationId],
  );
  assert.equal(stored.rows[0]?.revision, 2);
});

// ---------------------------------------------------------------- attempts

test('attempt: a reported transaction number is review only, never payment', async () => {
  const body = await created();
  await initialize(body.obligationId, 1, 'SYRIATEL_CASH');
  const ref = reference();
  const response = await submit(body.obligationId, 2, ref.toLowerCase());
  assert.equal(response.status, 202, JSON.stringify(response.body));
  assert.equal(response.body.financialStatus, 'UNDER_REVIEW');
  assert.deepEqual(response.body.verified, syp('0'));
  const [attempt] = response.body.attempts as { status: string; reference: string }[];
  assert.equal(attempt?.status, 'PENDING_REVIEW');
  assert.equal(
    attempt?.reference,
    `…${ref.replaceAll('-', '').slice(-4)}`,
    'only a mask is echoed',
  );
  assert.ok(
    !JSON.stringify(response.body).includes(ref.replaceAll('-', '')),
    'never the full reference',
  );
  const switched = await initialize(body.obligationId, 3, 'CASH_ON_COMPLETION');
  assert.equal(errorCode(switched), 'PAYMENT_IN_REVIEW');
  const voided = await voidIt(body.obligationId, 3);
  assert.equal(errorCode(voided), 'VOID_NOT_ALLOWED');
  assert.equal(await receivable(body.obligationId), '150000');
  const outbox = await sql.query<{ payload: string }>(
    "SELECT payload FROM app.outbox_message WHERE payload::jsonb #>> '{aggregate,id}' = $1",
    [body.obligationId],
  );
  for (const row of outbox.rows)
    assert.ok(
      !row.payload.includes(ref.replaceAll('-', '')),
      'events never carry the provider reference',
    );
});

test('attempt: a provider reference can be claimed once, across obligations and spellings', async () => {
  const first = await created();
  const second = await created('other-customer');
  await initialize(first.obligationId, 1, 'SHAM_CASH');
  await initialize(second.obligationId, 1, 'SHAM_CASH', { token: TOKENS.otherCustomer });
  const ref = reference();
  assert.equal((await submit(first.obligationId, 2, ref)).status, 202);
  const reused = await submit(second.obligationId, 2, ref.toLowerCase().replaceAll('-', ''), {
    token: TOKENS.otherCustomer,
  });
  assert.equal(reused.status, 409);
  assert.equal(errorCode(reused), 'PROVIDER_REFERENCE_TAKEN');
  const view = await replicaA.request('GET', `${PATH}/obligations/${String(second.obligationId)}`, {
    token: TOKENS.otherCustomer,
  });
  assert.equal(view.body.revision, 2, 'the rejected claim left no trace');
});

test('attempt race: one reference submitted concurrently to two obligations is stored once', async () => {
  const a = await created();
  const b = await created();
  await initialize(a.obligationId, 1, 'SYRIATEL_CASH');
  await initialize(b.obligationId, 1, 'SYRIATEL_CASH');
  const ref = reference();
  const results = await Promise.all([
    submit(a.obligationId, 2, ref, { replica: replicaA }),
    submit(b.obligationId, 2, ref, { replica: replicaB }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [202, 409]);
  assert.equal(
    await count('payment_attempt', 'provider_reference = $1', [ref.replaceAll('-', '')]),
    1,
  );
});

test('attempt: retry of the same submission replays and does not double count', async () => {
  const body = await created();
  await initialize(body.obligationId, 1, 'SHAM_CASH');
  const k = key();
  const ref = reference();
  const first = await submit(body.obligationId, 2, ref, { key: k });
  const again = await submit(body.obligationId, 2, ref, { key: k, replica: replicaB });
  assert.equal(first.status, 202);
  assert.equal(again.status, 202);
  assert.equal(again.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(again.body, first.body);
  assert.equal(await count('payment_attempt', 'obligation_id = $1', [body.obligationId]), 1);
});

// ---------------------------------------------------------------- reconciliation

test('reconcile: UNKNOWN is never success; a reviewer cannot MATCH; only an approved provider credit settles', async () => {
  const body = await created('customer', '275050');
  await initialize(body.obligationId, 1, 'SHAM_CASH');
  const ref = reference();
  const submitted = await submit(body.obligationId, 2, ref);
  const [attempt] = submitted.body.attempts as { attemptId: string }[];
  const attemptId = attempt?.attemptId;

  clock.advance(60_000);
  const unknown = await reconcile(attemptId, 3, 'UNKNOWN', null);
  assert.equal(unknown.status, 200, JSON.stringify(unknown.body));
  assert.equal(unknown.body.financialStatus, 'OUTCOME_UNKNOWN');
  assert.deepEqual(unknown.body.verified, syp('0'));
  assert.equal(await receivable(body.obligationId), '275050');

  const manual = await reconcile(attemptId, 4, 'MATCHED', syp('275050'));
  assert.equal(manual.status, 409);
  assert.equal(errorCode(manual), 'PROVIDER_CREDIT_REQUIRED');
  assert.equal(await receivable(body.obligationId), '275050');

  const credit = await approvedStatement(replicaA, {
    provider: 'SHAM_CASH',
    reference: ref,
    amount: syp('275050'),
    occurredAt: new Date(clock.now().getTime() - 30_000),
  });
  assert.equal(credit.status, 'ALLOCATED');
  assert.equal(credit.obligationId, body.obligationId);
  const settled = await replicaA.request(
    'GET',
    `${PATH}/obligations/${String(body.obligationId)}`,
    {
      token: TOKENS.customer,
    },
  );
  assert.equal(settled.body.status, 'SETTLED');
  assert.equal(settled.body.financialStatus, 'PAID');
  assert.deepEqual(settled.body.verified, syp('275050'));
  assert.deepEqual(settled.body.outstanding, syp('0'));
  assert.equal(await receivable(body.obligationId), '0');
  const cleared = await sql.query<{ net: string }>(
    `SELECT SUM(CASE l.side WHEN 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END)::text AS net
       FROM app.ledger_line l JOIN app.ledger_journal j ON j.id = l.journal_id
      WHERE j.credit_id = $1 AND l.account = 'CLEARING_SHAM_CASH'`,
    [credit.creditId],
  );
  assert.equal(cleared.rows[0]?.net, '275050');
  const reviewer = await sql.query<{ kind: string; subject: string; credit: string }>(
    `SELECT reconciled_by_kind AS kind, reconciled_by_subject::text AS subject, credit_id::text AS credit
       FROM app.payment_attempt WHERE id = $1`,
    [attemptId],
  );
  assert.deepEqual(reviewer.rows[0], {
    kind: 'account',
    subject: SUBJECTS.approver,
    credit: credit.creditId,
  });

  const again = await reconcile(attemptId, 5, 'MATCHED', syp('275050'));
  assert.equal(errorCode(again), 'ATTEMPT_NOT_OPEN');
  assert.equal(
    errorCode(await initialize(body.obligationId, 5, 'CASH_ON_COMPLETION')),
    'OBLIGATION_SETTLED',
  );

  const events = await sql.query<{ payload: string }>(
    `SELECT payload FROM app.outbox_message
      WHERE event_type = 'billing.obligation-status-changed.v1' AND payload::jsonb #>> '{aggregate,id}' = $1
      ORDER BY (payload::jsonb #>> '{aggregate,version}')::int`,
    [body.obligationId],
  );
  const transitions = events.rows.map((row) => {
    const envelope = parseEnvelopeV2(
      JSON.parse(row.payload),
      {
        eventType: 'billing.obligation-status-changed.v1',
        producer: 'billing',
        aggregateType: 'billing-obligation',
      },
      parseObligationStatusChangedData,
    );
    return `${envelope.data.previousFinancialStatus}>${envelope.data.financialStatus}@${envelope.aggregate.version}`;
  });
  assert.deepEqual(transitions, [
    'UNPAID>AWAITING_PAYMENT@2',
    'AWAITING_PAYMENT>UNDER_REVIEW@3',
    'UNDER_REVIEW>OUTCOME_UNKNOWN@4',
    'OUTCOME_UNKNOWN>PAID@5',
  ]);
});

test('reconcile: MISMATCHED returns the intent for a new reference; money unchanged', async () => {
  const body = await created();
  await initialize(body.obligationId, 1, 'SYRIATEL_CASH');
  const submitted = await submit(body.obligationId, 2, reference());
  const attemptId = (submitted.body.attempts as { attemptId: string }[])[0]?.attemptId;
  const mismatched = await reconcile(attemptId, 3, 'MISMATCHED', syp('100'));
  assert.equal(mismatched.status, 200);
  assert.equal(mismatched.body.financialStatus, 'AWAITING_PAYMENT');
  assert.deepEqual(mismatched.body.verified, syp('0'));
  assert.equal(await receivable(body.obligationId), '150000');
  const retry = await submit(body.obligationId, 4, reference());
  assert.equal(retry.status, 202);
  assert.equal((retry.body.attempts as unknown[]).length, 2);
});

test('reconcile: requires billing.reconcile and separation of duties', async () => {
  const body = await created();
  await initialize(body.obligationId, 1, 'SHAM_CASH');
  const submitted = await submit(body.obligationId, 2, reference());
  const attemptId = (submitted.body.attempts as { attemptId: string }[])[0]?.attemptId;
  assert.equal(
    (await reconcile(attemptId, 3, 'MISMATCHED', null, { token: TOKENS.customer })).status,
    403,
  );
  assert.equal(
    (await reconcile(attemptId, 3, 'MISMATCHED', null, { token: TOKENS.finance })).status,
    403,
  );
  const self = await reconcile(attemptId, 3, 'MISMATCHED', null, {
    token: TOKENS.selfReconciler,
  });
  assert.equal(self.status, 403, 'an owner can never decide their own payment');
  assert.equal((await reconcile(randomUUID(), 3, 'MISMATCHED', null)).status, 404);
  const view = await replicaA.request(
    'GET',
    `${PATH}/obligations/${String(body.obligationId)}/financial-status`,
    {
      token: TOKENS.customer,
    },
  );
  assert.equal(view.body.financialStatus, 'UNDER_REVIEW');
});

test('reconcile race: concurrent reviewer decisions on one revision apply at most once', async () => {
  const body = await created();
  await initialize(body.obligationId, 1, 'SHAM_CASH');
  const submitted = await submit(body.obligationId, 2, reference());
  const attemptId = (submitted.body.attempts as { attemptId: string }[])[0]?.attemptId;
  const results = await Promise.all([
    reconcile(attemptId, 3, 'MISMATCHED', null, { replica: replicaA }),
    reconcile(attemptId, 3, 'UNKNOWN', null, { replica: replicaB }),
    reconcile(attemptId, 3, 'MISMATCHED', null, { replica: replicaB }),
  ]);
  assert.equal(
    results.filter((r) => r.status === 200).length,
    1,
    JSON.stringify(results.map((r) => r.body)),
  );
  assert.equal(
    await count(
      'billing_audit_event',
      "attempt_id = $1 AND action = 'billing.attempt.reconciled'",
      [attemptId],
    ),
    1,
  );
  assert.equal(await receivable(body.obligationId), '150000');
});

// ---------------------------------------------------------------- void / compensation

test('void: compensation before payment reverses the receivable; terminal afterwards', async () => {
  const body = await created();
  await initialize(body.obligationId, 1, 'CASH_ON_COMPLETION');
  const notOwner = await voidIt(body.obligationId, 2, { token: TOKENS.otherCustomer });
  assert.equal(notOwner.status, 404);
  const voided = await voidIt(body.obligationId, 2);
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(voided.body.status, 'VOIDED');
  assert.equal(voided.body.financialStatus, 'VOIDED');
  assert.equal(voided.body.activeIntent, null);
  assert.deepEqual(voided.body.outstanding, syp('0'));
  assert.equal(await receivable(body.obligationId), '0');
  assert.equal(
    await count('payment_intent', "obligation_id = $1 AND status = 'CANCELLED'", [
      body.obligationId,
    ]),
    1,
  );
  assert.equal(errorCode(await initialize(body.obligationId, 3, 'SHAM_CASH')), 'OBLIGATION_VOIDED');
  assert.equal(errorCode(await voidIt(body.obligationId, 3)), 'OBLIGATION_VOIDED');
});

// ---------------------------------------------------------------- reads

test('read: owner and Finance only; everyone else sees not-found', async () => {
  const body = await created();
  const id = String(body.obligationId);
  assert.equal(
    (await replicaB.request('GET', `${PATH}/obligations/${id}`, { token: TOKENS.customer })).status,
    200,
  );
  assert.equal(
    (await replicaB.request('GET', `${PATH}/obligations/${id}`, { token: TOKENS.finance })).status,
    200,
  );
  assert.equal(
    (await replicaB.request('GET', `${PATH}/obligations/${id}`, { token: TOKENS.otherCustomer }))
      .status,
    404,
  );
  assert.equal((await replicaB.request('GET', `${PATH}/obligations/${id}`)).status, 401);
  assert.equal(
    (await replicaB.request('GET', `${PATH}/obligations/not-a-uuid`, { token: TOKENS.customer }))
      .status,
    404,
  );
  const status = await replicaB.request('GET', `${PATH}/obligations/${id}/financial-status`, {
    token: TOKENS.customer,
  });
  assert.deepEqual(Object.keys(status.body).sort(), [
    'amount',
    'financialStatus',
    'method',
    'obligationId',
    'outstanding',
    'revision',
    'verified',
  ]);
});

test('restart safety: a fresh replica replays a committed command from its receipt', async () => {
  const quoteId = quote();
  const k = key();
  const first = await create(quoteId, { key: k });
  const prisma = new PrismaService(DATABASE_URL);
  const restarted = await startBillingHttp({
    repository: new PrismaBillingRepository(prisma),
    clock,
    identity,
    pricing,
  });
  try {
    pricing.mode = 'error-500';
    const replay = await create(quoteId, { key: k, replica: restarted });
    assert.equal(replay.status, 201, 'a replay needs no upstream call');
    assert.deepEqual(replay.body, first.body);
  } finally {
    pricing.mode = 'normal';
    await restarted.close();
    await prisma.onModuleDestroy();
  }
});

// ---------------------------------------------------------------- database invariants

test('ledger invariant: every committed journal balances and the whole ledger nets to zero', async () => {
  const unbalanced = await sql.query(
    `SELECT journal_id FROM app.ledger_line GROUP BY journal_id, currency
     HAVING SUM(CASE side WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END) <> 0`,
  );
  assert.equal(unbalanced.rowCount, 0);
  const totals = await sql.query<{ net: string }>(
    `SELECT SUM(CASE side WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END)::text AS net
       FROM app.ledger_line GROUP BY currency`,
  );
  for (const row of totals.rows) assert.equal(row.net, '0');
  const drift = await sql.query(
    `SELECT o.id FROM app.billing_obligation o
       LEFT JOIN app.ledger_journal j ON j.obligation_id = o.id
       LEFT JOIN app.ledger_line l ON l.journal_id = j.id AND l.account = 'CUSTOMER_RECEIVABLE'
      GROUP BY o.id, o.status, o.amount_minor, o.verified_minor
     HAVING COALESCE(SUM(CASE l.side WHEN 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END), 0)
            <> CASE WHEN o.status = 'VOIDED' THEN 0 ELSE o.amount_minor - o.verified_minor END`,
  );
  assert.equal(drift.rowCount, 0, 'receivable agrees with every obligation');
});

test('database: an unbalanced or foreign-currency journal never commits (runtime role)', async () => {
  const body = await created();
  const journal = randomUUID();
  await rejected(
    [
      [
        `INSERT INTO app.ledger_journal (id, kind, business_ref, obligation_id, posted_at, correlation_id)
         VALUES ($1, 'PAYMENT_MATCHED', $2, $3, now(), $4)`,
        [journal, `attempt:${randomUUID()}:matched`, body.obligationId, randomUUID()],
      ],
      [
        `INSERT INTO app.ledger_line VALUES ($1, 0, 'CLEARING_SHAM_CASH', 'DEBIT', 'SYP', 100),
                                            ($1, 1, 'CUSTOMER_RECEIVABLE', 'CREDIT', 'SYP', 99)`,
        [journal],
      ],
    ],
    /LEDGER_JOURNAL_UNBALANCED/,
  );
  const usd = randomUUID();
  await rejected(
    [
      [
        `INSERT INTO app.ledger_journal (id, kind, business_ref, obligation_id, posted_at, correlation_id)
         VALUES ($1, 'PAYMENT_MATCHED', $2, $3, now(), $4)`,
        [usd, `attempt:${randomUUID()}:matched`, body.obligationId, randomUUID()],
      ],
      [
        `INSERT INTO app.ledger_line VALUES ($1, 0, 'CLEARING_SHAM_CASH', 'DEBIT', 'USD', 100),
                                            ($1, 1, 'CUSTOMER_RECEIVABLE', 'CREDIT', 'USD', 100)`,
        [usd],
      ],
    ],
    /LEDGER_JOURNAL_UNBALANCED/,
  );
});

test('database: a balanced journal without its state change (or vice versa) never commits', async () => {
  const body = await created();
  const journal = randomUUID();
  await rejected(
    [
      [
        `INSERT INTO app.ledger_journal (id, kind, business_ref, obligation_id, posted_at, correlation_id)
         VALUES ($1, 'PAYMENT_MATCHED', $2, $3, now(), $4)`,
        [journal, `attempt:${randomUUID()}:matched`, body.obligationId, randomUUID()],
      ],
      [
        `INSERT INTO app.ledger_line VALUES ($1, 0, 'CLEARING_SHAM_CASH', 'DEBIT', 'SYP', 150000),
                                            ($1, 1, 'CUSTOMER_RECEIVABLE', 'CREDIT', 'SYP', 150000)`,
        [journal],
      ],
      // Touch the obligation so its deferred ledger check runs at COMMIT.
      [
        'UPDATE app.billing_obligation SET revision = revision + 1 WHERE id = $1',
        [body.obligationId],
      ],
    ],
    /BILLING_LEDGER_MISMATCH/,
  );
  await rejected(
    [
      [
        `UPDATE app.billing_obligation SET verified_minor = amount_minor, status = 'SETTLED', revision = revision + 1
          WHERE id = $1`,
        [body.obligationId],
      ],
    ],
    /BILLING_LEDGER_MISMATCH/,
  );
});

test('database: financial facts are append-only and state machines are enforced', async () => {
  const body = await created();
  await initialize(body.obligationId, 1, 'SHAM_CASH');
  const ref = reference();
  const submitted = await submit(body.obligationId, 2, ref);
  const attemptId = (submitted.body.attempts as { attemptId: string }[])[0]?.attemptId;
  const credit = await approvedStatement(replicaA, {
    provider: 'SHAM_CASH',
    reference: ref,
    amount: syp('150000'),
    occurredAt: clock.now(),
  });
  assert.equal(credit.status, 'ALLOCATED');
  const id = body.obligationId;
  await rejected(
    [
      [
        'UPDATE app.ledger_line SET amount_minor = 1 WHERE journal_id IN (SELECT id FROM app.ledger_journal WHERE obligation_id = $1)',
        [id],
      ],
    ],
    /BILLING_APPEND_ONLY/,
  );
  await rejected(
    [['DELETE FROM app.ledger_journal WHERE obligation_id = $1', [id]]],
    /BILLING_APPEND_ONLY/,
  );
  await rejected(
    [['DELETE FROM app.billing_obligation WHERE id = $1', [id]]],
    /BILLING_APPEND_ONLY/,
  );
  await rejected(
    [['DELETE FROM app.payment_attempt WHERE id = $1', [attemptId]]],
    /BILLING_APPEND_ONLY/,
  );
  await rejected(
    [['UPDATE app.billing_audit_event SET outcome = $2 WHERE obligation_id = $1', [id, 'FORGED']]],
    /BILLING_APPEND_ONLY/,
  );
  await rejected(
    [
      [
        'UPDATE app.billing_idempotency_receipt SET response_status = 201 WHERE actor_subject = $1',
        [SUBJECTS.customer],
      ],
    ],
    /BILLING_APPEND_ONLY/,
  );
  await rejected(
    [
      [
        "UPDATE app.billing_obligation SET status = 'OPEN', verified_minor = 0, revision = revision + 1 WHERE id = $1",
        [id],
      ],
    ],
    /BILLING_OBLIGATION_TERMINAL/,
  );
  await rejected(
    [
      [
        "UPDATE app.payment_attempt SET status = 'PENDING_REVIEW', reconciled_at = NULL, reconciled_by_kind = NULL, reconciled_by_subject = NULL, observed_minor = NULL WHERE id = $1",
        [attemptId],
      ],
    ],
    /PAYMENT_ATTEMPT_INVALID_TRANSITION/,
  );
  await rejected(
    [
      [
        "UPDATE app.payment_intent SET status = 'AWAITING_CUSTOMER_PAYMENT', active_slot = 1 WHERE obligation_id = $1",
        [id],
      ],
    ],
    /PAYMENT_INTENT_INVALID_TRANSITION/,
  );
  await rejected(['TRUNCATE app.ledger_line'], /permission denied|BILLING_APPEND_ONLY/);
});

test('database: obligation revisions move by exactly one and amounts are immutable', async () => {
  const body = await created();
  const id = body.obligationId;
  await rejected(
    [['UPDATE app.billing_obligation SET revision = revision + 2 WHERE id = $1', [id]]],
    /BILLING_OBLIGATION_INVALID_TRANSITION/,
  );
  await rejected(
    [
      [
        'UPDATE app.billing_obligation SET amount_minor = 1, revision = revision + 1 WHERE id = $1',
        [id],
      ],
    ],
    /BILLING_OBLIGATION_IMMUTABLE_FIELD/,
  );
  await rejected(
    [
      [
        'UPDATE app.billing_obligation SET owner_subject = $2, revision = revision + 1 WHERE id = $1',
        [id, SUBJECTS.otherCustomer],
      ],
    ],
    /BILLING_OBLIGATION_IMMUTABLE_FIELD/,
  );
});

test('database: one active intent, attempts only against an awaiting electronic intent', async () => {
  const body = await created();
  const id = body.obligationId;
  await initialize(id, 1, 'CASH_ON_COMPLETION');
  await rejected(
    [
      [
        `INSERT INTO app.payment_intent VALUES ($1, $2, 'SHAM_CASH', 'AWAITING_CUSTOMER_PAYMENT', 1, 'SYP', 150000, now(), now(), $3)`,
        [randomUUID(), id, randomUUID()],
      ],
    ],
    /payment_intent_obligation_id_active_slot_key|duplicate key/,
  );
  const intent = await sql.query<{ id: string }>(
    'SELECT id FROM app.payment_intent WHERE obligation_id = $1',
    [id],
  );
  await rejected(
    [
      [
        `INSERT INTO app.payment_attempt (id, intent_id, obligation_id, method, provider_reference, status, currency, claimed_minor, submitted_at, correlation_id)
         VALUES ($1, $2, $3, 'SHAM_CASH', 'FORGED0001', 'PENDING_REVIEW', 'SYP', 150000, now(), $4)`,
        [randomUUID(), intent.rows[0]?.id, id, randomUUID()],
      ],
    ],
    /PAYMENT_ATTEMPT_INCONSISTENT/,
  );
  await rejected(
    [
      [
        `INSERT INTO app.payment_intent VALUES ($1, $2, 'CASH_ON_COMPLETION', 'SUCCEEDED', NULL, 'SYP', 150000, now(), now(), $3)`,
        [randomUUID(), id, randomUUID()],
      ],
    ],
    /payment_intent_method_status|PAYMENT_INTENT_INCONSISTENT/,
  );
});

test('database: ledger lines cannot be added to an already committed journal', async () => {
  const body = await created();
  const journal = await sql.query<{ id: string }>(
    'SELECT id FROM app.ledger_journal WHERE obligation_id = $1',
    [body.obligationId],
  );
  await rejected(
    [
      [
        `INSERT INTO app.ledger_line VALUES ($1, 9, 'CUSTOMER_RECEIVABLE', 'DEBIT', 'SYP', 1)`,
        [journal.rows[0]?.id],
      ],
    ],
    /LEDGER_JOURNAL_IMMUTABLE/,
  );
});

test('database: the runtime role cannot change schema or call trigger functions', async () => {
  await rejected(['CREATE TABLE app.billing_shadow (id int)'], /permission denied/);
  await rejected(
    ['ALTER TABLE app.ledger_line DISABLE TRIGGER ledger_line_immutable'],
    /must be owner|permission denied/,
  );
  await rejected(
    ['SELECT app.billing_reject_mutation()'],
    /permission denied|trigger functions can only be called as triggers/,
  );
});
