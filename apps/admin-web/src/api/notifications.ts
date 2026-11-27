import {
  request,
  object,
  text,
  integer,
  nullableText,
  list,
  oneOf,
  UUID,
  INSTANT,
  type Result,
} from './http';

export const DELIVERY_STATES = [
  'QUEUED',
  'SENDING',
  'RETRY_WAIT',
  'UNKNOWN',
  'PROVIDER_ACCEPTED',
  'DELIVERED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export interface Notification {
  readonly id: string;
  readonly subject: { readonly type: string; readonly ref: string } | null;
  readonly channel: string;
  readonly state: (typeof DELIVERY_STATES)[number];
  readonly attemptCount: number;
  readonly updatedAt: string;
}
export interface NotificationPage {
  readonly items: readonly Notification[];
  readonly nextCursor: string | null;
}
export function readNotification(raw: unknown): Notification {
  const value = object(raw, '$');
  const subject = value.subject === null ? null : object(value.subject, 'subject');
  return {
    id: text(value.id, 'id', UUID),
    subject: subject && {
      type: text(subject.type, 'subject.type', /^[a-z][a-z0-9-]{1,31}$/),
      ref: text(subject.ref, 'subject.ref', UUID),
    },
    channel: oneOf(value.channel, ['EMAIL', 'SMS', 'PUSH'] as const, 'channel'),
    state: oneOf(value.state, DELIVERY_STATES, 'state'),
    attemptCount: integer(value.attemptCount, 'attemptCount'),
    updatedAt: text(value.updatedAt, 'updatedAt', INSTANT),
  };
}
export function notifications(input: {
  readonly bookingId?: string;
  readonly state?: string;
  readonly cursor?: string;
}): Promise<Result<NotificationPage>> {
  return request('/admin/notifications', {
    query: {
      limit: '25',
      cursor: input.cursor,
      state: input.state,
      subjectType: input.bookingId ? 'booking' : undefined,
      subjectRef: input.bookingId,
    },
    read: (raw) => {
      const page = object(raw, '$');
      return {
        items: list(page.items, 'items', readNotification),
        nextCursor: nullableText(page.nextCursor, 'nextCursor', /^[A-Za-z0-9_-]{8,200}$/),
      };
    },
  });
}
