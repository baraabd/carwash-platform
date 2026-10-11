import {
  BILLING_CASH_COLLECTED_V1,
  BILLING_CASH_COLLECTION_REVERSED_V1,
  BILLING_CUSTODY_HANDOVER_CHANGED_V1,
  BILLING_EVENTS_EXCHANGE,
  BILLING_EVENTS_V1,
} from '@carwash/event-contracts';
import { MoneyError, parseWireAmount, type CustodyFact } from '../domain';

/**
 * Translates published billing.v1 envelopes into custody facts. Only the three
 * custody events are consumed; the shared contract parser is the only
 * validator, so Wallet can never accept a shape Billing could not publish.
 */
export { BILLING_EVENTS_EXCHANGE };

export const CONSUMED_EVENT_TYPES = [
  BILLING_CASH_COLLECTED_V1.eventType,
  BILLING_CASH_COLLECTION_REVERSED_V1.eventType,
  BILLING_CUSTODY_HANDOVER_CHANGED_V1.eventType,
] as const;

const KNOWN_BILLING_TYPES: readonly string[] = BILLING_EVENTS_V1.map((spec) => spec.eventType);

export interface FactMeta {
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
  readonly aggregate: { readonly type: string; readonly id: string; readonly version: number };
}

export type Translation =
  | { readonly kind: 'FACT'; readonly fact: CustodyFact; readonly meta: FactMeta }
  | { readonly kind: 'IGNORED'; readonly reason: string }
  | { readonly kind: 'POISON'; readonly reason: string };

const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Contract parsers throw closed codes; anything else collapses to one code. */
function reasonOf(error: unknown): string {
  if (error instanceof MoneyError) return error.code;
  const message = error instanceof Error ? error.message : '';
  return REASON.test(message) ? message : 'INVALID_EVENT';
}

function meta(envelope: {
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly aggregate: { readonly type: string; readonly id: string; readonly version: number };
}): FactMeta {
  return {
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    correlationId: envelope.correlationId,
    occurredAt: new Date(envelope.occurredAt),
    aggregate: envelope.aggregate,
  };
}

export function translate(messageId: string, eventType: string, payload: unknown): Translation {
  if (!(CONSUMED_EVENT_TYPES as readonly string[]).includes(eventType))
    return {
      kind: 'IGNORED',
      reason: KNOWN_BILLING_TYPES.includes(eventType) ? 'NOT_CUSTODY_EVENT' : 'UNKNOWN_EVENT_TYPE',
    };
  try {
    const translation = parse(eventType, payload);
    if (translation.meta.eventId.toLowerCase() !== messageId.toLowerCase())
      return { kind: 'POISON', reason: 'MESSAGE_ID_MISMATCH' };
    return translation;
  } catch (error: unknown) {
    return { kind: 'POISON', reason: reasonOf(error) };
  }
}

function parse(eventType: string, payload: unknown): Extract<Translation, { kind: 'FACT' }> {
  if (eventType === BILLING_CASH_COLLECTED_V1.eventType) {
    const event = BILLING_CASH_COLLECTED_V1.parse(payload);
    // The collector is the authenticated account that recorded the cash.
    if (event.actor.kind !== 'account' || event.actor.id === null)
      throw new Error('COLLECTOR_NOT_ACCOUNT');
    return {
      kind: 'FACT',
      meta: meta(event),
      fact: {
        kind: 'COLLECTED',
        eventId: event.eventId,
        receiptId: event.aggregate.id,
        version: event.aggregate.version,
        holder: event.actor.id.toLowerCase(),
        amount: parseWireAmount(event.data.amount),
      },
    };
  }
  if (eventType === BILLING_CASH_COLLECTION_REVERSED_V1.eventType) {
    const event = BILLING_CASH_COLLECTION_REVERSED_V1.parse(payload);
    return {
      kind: 'FACT',
      meta: meta(event),
      fact: {
        kind: 'REVERSED',
        eventId: event.eventId,
        receiptId: event.aggregate.id,
        version: event.aggregate.version,
        amount: parseWireAmount(event.data.amount),
      },
    };
  }
  const event = BILLING_CUSTODY_HANDOVER_CHANGED_V1.parse(payload);
  const optional = (value: Parameters<typeof parseWireAmount>[0] | null) =>
    value === null ? null : parseWireAmount(value);
  return {
    kind: 'FACT',
    meta: meta(event),
    fact: {
      kind: 'HANDOVER',
      eventId: event.eventId,
      handoverId: event.aggregate.id,
      version: event.aggregate.version,
      holder: event.data.holder.toLowerCase(),
      previousStatus: event.data.previousStatus,
      status: event.data.status,
      receiptCount: event.data.receiptCount,
      declared: parseWireAmount(event.data.declared),
      counted: optional(event.data.counted),
      shortage: optional(event.data.shortage),
      overage: optional(event.data.overage),
    },
  };
}
