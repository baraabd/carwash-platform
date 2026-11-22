import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { billingV1 } from '@carwash/contracts';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaBillingRepository } from '../../src/infrastructure/persistence/prisma-billing.repository';
import { productionProviderRegistry } from '../../src/infrastructure/providers/merchant-providers';
import type { BillingRepository, BillingUnitOfWork } from '../../src/ports';
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
import { MERCHANTS, recordStatement, decideStatement } from '../support/provider-flows';

/** Real HTTP + PostgreSQL + production statement-only provider adapters.
 * Identity and Pricing are declared HTTP test doubles; no provider result is fabricated.
 */
const DATABASE_URL = process.env.BILLING_TEST_DATABASE_URL;
if (!DATABASE_URL) throw new Error('BILLING_TEST_DATABASE_URL_REQUIRED');
const PATH = '/internal/v1/billing';
const SECOND_MERCHANT = 'acceptance-sham-02';
const key = () => `selected-credit-${randomUUID()}`;
const money = (amountMinor = '150000', currency = 'SYP') => ({ currency, amountMinor, scale: 2 });
const code = (reply: HttpReply) => (reply.body.error as { code?: string } | undefined)?.code;
const prismas: PrismaService[] = [];
const replicas: BillingHttpHarness[] = [];
let identity: Stub;
let pricing: PricingStub;
let clock: FixedClock;
let sql: Client;
let a: BillingHttpHarness;
let b: BillingHttpHarness;
let removedMerchant: BillingHttpHarness;
let receiptFailure: BillingHttpHarness;

