import { Controller, Get, Headers, Inject, Param, Query } from '@nestjs/common';
import { AppError, createLogger, resolveCorrelationId } from '@carwash/service-kit';
import {
  NotificationQueries,
  ReadBudget,
  requireNotificationRead,
} from '../../application/notification-reads';
import { NotificationRuleError } from '../../domain/notification';
import { AccessFault, type SessionAuthority } from '../../ports/identity.ports';
import type { StaffAttemptView, StaffNotificationView } from '../../ports/notification.ports';

export const SESSION_AUTHORITY = 'COMMUNICATIONS_SESSION_AUTHORITY';
export const READ_BUDGET = 'COMMUNICATIONS_READ_BUDGET';
export const COMMUNICATIONS_NOTIFICATIONS_V1 = '/internal/v1/communications/notifications';

type RequestHeaders = Record<string, string | undefined>;

const ACCESS_STATUS = {
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_RATE_LIMITED: 429,
  AUTH_UNAVAILABLE: 503,
} as const;
const audit = createLogger({
  service: 'communications',
  base: { component: 'notification-read-audit' },
});

function translate(error: unknown): never {
  if (error instanceof AccessFault)
    throw new AppError({
      status: ACCESS_STATUS[error.code],
      code: error.code,
      message: error.code,
    });
  if (error instanceof NotificationRuleError)
    throw new AppError({ status: 422, code: error.code, message: error.code });
  throw error;
}

function view(n: StaffNotificationView) {
  return {
    id: n.id,
    sourceService: n.sourceService,
    subject: n.subject,
    channel: n.channel,
    templateKey: n.templateKey,
    templateVersion: n.templateVersion,
    state: n.state,
    attemptCount: n.attemptCount,
    nextAttemptAt: n.nextAttemptAt?.toISOString() ?? null,
    expiresAt: n.expiresAt.toISOString(),
    lastErrorCode: n.lastErrorCode,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

function attemptView(a: StaffAttemptView) {
  return {
    attemptNo: a.attemptNo,
    startedAt: a.startedAt.toISOString(),
    finishedAt: a.finishedAt?.toISOString() ?? null,
    outcome: a.outcome,
    errorCode: a.errorCode,
  };
}

/** What every response states: delivery facts only, owners keep their records. */
const AUTHORITY = [
  { owner: 'communications', reads: 'notification intent and delivery state' },
  { owner: 'booking', reads: 'the booking a notification is about' },
];

/**
 * Read-only staff visibility of notification delivery. No route here sends,
 * cancels or retries anything, and nothing returns a recipient or content.
 */
@Controller(COMMUNICATIONS_NOTIFICATIONS_V1)
export class NotificationsController {
  constructor(
    private readonly queries: NotificationQueries,
    @Inject(SESSION_AUTHORITY) private readonly authority: SessionAuthority,
    @Inject(READ_BUDGET) private readonly budget: ReadBudget,
  ) {}

  private async authorize(headers: RequestHeaders, read: string): Promise<void> {
    const correlationId = resolveCorrelationId(headers['x-correlation-id']);
    const session = await this.authority.verify({
      authorization: headers.authorization,
      forwardedSubject: headers['x-auth-subject'],
    });
    let allowed = false;
    try {
      this.budget.take(session.subject);
      requireNotificationRead(session);
      allowed = true;
    } finally {
      audit.info('notification_read', { read, subject: session.subject, correlationId, allowed });
    }
  }

  @Get()
  async list(
    @Headers() headers: RequestHeaders,
    @Query() query: Record<string, string | undefined>,
  ) {
    try {
      await this.authorize(headers, 'list');
      const page = await this.queries.list({
        subjectType: query.subjectType,
        subjectRef: query.subjectRef,
        state: query.state,
        limit: query.limit,
        cursor: query.cursor,
      });
      return { authority: AUTHORITY, items: page.items.map(view), nextCursor: page.nextCursor };
    } catch (error) {
      return translate(error);
    }
  }

  @Get(':id')
  async detail(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    try {
      await this.authorize(headers, 'detail');
      const item = await this.queries.detail(id);
      if (!item) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'NOT_FOUND' });
      return {
        authority: AUTHORITY,
        item: { ...view(item), attempts: item.attempts.map(attemptView) },
      };
    } catch (error) {
      return translate(error);
    }
  }
}
