import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ATTEMPT_STATUSES,
  CREDIT_STATUSES,
  CUSTODY_STATUSES,
  FINANCIAL_STATUSES,
  HANDOVER_STATUSES,
  INTENT_STATUSES,
  Money,
  OBLIGATION_STATUSES,
  PAYMENT_METHODS,
  REFUND_STATUSES,
  financialStatus,
  foldFinanceSummary,
  groupFinancialStatus,
  type FinanceFacts,
  type FinancialStatus,
  type IntentStatus,
  type LedgerFacts,
  type ObligationFactGroup,
  type ObligationStatus,
  type PaymentMethod,
  type RefundExtent,
  type StatusTally,
} from '../src/domain';
import {
  BillingApplicationError,
  QUEUE_DEFAULT_LIMIT,
  decodeQueueCursor,
  encodeQueueCursor,
  parseAttemptQueueQuery,
} from '../src/application';

/*
 * Finance summary fold (P06-B6). Model-based: random populations of individual
 * obligations are folded two ways — a naive per-obligation reference using the
 * real `financialStatus` with real amounts, and the production fold over the
 * grouped facts the read model returns. They must agree exactly.
 */

/** Deterministic PRNG so a failure is reproducible from the printed seed. */
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

function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error('EMPTY');
  return value;
}

interface Obligation {
  readonly currency: string;
  readonly status: ObligationStatus;
  readonly amount: bigint;
  readonly verified: bigint;
  readonly intent: { method: PaymentMethod; status: IntentStatus } | null;
  readonly hasUnknownAttempt: boolean;
  readonly settledByCash: boolean;
  /** Completed refunds of the allocated credit; null = no allocated credit. */
  readonly refunded: bigint | null;
}

function randomObligation(random: () => number): Obligation {
  const currency = pick(random, ['SYP', 'USD']);
  const status = pick(random, OBLIGATION_STATUSES);
  const amount = BigInt(1 + Math.floor(random() * 500_000));
  const verified = status === 'SETTLED' ? amount : status === 'VOIDED' ? 0n : 0n;
  const settledByCash = status === 'SETTLED' && random() < 0.4;
  let refunded: bigint | null = null;
  if (status === 'SETTLED' && !settledByCash && random() < 0.7) {
    const roll = random();
    refunded =
      roll < 0.3 ? 0n : roll < 0.6 ? amount : BigInt(Math.floor(random() * Number(amount)));
  }
  return {
    currency,
    status,
    amount,
    verified,
    intent:
      random() < 0.2
        ? null
        : { method: pick(random, PAYMENT_METHODS), status: pick(random, INTENT_STATUSES) },
    hasUnknownAttempt: random() < 0.3,
    settledByCash,
    refunded,
  };
}

function statusOf(o: Obligation): FinancialStatus {
  return financialStatus({
    obligation: {
      amount: Money.of(o.currency, o.amount),
      verified: Money.of(o.currency, o.verified),
      status: o.status,
    },
    activeIntent: o.intent,
    hasUnknownAttempt: o.hasUnknownAttempt,
    settledByCash: o.settledByCash,
    refunded: o.refunded === null ? null : Money.of(o.currency, o.refunded),
  });
}

function extent(o: Obligation): RefundExtent {
  if (o.refunded === null || o.refunded === 0n) return 'NONE';
  return o.refunded === o.amount ? 'FULL' : 'PARTIAL';
}

/** What the SQL GROUP BY of the read model produces for these obligations. */
function grouped(obligations: readonly Obligation[]): ObligationFactGroup[] {
  const groups = new Map<string, ObligationFactGroup>();
  for (const o of obligations) {
    const key = JSON.stringify([
      o.currency,
      o.status,
      o.intent?.method ?? null,
      o.intent?.status ?? null,
      o.hasUnknownAttempt,
      o.settledByCash,
      extent(o),
    ]);
    const current = groups.get(key);
    groups.set(key, {
      currency: o.currency,
      status: o.status,
      activeIntent: o.intent,
      hasUnknownAttempt: o.hasUnknownAttempt,
      settledByCash: o.settledByCash,
      refund: extent(o),
      count: (current?.count ?? 0) + 1,
      amountMinor: (current?.amountMinor ?? 0n) + o.amount,
      verifiedMinor: (current?.verifiedMinor ?? 0n) + o.verified,
    });
  }
  return [...groups.values()];
}

function randomTallies<S extends string>(
  random: () => number,
  statuses: readonly S[],
): StatusTally<S>[] {
  const rows: StatusTally<S>[] = [];
  for (const currency of ['SYP', 'USD'])
    for (const status of statuses)
      if (random() < 0.6)
        rows.push({
          currency,
          status,
          count: 1 + Math.floor(random() * 9),
          amountMinor: BigInt(Math.floor(random() * 900_000)),
        });
  return rows;
}

