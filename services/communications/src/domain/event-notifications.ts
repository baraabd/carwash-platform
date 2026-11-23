/**
 * Which published business events become notification intents, and how.
 *
 * Pure domain. The source owner's event is the trigger, never the content:
 * the intent carries opaque references and a template key, and the recipient
 * is resolved by an authorized adapter at send time. Communications does not
 * become the source of truth for the booking it notifies about.
 */
import { NotificationRuleError, type Channel } from './notification';

/** One booking confirmation from the published `booking.confirmed.v1`. */
export interface BookingConfirmedTrigger {
  readonly kind: 'BOOKING_CONFIRMED';
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly bookingId: string;
  readonly customerId: string;
}

export type NotificationTrigger = BookingConfirmedTrigger;

/**
 * Per-trigger policy. The channel is fixed to SMS until the Customer owner
 * publishes contact preferences (CR-D-P03-07); the window bounds how late a
 * confirmation may still be sent, so a backlog never produces stale messages.
 */
export interface TriggerPolicy {
  readonly channel: Channel;
  readonly templateKey: string;
  readonly templateVersion: number;
  /** The intent expires this long after the source occurrence. */
  readonly ttlMs: number;
}

export const BOOKING_CONFIRMED_POLICY: TriggerPolicy = Object.freeze({
  channel: 'SMS',
  templateKey: 'booking.confirmed',
  templateVersion: 1,
  ttlMs: 6 * 60 * 60 * 1000,
});

export type TriggerDecision =
  | {
      readonly kind: 'NOTIFY';
      readonly command: {
        readonly sourceService: string;
        readonly idempotencyKey: string;
        readonly recipientRef: string;
        readonly channel: Channel;
        readonly templateKey: string;
        readonly templateVersion: number;
        readonly parameters: Readonly<Record<string, string>>;
        readonly expiresAt: Date;
        readonly subject: { readonly type: string; readonly ref: string };
      };
    }
  /** The source fact is older than its notification window: record, never send. */
  | { readonly kind: 'SKIP'; readonly reason: 'TOO_LATE' };

/** A short customer-facing booking reference; never a name, phone or address. */
export function bookingReference(bookingId: string): string {
  return bookingId.replaceAll('-', '').slice(0, 8).toUpperCase();
}

/**
 * Decides the intent for one trigger. Everything in the command derives from
 * the event, not from the processing time (except the late check), so every
 * redelivery and every replica produces the identical request fingerprint.
 */
export function decideTrigger(
  trigger: NotificationTrigger,
  now: Date,
  policy: TriggerPolicy = BOOKING_CONFIRMED_POLICY,
): TriggerDecision {
  if (!Number.isFinite(trigger.occurredAt.getTime()))
    throw new NotificationRuleError('INVALID_TRIGGER_TIME');
  const expiresAt = new Date(trigger.occurredAt.getTime() + policy.ttlMs);
  if (expiresAt.getTime() <= now.getTime()) return { kind: 'SKIP', reason: 'TOO_LATE' };
  return {
    kind: 'NOTIFY',
    command: {
      sourceService: 'booking',
      // One confirmation message per booking, whatever event id carried it.
      idempotencyKey: `booking-confirmed:${trigger.bookingId}`,
      recipientRef: trigger.customerId,
      channel: policy.channel,
      templateKey: policy.templateKey,
      templateVersion: policy.templateVersion,
      parameters: { bookingRef: bookingReference(trigger.bookingId) },
      expiresAt,
      subject: { type: 'booking', ref: trigger.bookingId },
    },
  };
}
