/**
 * Reporting projection rules.
 *
 * Pure domain: no Nest, Prisma or broker types. Reporting derives read models
 * from other owners' events; it never decides a booking, payment or customer
 * fact, so every value here carries the source that produced it.
 */

const NAME = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const METRIC_KEY = /^[a-z][a-z0-9.-]{1,94}[a-z0-9]$/;
const SERVICE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const EVENT_TYPE = /^[a-z][a-z0-9.-]{1,94}[a-z0-9]$/;
const AGGREGATE_TYPE = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;

/** A single contribution may move a metric by at most this much either way. */
export const MAX_ABS_DELTA = 1_000_000_000n;
export const MAX_STATE_KEYS = 24;
export const MAX_STATE_STRING = 128;

export class ProjectionRuleError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ProjectionRuleError';
  }
}

/** The service and event that a derived row was computed from. */
export interface SourceEventRef {
  readonly service: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
}

export interface MetricContribution {
  readonly projection: string;
  readonly metricKey: string;
  /** UTC calendar day, `YYYY-MM-DD`, derived from the source occurrence time. */
  readonly bucketDay: string;
  readonly delta: bigint;
  readonly source: SourceEventRef;
}

export type SnapshotScalar = string | number | boolean | null;
export type SnapshotState = Readonly<Record<string, SnapshotScalar>>;

export interface SnapshotUpdate {
  readonly projection: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** The source owner's aggregateVersion, never a Reporting counter. */
  readonly version: number;
  readonly state: SnapshotState;
  readonly source: SourceEventRef;
}

function check(pattern: RegExp, value: unknown, code: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new ProjectionRuleError(code);
  return value;
}

export function sourceEventRef(input: {
  service: unknown;
  eventId: unknown;
  eventType: unknown;
  occurredAt: unknown;
}): SourceEventRef {
  const occurredAt = input.occurredAt;
  if (!(occurredAt instanceof Date) || !Number.isFinite(occurredAt.getTime()))
    throw new ProjectionRuleError('INVALID_OCCURRED_AT');
  return {
    service: check(SERVICE, input.service, 'INVALID_SOURCE_SERVICE'),
    eventId: check(UUID, input.eventId, 'INVALID_SOURCE_EVENT_ID').toLowerCase(),
    eventType: check(EVENT_TYPE, input.eventType, 'INVALID_SOURCE_EVENT_TYPE'),
    occurredAt: new Date(occurredAt.getTime()),
  };
}

/** UTC day of an instant. Local business days are a later, explicit policy. */
export function utcDayBucket(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a `YYYY-MM-DD` query bound as a real calendar day. */
export function utcDay(value: unknown): string {
  if (typeof value !== 'string' || !DAY.test(value)) throw new ProjectionRuleError('INVALID_DAY');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || utcDayBucket(parsed) !== value)
    throw new ProjectionRuleError('INVALID_DAY');
  return value;
}

export function metricContribution(input: {
  projection: unknown;
  metricKey: unknown;
  delta: unknown;
  source: SourceEventRef;
}): MetricContribution {
  const delta = input.delta;
  if (typeof delta !== 'bigint') throw new ProjectionRuleError('DELTA_MUST_BE_EXACT_INTEGER');
  if (delta === 0n) throw new ProjectionRuleError('DELTA_MUST_BE_NON_ZERO');
  if (delta > MAX_ABS_DELTA || delta < -MAX_ABS_DELTA)
    throw new ProjectionRuleError('DELTA_OUT_OF_RANGE');
  return {
    projection: check(NAME, input.projection, 'INVALID_PROJECTION'),
    metricKey: check(METRIC_KEY, input.metricKey, 'INVALID_METRIC_KEY'),
    bucketDay: utcDayBucket(input.source.occurredAt),
    delta,
    source: input.source,
  };
}

/**
 * Snapshot state is a small flat record of non-personal scalars. Nested
 * objects, arrays, non-finite numbers and long strings are refused so that a
 * projection cannot quietly become a copy of another owner's private record.
 */
export function snapshotUpdate(input: {
  projection: unknown;
  aggregateType: unknown;
  aggregateId: unknown;
  version: unknown;
  state: unknown;
  source: SourceEventRef;
}): SnapshotUpdate {
  const version = input.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1)
    throw new ProjectionRuleError('INVALID_AGGREGATE_VERSION');
  const raw = input.state;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new ProjectionRuleError('INVALID_SNAPSHOT_STATE');
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_STATE_KEYS) throw new ProjectionRuleError('SNAPSHOT_STATE_TOO_LARGE');
  const state: Record<string, SnapshotScalar> = {};
  for (const [key, value] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!STATE_KEY.test(key)) throw new ProjectionRuleError('INVALID_SNAPSHOT_KEY');
    if (typeof value === 'string' && value.length > MAX_STATE_STRING)
      throw new ProjectionRuleError('SNAPSHOT_VALUE_TOO_LONG');
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new ProjectionRuleError('SNAPSHOT_VALUE_NOT_FINITE');
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
      throw new ProjectionRuleError('SNAPSHOT_VALUE_NOT_SCALAR');
    state[key] = value as SnapshotScalar;
  }
  return {
    projection: check(NAME, input.projection, 'INVALID_PROJECTION'),
    aggregateType: check(AGGREGATE_TYPE, input.aggregateType, 'INVALID_AGGREGATE_TYPE'),
    aggregateId: check(UUID, input.aggregateId, 'INVALID_AGGREGATE_ID').toLowerCase(),
    version,
    state: Object.freeze(state),
    source: input.source,
  };
}

/**
 * Canonical text of a contribution. Two deliveries of one source event that
 * produce different canonical text are an integrity conflict, not a retry.
 */
export function contributionFingerprint(contribution: MetricContribution): string {
  return JSON.stringify([
    contribution.projection,
    contribution.metricKey,
    contribution.bucketDay,
    contribution.delta.toString(),
    contribution.source.service,
    contribution.source.eventId,
    contribution.source.eventType,
    contribution.source.occurredAt.toISOString(),
  ]);
}

/** Canonical text of snapshot content; keys are already sorted by snapshotUpdate. */
export function snapshotFingerprint(update: SnapshotUpdate): string {
  return JSON.stringify([update.version, update.source.eventId, Object.entries(update.state)]);
}

export type SnapshotDecision = 'APPLY' | 'STALE' | 'SAME' | 'CONFLICT';

/**
 * Monotonic version rule. A newer version replaces; an older one is stale and
 * ignored; the same version with the same fingerprint is a repeat; the same
 * version with different content means two facts claim one version.
 */
export function decideSnapshot(
  current: { readonly version: number; readonly fingerprint: string } | null,
  incoming: { readonly version: number; readonly fingerprint: string },
): SnapshotDecision {
  if (!current || incoming.version > current.version) return 'APPLY';
  if (incoming.version < current.version) return 'STALE';
  return incoming.fingerprint === current.fingerprint ? 'SAME' : 'CONFLICT';
}
