import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Client } from 'pg';
import { billingV1, parseApiErrorEnvelope } from '@carwash/contracts';
import { BILLING_REFUND_STATUS_CHANGED_V1 } from '@carwash/event-contracts';
import { snapshotFinancialStatus } from '../../src/application';
import type { BillingUnitOfWork } from '../../src/ports';
import { PrismaBillingRepository } from '../../src/infrastructure/persistence/prisma-billing.repository';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
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
  tokenFor,
  type PricingStub,
  type Stub,
} from '../support/upstream-stubs';
import { acceptanceProviders, approvedStatement, evidence } from '../support/provider-flows';
import { WorkDouble } from '../support/work-double';
import {
  WORKLOADS,
  startBookingSagaHttp,
  startValidateStub,
  type BookingSagaHttp,
  type ValidateStub,
} from '../support/booking-saga-harness';

/**
 * Published billing.v1 refunds over actual Nest HTTP and least-privilege
 * PostgreSQL, with two independent service pools. Electronic settlement uses
 * the production manual-statement adapter with two distinct staff decisions.
 * Identity, Pricing and Work remain explicit upstream doubles. No provider
 * transfer or broker publication is fabricated or claimed by this suite.
 */
const APP_URL = process.env.BILLING_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('BILLING_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;
const PATH = '/internal/v1/billing';
const EVENT = 'billing.refund-status-changed.v1';
const principalBoth = tokenFor('refunder-both');
const guestReconciler = tokenFor('guest-reconciler');
const key = () => `canonical-refund-${randomUUID()}`;
const syp = (amountMinor: string) => ({ currency: 'SYP', amountMinor, scale: 2 });
const reference = () => `Return-${randomUUID()}`;

let identity: Stub;
let pricing: PricingStub;
let clock: FixedClock;
let work: WorkDouble;
let validate: ValidateStub;
let bookings: BookingSagaHttp;
let sql: Client;
let replicaA: BillingHttpHarness;
let replicaB: BillingHttpHarness;
const prismas: PrismaService[] = [];

before(async () => {
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  identity = await startIdentityStub({
    ...SESSIONS,
    'refunder-both': {
      ...SESSIONS.refunder,
      permissions: [...SESSIONS.refunder.permissions, 'billing.reconcile'],
    },
    'guest-reconciler': {
      subject: SUBJECTS.guest,
      kind: 'guest',
      permissions: ['billing.read', 'billing.reconcile'],
    },
  });
  pricing = await startPricingStub();
  work = new WorkDouble();
  for (let index = 0; index < 2; index += 1) prismas.push(new PrismaService(DATABASE_URL));
  const [prismaA, prismaB] = prismas;
  assert.ok(prismaA && prismaB);
  const shared = { clock, identity, pricing, work, providers: acceptanceProviders() };
  replicaA = await startBillingHttp({
    ...shared,
    repository: new PrismaBillingRepository(prismaA),
  });
  replicaB = await startBillingHttp({
    ...shared,
    repository: new PrismaBillingRepository(prismaB),
  });
  validate = await startValidateStub();
  bookings = await startBookingSagaHttp({
    repository: new PrismaBillingRepository(prismaA),
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
  await bookings?.close();
  await validate?.close();
  for (const prisma of prismas) await prisma.onModuleDestroy();
  await identity?.close();
  await pricing?.close();
  await sql?.end();
});

interface Paid {
  obligationId: string;
  revision: number;
  creditId: string;
  amount: string;
}

type Options = { token?: string; key?: string; replica?: BillingHttpHarness };
const post = (path: string, body: unknown, options: Options, token: string) =>
  (options.replica ?? replicaA).request('POST', `${PATH}${path}`, {
    token: options.token ?? token,
    key: options.key ?? key(),
    body,
  });
const get = (path: string, token = TOKENS.finance, replica = replicaA) =>
  replica.request('GET', `${PATH}${path}`, { token });

function rejected(reply: HttpReply, status: number, code: string, reason: string | null = null) {
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  const parsed = parseApiErrorEnvelope(reply.body);
  assert.equal(parsed.error.code, code);
  assert.equal(parsed.error.reason, reason);
  assert.equal(parsed.error.correlationId, reply.headers.get('x-correlation-id'));
  return parsed.error;
}

async function unpaid(amount = '100000') {
  const quoteId = randomUUID();
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: amount,
  });
  const result = await post('/obligations', { quoteId }, {}, TOKENS.customer);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return billingV1.parseObligationV1(result.body);
}

async function paid(amount = '100000'): Promise<Paid> {
  const created = await unpaid(amount);
  const id = created.obligationId;
  const intent = await post(
    `/obligations/${id}/payment-intents`,
    {
      expectedRevision: created.revision,
      method: 'SHAM_CASH',
    },
    {},
    TOKENS.customer,
  );
  assert.equal(intent.status, 201, JSON.stringify(intent.body));
  const ref = `PAID${randomUUID().replaceAll('-', '')}`;
  const claim = await post(
    `/obligations/${id}/payment-attempts`,
    {
      expectedRevision: 2,
      providerReference: ref,
    },
    {},
    TOKENS.customer,
  );
  assert.equal(claim.status, 202, JSON.stringify(claim.body));
  const credit = await approvedStatement(replicaA, {
    provider: 'SHAM_CASH',
    reference: ref,
    amount: syp(amount),
    occurredAt: clock.now(),
  });
  assert.equal(credit.status, 'ALLOCATED');
  const result = await get(`/obligations/${id}`, TOKENS.customer);
  assert.equal(result.status, 200);
  const obligation = billingV1.parseObligationV1(result.body);
  assert.equal(obligation.status, 'SETTLED');
  assert.equal(obligation.financialStatus, 'PAID');
  return {
    obligationId: id,
    revision: obligation.revision,
    creditId: String(credit.creditId),
    amount,
  };
}

function request(
  p: Paid,
  amount = p.amount,
  options: Options = {},
  reason: billingV1.RefundReason = 'SERVICE_QUALITY',
) {
  return post(
    `/obligations/${p.obligationId}/refunds`,
    {
      expectedRevision: p.revision,
      amount: syp(amount),
      reason,
    },
    options,
    TOKENS.refunder,
  );
}

function outcome(
  refund: billingV1.RefundV1,
  value: billingV1.RefundOutcome,
  ref: string | null = value === 'SUCCEEDED' ? reference() : null,
  options: Options = {},
) {
  return post(
    `/refunds/${refund.refundId}/outcome`,
    {
      expectedRevision: refund.revision,
      outcome: value,
      reference: ref,
    },
    options,
    TOKENS.reconciler,
  );
}

async function requested(p: Paid, amount = p.amount, options: Options = {}) {
  const reply = await request(p, amount, options);
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return billingV1.parseRefundV1(reply.body);
}

async function list(p: Pick<Paid, 'obligationId'>, token = TOKENS.customer) {
  const reply = await get(`/obligations/${p.obligationId}/refunds`, token, replicaB);
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  return billingV1.parseObligationRefundsV1(reply.body);
}

async function effects(refundId: string) {
  const result = await sql.query<{
    status: string;
    revision: number;
    audits: number;
    events: number;
    journals: number;
  }>(
    `SELECT r.status, r.revision,
       (SELECT COUNT(*)::int FROM app.billing_audit_event a WHERE a.refund_id=r.id) AS audits,
       (SELECT COUNT(*)::int FROM app.outbox_message o WHERE o.event_type=$2
          AND o.payload::jsonb #>> '{aggregate,id}'=r.id::text) AS events,
       (SELECT COUNT(*)::int FROM app.ledger_journal j WHERE j.business_ref=$3) AS journals
     FROM app.payment_refund r WHERE r.id=$1`,
    [refundId, EVENT, `refund:${refundId}:paid`],
  );
  const row = result.rows[0];
  assert.ok(row);
  return row;
}

async function assertMoney(p: Paid, refundedMinor: bigint) {
  for (const token of [TOKENS.customer, TOKENS.finance]) {
    const full = await get(`/obligations/${p.obligationId}`, token);
    const lean = await get(`/obligations/${p.obligationId}/financial-status`, token, replicaB);
    assert.equal(full.status, 200);
    assert.equal(lean.status, 200);
    const obligation = billingV1.parseObligationV1(full.body);
    const financial = billingV1.parseFinancialStatusViewV1(lean.body);
    assert.equal(obligation.status, 'SETTLED');
    assert.equal(obligation.financialStatus, 'PAID');
    assert.equal(financial.financialStatus, 'PAID');
    assert.equal(financial.verified.amountMinor, p.amount);
    assert.equal(financial.outstanding.amountMinor, '0');
    assert.equal(obligation.revision, p.revision);
  }
  const prisma = prismas[0];
  assert.ok(prisma);
  const snapshot = await new PrismaBillingRepository(prisma).snapshot(p.obligationId);
  assert.ok(snapshot);
  assert.equal(snapshot.refunded?.amountMinor ?? 0n, refundedMinor);
  assert.equal(
    snapshotFinancialStatus(snapshot),
    refundedMinor === 0n
      ? 'PAID'
      : refundedMinor === BigInt(p.amount)
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED',
  );
  const balances = await sql.query<{ account: string; net: string }>(
    `SELECT l.account, SUM(CASE l.side WHEN 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END)::text AS net
       FROM app.ledger_line l JOIN app.ledger_journal j ON j.id=l.journal_id
      WHERE j.credit_id=$1 GROUP BY l.account`,
    [p.creditId],
  );
  const accounts = Object.fromEntries(balances.rows.map((row) => [row.account, row.net]));
  assert.equal(accounts.CLEARING_SHAM_CASH, String(BigInt(p.amount) - refundedMinor));
  assert.equal(accounts.REFUNDS_CONTROL ?? '0', String(refundedMinor));
}

test('canonical partial and full refunds expose closed views, exact accounting, and registered atomic events', async () => {
  const p = await paid();
  assert.deepEqual((await list(p)).refundable, syp('100000'));
  const first = await requested(p, '30000');
  assert.equal(first.status, 'REQUESTED');
  assert.equal(first.reference, null);
  assert.equal(first.decidedAt, null);
  assert.equal(first.method, 'SHAM_CASH');
  assert.deepEqual((await list(p)).inFlight, syp('30000'));
  const done = await outcome(first, 'SUCCEEDED', 'Return-Case-Ab19');
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const partial = billingV1.parseRefundV1(done.body);
  assert.equal(partial.reference, '…Ab19');
  assert.equal(partial.status, 'SUCCEEDED');
  assert.ok(partial.decidedAt);
  const fetched = await get(`/refunds/${first.refundId}`);
  assert.deepEqual(billingV1.parseRefundV1(fetched.body), partial);
  await assertMoney(p, 30_000n);

  const second = await requested(p, '70000');
  assert.equal((await outcome(second, 'SUCCEEDED')).status, 200);
  const summary = await list(p);
  assert.deepEqual(summary.refunded, syp('100000'));
  assert.deepEqual(summary.inFlight, syp('0'));
  assert.deepEqual(summary.refundable, syp('0'));
  assert.equal(summary.items.length, 2);
  await assertMoney(p, 100_000n);
  rejected(await request(p, '1'), 409, 'CONFLICT', 'REFUND_EXCEEDS_REFUNDABLE');

  const rows = await sql.query<{ payload: string; published: Date | null }>(
    `SELECT payload, published_at AS published FROM app.outbox_message
      WHERE event_type=$1 AND payload::jsonb #>> '{data,obligationId}'=$2
      ORDER BY created_at, id`,
    [EVENT, p.obligationId],
  );
  assert.equal(rows.rowCount, 4);
  for (const row of rows.rows) {
    const event = BILLING_REFUND_STATUS_CHANGED_V1.parse(JSON.parse(row.payload));
    assert.equal(event.data.obligationId, p.obligationId);
    assert.equal(row.published, null, 'outbox persistence is not broker-delivery evidence');
    assert.doesNotMatch(row.payload, /Return-Case-Ab19|merchantAccount|evidenceDigest|creditId/);
  }
});

test('canonical auth keeps owner reads separate from staff money decisions and enforces four eyes', async () => {
  const p = await paid();
  const path = `/obligations/${p.obligationId}/refunds`;
  rejected(await replicaA.request('GET', `${PATH}${path}`), 401, 'AUTH_REQUIRED');
  rejected(await get(path, TOKENS.otherCustomer), 404, 'NOT_FOUND');
  await list(p, TOKENS.finance);
  for (const token of [TOKENS.customer, TOKENS.finance, TOKENS.reconciler, TOKENS.guestRefunder])
    rejected(await request(p, '1', { token }), 403, 'AUTH_FORBIDDEN');
  rejected(
    await request(p, '1', { token: TOKENS.selfRefunder }),
    403,
    'AUTH_FORBIDDEN',
    'SEPARATION_OF_DUTIES',
  );
  const refund = await requested(p, '10');
  rejected(await get(`/refunds/${refund.refundId}`, TOKENS.customer), 403, 'AUTH_FORBIDDEN');
  for (const token of [TOKENS.customer, TOKENS.finance, TOKENS.refunder, guestReconciler])
    rejected(await outcome(refund, 'FAILED', null, { token }), 403, 'AUTH_FORBIDDEN');
  for (const token of [principalBoth, TOKENS.selfReconciler])
    rejected(
      await outcome(refund, 'FAILED', null, { token }),
      403,
      'AUTH_FORBIDDEN',
      'SEPARATION_OF_DUTIES',
    );
  assert.equal((await outcome(refund, 'FAILED')).status, 200);
  rejected(await get(`/refunds/${randomUUID()}`), 404, 'NOT_FOUND');
  rejected(await get('/refunds/not-a-uuid'), 404, 'NOT_FOUND');
});

test('canonical input, reference, revision and unsettled failures follow the shared error contract', async () => {
  const p = await paid();
  const path = `${PATH}/obligations/${p.obligationId}/refunds`;
  const body = { expectedRevision: p.revision, amount: syp('1'), reason: 'PRICE_CORRECTION' };
  for (const rawPath of [
    path,
    `${PATH}/refunds/${randomUUID()}/outcome`,
    path.toUpperCase() + '/?diagnostic=1',
  ]) {
    const malformed = await replicaA.request('POST', rawPath, {
      token: TOKENS.refunder,
      key: key(),
      raw: '{"private-transfer-reference":',
    });
    rejected(malformed, 400, 'REQUEST_INVALID');
    assert.doesNotMatch(JSON.stringify(malformed.body), /private-transfer-reference/);
    assert.equal(malformed.headers.get('cache-control'), 'no-store');
  }
  rejected(
    await replicaA.request('POST', path, { token: TOKENS.refunder, body }),
    428,
    'IDEMPOTENCY_KEY_REQUIRED',
  );
  rejected(
    await replicaA.request('POST', path, { token: TOKENS.refunder, key: 'bad', body }),
    400,
    'REQUEST_INVALID',
  );
  for (const invalid of [
    { ...body, unexpected: true },
    { ...body, expectedRevision: '4' },
    { ...body, amount: { ...syp('1'), scale: 0 } },
    { ...body, reason: 'UNALLOCATABLE_CREDIT' },
  ])
    rejected(
      await post(`/obligations/${p.obligationId}/refunds`, invalid, {}, TOKENS.refunder),
      400,
      'REQUEST_INVALID',
    );
  rejected(
    await post(
      `/obligations/${p.obligationId}/refunds`,
      { ...body, amount: syp('0') },
      {},
      TOKENS.refunder,
    ),
    422,
    'VALIDATION_FAILED',
  );
  rejected(
    await post(
      `/obligations/${p.obligationId}/refunds`,
      { ...body, amount: { currency: 'USD', amountMinor: '1', scale: 2 } },
      {},
      TOKENS.refunder,
    ),
    422,
    'BUSINESS_RULE_VIOLATION',
    'CURRENCY_MISMATCH',
  );
  rejected(await request({ ...p, revision: p.revision - 1 }), 412, 'REVISION_CONFLICT');
  const open = await unpaid();
  rejected(
    await request({ ...p, obligationId: open.obligationId, revision: open.revision }),
    409,
    'CONFLICT',
    'OBLIGATION_NOT_SETTLED',
  );
  const refund = await requested(p);
  rejected(
    await outcome(refund, 'SUCCEEDED', null),
    422,
    'BUSINESS_RULE_VIOLATION',
    'REFUND_REFERENCE_REQUIRED',
  );
  rejected(
    await outcome(refund, 'FAILED', 'not-permitted'),
    422,
    'BUSINESS_RULE_VIOLATION',
    'REFUND_REFERENCE_NOT_ALLOWED',
  );
  rejected(await outcome(refund, 'SUCCEEDED', 'with spaces'), 400, 'REQUEST_INVALID');
  rejected(
    await outcome({ ...refund, revision: refund.revision + 1 }, 'FAILED'),
    412,
    'REVISION_CONFLICT',
  );
  assert.equal((await outcome(refund, 'FAILED')).status, 200);
});

test('two replica over-requests serialize on the actual credit and cannot overspend', async () => {
  const p = await paid();
  const replies = await Promise.all([
    request(p, '70000', { replica: replicaA }),
    request(p, '70000', { replica: replicaB }),
  ]);
  assert.deepEqual(replies.map((reply) => reply.status).sort(), [201, 409]);
  const loser = replies.find((reply) => reply.status !== 201);
  assert.ok(loser);
  rejected(loser, 409, 'CONFLICT', 'REFUND_EXCEEDS_REFUNDABLE');
  const summary = await list(p);
  assert.equal(summary.items.length, 1);
  assert.deepEqual(summary.inFlight, syp('70000'));
  assert.deepEqual(summary.refundable, syp('30000'));
  await assertMoney(p, 0n);
});

test('same-key requests and outcomes on two replicas replay one atomic financial fact', async () => {
  const p = await paid();
  const requestKey = key();
  const replies = await Promise.all([
    request(p, '25000', { key: requestKey, replica: replicaA }),
    request(p, '25000', { key: requestKey, replica: replicaB }),
  ]);
  for (const reply of replies) assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.deepEqual(replies[0]?.body, replies[1]?.body);
  assert.deepEqual(replies.map((reply) => reply.headers.get('idempotency-replayed')).sort(), [
    'false',
    'true',
  ]);
  const first = replies[0];
  assert.ok(first);
  const refund = billingV1.parseRefundV1(first.body);
  rejected(await request(p, '25001', { key: requestKey }), 409, 'IDEMPOTENCY_CONFLICT');
  const outcomeKey = key();
  const ref = reference();
  const outcomes = await Promise.all([
    outcome(refund, 'SUCCEEDED', ref, { key: outcomeKey, replica: replicaA }),
    outcome(refund, 'SUCCEEDED', ref, { key: outcomeKey, replica: replicaB }),
  ]);
  for (const reply of outcomes) assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.deepEqual(outcomes[0]?.body, outcomes[1]?.body);
  assert.deepEqual(outcomes.map((reply) => reply.headers.get('idempotency-replayed')).sort(), [
    'false',
    'true',
  ]);
  rejected(await outcome(refund, 'FAILED', null, { key: outcomeKey }), 409, 'IDEMPOTENCY_CONFLICT');
  const replay = await request(p, '25000', { key: requestKey });
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.equal(replay.body.status, 'REQUESTED', 'historical response is stable');
  assert.equal((await get(`/refunds/${refund.refundId}`)).body.status, 'SUCCEEDED');
  assert.deepEqual(await effects(refund.refundId), {
    status: 'SUCCEEDED',
    revision: 2,
    audits: 2,
    events: 2,
    journals: 1,
  });
  await assertMoney(p, 25_000n);
});

test('lost HTTP responses recover via the same key without a second refund or journal', async (t) => {
  const p = await paid();
  const requestKey = key();
  const body = { expectedRevision: p.revision, amount: syp('15000'), reason: 'SERVICE_QUALITY' };
  const path = `/obligations/${p.obligationId}/refunds`;
  const forwarded: HttpReply[] = [];
  let forward = () =>
    replicaA.request('POST', `${PATH}${path}`, { token: TOKENS.refunder, key: requestKey, body });
  const proxy = createServer((_request, response) => {
    void forward()
      .then((reply) => {
        forwarded.push(reply);
        response.destroy();
      })
      .catch((error: unknown) =>
        response.destroy(error instanceof Error ? error : new Error('PROXY_FAILED')),
      );
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = proxy.address();
  assert.ok(address && typeof address === 'object');
  await assert.rejects(fetch(`http://127.0.0.1:${address.port}`, { method: 'POST' }));
  const committedRequest = forwarded[0];
  assert.ok(committedRequest);
  assert.equal(committedRequest.status, 201);
  const recovered = await replicaB.request('POST', `${PATH}${path}`, {
    token: TOKENS.refunder,
    key: requestKey,
    body,
  });
  assert.equal(recovered.status, 201);
  assert.equal(recovered.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(recovered.body, committedRequest.body);
  const refund = billingV1.parseRefundV1(recovered.body);
  assert.deepEqual(await effects(refund.refundId), {
    status: 'REQUESTED',
    revision: 1,
    audits: 1,
    events: 1,
    journals: 0,
  });
  const outcomeKey = key();
  const ref = reference();
  forward = () => outcome(refund, 'SUCCEEDED', ref, { key: outcomeKey });
  await assert.rejects(fetch(`http://127.0.0.1:${address.port}`, { method: 'POST' }));
  const committedOutcome = forwarded[1];
  assert.ok(committedOutcome);
  const recoveredOutcome = await outcome(refund, 'SUCCEEDED', ref, {
    key: outcomeKey,
    replica: replicaB,
  });
  assert.equal(recoveredOutcome.status, 200);
  assert.equal(recoveredOutcome.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(recoveredOutcome.body, committedOutcome.body);
  assert.deepEqual(await effects(refund.refundId), {
    status: 'SUCCEEDED',
    revision: 2,
    audits: 2,
    events: 2,
    journals: 1,
  });
});

test('UNKNOWN never expires or releases its reservation and can resolve only once', async (t) => {
  const p = await paid();
  const refund = await requested(p, '80000');
  const unknownKey = key();
  const unknownReply = await outcome(refund, 'UNKNOWN', null, { key: unknownKey });
  assert.equal(unknownReply.status, 200, JSON.stringify(unknownReply.body));
  const unknown = billingV1.parseRefundV1(unknownReply.body);
  assert.equal(unknown.status, 'OUTCOME_UNKNOWN');
  assert.equal(unknown.reference, null);
  const elapsed = 365 * 24 * 60 * 60 * 1000;
  clock.advance(elapsed);
  t.after(() => clock.advance(-elapsed));
  assert.deepEqual((await list(p)).inFlight, syp('80000'));
  rejected(await request(p, '20001'), 409, 'CONFLICT', 'REFUND_EXCEEDS_REFUNDABLE');
  rejected(await outcome(unknown, 'UNKNOWN'), 409, 'CONFLICT', 'REFUND_NOT_OPEN');
  rejected(await outcome(refund, 'SUCCEEDED'), 412, 'REVISION_CONFLICT');
  const done = await outcome(unknown, 'SUCCEEDED', reference(), { token: TOKENS.approver });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const terminal = billingV1.parseRefundV1(done.body);
  rejected(await outcome(terminal, 'FAILED'), 409, 'CONFLICT', 'REFUND_NOT_OPEN');
  const replay = await outcome(refund, 'UNKNOWN', null, { key: unknownKey });
  assert.deepEqual(replay.body, unknownReply.body);
  assert.equal((await get(`/refunds/${refund.refundId}`)).body.status, 'SUCCEEDED');
  assert.deepEqual((await list(p)).inFlight, syp('0'));
  await assertMoney(p, 80_000n);
  assert.deepEqual(await effects(refund.refundId), {
    status: 'SUCCEEDED',
    revision: 3,
    audits: 3,
    events: 3,
    journals: 1,
  });
});

test('FAILED releases the amount, while the published twenty-item cap includes failed history', async () => {
  const p = await paid('100');
  for (let index = 0; index < billingV1.MAX_REFUNDS_PER_OBLIGATION; index += 1) {
    const refund = await requested(p, p.amount);
    assert.equal((await outcome(refund, 'FAILED')).status, 200);
  }
  const summary = await list(p);
  assert.equal(summary.items.length, 20);
  assert.deepEqual(summary.inFlight, syp('0'));
  assert.deepEqual(summary.refunded, syp('0'));
  assert.deepEqual(summary.refundable, syp('100'));
  const failure = rejected(await request(p, '1'), 422, 'VALIDATION_FAILED');
  assert.deepEqual(failure.issues, [{ field: '$.refunds', code: 'REFUND_LIMIT_REACHED' }]);
  await assertMoney(p, 0n);
});

test('an exact reused outcome reference conflicts atomically across obligations', async () => {
  const a = await paid();
  const b = await paid();
  const first = await requested(a, '1000');
  const second = await requested(b, '1000');
  const ref = reference();
  assert.equal((await outcome(first, 'SUCCEEDED', ref)).status, 200);
  rejected(await outcome(second, 'SUCCEEDED', ref), 409, 'CONFLICT', 'REFUND_REFERENCE_TAKEN');
  assert.deepEqual(await effects(second.refundId), {
    status: 'REQUESTED',
    revision: 1,
    audits: 1,
    events: 1,
    journals: 0,
  });
  await assertMoney(b, 0n);
});

test('outbox failure rolls back outcome, journal, audit and receipt together, then same-key retry succeeds', async (t) => {
  const p = await paid();
  const refund = await requested(p, '40000');
  const prisma = new PrismaService(DATABASE_URL);
  prismas.push(prisma);
  class FaultRepository extends PrismaBillingRepository {
    private armed = true;
    override transaction<T>(operation: (uow: BillingUnitOfWork) => Promise<T>): Promise<T> {
      return super.transaction(async (uow) => {
        const original = uow.appendOutbox.bind(uow);
        uow.appendOutbox = (event) => {
          if (this.armed && event.eventType === EVENT) {
            this.armed = false;
            return Promise.reject(new Error('SYNTHETIC_OUTBOX_FAILURE'));
          }
          return original(event);
        };
        return operation(uow);
      });
    }
  }
  const failing = await startBillingHttp({
    repository: new FaultRepository(prisma),
    clock,
    identity,
    pricing,
    providers: acceptanceProviders(),
  });
  t.after(() => failing.close());
  const sameKey = key();
  const ref = reference();
  rejected(
    await outcome(refund, 'SUCCEEDED', ref, { key: sameKey, replica: failing }),
    500,
    'INTERNAL_ERROR',
  );
  assert.deepEqual(await effects(refund.refundId), {
    status: 'REQUESTED',
    revision: 1,
    audits: 1,
    events: 1,
    journals: 0,
  });
  await assertMoney(p, 0n);
  const retry = await outcome(refund, 'SUCCEEDED', ref, { key: sameKey, replica: replicaB });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.headers.get('idempotency-replayed'), 'false');
  assert.deepEqual(await effects(refund.refundId), {
    status: 'SUCCEEDED',
    revision: 2,
    audits: 2,
    events: 2,
    journals: 1,
  });
  await assertMoney(p, 40_000n);
});

test('legacy approval/evidence workflow remains explicit and shares the same reservation cap', async () => {
  const p = await paid();
  const legacy = await post(
    `/provider-credits/${p.creditId}/refunds`,
    {
      expectedRevision: 2,
      amount: syp('60000'),
      reason: 'BOOKING_CANCELLED',
    },
    {},
    TOKENS.refunder,
  );
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  const id = String(legacy.body.refundId);
  const approved = await post(
    `/refunds/${id}/decision`,
    { expectedRevision: 1, decision: 'APPROVE' },
    {},
    TOKENS.refundApprover,
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const explicit = await get(`/legacy/refunds/${id}`);
  assert.equal(explicit.body.status, 'APPROVED');
  assert.equal(explicit.body.channel, 'MANUAL_OUT_OF_BAND');
  const projected = billingV1.parseRefundV1((await get(`/refunds/${id}`)).body);
  assert.equal(projected.status, 'REQUESTED');
  assert.equal(projected.decidedAt, null, 'approval alone is not a money-out result');
  assert.deepEqual((await list(p)).inFlight, syp('60000'));
  rejected(await request(p, '40001'), 409, 'CONFLICT', 'REFUND_EXCEEDS_REFUNDABLE');
  rejected(await outcome(projected, 'SUCCEEDED'), 409, 'CONFLICT', 'REFUND_NOT_OPEN');
  const canonical = await requested(p, '40000');
  const crossed = await post(
    `/refunds/${canonical.refundId}/manual-completion`,
    {
      expectedRevision: 1,
      outcome: 'SUCCEEDED',
      transferReference: 'LEGACY999',
      evidenceDigest: evidence(),
    },
    {},
    TOKENS.refundApprover,
  );
  assert.equal(crossed.status, 404, JSON.stringify(crossed.body));
  const completed = await post(
    `/refunds/${id}/manual-completion`,
    {
      expectedRevision: 2,
      outcome: 'SUCCEEDED',
      transferReference: `LEGACY${randomUUID().replaceAll('-', '')}`.toUpperCase(),
      evidenceDigest: evidence(),
    },
    {},
    TOKENS.refundApprover,
  );
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.deepEqual((await list(p)).refunded, syp('60000'));
  assert.equal(billingV1.parseRefundV1((await get(`/refunds/${id}`)).body).status, 'SUCCEEDED');
  await assertMoney(p, 60_000n);
});

test('cash receipts remain real, but unset refund custody policy fails closed without new money facts', async () => {
  const quoteId = randomUUID();
  const bookingId = randomUUID();
  validate.quotes.set(quoteId, {
    beneficiary: { kind: 'account', subjectId: SUBJECTS.customer },
    revision: 1,
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: '100000',
  });
  const created = await bookings.request('POST', `${PATH}/booking-obligations`, {
    workload: WORKLOADS.booking,
    key: key(),
    body: { beneficiary: { kind: 'account', subjectId: SUBJECTS.customer }, quoteId, bookingId },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const obligationId = String(created.body.obligationId);
  assert.equal(
    (
      await post(
        `/obligations/${obligationId}/payment-intents`,
        { expectedRevision: 1, method: 'CASH_ON_COMPLETION' },
        {},
        TOKENS.customer,
      )
    ).status,
    201,
  );
  work.book({ bookingId, technicianSubject: SUBJECTS.technician });
  const receipt = await post(
    `/obligations/${obligationId}/cash-collections`,
    { expectedRevision: 2, bookingId, amount: syp('100000') },
    {},
    TOKENS.technician,
  );
  assert.equal(receipt.status, 201, JSON.stringify(receipt.body));
  const settled = billingV1.parseObligationV1(
    (await get(`/obligations/${obligationId}`, TOKENS.customer)).body,
  );
  assert.equal(settled.status, 'SETTLED');
  rejected(
    await request({
      obligationId,
      revision: settled.revision,
      amount: '100000',
      creditId: 'unused',
    }),
    503,
    'SERVICE_NOT_READY',
  );
  assert.equal((await list({ obligationId })).items.length, 0);
  const rows = await sql.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM app.billing_audit_event WHERE obligation_id=$1 AND refund_id IS NOT NULL`,
    [obligationId],
  );
  assert.equal(rows.rows[0]?.n, 0);
});

test('database guards keep protocol identity, four eyes, transitions and ledger consistency immutable', async () => {
  const p = await paid();
  const refund = await requested(p, '1000');
  await assert.rejects(
    sql.query(
      `UPDATE app.payment_refund SET workflow='CREDIT_V1', revision=revision+1 WHERE id=$1`,
      [refund.refundId],
    ),
    /PAYMENT_REFUND_IMMUTABLE_FIELD/,
  );
  await assert.rejects(
    sql.query(
      `UPDATE app.payment_refund SET status='FAILED', decided_by_subject=requested_by_subject, decided_at=requested_at, completed_by_subject=requested_by_subject, completed_at=requested_at, revision=revision+1 WHERE id=$1`,
      [refund.refundId],
    ),
    /payment_refund_separation/,
  );
  await assert.rejects(
    sql.query(
      `UPDATE app.payment_refund SET status='FAILED', decided_by_subject=$2, decided_at=requested_at, completed_by_subject=$2, completed_at=requested_at, revision=revision+1 WHERE id=$1`,
      [refund.refundId, SUBJECTS.customer],
    ),
    /CANONICAL_REFUND_SELF_DECISION/,
  );
  await assert.rejects(
    sql.query(
      `UPDATE app.payment_refund SET status='SUCCEEDED', decided_by_subject=$2, decided_at=requested_at, completed_by_subject=$2, completed_at=requested_at, provider_refund_reference=$3, revision=revision+1 WHERE id=$1`,
      [refund.refundId, SUBJECTS.reconciler, reference()],
    ),
    /PROVIDER_CREDIT_LEDGER_MISMATCH/,
  );
  const unknown = await outcome(refund, 'UNKNOWN');
  assert.equal(unknown.status, 200);
  await assert.rejects(
    sql.query(`UPDATE app.payment_refund SET status='UNKNOWN', revision=revision+1 WHERE id=$1`, [
      refund.refundId,
    ]),
    /PAYMENT_REFUND_INVALID_TRANSITION/,
  );
  assert.deepEqual(await effects(refund.refundId), {
    status: 'UNKNOWN',
    revision: 2,
    audits: 2,
    events: 2,
    journals: 0,
  });
  await assert.rejects(
    sql.query(`SELECT app.billing_assert_provider_credit($1)`, [p.creditId]),
    /permission denied/,
  );
  await assertMoney(p, 0n);
});
