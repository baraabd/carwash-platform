import { BOOKING_CONFIRMED_V1, parseBookingConfirmedV1 } from '@carwash/event-contracts';
import {
  decideTrigger,
  type NotificationTrigger,
  type TriggerDecision,
} from '../domain/event-notifications';
import { NotificationRuleError } from '../domain/notification';
import type { NotificationIntake } from '../ports/notification.ports';
import type { EnqueueNotification } from './notification.service';

/** Every published event type that may create an intent, with its producer exchange. */
export const EVENT_NOTIFICATION_SUBSCRIPTIONS = [
  { exchange: 'booking.events', eventType: BOOKING_CONFIRMED_V1 },
] as const;

/** A delivered event, normalised: the inbox identity plus one trigger. */
export interface TriggerEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly trigger: NotificationTrigger;
}

/**
 * Parse with the owner's PUBLISHED contract parser only. Anything else throws,
 * and the consumer dead-letters a message it cannot parse rather than guessing.
 */
export function parseTriggerEvent(raw: unknown): TriggerEvent {
  const eventType =
    raw !== null && typeof raw === 'object'
      ? (raw as { eventType?: unknown }).eventType
      : undefined;
  if (eventType !== BOOKING_CONFIRMED_V1) throw new NotificationRuleError('UNSUPPORTED_EVENT');
  const e = parseBookingConfirmedV1(raw);
  return {
    eventId: e.eventId.toLowerCase(),
    eventType: e.eventType,
    correlationId: e.correlationId,
    trigger: {
      kind: 'BOOKING_CONFIRMED',
      eventId: e.eventId.toLowerCase(),
      occurredAt: new Date(e.occurredAt),
      bookingId: e.data.bookingId.toLowerCase(),
      customerId: e.data.customerId.toLowerCase(),
    },
  };
}

/**
 * The same business intent arriving with different content (for example a
 * different customer for the same booking) is an integrity fault: it is never
 * folded, never ACKed as a duplicate, and is dead-lettered by the broker.
 */
export class NotificationIntegrityError extends Error {
  constructor(readonly code: 'INTENT_CONFLICT') {
    super(code);
    this.name = 'NotificationIntegrityError';
  }
}

export type TriggerOutcome =
  | { readonly kind: 'CREATED' | 'REPLAYED'; readonly notificationId: string }
  | { readonly kind: 'SKIPPED'; readonly reason: 'TOO_LATE' };

/**
 * Turns one trigger into at most one intent, inside the caller's (inbox)
 * transaction. Nothing is sent here.
 */
export class EventNotificationHandler {
  constructor(
    private readonly enqueue: EnqueueNotification,
    private readonly clock: { now(): Date },
  ) {}

  decide(trigger: NotificationTrigger): TriggerDecision {
    return decideTrigger(trigger, this.clock.now());
  }

  async handle(intake: NotificationIntake, trigger: NotificationTrigger): Promise<TriggerOutcome> {
    const decision = this.decide(trigger);
    if (decision.kind === 'SKIP') return { kind: 'SKIPPED', reason: decision.reason };
    const result = await this.enqueue.execute(intake, decision.command);
    if (result.kind === 'CONFLICT') throw new NotificationIntegrityError('INTENT_CONFLICT');
    return result;
  }
}
