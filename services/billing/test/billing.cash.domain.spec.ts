import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseEnvelopeV2 } from '@carwash/event-contracts';
import {
  CashRuleError,
  MAX_RECEIPTS_PER_HANDOVER,
  Money,
  cashCollectedJournal,
  cashCollectionReversedJournal,
  custodyReceivedJournal,
  custodyReconciledJournal,
  normalizeTreasuryReference,
  planCashCollection,
  planCollectionReversal,
  planHandover,
  planHandoverCancel,
  planHandoverReconciliation,
  planTreasuryReceipt,
  receiptStatusFor,
  type HandoverState,
  type JournalPlan,
  type WorkEvidence,
} from '../src/domain';
import {
  cashCollectedEvent,
  custodyHandoverChangedEvent,
  parseCustodyHandoverChangedData,
} from '../src/application';
import { UnpublishedWorkAuthority } from '../src/infrastructure/work/unpublished-work.authority';
import { WorkAuthorityUnavailable } from '../src/ports';

/* Pure cash/custody domain invariants: no Nest, HTTP, Prisma or database. */

const syp = (minor: bigint) => Money.of('SYP', minor);
const usd = (minor: bigint) => Money.of('USD', minor);
const OWNER = randomUUID();
const TECH = randomUUID();
const OTHER = randomUUID();
const QUOTE = randomUUID();
const cash = { method: 'CASH_ON_COMPLETION' as const, status: 'AWAITING_CASH_COLLECTION' as const };
const rule = (code: string) => (error: unknown) =>
  error instanceof CashRuleError && error.code === code;

function obligation(
  overrides: Partial<{ verified: bigint; status: 'OPEN' | 'SETTLED' | 'VOIDED' }> = {},
) {
  return {
    amount: syp(150_000n),
    verified: syp(overrides.verified ?? 0n),
    status: overrides.status ?? ('OPEN' as const),
    quoteId: QUOTE,
  };
}

function work(overrides: Partial<WorkEvidence> = {}): WorkEvidence {
  return {
    bookingId: randomUUID(),
    quoteId: QUOTE,
    assignmentId: randomUUID(),
    assignmentRevision: 3,
    technicianSubject: TECH,
    workState: 'COMPLETED',
    ...overrides,
  };
}

function collect(overrides: Partial<Parameters<typeof planCashCollection>[0]> = {}) {
  return planCashCollection({
    obligation: obligation(),
    intent: cash,
    owner: OWNER,
    collector: TECH,
    work: work(),
    declared: syp(150_000n),
    ...overrides,
  });
}

/** Net per account (debit positive) of a journal plan. */
function net(plan: JournalPlan): Record<string, bigint> {
  const totals: Record<string, bigint> = {};
  for (const line of plan.lines)
    totals[line.account] =
      (totals[line.account] ?? 0n) +
      (line.side === 'DEBIT' ? line.amount.amountMinor : -line.amount.amountMinor);
  return totals;
}

test('collection: only the assigned technician, after completion, for exactly the outstanding amount', () => {
  assert.equal(collect().received.amountMinor, 150_000n);
  assert.throws(
    () => collect({ work: work({ workState: 'IN_PROGRESS' }) }),
    rule('WORK_NOT_COMPLETED'),
  );
  assert.throws(
    () => collect({ work: work({ workState: 'NOT_STARTED' }) }),
    rule('WORK_NOT_COMPLETED'),
  );
  assert.throws(
    () => collect({ work: work({ workState: 'CANCELLED' }) }),
    rule('WORK_NOT_COMPLETED'),
  );
  assert.throws(
    () => collect({ work: work({ technicianSubject: OTHER }) }),
    rule('COLLECTOR_NOT_ASSIGNED'),
  );
  assert.throws(
    () => collect({ work: work({ technicianSubject: null }) }),
    rule('COLLECTOR_NOT_ASSIGNED'),
  );
  assert.throws(() => collect({ work: work({ quoteId: randomUUID() }) }), rule('BOOKING_MISMATCH'));
  assert.throws(() => collect({ declared: syp(149_999n) }), rule('AMOUNT_NOT_EQUAL_OUTSTANDING'));
  assert.throws(() => collect({ declared: syp(150_001n) }), rule('AMOUNT_NOT_EQUAL_OUTSTANDING'));
  assert.throws(() => collect({ declared: usd(150_000n) }), rule('CURRENCY_MISMATCH'));
});

