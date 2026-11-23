import { EVENT_PRODUCERS, parseEnvelopeV2, type EventEnvelopeV2 } from '@carwash/event-contracts';
import {
  RELEASE_REASONS,
  RESERVATION_STATUSES,
  REVERSE_REASONS,
  SUBSCRIPTION_STATUSES,
  type ReservationStatus,
  type SubscriptionStatus,
} from '../domain';
import type { ActorRef, OutboxEvent, SettlementReason } from '../ports';

/**
 * Subscription integration events, written to the local outbox in the SAME
 * transaction as the fact they describe (transactional outbox).
 *
 * Data carries opaque IDs, statuses, counts and closed reason codes only: never a
 * payment reference, name, phone or price paid. Registration in
 * @carwash/event-contracts and the broker topology are a Lane E request
 * (docs/production/B/CONTRACT_REQUEST_E_SUBSCRIPTION.md, CR-B-10). Until E
 * publishes them the relay is NOT started and rows stay pending; the shapes are
 * the exact proposal and are self-validated through the shared envelope parser.
 */
export const SUBSCRIPTION_EVENTS_EXCHANGE = 'washgo.subscription.events';
export const SUBSCRIPTION_AGGREGATE = 'subscription';
export const ENTITLEMENT_AGGREGATE = 'subscription-entitlement';
export const SUBSCRIPTION_CHANGED_V1 = 'subscription.subscription-changed.v1' as const;
export const ENTITLEMENT_RESERVED_V1 = 'subscription.entitlement-reserved.v1' as const;
export const ENTITLEMENT_CHANGED_V1 = 'subscription.entitlement-reservation-changed.v1' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PLAN_CODE = /^[a-z][a-z0-9-]{2,40}$/;

export interface SubscriptionChangedData {
  readonly customerSubject: string;
  readonly planCode: string;
  readonly planRevision: number;
  readonly previousStatus: SubscriptionStatus | null;
  readonly status: SubscriptionStatus;
  readonly periodNo: number | null;
  readonly periodEndsAt: string | null;
  readonly unitsGranted: number | null;
}

export interface EntitlementReservedData {
  readonly subscriptionId: string;
  readonly bookingId: string;
  readonly periodNo: number;
}

export interface EntitlementChangedData {
  readonly subscriptionId: string;
  readonly bookingId: string;
  readonly periodNo: number;
  readonly previousStatus: ReservationStatus;
  readonly status: ReservationStatus;
  readonly reason: SettlementReason | null;
}

function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_EVENT_DATA');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [...keys].sort().join(','))
    throw new Error('INVALID_EVENT_DATA');
  return record;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('INVALID_EVENT_DATA');
  return value;
}

function positive(value: unknown, nullable: boolean): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1_000_000)
    throw new Error('INVALID_EVENT_DATA');
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error('INVALID_EVENT_DATA');
  return found;
}

export function parseSubscriptionChangedData(value: unknown): SubscriptionChangedData {
  const d = closed(value, [
    'customerSubject',
    'planCode',
    'planRevision',
    'previousStatus',
    'status',
    'periodNo',
    'periodEndsAt',
    'unitsGranted',
  ]);
  if (typeof d.planCode !== 'string' || !PLAN_CODE.test(d.planCode))
    throw new Error('INVALID_EVENT_DATA');
  const previous =
    d.previousStatus === null ? null : oneOf(d.previousStatus, SUBSCRIPTION_STATUSES);
  const status = oneOf(d.status, SUBSCRIPTION_STATUSES);
  const periodNo = positive(d.periodNo, true);
  if (d.periodEndsAt !== null && (typeof d.periodEndsAt !== 'string' || !UTC.test(d.periodEndsAt)))
    throw new Error('INVALID_EVENT_DATA');
  const unitsGranted = positive(d.unitsGranted, true);
  // Period facts travel together: all present once activated, all null before.
  if (
    (periodNo === null) !== (d.periodEndsAt === null) ||
    (periodNo === null) !== (unitsGranted === null)
  )
    throw new Error('INVALID_EVENT_DATA');
  return {
    customerSubject: uuid(d.customerSubject),
    planCode: d.planCode,
    planRevision: positive(d.planRevision, false) ?? 1,
    previousStatus: previous,
    status,
    periodNo,
    periodEndsAt: d.periodEndsAt,
    unitsGranted,
  };
}

