import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaBillingRepository } from '../../src/infrastructure/persistence/prisma-billing.repository';
import { PrismaFinanceReadModel } from '../../src/infrastructure/persistence/prisma-finance.read-model';
import {
  FixedClock,
  SESSIONS,
  SUBJECTS,
  TOKENS,
  startBillingHttp,
  type BillingHttpHarness,
  type HttpReply,
} from '../support/billing-http-harness';
import { startFinanceHttp, type FinanceHttpHarness } from '../support/finance-http-harness';
import { acceptanceProviders, approvedStatement, evidence } from '../support/provider-flows';
import {
  startIdentityStub,
  startPricingStub,
  type PricingStub,
  type Stub,
} from '../support/upstream-stubs';
import { WorkDouble } from '../support/work-double';

/*
 * REAL PostgreSQL evidence for the admin finance reads (P06-B6), run as the
 * least-privileged runtime role on a database migrated by the migration role
 * (scripts/production/B/postgres-acceptance.mjs --service billing).
 *
 * ISOLATED SPEC: the acceptance script runs this file ALONE after the parallel
 * integration batch, because it asserts exact database-wide summary deltas
 * (another spec writing concurrently would make a delta meaningless). The data
 * other specs left behind is part of the "before" snapshot.
 *
 * Commands go through the real BillingService / CashCustodyService /
 * provider and refund services over HTTP; Identity and Pricing are local HTTP
 * doubles, work completion is the lane C test double. RabbitMQ is not used.
 */
const APP_URL = process.env.BILLING_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('BILLING_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;
const PATH = '/internal/v1/billing';
const SEED = 20261011;

let prismaA: PrismaService;
let prismaB: PrismaService;
let identity: Stub;
let pricing: PricingStub;
let clock: FixedClock;
let work: WorkDouble;
let replicaA: BillingHttpHarness;
let replicaB: BillingHttpHarness;
let financeA: FinanceHttpHarness;
let financeB: FinanceHttpHarness;
let seq = 0;
const key = () => `pg-finance-key-${String(++seq).padStart(6, '0')}-${process.pid}`;

before(async () => {
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000 + 3_600_000));
  identity = await startIdentityStub(SESSIONS);
  pricing = await startPricingStub();
  work = new WorkDouble();
  prismaA = new PrismaService(DATABASE_URL);
  prismaB = new PrismaService(DATABASE_URL);
  const replica = (prisma: PrismaService) =>
    startBillingHttp({
      repository: new PrismaBillingRepository(prisma),
      clock,
      identity,
      pricing,
      work,
      providers: acceptanceProviders(),
    });
  replicaA = await replica(prismaA);
  replicaB = await replica(prismaB);
  financeA = await startFinanceHttp({
    readModel: new PrismaFinanceReadModel(prismaA),
    clock,
    identity,
  });
  financeB = await startFinanceHttp({
    readModel: new PrismaFinanceReadModel(prismaB),
    clock,
    identity,
  });
});

after(async () => {
  for (const harness of [replicaA, replicaB, financeA, financeB]) await harness?.close();
  await prismaA?.onModuleDestroy();
  await prismaB?.onModuleDestroy();
  await identity?.close();
  await pricing?.close();
});

// ---------------------------------------------------------------- helpers

type Currency = 'SYP' | 'USD';
const money = (currency: Currency, amountMinor: bigint) => ({
  currency,
  amountMinor: amountMinor.toString(),
  scale: 2,
});

function ok(reply: HttpReply, status: number, what: string): Record<string, unknown> {
  assert.equal(reply.status, status, `${what}: ${JSON.stringify(reply.body)}`);
  return reply.body;
}

function post(replica: BillingHttpHarness, path: string, token: string, body: unknown) {
  return replica.request('POST', `${PATH}${path}`, { token, key: key(), body });
}

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const PATHS = [
  'UNPAID',
  'VOIDED',
  'AWAITING_CASH',
  'CASH_COLLECTED',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
  'MISMATCHED',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUND_IN_FLIGHT',
] as const;
type Path = (typeof PATHS)[number];

