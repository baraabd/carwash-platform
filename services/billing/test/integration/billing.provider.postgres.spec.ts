import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { parseEnvelopeV2 } from '@carwash/event-contracts';
import { Money } from '../../src/domain';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaBillingRepository } from '../../src/infrastructure/persistence/prisma-billing.repository';
import { StaticProviderRegistry } from '../../src/infrastructure/providers/merchant-providers';
import { SecretValue } from '../../src/infrastructure/providers/secret-value';
import { PROVIDER_AUDIT_SUBJECTS, parseProviderCreditChangedData } from '../../src/application';
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
import { FakeSignedProvider, type FakeRefundMode } from '../support/fake-provider';
import {
  MERCHANTS,
  acceptanceProviders,
  approvedStatement,
  decideStatement,
  evidence,
  recordStatement,
} from '../support/provider-flows';

/*
 * REAL PostgreSQL evidence for P04-B provider credits, reconciliation and
 * refunds, run as the least-privileged runtime role (cw_billing_app) through
 * scripts/production/B/postgres-acceptance.mjs --service billing.
 *  - Replicas A/B run the PRODUCTION provider adapters (official documentation
 *    pending: statement evidence + manual refunds only).
 *  - Replicas C/D run a deterministic FAKE provider (test double, never a
 *    ShamCash/Syriatel protocol) to exercise the provider-neutral notification,
 *    verified-query and refund-API paths a real adapter will use.
 * Identity and Pricing are local HTTP test doubles. No broker is used.
 */