test('collection: refused on a settled/voided obligation, without a cash intent, or by the owner', () => {
  assert.throws(
    () => collect({ obligation: obligation({ verified: 150_000n, status: 'SETTLED' }) }),
    rule('OBLIGATION_SETTLED'),
  );
  assert.throws(
    () => collect({ obligation: obligation({ status: 'VOIDED' }) }),
    rule('OBLIGATION_VOIDED'),
  );
  assert.throws(() => collect({ intent: null }), rule('NO_ACTIVE_INTENT'));
  assert.throws(
    () => collect({ intent: { method: 'SHAM_CASH', status: 'AWAITING_CUSTOMER_PAYMENT' } }),
    rule('INTENT_NOT_CASH'),
  );
  assert.throws(
    () => collect({ owner: TECH }),
    rule('SELF_COLLECTION_FORBIDDEN'),
    'a technician cannot collect for their own booking',
  );
});

test('collection: a non-assigned technician learns nothing about the financial state', () => {
  // The binding/assignment checks run before the status checks.
  assert.throws(
    () =>
      collect({
        obligation: obligation({ verified: 150_000n, status: 'SETTLED' }),
        work: work({ technicianSubject: OTHER }),
      }),
    rule('COLLECTOR_NOT_ASSIGNED'),
  );
});

test('reversal: only HELD cash, never by the collector, never twice', () => {
  const held = { collector: TECH, amount: syp(150_000n), custodyStatus: 'HELD' as const };
  planCollectionReversal({ receipt: held, reverser: OTHER });
  assert.throws(
    () => planCollectionReversal({ receipt: held, reverser: TECH }),
    rule('SEPARATION_OF_DUTIES'),
  );
  for (const custodyStatus of ['IN_HANDOVER', 'DEPOSITED', 'SETTLED'] as const)
    assert.throws(
      () => planCollectionReversal({ receipt: { ...held, custodyStatus }, reverser: OTHER }),
      rule('RECEIPT_NOT_HELD'),
    );
  assert.throws(
    () =>
      planCollectionReversal({ receipt: { ...held, custodyStatus: 'REVERSED' }, reverser: OTHER }),
    rule('RECEIPT_ALREADY_REVERSED'),
  );
});

test('handover: the holder hands over only their own HELD receipts for the exact server total', () => {
  const r = (amount: bigint, overrides = {}) => ({
    id: randomUUID(),
    collector: TECH,
    amount: syp(amount),
    custodyStatus: 'HELD' as const,
    ...overrides,
  });
  const a = r(100n);
  const b = r(250n);
  const plan = planHandover({
    holder: TECH,
    receipts: [a, b],
    requestedIds: [a.id, b.id],
    declared: syp(350n),
  });
  assert.equal(plan.total.amountMinor, 350n);
  assert.throws(
    () =>
      planHandover({
        holder: TECH,
        receipts: [a, b],
        requestedIds: [a.id, b.id],
        declared: syp(351n),
      }),
    rule('DECLARED_TOTAL_MISMATCH'),
  );
  assert.throws(
    () => planHandover({ holder: TECH, receipts: [], requestedIds: [], declared: syp(1n) }),
    rule('HANDOVER_EMPTY'),
  );
  assert.throws(
    () =>
      planHandover({
        holder: TECH,
        receipts: [a],
        requestedIds: [a.id, a.id],
        declared: syp(200n),
      }),
    rule('HANDOVER_DUPLICATE_RECEIPT'),
  );
  const tooMany = Array.from({ length: MAX_RECEIPTS_PER_HANDOVER + 1 }, () => randomUUID());
  assert.throws(
    () => planHandover({ holder: TECH, receipts: [], requestedIds: tooMany, declared: syp(1n) }),
    rule('HANDOVER_TOO_LARGE'),
  );
  const foreign = r(100n, { collector: OTHER });
  assert.throws(
    () =>
      planHandover({
        holder: TECH,
        receipts: [foreign],
        requestedIds: [foreign.id],
        declared: syp(100n),
      }),
    rule('RECEIPT_NOT_HELD'),
  );
  const moving = r(100n, { custodyStatus: 'IN_HANDOVER' });
  assert.throws(
    () =>
      planHandover({
        holder: TECH,
        receipts: [moving],
        requestedIds: [moving.id],
        declared: syp(100n),
      }),
    rule('RECEIPT_NOT_HELD'),
  );
  assert.throws(
    () =>
      planHandover({
        holder: TECH,
        receipts: [a],
        requestedIds: [a.id, randomUUID()],
        declared: syp(100n),
      }),
    rule('RECEIPT_NOT_HELD'),
    'a missing receipt is refused',
  );
  const dollars = { ...r(100n), amount: usd(100n) };
  assert.throws(
    () =>
      planHandover({
        holder: TECH,
        receipts: [a, dollars],
        requestedIds: [a.id, dollars.id],
        declared: syp(200n),
      }),
    rule('HANDOVER_MIXED_CURRENCY'),
  );
});

