import { BOOKING_CONFIRMED_V1 } from './booking-confirmed';
import { BUSINESS_EVENTS_P02 } from './booking-billing-v1';
import { BUSINESS_EVENTS_V1 } from './business-v1';
import type { EventProducer } from './envelope-v2';
import { FOUNDATION_PROBE_CREATED_V1 } from './foundation-probe-created';

/**
 * contract-only / published-producer-pending: the wire schema is published but
 * no accepted producer emits it yet. Never read as "the event flows".
 */
export type EventContractStatus =
  'foundation-runtime' | 'contract-only' | 'published-producer-pending';

/** Every envelope-v2 business event, in publication order (P01 set, then P02). */
export const BUSINESS_EVENTS = [...BUSINESS_EVENTS_V1, ...BUSINESS_EVENTS_P02] as const;

type BusinessEventId = (typeof BUSINESS_EVENTS)[number]['eventType'];

export interface EventContractDescriptor {
  readonly id: typeof BOOKING_CONFIRMED_V1 | typeof FOUNDATION_PROBE_CREATED_V1 | BusinessEventId;
  readonly producer: EventProducer;
  readonly schemaVersion: number;
  readonly envelopeVersion: 1 | 2;
  readonly status: EventContractStatus;
  readonly asyncApi: string;
}

export const EVENT_CONTRACTS: readonly EventContractDescriptor[] = [
  {
    id: FOUNDATION_PROBE_CREATED_V1,
    producer: 'catalog',
    schemaVersion: 1,
    envelopeVersion: 1,
    status: 'foundation-runtime',
    asyncApi: 'docs/asyncapi/foundation-probe.yaml',
  },
  {
    id: BOOKING_CONFIRMED_V1,
    producer: 'booking',
    schemaVersion: 1,
    envelopeVersion: 1,
    status: 'contract-only',
    asyncApi: 'docs/asyncapi/booking-confirmed-v1.yaml',
  },
  ...BUSINESS_EVENTS.map((event): EventContractDescriptor => ({
    id: event.eventType,
    producer: event.producer,
    schemaVersion: schemaVersionOf(event.eventType),
    envelopeVersion: 2,
    status: 'published-producer-pending',
    asyncApi: event.asyncApi,
  })),
];

export function eventContract(id: EventContractDescriptor['id']): EventContractDescriptor {
  const contract = EVENT_CONTRACTS.find((candidate) => candidate.id === id);
  if (!contract) throw new Error('UNKNOWN_EVENT_CONTRACT');
  return contract;
}

/** The schema version is the `.v<n>` suffix of the event type. */
function schemaVersionOf(eventType: string): number {
  const match = /.v([1-9][0-9]*)$/.exec(eventType);
  if (!match?.[1]) throw new Error('UNVERSIONED_EVENT_TYPE');
  return Number(match[1]);
}