const APP_URL = process.env.BILLING_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('BILLING_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;
const PATH = '/internal/v1/billing';
const FAKE_MERCHANT = 'fake-merchant-01';

let prismas: PrismaService[] = [];
let identity: Stub;
let pricing: PricingStub;
let clock: FixedClock;
let replicaA: BillingHttpHarness;
let replicaB: BillingHttpHarness;
let replicaC: BillingHttpHarness;
let replicaD: BillingHttpHarness;
let fakeSham: FakeSignedProvider;
let fakeSyriatel: FakeSignedProvider;
let sql: Client;
let seq = 0;
const key = () => `pg-provider-${String(++seq).padStart(6, '0')}-${process.pid}`;

before(async () => {
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  identity = await startIdentityStub(SESSIONS);
  pricing = await startPricingStub();
  const secret = SecretValue.of('FAKE_WEBHOOK_SECRET', `fake-${randomUUID()}`);
  fakeSham = new FakeSignedProvider('SHAM_CASH', [FAKE_MERCHANT], secret);
  fakeSyriatel = new FakeSignedProvider('SYRIATEL_CASH', [FAKE_MERCHANT], secret);
  const fakes = new StaticProviderRegistry([fakeSham, fakeSyriatel]);
  const replica = async (
    providers: StaticProviderRegistry | ReturnType<typeof acceptanceProviders>,
  ) => {
    const prisma = new PrismaService(DATABASE_URL);
    prismas.push(prisma);
    return startBillingHttp({
      repository: new PrismaBillingRepository(prisma),
      clock,
      identity,
      pricing,
      providers,
    });
  };
  replicaA = await replica(acceptanceProviders());
  replicaB = await replica(acceptanceProviders());
  replicaC = await replica(fakes);
  replicaD = await replica(fakes);
  sql = new Client({ connectionString: DATABASE_URL.replace(/\?schema=app$/, '') });
  await sql.connect();
});

after(async () => {
  for (const replica of [replicaA, replicaB, replicaC, replicaD]) await replica?.close();
  for (const prisma of prismas) await prisma.onModuleDestroy();
  prismas = [];
  await identity?.close();
  await pricing?.close();
  await sql?.end();
});

// ---------------------------------------------------------------- helpers

const syp = (amountMinor: string) => ({ currency: 'SYP', amountMinor, scale: 2 });
const errorCode = (reply: HttpReply): unknown =>
  (reply.body.error as { code?: unknown } | undefined)?.code;
const reference = () => `TX-${randomUUID().slice(0, 8)}-${String(++seq)}`.toUpperCase();
const normalized = (ref: string) => ref.replaceAll('-', '').toUpperCase();

async function count(table: string, where: string, values: unknown[]): Promise<number> {
  const result = await sql.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM app.${table} WHERE ${where}`,
    values,
  );
  return Number(result.rows[0]?.n ?? '0');
}

/** Net (debit positive) of one account over the journals of one credit. */
async function creditNet(creditId: unknown, account: string): Promise<string> {
  const result = await sql.query<{ net: string | null }>(
    `SELECT SUM(CASE l.side WHEN 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END)::text AS net
       FROM app.ledger_line l JOIN app.ledger_journal j ON j.id = l.journal_id
      WHERE j.credit_id = $1 AND l.account = $2`,
    [creditId, account],
  );
  return result.rows[0]?.net ?? '0';
}

interface Claim {
  readonly obligationId: string;
  readonly attemptId: string;
  readonly ref: string;
}

/** An obligation with an electronic intent and one reported reference (revision 3). */
async function claim(
  options: {
    method?: 'SHAM_CASH' | 'SYRIATEL_CASH';
    total?: string;
    replica?: BillingHttpHarness;
  } = {},
): Promise<Claim> {
  const replica = options.replica ?? replicaA;
  const quoteId = randomUUID();
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: options.total ?? '150000',
  });
  const created = await replica.request('POST', `${PATH}/obligations`, {
    token: TOKENS.customer,
    key: key(),
    body: { quoteId },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const obligationId = String(created.body.obligationId);
  const intent = await replica.request(
    'POST',
    `${PATH}/obligations/${obligationId}/payment-intents`,
    {
      token: TOKENS.customer,
      key: key(),
      body: { expectedRevision: 1, method: options.method ?? 'SHAM_CASH' },
    },
  );
  assert.equal(intent.status, 201, JSON.stringify(intent.body));
  const ref = reference();
  const submitted = await submit(replica, obligationId, 2, ref);
  assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
  const attemptId = (submitted.body.attempts as { attemptId: string }[])[0]?.attemptId;
  assert.ok(attemptId);
  return { obligationId, attemptId, ref };
}

function submit(replica: BillingHttpHarness, obligationId: string, revision: number, ref: string) {
  return replica.request('POST', `${PATH}/obligations/${obligationId}/payment-attempts`, {
    token: TOKENS.customer,
    key: key(),
    body: { expectedRevision: revision, providerReference: ref },
  });
}

async function obligation(id: string): Promise<Record<string, unknown>> {
  const reply = await replicaA.request('GET', `${PATH}/obligations/${id}`, {
    token: TOKENS.customer,
  });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  return reply.body;
}

async function creditRow(id: unknown) {
  const result = await sql.query<{
    status: string;
    reason: string | null;
    attempt: string | null;
    revision: number;
  }>(
    `SELECT status, unallocated_reason AS reason, attempt_id::text AS attempt, revision
       FROM app.provider_credit WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

function notify(
  replica: BillingHttpHarness,
  fake: FakeSignedProvider,
  input: {
    ref: string;
    amount?: string;
    merchant?: string;
    type?: string;
    at?: Date;
    occurredAt?: Date;
  },
  tamper?: (raw: string) => string,
) {
  const at = input.at ?? clock.now();
  const signed = fake.sign(
    FakeSignedProvider.creditBody(
      {
        merchantAccount: input.merchant ?? FAKE_MERCHANT,
        reference: input.ref,
        amount: Money.of('SYP', BigInt(input.amount ?? '150000')),
        occurredAt: input.occurredAt ?? new Date(at.getTime() - 10_000),
      },
      input.type,
    ),
    at,
  );
  return replica.request('POST', `${PATH}/providers/${fake.provider.toLowerCase()}/notifications`, {
    raw: tamper ? tamper(signed.raw) : signed.raw,
    headers: signed.headers,
  });
}

function verify(
  replica: BillingHttpHarness,
  attemptId: string,
  options: { token?: string; key?: string } = {},
) {
  return replica.request('POST', `${PATH}/payment-attempts/${attemptId}/provider-verification`, {
    token: options.token ?? TOKENS.reconciler,
    key: options.key ?? key(),
    body: {},
  });
}

function requestRefund(
  replica: BillingHttpHarness,
  creditId: unknown,
  input: { revision: number; amount: string; reason: string },
  options: { token?: string; key?: string } = {},
) {
  return replica.request('POST', `${PATH}/provider-credits/${String(creditId)}/refunds`, {
    token: options.token ?? TOKENS.refunder,
    key: options.key ?? key(),
    body: { expectedRevision: input.revision, amount: syp(input.amount), reason: input.reason },
  });
}

function decideRefund(
  replica: BillingHttpHarness,
  refundId: unknown,
  revision: number,
  decision: 'APPROVE' | 'REJECT',
  options: { token?: string } = {},
) {
  return replica.request('POST', `${PATH}/refunds/${String(refundId)}/decision`, {
    token: options.token ?? TOKENS.refundApprover,
    key: key(),
    body: { expectedRevision: revision, decision },
  });
}

function completeManual(
  replica: BillingHttpHarness,
  refundId: unknown,
  revision: number,
  input: { outcome: 'SUCCEEDED' | 'FAILED'; transfer?: string | null },
  options: { token?: string } = {},
) {
  const succeeded = input.outcome === 'SUCCEEDED';
  return replica.request('POST', `${PATH}/refunds/${String(refundId)}/manual-completion`, {
    token: options.token ?? TOKENS.refundApprover,
    key: key(),
    body: {
      expectedRevision: revision,
      outcome: input.outcome,
      transferReference: succeeded ? (input.transfer ?? reference()) : null,
      evidenceDigest: succeeded ? evidence() : null,
    },
  });
}

function execute(replica: BillingHttpHarness, refundId: unknown, revision: number, k = key()) {
  return replica.request('POST', `${PATH}/refunds/${String(refundId)}/provider-execution`, {
    token: TOKENS.refunder,
    key: k,
    body: { expectedRevision: revision },
  });
}

async function approvedRefund(
  replica: BillingHttpHarness,
  creditId: unknown,
  amount: string,
  reason = 'BOOKING_CANCELLED',
  creditRevision = 2,
): Promise<string> {
  const requested = await requestRefund(replica, creditId, {
    revision: creditRevision,
    amount,
    reason,
  });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const approved = await decideRefund(replica, requested.body.refundId, 1, 'APPROVE');
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return String(requested.body.refundId);
}

async function rejected(statements: (string | [string, unknown[]])[], pattern: RegExp) {
  const client = new Client({ connectionString: DATABASE_URL.replace(/\?schema=app$/, '') });
  await client.connect();
  try {
    await client.query('BEGIN');
    let failure: unknown = null;
    try {
      for (const statement of statements) {
        if (typeof statement === 'string') await client.query(statement);
        else await client.query(statement[0], statement[1]);
      }
      await client.query('COMMIT');
    } catch (error: unknown) {
      failure = error;
    }
    await client.query('ROLLBACK').catch(() => undefined);
    assert.ok(failure instanceof Error, `expected ${String(pattern)}`);
    assert.match(failure.message, pattern);
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------- merchant statement path

test('statement: nothing changes until a second person approves; then it settles exactly once', async () => {
  const c = await claim({ total: '275050' });
  const recorded = await recordStatement(replicaA, {
    provider: 'SHAM_CASH',
    reference: c.ref,
    amount: syp('275050'),
    occurredAt: new Date(clock.now().getTime() - 60_000),
  });
  assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
  assert.equal(recorded.body.status, 'PENDING_APPROVAL');
  assert.equal(recorded.body.reference, `…${normalized(c.ref).slice(-4)}`);
  assert.equal(recorded.body.merchantAccount, `…${MERCHANTS.SHAM_CASH.slice(-4)}`);
  assert.equal((await obligation(c.obligationId)).financialStatus, 'UNDER_REVIEW');
  assert.equal(await count('ledger_journal', 'credit_id = $1', [recorded.body.creditId]), 0);

  clock.advance(1_000);
  const approved = await decideStatement(replicaB, recorded.body.creditId, 1, 'APPROVE');
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, 'ALLOCATED');
  assert.equal(approved.body.attemptId, c.attemptId);
  const view = await obligation(c.obligationId);
  assert.equal(view.financialStatus, 'PAID');
  assert.deepEqual(view.verified, syp('275050'));
  assert.equal(await creditNet(recorded.body.creditId, 'CLEARING_SHAM_CASH'), '275050');
  assert.equal(await creditNet(recorded.body.creditId, 'PROVIDER_CREDITS_UNALLOCATED'), '0');
  assert.equal(await creditNet(recorded.body.creditId, 'CUSTOMER_RECEIVABLE'), '-275050');

  const replay = await decideStatement(replicaA, recorded.body.creditId, 1, 'APPROVE', {
    token: TOKENS.approver,
  });
  assert.equal(errorCode(replay), 'REVISION_CONFLICT');
  const audit = await sql.query<{ action: string; subject: string }>(
    `SELECT action, actor_subject::text AS subject FROM app.billing_audit_event
      WHERE credit_id = $1 ORDER BY occurred_at, action`,
    [recorded.body.creditId],
  );
  assert.deepEqual(
    audit.rows.map((row) => `${row.action}:${row.subject}`).sort(),
    [
      `billing.credit.allocated:${SUBJECTS.approver}`,
      `billing.credit.approved:${SUBJECTS.approver}`,
      `billing.credit.recorded:${SUBJECTS.reconciler}`,
    ].sort(),
  );
  const events = await sql.query<{ payload: string }>(
    `SELECT payload FROM app.outbox_message
      WHERE event_type = 'billing.provider-credit-changed.v1' AND payload::jsonb #>> '{aggregate,id}' = $1
      ORDER BY (payload::jsonb #>> '{aggregate,version}')::int`,
    [recorded.body.creditId],
  );
  const statuses = events.rows.map((row) => {
    assert.equal(row.payload.includes(normalized(c.ref)), false, 'no reference in events');
    assert.equal(row.payload.includes(MERCHANTS.SHAM_CASH), false, 'no merchant in events');
    const envelope = parseEnvelopeV2(
      JSON.parse(row.payload),
      {
        eventType: 'billing.provider-credit-changed.v1',
        producer: 'billing',
        aggregateType: 'billing-provider-credit',
      },
      parseProviderCreditChangedData,
    );
    return envelope.data.status;
  });
  assert.deepEqual(statuses, ['PENDING_APPROVAL', 'ALLOCATED']);
});

test('statement: two people, never the owner, staff accounts with billing.reconcile only', async () => {
  const c = await claim();
  const line = {
    provider: 'SHAM_CASH' as const,
    reference: c.ref,
    amount: syp('150000'),
    occurredAt: clock.now(),
  };
  for (const token of [TOKENS.customer, TOKENS.finance, TOKENS.refunder, TOKENS.guest])
    assert.equal((await recordStatement(replicaA, line, { token })).status, 403);
  const recorded = await recordStatement(replicaA, line);
  assert.equal(recorded.status, 201);
  const self = await decideStatement(replicaA, recorded.body.creditId, 1, 'APPROVE', {
    token: TOKENS.reconciler,
  });
  assert.equal(self.status, 403);
  assert.equal(errorCode(self), 'SEPARATION_OF_DUTIES');
  const owner = await decideStatement(replicaA, recorded.body.creditId, 1, 'APPROVE', {
    token: TOKENS.selfReconciler,
  });
  assert.equal(errorCode(owner), 'SEPARATION_OF_DUTIES', 'an owner never approves own payment');
  assert.equal((await creditRow(recorded.body.creditId))?.status, 'PENDING_APPROVAL');

  // Recorded by the owner (who holds billing.reconcile): approval is refused too.
  const other = await claim();
  const byOwner = await recordStatement(
    replicaA,
    { ...line, reference: other.ref },
    { token: TOKENS.selfReconciler },
  );
  assert.equal(byOwner.status, 201);
  const approve = await decideStatement(replicaA, byOwner.body.creditId, 1, 'APPROVE');
  assert.equal(errorCode(approve), 'SEPARATION_OF_DUTIES');
  assert.equal((await obligation(other.obligationId)).financialStatus, 'UNDER_REVIEW');
});

test('statement: merchant account, time, duplicates and rejection', async () => {
  const c = await claim();
  const base = {
    provider: 'SHAM_CASH' as const,
    reference: c.ref,
    amount: syp('150000'),
    occurredAt: clock.now(),
  };
  const wrongAccount = await recordStatement(replicaA, { ...base, merchantAccount: 'not-ours' });
  assert.equal(errorCode(wrongAccount), 'MERCHANT_ACCOUNT_UNKNOWN');
  const otherProvider = await recordStatement(replicaA, {
    ...base,
    merchantAccount: MERCHANTS.SYRIATEL_CASH,
  });
  assert.equal(errorCode(otherProvider), 'MERCHANT_ACCOUNT_UNKNOWN');
  const future = await recordStatement(replicaA, {
    ...base,
    occurredAt: new Date(clock.now().getTime() + 60_000),
  });
  assert.equal(errorCode(future), 'OCCURRED_IN_FUTURE');
  const badDigest = await replicaA.request('POST', `${PATH}/provider-credits`, {
    token: TOKENS.reconciler,
    key: key(),
    body: {
      provider: 'SHAM_CASH',
      merchantAccount: MERCHANTS.SHAM_CASH,
      providerReference: c.ref,
      amount: syp('150000'),
      occurredAt: clock.now().toISOString(),
      evidenceDigest: 'not-a-digest',
    },
  });
  assert.equal(badDigest.status, 400);

  const wrongAmount = await recordStatement(replicaA, { ...base, amount: syp('140000') });
  assert.equal(wrongAmount.status, 201);
  const duplicate = await recordStatement(replicaB, base);
  assert.equal(errorCode(duplicate), 'PROVIDER_CREDIT_ALREADY_RECORDED');
  const rejection = await decideStatement(replicaA, wrongAmount.body.creditId, 1, 'REJECT');
  assert.equal(rejection.status, 200, JSON.stringify(rejection.body));
  assert.equal(rejection.body.status, 'REJECTED');
  assert.equal(rejection.body.rejectionReason, 'DETAILS_DIFFER');
  assert.equal(await count('ledger_journal', 'credit_id = $1', [wrongAmount.body.creditId]), 0);
  // The rejected line frees the reference: the correct line can be recorded.
  const credit = await approvedStatement(replicaA, base);
  assert.equal(credit.status, 'ALLOCATED');
  assert.equal((await obligation(c.obligationId)).financialStatus, 'PAID');
});

test('statement: a wrong amount is received but UNALLOCATED; the claim stays under review', async () => {
  const c = await claim();
  const credit = await approvedStatement(replicaA, {
    provider: 'SHAM_CASH',
    reference: c.ref,
    amount: syp('149999'),
    occurredAt: clock.now(),
  });
  assert.equal(credit.status, 'UNALLOCATED');
  assert.equal(credit.unallocatedReason, 'AMOUNT_MISMATCH');
  const view = await obligation(c.obligationId);
  assert.equal(view.financialStatus, 'UNDER_REVIEW');
  assert.deepEqual(view.verified, syp('0'));
  assert.equal(await creditNet(credit.creditId, 'CLEARING_SHAM_CASH'), '149999');
  assert.equal(await creditNet(credit.creditId, 'PROVIDER_CREDITS_UNALLOCATED'), '-149999');
  const queue = await replicaA.request(
    'GET',
    `${PATH}/provider-credits?status=UNALLOCATED&limit=200`,
    {
      token: TOKENS.finance,
    },
  );
  assert.equal(queue.status, 200);
  assert.ok(
    (queue.body.credits as { creditId: string }[]).some((x) => x.creditId === credit.creditId),
  );
  assert.equal(
    (
      await replicaA.request('GET', `${PATH}/provider-credits?status=UNALLOCATED`, {
        token: TOKENS.customer,
      })
    ).status,
    403,
  );
});

test('late claim: a credit that arrived first is allocated when the customer reports it', async () => {
  const quoteless = reference();
  const early = await approvedStatement(replicaA, {
    provider: 'SYRIATEL_CASH',
    reference: quoteless,
    amount: syp('150000'),
    occurredAt: clock.now(),
  });
  assert.equal(early.status, 'UNALLOCATED');
  assert.equal(early.unallocatedReason, 'NO_CLAIM');

  const quoteId = randomUUID();
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: '150000',
  });
  const created = await replicaB.request('POST', `${PATH}/obligations`, {
    token: TOKENS.customer,
    key: key(),
    body: { quoteId },
  });
  const id = String(created.body.obligationId);
  await replicaB.request('POST', `${PATH}/obligations/${id}/payment-intents`, {
    token: TOKENS.customer,
    key: key(),
    body: { expectedRevision: 1, method: 'SYRIATEL_CASH' },
  });
  const submitted = await submit(replicaB, id, 2, quoteless);
  assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
  assert.equal(submitted.body.financialStatus, 'PAID');
  assert.equal((await creditRow(early.creditId))?.status, 'ALLOCATED');
  const matched = await sql.query<{ kind: string | null; credit: string }>(
    `SELECT reconciled_by_kind AS kind, credit_id::text AS credit FROM app.payment_attempt
      WHERE obligation_id = $1`,
    [id],
  );
  assert.deepEqual(matched.rows[0], { kind: null, credit: early.creditId });
  assert.equal(await creditNet(early.creditId, 'PROVIDER_CREDITS_UNALLOCATED'), '0');
});

test('late arrival: a credit for a closed claim stays visible money, never erased or re-applied', async () => {
  const c = await claim();
  const mismatch = await replicaA.request(
    'POST',
    `${PATH}/payment-attempts/${c.attemptId}/reconciliation`,
    {
      token: TOKENS.reconciler,
      key: key(),
      body: { expectedRevision: 3, outcome: 'MISMATCHED', observedAmount: null },
    },
  );
  assert.equal(mismatch.status, 200, JSON.stringify(mismatch.body));
  const late = await approvedStatement(replicaA, {
    provider: 'SHAM_CASH',
    reference: c.ref,
    amount: syp('150000'),
    occurredAt: clock.now(),
  });
  assert.equal(late.status, 'UNALLOCATED');
  assert.equal(late.unallocatedReason, 'CLAIM_CLOSED');
  assert.equal((await obligation(c.obligationId)).financialStatus, 'AWAITING_PAYMENT');
});

test('production adapters: no automated capability is pretended; diagnostics are redacted', async () => {
  const c = await claim();
  const verification = await verify(replicaA, c.attemptId);
  assert.equal(verification.status, 409);
  assert.equal(errorCode(verification), 'PROVIDER_CAPABILITY_MISSING');
  for (const provider of ['sham_cash', 'syriatel_cash']) {
    const callback = await replicaA.request('POST', `${PATH}/providers/${provider}/notifications`, {
      raw: JSON.stringify({ type: 'credit.final' }),
    });
    assert.equal(callback.status, 404);
  }
  const diagnostics = await replicaA.request('GET', `${PATH}/providers`, { token: TOKENS.finance });
  assert.equal(diagnostics.status, 200);
  const text = JSON.stringify(diagnostics.body);
  assert.equal(text.includes(MERCHANTS.SHAM_CASH), false);
  assert.equal(text.includes(MERCHANTS.SYRIATEL_CASH), false);
  const providers = diagnostics.body.providers as {
    integration: string;
    capabilities: Record<string, unknown>;
    merchantAccountCount: number;
  }[];
  assert.deepEqual(
    providers.map((p) => [
      p.integration,
      p.capabilities.notifications,
      p.capabilities.refunds,
      p.merchantAccountCount,
    ]),
    [
      ['OFFICIAL_DOCUMENTATION_PENDING', false, 'MANUAL_OUT_OF_BAND', 1],
      ['OFFICIAL_DOCUMENTATION_PENDING', false, 'MANUAL_OUT_OF_BAND', 1],
    ],
  );
  assert.equal(
    (await replicaA.request('GET', `${PATH}/providers`, { token: TOKENS.customer })).status,
    403,
  );
});

// ---------------------------------------------------------------- authenticated notifications (fake provider)

test('notification: an authenticated final credit settles the open claim; provider-attributed', async () => {
  const c = await claim({ replica: replicaC });
  const reply = await notify(replicaC, fakeSham, { ref: c.ref });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.deepEqual(reply.body, { recorded: true }, 'the provider learns nothing else');
  assert.equal((await obligation(c.obligationId)).financialStatus, 'PAID');
  const attempt = await sql.query<{ kind: string | null; subject: string | null }>(
    `SELECT reconciled_by_kind AS kind, reconciled_by_subject::text AS subject
       FROM app.payment_attempt WHERE id = $1`,
    [c.attemptId],
  );
  assert.deepEqual(attempt.rows[0], { kind: null, subject: null });
  const audit = await sql.query<{ kind: string; subject: string }>(
    `SELECT DISTINCT actor_kind AS kind, actor_subject::text AS subject FROM app.billing_audit_event
      WHERE obligation_id = $1 AND action IN ('billing.credit.recorded', 'billing.credit.allocated')`,
    [c.obligationId],
  );
  assert.deepEqual(audit.rows, [{ kind: 'provider', subject: PROVIDER_AUDIT_SUBJECTS.SHAM_CASH }]);
  const event = await sql.query<{ actor: string }>(
    `SELECT payload::jsonb ->> 'actor' AS actor FROM app.outbox_message
      WHERE event_type = 'billing.obligation-status-changed.v1'
        AND payload::jsonb #>> '{aggregate,id}' = $1
        AND payload::jsonb #>> '{data,financialStatus}' = 'PAID'`,
    [c.obligationId],
  );
  assert.deepEqual(JSON.parse(event.rows[0]?.actor ?? 'null'), { kind: 'system', id: null });
});

test('notification: replays are idempotent, conflicting facts are refused, concurrency is safe', async () => {
  const c = await claim({ replica: replicaC });
  const at = clock.now();
  const [first, second] = await Promise.all([
    notify(replicaC, fakeSham, { ref: c.ref, at }),
    notify(replicaD, fakeSham, { ref: c.ref, at }),
  ]);
  assert.deepEqual(
    [first.status, second.status].sort(),
    [200, 201],
    JSON.stringify([first.body, second.body]),
  );
  const replay = await notify(replicaD, fakeSham, { ref: c.ref, at });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, { recorded: false, duplicate: true });
  assert.equal(await count('provider_credit', 'provider_reference = $1', [normalized(c.ref)]), 1);
  assert.equal(
    await count('ledger_journal', "obligation_id = $1 AND kind = 'CREDIT_ALLOCATED'", [
      c.obligationId,
    ]),
    1,
  );
  const conflict = await notify(replicaC, fakeSham, { ref: c.ref, amount: '150001' });
  assert.equal(conflict.status, 409);
  assert.equal(errorCode(conflict), 'PROVIDER_CREDIT_CONFLICT');
  assert.deepEqual((await obligation(c.obligationId)).verified, syp('150000'));
});

