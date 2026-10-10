import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  AppError,
  CORRELATION_HEADER,
  createLogger,
  resolveCorrelationId,
} from '@carwash/service-kit';
import {
  CaseCommands,
  CaseQueries,
  RequestBudget,
  SupportApplicationError,
} from '../../application';
import { CaseRuleError } from '../../domain';
import {
  AccessFault,
  CaseConflict,
  type CaseDetail,
  type CaseEventRecord,
  type CaseRecord,
  type DecisionRecord,
  type OnBehalfOf,
  type SessionAuthority,
  type VerifiedSession,
} from '../../ports';

export const SESSION_AUTHORITY = 'SUPPORT_SESSION_AUTHORITY';
export const REQUEST_BUDGET = 'SUPPORT_REQUEST_BUDGET';
export const SUPPORT_CASES_V1 = '/internal/v1/support/cases';

type RequestHeaders = Record<string, string | undefined>;
interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
}

const ACCESS_STATUS = {
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_RATE_LIMITED: 429,
  AUTH_UNAVAILABLE: 503,
} as const;
/** Rule codes that describe the case's current state rather than a malformed request. */
const STATE_RULES = [
  'CASE_NOT_DECIDABLE',
  'CASE_NOT_AWAITING_APPROVAL',
  'SAME_PERSON_APPROVAL',
  'NOTHING_TO_EXECUTE',
];

const audit = createLogger({ service: 'support', base: { component: 'case-audit' } });

