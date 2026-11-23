import {
  ConfigurationV1RuleError,
  assertNoSecrets,
  contentHashMaterial,
  diffContent,
  idempotencyMaterial,
  parseCreateDraftRequestV1,
  parseDraftId,
  parseDraftTransitionRequestV1,
  parseIdempotencyKey,
  parseMarketId,
  parseNamespace,
  parseRevision,
  ConfigurationContractViolation,
  type FieldChange,
} from '../domain/configuration-v1';
import type { Actor, Clock, Hasher, IdGenerator } from '../ports/configuration.ports';
import type {
  CommandResult,
  ConfigurationV1Store,
  DraftRecord,
  HistoryRecord,
  PublishedRecord,
  ScopeRef,
} from '../ports/configuration-v1.ports';
import { configurationPublishedEvent } from './events';

export const MAX_V1_PAGE = 50;
export const DEFAULT_V1_PAGE = 20;

/* --------------------------------- views ---------------------------------- */

/** PublishedConfigurationV1 exactly as the published contract parses it. */
export function publishedView(record: PublishedRecord) {
  return {
    marketId: record.scope.marketId,
    namespace: record.content.namespace,
    version: record.version,
    effectiveAt: record.effectiveAt.toISOString(),
    contentHash: record.contentHash,
    content: record.content.content,
  };
}
export type PublishedView = ReturnType<typeof publishedView>;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function draftView(record: DraftRecord) {
  return {
    draftId: record.id,
    marketId: record.scope.marketId,
    namespace: record.scope.namespace,
    revision: record.revision,
    status: record.status,
    baseVersion: record.baseVersion,
    content: record.content.content,
    contentHash: record.contentHash,
    authorSubject: record.authorSubject,
    createdAt: record.createdAt.toISOString(),
    approvedBy: record.approvedBy,
    approvedAt: iso(record.approvedAt),
    publishedBy: record.publishedBy,
    publishedAt: iso(record.publishedAt),
    publishedVersion: record.publishedVersion,
    withdrawnBy: record.withdrawnBy,
    withdrawnAt: iso(record.withdrawnAt),
  };
}
export type DraftView = ReturnType<typeof draftView>;

export function versionView(record: PublishedRecord) {
  return {
    version: record.version,
    draftId: record.draftId,
    contentHash: record.contentHash,
    effectiveAt: record.effectiveAt.toISOString(),
    publishedBy: record.publishedBy,
    publishedAt: record.publishedAt.toISOString(),
    content: record.content.content,
  };
}

export function historyView(record: HistoryRecord) {
  return {
    id: record.id,
    seq: record.seq,
    action: record.action,
    draftId: record.draftId,
    draftRevision: record.draftRevision,
    version: record.version,
    contentHash: record.contentHash,
    actorSubject: record.actorSubject,
    reason: record.reason,
    correlationId: record.correlationId,
    occurredAt: record.occurredAt.toISOString(),
  };
}

/* -------------------------------- commands -------------------------------- */

export interface RequestMeta {
  readonly actor: Actor;
  readonly idempotencyKey: unknown;
  readonly traceParent: string | null;
}

function scopeOf(marketId: unknown, namespace: unknown): ScopeRef {
  return {
    marketId: parseMarketId(marketId, 'path.marketId'),
    namespace: parseNamespace(namespace, 'path.namespace'),
  };
}

/**
 * configuration.v1 commands. Each one is idempotent: (actor, Idempotency-Key)
 * replays the stored outcome when the fingerprint matches and is refused with
 * IDEMPOTENCY_CONFLICT when it does not.
 */
export class ConfigurationV1Commands {
  constructor(
    private readonly store: ConfigurationV1Store,
    private readonly clock: Clock,
    private readonly hash: Hasher,
    private readonly newId: IdGenerator,
  ) {}

  private stamp(meta: RequestMeta, operation: string, target: string | null, body: unknown) {
    const key = parseIdempotencyKey(meta.idempotencyKey);
    return {
      actor: meta.actor,
      now: this.clock.now(),
      historyId: this.newId(),
      idempotency: {
        key,
        operation,
        fingerprint: this.hash(
          idempotencyMaterial({ operation, actor: meta.actor.subject, target, body }),
        ),
      },
    };
  }

  createDraft(
    meta: RequestMeta,
    marketId: unknown,
    namespace: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const scope = scopeOf(marketId, namespace);
    // The key is checked before the body so a missing key never costs validation work.
    parseIdempotencyKey(meta.idempotencyKey);
    const request = parseCreateDraftRequestV1(scope.namespace, body);
    assertNoSecrets(request.content);
    return this.store.createDraft({
      ...this.stamp(meta, 'createDraft', `${scope.marketId}/${scope.namespace}`, request),
      scope,
      scopeId: this.newId(),
      draftId: this.newId(),
      expectedVersion: request.expectedVersion,
      content: request.content,
      contentHash: this.hash(contentHashMaterial(request.content)),
      render: (draft) => ({ status: 201, body: draftView(draft) }),
    });
  }

  approve(meta: RequestMeta, draftId: unknown, body: unknown) {
    const id = parseDraftId(draftId, 'path.draftId');
    parseIdempotencyKey(meta.idempotencyKey);
    const request = parseDraftTransitionRequestV1(body);
    return this.store.approve({
      ...this.stamp(meta, 'approveDraft', id, request),
      draftId: id,
      expectedRevision: request.expectedRevision,
      render: (draft) => ({ status: 200, body: draftView(draft) }),
    });
  }

