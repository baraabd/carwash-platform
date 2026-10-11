import { parseEnvelopeV2, type EventEnvelopeV2 } from '@carwash/event-contracts';
import { FINANCIAL_STATUSES, Money, type FinancialStatus, type MoneyWire } from '../domain';
import type { OutboxEvent, PrincipalRef } from '../ports';

/**
 * Billing integration events, written to the local outbox in the SAME
 * transaction as the financial fact they describe (transactional outbox).
 *
 * Data carries opaque IDs, revisions, statuses and amounts only: never a
 * provider transaction reference, phone, name or receipt. Registration in
 * @carwash/event-contracts and the broker topology are a Lane E request
 * (docs/production/B/CONTRACT_REQUEST_E_BILLING.md). Until E publishes them the
 * relay is NOT started and rows stay pending; the shapes below are the exact
 * proposal and are self-validated through the shared envelope v2 parser.
 */
export const BILLING_EVENTS_EXCHANGE = 'washgo.billing.events';
export const OBLIGATION_AGGREGATE = 'billing-obligation';
export const OBLIGATION_CREATED_V1 = 'billing.obligation-created.v1' as const;
export const OBLIGATION_STATUS_CHANGED_V1 = 'billing.obligation-status-changed.v1' as const;

export interface ObligationCreatedData {
  readonly quoteId: string;
  readonly amount: MoneyWire;
  readonly financialStatus: FinancialStatus;
}

export interface ObligationStatusChangedData {
  readonly previousFinancialStatus: FinancialStatus;
  readonly financialStatus: FinancialStatus;
  readonly verified: MoneyWire;
  readonly outstanding: MoneyWire;
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

function status(value: unknown): FinancialStatus {
  const found = FINANCIAL_STATUSES.find((candidate) => candidate === value);
  if (!found) throw new Error('INVALID_EVENT_DATA');
  return found;
}

function money(value: unknown): MoneyWire {
  return Money.parse(value).toWire();
}

export function parseObligationCreatedData(value: unknown): ObligationCreatedData {
  const d = closedObject(value, ['quoteId', 'amount', 'financialStatus']);
  if (typeof d.quoteId !== 'string' || !UUID.test(d.quoteId)) throw new Error('INVALID_EVENT_DATA');
  return {
    quoteId: d.quoteId,
    amount: money(d.amount),
    financialStatus: status(d.financialStatus),
  };
}

export function parseObligationStatusChangedData(value: unknown): ObligationStatusChangedData {
  const d = closedObject(value, [
    'previousFinancialStatus',
    'financialStatus',
    'verified',
    'outstanding',
  ]);
  const previous = status(d.previousFinancialStatus);
  const current = status(d.financialStatus);
  if (previous === current) throw new Error('INVALID_EVENT_DATA');
  return {
    previousFinancialStatus: previous,
    financialStatus: current,
    verified: money(d.verified),
    outstanding: money(d.outstanding),
  };
}

export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  /** Null when a provider notification (no Identity principal) caused the change. */
  readonly actor: PrincipalRef | null;
  readonly obligationId: string;
  /** The obligation revision this event describes (consumers apply newer only). */
  readonly revision: number;
}

function outboxRow<TType extends string, TData>(
  eventType: TType,
  data: TData,
  context: EventContext,
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
    aggregate: { type: OBLIGATION_AGGREGATE, id: context.obligationId, version: context.revision },
    actor: context.actor
      ? { kind: context.actor.kind, id: context.actor.subjectId }
      : { kind: 'system', id: null },
    data,
  };
  // Never write an envelope the shared parser would reject.
  parseEnvelopeV2(
    envelope,
    { eventType, producer: 'billing', aggregateType: OBLIGATION_AGGREGATE },
    parseData,
  );
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

export function obligationCreatedEvent(
  data: ObligationCreatedData,
  context: EventContext,
): OutboxEvent {
  return outboxRow(OBLIGATION_CREATED_V1, data, context, parseObligationCreatedData);
}

export function obligationStatusChangedEvent(
  data: ObligationStatusChangedData,
  context: EventContext,
): OutboxEvent {
  return outboxRow(OBLIGATION_STATUS_CHANGED_V1, data, context, parseObligationStatusChangedData);
}
