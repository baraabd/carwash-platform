import type {
  Currency,
  HandoverState,
  MovementKind,
  PositionTotals,
  ReceiptState,
} from '../domain';

// ------------------------------------------------------------------ identity

export type PrincipalKind = 'account' | 'guest';

export interface VerifiedPrincipal {
  readonly kind: PrincipalKind;
  readonly subject: string;
  readonly sessionId: string;
  readonly permissions: readonly string[];
}

export type AccessFailure = 'AUTH_REQUIRED' | 'AUTH_UNAVAILABLE';

export class AccessDenied extends Error {
  constructor(readonly reason: AccessFailure) {
    super(reason);
    this.name = 'AccessDenied';
  }
}

/** Current Identity session decision per request; never cached, fails closed. */
export interface AccessAuthority {
  verify(credential: string | undefined, correlationId: string): Promise<VerifiedPrincipal>;
}

// ------------------------------------------------------------------- system

export interface Clock {
  now(): Date;
}

export interface Hasher {
  sha256Hex(text: string): string;
}

export interface IdGenerator {
  uuid(): string;
}

// -------------------------------------------------------------------- inbox

/**
 * APPLIED: state changed. STALE: an older/repeated fact already reflected.
 * IGNORED: not a custody event. POISON: unreadable or contradictory; kept for
 * diagnosis and never retried (the same bytes would fail the same way).
 */
export const INBOX_OUTCOMES = ['APPLIED', 'STALE', 'IGNORED', 'POISON'] as const;
export type InboxOutcome = (typeof INBOX_OUTCOMES)[number];

export interface InboxEntry {
  readonly eventId: string;
  readonly eventType: string;
  readonly payloadHash: string;
  readonly outcome: InboxOutcome;
  /** Closed reason code for IGNORED/POISON; never free text or payload data. */
  readonly reason: string | null;
  readonly aggregate: {
    readonly type: string;
    readonly id: string;
    readonly version: number;
  } | null;
  readonly correlationId: string | null;
  readonly occurredAt: Date | null;
  readonly receivedAt: Date;
}

export interface CommittedInbox {
  readonly payloadHash: string;
  readonly outcome: InboxOutcome;
}

// ------------------------------------------------------------- projection

export interface AccountRef {
  readonly id: string;
  readonly holder: string;
  readonly currency: Currency;
}

export interface MovementRecord {
  readonly id: string;
  readonly account: AccountRef;
  readonly eventId: string;
  readonly kind: MovementKind;
  readonly amountMinor: bigint;
  /** The Billing aggregate the event belongs to (receipt or handover). */
  readonly source: { readonly type: string; readonly id: string };
  /** The delivery that attributed this movement (differs for a late-attributed reversal). */
  readonly appliedWithEventId: string;
  readonly accountRevision: number;
  readonly recordedAt: Date;
}

export interface CustodyUnitOfWork {
  /** The committed inbox row, if any (read inside the transaction). */
  inbox(eventId: string): Promise<CommittedInbox | null>;
  /**
   * Inserts the inbox row; false when another delivery committed it first
   * (the caller then classifies against the winner and writes nothing else).
   */
  claimInbox(entry: InboxEntry): Promise<boolean>;
  recordInboxConflict(eventId: string, payloadHash: string, detectedAt: Date): Promise<void>;
  /** Serialises every event of one Billing aggregate (receipt or handover). */
  lockAggregate(aggregateId: string): Promise<void>;
  receipt(receiptId: string): Promise<ReceiptState | null>;
  saveReceipt(state: ReceiptState, existed: boolean, now: Date): Promise<void>;
  handover(handoverId: string): Promise<HandoverState | null>;
  saveHandover(state: HandoverState, existed: boolean, now: Date): Promise<void>;
  /** Creates if absent and row-locks the holder's account for this currency. */
  lockAccount(holder: string, currency: Currency, newId: string, now: Date): Promise<AccountRef>;
  /** Re-derives the account balances from the state rows; returns the new revision. */
  refreshAccount(
    account: AccountRef,
    lastEvent: { readonly eventId: string; readonly occurredAt: Date },
    now: Date,
  ): Promise<number>;
  appendMovement(movement: MovementRecord): Promise<void>;
}

export interface CustodyAccountView {
  readonly currency: Currency;
  readonly totals: PositionTotals;
  readonly revision: number;
  readonly lastEventId: string;
  readonly lastEventAt: Date;
  readonly updatedAt: Date;
}

export interface CustodyProjectionStore {
  transaction<T>(work: (uow: CustodyUnitOfWork) => Promise<T>): Promise<T>;
  accounts(holder: string): Promise<CustodyAccountView[]>;
}
