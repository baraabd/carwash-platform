import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  decideSnapshot,
  type MetricContribution,
  type SnapshotUpdate,
} from '../../domain/projection';
import type {
  BucketDrift,
  ContributionOutcome,
  Hasher,
  MetricPoint,
  ProjectionReader,
  ProjectionWriter,
  SnapshotOutcome,
} from '../../ports/projection.ports';

export const sha256Hex: Hasher = (canonical) =>
  createHash('sha256').update(canonical, 'utf8').digest('hex');

/** The same source fact arrived with different content: never folded, never retried. */
export class ProjectionIntegrityError extends Error {
  constructor(readonly code: 'CONTRIBUTION_FINGERPRINT_CONFLICT' | 'SNAPSHOT_VERSION_CONFLICT') {
    super(code);
    this.name = 'ProjectionIntegrityError';
  }
}

function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function dayText(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Transaction-bound projection writer. It is constructed with the inbox
 * transaction client, so it can never commit independently of the inbox row.
 */
export class PrismaProjectionWriter implements ProjectionWriter {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async recordContribution(
    contribution: MetricContribution,
    fingerprintHash: string,
  ): Promise<ContributionOutcome> {
    const key = {
      projection: contribution.projection,
      sourceService: contribution.source.service,
      sourceEventId: contribution.source.eventId,
    };
    // ON CONFLICT DO NOTHING: a concurrent writer of the same source event
    // waits on the unique index and then sees zero inserted rows.
    const inserted = await this.tx.projectionContribution.createMany({
      data: [
        {
          ...key,
          sourceEventType: contribution.source.eventType,
          metricKey: contribution.metricKey,
          bucketDay: dayDate(contribution.bucketDay),
          delta: contribution.delta,
          contributionHash: fingerprintHash,
          occurredAt: contribution.source.occurredAt,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      const existing = await this.tx.projectionContribution.findUniqueOrThrow({
        where: { projection_sourceService_sourceEventId: key },
        select: { contributionHash: true },
      });
      if (existing.contributionHash !== fingerprintHash)
        throw new ProjectionIntegrityError('CONTRIBUTION_FINGERPRINT_CONFLICT');
      return 'ALREADY_CONTRIBUTED';
    }
    // Atomic increment: concurrent contributions to one bucket add, never overwrite.
    await this.tx.metricBucket.upsert({
      where: {
        projection_metricKey_bucketDay: {
          projection: contribution.projection,
          metricKey: contribution.metricKey,
          bucketDay: dayDate(contribution.bucketDay),
        },
      },
      create: {
        projection: contribution.projection,
        metricKey: contribution.metricKey,
        bucketDay: dayDate(contribution.bucketDay),
        value: contribution.delta,
        contributionCount: 1,
      },
      update: {
        value: { increment: contribution.delta },
        contributionCount: { increment: 1 },
      },
    });
    return 'APPLIED';
  }

  async applySnapshot(update: SnapshotUpdate, fingerprintHash: string): Promise<SnapshotOutcome> {
    const key = {
      projection: update.projection,
      aggregateType: update.aggregateType,
      aggregateId: update.aggregateId,
    };
    const data = {
      version: update.version,
      state: update.state as Prisma.InputJsonObject,
      stateHash: fingerprintHash,
      sourceService: update.source.service,
      sourceEventId: update.source.eventId,
      occurredAt: update.source.occurredAt,
    };
    const current = await this.tx.aggregateSnapshot.findUnique({
      where: { projection_aggregateType_aggregateId: key },
      select: { version: true, stateHash: true },
    });
    const decision = decideSnapshot(
      current && { version: current.version, fingerprint: current.stateHash },
      { version: update.version, fingerprint: fingerprintHash },
    );
    if (decision === 'CONFLICT') throw new ProjectionIntegrityError('SNAPSHOT_VERSION_CONFLICT');
    if (decision !== 'APPLY') return decision;
    if (!current) {
      // A concurrent first writer makes this a unique violation; the consumer
      // rethrows it and the redelivery re-decides against the committed row.
      await this.tx.aggregateSnapshot.create({ data: { ...key, ...data } });
      return 'APPLIED';
    }
    // Guarded write: only replaces a strictly older version, so a writer that
    // read a stale row cannot regress a newer committed snapshot.
    const moved = await this.tx.aggregateSnapshot.updateMany({
      where: { ...key, version: { lt: update.version } },
      data,
    });
    if (moved.count === 1) return 'APPLIED';
    const winner = await this.tx.aggregateSnapshot.findUniqueOrThrow({
      where: { projection_aggregateType_aggregateId: key },
      select: { version: true, stateHash: true },
    });
    const after = decideSnapshot(
      { version: winner.version, fingerprint: winner.stateHash },
      { version: update.version, fingerprint: fingerprintHash },
    );
    if (after === 'CONFLICT') throw new ProjectionIntegrityError('SNAPSHOT_VERSION_CONFLICT');
    if (after === 'APPLY') throw new Error('SNAPSHOT_GUARD_INCONSISTENT');
    return after;
  }
}

export class PrismaProjectionReader implements ProjectionReader {
  constructor(private readonly client: PrismaClient) {}

  async metricSeries(input: {
    projection: string;
    metricKey: string;
    fromDay: string;
    toDay: string;
  }): Promise<readonly MetricPoint[]> {
    const rows = await this.client.metricBucket.findMany({
      where: {
        projection: input.projection,
        metricKey: input.metricKey,
        bucketDay: { gte: dayDate(input.fromDay), lte: dayDate(input.toDay) },
      },
      orderBy: { bucketDay: 'asc' },
      select: { bucketDay: true, value: true, contributionCount: true },
    });
    return rows.map((row) => ({
      bucketDay: dayText(row.bucketDay),
      value: row.value,
      contributionCount: row.contributionCount,
    }));
  }

  async bucketDrift(projection: string): Promise<readonly BucketDrift[]> {
    // Both reads in one repeatable-read snapshot, so a commit landing between
    // them cannot be reported as drift.
    const { buckets, ledger } = await this.client.$transaction(
      async (tx) => ({
        buckets: await tx.metricBucket.findMany({ where: { projection } }),
        ledger: await tx.projectionContribution.groupBy({
          by: ['metricKey', 'bucketDay'],
          where: { projection },
          orderBy: [{ metricKey: 'asc' }, { bucketDay: 'asc' }],
          _sum: { delta: true },
          _count: { sourceEventId: true },
        }),
      }),
      { isolationLevel: 'RepeatableRead' },
    );
    const folded = new Map(
      ledger.map((row) => [
        `${row.metricKey}|${dayText(row.bucketDay)}`,
        { value: row._sum?.delta ?? 0n, count: row._count?.sourceEventId ?? 0 },
      ]),
    );
    const drift: BucketDrift[] = [];
    const seen = new Set<string>();
    for (const bucket of buckets) {
      const id = `${bucket.metricKey}|${dayText(bucket.bucketDay)}`;
      seen.add(id);
      const fold = folded.get(id) ?? { value: 0n, count: 0 };
      if (fold.value !== bucket.value || fold.count !== bucket.contributionCount)
        drift.push({
          metricKey: bucket.metricKey,
          bucketDay: dayText(bucket.bucketDay),
          bucketValue: bucket.value,
          ledgerValue: fold.value,
          bucketCount: bucket.contributionCount,
          ledgerCount: fold.count,
        });
    }
    for (const [id, fold] of folded) {
      if (seen.has(id)) continue;
      const [metricKey = '', bucketDay = ''] = id.split('|');
      drift.push({
        metricKey,
        bucketDay,
        bucketValue: 0n,
        ledgerValue: fold.value,
        bucketCount: 0,
        ledgerCount: fold.count,
      });
    }
    return drift;
  }
}