/** What the model expects one obligation to contribute to the summary. */
interface Expected {
  readonly obligationId: string;
  readonly currency: Currency;
  readonly status: 'OPEN' | 'SETTLED' | 'VOIDED';
  readonly financialStatus: string;
  readonly amount: bigint;
  readonly verified: bigint;
  readonly attempt: 'PENDING_REVIEW' | 'MATCHED' | 'MISMATCHED' | 'UNKNOWN' | null;
  readonly heldReceipt: boolean;
  readonly allocatedCredit: boolean;
  readonly refund: { status: 'SUCCEEDED' | 'APPROVED'; amount: bigint } | null;
}

/** Drives ONE obligation along a path through the real services; returns the model. */
async function drive(
  replica: BillingHttpHarness,
  path: Path,
  currency: Currency,
  amount: bigint,
): Promise<Expected> {
  const quoteId = randomUUID();
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency,
    totalMinor: amount.toString(),
  });
  const created = ok(
    await post(replica, '/obligations', TOKENS.customer, { quoteId }),
    201,
    'create',
  );
  const obligationId = String(created.obligationId);
  const base: Expected = {
    obligationId,
    currency,
    status: 'OPEN',
    financialStatus: 'UNPAID',
    amount,
    verified: 0n,
    attempt: null,
    heldReceipt: false,
    allocatedCredit: false,
    refund: null,
  };
  if (path === 'UNPAID') return base;
  if (path === 'VOIDED') {
    ok(
      await post(replica, `/obligations/${obligationId}/void`, TOKENS.customer, {
        expectedRevision: 1,
      }),
      200,
      'void',
    );
    return { ...base, status: 'VOIDED', financialStatus: 'VOIDED' };
  }
  if (path === 'AWAITING_CASH' || path === 'CASH_COLLECTED') {
    ok(
      await post(replica, `/obligations/${obligationId}/payment-intents`, TOKENS.customer, {
        expectedRevision: 1,
        method: 'CASH_ON_COMPLETION',
      }),
      201,
      'cash intent',
    );
    if (path === 'AWAITING_CASH') return { ...base, financialStatus: 'AWAITING_CASH' };
    const booking = work.book({ quoteId, technicianSubject: SUBJECTS.technician });
    ok(
      await post(replica, `/obligations/${obligationId}/cash-collections`, TOKENS.technician, {
        expectedRevision: 2,
        bookingId: booking.bookingId,
        amount: money(currency, amount),
      }),
      201,
      'collect',
    );
    return {
      ...base,
      status: 'SETTLED',
      financialStatus: 'CASH_COLLECTED',
      verified: amount,
      heldReceipt: true,
    };
  }
  const method = amount % 2n === 0n ? 'SHAM_CASH' : 'SYRIATEL_CASH';
  ok(
    await post(replica, `/obligations/${obligationId}/payment-intents`, TOKENS.customer, {
      expectedRevision: 1,
      method,
    }),
    201,
    'electronic intent',
  );
  if (path === 'AWAITING_PAYMENT') return { ...base, financialStatus: 'AWAITING_PAYMENT' };
  const ref = `FIN-${randomUUID().slice(0, 13)}`.toUpperCase();
  const submitted = ok(
    await post(replica, `/obligations/${obligationId}/payment-attempts`, TOKENS.customer, {
      expectedRevision: 2,
      providerReference: ref,
    }),
    202,
    'attempt',
  );
  const attemptId = String((submitted.attempts as { attemptId: string }[])[0]?.attemptId);
  if (path === 'UNDER_REVIEW')
    return { ...base, financialStatus: 'UNDER_REVIEW', attempt: 'PENDING_REVIEW' };
  if (path === 'OUTCOME_UNKNOWN' || path === 'MISMATCHED') {
    const outcome = path === 'OUTCOME_UNKNOWN' ? 'UNKNOWN' : 'MISMATCHED';
    ok(
      await post(replica, `/payment-attempts/${attemptId}/reconciliation`, TOKENS.reconciler, {
        expectedRevision: 3,
        outcome,
        observedAmount: null,
      }),
      200,
      `reconcile ${outcome}`,
    );
    return path === 'OUTCOME_UNKNOWN'
      ? { ...base, financialStatus: 'OUTCOME_UNKNOWN', attempt: 'UNKNOWN' }
      : { ...base, financialStatus: 'AWAITING_PAYMENT', attempt: 'MISMATCHED' };
  }
  const credit = await approvedStatement(replica, {
    provider: method,
    reference: ref,
    amount: money(currency, amount),
    occurredAt: clock.now(),
  });
  assert.equal(credit.status, 'ALLOCATED');
  const paid: Expected = {
    ...base,
    status: 'SETTLED',
    financialStatus: 'PAID',
    verified: amount,
    attempt: 'MATCHED',
    allocatedCredit: true,
  };
  if (path === 'PAID') return paid;
  const part = amount / 3n > 0n ? amount / 3n : 1n;
  const requested = ok(
    await post(replica, `/provider-credits/${String(credit.creditId)}/refunds`, TOKENS.refunder, {
      expectedRevision: 2,
      amount: money(currency, part),
      reason: 'BOOKING_CANCELLED',
    }),
    201,
    'refund request',
  );
  ok(
    await post(replica, `/refunds/${String(requested.refundId)}/decision`, TOKENS.refundApprover, {
      expectedRevision: 1,
      decision: 'APPROVE',
    }),
    200,
    'refund approval',
  );
  if (path === 'REFUND_IN_FLIGHT') return { ...paid, refund: { status: 'APPROVED', amount: part } };
  ok(
    await post(
      replica,
      `/refunds/${String(requested.refundId)}/manual-completion`,
      TOKENS.refundApprover,
      {
        expectedRevision: 2,
        outcome: 'SUCCEEDED',
        transferReference: `RF-${randomUUID().slice(0, 12)}`.toUpperCase(),
        evidenceDigest: evidence(),
      },
    ),
    200,
    'refund completion',
  );
  return {
    ...paid,
    financialStatus: part === amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    refund: { status: 'SUCCEEDED', amount: part },
  };
}

