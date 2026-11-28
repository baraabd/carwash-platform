import {
  BILLING_EVENTS_EXCHANGE,
  BILLING_OBLIGATION_CREATED_V1,
  BILLING_OBLIGATION_STATUS_CHANGED_V1,
} from '@carwash/event-contracts';
import type { OutboxRecord } from '@carwash/platform-messaging';

/** Reporting's published receivable projection. Refunds and custody are separate facts. */
const OBLIGATION_EVENT_SPECS = [
  BILLING_OBLIGATION_CREATED_V1,
  BILLING_OBLIGATION_STATUS_CHANGED_V1,
] as const;
export const OBLIGATION_EVENT_TYPES = OBLIGATION_EVENT_SPECS.map((spec) => spec.eventType);

export function validateObligationOutbox(record: OutboxRecord): void {
  const spec = OBLIGATION_EVENT_SPECS.find((candidate) => candidate.eventType === record.eventType);
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
