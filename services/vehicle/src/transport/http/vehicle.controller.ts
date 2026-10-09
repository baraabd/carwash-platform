import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { createLogger, resolveCorrelationId, traceHeaders } from '@carwash/service-kit';
import {
  ApplicationError,
  VehicleApplication,
  type Outcome,
  type RequestContext,
} from '../../application';
import { ContractExceptionFilter } from './contract-errors';

/** vehicle.v1 prefix and routes (packages/contracts vehicle/v1.ts). */
export const VEHICLE_V1 = '/internal/v1/vehicle';
export const VEHICLE_APPLICATION = 'VEHICLE_APPLICATION';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REVISION = 2_147_483_647;

interface HttpRequest {
  readonly headers: Record<string, string | string[] | undefined>;
}

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
}

function header(request: HttpRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * `If-Match: "<revision>"`, parsed like the contract's parseIfMatch. Absent is a
 * missing precondition (REVISION_REQUIRED); anything malformed is refused.
 */
function expectedRevision(request: HttpRequest): number | null {
  const raw = header(request, 'if-match');
  if (raw === undefined) return null;
  const match = /^"([1-9][0-9]{0,9})"$/.exec(raw.trim());
  const value = match?.[1] ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(value) || value > MAX_REVISION) {
    throw new ApplicationError('REQUEST_INVALID', null, 'header.if-match');
  }
  return value;
}

function idempotencyKey(request: HttpRequest): string | null {
  return header(request, 'idempotency-key') ?? null;
}

function requestContext(request: HttpRequest): RequestContext {
  const correlationId = resolveCorrelationId(header(request, 'x-correlation-id'));
  const optional = (name: string, value: string | undefined) =>
    value === undefined ? {} : { [name]: value };
  return {
    correlationId,
    traceParent: traceHeaders()['traceparent'] ?? null,
    credentials: {
      correlationId,
      ...optional('authorization', header(request, 'authorization')),
      ...optional('cookie', header(request, 'cookie')),
      ...optional('origin', header(request, 'origin')),
      ...optional('secFetchSite', header(request, 'sec-fetch-site')),
      ...optional('csrfToken', header(request, 'x-csrf-token')),
    },
  };
}

function vehicleId(raw: string): string {
  // A malformed id cannot name anything this owner has.
  if (!UUID.test(raw)) throw new ApplicationError('NOT_FOUND', 'VEHICLE_NOT_FOUND');
  return raw.toLowerCase();
}

function queryValue(raw: unknown, field: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw new ApplicationError('REQUEST_INVALID', null, field);
  return raw;
}

/** Vehicle HTTP adapter: translation only. Every response is private and uncached. */
@Controller(VEHICLE_V1)
@UseFilters(new ContractExceptionFilter(createLogger({ service: 'vehicle' })))
export class VehicleController {
  constructor(@Inject(VEHICLE_APPLICATION) private readonly app: VehicleApplication) {}

  private async mutation<T extends { readonly revision: number }>(
    response: HttpResponse,
    work: () => Promise<Outcome<T>>,
  ): Promise<T> {
    response.setHeader('cache-control', 'no-store');
    const outcome = await work();
    response.status(outcome.status);
    response.setHeader('etag', `"${outcome.body.revision}"`);
    if (outcome.replayed) response.setHeader('idempotent-replayed', 'true');
    return outcome.body;
  }

  /** listMine: GET /mine?limit&cursor. */
  @Get('mine')
  mine(
    @Req() request: HttpRequest,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    response.setHeader('cache-control', 'no-store');
    const unknown = Object.keys(query).find((name) => name !== 'limit' && name !== 'cursor');
    if (unknown !== undefined) {
      throw new ApplicationError('REQUEST_INVALID', null, `query.${unknown}`);
    }
    return this.app.listVehicles(requestContext(request), {
      limit: queryValue(query.limit, 'query.limit'),
      cursor: queryValue(query.cursor, 'query.cursor'),
    });
  }

  /** create: POST /mine. */
  @Post('mine')
  create(
    @Req() request: HttpRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.mutation(response, () =>
      this.app.createVehicle(requestContext(request), idempotencyKey(request), body),
    );
  }

  /** update: PATCH /mine/:vehicleId. */
  @Patch('mine/:vehicleId')
  update(
    @Req() request: HttpRequest,
    @Param('vehicleId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.mutation(response, () =>
      this.app.updateVehicle(
        requestContext(request),
        vehicleId(id),
        expectedRevision(request),
        idempotencyKey(request),
        body,
      ),
    );
  }

  /** archive: POST /mine/:vehicleId/archive. */
  @Post('mine/:vehicleId/archive')
  @HttpCode(200)
  archive(
    @Req() request: HttpRequest,
    @Param('vehicleId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.mutation(response, () =>
      this.app.archiveVehicle(
        requestContext(request),
        vehicleId(id),
        expectedRevision(request),
        idempotencyKey(request),
        body,
      ),
    );
  }

  /**
   * resolveVehicleSnapshot: POST /vehicle-snapshots/resolve
   * (service:vehicle.snapshot.resolve). Deny-by-default until workload
   * identity (P01-E5) provides a verifier; see NoWorkloadIdentity.
   */
  @Post('vehicle-snapshots/resolve')
  @HttpCode(200)
  resolve(
    @Req() request: HttpRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    response.setHeader('cache-control', 'no-store');
    return this.app.resolveVehicleSnapshot(requestContext(request), body);
  }
}