export function parseEntitlementReservedData(value: unknown): EntitlementReservedData {
  const d = closed(value, ['subscriptionId', 'bookingId', 'periodNo']);
  return {
    subscriptionId: uuid(d.subscriptionId),
    bookingId: uuid(d.bookingId),
    periodNo: positive(d.periodNo, false) ?? 1,
  };
}

export function parseEntitlementChangedData(value: unknown): EntitlementChangedData {
  const d = closed(value, [
    'subscriptionId',
    'bookingId',
    'periodNo',
    'previousStatus',
    'status',
    'reason',
  ]);
  const previous = oneOf(d.previousStatus, RESERVATION_STATUSES);
  const status = oneOf(d.status, RESERVATION_STATUSES);
  const legal =
    (previous === 'RESERVED' && (status === 'COMMITTED' || status === 'RELEASED')) ||
    (previous === 'COMMITTED' && status === 'REVERSED');
  if (!legal) throw new Error('INVALID_EVENT_DATA');
  return {
    subscriptionId: uuid(d.subscriptionId),
    bookingId: uuid(d.bookingId),
    periodNo: positive(d.periodNo, false) ?? 1,
    previousStatus: previous,
    status,
    reason: settlementReason(status, d.reason),
  };
}

/** COMMITTED carries no reason; RELEASED and REVERSED carry their closed reason code. */
function settlementReason(status: ReservationStatus, value: unknown): SettlementReason | null {
  if (status === 'COMMITTED') {
    if (value !== null) throw new Error('INVALID_EVENT_DATA');
    return null;
  }
  return status === 'RELEASED' ? oneOf(value, RELEASE_REASONS) : oneOf(value, REVERSE_REASONS);
}

export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly actor: ActorRef;
  readonly aggregateId: string;
  /** The aggregate version this event describes (consumers apply newer only). */
  readonly version: number;
}

function eventActor(actor: ActorRef): { kind: 'account' | 'service'; id: string } {
  // Envelope v2 names a calling workload by its producer name only.
  if (actor.kind === 'service' && !(EVENT_PRODUCERS as readonly string[]).includes(actor.id))
    throw new Error('INVALID_EVENT_ACTOR');
  return { kind: actor.kind, id: actor.id };
}

function outboxRow<TType extends string, TData>(
  eventType: TType,
  aggregateType: string,
  data: TData,
  context: EventContext,
  parseData: (data: unknown) => TData,
): OutboxEvent {
  const envelope: EventEnvelopeV2<TType, 'subscription', TData> = {
    eventId: context.eventId,
    eventType,
    envelopeVersion: 2,
    producer: 'subscription',
    occurredAt: context.occurredAt.toISOString(),
    correlationId: context.correlationId,
    causationId: null,
    traceparent: null,
    aggregate: { type: aggregateType, id: context.aggregateId, version: context.version },
    actor: eventActor(context.actor),
    data,
  };
  // Never write an envelope the shared parser would reject.
  parseEnvelopeV2(envelope, { eventType, producer: 'subscription', aggregateType }, parseData);
  return {
    eventId: context.eventId,
    eventType,
    exchange: SUBSCRIPTION_EVENTS_EXCHANGE,
    routingKey: eventType,
    payload: JSON.stringify(envelope),
    correlationId: context.correlationId,
    traceParent: null,
    createdAt: context.occurredAt,
  };
}

export function subscriptionChangedEvent(
  data: SubscriptionChangedData,
  context: EventContext,
): OutboxEvent {
  return outboxRow(
    SUBSCRIPTION_CHANGED_V1,
    SUBSCRIPTION_AGGREGATE,
    data,
    context,
    parseSubscriptionChangedData,
  );
}

export function entitlementReservedEvent(
  data: EntitlementReservedData,
  context: EventContext,
): OutboxEvent {
  return outboxRow(
    ENTITLEMENT_RESERVED_V1,
    ENTITLEMENT_AGGREGATE,
    data,
    context,
    parseEntitlementReservedData,
  );
}

export function entitlementChangedEvent(
  data: EntitlementChangedData,
  context: EventContext,
): OutboxEvent {
  return outboxRow(
    ENTITLEMENT_CHANGED_V1,
    ENTITLEMENT_AGGREGATE,
    data,
    context,
    parseEntitlementChangedData,
  );
}
