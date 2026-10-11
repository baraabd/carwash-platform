import { parseEnvelopeV2, type EventEnvelopeV2 } from '@carwash/event-contracts';
import {
  CREDIT_SOURCES,
  CREDIT_STATUSES,
  Money,
  PROVIDERS,
  REFUND_CHANNELS,
  REFUND_REASONS,
  REFUND_STATUSES,
  UNALLOCATED_REASONS,
  type CreditSource,
  type CreditStatus,
  type MoneyWire,
  type ProviderId,
  type RefundChannel,
  type RefundReason,
  type RefundStatus,
  type UnallocatedReason,
} from '../domain';
import type { OutboxEvent, PrincipalRef } from '../ports';
import { BILLING_EVENTS_EXCHANGE } from './events';

/**
 * Provider credit and refund integration events (PROPOSED, CR-B-09 in
 * docs/production/B/CONTRACT_REQUEST_E_BILLING.md). Written to the local outbox
 * in the same transaction as the fact; the relay is not started until Lane E
 * registers them. Data carries opaque IDs, statuses and amounts only: never a
 * provider transaction/refund reference, merchant account, evidence digest,
 * phone or name. A credit event never means a specific booking may start: the
 * obligation status event remains the payment confirmation.
 */
export const CREDIT_AGGREGATE = 'billing-provider-credit';
export const REFUND_AGGREGATE = 'billing-refund';
export const PROVIDER_CREDIT_CHANGED_V1 = 'billing.provider-credit-changed.v1' as const;
export const REFUND_CHANGED_V1 = 'billing.refund-changed.v1' as const;

export interface ProviderCreditChangedData {
  readonly provider: ProviderId;
  readonly source: CreditSource;
  readonly previousStatus: CreditStatus | null;
  readonly status: CreditStatus;
  readonly unallocatedReason: UnallocatedReason | null;
  readonly amount: MoneyWire;
  readonly obligationId: string | null;
}

export interface RefundChangedData {
  readonly creditId: string;
  /** The obligation the refunded credit had settled; null for unallocated money. */
  readonly obligationId: string | null;
  readonly provider: ProviderId;
  readonly channel: RefundChannel;
  readonly reason: RefundReason;
  readonly previousStatus: RefundStatus | null;
  readonly status: RefundStatus;
  readonly amount: MoneyWire;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function closedObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_EVENT_DATA');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [...keys].sort().join(','))
    throw new Error('INVALID_EVENT_DATA');
  return record;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('INVALID_EVENT_DATA');
  return value;
}

function member<T extends string>(allowed: readonly T[], value: unknown): T {
  const found = allowed.find((candidate) => candidate === value);
  if (!found) throw new Error('INVALID_EVENT_DATA');
  return found;
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

export function parseProviderCreditChangedData(value: unknown): ProviderCreditChangedData {
  const d = closedObject(value, [
    'provider',
    'source',
    'previousStatus',
    'status',
    'unallocatedReason',
    'amount',
    'obligationId',
  ]);
  const previous = optional(d.previousStatus, (v) => member(CREDIT_STATUSES, v));
  const status = member(CREDIT_STATUSES, d.status);
  if (previous === status) throw new Error('INVALID_EVENT_DATA');
  const reason = optional(d.unallocatedReason, (v) => member(UNALLOCATED_REASONS, v));
  if ((status === 'UNALLOCATED') !== (reason !== null)) throw new Error('INVALID_EVENT_DATA');
  const obligationId = optional(d.obligationId, id);
  if ((status === 'ALLOCATED') !== (obligationId !== null)) throw new Error('INVALID_EVENT_DATA');
  return {
    provider: member(PROVIDERS, d.provider),
    source: member(CREDIT_SOURCES, d.source),
    previousStatus: previous,
    status,
    unallocatedReason: reason,
    amount: Money.parse(d.amount).toWire(),
    obligationId,
  };
}

export function parseRefundChangedData(value: unknown): RefundChangedData {
  const d = closedObject(value, [
    'creditId',
    'obligationId',
    'provider',
    'channel',
    'reason',
    'previousStatus',
    'status',
    'amount',
  ]);
  const previous = optional(d.previousStatus, (v) => member(REFUND_STATUSES, v));
  const status = member(REFUND_STATUSES, d.status);
  if (previous === status) throw new Error('INVALID_EVENT_DATA');
  return {
    creditId: id(d.creditId),
    obligationId: optional(d.obligationId, id),
    provider: member(PROVIDERS, d.provider),
    channel: member(REFUND_CHANNELS, d.channel),
    reason: member(REFUND_REASONS, d.reason),
    previousStatus: previous,
    status,
    amount: Money.parse(d.amount).toWire(),
  };
}

export interface ProviderEventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  /** Null when the provider's authenticated notification caused the change. */
  readonly actor: PrincipalRef | null;
  readonly aggregateId: string;
  readonly revision: number;
}

function outboxRow<TType extends string, TData>(
  eventType: TType,
  aggregateType: string,
  data: TData,
  context: ProviderEventContext,
  parseData: (data: unknown) => TData,
): OutboxEvent {
  const envelope: EventEnvelopeV2<TType, 'billing', TData> = {
    eventId: context.eventId,
    eventType,
    envelopeVersion: 2,
    producer: 'billing',
    occurredAt: context.occurredAt.toISOString(),
    correlationId: context.correlationId,
    causationId: null,
    traceparent: null,
    aggregate: { type: aggregateType, id: context.aggregateId, version: context.revision },
    actor: context.actor
      ? { kind: context.actor.kind, id: context.actor.subjectId }
      : { kind: 'system', id: null },
    data,
  };
  // Never write an envelope the shared parser would reject.
  parseEnvelopeV2(envelope, { eventType, producer: 'billing', aggregateType }, parseData);
  return {
    eventId: context.eventId,
    eventType,
    exchange: BILLING_EVENTS_EXCHANGE,
    routingKey: eventType,
    payload: JSON.stringify(envelope),
    correlationId: context.correlationId,
    traceParent: null,
    createdAt: context.occurredAt,
  };
}

export function providerCreditChangedEvent(
  data: ProviderCreditChangedData,
  context: ProviderEventContext,
): OutboxEvent {
  return outboxRow(
    PROVIDER_CREDIT_CHANGED_V1,
    CREDIT_AGGREGATE,
    data,
    context,
    parseProviderCreditChangedData,
  );
}

export function refundChangedEvent(
  data: RefundChangedData,
  context: ProviderEventContext,
): OutboxEvent {
  return outboxRow(REFUND_CHANGED_V1, REFUND_AGGREGATE, data, context, parseRefundChangedData);
}
