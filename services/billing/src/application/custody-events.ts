import { parseEnvelopeV2, type EventEnvelopeV2 } from '@carwash/event-contracts';
import {
  CUSTODY_STATUSES,
  HANDOVER_STATUSES,
  Money,
  REVERSAL_REASONS,
  type CustodyStatus,
  type HandoverStatus,
  type MoneyWire,
  type ReversalReason,
} from '../domain';
import type { OutboxEvent, PrincipalRef } from '../ports';
import { BILLING_EVENTS_EXCHANGE } from './events';

/**
 * Cash collection and custody integration events (PROPOSED, CR-B-08 in
 * docs/production/B/CONTRACT_REQUEST_E_BILLING.md). Written to the local outbox
 * in the same transaction as the fact; the relay is not started until Lane E
 * registers them. Data carries opaque IDs, statuses and amounts only: never a
 * treasury/settlement reference, phone, name or customer detail.
 *
 * These events are separate from payment confirmation: a collected-cash event
 * never means the company received the money, and a handover event never means
 * the customer paid twice.
 */
export const RECEIPT_AGGREGATE = 'billing-cash-receipt';
export const HANDOVER_AGGREGATE = 'billing-custody-handover';
export const CASH_COLLECTED_V1 = 'billing.cash-collected.v1' as const;
export const CASH_COLLECTION_REVERSED_V1 = 'billing.cash-collection-reversed.v1' as const;
export const CUSTODY_HANDOVER_CHANGED_V1 = 'billing.custody-handover-changed.v1' as const;

export interface CashCollectedData {
  readonly obligationId: string;
  readonly bookingId: string;
  readonly assignmentId: string;
  readonly amount: MoneyWire;
  readonly custodyStatus: CustodyStatus;
}

export interface CashCollectionReversedData {
  readonly obligationId: string;
  readonly bookingId: string;
  readonly amount: MoneyWire;
  readonly reason: ReversalReason;
}

export interface CustodyHandoverChangedData {
  readonly holder: string;
  readonly previousStatus: HandoverStatus | null;
  readonly status: HandoverStatus;
  readonly receiptCount: number;
  readonly declared: MoneyWire;
  readonly counted: MoneyWire | null;
  readonly shortage: MoneyWire | null;
  readonly overage: MoneyWire | null;
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

const money = (value: unknown): MoneyWire => Money.parse(value).toWire();
const optionalMoney = (value: unknown): MoneyWire | null => (value === null ? null : money(value));

export function parseCashCollectedData(value: unknown): CashCollectedData {
  const d = closedObject(value, [
    'obligationId',
    'bookingId',
    'assignmentId',
    'amount',
    'custodyStatus',
  ]);
  return {
    obligationId: id(d.obligationId),
    bookingId: id(d.bookingId),
    assignmentId: id(d.assignmentId),
    amount: money(d.amount),
    custodyStatus: member(CUSTODY_STATUSES, d.custodyStatus),
  };
}

export function parseCashCollectionReversedData(value: unknown): CashCollectionReversedData {
  const d = closedObject(value, ['obligationId', 'bookingId', 'amount', 'reason']);
  return {
    obligationId: id(d.obligationId),
    bookingId: id(d.bookingId),
    amount: money(d.amount),
    reason: member(REVERSAL_REASONS, d.reason),
  };
}

export function parseCustodyHandoverChangedData(value: unknown): CustodyHandoverChangedData {
  const d = closedObject(value, [
    'holder',
    'previousStatus',
    'status',
    'receiptCount',
    'declared',
    'counted',
    'shortage',
    'overage',
  ]);
  const previous = d.previousStatus === null ? null : member(HANDOVER_STATUSES, d.previousStatus);
  const status = member(HANDOVER_STATUSES, d.status);
  if (previous === status) throw new Error('INVALID_EVENT_DATA');
  if (
    typeof d.receiptCount !== 'number' ||
    !Number.isInteger(d.receiptCount) ||
    d.receiptCount < 1 ||
    d.receiptCount > 200
  )
    throw new Error('INVALID_EVENT_DATA');
  return {
    holder: id(d.holder),
    previousStatus: previous,
    status,
    receiptCount: d.receiptCount,
    declared: money(d.declared),
    counted: optionalMoney(d.counted),
    shortage: optionalMoney(d.shortage),
    overage: optionalMoney(d.overage),
  };
}

export interface CustodyEventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly actor: PrincipalRef;
  readonly aggregateId: string;
  /** The receipt/handover revision this event describes. */
  readonly revision: number;
}

function outboxRow<TType extends string, TData>(
  eventType: TType,
  aggregateType: string,
  data: TData,
  context: CustodyEventContext,
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
    actor: { kind: context.actor.kind, id: context.actor.subjectId },
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

export function cashCollectedEvent(
  data: CashCollectedData,
  context: CustodyEventContext,
): OutboxEvent {
  return outboxRow(CASH_COLLECTED_V1, RECEIPT_AGGREGATE, data, context, parseCashCollectedData);
}

export function cashCollectionReversedEvent(
  data: CashCollectionReversedData,
  context: CustodyEventContext,
): OutboxEvent {
  return outboxRow(
    CASH_COLLECTION_REVERSED_V1,
    RECEIPT_AGGREGATE,
    data,
    context,
    parseCashCollectionReversedData,
  );
}

export function custodyHandoverChangedEvent(
  data: CustodyHandoverChangedData,
  context: CustodyEventContext,
): OutboxEvent {
  return outboxRow(
    CUSTODY_HANDOVER_CHANGED_V1,
    HANDOVER_AGGREGATE,
    data,
    context,
    parseCustodyHandoverChangedData,
  );
}
