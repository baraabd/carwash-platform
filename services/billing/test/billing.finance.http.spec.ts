import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Money, type FinanceFacts } from '../src/domain';
import type { AttemptQueueQuery, AttemptQueueRow, FinanceReadModel } from '../src/ports';
import { FixedClock, SESSIONS, TOKENS } from './support/billing-http-harness';
import { startFinanceHttp, type FinanceHttpHarness } from './support/finance-http-harness';
import { startIdentityStub, type Stub } from './support/upstream-stubs';

/*
 * Admin finance reads over real Nest transport and the real Identity adapter
 * (local Identity stub). The read model is an in-memory double here; the real
 * PostgreSQL adapter is proven in test/integration/billing.finance.postgres.spec.ts.
 */

const FULL_REFERENCE = 'SHAMTX12345678';

class MemoryReadModel implements FinanceReadModel {
  rows: AttemptQueueRow[] = [];
  queries: AttemptQueueQuery[] = [];
  facts: FinanceFacts = {
    obligations: [
      {
        currency: 'SYP',
        status: 'OPEN',
        activeIntent: { method: 'SHAM_CASH', status: 'UNDER_REVIEW' },
        hasUnknownAttempt: true,
        settledByCash: false,
        refund: 'NONE',
        count: 2,
        amountMinor: 300_000n,
        verifiedMinor: 0n,
      },
    ],
    attempts: [{ currency: 'SYP', status: 'UNKNOWN', count: 2, amountMinor: 300_000n }],
    receipts: [],
    handovers: [],
    credits: [],
    refunds: [],
    ledger: [
      {
        currency: 'SYP',
        receivableMinor: 300_000n,
        clearedMinor: 0n,
        custodyMinor: 0n,
        refundsPaidMinor: 0n,
      },
    ],
  };

  financeFacts(): Promise<FinanceFacts> {
    return Promise.resolve(this.facts);
  }

  attemptQueue(query: AttemptQueueQuery): Promise<readonly AttemptQueueRow[]> {
    this.queries.push(query);
    const after = query.after;
    return Promise.resolve(
      this.rows
        .filter((row) => row.status === query.status)
        .filter(
          (row) =>
            !after ||
            row.submittedAt.getTime() > after.submittedAt.getTime() ||
            (row.submittedAt.getTime() === after.submittedAt.getTime() &&
              row.attemptId > after.attemptId),
        )
        .sort(
          (a, b) =>
            a.submittedAt.getTime() - b.submittedAt.getTime() ||
            (a.attemptId < b.attemptId ? -1 : 1),
        )
        .slice(0, query.limit),
    );
  }
}

let identity: Stub;
let model: MemoryReadModel;
let http: FinanceHttpHarness;
const clock = new FixedClock(new Date('2026-10-11T08:00:00.000Z'));

before(async () => {
  identity = await startIdentityStub({
    ...SESSIONS,
    'finance-guest': { subject: randomUUID(), kind: 'guest', permissions: ['billing.read'] },
  });
  model = new MemoryReadModel();
  for (let i = 0; i < 7; i += 1)
    model.rows.push({
      attemptId: randomUUID(),
      obligationId: randomUUID(),
      obligationRevision: 3,
      intentId: randomUUID(),
      method: 'SHAM_CASH',
      status: i < 5 ? 'PENDING_REVIEW' : 'UNKNOWN',
      providerReference: FULL_REFERENCE,
      claimed: Money.of('SYP', 150_000n),
      submittedAt: new Date(Date.UTC(2026, 9, 11, 7, 0, i % 3)),
      reconciledAt: null,
    });
  http = await startFinanceHttp({ readModel: model, clock, identity });
});

after(async () => {
  await http?.close();
  await identity?.close();
});

const code = (body: Record<string, unknown>) => (body.error as { code?: string } | undefined)?.code;