type Json = Record<string, unknown>;

async function summary(finance: FinanceHttpHarness = financeA): Promise<Json> {
  return ok(await finance.get('/summary', TOKENS.finance), 200, 'summary');
}

function currencyOf(body: Json, currency: Currency): Json {
  const found = (body.currencies as Json[]).find((c) => c.currency === currency);
  return found ?? {};
}

/** Reads a number or exact minor amount at a dotted path; absent = 0. */
function at(body: Json, path: string): bigint {
  let value: unknown = body;
  for (const part of path.split('.'))
    value = typeof value === 'object' && value !== null ? (value as Json)[part] : undefined;
  if (value === undefined) return 0n;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'object' && value !== null && 'amountMinor' in value)
    return BigInt(String((value as Json).amountMinor));
  throw new Error(`NOT_A_FIGURE ${path}`);
}

const FIGURES = [
  'obligations.count',
  'obligations.billed',
  'obligations.verified',
  'obligations.outstanding',
  ...['OPEN', 'SETTLED', 'VOIDED'].map((s) => `obligations.byStatus.${s}`),
  ...PATHS.filter((p) => p !== 'MISMATCHED' && p !== 'REFUND_IN_FLIGHT').map(
    (s) => `obligations.byFinancialStatus.${s}`,
  ),
  'obligations.byFinancialStatus.REFUNDED',
  ...['PENDING_REVIEW', 'MATCHED', 'MISMATCHED', 'UNKNOWN'].map((s) => `attempts.byStatus.${s}`),
  'attempts.awaitingReview',
  'cashCustody.inCustody',
  'cashCustody.receiptsByStatus.HELD',
  'providerCredits.byStatus.ALLOCATED',
  'providerCredits.confirmed',
  'refunds.byStatus.SUCCEEDED',
  'refunds.byStatus.APPROVED',
  'refunds.succeeded',
  'refunds.inFlight',
];

