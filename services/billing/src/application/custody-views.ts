import type {
  CashReceiptRecord,
  CustodyReconciliationReport,
  HandoverView,
  HolderPosition,
  ReversalRecord,
} from '../ports';

/** Treasury/settlement references are shown masked: only the last four characters. */
function masked(reference: string | null): string | null {
  return reference === null ? null : `…${reference.slice(-4)}`;
}

export function receiptView(
  receipt: CashReceiptRecord,
  reversal: ReversalRecord | null,
): Record<string, unknown> {
  return {
    receiptId: receipt.id,
    revision: receipt.revision,
    obligationId: receipt.obligationId,
    bookingId: receipt.bookingId,
    assignmentId: receipt.assignmentId,
    assignmentRevision: receipt.assignmentRevision,
    collector: receipt.collector,
    amount: receipt.amount.toWire(),
    custodyStatus: receipt.custodyStatus,
    handoverId: receipt.handoverId,
    collectedAt: receipt.collectedAt.toISOString(),
    updatedAt: receipt.updatedAt.toISOString(),
    reversal: reversal
      ? {
          reversalId: reversal.id,
          reason: reversal.reason,
          reversedBy: reversal.reversedBy,
          reversedAt: reversal.reversedAt.toISOString(),
        }
      : null,
  };
}

export function handoverView(view: HandoverView): Record<string, unknown> {
  const { handover } = view;
  return {
    handoverId: handover.id,
    revision: handover.revision,
    holder: handover.holder,
    status: handover.status,
    receiptCount: handover.receiptCount,
    receiptIds: [...view.receiptIds],
    declared: handover.declared.toWire(),
    counted: handover.counted?.toWire() ?? null,
    shortage: handover.shortage?.toWire() ?? null,
    overage: handover.overage?.toWire() ?? null,
    treasuryReference: masked(handover.treasuryReference),
    receivedBy: handover.receivedBy,
    receivedAt: handover.receivedAt?.toISOString() ?? null,
    settlementReference: masked(handover.settlementReference),
    reconciledBy: handover.reconciledBy,
    reconciledAt: handover.reconciledAt?.toISOString() ?? null,
    cancelledBy: handover.cancelledBy,
    cancelledAt: handover.cancelledAt?.toISOString() ?? null,
    createdAt: handover.createdAt.toISOString(),
    updatedAt: handover.updatedAt.toISOString(),
  };
}

export function holderPositionView(position: HolderPosition): Record<string, unknown> {
  return {
    holder: position.holder,
    balances: position.balances.map((balance) => ({
      currency: balance.currency,
      ledgerCustody: balance.ledgerCustody.toWire(),
      held: balance.held.toWire(),
      heldCount: balance.heldCount,
      inHandover: balance.inHandover.toWire(),
      inHandoverCount: balance.inHandoverCount,
      shortageOutstanding: balance.shortageOutstanding.toWire(),
    })),
  };
}

export function reconciliationView(report: CustodyReconciliationReport): Record<string, unknown> {
  const consistent =
    report.holderMismatches.length === 0 &&
    report.receiptsWithoutSettledObligation === 0 &&
    report.cashSettlementsWithoutReceipt === 0;
  return {
    evaluatedAt: report.evaluatedAt.toISOString(),
    consistent,
    holdersChecked: report.holdersChecked,
    holderMismatches: report.holderMismatches.map((mismatch) => ({
      holder: mismatch.holder,
      currency: mismatch.currency,
      ledgerCustodyMinor: mismatch.ledgerCustodyMinor,
      receiptsInCustodyMinor: mismatch.receiptsInCustodyMinor,
    })),
    receiptsWithoutSettledObligation: report.receiptsWithoutSettledObligation,
    cashSettlementsWithoutReceipt: report.cashSettlementsWithoutReceipt,
    handoversPending: report.handoversPending,
    handoversAwaitingReconciliation: report.handoversAwaitingReconciliation,
    handoversWithDiscrepancy: report.handoversWithDiscrepancy,
    treasury: report.treasury.map((position) => ({
      currency: position.currency,
      unreconciled: position.unreconciled.toWire(),
      reconciled: position.reconciled.toWire(),
      shortageOutstanding: position.shortageOutstanding.toWire(),
      overageSuspense: position.overageSuspense.toWire(),
    })),
  };
}