test('treasury receipt: an independent count records shortage or overage explicitly', () => {
  const pending: HandoverState = {
    holder: TECH,
    status: 'PENDING',
    declared: syp(1_000n),
    counted: null,
    receivedBy: null,
  };
  const exact = planTreasuryReceipt({ handover: pending, receiver: OTHER, counted: syp(1_000n) });
  assert.deepEqual([exact.shortage.amountMinor, exact.overage.amountMinor], [0n, 0n]);
  const short = planTreasuryReceipt({ handover: pending, receiver: OTHER, counted: syp(900n) });
  assert.deepEqual([short.shortage.amountMinor, short.overage.amountMinor], [100n, 0n]);
  const over = planTreasuryReceipt({ handover: pending, receiver: OTHER, counted: syp(1_050n) });
  assert.deepEqual([over.shortage.amountMinor, over.overage.amountMinor], [0n, 50n]);
  const none = planTreasuryReceipt({ handover: pending, receiver: OTHER, counted: syp(0n) });
  assert.equal(none.shortage.amountMinor, 1_000n);
  assert.throws(
    () => planTreasuryReceipt({ handover: pending, receiver: TECH, counted: syp(1_000n) }),
    rule('SEPARATION_OF_DUTIES'),
  );
  assert.throws(
    () => planTreasuryReceipt({ handover: pending, receiver: OTHER, counted: usd(1_000n) }),
    rule('CURRENCY_MISMATCH'),
  );
  assert.throws(
    () =>
      planTreasuryReceipt({
        handover: { ...pending, status: 'RECEIVED' },
        receiver: OTHER,
        counted: syp(1n),
      }),
    rule('HANDOVER_NOT_PENDING'),
  );
  assert.throws(
    () => planHandoverCancel({ handover: { ...pending, status: 'RECEIVED' } }),
    rule('HANDOVER_NOT_PENDING'),
  );
});

test('settlement: the reconciler is neither the holder nor the receiver', () => {
  const RECEIVER = randomUUID();
  const received: HandoverState = {
    holder: TECH,
    status: 'RECEIVED',
    declared: syp(1_000n),
    counted: syp(1_000n),
    receivedBy: RECEIVER,
  };
  planHandoverReconciliation({ handover: received, reconciler: OTHER });
  assert.throws(
    () => planHandoverReconciliation({ handover: received, reconciler: TECH }),
    rule('SEPARATION_OF_DUTIES'),
  );
  assert.throws(
    () => planHandoverReconciliation({ handover: received, reconciler: RECEIVER }),
    rule('SEPARATION_OF_DUTIES'),
  );
  assert.throws(
    () =>
      planHandoverReconciliation({
        handover: { ...received, status: 'PENDING' },
        reconciler: OTHER,
      }),
    rule('HANDOVER_NOT_RECEIVED'),
  );
  assert.deepEqual(
    (['PENDING', 'RECEIVED', 'RECONCILED', 'CANCELLED'] as const).map(receiptStatusFor),
    ['IN_HANDOVER', 'DEPOSITED', 'SETTLED', 'HELD'],
  );
});

