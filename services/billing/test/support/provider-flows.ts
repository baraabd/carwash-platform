import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { productionProviderRegistry } from '../../src/infrastructure/providers/merchant-providers';
import { TOKENS, type BillingHttpHarness, type HttpReply } from './billing-http-harness';

/**
 * Production provider adapters (documentation pending: statement evidence and
 * manual refunds only) configured with acceptance merchant accounts.
 */
export const MERCHANTS = {
  SHAM_CASH: 'acceptance-sham-01',
  SYRIATEL_CASH: 'acceptance-syr-01',
} as const;

export function acceptanceProviders() {
  return productionProviderRegistry({
    BILLING_SHAM_CASH_MERCHANT_ACCOUNTS: MERCHANTS.SHAM_CASH,
    BILLING_SYRIATEL_CASH_MERCHANT_ACCOUNTS: MERCHANTS.SYRIATEL_CASH,
  });
}

let sequence = 0;
export const providerKey = () =>
  `pg-provider-key-${String(++sequence).padStart(6, '0')}-${process.pid}`;
export const evidence = () => createHash('sha256').update(randomUUID()).digest('hex');
const PATH = '/internal/v1/billing';

export interface StatementLine {
  readonly provider: 'SHAM_CASH' | 'SYRIATEL_CASH';
  readonly reference: string;
  readonly amount: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly merchantAccount?: string;
}

export function recordStatement(
  replica: BillingHttpHarness,
  line: StatementLine,
  options: { token?: string; key?: string } = {},
): Promise<HttpReply> {
  return replica.request('POST', `${PATH}/provider-credits`, {
    token: options.token ?? TOKENS.reconciler,
    key: options.key ?? providerKey(),
    body: {
      provider: line.provider,
      merchantAccount: line.merchantAccount ?? MERCHANTS[line.provider],
      providerReference: line.reference,
      amount: line.amount,
      occurredAt: line.occurredAt.toISOString(),
      evidenceDigest: evidence(),
    },
  });
}

export function decideStatement(
  replica: BillingHttpHarness,
  creditId: unknown,
  expectedRevision: number,
  decision: 'APPROVE' | 'REJECT',
  options: { token?: string; key?: string; rejectionReason?: string | null } = {},
): Promise<HttpReply> {
  return replica.request('POST', `${PATH}/provider-credits/${String(creditId)}/decision`, {
    token: options.token ?? TOKENS.approver,
    key: options.key ?? providerKey(),
    body: {
      expectedRevision,
      decision,
      rejectionReason: options.rejectionReason ?? (decision === 'REJECT' ? 'DETAILS_DIFFER' : null),
    },
  });
}

/** Recorded by one reconciler, approved by another: returns the approved credit view. */
export async function approvedStatement(
  replica: BillingHttpHarness,
  line: StatementLine,
): Promise<Record<string, unknown>> {
  const recorded = await recordStatement(replica, line);
  assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
  assert.equal(recorded.body.status, 'PENDING_APPROVAL');
  const approved = await decideStatement(replica, recorded.body.creditId, 1, 'APPROVE');
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return approved.body;
}
