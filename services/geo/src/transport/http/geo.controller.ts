import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { AppError } from '@carwash/service-kit';
import { ApplicationError, GeoApplication, type ApplicationErrorCode } from '../../application';
import { GeoDomainError } from '../../domain';
import { FixedWindowRateLimit } from './rate-limit';

export const GEO_V1 = '/internal/v1/geo';
export const GEO_APPLICATION = 'GEO_APPLICATION';
export const GEO_RATE_LIMIT = 'GEO_RATE_LIMIT';

interface HttpRequest {
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

interface HttpResponse {
  setHeader(name: string, value: string): void;
}

const APPLICATION_STATUS: Readonly<Record<ApplicationErrorCode, number>> = {
  ZONE_NOT_FOUND: 404,
  REVISION_CONFLICT: 412,
  RATE_LIMITED: 429,
};

function toHttpError(error: unknown): unknown {
  if (error instanceof ApplicationError) {
    return new AppError({
      status: APPLICATION_STATUS[error.code],
      code: error.code,
      message: error.code,
    });
  }
  if (error instanceof GeoDomainError) {
    return new AppError({
      status: 422,
      code: error.code,
      message: error.field ? `${error.code}:${error.field}` : error.code,
    });
  }
  return error;
}

/**
 * Geo HTTP adapter. Serviceability is guest-safe: it needs no session, takes
 * one coordinate, stores nothing and returns only zone references. It is rate
 * limited per client address. Zone writes have no HTTP route (operator CLI only).
 */
@Controller(GEO_V1)
export class GeoController {
  constructor(
    @Inject(GEO_APPLICATION) private readonly app: GeoApplication,
    @Inject(GEO_RATE_LIMIT) private readonly limit: FixedWindowRateLimit,
  ) {}

  @Post('serviceability')
  @HttpCode(200)
  async serviceability(
    @Req() request: HttpRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    response.setHeader('cache-control', 'no-store');
    try {
      if (!this.limit.take(request.ip ?? request.socket?.remoteAddress ?? 'unknown')) {
        throw new ApplicationError('RATE_LIMITED');
      }
      return await this.app.serviceability(body);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Get('service-zones')
  async zones(@Res({ passthrough: true }) response: HttpResponse) {
    response.setHeader('cache-control', 'no-store');
    return { items: await this.app.listActiveZones() };
  }
}
