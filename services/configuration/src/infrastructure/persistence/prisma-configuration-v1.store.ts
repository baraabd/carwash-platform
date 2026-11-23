import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  ConfigurationContractViolation,
  DRAFT_STATUSES,
  assertApprovable,
  assertDraftBase,
  assertNoOpenDraft,
  assertPublishable,
  assertWithdrawable,
  contentHashMaterial,
  parseConfigurationContentV1,
  parseMarketId,
  parseNamespace,
  type ConfigurationContentV1,
} from '../../domain/configuration-v1';
import {
  HISTORY_ACTIONS,
  type CommandEnvelope,
  type CommandOutcome,
  type CommandResult,
  type ConfigurationV1Store,
  type DraftRecord,
  type HistoryAction,
  type HistoryRecord,
  type OutboxEvent,
  type PublishedRecord,
  type ScopeRef,
} from '../../ports/configuration-v1.ports';
import type { Hasher } from '../../ports/configuration.ports';

type Tx = Prisma.TransactionClient;

const draftInclude = { scope: true } as const;
type DraftRow = Prisma.ConfigDraftGetPayload<{ include: typeof draftInclude }>;
const versionInclude = { scope: true } as const;
type VersionRow = Prisma.ConfigVersionGetPayload<{ include: typeof versionInclude }>;

/** A persisted row that no longer satisfies the owner rules: never served. */
export class ConfigurationIntegrityError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ConfigurationIntegrityError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P2002' || code === '23505';
}

function scopeOf(row: { marketId: string; namespace: string }): ScopeRef {
  try {
    return {
      marketId: parseMarketId(row.marketId, 'row.marketId'),
      namespace: parseNamespace(row.namespace, 'row.namespace'),
    };
  } catch {
    throw new ConfigurationIntegrityError('CORRUPT_PERSISTED_SCOPE');
  }
}

/** Plain JSON object for a Prisma Json column; content values are scalars. */
function jsonObject(value: object): Prisma.InputJsonObject {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean')
      throw new ConfigurationIntegrityError('NON_SCALAR_CONTENT');
    out[key] = entry;
  }
  return out;
}

export class PrismaConfigurationV1Store implements ConfigurationV1Store {
  constructor(
    private readonly client: PrismaClient,
    private readonly hash: Hasher,
  ) {}

  /* ------------------------------- mapping -------------------------------- */

  /** Re-validated on the way out: corrupted content or hash fails loudly. */
  private content(scope: ScopeRef, raw: unknown, contentHash: string): ConfigurationContentV1 {
    let content: ConfigurationContentV1;
    try {
      content = parseConfigurationContentV1(scope.namespace, raw, 'row');
    } catch (error: unknown) {
      if (error instanceof ConfigurationContractViolation)
        throw new ConfigurationIntegrityError('CORRUPT_PERSISTED_CONTENT');
      throw error;
    }
    if (this.hash(contentHashMaterial(content)) !== contentHash)
      throw new ConfigurationIntegrityError('CONTENT_HASH_MISMATCH');
    return content;
  }

  private toDraft(row: DraftRow): DraftRecord {
    const scope = scopeOf(row.scope);
    const status = DRAFT_STATUSES.find((s) => s === row.status);
    if (!status) throw new ConfigurationIntegrityError('CORRUPT_PERSISTED_STATUS');
    return {
      id: row.id,
      scope,
      revision: row.revision,
      status,
      baseVersion: row.baseVersion,
      content: this.content(scope, row.content, row.contentHash),
      contentHash: row.contentHash,
      authorSubject: row.authorSubject,
      createdAt: row.createdAt,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      publishedBy: row.publishedBy,
      publishedAt: row.publishedAt,
      publishedVersion: row.publishedVersion,
      withdrawnBy: row.withdrawnBy,
      withdrawnAt: row.withdrawnAt,
    };
  }

  private toPublished(row: VersionRow): PublishedRecord {
    const scope = scopeOf(row.scope);
    return {
      scope,
      version: row.version,
      draftId: row.draftId,
      content: this.content(scope, row.content, row.contentHash),
      contentHash: row.contentHash,
      effectiveAt: row.effectiveAt,
      publishedBy: row.publishedBy,
      publishedAt: row.publishedAt,
    };
  }

  /* ---------------------------- command frame ----------------------------- */