/** The model's expected contribution of a set of obligations to each figure. */
function modelDelta(models: readonly Expected[], currency: Currency): Map<string, bigint> {
  const mine = models.filter((m) => m.currency === currency);
  const delta = new Map<string, bigint>(FIGURES.map((figure) => [figure, 0n]));
  const add = (figure: string, value: bigint) => {
    assert.ok(delta.has(figure), figure);
    delta.set(figure, (delta.get(figure) ?? 0n) + value);
  };
  for (const m of mine) {
    add('obligations.count', 1n);
    add(`obligations.byStatus.${m.status}`, 1n);
    add(`obligations.byFinancialStatus.${m.financialStatus}`, 1n);
    if (m.status !== 'VOIDED') {
      add('obligations.billed', m.amount);
      add('obligations.outstanding', m.amount - m.verified);
    }
    add('obligations.verified', m.verified);
    if (m.attempt) add(`attempts.byStatus.${m.attempt}`, 1n);
    if (m.attempt === 'PENDING_REVIEW' || m.attempt === 'UNKNOWN')
      add('attempts.awaitingReview', 1n);
    if (m.heldReceipt) {
      add('cashCustody.inCustody', m.amount);
      add('cashCustody.receiptsByStatus.HELD', 1n);
    }
    if (m.allocatedCredit) {
      add('providerCredits.byStatus.ALLOCATED', 1n);
      add('providerCredits.confirmed', m.amount);
    }
    if (m.refund) {
      add(`refunds.byStatus.${m.refund.status}`, 1n);
      add(
        m.refund.status === 'SUCCEEDED' ? 'refunds.succeeded' : 'refunds.inFlight',
        m.refund.amount,
      );
    }
  }
  return delta;
}

// ---------------------------------------------------------------- tests

test('model-based: random command sequences through the real services; summary deltas equal the model', async () => {
  const random = prng(SEED);
  const before = await summary();
  assert.equal(before.ledgerConsistent, true, 'the data other specs left is ledger-consistent');
  const plan = Array.from({ length: 33 }, (_, i) => ({
    // Every path at least once, then random ones.
    path: i < PATHS.length ? PATHS[i] : PATHS[Math.floor(random() * PATHS.length)],
    currency: random() < 0.5 ? 'SYP' : 'USD',
    amount: BigInt(100 + Math.floor(random() * 900_000)),
  }));
  const models: Expected[] = [];
  // Every path once in order, then two obligations at a time on alternating
  // replicas (separate pools). The Identity double answers within the harness's
  // 1 s budget only at modest concurrency on a loaded CI host.
  for (let i = 0; i < plan.length; i += i < PATHS.length ? 1 : 2) {
    const batch = plan.slice(i, i < PATHS.length ? i + 1 : i + 2);
    models.push(
      ...(await Promise.all(
        batch.map((step, j) =>
          drive(
            (i + j) % 2 === 0 ? replicaA : replicaB,
            step.path ?? 'UNPAID',
            step.currency,
            step.amount,
          ),
        ),
      )),
    );
  }
  // The model is right about every obligation (checked against the owner view).
  for (const m of models) {
    const view = ok(
      await replicaA.request('GET', `${PATH}/obligations/${m.obligationId}`, {
        token: TOKENS.finance,
      }),
      200,
      'obligation',
    );
    assert.equal(view.financialStatus, m.financialStatus, m.obligationId);
    assert.equal(view.status, m.status);
  }
  const afterward = await summary(financeB);
  assert.equal(afterward.ledgerConsistent, true);
  for (const currency of ['SYP', 'USD'] as const) {
    const expected = modelDelta(models, currency);
    const was = currencyOf(before, currency);
    const now = currencyOf(afterward, currency);
    for (const [figure, value] of expected)
      assert.equal(at(now, figure) - at(was, figure), value, `${currency} ${figure}`);
    assert.deepEqual(now.ledger, { receivable: true, cleared: true, custody: true, refunds: true });
  }
  const text = JSON.stringify(afterward);
  for (const subject of Object.values(SUBJECTS))
    assert.equal(text.includes(subject), false, 'no subject in the summary');
});

