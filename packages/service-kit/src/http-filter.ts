import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { CORRELATION_HEADER, resolveCorrelationId } from './correlation';
import { AppError, DomainError, toErrorResponse } from './errors';
import type { Logger } from './logging';

export interface ErrorHttpResponse {
  status(code: number): ErrorHttpResponse;
  json(body: unknown): unknown;
  setHeader?(name: string, value: string): void;
}

export interface ErrorHttpRequest {
  readonly headers?: Record<string, unknown>;
  readonly method?: string;
  readonly url?: string;
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger?: Logger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ErrorHttpRequest>();
    const response = http.getResponse<ErrorHttpResponse>();
    const correlationId = resolveCorrelationId(request.headers?.[CORRELATION_HEADER]);
    const body = toErrorResponse(error, correlationId);
    const log = body.error.status >= 500 ? this.logger?.error : this.logger?.warn;
    log?.call(this.logger, 'request_failed', {
      code: body.error.code,
      status: body.error.status,
      correlationId,
      method: request.method,
      path: typeof request.url === 'string' ? request.url.split('?')[0] : undefined,
      error,
      ...(error instanceof AppError && error.details ? { details: error.details } : {}),
      ...(error instanceof DomainError && error.details ? { details: error.details } : {}),
    });
    response.setHeader?.(CORRELATION_HEADER, correlationId);
    response.status(body.error.status).json(body);
  }
}
