import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  ENVIRONMENTS,
  ConfigurationRuleError,
  assertActivatable,
  assertReviewer,
  configValue,
  type ConfigScope,
  type ReviewDecision,
} from '../../domain/configuration';
import type {
  ActivateResult,
  ConfigurationRepository,
  Hasher,
  PointerRecord,
  ProposeResult,
  RevisionRecord,
} from '../../ports/configuration.ports';

export const sha256Hex: Hasher = (canonical) =>
  createHash('sha256').update(canonical, 'utf8').digest('hex');

const revisionInclude = { review: true } as const;
type RevisionRow = Prisma.ConfigRevisionGetPayload<{ include: typeof revisionInclude }>;

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P2002' || code === '23505';
}

function scopeWhere(scope: ConfigScope) {
  return {
    namespace: scope.namespace,
    key: scope.key,
    environment: scope.environment,
    tenantScope: scope.tenantScope,
  };
}

function scopeKey(scope: ConfigScope): string {
  return `${scope.namespace}/${scope.key}@${scope.environment}/${scope.tenantScope}`;
}

function toRecord(row: RevisionRow): RevisionRecord {
  const environment = ENVIRONMENTS.find((e) => e === row.environment);
  if (!environment) throw new Error('CORRUPT_PERSISTED_ENVIRONMENT');
  const decision = row.review?.decision;
  if (decision !== undefined && decision !== 'APPROVED' && decision !== 'REJECTED')
    throw new Error('CORRUPT_PERSISTED_DECISION');
  return {
    id: row.id,
    scope: { namespace: row.namespace, key: row.key, environment, tenantScope: row.tenantScope },
    revision: row.revision,
    // Re-validated on the way out: a corrupted row fails loudly, never serves.
    value: configValue({ type: row.valueType, value: row.value }),
    valueHash: row.valueHash,
    authorSubject: row.authorSubject,
    reason: row.reason,
    proposedAt: row.proposedAt,
    review: row.review
      ? {
          decision: decision as ReviewDecision,
          reviewerSubject: row.review.reviewerSubject,
          reviewedAt: row.review.reviewedAt,
        }
      : null,
  };
}

function toPointer(row: {
  activeRevisionId: string;
  activeRevision: number;
  version: number;
}): PointerRecord {
  return {
    activeRevisionId: row.activeRevisionId,
    activeRevision: row.activeRevision,
    version: row.version,
  };
}

export class PrismaConfigurationRepository implements ConfigurationRepository {
  constructor(private readonly client: PrismaClient) {}

