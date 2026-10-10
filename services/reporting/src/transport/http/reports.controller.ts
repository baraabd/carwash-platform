import { Body, Controller, Get, Headers, Inject, Post, Query, Res } from '@nestjs/common';
import { AppError, createLogger, resolveCorrelationId } from '@carwash/service-kit';
import { RequestBudget, requireReport } from '../../application/access';
import {
  ExportExpired,
  ExportIdempotencyConflict,
  ReportExports,
  ReportQueries,
  exportParameters,
} from '../../application/reports.service';
import { OperationsRuleError } from '../../domain/operations';
import { reportKind, type ReportKind } from '../../domain/reports';
import {
  AccessFault,
  type SessionAuthority,
  type VerifiedSession,
} from '../../ports/identity.ports';
import { READ_BUDGET, SESSION_AUTHORITY } from './operations.controller';

export const EXPORT_BUDGET = 'REPORTING_EXPORT_BUDGET';
export const REPORTING_REPORTS_V1 = '/internal/v1/reporting/reports';

type RequestHeaders = Record<string, string | undefined>;

/** The two response operations the export route needs; no framework type leaks in. */
interface CsvResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): void;
}

const ACCESS_STATUS = {
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_RATE_LIMITED: 429,
  AUTH_UNAVAILABLE: 503,
} as const;

const audit = createLogger({ service: 'reporting', base: { component: 'report-access-audit' } });

function translate(error: unknown): never {
  if (error instanceof AccessFault)
    throw new AppError({
      status: ACCESS_STATUS[error.code],
      code: error.code,
      message: error.code,
    });
  if (error instanceof OperationsRuleError)
    throw new AppError({ status: 422, code: error.code, message: error.code });
  if (error instanceof ExportIdempotencyConflict)
    throw new AppError({
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'IDEMPOTENCY_CONFLICT',
    });
  if (error instanceof ExportExpired)
    throw new AppError({ status: 410, code: 'EXPORT_EXPIRED', message: 'EXPORT_EXPIRED' });
  throw error;
}

/**
 * Report reads and bounded CSV exports over Reporting's own projections.
 * Every response is labelled `derived`, names its authorities and carries the
 * per-stream freshness it was computed from. Nothing here changes any owner's
 * state; the only write is the export audit (and its replay content).
 */
@Controller(REPORTING_REPORTS_V1)
export class ReportsController {
  constructor(
    private readonly queries: ReportQueries,
    private readonly exports: ReportExports,
    @Inject(SESSION_AUTHORITY) private readonly authority: SessionAuthority,
    @Inject(READ_BUDGET) private readonly budget: RequestBudget,
    @Inject(EXPORT_BUDGET) private readonly exportBudget: RequestBudget,
  ) {}

  private async authorize(
    headers: RequestHeaders,
    report: ReportKind | null,
    action: 'read' | 'export',
  ): Promise<VerifiedSession> {
    const correlationId = resolveCorrelationId(headers['x-correlation-id']);
    const session = await this.authority.verify({
      authorization: headers.authorization,
      forwardedSubject: headers['x-auth-subject'],
    });
    let allowed = false;
    try {
      (action === 'export' ? this.exportBudget : this.budget).take(session.subject);
      if (report === null) throw new OperationsRuleError('INVALID_REPORT');
      requireReport(session, report);
      allowed = true;
      return session;
    } finally {
      // Access context only: subject and decision, never the figures returned.
      audit.info('report_access', {
        report,
        action,
        subject: session.subject,
        correlationId,
        allowed,
      });
    }
  }

  @Get('revenue')
  async revenue(
    @Headers() headers: RequestHeaders,
    @Query() query: Record<string, string | undefined>,
  ) {
    try {
      await this.authorize(headers, 'revenue', 'read');
      return await this.queries.revenue({
        from: query.from,
        to: query.to,
        timezone: query.timezone,
        granularity: query.granularity,
        currency: query.currency,
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Get('operations')
  async operations(
    @Headers() headers: RequestHeaders,
    @Query() query: Record<string, string | undefined>,
  ) {
    try {
      await this.authorize(headers, 'operations', 'read');
      return await this.queries.operations({
        from: query.from,
        to: query.to,
        timezone: query.timezone,
        granularity: query.granularity,
        zoneId: query.zoneId,
      });
    } catch (error) {
      return translate(error);
    }
  }

  /**
   * Synchronous, bounded CSV export of one report. The caller must hold the
   * permission of the report it exports; the key is scoped to the caller.
   */
  @Post('exports')
  async export(
    @Headers() headers: RequestHeaders,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: CsvResponse,
  ): Promise<string> {
    try {
      const requested =
        body !== null && typeof body === 'object'
          ? (body as { report?: unknown }).report
          : undefined;
      let kind: ReportKind | null = null;
      try {
        kind = reportKind(requested);
      } catch {
        kind = null;
      }
      const session = await this.authorize(headers, kind, 'export');
      if (kind === null) throw new OperationsRuleError('INVALID_REPORT');
      const result = await this.exports.create({
        subject: session.subject,
        idempotencyKey: headers['idempotency-key'],
        parameters: exportParameters(kind, body),
      });
      const a = result.audit;
      response.status(result.created ? 201 : 200);
      response.setHeader('content-type', 'text/csv; charset=utf-8');
      response.setHeader(
        'content-disposition',
        `attachment; filename="washgo-${a.report}-${a.generatedAt.toISOString().slice(0, 10)}-${a.exportId}.csv"`,
      );
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-export-id', a.exportId);
      response.setHeader('x-export-row-count', String(a.rowCount));
      response.setHeader('x-export-generated-at', a.generatedAt.toISOString());
      response.setHeader('idempotency-replayed', String(!result.created));
      return result.csv;
    } catch (error) {
      return translate(error);
    }
  }
}