test('notification: forged, stale, foreign-merchant or pending notifications write nothing', async () => {
  const c = await claim({ replica: replicaC });
  const before = await count('provider_credit', 'provider_reference = $1', [normalized(c.ref)]);
  const forged = await notify(replicaC, fakeSham, { ref: c.ref }, (raw) =>
    raw.replace('"150000"', '"1"'),
  );
  assert.equal(forged.status, 401);
  assert.equal(errorCode(forged), 'NOTIFICATION_REJECTED');
  const stale = await notify(replicaC, fakeSham, {
    ref: c.ref,
    at: new Date(clock.now().getTime() - 10 * 60_000),
  });
  assert.equal(stale.status, 401);
  const foreign = await notify(replicaC, fakeSham, { ref: c.ref, merchant: 'someone-else' });
  assert.equal(foreign.status, 422);
  assert.equal(errorCode(foreign), 'MERCHANT_ACCOUNT_UNKNOWN');
  const future = await notify(replicaC, fakeSham, {
    ref: c.ref,
    occurredAt: new Date(clock.now().getTime() + 60_000),
  });
  assert.equal(errorCode(future), 'OCCURRED_IN_FUTURE');
  const pending = await notify(replicaC, fakeSham, { ref: c.ref, type: 'credit.pending' });
  assert.equal(pending.status, 202);
  const unsigned = await replicaC.request('POST', `${PATH}/providers/sham_cash/notifications`, {
    raw: JSON.stringify({ type: 'credit.final' }),
  });
  assert.equal(unsigned.status, 401);
  assert.equal(
    await count('provider_credit', 'provider_reference = $1', [normalized(c.ref)]),
    before,
  );
  assert.equal((await obligation(c.obligationId)).financialStatus, 'UNDER_REVIEW');
});

