import {
  BILLING_CASH_COLLECTED_V1,
  BILLING_CASH_COLLECTION_REVERSED_V1,
  BILLING_CUSTODY_HANDOVER_CHANGED_V1,
  BILLING_EVENTS_EXCHANGE,
} from '@carwash/event-contracts';
import type { OutboxRecord, TopologySpec } from '@carwash/platform-messaging';

/** Only the events with an explicitly deployed custody subscriber are relayed. */
const CUSTODY_EVENT_SPECS = [
  BILLING_CASH_COLLECTED_V1,
  BILLING_CASH_COLLECTION_REVERSED_V1,
  BILLING_CUSTODY_HANDOVER_CHANGED_V1,
] as const;
export const CUSTODY_EVENT_TYPES = CUSTODY_EVENT_SPECS.map((spec) => spec.eventType);
export const billingCustodyProducerTopology: TopologySpec = {
  exchanges: [{ name: BILLING_EVENTS_EXCHANGE, type: 'topic' }],
  queues: [],
  bindings: [],
};

export function validateCustodyOutbox(record: OutboxRecord): void {
  const spec = CUSTODY_EVENT_SPECS.find((candidate) => candidate.eventType === record.eventType);
  if (
    !spec ||
    record.exchange !== BILLING_EVENTS_EXCHANGE ||
    record.routingKey !== record.eventType
  )
    throw new Error('OUTBOX_ROUTE_INVALID');
  const event = spec.parse(JSON.parse(record.payload));
  if (event.eventId !== record.eventId || event.correlationId !== record.correlationId)
    throw new Error('OUTBOX_ENVELOPE_MISMATCH');
}
