import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApplicationError,
  GeoApplication,
  ServiceabilityApplication,
  type DecisionView,
  type ServiceZoneView,
  type ValidationView,
} from '../../application';
import type { WorkloadAuthenticator } from '../../ports';
import { requestIds, type IdentifiedRequest } from './error-envelope';
import { FixedWindowRateLimit } from './rate-limit';

export const GEO_V1 = '/internal/v1/geo';
export const GEO_APPLICATION = 'GEO_APPLICATION';
export const SERVICEABILITY_APPLICATION = 'SERVICEABILITY_APPLICATION';
export const GEO_RATE_LIMIT = 'GEO_RATE_LIMIT';
export const WORKLOAD_AUTHENTICATOR = 'WORKLOAD_AUTHENTICATOR';

interface HttpRequest extends IdentifiedRequest {
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

interface HttpResponse {
  setHeader(name: string, value: string): void;
}

function single(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * geo.v1 HTTP adapter (prefix /internal/v1/geo).
 *
 * - GET  /service-zones             public, not personalized, no geometry.
 * - POST /serviceability            principal: a CURRENT account or guest
 *   session with bookings.create:self. Rate limited per originating address
 *   (explicitly trusted proxies only) BEFORE Identity is contacted.
 * - POST /serviceability/validate   service:geo.serviceability.validate. Closed
 *   until workload identity (P01-E5) exists: every caller is refused.
 *
 * Zone writes have no HTTP route (operator CLI only).
 */
@Controller(GEO_V1)
export class GeoController {
  constructor(
    @Inject(GEO_APPLICATION) private readonly zones: GeoApplication,
    @Inject(SERVICEABILITY_APPLICATION) private readonly serviceability: ServiceabilityApplication,
    @Inject(GEO_RATE_LIMIT) private readonly limit: FixedWindowRateLimit,
    @Inject(WORKLOAD_AUTHENTICATOR) private readonly workloads: WorkloadAuthenticator,
  ) {}

  @Post('serviceability')
  @HttpCode(200)
  async check(
    @Req() request: HttpRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<DecisionView> {
    response.setHeader('cache-control', 'no-store');
    if (!this.limit.take(request.ip ?? request.socket?.remoteAddress ?? 'unknown')) {
      throw new ApplicationError('RATE_LIMITED', this.limit.retryAfterMs());
    }
    return this.serviceability.checkServiceability(
      {
        authorization: single(request.headers.authorization),
        cookie: single(request.headers.cookie),
        correlationId: requestIds(request).correlationId,
      },
      body,
    );
  }

  @Post('serviceability/validate')
  @HttpCode(200)
  async validate(
    @Req() request: HttpRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<ValidationView> {
    response.setHeader('cache-control', 'no-store');
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(request.headers)) headers[name] = single(value);
    const actor = await this.workloads.authenticate(headers);
    return this.serviceability.validate(actor, body);
  }

  @Get('service-zones')
  async list(
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<{ items: ServiceZoneView[] }> {
    response.setHeader('cache-control', 'no-store');
    return { items: await this.zones.listActiveZones() };
  }
}