test('auth matrix: deny by default; only staff accounts holding billing.read read finance', async () => {
  for (const path of ['/summary', '/payment-attempts?status=UNKNOWN']) {
    const anonymous = await http.get(path);
    assert.equal(anonymous.status, 401, path);
    assert.equal(code(anonymous.body), 'AUTH_REQUIRED');
    assert.equal((await http.get(path, TOKENS.unknown)).status, 401, `${path} unknown session`);
    for (const token of [
      TOKENS.customer,
      TOKENS.guest,
      TOKENS.technician,
      TOKENS.selfReconciler,
      // Holds billing.read but is a guest session: never a finance reader.
      tokenOf('finance-guest'),
    ]) {
      const denied = await http.get(path, token);
      assert.equal(denied.status, 403, `${path} must refuse`);
      assert.equal(code(denied.body), 'AUTH_FORBIDDEN');
    }
    for (const token of [TOKENS.finance, TOKENS.reconciler, TOKENS.treasury])
      assert.equal((await http.get(path, token)).status, 200, path);
  }
  identity.mode = 'error-500';
  try {
    const down = await http.get('/summary', TOKENS.finance);
    assert.equal(down.status, 503);
    assert.equal(code(down.body), 'AUTH_UNAVAILABLE');
  } finally {
    identity.mode = 'normal';
  }
});

test('authentication precedes validation: an anonymous bad query learns nothing', async () => {
  assert.equal((await http.get('/payment-attempts?status=NOPE')).status, 401);
  assert.equal((await http.get('/payment-attempts?status=NOPE', TOKENS.customer)).status, 403);
  const invalid = await http.get('/payment-attempts?status=NOPE', TOKENS.finance);
  assert.equal(invalid.status, 400);
  assert.equal(code(invalid.body), 'REQUEST_INVALID');
  for (const query of [
    '',
    '?status=UNKNOWN&status=MATCHED',
    '?status=UNKNOWN&limit=500',
    '?status=UNKNOWN&ownerSubject=x',
    '?status=UNKNOWN&cursor=%2F%2F',
  ])
    assert.equal((await http.get(`/payment-attempts${query}`, TOKENS.finance)).status, 400, query);
});

test('summary: exact money with scale, clock-stamped, no subjects or references', async () => {
  const reply = await http.get('/summary', TOKENS.finance);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.asOf, '2026-10-11T08:00:00.000Z');
  assert.equal(reply.body.ledgerConsistent, true);
  const [syp] = reply.body.currencies as Record<string, Record<string, unknown>>[];
  assert.ok(syp);
  assert.deepEqual(syp.obligations?.outstanding, {
    currency: 'SYP',
    amountMinor: '300000',
    scale: 2,
  });
  assert.equal((syp.obligations?.byFinancialStatus as Record<string, number>).OUTCOME_UNKNOWN, 2);
  assert.equal((syp.attempts as Record<string, unknown>).awaitingReview, 2);
  const text = JSON.stringify(reply.body);
  for (const subject of Object.values(SESSIONS).map((s) => s.subject))
    assert.equal(text.includes(subject), false, 'no subject in the summary');
});

test('queue: masked references, revision for the reconcile command, keyset pages without overlap', async () => {
  model.queries = [];
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const query: string = `/payment-attempts?status=PENDING_REVIEW&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
    const reply = await http.get(query, TOKENS.reconciler);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const items = reply.body.items as Record<string, unknown>[];
    for (const item of items) {
      assert.equal(item.reference, `…${FULL_REFERENCE.slice(-4)}`);
      assert.equal(item.obligationRevision, 3);
      assert.deepEqual(Object.keys(item).sort(), [
        'attemptId',
        'claimed',
        'intentId',
        'method',
        'obligationId',
        'obligationRevision',
        'reconciledAt',
        'reference',
        'status',
        'submittedAt',
      ]);
      seen.push(String(item.attemptId));
    }
    cursor = reply.body.nextCursor as string | null;
    pages += 1;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 5);
  assert.equal(JSON.stringify(seen).includes(FULL_REFERENCE), false);
  // The service asks one row more than the page to know whether a next page exists.
  assert.ok(model.queries.every((query) => query.limit === 3));
});

function tokenOf(name: string): string {
  return `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(name).toString('base64url')}.c2lnbmF0dXJl`;
}