async function replica(options: { merchants?: string; failReceipt?: boolean } = {}) {
  const prisma = new PrismaService(DATABASE_URL!);
  prismas.push(prisma);
  const repository = new PrismaBillingRepository(prisma);
  const faulting: BillingRepository = new Proxy(repository, {
    get(target, property, receiver): unknown {
      if (property === 'transaction' && options.failReceipt)
        return <T>(work: (uow: BillingUnitOfWork) => Promise<T>): Promise<T> =>
          target.transaction((uow) =>
            work(
              new Proxy(uow, {
                get(unit, field, unitReceiver): unknown {
                  if (field === 'saveReceipt')
                    return () => Promise.reject(new Error('TEST_RECEIPT_WRITE_FAILURE'));
                  const value: unknown = Reflect.get(unit, field, unitReceiver);
                  return typeof value === 'function' ? value.bind(unit) : value;
                },
              }),
            ),
          );
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const runtime = await startBillingHttp({
    repository: faulting,
    clock,
    identity,
    pricing,
    providers: productionProviderRegistry({
      BILLING_SHAM_CASH_MERCHANT_ACCOUNTS:
        options.merchants ?? `${MERCHANTS.SHAM_CASH},${SECOND_MERCHANT}`,
      BILLING_SYRIATEL_CASH_MERCHANT_ACCOUNTS: MERCHANTS.SYRIATEL_CASH,
    }),
  });
  replicas.push(runtime);
  return runtime;
}

before(async () => {
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  identity = await startIdentityStub(SESSIONS);
  pricing = await startPricingStub();
  a = await replica();
  b = await replica();
  removedMerchant = await replica({ merchants: SECOND_MERCHANT });
  receiptFailure = await replica({ failReceipt: true });
  sql = new Client({ connectionString: DATABASE_URL });
  await sql.connect();
});

after(async () => {
  for (const runtime of replicas) await runtime.close();
  for (const prisma of prismas) await prisma.onModuleDestroy();
  await identity?.close();
  await pricing?.close();
  await sql?.end();
});

async function claim() {
  const quoteId = randomUUID();
  const reference = `TX-${randomUUID()}`;
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: '150000',
  });
  const created = await a.request('POST', `${PATH}/obligations`, {
    token: TOKENS.customer,
    key: key(),
    body: { quoteId },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const obligationId = String(created.body.obligationId);
  const intent = await a.request('POST', `${PATH}/obligations/${obligationId}/payment-intents`, {
    token: TOKENS.customer,
    key: key(),
    body: { expectedRevision: 1, method: 'SHAM_CASH' },
  });
  assert.equal(intent.status, 201, JSON.stringify(intent.body));
  const submitted = await a.request(
    'POST',
    `${PATH}/obligations/${obligationId}/payment-attempts`,
    {
      token: TOKENS.customer,
      key: key(),
      body: { expectedRevision: 2, providerReference: reference },
    },
  );
  assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
  const parsed = billingV1.parseObligationV1(submitted.body);
  const attemptId = parsed.attempts[0]?.attemptId;
  assert.ok(attemptId);
  return { obligationId, attemptId, reference };
}

async function credit(
  subject: Awaited<ReturnType<typeof claim>>,
  options: {
    amount?: ReturnType<typeof money>;
    provider?: 'SHAM_CASH' | 'SYRIATEL_CASH';
    merchantAccount?: string;
    token?: string;
  } = {},
) {
  const recorded = await recordStatement(
    a,
    {
      provider: options.provider ?? 'SHAM_CASH',
      reference: subject.reference,
      amount: options.amount ?? money(),
      occurredAt: clock.now(),
      ...(options.merchantAccount ? { merchantAccount: options.merchantAccount } : {}),
    },
    { token: options.token ?? TOKENS.reconciler },
  );
  assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
  assert.equal(recorded.body.status, 'PENDING_APPROVAL');
  return String(recorded.body.creditId);
}

function allocationBody(creditId: string) {
  return { creditId, expectedCreditRevision: 1, expectedRevision: 3, observedAmount: money() };
}

function allocate(
  runtime: BillingHttpHarness,
  attemptId: string,
  body: unknown,
  options: { token?: string; key?: string; correlationId?: string } = {},
) {
  return runtime.request(
    'POST',
    `${PATH}/payment-attempts/${attemptId}/statement-credit-allocation`,
    {
      token: options.token ?? TOKENS.approver,
      key: options.key ?? key(),
      body,
      ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    },
  );
}

async function unchanged(subject: Awaited<ReturnType<typeof claim>>, creditId: string) {
  const obligation = await a.request('GET', `${PATH}/obligations/${subject.obligationId}`, {
    token: TOKENS.customer,
  });
  const parsed = billingV1.parseObligationV1(obligation.body);
  assert.equal(parsed.status, 'OPEN');
  assert.equal(parsed.verified.amountMinor, '0');
  assert.equal(parsed.attempts[0]?.status, 'PENDING_REVIEW');
  const stored = await a.request('GET', `${PATH}/provider-credits/${creditId}`, {
    token: TOKENS.finance,
  });
  assert.equal(stored.body.status, 'PENDING_APPROVAL');
  assert.equal(stored.body.revision, 1);
  const counts = await sql.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM app.ledger_journal WHERE credit_id = $1',
    [creditId],
  );
  assert.equal(counts.rows[0]?.n, 0, 'a rejected command cannot confirm or allocate money');
}

test('selected statement credit: concurrent same-key commands allocate once, with exact owner audit and public contract', async () => {
  const subject = await claim();
  const creditId = await credit(subject);
  const body = allocationBody(creditId);
  assert.deepEqual(billingV1.parseAllocateStatementCreditRequestV1(body), body);
  const correlationId = randomUUID();
  const commandKey = key();
  const replies = await Promise.all(
    [a, b].map((runtime) =>
      allocate(runtime, subject.attemptId, body, { key: commandKey, correlationId }),
    ),
  );
  for (const reply of replies) {
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const settled = billingV1.parseObligationV1(reply.body);
    assert.equal(settled.financialStatus, 'PAID');
    assert.equal(settled.verified.amountMinor, '150000');
    assert.equal(settled.outstanding.amountMinor, '0');
    assert.equal(settled.attempts[0]?.status, 'MATCHED');
  }
  assert.deepEqual(replies[0]?.body, replies[1]?.body);
  const audit = await sql.query<{ action: string; actor: string; outcome: string }>(
    'SELECT action, actor_subject::text AS actor, outcome FROM app.billing_audit_event WHERE correlation_id = $1 ORDER BY action',
    [correlationId],
  );
  assert.deepEqual(audit.rows, [
    { action: 'billing.credit.allocated', actor: SUBJECTS.approver, outcome: 'MATCHED' },
    { action: 'billing.credit.approved', actor: SUBJECTS.approver, outcome: 'ALLOCATED' },
  ]);
  const journals = await sql.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM app.ledger_journal WHERE credit_id = $1',
    [creditId],
  );
  assert.equal(journals.rows[0]?.n, 2, 'one received journal and one allocated journal');
  const altered = await allocate(
    a,
    subject.attemptId,
    { ...body, observedAmount: money('149999') },
    { key: commandKey },
  );
  assert.equal(altered.status, 409);
  assert.equal(code(altered), 'IDEMPOTENCY_CONFLICT');
  const allocatedAgain = await allocate(a, subject.attemptId, {
    ...body,
    expectedCreditRevision: 2,
    expectedRevision: 4,
  });
  assert.equal(allocatedAgain.status, 409);
  assert.equal(code(allocatedAgain), 'CREDIT_NOT_PENDING');
});

test('selected statement credit: recorder, beneficiary and unauthorized roles cannot approve their own or others money', async () => {
  const subject = await claim();
  const creditId = await credit(subject);
  for (const token of [
    TOKENS.reconciler,
    TOKENS.selfReconciler,
    TOKENS.finance,
    TOKENS.customer,
    TOKENS.technician,
  ]) {
    const denied = await allocate(a, subject.attemptId, allocationBody(creditId), { token });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    await unchanged(subject, creditId);
  }
});

test('selected statement credit: a selected credit for another exact attempt cannot settle the displayed claim', async () => {
  const subject = await claim();
  const other = await claim();
  const creditId = await credit(other);
  const denied = await allocate(a, subject.attemptId, allocationBody(creditId));
  assert.equal(denied.status, 409);
  assert.equal(code(denied), 'PROVIDER_CREDIT_CONFLICT');
  await unchanged(subject, creditId);
  await unchanged(other, creditId);
});

for (const [name, amount, provider] of [
  ['amount mismatch', money('149999'), 'SHAM_CASH'],
  ['currency mismatch', money('150000', 'USD'), 'SHAM_CASH'],
  ['provider mismatch', money(), 'SYRIATEL_CASH'],
] as const)
  test(`selected statement credit: ${name} cannot confirm money`, async () => {
    const subject = await claim();
    const creditId = await credit(subject, { amount, provider });
    const denied = await allocate(a, subject.attemptId, {
      ...allocationBody(creditId),
      observedAmount: amount,
    });
    assert.equal(denied.status, 409, JSON.stringify(denied.body));
    assert.equal(code(denied), 'PROVIDER_CREDIT_CONFLICT');
    await unchanged(subject, creditId);
  });

test('selected statement credit: removed merchant and stale revisions fail without partial approval', async () => {
  const subject = await claim();
  const creditId = await credit(subject);
  const merchant = await allocate(removedMerchant, subject.attemptId, allocationBody(creditId));
  assert.equal(merchant.status, 422);
  assert.equal(code(merchant), 'MERCHANT_ACCOUNT_UNKNOWN');
  for (const body of [
    { ...allocationBody(creditId), expectedRevision: 2 },
    { ...allocationBody(creditId), expectedCreditRevision: 2 },
  ]) {
    const denied = await allocate(a, subject.attemptId, body);
    assert.equal(denied.status, 412);
    assert.equal(code(denied), 'REVISION_CONFLICT');
  }
  await unchanged(subject, creditId);
});

test('selected statement credit: ambiguous cross-merchant references require resolving the independent records first', async () => {
  const subject = await claim();
  const first = await credit(subject);
  const second = await credit(subject, { merchantAccount: SECOND_MERCHANT });
  for (const creditId of [first, second]) {
    const denied = await allocate(a, subject.attemptId, allocationBody(creditId));
    assert.equal(denied.status, 409);
    assert.equal(code(denied), 'PROVIDER_CREDIT_CONFLICT');
    await unchanged(subject, creditId);
  }
  const rejected = await decideStatement(a, second, 1, 'REJECT');
  assert.equal(rejected.status, 200);
  const settled = await allocate(a, subject.attemptId, allocationBody(first));
  assert.equal(settled.status, 200);
  assert.equal(billingV1.parseObligationV1(settled.body).financialStatus, 'PAID');
});

test('selected statement credit: receipt-write failure rolls back credit, money, audit and outbox; retry acts once', async () => {
  const subject = await claim();
  const creditId = await credit(subject);
  const correlationId = randomUUID();
  const commandKey = key();
  const failed = await allocate(receiptFailure, subject.attemptId, allocationBody(creditId), {
    correlationId,
    key: commandKey,
  });
  assert.equal(failed.status, 500);
  await unchanged(subject, creditId);
  const audits = await sql.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM app.billing_audit_event WHERE correlation_id = $1',
    [correlationId],
  );
  assert.equal(audits.rows[0]?.n, 0);
  const outbox = await sql.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM app.outbox_message WHERE correlation_id = $1',
    [correlationId],
  );
  assert.equal(outbox.rows[0]?.n, 0);
  const retried = await allocate(b, subject.attemptId, allocationBody(creditId), {
    correlationId,
    key: commandKey,
  });
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(billingV1.parseObligationV1(retried.body).financialStatus, 'PAID');
});

test('selected statement credit: closed public input rejects missing, floating-point and extra fields before effects', async () => {
  const subject = await claim();
  const creditId = await credit(subject);
  const good = allocationBody(creditId);
  for (const invalid of [
    { ...good, creditId: 'not-an-id' },
    { ...good, expectedCreditRevision: 0 },
    { ...good, expectedRevision: 3.5 },
    { ...good, observedAmount: { currency: 'SYP', amountMinor: 150000, scale: 2 } },
    { ...good, observedAmount: money('150000.00') },
    { ...good, extra: true },
    { expectedRevision: 3, observedAmount: money() },
  ]) {
    assert.throws(() => billingV1.parseAllocateStatementCreditRequestV1(invalid));
    const denied = await allocate(a, subject.attemptId, invalid);
    assert.equal(denied.status, 400, JSON.stringify(denied.body));
    assert.equal(code(denied), 'REQUEST_INVALID');
  }
  await unchanged(subject, creditId);
});