test('race: a claim and its credit arriving together always meet (reference lock)', async () => {
  for (let round = 0; round < 6; round += 1) {
    const quoteId = randomUUID();
    pricing.quotes.set(quoteId, {
      ownerToken: 'customer',
      status: 'USABLE',
      currency: 'SYP',
      totalMinor: '150000',
    });
    const created = await replicaC.request('POST', `${PATH}/obligations`, {
      token: TOKENS.customer,
      key: key(),
      body: { quoteId },
    });
    const id = String(created.body.obligationId);
    await replicaC.request('POST', `${PATH}/obligations/${id}/payment-intents`, {
      token: TOKENS.customer,
      key: key(),
      body: { expectedRevision: 1, method: 'SHAM_CASH' },
    });
    const ref = reference();
    const [submitted, notified] = await Promise.all([
      submit(round % 2 === 0 ? replicaC : replicaD, id, 2, ref),
      notify(round % 2 === 0 ? replicaD : replicaC, fakeSham, { ref }),
    ]);
    assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
    assert.equal(notified.status, 201, JSON.stringify(notified.body));
    const view = await obligation(id);
    assert.equal(view.financialStatus, 'PAID', `round ${String(round)}`);
  }
});

// ---------------------------------------------------------------- verified pull (fake provider)

