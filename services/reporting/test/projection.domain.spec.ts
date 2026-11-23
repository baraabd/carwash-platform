import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectionRuleError,
  contributionFingerprint,
  decideSnapshot,
  metricContribution,
  snapshotFingerprint,
  snapshotUpdate,
  sourceEventRef,
  utcDay,
  utcDayBucket,
} from '../src/domain/projection';
import { MAX_SERIES_DAYS, ProjectionQueries } from '../src/application/projection.service';
import type { ProjectionReader } from '../src/ports/projection.ports';

const EVENT = '0b7f4f38-6c1e-4a1e-9d8b-0f6e3c1d2a11';
const AGGREGATE = '5d0c7a51-2f3e-4b6a-8c9d-1e2f3a4b5c6d';

function source(occurredAt = new Date('2026-10-07T23:59:59.999Z')) {
  return sourceEventRef({
    service: 'catalog',
    eventId: EVENT,
    eventType: 'foundation.probe.created.v1',
    occurredAt,
  });
}

function rejects(fn: () => unknown, code: string): void {
  assert.throws(
    fn,
    (error: unknown) => error instanceof ProjectionRuleError && error.code === code,
  );
}

test('reporting domain: buckets are UTC days of the source occurrence, not of ingestion', () => {
  assert.equal(utcDayBucket(new Date('2026-10-07T23:59:59.999Z')), '2026-10-07');
  // 01:30 in UTC+3 is still the previous UTC day.
  assert.equal(utcDayBucket(new Date('2026-10-08T01:30:00.000+03:00')), '2026-10-07');
  const contribution = metricContribution({
    projection: 'foundation-events',
    metricKey: 'foundation.probe.created',
    delta: 1n,
    source: source(),
  });
  assert.equal(contribution.bucketDay, '2026-10-07');
});

test('reporting domain: metric deltas are exact non-zero bounded integers', () => {
  const base = { projection: 'foundation-events', metricKey: 'm.count', source: source() };
  rejects(() => metricContribution({ ...base, delta: 1 }), 'DELTA_MUST_BE_EXACT_INTEGER');
  rejects(() => metricContribution({ ...base, delta: 0.1 }), 'DELTA_MUST_BE_EXACT_INTEGER');
  rejects(() => metricContribution({ ...base, delta: 0n }), 'DELTA_MUST_BE_NON_ZERO');
  rejects(() => metricContribution({ ...base, delta: 1_000_000_001n }), 'DELTA_OUT_OF_RANGE');
  assert.equal(metricContribution({ ...base, delta: -5n }).delta, -5n);
});

test('reporting domain: identifiers are closed vocabularies', () => {
  rejects(
    () =>
      sourceEventRef({
        service: 'Catalog',
        eventId: EVENT,
        eventType: 'x.y',
        occurredAt: new Date(),
      }),
    'INVALID_SOURCE_SERVICE',
  );
  rejects(
    () =>
      sourceEventRef({
        service: 'catalog',
        eventId: 'nope',
        eventType: 'x.y',
        occurredAt: new Date(),
      }),
    'INVALID_SOURCE_EVENT_ID',
  );
  rejects(
    () =>
      sourceEventRef({
        service: 'catalog',
        eventId: EVENT,
        eventType: 'x.y',
        occurredAt: new Date(Number.NaN),
      }),
    'INVALID_OCCURRED_AT',
  );
  rejects(
    () =>
      metricContribution({
        projection: 'DROP TABLE',
        metricKey: 'm.c',
        delta: 1n,
        source: source(),
      }),
    'INVALID_PROJECTION',
  );
});

