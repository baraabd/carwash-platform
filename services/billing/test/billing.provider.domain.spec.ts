import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  Money,
  ProviderRuleError,
  RefundRuleError,
  assertOccurredBefore,
  planCreditAllocation,
  planManualRefundCompletion,
  planRefundDecision,
  planRefundProviderOutcome,
  planRefundRequest,
  planStatementDecision,
  refundableAmount,
  type ClaimState,
  type CreditStatus,
  type IntentClaimState,
  type ObligationState,
  type RefundState,
} from '../src/domain';
import {
  parseProviderCreditChangedData,
  parseRefundChangedData,
  providerCreditChangedEvent,
  refundChangedEvent,
} from '../src/application';
import { parseEnvelopeV2 } from '@carwash/event-contracts';

/* Pure provider credit / refund invariants: no Nest, HTTP, Prisma or database. */

const syp = (minor: bigint) => Money.of('SYP', minor);
const usd = (minor: bigint) => Money.of('USD', minor);
const providerRule = (code: string) => (error: unknown) =>
  error instanceof ProviderRuleError && error.code === code;
const refundRule = (code: string) => (error: unknown) =>
  error instanceof RefundRuleError && error.code === code;

const intentId = randomUUID();
const open = (amount = 150_000n, verified = 0n): ObligationState => ({
  amount: syp(amount),
  verified: syp(verified),
  status: 'OPEN',
});
const claim = (change: Partial<ClaimState> = {}): ClaimState => ({
  id: randomUUID(),
  intentId,
  status: 'PENDING_REVIEW',
  claimed: syp(150_000n),
  ...change,
});
const intent = (change: Partial<IntentClaimState> = {}): IntentClaimState => ({
  id: intentId,
  method: 'SHAM_CASH',
  status: 'UNDER_REVIEW',
  ...change,
});

function allocate(input: Partial<Parameters<typeof planCreditAllocation>[0]> = {}) {
  return planCreditAllocation({
    credit: { amount: syp(150_000n) },
    reservedForRefund: null,
    claim: claim(),
    obligation: open(),
    intent: intent(),
    ...input,
  });
}

test('allocation: only an exact credit on an open claim of an OPEN obligation settles it', () => {
  assert.deepEqual(allocate(), { kind: 'ALLOCATE', received: syp(150_000n) });
  assert.equal(allocate({ claim: claim({ status: 'UNKNOWN' }) }).kind, 'ALLOCATE');
});

test('allocation: anything else leaves the money UNALLOCATED with an explicit reason', () => {
  const reason = (input: Partial<Parameters<typeof planCreditAllocation>[0]>) => {
    const plan = allocate(input);
    return plan.kind === 'UNALLOCATED' ? plan.reason : 'ALLOCATED';
  };
  assert.equal(reason({ claim: null }), 'NO_CLAIM');
  assert.equal(reason({ obligation: null }), 'NO_CLAIM');
  for (const status of ['MATCHED', 'MISMATCHED'] as const)
    assert.equal(reason({ claim: claim({ status }) }), 'CLAIM_CLOSED');
  for (const status of ['SETTLED', 'VOIDED'] as const)
    assert.equal(reason({ obligation: { ...open(), status } }), 'OBLIGATION_NOT_OPEN');
  assert.equal(reason({ intent: null }), 'CLAIM_CLOSED');
  assert.equal(reason({ intent: intent({ id: randomUUID() }) }), 'CLAIM_CLOSED');
  assert.equal(reason({ intent: intent({ status: 'AWAITING_CUSTOMER_PAYMENT' }) }), 'CLAIM_CLOSED');
  assert.equal(reason({ credit: { amount: usd(150_000n) } }), 'CURRENCY_MISMATCH');
  assert.equal(reason({ credit: { amount: syp(149_999n) } }), 'AMOUNT_MISMATCH');
  assert.equal(reason({ credit: { amount: syp(150_001n) } }), 'AMOUNT_MISMATCH');
  // Outstanding and claim disagree (e.g. a partially verified obligation).
  assert.equal(reason({ obligation: open(150_000n, 1n) }), 'AMOUNT_MISMATCH');
  assert.equal(reason({ reservedForRefund: syp(1n) }), 'REFUND_RESERVED');
  assert.equal(reason({ reservedForRefund: syp(0n) }), 'ALLOCATED');
});

