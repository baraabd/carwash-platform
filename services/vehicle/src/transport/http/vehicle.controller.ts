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
} from '@nestjs/common';
import { AppError, resolveCorrelationId, traceHeaders } from '@carwash/service-kit';
import {
  ApplicationError,
  VehicleApplication,
  type ApplicationErrorCode,
  type Outcome,
  type RequestContext,
} from '../../application';
import { VehicleDomainError } from '../../domain';

export const VEHICLE_V1 = '/internal/v1/vehicle';
export const VEHICLE_APPLICATION = 'VEHICLE_APPLICATION';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface HttpRequest {
  readonly headers: Record<string, string | string[] | undefined>;
}

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
}

const APPLICATION_STATUS: Readonly<Record<ApplicationErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  IDENTITY_UNAVAILABLE: 503,
  VEHICLE_NOT_FOUND: 404,
  REVISION_REQUIRED: 428,
  REVISION_CONFLICT: 412,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  IDEMPOTENCY_KEY_INVALID: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
};

const DOMAIN_STATUS: Readonly<Record<string, number>> = {
  VEHICLE_LIMIT_REACHED: 409,
  VEHICLE_ARCHIVED: 409,
};

/** Maps inner-layer refusals to the shared error envelope without echoing input. */
function toHttpError(error: unknown): unknown {
  if (error instanceof ApplicationError) {
    return new AppError({
      status: APPLICATION_STATUS[error.code],
      code: error.code,
      message: error.code,
    });
  }
  if (error instanceof VehicleDomainError) {
    return new AppError({
      status: DOMAIN_STATUS[error.code] ?? 422,
      code: error.code,
      message: error.field ? `${error.code}:${error.field}` : error.code,
    });
  }
  return error;
}

function header(request: HttpRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/** `If-Match: "<revision>"`. Anything else is treated as a missing precondition. */
function expectedRevision(request: HttpRequest): number | null {
  const match = /^"([1-9][0-9]{0,8})"$/.exec(header(request, 'if-match') ?? '');
  return match?.[1] ? Number(match[1]) : null;
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
  if (!UUID.test(raw)) throw new ApplicationError('VEHICLE_NOT_FOUND');
  return raw.toLowerCase();
}

/** Vehicle HTTP adapter: translation only. Every response is private and uncached. */
@Controller(VEHICLE_V1)
export class VehicleController {
  constructor(@Inject(VEHICLE_APPLICATION) private readonly app: VehicleApplication) {}

  private async run<T>(response: HttpResponse, work: () => Promise<T>): Promise<T> {
    response.setHeader('cache-control', 'no-store');
    try {
      return await work();
    } catch (error) {
      throw toHttpError(error);
    }
  }

  private async mutation<T extends { readonly revision: number }>(
    response: HttpResponse,
    work: () => Promise<Outcome<T>>,
  ): Promise<T> {
    const outcome = await this.run(response, work);
    response.status(outcome.status);
    response.setHeader('etag', `"${outcome.body.revision}"`);
    if (outcome.replayed) response.setHeader('idempotent-replayed', 'true');
    return outcome.body;
  }

  @Get('mine')
  async mine(
    @Req() request: HttpRequest,
    @Query('includeArchived') includeArchived: string | undefined,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const items = await this.run(response, () =>
      this.app.listVehicles(requestContext(request), includeArchived === 'true'),
    );
    return { items };
  }

  @Post()
  create(
    @Req() request: HttpRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.mutation(response, () =>
      this.app.createVehicle(requestContext(request), idempotencyKey(request), body),
    );
  }

  @Get(':vehicleId')
  async vehicle(
    @Req() request: HttpRequest,
    @Param('vehicleId') id: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const view = await this.run(response, () =>
      this.app.getVehicle(requestContext(request), vehicleId(id)),
    );
    response.setHeader('etag', `"${view.revision}"`);
    return view;
  }

  @Patch(':vehicleId')
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

  @Post(':vehicleId/archive')
  @HttpCode(200)
  archive(
    @Req() request: HttpRequest,
    @Param('vehicleId') id: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.mutation(response, () =>
      this.app.archiveVehicle(requestContext(request), vehicleId(id), expectedRevision(request)),
    );
  }
}
