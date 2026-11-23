import {
  DELIVERY_STATES,
  NotificationRuleError,
  notificationSubject,
  type DeliveryState,
} from '../domain/notification';
import { AccessFault, type VerifiedSession } from '../ports/identity.ports';
import type {
  NotificationReader,
  StaffNotificationDetail,
  StaffNotificationPage,
} from '../ports/notification.ports';

/**
 * Staff visibility of notification delivery. `communications.read` is
 * requested (CR-D-P01-01); until it exists the operations role, which already
 * handles booking follow-up, reads with `operations.dispatch`. Deny by default.
 */
export const NOTIFICATION_READ_PERMISSIONS: readonly string[] = ['operations.dispatch'];

export function requireNotificationRead(session: VerifiedSession): void {
  if (!NOTIFICATION_READ_PERMISSIONS.some((p) => session.permissions.includes(p)))
    throw new AccessFault('AUTH_FORBIDDEN');
}

/**
 * Fixed-window per-subject read budget. Process-local by design: it bounds one
 * caller against one replica; global quotas belong to the edge.
 */
export class ReadBudget {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('INVALID_READ_BUDGET');
  }

  take(subject: string): void {
    const at = this.now();
    const current = this.windows.get(subject);
    if (!current || at - current.start >= this.windowMs) {
      if (this.windows.size >= 10_000) this.windows.clear();
      this.windows.set(subject, { start: at, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > this.limit) throw new AccessFault('AUTH_RATE_LIMITED');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAGE = 100;
const DEFAULT_PAGE = 25;

function limitInput(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > MAX_PAGE)
    throw new NotificationRuleError('INVALID_LIMIT');
  return Number(value);
}

function stateInput(value: unknown): DeliveryState | null {
  if (value === undefined) return null;
  const state = DELIVERY_STATES.find((s) => s === value);
  if (!state) throw new NotificationRuleError('INVALID_STATE');
  return state;
}

function cursorInput(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(value))
    throw new NotificationRuleError('INVALID_CURSOR');
  return value;
}

/**
 * Read-only queries. Communications owns delivery state only: every response
 * says so, and the booking it points at remains Booking's record.
 */
export class NotificationQueries {
  constructor(private readonly reader: NotificationReader) {}

  list(input: {
    subjectType: unknown;
    subjectRef: unknown;
    state: unknown;
    limit: unknown;
    cursor: unknown;
  }): Promise<StaffNotificationPage> {
    const hasType = input.subjectType !== undefined;
    if (hasType !== (input.subjectRef !== undefined))
      throw new NotificationRuleError('INVALID_SUBJECT');
    return this.reader.list({
      subject: hasType
        ? notificationSubject({ type: input.subjectType, ref: input.subjectRef })
        : null,
      state: stateInput(input.state),
      limit: limitInput(input.limit),
      cursor: cursorInput(input.cursor),
    });
  }

  detail(id: unknown): Promise<StaffNotificationDetail | null> {
    if (typeof id !== 'string' || !UUID.test(id))
      throw new NotificationRuleError('INVALID_NOTIFICATION_ID');
    return this.reader.detail(id.toLowerCase());
  }
}
