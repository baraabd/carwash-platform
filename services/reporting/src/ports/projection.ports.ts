import type { MetricContribution, SnapshotUpdate } from '../domain/projection';

export type ContributionOutcome = 'APPLIED' | 'ALREADY_CONTRIBUTED';
export type SnapshotOutcome = 'APPLIED' | 'STALE' | 'SAME';

/**
 * Write side of the projection read model, bound to ONE local transaction.
 * The inbox row, the contribution ledger row and the bucket change commit or
 * roll back together. Integrity conflicts are thrown, never returned as a
 * benign outcome.
 */
export interface ProjectionWriter {
  recordContribution(
    contribution: MetricContribution,
    fingerprintHash: string,
  ): Promise<ContributionOutcome>;
  applySnapshot(update: SnapshotUpdate, fingerprintHash: string): Promise<SnapshotOutcome>;
}

export interface MetricPoint {
  readonly bucketDay: string;
  readonly value: bigint;
  readonly contributionCount: number;
}

export interface BucketDrift {
  readonly metricKey: string;
  readonly bucketDay: string;
  readonly bucketValue: bigint;
  readonly ledgerValue: bigint;
  readonly bucketCount: number;
  readonly ledgerCount: number;
}

export interface ProjectionReader {
  metricSeries(input: {
    projection: string;
    metricKey: string;
    fromDay: string;
    toDay: string;
  }): Promise<readonly MetricPoint[]>;
  /** Buckets whose folded value disagrees with the contribution ledger. */
  bucketDrift(projection: string): Promise<readonly BucketDrift[]>;
}

/** Stable SHA-256 hex of canonical text; supplied by infrastructure. */
export type Hasher = (canonical: string) => string;