function amountOf<S extends string>(
  rows: readonly StatusTally<S>[],
  currency: string,
  statuses: readonly S[],
): bigint {
  return rows
    .filter((row) => row.currency === currency && statuses.includes(row.status))
    .reduce((total, row) => total + row.amountMinor, 0n);
}

/** A ledger that agrees with the projections (what the COMMIT triggers guarantee). */
function agreeingLedger(facts: Omit<FinanceFacts, 'ledger'>, population: Obligation[]) {
  return ['SYP', 'USD'].map((currency): LedgerFacts => ({
    currency,
    receivableMinor: population
      .filter((o) => o.currency === currency && o.status !== 'VOIDED')
      .reduce((total, o) => total + o.amount - o.verified, 0n),
    clearedMinor: population
      .filter((o) => o.currency === currency)
      .reduce((total, o) => total + o.verified, 0n),
    custodyMinor: amountOf(facts.receipts, currency, ['HELD', 'IN_HANDOVER']),
    refundsPaidMinor: amountOf(facts.refunds, currency, ['SUCCEEDED']),
  }));
}

function scenario(seed: number) {
  const random = prng(seed);
  const population = Array.from({ length: 1 + Math.floor(random() * 120) }, () =>
    randomObligation(random),
  );
  const partial = {
    obligations: grouped(population),
    attempts: randomTallies(random, ATTEMPT_STATUSES),
    receipts: randomTallies(random, CUSTODY_STATUSES),
    handovers: randomTallies(random, HANDOVER_STATUSES),
    credits: randomTallies(random, CREDIT_STATUSES),
    refunds: randomTallies(random, REFUND_STATUSES),
  };
  return { population, facts: { ...partial, ledger: agreeingLedger(partial, population) } };
}

test('group financial status equals the per-obligation rule for every refund extent', () => {
  for (let seed = 1; seed <= 3_000; seed += 1) {
    const o = randomObligation(prng(seed));
    const [group] = grouped([o]);
    assert.ok(group);
    assert.equal(groupFinancialStatus(group), statusOf(o), `seed ${seed}`);
  }
});

test('model-based: the fold equals a naive per-obligation reference (500 random populations)', () => {
  const asOf = new Date('2026-10-11T08:00:00.000Z');
  for (let seed = 1; seed <= 500; seed += 1) {
    const { population, facts } = scenario(seed);
    const summary = foldFinanceSummary(facts, asOf);
    assert.equal(summary.asOf, asOf);
    assert.equal(summary.ledgerConsistent, true, `seed ${seed}`);
    for (const currency of ['SYP', 'USD']) {
      const mine = population.filter((o) => o.currency === currency);
      const view = summary.currencies.find((c) => c.currency === currency);
      assert.ok(view, `seed ${seed} ${currency}`);
      assert.equal(view.obligations.count, mine.length);
      for (const status of OBLIGATION_STATUSES)
        assert.equal(
          view.obligations.byStatus[status],
          mine.filter((o) => o.status === status).length,
        );
      for (const status of FINANCIAL_STATUSES)
        assert.equal(
          view.obligations.byFinancialStatus[status],
          mine.filter((o) => statusOf(o) === status).length,
          `seed ${seed} ${currency} ${status}`,
        );
      const billed = mine
        .filter((o) => o.status !== 'VOIDED')
        .reduce((total, o) => total + o.amount, 0n);
      const verified = mine.reduce((total, o) => total + o.verified, 0n);
      assert.equal(view.obligations.billed.amountMinor, billed);
      assert.equal(view.obligations.verified.amountMinor, verified);
      assert.equal(view.obligations.outstanding.amountMinor, billed - verified);
      const attempts = (status: (typeof ATTEMPT_STATUSES)[number]) =>
        facts.attempts
          .filter((row) => row.currency === currency && row.status === status)
          .reduce((total, row) => total + row.count, 0);
      assert.equal(view.attempts.awaitingReview, attempts('PENDING_REVIEW') + attempts('UNKNOWN'));
      assert.equal(
        view.cashCustody.inCustody.amountMinor,
        amountOf(facts.receipts, currency, ['HELD', 'IN_HANDOVER']),
      );
      assert.equal(
        view.providerCredits.confirmed.amountMinor,
        amountOf(facts.credits, currency, ['UNALLOCATED', 'ALLOCATED']),
      );
      assert.equal(
        view.refunds.inFlight.amountMinor,
        amountOf(facts.refunds, currency, ['REQUESTED', 'APPROVED', 'SUBMITTED', 'UNKNOWN']),
      );
      assert.equal(view.obligations.billed.toWire().scale, 2);
    }
  }
});

