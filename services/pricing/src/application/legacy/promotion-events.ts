import { EVENT_PRODUCERS, parseEnvelopeV2, type EventEnvelopeV2 } from '@carwash/event-contracts';
import {
  REDEMPTION_RELEASE_REASONS,
  REDEMPTION_STATUSES,
  type RedemptionReleaseReason,
  type RedemptionStatus,
} from '../../domain/legacy';
import type { OutboxEvent, PromotionActor } from '../../ports/legacy';

/**
 * Promotion redemption events, written to Pricing's outbox in the SAME
 * transaction as the redemption change. Registration in
 * @carwash/event-contracts and broker topology are a Lane E request
 * (docs/production/B/CONTRACT_REQUEST_E_PRICING.md, CR-B2-5). The relay is not
 * started; rows stay pending. Data carries opaque ids, closed codes and the
 * exact discount only: never the coupon code, a customer name or phone.
 */
export const PRICING_EVENTS_EXCHANGE = 'washgo.pricing.events';
export const REDEMPTION_AGGREGATE = 'pricing-promotion-redemption';
export const REDEMPTION_CHANGED_V1 = 'pricing.promotion-redemption-changed.v1' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROMOTION_CODE = /^[a-z][a-z0-9-]{2,40}$/;
const MINOR = /^[1-9][0-9]{0,17}$/;

export interface RedemptionChangedData {
  readonly promotionCode: string;
  readonly quoteId: string;
  readonly bookingId: string;
  readonly previousStatus: RedemptionStatus | null;
  readonly status: RedemptionStatus;
  readonly discount: { readonly currency: string; readonly amountMinor: string };
  readonly reason: RedemptionReleaseReason | null;
}

function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_EVENT_DATA');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [...keys].sort().join(','))
    throw new Error('INVALID_EVENT_DATA');
  return record;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error('INVALID_EVENT_DATA');
  return found;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('INVALID_EVENT_DATA');
  return value;
}

export function parseRedemptionChangedData(value: unknown): RedemptionChangedData {
  const d = closed(value, [
    'promotionCode',
    'quoteId',
    'bookingId',
    'previousStatus',
    'status',
    'discount',
    'reason',
  ]);
  if (typeof d.promotionCode !== 'string' || !PROMOTION_CODE.test(d.promotionCode))
    throw new Error('INVALID_EVENT_DATA');
  const previous = d.previousStatus === null ? null : oneOf(d.previousStatus, REDEMPTION_STATUSES);
  const status = oneOf(d.status, REDEMPTION_STATUSES);
  const legal =
    (previous === null && status === 'RESERVED') ||
    (previous === 'RESERVED' && (status === 'COMMITTED' || status === 'RELEASED'));
  if (!legal) throw new Error('INVALID_EVENT_DATA');
  const discount = closed(d.discount, ['currency', 'amountMinor']);
  if (typeof discount.currency !== 'string' || !/^[A-Z]{3}$/.test(discount.currency))
    throw new Error('INVALID_EVENT_DATA');
  if (typeof discount.amountMinor !== 'string' || !MINOR.test(discount.amountMinor))
    throw new Error('INVALID_EVENT_DATA');
  const reason = status === 'RELEASED' ? oneOf(d.reason, REDEMPTION_RELEASE_REASONS) : null;
  if (status !== 'RELEASED' && d.reason !== null) throw new Error('INVALID_EVENT_DATA');
  return {
    promotionCode: d.promotionCode,
    quoteId: uuid(d.quoteId),
    bookingId: uuid(d.bookingId),
    previousStatus: previous,
    status,
    discount: { currency: discount.currency, amountMinor: discount.amountMinor },
    reason,
  };
}

export function redemptionChangedEvent(
  data: RedemptionChangedData,
  context: {
    readonly eventId: string;
    readonly occurredAt: Date;
    readonly correlationId: string;
    readonly actor: PromotionActor;
    readonly redemptionId: string;
    readonly version: number;
  },
): OutboxEvent {
  if (
    context.actor.kind === 'service' &&
    !(EVENT_PRODUCERS as readonly string[]).includes(context.actor.id)
  )
    throw new Error('INVALID_EVENT_ACTOR');
  const envelope: EventEnvelopeV2<typeof REDEMPTION_CHANGED_V1, 'pricing', RedemptionChangedData> =
    {
      eventId: context.eventId,
      eventType: REDEMPTION_CHANGED_V1,
      envelopeVersion: 2,
      producer: 'pricing',
      occurredAt: context.occurredAt.toISOString(),
      correlationId: context.correlationId,
      causationId: null,
      traceparent: null,
      aggregate: { type: REDEMPTION_AGGREGATE, id: context.redemptionId, version: context.version },
      actor: { kind: context.actor.kind, id: context.actor.id },
      data,
    };
  parseEnvelopeV2(
    envelope,
    { eventType: REDEMPTION_CHANGED_V1, producer: 'pricing', aggregateType: REDEMPTION_AGGREGATE },
    parseRedemptionChangedData,
  );
  return {
    eventId: context.eventId,
    eventType: REDEMPTION_CHANGED_V1,
    exchange: PRICING_EVENTS_EXCHANGE,
    routingKey: REDEMPTION_CHANGED_V1,
    payload: JSON.stringify(envelope),
    correlationId: context.correlationId,
    traceParent: null,
    createdAt: context.occurredAt,
  };
}
