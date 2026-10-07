import type { ConfigScope, ConfigValue, ReviewDecision } from '../domain/configuration';

export interface Clock {
  now(): Date;
}
export type IdGenerator = () => string;
export type Hasher = (canonical: string) => string;

/** The verified caller of a command, established by the Identity adapter. */
export interface Actor {
  readonly subject: string;
  readonly correlationId: string;
}

export interface RevisionRecord {
  readonly id: string;
  readonly scope: ConfigScope;
  readonly revision: number;
  readonly value: ConfigValue;
  readonly valueHash: string;
  readonly authorSubject: string;
  readonly reason: string;
  readonly proposedAt: Date;
  readonly review: {
    readonly decision: ReviewDecision;
    readonly reviewerSubject: string;
    readonly reviewedAt: Date;
  } | null;
}

export interface PointerRecord {
  readonly activeRevisionId: string;
  readonly activeRevision: number;
  readonly version: number;
}

export type ProposeResult =
  | { readonly kind: 'CREATED'; readonly revision: RevisionRecord }
  | { readonly kind: 'REPLAYED'; readonly revision: RevisionRecord }
  | { readonly kind: 'IDEMPOTENCY_CONFLICT' };

export type ActivateResult =
  | { readonly kind: 'ACTIVATED'; readonly pointer: PointerRecord }
  | { readonly kind: 'VERSION_CONFLICT'; readonly current: PointerRecord | null };

/**
 * Persistence for configuration. Every mutating method runs in one local
 * transaction that also appends the audit row.
 */
export interface ConfigurationRepository {
  propose(input: {
    id: string;
    scope: ConfigScope;
    value: ConfigValue;
    valueHash: string;
    requestHash: string;
    reason: string;
    actor: Actor;
    idempotencyKey: string;
    auditId: string;
    now: Date;
  }): Promise<ProposeResult>;
  review(input: {
    revisionId: string;
    decision: ReviewDecision;
    note: string;
    actor: Actor;
    auditId: string;
    now: Date;
  }): Promise<'RECORDED' | 'ALREADY_REVIEWED' | 'NOT_FOUND' | 'SELF_REVIEW'>;
  /** Compare-and-set on the pointer version; `expectedVersion` 0 means "no pointer yet". */
  activate(input: {
    revisionId: string;
    expectedVersion: number;
    actor: Actor;
    auditId: string;
    now: Date;
  }): Promise<ActivateResult | 'NOT_FOUND'>;
  findRevision(id: string): Promise<RevisionRecord | null>;
  active(scope: ConfigScope): Promise<{ record: RevisionRecord; pointer: PointerRecord } | null>;
  history(scope: ConfigScope, limit: number): Promise<readonly RevisionRecord[]>;
}