test('verify: UNKNOWN is never success; a later verified answer settles; PENDING/NOT_FOUND change nothing', async () => {
  const c = await claim({ replica: replicaC });
  const notFound = await verify(replicaC, c.attemptId);
  assert.equal(notFound.status, 200, JSON.stringify(notFound.body));
  assert.equal(notFound.body.providerOutcome, 'NOT_FOUND');
  fakeSham.queries.set(normalized(c.ref), { kind: 'PENDING' });
  assert.equal((await verify(replicaC, c.attemptId)).body.providerOutcome, 'PENDING');
  assert.equal((await obligation(c.obligationId)).financialStatus, 'UNDER_REVIEW');

  fakeSham.queries.set(normalized(c.ref), 'THROW');
  const k = key();
  const unknown = await verify(replicaC, c.attemptId, { key: k });
  assert.equal(unknown.body.providerOutcome, 'UNKNOWN');
  assert.equal(
    (unknown.body.obligation as { financialStatus: string }).financialStatus,
    'OUTCOME_UNKNOWN',
  );
  const replayed = await verify(replicaD, c.attemptId, { key: k });
  assert.equal(replayed.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(replayed.body, unknown.body);

  fakeSham.found({
    merchantAccount: FAKE_MERCHANT,
    reference: c.ref,
    amount: Money.of('SYP', 150_000n),
    occurredAt: new Date(clock.now().getTime() - 5_000),
  });
  const found = await verify(replicaD, c.attemptId);
  assert.equal(found.body.providerOutcome, 'FOUND');
  assert.equal((found.body.credit as { source: string }).source, 'PROVIDER_QUERY');
  assert.equal((await obligation(c.obligationId)).financialStatus, 'PAID');
  assert.equal(errorCode(await verify(replicaD, c.attemptId)), 'ATTEMPT_NOT_OPEN');
  // Owner, finance-read-only and guest callers can never trigger verification.
  const other = await claim({ replica: replicaC });
  for (const token of [TOKENS.selfReconciler, TOKENS.finance, TOKENS.guest])
    assert.equal((await verify(replicaC, other.attemptId, { token })).status, 403);
});

test('verify: a foreign merchant or a different transaction is not evidence', async () => {
  const c = await claim({ replica: replicaC });
  fakeSham.found({
    merchantAccount: 'someone-else',
    reference: c.ref,
    amount: Money.of('SYP', 150_000n),
    occurredAt: clock.now(),
  });
  assert.equal(
    (await verify(replicaC, c.attemptId)).body.providerOutcome,
    'WRONG_MERCHANT_ACCOUNT',
  );
  fakeSham.queries.set(normalized(c.ref), {
    kind: 'FOUND_FINAL',
    fact: {
      merchantAccount: FAKE_MERCHANT,
      reference: 'SOMEOTHERREF',
      amount: Money.of('SYP', 150_000n),
      occurredAt: clock.now(),
    },
    evidenceDigest: createHash('sha256').update('x').digest('hex'),
  });
  assert.equal((await verify(replicaC, c.attemptId)).body.providerOutcome, 'UNKNOWN');
  assert.equal(await count('provider_credit', 'provider_reference = $1', [normalized(c.ref)]), 0);
  assert.equal((await obligation(c.obligationId)).financialStatus, 'OUTCOME_UNKNOWN');
});

// ---------------------------------------------------------------- refunds

async function paidByStatement(replica: BillingHttpHarness = replicaA) {
  const c = await claim({ replica });
  const credit = await approvedStatement(replica, {
    provider: 'SHAM_CASH',
    reference: c.ref,
    amount: syp('150000'),
    occurredAt: clock.now(),
  });
  assert.equal(credit.status, 'ALLOCATED');
  return { ...c, creditId: String(credit.creditId) };
}

test('refund (manual channel): request, approval, evidence, cumulative cap and REFUNDED status', async () => {
  const paid = await paidByStatement();
  const first = await approvedRefund(replicaA, paid.creditId, '50000');
  const view = await replicaA.request('GET', `${PATH}/refunds/${first}`, { token: TOKENS.finance });
  assert.equal(view.body.channel, 'MANUAL_OUT_OF_BAND');
  assert.equal(view.body.status, 'APPROVED');
  assert.equal(
    (await obligation(paid.obligationId)).financialStatus,
    'PAID',
    'approved is not refunded',
  );
  const tooMuch = await requestRefund(replicaA, paid.creditId, {
    revision: 2,
    amount: '100001',
    reason: 'BOOKING_CANCELLED',
  });
  assert.equal(errorCode(tooMuch), 'REFUND_EXCEEDS_AVAILABLE');
  const providerApi = await execute(replicaA, first, 2);
  assert.equal(errorCode(providerApi), 'REFUND_CHANNEL_MISMATCH');

  const done = await completeManual(replicaA, first, 2, { outcome: 'SUCCEEDED' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.status, 'SUCCEEDED');
  assert.match(String(done.body.providerRefundReference), /^…/);
  assert.equal((await obligation(paid.obligationId)).financialStatus, 'PARTIALLY_REFUNDED');
  assert.equal(await creditNet(paid.creditId, 'REFUNDS_CONTROL'), '50000');
  assert.equal(await creditNet(paid.creditId, 'CLEARING_SHAM_CASH'), '100000');

  const rest = await approvedRefund(replicaA, paid.creditId, '100000', 'SERVICE_NOT_DELIVERED');
  assert.equal((await completeManual(replicaA, rest, 2, { outcome: 'SUCCEEDED' })).status, 200);
  assert.equal((await obligation(paid.obligationId)).financialStatus, 'REFUNDED');
  assert.equal(await creditNet(paid.creditId, 'CLEARING_SHAM_CASH'), '0');
  const none = await requestRefund(replicaA, paid.creditId, {
    revision: 2,
    amount: '1',
    reason: 'BOOKING_CANCELLED',
  });
  assert.equal(errorCode(none), 'REFUND_EXCEEDS_AVAILABLE');
  const events = await count(
    'outbox_message',
    "event_type = 'billing.refund-changed.v1' AND payload::jsonb #>> '{data,creditId}' = $1",
    [paid.creditId],
  );
  assert.equal(events, 6);
});

test('refund: separation of duties, staff accounts only, failed transfers release the reservation', async () => {
  const paid = await paidByStatement();
  for (const token of [TOKENS.customer, TOKENS.finance, TOKENS.reconciler, TOKENS.guestRefunder])
    assert.equal(
      (
        await requestRefund(
          replicaA,
          paid.creditId,
          { revision: 2, amount: '1', reason: 'BOOKING_CANCELLED' },
          { token },
        )
      ).status,
      403,
    );
  const own = await requestRefund(
    replicaA,
    paid.creditId,
    { revision: 2, amount: '1', reason: 'BOOKING_CANCELLED' },
    { token: TOKENS.selfRefunder },
  );
  assert.equal(errorCode(own), 'SEPARATION_OF_DUTIES', 'nobody refunds their own payment');
  const requested = await requestRefund(replicaA, paid.creditId, {
    revision: 2,
    amount: '150000',
    reason: 'BOOKING_CANCELLED',
  });
  const refundId = requested.body.refundId;
  const selfApprove = await decideRefund(replicaA, refundId, 1, 'APPROVE', {
    token: TOKENS.refunder,
  });
  assert.equal(errorCode(selfApprove), 'SEPARATION_OF_DUTIES');
  assert.equal((await decideRefund(replicaA, refundId, 1, 'APPROVE')).status, 200);
  const selfComplete = await completeManual(
    replicaA,
    refundId,
    2,
    { outcome: 'SUCCEEDED' },
    { token: TOKENS.refunder },
  );
  assert.equal(errorCode(selfComplete), 'SEPARATION_OF_DUTIES');
  const missingEvidence = await replicaA.request(
    'POST',
    `${PATH}/refunds/${String(refundId)}/manual-completion`,
    {
      token: TOKENS.refundApprover,
      key: key(),
      body: {
        expectedRevision: 2,
        outcome: 'SUCCEEDED',
        transferReference: null,
        evidenceDigest: null,
      },
    },
  );
  assert.equal(missingEvidence.status, 400);
  const failed = await completeManual(replicaA, refundId, 2, { outcome: 'FAILED' });
  assert.equal(failed.body.status, 'FAILED');
  assert.equal(await creditNet(paid.creditId, 'REFUNDS_CONTROL'), '0');
  // The failed refund no longer reserves money: a new full refund is possible.
  assert.equal(
    (
      await requestRefund(replicaA, paid.creditId, {
        revision: 2,
        amount: '150000',
        reason: 'BOOKING_CANCELLED',
      })
    ).status,
    201,
  );
  const rejectedRefund = await requestRefund(replicaA, (await paidByStatement()).creditId, {
    revision: 2,
    amount: '10',
    reason: 'BOOKING_CANCELLED',
  });
  const rejection = await decideRefund(replicaA, rejectedRefund.body.refundId, 1, 'REJECT');
  assert.equal(rejection.body.status, 'REJECTED');
});

test('refund race: concurrent full refunds on two replicas reserve at most the credit', async () => {
  const paid = await paidByStatement();
  const results = await Promise.all(
    [replicaA, replicaB, replicaA, replicaB].map((replica) =>
      requestRefund(replica, paid.creditId, {
        revision: 2,
        amount: '150000',
        reason: 'BOOKING_CANCELLED',
      }),
    ),
  );
  assert.equal(
    results.filter((r) => r.status === 201).length,
    1,
    JSON.stringify(results.map((r) => r.body)),
  );
  assert.ok(
    results
      .filter((r) => r.status !== 201)
      .every((r) => errorCode(r) === 'REFUND_EXCEEDS_AVAILABLE'),
  );
  assert.equal(await count('payment_refund', 'credit_id = $1', [paid.creditId]), 1);
});

test('refund of unallocated money; a reserved credit is never applied to a late claim', async () => {
  const ref = reference();
  const early = await approvedStatement(replicaA, {
    provider: 'SHAM_CASH',
    reference: ref,
    amount: syp('150000'),
    occurredAt: clock.now(),
  });
  assert.equal(early.status, 'UNALLOCATED');
  const wrongReason = await requestRefund(replicaA, early.creditId, {
    revision: 2,
    amount: '150000',
    reason: 'BOOKING_CANCELLED',
  });
  assert.equal(errorCode(wrongReason), 'REFUND_REASON_NOT_ALLOWED');
  const refundId = await approvedRefund(replicaA, early.creditId, '150000', 'DUPLICATE_PAYMENT');

  const quoteId = randomUUID();
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: '150000',
  });
  const created = await replicaA.request('POST', `${PATH}/obligations`, {
    token: TOKENS.customer,
    key: key(),
    body: { quoteId },
  });
  const id = String(created.body.obligationId);
  await replicaA.request('POST', `${PATH}/obligations/${id}/payment-intents`, {
    token: TOKENS.customer,
    key: key(),
    body: { expectedRevision: 1, method: 'SHAM_CASH' },
  });
  const late = await submit(replicaA, id, 2, ref);
  assert.equal(late.status, 202);
  assert.equal(
    late.body.financialStatus,
    'UNDER_REVIEW',
    'money being refunded never pays a claim',
  );
  assert.equal((await creditRow(early.creditId))?.status, 'UNALLOCATED');

  assert.equal((await completeManual(replicaA, refundId, 2, { outcome: 'SUCCEEDED' })).status, 200);
  assert.equal(await creditNet(early.creditId, 'PROVIDER_CREDITS_UNALLOCATED'), '0');
  assert.equal(await creditNet(early.creditId, 'CLEARING_SHAM_CASH'), '0');
});