test('statement credits need a second person; providers never report the future', () => {
  const credit = (status: CreditStatus, recordedBy: string | null = 'recorder') => ({
    provider: 'SHAM_CASH' as const,
    amount: syp(1n),
    status,
    recordedBy,
  });
  planStatementDecision({ credit: credit('PENDING_APPROVAL'), decider: 'approver' });
  assert.throws(
    () => planStatementDecision({ credit: credit('PENDING_APPROVAL'), decider: 'recorder' }),
    providerRule('SEPARATION_OF_DUTIES'),
  );
  assert.throws(
    () => planStatementDecision({ credit: credit('PENDING_APPROVAL', null), decider: 'x' }),
    providerRule('SEPARATION_OF_DUTIES'),
  );
  for (const status of ['REJECTED', 'UNALLOCATED', 'ALLOCATED'] as const)
    assert.throws(
      () => planStatementDecision({ credit: credit(status), decider: 'approver' }),
      providerRule('CREDIT_NOT_PENDING'),
    );
  const now = new Date('2026-10-10T10:00:00.000Z');
  assertOccurredBefore(now, now);
  assert.throws(
    () => assertOccurredBefore(new Date(now.getTime() + 1), now),
    providerRule('OCCURRED_IN_FUTURE'),
  );
});

test('refund request: reason fits the credit, same currency, never beyond the reservations', () => {
  const allocated = { amount: syp(150_000n), status: 'ALLOCATED' as const };
  const unallocated = { amount: syp(150_000n), status: 'UNALLOCATED' as const };
  planRefundRequest({
    credit: allocated,
    reserved: syp(0n),
    amount: syp(150_000n),
    reason: 'BOOKING_CANCELLED',
  });
  planRefundRequest({
    credit: allocated,
    reserved: syp(100_000n),
    amount: syp(50_000n),
    reason: 'SERVICE_NOT_DELIVERED',
  });
  planRefundRequest({
    credit: unallocated,
    reserved: syp(0n),
    amount: syp(1n),
    reason: 'UNALLOCATABLE_CREDIT',
  });
  assert.throws(
    () =>
      planRefundRequest({
        credit: allocated,
        reserved: syp(100_000n),
        amount: syp(50_001n),
        reason: 'BOOKING_CANCELLED',
      }),
    refundRule('REFUND_EXCEEDS_AVAILABLE'),
  );
  assert.throws(
    () =>
      planRefundRequest({
        credit: allocated,
        reserved: syp(0n),
        amount: syp(0n),
        reason: 'BOOKING_CANCELLED',
      }),
    refundRule('REFUND_EXCEEDS_AVAILABLE'),
  );
  assert.throws(
    () =>
      planRefundRequest({
        credit: allocated,
        reserved: syp(0n),
        amount: usd(1n),
        reason: 'BOOKING_CANCELLED',
      }),
    refundRule('REFUND_CURRENCY_MISMATCH'),
  );
  assert.throws(
    () =>
      planRefundRequest({
        credit: allocated,
        reserved: syp(0n),
        amount: syp(1n),
        reason: 'UNALLOCATABLE_CREDIT',
      }),
    refundRule('REFUND_REASON_NOT_ALLOWED'),
  );
  assert.throws(
    () =>
      planRefundRequest({
        credit: unallocated,
        reserved: syp(0n),
        amount: syp(1n),
        reason: 'BOOKING_CANCELLED',
      }),
    refundRule('REFUND_REASON_NOT_ALLOWED'),
  );
  for (const status of ['PENDING_APPROVAL', 'REJECTED'] as const)
    assert.throws(
      () =>
        planRefundRequest({
          credit: { amount: syp(150_000n), status },
          reserved: syp(0n),
          amount: syp(1n),
          reason: 'DUPLICATE_PAYMENT',
        }),
      refundRule('CREDIT_NOT_REFUNDABLE'),
    );
  assert.equal(refundableAmount(allocated, syp(40_000n)).amountMinor, 110_000n);
});

const refund = (change: Partial<RefundState> = {}): RefundState => ({
  status: 'REQUESTED',
  channel: 'PROVIDER_API',
  requestedBy: 'requester',
  ...change,
});

