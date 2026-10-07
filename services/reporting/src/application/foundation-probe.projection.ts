import type { FoundationProbeCreatedV1 } from '@carwash/event-contracts';
import { metricContribution, snapshotUpdate, sourceEventRef } from '../domain/projection';
import type { ProjectionWriter } from '../ports/projection.ports';
import type { ProjectionIngestor } from './projection.service';

/**
 * The only producer stream that has an accepted runtime contract and broker
 * topology today is Catalog's non-financial foundation probe. It drives the
 * projection primitives end to end; business projections (bookings, money)
 * wait for their owners' accepted event contracts and are NOT implied here.
 */
export const FOUNDATION_EVENTS_PROJECTION = 'foundation-events';
export const FOUNDATION_PROBE_METRIC = 'foundation.probe.created';
export const FOUNDATION_PROBE_SNAPSHOT = 'foundation-probe';

export async function projectFoundationProbe(
  ingestor: ProjectionIngestor,
  writer: ProjectionWriter,
  event: FoundationProbeCreatedV1,
): Promise<void> {
  const source = sourceEventRef({
    service: event.producer,
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: new Date(event.occurredAt),
  });
  await ingestor.contribute(
    writer,
    metricContribution({
      projection: FOUNDATION_EVENTS_PROJECTION,
      metricKey: FOUNDATION_PROBE_METRIC,
      delta: 1n,
      source,
    }),
  );
  await ingestor.snapshot(
    writer,
    snapshotUpdate({
      projection: FOUNDATION_PROBE_SNAPSHOT,
      aggregateType: 'probe',
      aggregateId: event.data.probeId,
      version: event.aggregateVersion,
      // The label is a closed non-personal alphabet enforced by the contract parser.
      state: { label: event.data.label },
      source,
    }),
  );
}