test('refund (provider API, fake): a lost answer is UNKNOWN, never success, and pays once', async () => {
  const c = await claim({ replica: replicaC });
  await notify(replicaC, fakeSham, { ref: c.ref });
  const creditId = (
    await sql.query<{ id: string }>(
      'SELECT id::text FROM app.provider_credit WHERE attempt_id = $1',
      [c.attemptId],
    )
  ).rows[0]?.id;
  const refundId = await approvedRefund(replicaC, creditId, '150000', 'BOOKING_CANCELLED', 1);
  fakeSham.refundModes.set(refundId, 'LOSE_ANSWER');
  const lost = await execute(replicaC, refundId, 2);
  assert.equal(lost.status, 200, JSON.stringify(lost.body));
  assert.equal(lost.body.status, 'UNKNOWN');
  assert.equal(await creditNet(creditId, 'REFUNDS_CONTROL'), '0', 'UNKNOWN posts nothing');
  assert.equal((await obligation(c.obligationId)).financialStatus, 'PAID');
  const blocked = await requestRefund(replicaC, creditId, {
    revision: 1,
    amount: '1',
    reason: 'BOOKING_CANCELLED',
  });
  assert.equal(errorCode(blocked), 'REFUND_EXCEEDS_AVAILABLE', 'UNKNOWN keeps the reservation');

  const resolved = await execute(replicaD, refundId, 3);
  assert.equal(resolved.body.status, 'SUCCEEDED');
  assert.deepEqual(fakeSham.submissions.filter((id) => id === refundId).length, 1);
  assert.equal(fakeSham.paidOut.get(refundId)?.amountMinor, 150_000n);
  assert.equal(await creditNet(creditId, 'REFUNDS_CONTROL'), '150000');
  assert.equal((await obligation(c.obligationId)).financialStatus, 'REFUNDED');
  assert.equal(errorCode(await execute(replicaD, refundId, 4)), 'REFUND_NOT_PENDING_AT_PROVIDER');
});

