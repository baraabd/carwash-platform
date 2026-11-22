import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { billingV1 } from '@carwash/contracts';
import { Money } from '../src/domain';
import type { ObligationRecord, ProviderCreditRecord, RefundRecord } from '../src/ports';
import { BillingApplicationError } from '../src/application';
import {
  canonicalRefundView,
  obligationRefundsView,
} from '../src/application/canonical-refund.views';

const at = new Date('2026-11-22T00:00:00.000Z');
function fixture() {
  const obligation: ObligationRecord = {
    id: randomUUID(),
    owner: { kind: 'account', subjectId: randomUUID() },
    quoteId: randomUUID(),
    amount: Money.of('SYP', 100n),
    verified: Money.of('SYP', 100n),
    status: 'SETTLED',
    revision: 4,
    createdAt: at,
    updatedAt: at,
  };
  const credit: ProviderCreditRecord = {
    id: randomUUID(),
    provider: 'SHAM_CASH',
    merchantAccount: 'synthetic-view-only',
    reference: 'SOURCE9999',
    amount: obligation.amount,
    occurredAt: at,
    source: 'MERCHANT_STATEMENT',
    evidenceDigest: 'a'.repeat(64),
    status: 'ALLOCATED',
    unallocatedReason: null,
    attemptId: randomUUID(),
    obligationId: obligation.id,
    recordedBy: randomUUID(),
    decidedBy: randomUUID(),
    decidedAt: at,
    rejectionReason: null,
    revision: 2,
    createdAt: at,
    updatedAt: at,
  };
  const refund: RefundRecord = {
    id: randomUUID(),
    workflow: 'CREDIT_V1',
    creditId: credit.id,
    provider: credit.provider,
    amount: Money.of('SYP', 20n),
    reason: 'BOOKING_CANCELLED',
    channel: 'MANUAL_OUT_OF_BAND',
    status: 'REQUESTED',
    requestedBy: randomUUID(),
    requestedAt: at,
    decidedBy: null,
    decidedAt: null,
    providerRefundReference: null,
    evidenceDigest: null,
    completedBy: null,
    completedAt: null,
    revision: 1,
    updatedAt: at,
  };
  return { obligation, credit, refund };
}

test('legacy lifecycle projection cannot confuse approval or provider uncertainty with returned money', () => {
  const { refund, credit } = fixture();
  const expected = {
    REQUESTED: 'REQUESTED',
    APPROVED: 'REQUESTED',
    SUBMITTED: 'OUTCOME_UNKNOWN',
    UNKNOWN: 'OUTCOME_UNKNOWN',
    REJECTED: 'FAILED',
    FAILED: 'FAILED',
    SUCCEEDED: 'SUCCEEDED',
  } as const;
  for (const [raw, status] of Object.entries(expected)) {
    const view = canonicalRefundView(
      {
        ...refund,
        status: raw as keyof typeof expected,
        decidedBy: randomUUID(),
        decidedAt: at,
        providerRefundReference: raw === 'SUCCEEDED' ? 'RETURN1234' : null,
      },
      credit,
    );
    assert.equal(billingV1.parseRefundV1(view).status, status);
    assert.equal(view.decidedAt === null, status === 'REQUESTED');
    assert.equal(view.reference, status === 'SUCCEEDED' ? '…1234' : null);
    assert.doesNotMatch(
      JSON.stringify(view),
      /RETURN1234|requestedBy|decidedBy|creditId|evidenceDigest|merchantAccount/,
    );
  }
});

test('unrepresentable historical refund facts fail closed as provider limitations, never caller validation', () => {
  const { refund, credit } = fixture();
  assert.throws(
    () => canonicalRefundView(refund, { ...credit, obligationId: null }),
    (error: unknown) => error instanceof BillingApplicationError && error.code === 'NOT_FOUND',
  );
  for (const change of [
    { status: 'SUCCEEDED' as const, decidedAt: at, providerRefundReference: null },
    { status: 'FAILED' as const, decidedAt: null },
    { reason: 'UNALLOCATABLE_CREDIT' as const },
  ])
    assert.throws(
      () => canonicalRefundView({ ...refund, ...change }, credit),
      (error: unknown) =>
        error instanceof BillingApplicationError && error.code === 'SERVICE_NOT_READY',
    );
});

test('the obligation summary includes legacy reservations, sorts history, and never truncates beyond the wire cap', () => {
  const { refund, credit, obligation } = fixture();
  const records: RefundRecord[] = [
    { ...refund, status: 'APPROVED', decidedBy: randomUUID(), decidedAt: at },
    {
      ...refund,
      id: randomUUID(),
      amount: Money.of('SYP', 30n),
      status: 'SUCCEEDED',
      requestedAt: new Date(at.getTime() + 1000),
      updatedAt: new Date(at.getTime() + 1000),
      decidedAt: new Date(at.getTime() + 1000),
      providerRefundReference: 'RETURN5678',
    },
  ];
  const view = billingV1.parseObligationRefundsV1(
    obligationRefundsView(obligation, credit, records),
  );
  assert.equal(view.inFlight.amountMinor, '20');
  assert.equal(view.refunded.amountMinor, '30');
  assert.equal(view.refundable.amountMinor, '50');
  assert.equal(view.items[0]?.status, 'SUCCEEDED');
  const tooMany = Array.from({ length: 21 }, () => ({ ...refund, id: randomUUID() }));
  assert.throws(
    () => obligationRefundsView(obligation, credit, tooMany),
    (error: unknown) =>
      error instanceof BillingApplicationError && error.code === 'SERVICE_NOT_READY',
  );
});
