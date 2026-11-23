import { maskProviderReference } from '../domain';
import type { ProviderCreditRecord, ProviderDiagnostics, RefundRecord } from '../ports';

/** Never the full merchant account: the last four characters only. */
function maskAccount(account: string): string {
  return `…${account.slice(-4)}`;
}

/** Finance view of one refund. References are masked, digests shortened. */
export function refundView(refund: RefundRecord): Record<string, unknown> {
  return {
    refundId: refund.id,
    creditId: refund.creditId,
    provider: refund.provider,
    amount: refund.amount.toWire(),
    reason: refund.reason,
    channel: refund.channel,
    status: refund.status,
    revision: refund.revision,
    requestedAt: refund.requestedAt.toISOString(),
    decidedAt: refund.decidedAt?.toISOString() ?? null,
    completedAt: refund.completedAt?.toISOString() ?? null,
    providerRefundReference: refund.providerRefundReference
      ? maskProviderReference(refund.providerRefundReference)
      : null,
    evidence: refund.evidenceDigest ? refund.evidenceDigest.slice(0, 12) : null,
    updatedAt: refund.updatedAt.toISOString(),
  };
}

/** Finance view of one provider credit with its refunds. */
export function creditView(
  credit: ProviderCreditRecord,
  refunds: readonly RefundRecord[],
): Record<string, unknown> {
  return {
    creditId: credit.id,
    provider: credit.provider,
    source: credit.source,
    status: credit.status,
    unallocatedReason: credit.unallocatedReason,
    rejectionReason: credit.rejectionReason,
    merchantAccount: maskAccount(credit.merchantAccount),
    reference: maskProviderReference(credit.reference),
    amount: credit.amount.toWire(),
    occurredAt: credit.occurredAt.toISOString(),
    evidence: credit.evidenceDigest.slice(0, 12),
    obligationId: credit.obligationId,
    attemptId: credit.attemptId,
    revision: credit.revision,
    createdAt: credit.createdAt.toISOString(),
    decidedAt: credit.decidedAt?.toISOString() ?? null,
    updatedAt: credit.updatedAt.toISOString(),
    refunds: refunds.map(refundView),
  };
}

export function providerDiagnosticsView(diagnostics: ProviderDiagnostics): Record<string, unknown> {
  return {
    provider: diagnostics.provider,
    integration: diagnostics.integration,
    capabilities: { ...diagnostics.capabilities },
    merchantAccountCount: diagnostics.merchantAccountCount,
    merchantAccountsFingerprint: diagnostics.merchantAccountsFingerprint,
    secretsConfigured: [...diagnostics.secretsConfigured],
  };
}