test('refund (provider API, fake): pending, failure, transport error and concurrent execution', async () => {
  const run = async (mode: FakeRefundMode) => {
    const c = await claim({ replica: replicaC });
    await notify(replicaC, fakeSham, { ref: c.ref });
    const creditId = (
      await sql.query<{ id: string }>(
        'SELECT id::text FROM app.provider_credit WHERE attempt_id = $1',
        [c.attemptId],
      )
    ).rows[0]?.id;
    const refundId = await approvedRefund(replicaC, creditId, '150000', 'BOOKING_CANCELLED', 1);
    fakeSham.refundModes.set(refundId, mode);
    return { creditId, refundId };
  };
  const pending = await run('PEND');
  const submitted = await execute(replicaC, pending.refundId, 2);
  assert.equal(submitted.body.status, 'SUBMITTED');
  assert.equal((await execute(replicaC, pending.refundId, 3)).body.status, 'SUCCEEDED');

  const failing = await run('FAIL');
  assert.equal((await execute(replicaC, failing.refundId, 2)).body.status, 'FAILED');
  assert.equal(await creditNet(failing.creditId, 'REFUNDS_CONTROL'), '0');
  assert.equal(
    (
      await requestRefund(replicaC, failing.creditId, {
        revision: 1,
        amount: '150000',
        reason: 'BOOKING_CANCELLED',
      })
    ).status,
    201,
  );

  const broken = await run('THROW');
  assert.equal((await execute(replicaC, broken.refundId, 2)).body.status, 'UNKNOWN');

  const racing = await run('SUCCEED');
  const results = await Promise.all([
    execute(replicaC, racing.refundId, 2),
    execute(replicaD, racing.refundId, 2),
  ]);
  assert.ok(
    results.some((r) => r.status === 200 && r.body.status === 'SUCCEEDED'),
    JSON.stringify(results.map((r) => r.body)),
  );
  assert.equal(fakeSham.paidOut.has(racing.refundId), true);
  assert.equal(
    await count('ledger_journal', "credit_id = $1 AND kind = 'REFUND_PAID'", [racing.creditId]),
    1,
  );
  assert.equal(await creditNet(racing.creditId, 'REFUNDS_CONTROL'), '150000');
});

test('refund: a transfer reference can evidence one refund only', async () => {
  const transfer = reference();
  const a = await paidByStatement();
  const b = await paidByStatement();
  const first = await approvedRefund(replicaA, a.creditId, '10');
  const second = await approvedRefund(replicaA, b.creditId, '10');
  assert.equal(
    (await completeManual(replicaA, first, 2, { outcome: 'SUCCEEDED', transfer })).status,
    200,
  );
  const reused = await completeManual(replicaA, second, 2, { outcome: 'SUCCEEDED', transfer });
  assert.equal(errorCode(reused), 'PROVIDER_REFUND_REFERENCE_TAKEN');
  assert.equal(
    await count('ledger_journal', "credit_id = $1 AND kind = 'REFUND_PAID'", [b.creditId]),
    0,
  );
});

