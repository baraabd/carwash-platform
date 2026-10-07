import {
  ProjectionRuleError,
  contributionFingerprint,
  snapshotFingerprint,
  utcDay,
  type MetricContribution,
  type SnapshotUpdate,
} from '../domain/projection';
import type {
  BucketDrift,
  ContributionOutcome,
  Hasher,
  MetricPoint,
  ProjectionReader,
  ProjectionWriter,
  SnapshotOutcome,
} from '../ports/projection.ports';

/** Longest series a single read may request, so a query cannot scan unbounded history. */
export const MAX_SERIES_DAYS = 366;

/**
 * Applies validated contributions and snapshots through a transaction-bound
 * writer. The caller (the inbox consumer) owns the transaction, so the inbox
 * row and every projection change commit together.
 */
export class ProjectionIngestor {
  constructor(private readonly hash: Hasher) {}

  contribute(
    writer: ProjectionWriter,
    contribution: MetricContribution,
  ): Promise<ContributionOutcome> {
    return writer.recordContribution(
      contribution,
      this.hash(contributionFingerprint(contribution)),
    );
  }

  snapshot(writer: ProjectionWriter, update: SnapshotUpdate): Promise<SnapshotOutcome> {
    return writer.applySnapshot(update, this.hash(snapshotFingerprint(update)));
  }
}

export class ProjectionQueries {
  constructor(private readonly reader: ProjectionReader) {}

  async metricSeries(input: {
    projection: string;
    metricKey: string;
    fromDay: unknown;
    toDay: unknown;
  }): Promise<readonly MetricPoint[]> {
    const fromDay = utcDay(input.fromDay);
    const toDay = utcDay(input.toDay);
    const span =
      (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000;
    if (span < 0) throw new ProjectionRuleError('INVALID_DAY_RANGE');
    if (span + 1 > MAX_SERIES_DAYS) throw new ProjectionRuleError('DAY_RANGE_TOO_LARGE');
    return this.reader.metricSeries({ ...input, fromDay, toDay });
  }

  /** Reconciliation: empty means every bucket equals the fold of its ledger rows. */
  async drift(projection: string): Promise<readonly BucketDrift[]> {
    return this.reader.bucketDrift(projection);
  }
}
