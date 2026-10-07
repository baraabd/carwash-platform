import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  AppError,
  AppExceptionFilter,
  CORRELATION_HEADER,
  createLogger,
  resolveCorrelationId,
} from '@carwash/service-kit';
import {
  CatalogApplicationError,
  CatalogService,
  type CommandResult,
  type RequestContext,
  type RevisionSummaryView,
  type RevisionView,
} from '../../application';

export const CATALOG_SERVICE = 'CATALOG_SERVICE';
export const CATALOG_V1 = 'internal/v1/catalog';

/** Fixed public messages. Internal exception text is never reflected. */
const MESSAGES: Readonly<Record<string, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  IDEMPOTENCY_KEY_INVALID: 'A valid Idempotency-Key header is required.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  AUTH_UNAVAILABLE: 'Authorization is temporarily unavailable.',
  NOT_FOUND: 'The requested resource was not found.',
  CATALOG_NOT_PUBLISHED: 'No catalog revision is in force.',
  IDEMPOTENCY_CONFLICT: 'The Idempotency-Key was already used for a different request.',
  DEFINITIONS_INVALID: 'The catalog definitions are inconsistent.',
  REVISION_CONFLICT: 'The catalog changed; refetch and retry with a new command.',
  EFFECTIVE_FROM_IN_PAST: 'The effective time is in the past.',
  EFFECTIVE_FROM_NOT_AFTER_PREVIOUS: 'The effective time must follow the previous revision.',
  EFFECTIVE_FROM_TOO_FAR: 'The effective time is too far in the future.',
};

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): unknown;
}

function publicError(error: CatalogApplicationError): AppError {
  return new AppError({
    status: error.status,
    code: error.code,
    message: MESSAGES[error.code] ?? 'The request could not be completed.',
    ...(error.details ? { details: error.details } : {}),
  });
}

/**
 * Catalog owner API. The transport only extracts the credential, correlation
 * and idempotency key and renders results; all decisions are in the service.
 */
@Controller(CATALOG_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'catalog' })))
export class CatalogController {
  private readonly logger = createLogger({
    service: 'catalog',
    base: { component: 'catalog-http' },
  });

  constructor(@Inject(CATALOG_SERVICE) private readonly catalog: CatalogService) {}

  private context(headers: Record<string, string | undefined>): RequestContext {
    return {
      credential: headers.authorization,
      correlationId: resolveCorrelationId(headers[CORRELATION_HEADER]),
    };
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof CatalogApplicationError) throw publicError(error);
      throw error;
    }
  }

  @Get('definitions')
  inForce(@Headers() headers: Record<string, string | undefined>): Promise<RevisionView> {
    return this.run(() => this.catalog.inForce(this.context(headers)));
  }

  @Get('definitions/:revision')
  revision(
    @Headers() headers: Record<string, string | undefined>,
    @Param('revision') revision: string,
  ): Promise<RevisionView> {
    return this.run(() => this.catalog.revision(this.context(headers), revision));
  }

  @Get('revisions')
  revisions(
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<{ revisions: RevisionSummaryView[] }> {
    return this.run(() => this.catalog.listRevisions(this.context(headers)));
  }

  @Post('definitions')
  async publish(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const context = this.context(headers);
    const result: CommandResult = await this.run(() =>
      this.catalog.publish(context, headers['idempotency-key'], body),
    );
    // correlationId/traceId come from the instrumented request context.
    this.logger.info('catalog_publish_outcome', {
      status: result.status,
      replayed: result.replayed,
      revision: typeof result.body.revision === 'number' ? result.body.revision : null,
      code: typeof result.body.code === 'string' ? result.body.code : null,
    });
    response.setHeader(CORRELATION_HEADER, context.correlationId);
    response.setHeader('idempotency-replayed', String(result.replayed));
    if (result.status >= 400) {
      const code = typeof result.body.code === 'string' ? result.body.code : 'CONFLICT';
      response.status(result.status).json({
        error: {
          code,
          message: MESSAGES[code] ?? 'The request conflicts with current state.',
          correlationId: context.correlationId,
          status: result.status,
        },
      });
      return;
    }
    response.status(result.status).json(result.body);
  }
}