test('refund decision and manual completion always involve two people', () => {
  planRefundDecision({ refund: refund(), decider: 'approver' });
  assert.throws(
    () => planRefundDecision({ refund: refund(), decider: 'requester' }),
    refundRule('SEPARATION_OF_DUTIES'),
  );
  assert.throws(
    () => planRefundDecision({ refund: refund({ status: 'APPROVED' }), decider: 'approver' }),
    refundRule('REFUND_NOT_REQUESTED'),
  );
  const manual = refund({ channel: 'MANUAL_OUT_OF_BAND', status: 'APPROVED' });
  planManualRefundCompletion({ refund: manual, recorder: 'approver' });
  assert.throws(
    () => planManualRefundCompletion({ refund: manual, recorder: 'requester' }),
    refundRule('SEPARATION_OF_DUTIES'),
  );
  assert.throws(
    () => planManualRefundCompletion({ refund: { ...manual, status: 'REQUESTED' }, recorder: 'x' }),
    refundRule('REFUND_NOT_EXECUTABLE'),
  );
  assert.throws(
    () => planManualRefundCompletion({ refund: refund({ status: 'APPROVED' }), recorder: 'x' }),
    refundRule('REFUND_CHANNEL_MISMATCH'),
  );
});

test('refund provider outcome: UNKNOWN is never success and keeps the reservation', () => {
  const approved = refund({ status: 'APPROVED' });
  const next = (state: RefundState, outcome: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN') =>
    planRefundProviderOutcome({ refund: state, outcome });
  assert.equal(next(approved, 'PENDING'), 'SUBMITTED');
  assert.equal(next(approved, 'SUCCEEDED'), 'SUCCEEDED');
  assert.equal(next(approved, 'FAILED'), 'FAILED');
  assert.equal(next(approved, 'UNKNOWN'), 'UNKNOWN');
  assert.equal(next(refund({ status: 'UNKNOWN' }), 'UNKNOWN'), 'UNKNOWN');
  assert.equal(next(refund({ status: 'UNKNOWN' }), 'PENDING'), 'SUBMITTED');
  assert.equal(next(refund({ status: 'SUBMITTED' }), 'UNKNOWN'), 'SUBMITTED');
  assert.equal(next(refund({ status: 'SUBMITTED' }), 'SUCCEEDED'), 'SUCCEEDED');
  for (const status of ['REQUESTED', 'REJECTED', 'SUCCEEDED', 'FAILED'] as const)
    assert.throws(
      () => next(refund({ status }), 'SUCCEEDED'),
      refundRule('REFUND_NOT_PENDING_AT_PROVIDER'),
    );
  assert.throws(
    () => next(refund({ status: 'APPROVED', channel: 'MANUAL_OUT_OF_BAND' }), 'SUCCEEDED'),
    refundRule('REFUND_CHANNEL_MISMATCH'),
  );
});

test('provider events carry no reference and pass the shared envelope parser', () => {
  const context = {
    eventId: randomUUID(),
    occurredAt: new Date('2026-10-10T10:00:00.000Z'),
    correlationId: randomUUID(),
    actor: null,
    aggregateId: randomUUID(),
    revision: 1,
  };
  const credit = providerCreditChangedEvent(
    {
      provider: 'SHAM_CASH',
      source: 'PROVIDER_NOTIFICATION',
      previousStatus: null,
      status: 'UNALLOCATED',
      unallocatedReason: 'NO_CLAIM',
      amount: syp(150_000n).toWire(),
      obligationId: null,
    },
    context,
  );
  const envelope = parseEnvelopeV2(
    JSON.parse(credit.payload),
    {
      eventType: 'billing.provider-credit-changed.v1',
      producer: 'billing',
      aggregateType: 'billing-provider-credit',
    },
    parseProviderCreditChangedData,
  );
  assert.deepEqual(envelope.actor, { kind: 'system', id: null });
  assert.doesNotMatch(credit.payload, /reference|merchant|evidence/i);
  assert.throws(() =>
    parseProviderCreditChangedData({
      provider: 'SHAM_CASH',
      source: 'PROVIDER_NOTIFICATION',
      previousStatus: null,
      status: 'ALLOCATED',
      unallocatedReason: null,
      amount: syp(1n).toWire(),
      obligationId: null,
    }),
  );
  const refundEvent = refundChangedEvent(
    {
      creditId: randomUUID(),
      obligationId: randomUUID(),
      provider: 'SYRIATEL_CASH',
      channel: 'MANUAL_OUT_OF_BAND',
      reason: 'BOOKING_CANCELLED',
      previousStatus: 'APPROVED',
      status: 'SUCCEEDED',
      amount: syp(1n).toWire(),
    },
    { ...context, actor: { kind: 'account', subjectId: randomUUID() } },
  );
  parseEnvelopeV2(
    JSON.parse(refundEvent.payload),
    {
      eventType: 'billing.refund-changed.v1',
      producer: 'billing',
      aggregateType: 'billing-refund',
    },
    parseRefundChangedData,
  );
  assert.throws(() =>
    parseRefundChangedData({ ...JSON.parse(refundEvent.payload).data, status: 'APPROVED' }),
  );
});