test('journals: collection, reversal, treasury receipt and settlement balance with explicit holders', () => {
  const receiptId = randomUUID();
  const handoverId = randomUUID();
  const collected = cashCollectedJournal(receiptId, TECH, syp(150_000n));
  assert.equal(collected.businessRef, `receipt:${receiptId}:collected`);
  assert.deepEqual(net(collected), { CASH_IN_CUSTODY: 150_000n, CUSTOMER_RECEIVABLE: -150_000n });
  assert.ok(
    collected.lines.every((l) => (l.account === 'CASH_IN_CUSTODY') === (l.holder === TECH)),
  );
  const reversed = cashCollectionReversedJournal(receiptId, TECH, syp(150_000n));
  assert.deepEqual(net(reversed), { CASH_IN_CUSTODY: -150_000n, CUSTOMER_RECEIVABLE: 150_000n });
  const short = custodyReceivedJournal(handoverId, TECH, syp(1_000n), {
    counted: syp(900n),
    shortage: syp(100n),
    overage: syp(0n),
  });
  assert.deepEqual(net(short), {
    TREASURY_CASH_UNRECONCILED: 900n,
    CUSTODY_SHORTAGE_RECEIVABLE: 100n,
    CASH_IN_CUSTODY: -1_000n,
  });
  const over = custodyReceivedJournal(handoverId, TECH, syp(1_000n), {
    counted: syp(1_050n),
    shortage: syp(0n),
    overage: syp(50n),
  });
  assert.deepEqual(net(over), {
    TREASURY_CASH_UNRECONCILED: 1_050n,
    CASH_IN_CUSTODY: -1_000n,
    CUSTODY_OVERAGE_SUSPENSE: -50n,
  });
  const nothing = custodyReceivedJournal(handoverId, TECH, syp(1_000n), {
    counted: syp(0n),
    shortage: syp(1_000n),
    overage: syp(0n),
  });
  assert.ok(
    nothing.lines.every((l) => l.amount.amountMinor > 0n),
    'no zero-amount line',
  );
  const settled = custodyReconciledJournal(handoverId, syp(900n));
  assert.deepEqual(net(settled), { TREASURY_CASH: 900n, TREASURY_CASH_UNRECONCILED: -900n });
});

test('treasury references normalise and reject PII-shaped or short input', () => {
  assert.equal(normalizeTreasuryReference('dep-2026-0001'), 'DEP20260001');
  for (const bad of ['abc', 'name with spaces', '+963 912 345 678', 42, null, 'x'.repeat(65)])
    assert.equal(normalizeTreasuryReference(bad), null);
});

test('custody events are valid envelope v2 and carry no reference or customer data', () => {
  const holder = TECH;
  const event = custodyHandoverChangedEvent(
    {
      holder,
      previousStatus: 'PENDING',
      status: 'RECEIVED',
      receiptCount: 2,
      declared: syp(1_000n).toWire(),
      counted: syp(900n).toWire(),
      shortage: syp(100n).toWire(),
      overage: syp(0n).toWire(),
    },
    {
      eventId: randomUUID(),
      occurredAt: new Date(),
      correlationId: randomUUID(),
      actor: { kind: 'account', subjectId: OTHER },
      aggregateId: randomUUID(),
      revision: 2,
    },
  );
  const envelope = parseEnvelopeV2(
    JSON.parse(event.payload),
    {
      eventType: 'billing.custody-handover-changed.v1',
      producer: 'billing',
      aggregateType: 'billing-custody-handover',
    },
    parseCustodyHandoverChangedData,
  );
  assert.equal(envelope.data.status, 'RECEIVED');
  assert.doesNotMatch(event.payload, /reference|phone|name|plate/i);
  assert.throws(() =>
    parseCustodyHandoverChangedData({ ...envelope.data, previousStatus: 'RECEIVED' }),
  );
  const collected = cashCollectedEvent(
    {
      obligationId: randomUUID(),
      bookingId: randomUUID(),
      assignmentId: randomUUID(),
      amount: syp(150_000n).toWire(),
      custodyStatus: 'HELD',
    },
    {
      eventId: randomUUID(),
      occurredAt: new Date(),
      correlationId: randomUUID(),
      actor: { kind: 'account', subjectId: TECH },
      aggregateId: randomUUID(),
      revision: 1,
    },
  );
  assert.equal(collected.eventType, 'billing.cash-collected.v1');
});

test('production work authority fails closed until lane C publishes work completion', async () => {
  await assert.rejects(new UnpublishedWorkAuthority().evidenceFor(), WorkAuthorityUnavailable);
});