test('snapshot: every summary taken while commands commit is ledger-consistent', async () => {
  const random = prng(SEED + 1);
  let running = true;
  const observed: Json[] = [];
  const reader = (async () => {
    while (running) observed.push(await summary(observed.length % 2 === 0 ? financeA : financeB));
  })();
  try {
    // Three writer lanes (two replicas) committing while the reader takes summaries.
    const lanes = [0, 1, 2].map(async (lane) => {
      for (let i = lane; i < 12; i += 3)
        await drive(
          i % 2 === 0 ? replicaA : replicaB,
          (['PAID', 'CASH_COLLECTED', 'PARTIALLY_REFUNDED', 'OUTCOME_UNKNOWN'] as const)[i % 4] ??
            'PAID',
          random() < 0.5 ? 'SYP' : 'USD',
          BigInt(1_000 + Math.floor(random() * 100_000)),
        );
    });
    await Promise.all(lanes);
  } finally {
    running = false;
    await reader;
  }
  observed.push(await summary());
  assert.ok(observed.length >= 2);
  for (const body of observed) assert.equal(body.ledgerConsistent, true, JSON.stringify(body));
});

test('queue: keyset pages are stable under concurrent inserts; the revision drives reconciliation', async () => {
  clock.advance(60_000);
  const existing = new Set<string>();
  for (let i = 0; i < 9; i += 1) {
    if (i % 3 === 0) clock.advance(1_000);
    const m = await drive(replicaA, 'UNDER_REVIEW', i % 2 === 0 ? 'SYP' : 'USD', BigInt(5_000 + i));
    const view = ok(
      await replicaA.request('GET', `${PATH}/obligations/${m.obligationId}`, {
        token: TOKENS.finance,
      }),
      200,
      'obligation',
    );
    existing.add(String((view.attempts as Json[])[0]?.attemptId));
  }
  const seen: Json[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const query: string = `/payment-attempts?status=PENDING_REVIEW&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
    const [reply] = await Promise.all([
      (pages % 2 === 0 ? financeA : financeB).get(query, TOKENS.reconciler),
      // A new claim lands between (and during) page reads.
      pages < 6
        ? drive(pages % 2 === 0 ? replicaB : replicaA, 'UNDER_REVIEW', 'SYP', 7_000n)
        : Promise.resolve(null),
    ]);
    const body = ok(reply, 200, 'queue page');
    const items = body.items as Json[];
    assert.ok(items.length <= 2);
    seen.push(...items);
    cursor = body.nextCursor as string | null;
    pages += 1;
  } while (cursor && pages < 10_000);
  const ids = seen.map((item) => String(item.attemptId));
  assert.equal(new Set(ids).size, ids.length, 'no attempt appears twice');
  for (const id of existing) assert.ok(ids.includes(id), `existing claim ${id} listed`);
  for (let i = 1; i < seen.length; i += 1) {
    const a = seen[i - 1] as Json;
    const b = seen[i] as Json;
    const order =
      String(a.submittedAt) < String(b.submittedAt) ||
      (a.submittedAt === b.submittedAt && String(a.attemptId) < String(b.attemptId));
    assert.ok(order, 'oldest first, ties by attempt id');
  }
  for (const item of seen) {
    assert.match(String(item.reference), /^…[A-Z0-9-]{4}$/);
    assert.equal(item.status, 'PENDING_REVIEW');
  }
  // The listed revision is the one the reconciliation command expects.
  const target = seen.find((item) => existing.has(String(item.attemptId)));
  assert.ok(target);
  ok(
    await post(
      replicaA,
      `/payment-attempts/${String(target.attemptId)}/reconciliation`,
      TOKENS.reconciler,
      {
        expectedRevision: target.obligationRevision,
        outcome: 'UNKNOWN',
        observedAmount: null,
      },
    ),
    200,
    'reconcile from queue',
  );
  const unknown = ok(
    await financeA.get('/payment-attempts?status=UNKNOWN&limit=100', TOKENS.finance),
    200,
    'unknown queue',
  );
  assert.ok(
    (unknown.items as Json[]).some((item) => item.attemptId === target.attemptId) ||
      unknown.nextCursor !== null,
  );
  // Customers never read the queue or the summary, even on the real adapter.
  assert.equal(
    (await financeA.get('/payment-attempts?status=UNKNOWN', TOKENS.customer)).status,
    403,
  );
  assert.equal((await financeA.get('/summary', TOKENS.customer)).status, 403);
  assert.equal((await financeA.get('/summary')).status, 401);
});