  /**
   * One transaction per command:
   *  1. serialize on (actor, key) with a transaction-scoped advisory lock, so
   *     a concurrent retry of the same request waits and then REPLAYS,
   *  2. replay or refuse a known key,
   *  3. apply the change (domain rules may throw: everything rolls back),
   *  4. store the replayable outcome.
   * Unique-constraint backstops (two first drafts racing on the partial index)
   * retry the whole command once more, which then meets the domain rule.
   */
  private async command(
    envelope: CommandEnvelope,
    work: (tx: Tx) => Promise<CommandOutcome | 'NOT_FOUND'>,
  ): Promise<CommandResult | 'NOT_FOUND'> {
    const { actor, idempotency } = envelope;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.client.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`config-idem:${actor.subject}:${idempotency.key}`}, 0))`;
          const prior = await tx.configIdempotency.findUnique({
            where: {
              actorSubject_idempotencyKey: {
                actorSubject: actor.subject,
                idempotencyKey: idempotency.key,
              },
            },
          });
          if (prior) {
            return prior.fingerprint === idempotency.fingerprint
              ? {
                  kind: 'REPLAYED' as const,
                  outcome: { status: prior.statusCode, body: prior.response },
                }
              : { kind: 'IDEMPOTENCY_CONFLICT' as const };
          }
          const outcome = await work(tx);
          if (outcome === 'NOT_FOUND') return 'NOT_FOUND' as const;
          await tx.$executeRaw`
            INSERT INTO app.config_idempotency
              (actor_subject, idempotency_key, operation, fingerprint, status_code, response, created_at)
            VALUES (${actor.subject}::uuid, ${idempotency.key}, ${idempotency.operation},
                    ${idempotency.fingerprint}, ${outcome.status},
                    ${JSON.stringify(outcome.body)}::jsonb, ${envelope.now})`;
          return { kind: 'APPLIED' as const, outcome };
        });
      } catch (error: unknown) {
        if (!isUniqueViolation(error) || attempt >= 2) throw error;
      }
    }
  }

  private async appendHistory(
    tx: Tx,
    envelope: CommandEnvelope,
    input: {
      scopeId: string;
      draftId: string;
      action: HistoryAction;
      draftRevision: number;
      version: number | null;
      contentHash: string;
    },
  ): Promise<void> {
    await tx.configHistory.create({
      data: {
        id: envelope.historyId,
        scopeId: input.scopeId,
        draftId: input.draftId,
        action: input.action,
        draftRevision: input.draftRevision,
        version: input.version,
        contentHash: input.contentHash,
        actorSubject: envelope.actor.subject,
        reason: null,
        correlationId: envelope.actor.correlationId,
        occurredAt: envelope.now,
      },
    });
  }

  private async lockDraft(tx: Tx, id: string): Promise<DraftRow | null> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM app.config_draft WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    return tx.configDraft.findUnique({ where: { id }, include: draftInclude });
  }

  private async lockScope(tx: Tx, id: string): Promise<number> {
    const rows = await tx.$queryRaw<{ published_version: number }[]>`
      SELECT published_version FROM app.config_scope WHERE id = ${id}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new ConfigurationIntegrityError('SCOPE_MISSING');
    return row.published_version;
  }

  /* ------------------------------- commands ------------------------------- */

  async createDraft(
    command: Parameters<ConfigurationV1Store['createDraft']>[0],
  ): Promise<CommandResult> {
    const result = await this.command(command, async (tx) => {
      const { marketId, namespace } = command.scope;
      // First draft of a scope creates the scope; concurrent creators converge.
      await tx.$executeRaw`
        INSERT INTO app.config_scope (id, market_id, namespace, published_version, created_at, updated_at)
        VALUES (${command.scopeId}::uuid, ${marketId}, ${namespace}, 0, ${command.now}, ${command.now})
        ON CONFLICT (market_id, namespace) DO NOTHING`;
      // Serialize every draft decision of this scope on its row.
      const rows = await tx.$queryRaw<{ id: string; published_version: number }[]>`
        SELECT id::text, published_version FROM app.config_scope
         WHERE market_id = ${marketId} AND namespace = ${namespace} FOR UPDATE`;
      const scope = rows[0];
      if (!scope) throw new ConfigurationIntegrityError('SCOPE_MISSING');
      assertDraftBase(command.expectedVersion, scope.published_version);
      const open = await tx.configDraft.findFirst({
        where: { scopeId: scope.id, status: { in: ['DRAFT', 'APPROVED'] } },
        select: { id: true },
      });
      assertNoOpenDraft(open !== null);
      const row = await tx.configDraft.create({
        data: {
          id: command.draftId,
          scopeId: scope.id,
          revision: 1,
          status: 'DRAFT',
          baseVersion: command.expectedVersion,
          content: jsonObject(command.content.content),
          contentHash: command.contentHash,
          authorSubject: command.actor.subject,
          createdAt: command.now,
          updatedAt: command.now,
        },
        include: draftInclude,
      });
      await this.appendHistory(tx, command, {
        scopeId: scope.id,
        draftId: row.id,
        action: 'DRAFT_CREATED',
        draftRevision: 1,
        version: null,
        contentHash: row.contentHash,
      });
      return command.render(this.toDraft(row));
    });
    if (result === 'NOT_FOUND') throw new ConfigurationIntegrityError('SCOPE_MISSING');
    return result;
  }

  approve(
    command: Parameters<ConfigurationV1Store['approve']>[0],
  ): Promise<CommandResult | 'NOT_FOUND'> {
    return this.command(command, async (tx) => {
      const row = await this.lockDraft(tx, command.draftId);
      if (!row) return 'NOT_FOUND';
      const draft = this.toDraft(row);
      assertApprovable(draft, command.actor.subject, command.expectedRevision);
      const updated = await tx.configDraft.update({
        where: { id: row.id },
        data: {
          status: 'APPROVED',
          revision: row.revision + 1,
          approvedBy: command.actor.subject,
          approvedAt: command.now,
          updatedAt: command.now,
        },
        include: draftInclude,
      });
      await this.appendHistory(tx, command, {
        scopeId: row.scopeId,
        draftId: row.id,
        action: 'DRAFT_APPROVED',
        draftRevision: updated.revision,
        version: null,
        contentHash: row.contentHash,
      });
      return command.render(this.toDraft(updated));
    });
  }

  publish(
    command: Parameters<ConfigurationV1Store['publish']>[0],
  ): Promise<CommandResult | 'NOT_FOUND'> {
    return this.command(command, async (tx) => {
      const located = await tx.configDraft.findUnique({
        where: { id: command.draftId },
        select: { scopeId: true },
      });
      if (!located) return 'NOT_FOUND';
      // Scope first, then draft: the same order as createDraft, so no cycle.
      const publishedVersion = await this.lockScope(tx, located.scopeId);
      const row = await this.lockDraft(tx, command.draftId);
      if (!row) return 'NOT_FOUND';
      const draft = this.toDraft(row);
      const version = assertPublishable(draft, command.expectedRevision, publishedVersion);
      const versionRow = await tx.configVersion.create({
        data: {
          id: command.versionId,
          scopeId: row.scopeId,
          version,
          draftId: row.id,
          content: jsonObject(draft.content.content),
          contentHash: row.contentHash,
          effectiveAt: command.now,
          publishedBy: command.actor.subject,
          publishedAt: command.now,
        },
        include: versionInclude,
      });
      // Compare-and-set; the trigger also refuses anything but +1.
      const moved = await tx.configScope.updateMany({
        where: { id: row.scopeId, publishedVersion },
        data: { publishedVersion: version, updatedAt: command.now },
      });
      if (moved.count !== 1) throw new ConfigurationIntegrityError('SCOPE_VERSION_MOVED');
      const updated = await tx.configDraft.update({
        where: { id: row.id },
        data: {
          status: 'PUBLISHED',
          revision: row.revision + 1,
          publishedBy: command.actor.subject,
          publishedAt: command.now,
          publishedVersion: version,
          updatedAt: command.now,
        },
        include: draftInclude,
      });
      await this.appendHistory(tx, command, {
        scopeId: row.scopeId,
        draftId: row.id,
        action: 'DRAFT_PUBLISHED',
        draftRevision: updated.revision,
        version,
        contentHash: row.contentHash,
      });
      const published = this.toPublished(versionRow);
      await this.enqueue(tx, command.event({ scopeId: row.scopeId, published }));
      return command.render(this.toDraft(updated), published);
    });
  }

  withdraw(
    command: Parameters<ConfigurationV1Store['withdraw']>[0],
  ): Promise<CommandResult | 'NOT_FOUND'> {
    return this.command(command, async (tx) => {
      const row = await this.lockDraft(tx, command.draftId);
      if (!row) return 'NOT_FOUND';
      assertWithdrawable(this.toDraft(row), command.expectedRevision);
      const updated = await tx.configDraft.update({
        where: { id: row.id },
        data: {
          status: 'WITHDRAWN',
          revision: row.revision + 1,
          withdrawnBy: command.actor.subject,
          withdrawnAt: command.now,
          updatedAt: command.now,
        },
        include: draftInclude,
      });
      await this.appendHistory(tx, command, {
        scopeId: row.scopeId,
        draftId: row.id,
        action: 'DRAFT_WITHDRAWN',
        draftRevision: updated.revision,
        version: null,
        contentHash: row.contentHash,
      });
      return command.render(this.toDraft(updated));
    });
  }

  private async enqueue(tx: Tx, event: OutboxEvent): Promise<void> {
    await tx.outboxMessage.create({
      data: {
        id: randomUUID(),
        eventId: event.eventId,
        eventType: event.eventType,
        exchange: event.exchange,
        routingKey: event.routingKey,
        payload: event.payload,
        correlationId: event.correlationId,
        traceParent: event.traceParent,
      },
    });
  }

  /* -------------------------------- queries ------------------------------- */

  private async currentIn(client: Tx | PrismaClient, scope: ScopeRef) {
    const row = await client.configScope.findUnique({
      where: { marketId_namespace: { marketId: scope.marketId, namespace: scope.namespace } },
    });
    if (!row || row.publishedVersion === 0) return { row, current: null };
    const version = await client.configVersion.findUnique({
      where: { scopeId_version: { scopeId: row.id, version: row.publishedVersion } },
      include: versionInclude,
    });
    if (!version) throw new ConfigurationIntegrityError('PUBLISHED_VERSION_MISSING');
    return { row, current: this.toPublished(version) };
  }

  async current(scope: ScopeRef): Promise<PublishedRecord | null> {
    // Scope counter and version row from one snapshot.
    return this.client.$transaction(async (tx) => (await this.currentIn(tx, scope)).current, {
      isolationLevel: 'RepeatableRead',
    });
  }

  async overview(scope: ScopeRef) {
    return this.client.$transaction(
      async (tx) => {
        const { row, current } = await this.currentIn(tx, scope);
        const open = row
          ? await tx.configDraft.findFirst({
              where: { scopeId: row.id, status: { in: ['DRAFT', 'APPROVED'] } },
              include: draftInclude,
            })
          : null;
        return {
          publishedVersion: row?.publishedVersion ?? 0,
          current,
          openDraft: open && this.toDraft(open),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async versions(
    scope: ScopeRef,
    page: { readonly limit: number; readonly beforeVersion: number | null },
  ): Promise<readonly PublishedRecord[]> {
    const rows = await this.client.configVersion.findMany({
      where: {
        scope: { marketId: scope.marketId, namespace: scope.namespace },
        ...(page.beforeVersion === null ? {} : { version: { lt: page.beforeVersion } }),
      },
      orderBy: { version: 'desc' },
      take: page.limit,
      include: versionInclude,
    });
    return rows.map((row) => this.toPublished(row));
  }

  async version(scope: ScopeRef, version: number): Promise<PublishedRecord | null> {
    const row = await this.client.configVersion.findFirst({
      where: { scope: { marketId: scope.marketId, namespace: scope.namespace }, version },
      include: versionInclude,
    });
    return row && this.toPublished(row);
  }

  async history(
    scope: ScopeRef,
    page: { readonly limit: number; readonly beforeSeq: string | null },
  ): Promise<readonly HistoryRecord[]> {
    const rows = await this.client.configHistory.findMany({
      where: {
        scope: { marketId: scope.marketId, namespace: scope.namespace },
        ...(page.beforeSeq === null ? {} : { seq: { lt: BigInt(page.beforeSeq) } }),
      },
      orderBy: { seq: 'desc' },
      take: page.limit,
    });
    return rows.map((row) => {
      const action = HISTORY_ACTIONS.find((a) => a === row.action);
      if (!action) throw new ConfigurationIntegrityError('CORRUPT_PERSISTED_ACTION');
      return {
        id: row.id,
        seq: row.seq.toString(),
        action,
        draftId: row.draftId,
        draftRevision: row.draftRevision,
        version: row.version,
        contentHash: row.contentHash,
        actorSubject: row.actorSubject,
        reason: row.reason,
        correlationId: row.correlationId,
        occurredAt: row.occurredAt,
      };
    });
  }

  async draft(id: string): Promise<DraftRecord | null> {
    const row = await this.client.configDraft.findUnique({ where: { id }, include: draftInclude });
    return row && this.toDraft(row);
  }
}