test('reporting domain: snapshot state is a small flat record of scalars', () => {
  const base = {
    projection: 'foundation-probe',
    aggregateType: 'probe',
    aggregateId: AGGREGATE,
    version: 1,
    source: source(),
  };
  rejects(() => snapshotUpdate({ ...base, state: [] }), 'INVALID_SNAPSHOT_STATE');
  rejects(
    () => snapshotUpdate({ ...base, state: { nested: { a: 1 } } }),
    'SNAPSHOT_VALUE_NOT_SCALAR',
  );
  rejects(
    () => snapshotUpdate({ ...base, state: { n: Number.POSITIVE_INFINITY } }),
    'SNAPSHOT_VALUE_NOT_FINITE',
  );
  rejects(
    () => snapshotUpdate({ ...base, state: { s: 'x'.repeat(129) } }),
    'SNAPSHOT_VALUE_TOO_LONG',
  );
  rejects(() => snapshotUpdate({ ...base, state: { 'bad key': 1 } }), 'INVALID_SNAPSHOT_KEY');
  const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
  rejects(() => snapshotUpdate({ ...base, state: many }), 'SNAPSHOT_STATE_TOO_LARGE');
  rejects(() => snapshotUpdate({ ...base, version: 0, state: {} }), 'INVALID_AGGREGATE_VERSION');
  rejects(() => snapshotUpdate({ ...base, version: 1.5, state: {} }), 'INVALID_AGGREGATE_VERSION');
});

test('reporting domain: fingerprints are independent of key order and sensitive to content', () => {
  const base = {
    projection: 'foundation-probe',
    aggregateType: 'probe',
    aggregateId: AGGREGATE,
    version: 3,
    source: source(),
  };
  const a = snapshotUpdate({ ...base, state: { b: 2, a: 'x' } });
  const b = snapshotUpdate({ ...base, state: { a: 'x', b: 2 } });
  const c = snapshotUpdate({ ...base, state: { a: 'x', b: 3 } });
  assert.equal(snapshotFingerprint(a), snapshotFingerprint(b));
  assert.notEqual(snapshotFingerprint(a), snapshotFingerprint(c));

  const one = metricContribution({
    projection: 'p-1',
    metricKey: 'm.c',
    delta: 1n,
    source: source(),
  });
  const two = metricContribution({
    projection: 'p-1',
    metricKey: 'm.c',
    delta: 2n,
    source: source(),
  });
  assert.notEqual(contributionFingerprint(one), contributionFingerprint(two));
});

test('reporting domain: snapshot versions only move forward', () => {
  assert.equal(decideSnapshot(null, { version: 4, fingerprint: 'x' }), 'APPLY');
  assert.equal(
    decideSnapshot({ version: 3, fingerprint: 'a' }, { version: 4, fingerprint: 'b' }),
    'APPLY',
  );
  assert.equal(
    decideSnapshot({ version: 5, fingerprint: 'a' }, { version: 4, fingerprint: 'b' }),
    'STALE',
  );
  assert.equal(
    decideSnapshot({ version: 4, fingerprint: 'a' }, { version: 4, fingerprint: 'a' }),
    'SAME',
  );
  assert.equal(
    decideSnapshot({ version: 4, fingerprint: 'a' }, { version: 4, fingerprint: 'b' }),
    'CONFLICT',
  );
});

test('reporting application: series reads are bounded calendar ranges', async () => {
  const calls: unknown[] = [];
  const reader: ProjectionReader = {
    metricSeries: (input) => {
      calls.push(input);
      return Promise.resolve([]);
    },
    bucketDrift: () => Promise.resolve([]),
  };
  const queries = new ProjectionQueries(reader);
  const base = { projection: 'p-1', metricKey: 'm.c' };
  await queries.metricSeries({ ...base, fromDay: '2026-01-01', toDay: '2026-12-31' });
  assert.equal(calls.length, 1);
  rejects(() => utcDay('2026-02-30'), 'INVALID_DAY');
  await assert.rejects(
    queries.metricSeries({ ...base, fromDay: '2026-10-08', toDay: '2026-10-07' }),
    (error: unknown) => error instanceof ProjectionRuleError && error.code === 'INVALID_DAY_RANGE',
  );
  await assert.rejects(
    queries.metricSeries({ ...base, fromDay: '2025-01-01', toDay: '2026-01-02' }),
    (error: unknown) =>
      error instanceof ProjectionRuleError && error.code === 'DAY_RANGE_TOO_LARGE',
  );
  assert.equal(MAX_SERIES_DAYS, 366);
  assert.equal(calls.length, 1, 'invalid ranges never reach the reader');
});
