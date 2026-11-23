import type { Buckets, Currency, MovementKind, SourceKind, SourceState } from '../domain';

export const INBOX_OUTCOMES = ['APPLIED', 'STALE', 'REJECTED'] as const;
export type InboxOutcome = (typeof INBOX_OUTCOMES)[number];

/** One consumed Billing event, recorded once by its event id. */
export interface InboxRecord {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string | null;
  readonly aggregateId: string | null;
  readonly aggregateVersion: number | null;
  readonly outcome: InboxOutcome;
  readonly reason: string | null;
  readonly correlationId: string | null;
  readonly receivedAt: Date;
}

export interface CustodyAccount {
  readonly holder: string;
  readonly currency: Currency;
  readonly balances: Buckets;
  readonly version: number;
  readonly updatedAt: Date;
}

/** A projection movement: mirrors exactly one Billing event and cites it. */
export interface CustodyMovement {
  readonly id: string;
  readonly holder: string;
  readonly currency: Currency;
  readonly kind: MovementKind;
  readonly delta: Buckets;
  readonly eventId: string;
  readonly eventType: string;
  readonly sourceKind: SourceKind;
  readonly sourceId: string;
  readonly sourceVersion: number;
  /** When Billing recorded the fact (event occurredAt). */
  readonly occurredAt: Date;
  readonly recordedAt: Date;
}

export interface WalletUnitOfWork {
  /**
   * Inserts the inbox row; false when that event id was already consumed (a
   * concurrent duplicate waits for the first transaction and then sees it).
   */
  claimEvent(record: InboxRecord): Promise<boolean>;
  /** Row-locks the projected state of one Billing aggregate. */
  lockSource(kind: SourceKind, aggregateId: string): Promise<SourceState | null>;
  saveSource(state: SourceState, at: Date): Promise<void>;
  /** Creates the (holder, currency) account if absent, then row-locks it. */
  lockAccount(holder: string, currency: Currency, at: Date): Promise<CustodyAccount>;
  updateAccount(account: CustodyAccount): Promise<void>;
  appendMovement(movement: CustodyMovement): Promise<void>;
}

export interface WalletRepository {
  transaction<T>(work: (uow: WalletUnitOfWork) => Promise<T>): Promise<T>;
  inboxRecord(eventId: string): Promise<InboxRecord | null>;
  accountsOf(holder: string): Promise<CustodyAccount[]>;
  movementsOf(holder: string, limit: number): Promise<CustodyMovement[]>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
}

export interface VerifiedPrincipal {
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

export interface AccessAuthority {
  verify(credential: string | undefined, correlationId: string): Promise<VerifiedPrincipal>;
}