  publish(meta: RequestMeta, draftId: unknown, body: unknown) {
    const id = parseDraftId(draftId, 'path.draftId');
    parseIdempotencyKey(meta.idempotencyKey);
    const request = parseDraftTransitionRequestV1(body);
    const stamp = this.stamp(meta, 'publishDraft', id, request);
    const eventId = this.newId();
    return this.store.publish({
      ...stamp,
      draftId: id,
      expectedRevision: request.expectedRevision,
      versionId: this.newId(),
      // effectiveAt is the commit clock: the contract's publish body carries
      // no requested time, so a version is effective from publication.
      event: ({ scopeId, published }) =>
        configurationPublishedEvent(
          {
            eventId,
            occurredAt: stamp.now,
            correlationId: meta.actor.correlationId,
            traceParent: meta.traceParent,
            actorSubject: meta.actor.subject,
          },
          scopeId,
          published,
        ),
      render: (draft, published) => ({
        status: 200,
        body: { draft: draftView(draft), published: publishedView(published) },
      }),
    });
  }

  /** Owner-local (not in configuration.v1): close an abandoned open draft. */
  withdraw(meta: RequestMeta, draftId: unknown, body: unknown) {
    const id = parseDraftId(draftId, 'path.draftId');
    parseIdempotencyKey(meta.idempotencyKey);
    const request = parseDraftTransitionRequestV1(body);
    return this.store.withdraw({
      ...this.stamp(meta, 'withdrawDraft', id, request),
      draftId: id,
      expectedRevision: request.expectedRevision,
      render: (draft) => ({ status: 200, body: draftView(draft) }),
    });
  }
}

/* --------------------------------- queries -------------------------------- */

function limitOf(value: unknown): number {
  if (value === undefined) return DEFAULT_V1_PAGE;
  const limit = typeof value === 'string' && /^[0-9]{1,3}$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_V1_PAGE)
    throw new ConfigurationContractViolation('INVALID_INTEGER', 'query.limit');
  return limit;
}

function versionOf(value: unknown, path: string): number {
  const parsed = typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : NaN;
  return parseRevision(parsed, path);
}

function seqOf(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,17}$/.test(value))
    throw new ConfigurationContractViolation('INVALID_CURSOR', 'query.beforeSeq');
  return value;
}

export interface DiffView {
  readonly marketId: string;
  readonly namespace: string;
  readonly from: ReturnType<typeof versionView>;
  readonly to: ReturnType<typeof versionView>;
  readonly changes: readonly FieldChange[];
}

export class ConfigurationV1Queries {
  constructor(private readonly store: ConfigurationV1Store) {}

  /** getCurrent: the published policy, or POLICY_UNAVAILABLE. Never a default. */
  async current(marketId: unknown, namespace: unknown): Promise<PublishedView> {
    const found = await this.store.current(scopeOf(marketId, namespace));
    if (!found) throw new ConfigurationV1RuleError('POLICY_UNAVAILABLE');
    return publishedView(found);
  }

  async overview(marketId: unknown, namespace: unknown) {
    const scope = scopeOf(marketId, namespace);
    const snapshot = await this.store.overview(scope);
    return {
      marketId: scope.marketId,
      namespace: scope.namespace,
      publishedVersion: snapshot.publishedVersion,
      current: snapshot.current && publishedView(snapshot.current),
      openDraft: snapshot.openDraft && draftView(snapshot.openDraft),
    };
  }

  async versions(
    marketId: unknown,
    namespace: unknown,
    query: { limit?: unknown; beforeVersion?: unknown },
  ) {
    const scope = scopeOf(marketId, namespace);
    const limit = limitOf(query.limit);
    const beforeVersion =
      query.beforeVersion === undefined
        ? null
        : versionOf(query.beforeVersion, 'query.beforeVersion');
    const rows = await this.store.versions(scope, { limit, beforeVersion });
    return {
      marketId: scope.marketId,
      namespace: scope.namespace,
      items: rows.map(versionView),
    };
  }

  async history(
    marketId: unknown,
    namespace: unknown,
    query: { limit?: unknown; beforeSeq?: unknown },
  ) {
    const scope = scopeOf(marketId, namespace);
    const limit = limitOf(query.limit);
    const beforeSeq = query.beforeSeq === undefined ? null : seqOf(query.beforeSeq);
    const rows = await this.store.history(scope, { limit, beforeSeq });
    return {
      marketId: scope.marketId,
      namespace: scope.namespace,
      items: rows.map(historyView),
    };
  }

  /** Both contents and the field-level changes between two published versions. */
  async diff(
    marketId: unknown,
    namespace: unknown,
    query: { from?: unknown; to?: unknown },
  ): Promise<DiffView | 'NOT_FOUND'> {
    const scope = scopeOf(marketId, namespace);
    const fromVersion = versionOf(query.from, 'query.from');
    const toVersion = versionOf(query.to, 'query.to');
    const [from, to] = await Promise.all([
      this.store.version(scope, fromVersion),
      this.store.version(scope, toVersion),
    ]);
    if (!from || !to) return 'NOT_FOUND';
    return {
      marketId: scope.marketId,
      namespace: scope.namespace,
      from: versionView(from),
      to: versionView(to),
      changes: diffContent(from.content.content, to.content.content),
    };
  }

  async draft(draftId: unknown) {
    const found = await this.store.draft(parseDraftId(draftId, 'path.draftId'));
    return found ? draftView(found) : 'NOT_FOUND';
  }
}
