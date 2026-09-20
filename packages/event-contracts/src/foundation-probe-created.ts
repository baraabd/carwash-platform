import { asAggregateVersion, asCanonicalUtc, asObject, asUuid, exactKeys } from './envelope';

/**
 * Sprint 0.2 delivery-slice event.
 *
 * Deliberately NON-FINANCIAL and disposable: it exists only to prove
 * outbox/inbox transactionality, broker ACL scoping and independent fan-out.
 * It carries no personal data and must never be reused for booking, payment
 * or customer state.
 */
export interface FoundationProbeCreatedV1 {
  eventId: string;
  eventType: 'foundation.probe.created.v1';
  schemaVersion: 1;
  producer: 'catalog';
  occurredAt: string;
  correlationId: string;
  aggregateVersion: number;
  data: { probeId: string; label: string };
}

export const FOUNDATION_PROBE_CREATED_V1 = 'foundation.probe.created.v1' as const;

/**
 * Free-text is refused on purpose. A closed label alphabet is the cheapest
 * structural guarantee that no personal data can be smuggled through the
 * broker or into consumer logs.
 */
const LABEL = /^probe-[a-z0-9-]{1,32}$/;

const KEYS = [
  'eventId',
  'eventType',
  'schemaVersion',
  'producer',
  'occurredAt',
  'correlationId',
  'aggregateVersion',
  'data',
] as const;

export function parseFoundationProbeCreatedV1(value: unknown): FoundationProbeCreatedV1 {
  const v = asObject(value);
  exactKeys(v, KEYS);
  if (
    v.eventType !== FOUNDATION_PROBE_CREATED_V1 ||
    v.schemaVersion !== 1 ||
    v.producer !== 'catalog'
  ) {
    throw new Error('UNSUPPORTED_EVENT');
  }
  const data = asObject(v.data);
  exactKeys(data, ['probeId', 'label']);
  if (typeof data.label !== 'string' || !LABEL.test(data.label)) {
    throw new Error('INVALID_LABEL');
  }
  return {
    eventId: asUuid(v.eventId),
    eventType: FOUNDATION_PROBE_CREATED_V1,
    schemaVersion: 1,
    producer: 'catalog',
    occurredAt: asCanonicalUtc(v.occurredAt),
    correlationId: asUuid(v.correlationId),
    aggregateVersion: asAggregateVersion(v.aggregateVersion),
    data: { probeId: asUuid(data.probeId), label: data.label },
  };
}