function translate(error: unknown): never {
  if (error instanceof AccessFault)
    throw new AppError({
      status: ACCESS_STATUS[error.code],
      code: error.code,
      message: error.code,
    });
  if (error instanceof SupportApplicationError)
    throw new AppError({
      status: error.status,
      code: error.code,
      message: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
  if (error instanceof CaseRuleError)
    throw new AppError({
      status: STATE_RULES.includes(error.code) ? 409 : 422,
      code: error.code,
      message: error.code,
    });
  if (error instanceof CaseConflict)
    throw new AppError({
      status: 409,
      code: error.constraint === 'ACTIVE_SUBJECT' ? 'CASE_ALREADY_OPEN' : 'CASE_CHANGED',
      message: 'CASE_CHANGED',
    });
  throw error;
}

function caseView(record: CaseRecord) {
  return {
    caseId: record.id,
    kind: record.kind,
    status: record.status,
    subject: record.subject,
    summary: record.summary,
    snapshot: record.snapshot,
    openedBy: record.openedBy,
    openedAt: record.openedAt.toISOString(),
    revision: record.revision,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function decisionView(d: DecisionRecord) {
  return {
    decisionNo: d.decisionNo,
    action: d.action,
    status: d.status,
    reason: { code: d.reasonCode, note: d.reasonNote },
    evidence: d.evidence,
    amount: d.amount,
    window: d.window,
    decidedBy: d.decidedBy,
    decidedAt: d.decidedAt.toISOString(),
    approval: d.approvedBy
      ? { by: d.approvedBy, at: d.approvedAt?.toISOString() ?? null, note: d.approvalNote }
      : null,
    owner: d.ownerRequest
      ? {
          operation: d.ownerRequest.operation,
          targetId: d.ownerRequest.targetId,
          commandKey: d.ownerRequest.key,
          httpStatus: d.ownerHttpStatus,
          code: d.ownerCode,
          state: d.ownerState,
          attempts: d.executionAttempts,
          lastSentAt: d.lastExecutedAt?.toISOString() ?? null,
        }
      : null,
  };
}

function eventView(e: CaseEventRecord) {
  return {
    at: e.occurredAt.toISOString(),
    actor: e.actorSubject,
    action: e.action,
    decisionNo: e.decisionNo,
    from: e.fromStatus,
    to: e.toStatus,
    outcome: e.outcome,
    correlationId: e.correlationId,
  };
}

function detailView(detail: CaseDetail) {
  return {
    case: caseView(detail.record),
    decisions: detail.decisions.map(decisionView),
    events: detail.events.map(eventView),
  };
}

/** What every response states: Support records decisions; owners keep the facts. */
const AUTHORITY = [
  { owner: 'support', reads: 'exception cases, decisions, reasons and audit' },
  { owner: 'billing', reads: 'payments, reconciliation and refunds' },
  { owner: 'booking', reads: 'booking status and service window' },
];

/**
 * Staff exception cases. Every route verifies the caller with Identity,
 * applies desk separation server-side and writes an audit log line without
 * free text, amounts or references.
 */
@Controller(SUPPORT_CASES_V1)
export class CasesController {
  constructor(
    private readonly commands: CaseCommands,
    private readonly queries: CaseQueries,
    @Inject(SESSION_AUTHORITY) private readonly authority: SessionAuthority,
    @Inject(REQUEST_BUDGET) private readonly budget: RequestBudget,
  ) {}

  private async caller(
    headers: RequestHeaders,
    response: HttpResponse | null,
  ): Promise<{ session: VerifiedSession; auth: OnBehalfOf }> {
    const correlationId = resolveCorrelationId(headers[CORRELATION_HEADER]);
    response?.setHeader(CORRELATION_HEADER, correlationId);
    const session = await this.authority.verify({
      authorization: headers.authorization,
      forwardedSubject: headers['x-auth-subject'],
    });
    this.budget.take(session.subject);
    return { session, auth: { credential: headers.authorization ?? '', correlationId } };
  }

  private async run<T>(
    headers: RequestHeaders,
    response: HttpResponse | null,
    operation: string,
    caseId: string | null,
    work: (session: VerifiedSession, auth: OnBehalfOf) => Promise<T>,
  ): Promise<T> {
    let subject: string | null = null;
    let correlationId: string | null = null;
    let outcome = 'ERROR';
    try {
      const { session, auth } = await this.caller(headers, response);
      subject = session.subject;
      correlationId = auth.correlationId;
      const result = await work(session, auth);
      outcome = 'OK';
      return result;
    } catch (error) {
      outcome = error instanceof Error && 'code' in error ? String(error.code) : 'ERROR';
      return translate(error);
    } finally {
      audit.info('support_case_request', { operation, caseId, subject, correlationId, outcome });
    }
  }

  @Get()
  list(@Headers() headers: RequestHeaders, @Query() query: Record<string, string | undefined>) {
    return this.run(headers, null, 'list', null, async (session) => {
      const page = await this.queries.list(session, query);
      return { authority: AUTHORITY, items: page.items.map(caseView), nextCursor: page.nextCursor };
    });
  }

  @Post()
  async open(
    @Headers() headers: RequestHeaders,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.run(headers, response, 'open', null, async (session, auth) => {
      const result = await this.commands.open(session, auth, headers['idempotency-key'], body);
      response.status(result.created ? 201 : 200);
      response.setHeader('idempotency-replayed', String(!result.created));
      return { authority: AUTHORITY, ...detailView(result.detail) };
    });
  }

  @Get(':id')
  detail(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    return this.run(headers, null, 'detail', id, async (session) => ({
      authority: AUTHORITY,
      ...detailView(await this.queries.detail(session, id)),
    }));
  }

  @Get(':id/current')
  current(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    return this.run(headers, null, 'current', id, async (session, auth) => ({
      authority: AUTHORITY,
      current: await this.queries.current(session, auth, id),
    }));
  }

  @Post(':id/decisions')
  @HttpCode(200)
  decide(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.run(headers, response, 'decide', id, async (session, auth) => ({
      authority: AUTHORITY,
      ...detailView(
        await this.commands.decide(session, auth, id, headers['idempotency-key'], body),
      ),
    }));
  }

  @Post(':id/decisions/:no/approval')
  @HttpCode(200)
  approve(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Param('no') no: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.run(headers, response, 'approve', id, async (session, auth) => ({
      authority: AUTHORITY,
      ...detailView(
        await this.commands.approve(session, auth, id, no, headers['idempotency-key'], body),
      ),
    }));
  }

  @Post(':id/decisions/:no/execution')
  @HttpCode(200)
  resend(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Param('no') no: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.run(headers, response, 'resend', id, async (session, auth) => ({
      authority: AUTHORITY,
      ...detailView(await this.commands.resend(session, auth, id, no)),
    }));
  }
}
