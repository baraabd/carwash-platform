import type {
  CaseAction,
  CaseKind,
  CaseStatus,
  CaseSubject,
  DecisionStatus,
  Evidence,
  ExactAmount,
  OwnerOperation,
  OwnerOutcome,
  ReasonCode,
  ServiceWindow,
} from '../domain';

/* ------------------------------ records ------------------------------ */

/** What the owner said about the subject when the case was opened (read-only copy). */
export interface SubjectSnapshot {
  readonly owner: 'billing' | 'booking';
  readonly readAt: string;
  readonly state: Readonly<Record<string, string | number | null>>;
}

export interface CaseRecord {
  readonly id: string;
  readonly kind: CaseKind;
  readonly status: CaseStatus;
  readonly subject: CaseSubject;
  readonly summary: string;
  readonly snapshot: SubjectSnapshot;
  readonly openedBy: string;
  readonly openedAt: Date;
  readonly revision: number;
  readonly updatedAt: Date;
  readonly openKey: string;
  readonly openFingerprint: string;
}

/** The exact owner request of one decision, frozen so every resend is identical. */
export interface OwnerRequest {
  readonly operation: OwnerOperation;
  readonly targetId: string;
  readonly key: string;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface DecisionRecord {
  readonly caseId: string;
  readonly decisionNo: number;
  readonly action: CaseAction;
  readonly reasonCode: ReasonCode;
  readonly reasonNote: string;
  readonly evidence: readonly Evidence[];
  readonly amount: ExactAmount | null;
  readonly window: ServiceWindow | null;
  readonly status: DecisionStatus;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly approvalNote: string | null;
  readonly approvalKey: string | null;
  readonly ownerRequest: OwnerRequest | null;
  readonly ownerHttpStatus: number | null;
  readonly ownerCode: string | null;
  readonly ownerState: string | null;
  readonly executionAttempts: number;
  /** Fences concurrent resends: an execution claim succeeds only on the current value. */
  readonly executionFence: number;
  readonly lastExecutedAt: Date | null;
}

export interface CaseEventRecord {
  readonly id: string;
  readonly caseId: string;
  readonly occurredAt: Date;
  readonly actorSubject: string;
  readonly action: string;
  readonly decisionNo: number | null;
  readonly fromStatus: CaseStatus | null;
  readonly toStatus: CaseStatus;
  readonly outcome: string | null;
  readonly correlationId: string;
}

/** Transactional outbox row (platform-messaging relay layout). */
export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly payload: string;
  readonly correlationId: string;
  readonly createdAt: Date;
}

/* ------------------------------ persistence ------------------------------ */

export interface CaseUnitOfWork {
  /** Locks the case row for the rest of the transaction. */
  lockCase(id: string): Promise<CaseRecord | null>;
  caseByOpenKey(actor: string, key: string): Promise<CaseRecord | null>;
  activeCaseFor(kind: CaseKind, subject: CaseSubject): Promise<CaseRecord | null>;
  insertCase(record: CaseRecord): Promise<void>;
  /** Optimistic: false when the revision moved (a concurrent writer won). */
  updateCase(
    id: string,
    expectedRevision: number,
    patch: { readonly status: CaseStatus; readonly updatedAt: Date },
  ): Promise<boolean>;
  decisions(caseId: string): Promise<readonly DecisionRecord[]>;
  decisionByKey(caseId: string, actor: string, key: string): Promise<DecisionRecord | null>;
  insertDecision(record: DecisionRecord): Promise<void>;
  /** Fenced: false when another execution claimed or finished it first. */
  updateDecision(
    caseId: string,
    decisionNo: number,
    expectedFence: number,
    patch: Partial<
      Pick<
        DecisionRecord,
        | 'status'
        | 'approvedBy'
        | 'approvedAt'
        | 'approvalNote'
        | 'approvalKey'
        | 'ownerRequest'
        | 'ownerHttpStatus'
        | 'ownerCode'
        | 'ownerState'
        | 'executionAttempts'
        | 'executionFence'
        | 'lastExecutedAt'
      >
    >,
  ): Promise<boolean>;
  appendEvent(event: CaseEventRecord): Promise<void>;
  enqueue(event: OutboxEvent): Promise<void>;
}

export interface CaseStore {
  transaction<T>(work: (uow: CaseUnitOfWork) => Promise<T>): Promise<T>;
}

export interface CaseListFilter {
  readonly kinds: readonly CaseKind[];
  readonly statuses: readonly CaseStatus[] | null;
  readonly subject: { readonly type: string; readonly id: string } | null;
  readonly limit: number;
  readonly cursor: { readonly openedAt: Date; readonly id: string } | null;
}

export interface CaseDetail {
  readonly record: CaseRecord;
  readonly decisions: readonly DecisionRecord[];
  readonly events: readonly CaseEventRecord[];
}

export interface CaseReader {
  list(filter: CaseListFilter): Promise<readonly CaseRecord[]>;
  detail(id: string): Promise<CaseDetail | null>;
}

/* ------------------------------ owners ------------------------------ */

/**
 * The caller's own authority, forwarded to the owner (on behalf of). Support
 * holds no standing credential for Billing or Booking: the owner authorizes
 * and audits the human who decided, and refuses whatever that person may not do.
 */
export interface OnBehalfOf {
  readonly credential: string;
  readonly correlationId: string;
}

export class OwnerReadError extends Error {
  constructor(readonly code: 'OWNER_UNAVAILABLE' | 'OWNER_FORBIDDEN' | 'OWNER_INVALID_RESPONSE') {
    super(code);
    this.name = 'OwnerReadError';
  }
}

export interface AttemptState {
  readonly attemptId: string;
  readonly status: string;
  readonly method: string;
  readonly claimed: ExactAmount;
}

/** Billing's answer, reduced to what a case may keep: no provider reference, no owner. */
export interface ObligationState {
  readonly obligationId: string;
  readonly revision: number;
  readonly status: string;
  readonly financialStatus: string;
  readonly amount: ExactAmount;
  readonly verified: ExactAmount;
  readonly outstanding: ExactAmount;
  readonly attempts: readonly AttemptState[];
}

/** Booking's answer, reduced: no contact, address, vehicle or beneficiary. */
export interface BookingState {
  readonly bookingId: string;
  readonly revision: number;
  readonly status: string;
  readonly confirmation: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface BillingOwner {
  /** null when Billing says the obligation does not exist (or is not visible). */
  obligation(auth: OnBehalfOf, obligationId: string): Promise<ObligationState | null>;
  execute(auth: OnBehalfOf, request: OwnerRequest): Promise<OwnerOutcome>;
}

export interface BookingOwner {
  booking(auth: OnBehalfOf, bookingId: string): Promise<BookingState | null>;
  execute(auth: OnBehalfOf, request: OwnerRequest): Promise<OwnerOutcome>;
}

/* ------------------------------ system ------------------------------ */

export interface Clock {
  now(): Date;
}

export interface IdSource {
  uuid(): string;
}

/** A database uniqueness backstop fired (a concurrent writer got there first). */
export class CaseConflict extends Error {
  constructor(readonly constraint: 'ACTIVE_SUBJECT' | 'OPEN_KEY' | 'DECISION' | 'OTHER') {
    super(`CASE_CONFLICT_${constraint}`);
    this.name = 'CaseConflict';
  }
}
