import type {
  ConfigurationContentV1,
  ConfigurationNamespace,
  DraftStatus,
} from '../domain/configuration-v1';
import type { Actor } from './configuration.ports';

/** One market policy scope; `id` is the event aggregate id (configuration-scope). */
export interface ScopeRef {
  readonly marketId: string;
  readonly namespace: ConfigurationNamespace;
}

export interface DraftRecord {
  readonly id: string;
  readonly scope: ScopeRef;
  readonly revision: number;
  readonly status: DraftStatus;
  readonly baseVersion: number | null;
  readonly content: ConfigurationContentV1;
  readonly contentHash: string;
  readonly authorSubject: string;
  readonly createdAt: Date;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly publishedBy: string | null;
  readonly publishedAt: Date | null;
  readonly publishedVersion: number | null;
  readonly withdrawnBy: string | null;
  readonly withdrawnAt: Date | null;
}

/** An immutable published version of a scope. */
export interface PublishedRecord {
  readonly scope: ScopeRef;
  readonly version: number;
  readonly draftId: string;
  readonly content: ConfigurationContentV1;
  readonly contentHash: string;
  readonly effectiveAt: Date;
  readonly publishedBy: string;
  readonly publishedAt: Date;
}

export const HISTORY_ACTIONS = [
  'DRAFT_CREATED',
  'DRAFT_APPROVED',
  'DRAFT_PUBLISHED',
  'DRAFT_WITHDRAWN',
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export interface HistoryRecord {
  readonly id: string;
  /** Insertion order; the paging cursor (decimal text of a bigint). */
  readonly seq: string;
  readonly action: HistoryAction;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly version: number | null;
  readonly contentHash: string;
  readonly actorSubject: string;
  /** configuration.v1 bodies carry no reason yet (CR-D-P05-D5-03): null until they do. */
  readonly reason: string | null;
  readonly correlationId: string;
  readonly occurredAt: Date;
}

/** A row for the transactional outbox, committed with the change it reports. */
export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly payload: string;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

/** The stored outcome of an idempotent command, replayed byte-for-byte. */
export interface CommandOutcome {
  readonly status: number;
  readonly body: unknown;
}

export type CommandResult =
  | { readonly kind: 'APPLIED'; readonly outcome: CommandOutcome }
  | { readonly kind: 'REPLAYED'; readonly outcome: CommandOutcome }
  | { readonly kind: 'IDEMPOTENCY_CONFLICT' };

export interface IdempotencyStamp {
  readonly key: string;
  readonly operation: string;
  readonly fingerprint: string;
}

export interface CommandEnvelope {
  readonly actor: Actor;
  readonly idempotency: IdempotencyStamp;
  readonly now: Date;
  readonly historyId: string;
}

/**
 * Persistence for configuration.v1. Every command runs in ONE local
 * transaction that checks the idempotency record, applies the domain rule,
 * appends the history row, writes the outbox row (publish only) and stores the
 * replayable outcome. Domain rule failures roll the transaction back.
 */
export interface ConfigurationV1Store {
  createDraft(
    command: CommandEnvelope & {
      readonly scope: ScopeRef;
      readonly scopeId: string;
      readonly draftId: string;
      readonly expectedVersion: number | null;
      readonly content: ConfigurationContentV1;
      readonly contentHash: string;
      readonly render: (draft: DraftRecord) => CommandOutcome;
    },
  ): Promise<CommandResult>;
  approve(
    command: CommandEnvelope & {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly render: (draft: DraftRecord) => CommandOutcome;
    },
  ): Promise<CommandResult | 'NOT_FOUND'>;
  publish(
    command: CommandEnvelope & {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly versionId: string;
      readonly event: (input: {
        readonly scopeId: string;
        readonly published: PublishedRecord;
      }) => OutboxEvent;
      readonly render: (draft: DraftRecord, published: PublishedRecord) => CommandOutcome;
    },
  ): Promise<CommandResult | 'NOT_FOUND'>;
  withdraw(
    command: CommandEnvelope & {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly render: (draft: DraftRecord) => CommandOutcome;
    },
  ): Promise<CommandResult | 'NOT_FOUND'>;

  /** The scope's current published version, or null when nothing was published. */
  current(scope: ScopeRef): Promise<PublishedRecord | null>;
  /** Published version counter, current version and open draft, from one snapshot. */
  overview(scope: ScopeRef): Promise<{
    readonly publishedVersion: number;
    readonly current: PublishedRecord | null;
    readonly openDraft: DraftRecord | null;
  }>;
  versions(
    scope: ScopeRef,
    page: { readonly limit: number; readonly beforeVersion: number | null },
  ): Promise<readonly PublishedRecord[]>;
  version(scope: ScopeRef, version: number): Promise<PublishedRecord | null>;
  history(
    scope: ScopeRef,
    page: { readonly limit: number; readonly beforeSeq: string | null },
  ): Promise<readonly HistoryRecord[]>;
  draft(id: string): Promise<DraftRecord | null>;
}

/** A verified service-to-service caller (configuration.v1 `service:` access). */
export interface ServiceCaller {
  readonly clientId: string;
}

export const CONFIGURATION_SERVICE_SCOPES = ['configuration.read'] as const;
export type ConfigurationServiceScope = (typeof CONFIGURATION_SERVICE_SCOPES)[number];

/**
 * Authenticates a workload and requires one scope. Implementations fail
 * closed: unknown client, bad token or missing scope never pass.
 */
export interface ServiceCallerAuthenticator {
  authorize(input: {
    readonly clientId: string | undefined;
    readonly token: string | undefined;
    readonly scope: ConfigurationServiceScope;
  }): ServiceCaller;
}
