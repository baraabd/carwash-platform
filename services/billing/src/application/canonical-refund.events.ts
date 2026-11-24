import { BILLING_REFUND_STATUS_CHANGED_V1 } from '@carwash/event-contracts';
import type { OutboxEvent, ProviderCreditRecord, RefundRecord } from '../ports';
import { BILLING_EVENTS_EXCHANGE } from './events';
import type { ProviderEventContext } from './provider-events';
import { publicRefundStatus } from './canonical-refund.views';

/** Published event; inserted atomically with each canonical fact, never a transfer instruction. */
export function canonicalRefundChangedEvent(
  credit: ProviderCreditRecord,
  previous: RefundRecord | null,
  next: RefundRecord,
  context: ProviderEventContext,
): OutboxEvent {
  const event = BILLING_REFUND_STATUS_CHANGED_V1;
  const envelope = event.parse({
    eventId: context.eventId,
    eventType: event.eventType,
    envelopeVersion: 2,
    producer: 'billing',
    occurredAt: context.occurredAt.toISOString(),
    correlationId: context.correlationId,
    causationId: null,
    traceparent: null,
    aggregate: { type: event.aggregateType, id: next.id, version: next.revision },
    actor: context.actor
      ? { kind: context.actor.kind, id: context.actor.subjectId }
      : { kind: 'system', id: null },
    data: {
      obligationId: credit.obligationId,
      previousStatus: previous ? publicRefundStatus(previous) : null,
      status: publicRefundStatus(next),
      reason: next.reason,
      amount: next.amount.toWire(),
    },
  });
  return {
    eventId: context.eventId,
    eventType: event.eventType,
    exchange: BILLING_EVENTS_EXCHANGE,
    routingKey: event.eventType,
    payload: JSON.stringify(envelope),
    correlationId: context.correlationId,
    traceParent: null,
    createdAt: context.occurredAt,
  };
}