// ---------------------------------------------------------------- database-enforced invariants

test('database: money cannot be recognised, edited, refunded or deleted around the rules', async () => {
  const c = await claim();
  // A claim cannot be MATCHED without an allocated credit written alongside.
  await rejected(
    [
      [
        `UPDATE app.payment_attempt SET status = 'MATCHED', reconciled_at = now(),
                reconciled_by_kind = 'account', reconciled_by_subject = $2, observed_minor = claimed_minor
          WHERE id = $1`,
        [c.attemptId, SUBJECTS.reconciler],
      ],
    ],
    /PAYMENT_ATTEMPT_MATCH_WITHOUT_CREDIT/,
  );
  // A statement credit cannot be born established.
  const forged = randomUUID();
  await rejected(
    [
      [
        `INSERT INTO app.provider_credit (id, provider, merchant_account, provider_reference, currency, amount_minor,
            occurred_at, source, evidence_digest, status, unallocated_reason, active_slot, recorded_by_subject,
            revision, created_at, updated_at, correlation_id)
         VALUES ($1, 'SHAM_CASH', 'x', 'FORGED1234', 'SYP', 150000, now(), 'MERCHANT_STATEMENT', $2,
                 'UNALLOCATED', 'NO_CLAIM', 1, $3, 1, now(), now(), $1)`,
        [forged, evidence(), SUBJECTS.reconciler],
      ],
    ],
    /PROVIDER_CREDIT_INCONSISTENT|provider_credit_decision/,
  );
  // A provider credit without its CREDIT_RECEIVED journal cannot commit.
  await rejected(
    [
      [
        `INSERT INTO app.provider_credit (id, provider, merchant_account, provider_reference, currency, amount_minor,
            occurred_at, source, evidence_digest, status, unallocated_reason, active_slot,
            revision, created_at, updated_at, correlation_id)
         VALUES ($1, 'SHAM_CASH', 'x', 'FORGED5678', 'SYP', 150000, now(), 'PROVIDER_NOTIFICATION', $2,
                 'UNALLOCATED', 'NO_CLAIM', 1, 1, now(), now(), $1)`,
        [forged, evidence()],
      ],
    ],
    /PROVIDER_CREDIT_LEDGER_MISMATCH/,
  );

  const paid = await paidByStatement();
  await rejected(
    [
      [
        'UPDATE app.provider_credit SET amount_minor = 1, revision = revision + 1 WHERE id = $1',
        [paid.creditId],
      ],
    ],
    /PROVIDER_CREDIT_IMMUTABLE_FIELD/,
  );
  await rejected(
    [
      [
        "UPDATE app.provider_credit SET status = 'UNALLOCATED', unallocated_reason = 'NO_CLAIM', attempt_id = NULL, obligation_id = NULL, revision = revision + 1 WHERE id = $1",
        [paid.creditId],
      ],
    ],
    /PROVIDER_CREDIT_INVALID_TRANSITION/,
  );
  await rejected(
    [['DELETE FROM app.provider_credit WHERE id = $1', [paid.creditId]]],
    /BILLING_APPEND_ONLY/,
  );
  await rejected(['TRUNCATE app.provider_credit'], /permission denied|BILLING_APPEND_ONLY/);
  // Reservations beyond the credit are refused even without the application.
  await rejected(
    [
      [
        `INSERT INTO app.payment_refund (id, credit_id, provider, currency, amount_minor, reason, channel, status,
            requested_by_subject, requested_at, revision, updated_at, correlation_id)
         VALUES ($1, $2, 'SHAM_CASH', 'SYP', 150001, 'BOOKING_CANCELLED', 'MANUAL_OUT_OF_BAND', 'REQUESTED',
                 $3, now(), 1, now(), $1)`,
        [randomUUID(), paid.creditId, SUBJECTS.refunder],
      ],
    ],
    /PAYMENT_REFUND_INCONSISTENT/,
  );
  // A refund cannot succeed without its journal, nor be decided by its requester.
  const refundId = await approvedRefund(replicaA, paid.creditId, '100');
  await rejected(
    [
      [
        `UPDATE app.payment_refund SET status = 'SUCCEEDED', completed_by_subject = $2, completed_at = now(),
                provider_refund_reference = 'FORGEDREF1', evidence_digest = $3, revision = revision + 1
          WHERE id = $1`,
        [refundId, SUBJECTS.refundApprover, evidence()],
      ],
    ],
    /PROVIDER_CREDIT_LEDGER_MISMATCH/,
  );
  const selfDecided = await requestRefund(replicaA, paid.creditId, {
    revision: 2,
    amount: '100',
    reason: 'BOOKING_CANCELLED',
  });
  await rejected(
    [
      [
        "UPDATE app.payment_refund SET status = 'APPROVED', decided_by_subject = requested_by_subject, decided_at = now(), revision = revision + 1 WHERE id = $1",
        [selfDecided.body.refundId],
      ],
    ],
    /payment_refund_separation/,
  );
  await rejected(
    [['DELETE FROM app.payment_refund WHERE id = $1', [refundId]]],
    /BILLING_APPEND_ONLY/,
  );
  // A stray refund journal (money out without a refund) cannot commit.
  const journal = randomUUID();
  await rejected(
    [
      [
        `INSERT INTO app.ledger_journal (id, kind, business_ref, credit_id, posted_at, correlation_id)
         VALUES ($1, 'REFUND_PAID', $2, $3, now(), $1)`,
        [journal, `refund:${journal}:paid`, paid.creditId],
      ],
      [
        `INSERT INTO app.ledger_line (journal_id, line_no, account, side, currency, amount_minor) VALUES
           ($1, 0, 'REFUNDS_CONTROL', 'DEBIT', 'SYP', 100), ($1, 1, 'CLEARING_SHAM_CASH', 'CREDIT', 'SYP', 100)`,
        [journal],
      ],
    ],
    /PROVIDER_CREDIT_LEDGER_MISMATCH/,
  );
  // Self-approval of a statement line is refused by the schema too.
  const pending = await recordStatement(replicaA, {
    provider: 'SHAM_CASH',
    reference: reference(),
    amount: syp('1'),
    occurredAt: clock.now(),
  });
  await rejected(
    [
      [
        "UPDATE app.provider_credit SET status = 'REJECTED', active_slot = NULL, rejection_reason = 'DETAILS_DIFFER', decided_by_subject = recorded_by_subject, decided_at = now(), revision = revision + 1 WHERE id = $1",
        [pending.body.creditId],
      ],
    ],
    /provider_credit_separation/,
  );
});
