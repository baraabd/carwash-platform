import type { CustodyStatus, HandoverStatus, Money, ReversalReason, WorkEvidence } from '../domain';

/** An authorised cash collection receipt. `collector` is an Identity subject. */
export interface CashReceiptRecord {
  readonly id: string;
  readonly obligationId: string;
  readonly intentId: string;
  readonly bookingId: string;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly collector: string;
  readonly amount: Money;
  readonly custodyStatus: CustodyStatus;
  readonly handoverId: string | null;
  readonly revision: number;
  readonly collectedAt: Date;
  readonly updatedAt: Date;
}

export interface ReversalRecord {
  readonly id: string;
  readonly receiptId: string;
  readonly obligationId: string;
  readonly reason: ReversalReason;
  readonly reversedBy: string;
  readonly reversedAt: Date;
}

export interface HandoverRecord {
  readonly id: string;
  readonly holder: string;
  readonly declared: Money;
  readonly receiptCount: number;
  readonly status: HandoverStatus;
  readonly counted: Money | null;
  readonly shortage: Money | null;
  readonly overage: Money | null;
  /** Normalised treasury reference. Never logged or evented. */
  readonly treasuryReference: string | null;
  readonly receivedBy: string | null;
  readonly receivedAt: Date | null;
  /** Normalised settlement reference. Never logged or evented. */
  readonly settlementReference: string | null;
  readonly reconciledBy: string | null;
  readonly reconciledAt: Date | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: Date | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface HandoverItem {
  readonly receiptId: string;
  readonly amount: Money;
}

export class CollectionAlreadyRecorded extends Error {
  constructor() {
    super('COLLECTION_ALREADY_RECORDED');
    this.name = 'CollectionAlreadyRecorded';
  }
}

export class TreasuryReferenceTaken extends Error {
  constructor() {
    super('TREASURY_REFERENCE_TAKEN');
    this.name = 'TreasuryReferenceTaken';
  }
}

/** Custody writes inside the caller's ONE local ACID transaction. */
export interface CustodyStore {
  /** SELECT … FOR UPDATE. */
  lockReceipt(id: string): Promise<CashReceiptRecord | null>;
  /** SELECT … FOR UPDATE in ascending id order (deadlock-free lock order). */
  lockReceipts(ids: readonly string[]): Promise<CashReceiptRecord[]>;
  /** Throws CollectionAlreadyRecorded when the obligation/booking already has an effective receipt. */
  insertReceipt(receipt: CashReceiptRecord, correlationId: string): Promise<void>;
  /** Compare-and-set on revision; bumps it by one. Throws ConcurrentModification. */
  updateReceiptCustody(
    id: string,
    expectedRevision: number,
    to: CustodyStatus,
    handoverId: string | null,
    at: Date,
  ): Promise<void>;
  insertReversal(reversal: ReversalRecord, correlationId: string): Promise<void>;
  /** SELECT … FOR UPDATE. */
  lockHandover(id: string): Promise<HandoverRecord | null>;
  insertHandover(
    handover: HandoverRecord,
    items: readonly HandoverItem[],
    correlationId: string,
  ): Promise<void>;
  /**
   * Compare-and-set on revision with the full next state; bumps revision by one.
   * Throws ConcurrentModification, or TreasuryReferenceTaken for a reused reference.
   */
  updateHandover(id: string, expectedRevision: number, next: HandoverRecord): Promise<void>;
  handoverReceiptIds(handoverId: string): Promise<string[]>;
}

export interface CustodyBalance {
  readonly currency: string;
  /** Holder's CASH_IN_CUSTODY ledger balance. */
  readonly ledgerCustody: Money;
  readonly held: Money;
  readonly heldCount: number;
  readonly inHandover: Money;
  readonly inHandoverCount: number;
  /** Holder's CUSTODY_SHORTAGE_RECEIVABLE ledger balance (unresolved, B-07). */
  readonly shortageOutstanding: Money;
}

export interface HolderPosition {
  readonly holder: string;
  readonly balances: readonly CustodyBalance[];
}

export interface HolderInvariant {
  readonly holder: string;
  readonly currency: string;
  /** Signed integer strings (minor units); a mismatch may be negative. */
  readonly ledgerCustodyMinor: string;
  readonly receiptsInCustodyMinor: string;
}

export interface TreasuryPosition {
  readonly currency: string;
  readonly unreconciled: Money;
  readonly reconciled: Money;
  readonly shortageOutstanding: Money;
  readonly overageSuspense: Money;
}

/** Cross-checks of Billing's own facts; evaluated in one REPEATABLE READ snapshot. */
export interface CustodyReconciliationReport {
  readonly evaluatedAt: Date;
  /** Holders whose ledger custody differs from their held receipts (must be empty). */
  readonly holderMismatches: readonly HolderInvariant[];
  readonly holdersChecked: number;
  /** Receipts whose obligation is not SETTLED although the receipt is effective (must be 0). */
  readonly receiptsWithoutSettledObligation: number;
  /** Settled cash obligations without an effective receipt (must be 0). */
  readonly cashSettlementsWithoutReceipt: number;
  readonly handoversPending: number;
  readonly handoversAwaitingReconciliation: number;
  readonly handoversWithDiscrepancy: number;
  readonly treasury: readonly TreasuryPosition[];
}

export interface HandoverView {
  readonly handover: HandoverRecord;
  readonly receiptIds: readonly string[];
}

export interface CustodyReader {
  receipt(id: string): Promise<CashReceiptRecord | null>;
  reversalFor(receiptId: string): Promise<ReversalRecord | null>;
  handover(id: string): Promise<HandoverView | null>;
  holderPosition(holder: string): Promise<HolderPosition>;
  reconciliationReport(now: Date): Promise<CustodyReconciliationReport>;
}

export class WorkAuthorityUnavailable extends Error {
  constructor() {
    super('WORK_AUTHORITY_UNAVAILABLE');
    this.name = 'WorkAuthorityUnavailable';
  }
}

/**
 * The work owner's (Dispatch/Booking, lane C) current answer about one booking,
 * read on behalf of the calling technician. Returns null when the booking does
 * not exist for this caller. Any outage, timeout or unparseable answer throws
 * WorkAuthorityUnavailable: never a guessed assignment or work state.
 */
export interface WorkAuthority {
  evidenceFor(
    bookingId: string,
    credential: string,
    correlationId: string,
  ): Promise<WorkEvidence | null>;
}