  async propose(input: Parameters<ConfigurationRepository['propose']>[0]): Promise<ProposeResult> {
    // Allocation is serialized per scope inside the transaction. The loop only
    // covers the idempotency race: two retries with one key collide on
    // (author, idempotency_key), and the loser replays the winner.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const replay = await this.replay(input);
      if (replay) return replay;
      try {
        return await this.client.$transaction(async (tx) => {
          // Serialize revision allocation per scope for the rest of this
          // transaction. Optimistic max+1 alone starves under contention; the
          // unique (scope, revision) key stays as the backstop.
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${scopeKey(input.scope)}, 0))`;
          const last = await tx.configRevision.aggregate({
            where: scopeWhere(input.scope),
            _max: { revision: true },
          });
          const row = await tx.configRevision.create({
            data: {
              id: input.id,
              ...scopeWhere(input.scope),
              revision: (last._max.revision ?? 0) + 1,
              valueType: input.value.type,
              value: input.value.value,
              valueHash: input.valueHash,
              requestHash: input.requestHash,
              authorSubject: input.actor.subject,
              idempotencyKey: input.idempotencyKey,
              reason: input.reason,
              proposedAt: input.now,
            },
            include: revisionInclude,
          });
          await tx.configAudit.create({
            data: {
              id: input.auditId,
              action: 'PROPOSED',
              actorSubject: input.actor.subject,
              revisionId: row.id,
              scopeKey: scopeKey(input.scope),
              valueHash: input.valueHash,
              correlationId: input.actor.correlationId,
              occurredAt: input.now,
            },
          });
          return { kind: 'CREATED' as const, revision: toRecord(row) };
        });
      } catch (error: unknown) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new Error('REVISION_ALLOCATION_CONTENDED');
  }

  private async replay(
    input: Parameters<ConfigurationRepository['propose']>[0],
  ): Promise<ProposeResult | null> {
    const existing = await this.client.configRevision.findUnique({
      where: {
        authorSubject_idempotencyKey: {
          authorSubject: input.actor.subject,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: revisionInclude,
    });
    if (!existing) return null;
    return existing.requestHash === input.requestHash
      ? { kind: 'REPLAYED', revision: toRecord(existing) }
      : { kind: 'IDEMPOTENCY_CONFLICT' };
  }

  async review(
    input: Parameters<ConfigurationRepository['review']>[0],
  ): Promise<'RECORDED' | 'ALREADY_REVIEWED' | 'NOT_FOUND' | 'SELF_REVIEW'> {
    try {
      return await this.client.$transaction(async (tx) => {
        const revision = await tx.configRevision.findUnique({ where: { id: input.revisionId } });
        if (!revision) return 'NOT_FOUND';
        try {
          assertReviewer(revision.authorSubject, input.actor.subject);
        } catch {
          return 'SELF_REVIEW';
        }
        await tx.configReview.create({
          data: {
            revisionId: revision.id,
            decision: input.decision,
            reviewerSubject: input.actor.subject,
            note: input.note,
            reviewedAt: input.now,
          },
        });
        await tx.configAudit.create({
          data: {
            id: input.auditId,
            action: input.decision,
            actorSubject: input.actor.subject,
            revisionId: revision.id,
            scopeKey: `${revision.namespace}/${revision.key}@${revision.environment}/${revision.tenantScope}`,
            valueHash: revision.valueHash,
            correlationId: input.actor.correlationId,
            occurredAt: input.now,
          },
        });
        return 'RECORDED';
      });
    } catch (error: unknown) {
      // The review primary key is the revision id: a second decision collides.
      if (isUniqueViolation(error)) return 'ALREADY_REVIEWED';
      throw error;
    }
  }

  async activate(
    input: Parameters<ConfigurationRepository['activate']>[0],
  ): Promise<ActivateResult | 'NOT_FOUND'> {
    try {
      return await this.client.$transaction(async (tx) => {
        const revision = await tx.configRevision.findUnique({
          where: { id: input.revisionId },
          include: revisionInclude,
        });
        if (!revision) return 'NOT_FOUND' as const;
        const scope = toRecord(revision).scope;
        const pk = { namespace_key_environment_tenantScope: scopeWhere(scope) };
        const current = await tx.configPointer.findUnique({ where: pk });
        const currentVersion = current?.version ?? 0;
        if (currentVersion !== input.expectedVersion)
          return { kind: 'VERSION_CONFLICT' as const, current: current && toPointer(current) };
        assertActivatable({
          decision: (revision.review?.decision ?? null) as ReviewDecision | null,
          activeRevision: current?.activeRevision ?? null,
          candidateRevision: revision.revision,
        });
        const data = {
          activeRevisionId: revision.id,
          activeRevision: revision.revision,
          version: currentVersion + 1,
          updatedBy: input.actor.subject,
          updatedAt: input.now,
        };
        let pointer;
        if (!current) {
          pointer = await tx.configPointer.create({ data: { ...scopeWhere(scope), ...data } });
        } else {
          // Compare-and-set: a concurrent activation that committed first
          // changed the version, so this one moves nothing.
          const moved = await tx.configPointer.updateMany({
            where: { ...scopeWhere(scope), version: input.expectedVersion },
            data,
          });
          if (moved.count === 0) {
            const latest = await tx.configPointer.findUnique({ where: pk });
            return { kind: 'VERSION_CONFLICT' as const, current: latest && toPointer(latest) };
          }
          pointer = { ...current, ...data };
        }
        await tx.configAudit.create({
          data: {
            id: input.auditId,
            action: 'ACTIVATED',
            actorSubject: input.actor.subject,
            revisionId: revision.id,
            scopeKey: scopeKey(scope),
            valueHash: revision.valueHash,
            correlationId: input.actor.correlationId,
            occurredAt: input.now,
          },
        });
        return { kind: 'ACTIVATED' as const, pointer: toPointer(pointer) };
      });
    } catch (error: unknown) {
      // Two first activations racing on an absent pointer: the loser conflicts.
      if (!isUniqueViolation(error)) throw error;
      const revision = await this.client.configRevision.findUnique({
        where: { id: input.revisionId },
      });
      const latest =
        revision &&
        (await this.client.configPointer.findUnique({
          where: {
            namespace_key_environment_tenantScope: {
              namespace: revision.namespace,
              key: revision.key,
              environment: revision.environment,
              tenantScope: revision.tenantScope,
            },
          },
        }));
      return { kind: 'VERSION_CONFLICT', current: latest ? toPointer(latest) : null };
    }
  }

  async findRevision(id: string): Promise<RevisionRecord | null> {
    const row = await this.client.configRevision.findUnique({
      where: { id },
      include: revisionInclude,
    });
    return row && toRecord(row);
  }

  async active(
    scope: ConfigScope,
  ): Promise<{ record: RevisionRecord; pointer: PointerRecord } | null> {
    // One snapshot for pointer and revision, so a concurrent activation can
    // never pair one revision's number with another revision's value.
    return this.client.$transaction(
      async (tx) => {
        const pointer = await tx.configPointer.findUnique({
          where: { namespace_key_environment_tenantScope: scopeWhere(scope) },
        });
        if (!pointer) return null;
        const row = await tx.configRevision.findUniqueOrThrow({
          where: { id: pointer.activeRevisionId },
          include: revisionInclude,
        });
        if (row.review?.decision !== 'APPROVED')
          throw new ConfigurationRuleError('ACTIVE_REVISION_NOT_APPROVED');
        return { record: toRecord(row), pointer: toPointer(pointer) };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async history(scope: ConfigScope, limit: number): Promise<readonly RevisionRecord[]> {
    const rows = await this.client.configRevision.findMany({
      where: scopeWhere(scope),
      orderBy: { revision: 'desc' },
      take: limit,
      include: revisionInclude,
    });
    return rows.map(toRecord);
  }
}