test('consistency: each corrupted ledger figure is detected in its own check and currency', () => {
  const { facts } = scenario(42);
  const fields = ['receivableMinor', 'clearedMinor', 'custodyMinor', 'refundsPaidMinor'] as const;
  const checks = {
    receivableMinor: 'receivable',
    clearedMinor: 'cleared',
    custodyMinor: 'custody',
    refundsPaidMinor: 'refunds',
  } as const;
  for (const field of fields)
    for (const delta of [1n, -1n]) {
      const ledger = facts.ledger.map((row) =>
        row.currency === 'USD' ? { ...row, [field]: row[field] + delta } : row,
      );
      const summary = foldFinanceSummary({ ...facts, ledger }, new Date());
      assert.equal(summary.ledgerConsistent, false, `${field} ${delta}`);
      const usd = summary.currencies.find((c) => c.currency === 'USD');
      const syp = summary.currencies.find((c) => c.currency === 'SYP');
      assert.equal(usd?.ledger[checks[field]], false);
      assert.deepEqual(
        Object.entries(usd?.ledger ?? {})
          .filter(([, ok]) => !ok)
          .map(([name]) => name),
        [checks[field]],
      );
      assert.ok(syp && Object.values(syp.ledger).every(Boolean), 'other currency unaffected');
    }
  // A projection edited behind the ledger's back (verified raised without a posting).
  const [first, ...rest] = facts.obligations;
  assert.ok(first);
  const edited = { ...first, verifiedMinor: first.verifiedMinor + 1n };
  assert.equal(
    foldFinanceSummary({ ...facts, obligations: [edited, ...rest] }, new Date()).ledgerConsistent,
    false,
  );
  // Ledger lines in a currency with no projection rows at all.
  const stray: LedgerFacts = {
    currency: 'USD',
    receivableMinor: 0n,
    clearedMinor: 0n,
    custodyMinor: 5n,
    refundsPaidMinor: 0n,
  };
  const empty = {
    obligations: [],
    attempts: [],
    receipts: [],
    handovers: [],
    credits: [],
    refunds: [],
  };
  assert.equal(
    foldFinanceSummary({ ...empty, ledger: [stray] }, new Date()).ledgerConsistent,
    false,
  );
});

test('empty and corrupted stores: nothing is invented, an unknown currency fails loudly', () => {
  const empty: FinanceFacts = {
    obligations: [],
    attempts: [],
    receipts: [],
    handovers: [],
    credits: [],
    refunds: [],
    ledger: [],
  };
  const summary = foldFinanceSummary(empty, new Date(0));
  assert.deepEqual(summary.currencies, []);
  assert.equal(summary.ledgerConsistent, true);
  assert.throws(
    () =>
      foldFinanceSummary(
        { ...empty, attempts: [{ currency: 'EUR', status: 'MATCHED', count: 1, amountMinor: 1n }] },
        new Date(0),
      ),
    /STORED_CURRENCY_INVALID/,
  );
});

test('queue cursor: opaque, round-trips exactly, and every tampering is refused', () => {
  const position = { submittedAt: new Date('2026-10-11T08:00:00.123Z'), attemptId: randomUUID() };
  const cursor = encodeQueueCursor(position);
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeQueueCursor(cursor), position);
  const forged = [
    '',
    'not a cursor',
    `${cursor}=`,
    Buffer.from(`abc.${position.attemptId}`).toString('base64url'),
    Buffer.from(`1.${'0'.repeat(36)}`).toString('base64url'),
    Buffer.from(`01.${position.attemptId}`).toString('base64url'),
    Buffer.from(`${'9'.repeat(16)}.${position.attemptId}`).toString('base64url'),
    'A'.repeat(129),
  ];
  for (const value of forged)
    assert.throws(() => decodeQueueCursor(value), BillingApplicationError, value);
});

test('queue query: closed parameters, closed status, bounded limit', () => {
  assert.deepEqual(parseAttemptQueueQuery({ status: 'PENDING_REVIEW' }), {
    status: 'PENDING_REVIEW',
    after: null,
    limit: QUEUE_DEFAULT_LIMIT,
  });
  assert.equal(parseAttemptQueueQuery({ status: 'UNKNOWN', limit: '100' }).limit, 100);
  const refused: unknown[] = [
    {},
    { status: 'PAID' },
    { status: 'pending_review' },
    { status: ['UNKNOWN', 'MATCHED'] },
    { status: 'UNKNOWN', limit: '0' },
    { status: 'UNKNOWN', limit: '101' },
    { status: 'UNKNOWN', limit: '1.5' },
    { status: 'UNKNOWN', limit: '-1' },
    { status: 'UNKNOWN', owner: 'x' },
    { status: 'UNKNOWN', cursor: 'bad cursor' },
    null,
    [],
  ];
  for (const query of refused)
    assert.throws(
      () => parseAttemptQueueQuery(query),
      BillingApplicationError,
      JSON.stringify(query),
    );
});
