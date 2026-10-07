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
  CustomerApplication,
  type ApplicationErrorCode,
  type Outcome,
  type RequestContext,
} from '../../application';
import { CustomerDomainError } from '../../domain';

export const CUSTOMER_V1 = '/internal/v1/customer';
export const CUSTOMER_APPLICATION = 'CUSTOMER_APPLICATION';
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
  PROFILE_NOT_FOUND: 404,
  ADDRESS_NOT_FOUND: 404,
  REVISION_REQUIRED: 428,
  REVISION_CONFLICT: 412,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  IDEMPOTENCY_KEY_INVALID: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
};

const DOMAIN_STATUS: Readonly<Record<string, number>> = {
  ADDRESS_LIMIT_REACHED: 409,
  ADDRESS_ARCHIVED: 409,
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
  if (error instanceof CustomerDomainError) {
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

function addressId(raw: string): string {
  // A malformed id cannot name anything this customer owns.
  if (!UUID.test(raw)) throw new ApplicationError('ADDRESS_NOT_FOUND');
  return raw.toLowerCase();
}

/**
 * Customer HTTP adapter. It translates HTTP into application calls and back;
 * no business rule lives here. Every response is private and never cached.
 */
@Controller(CUSTOMER_V1)
export class CustomerController {
  constructor(@Inject(CUSTOMER_APPLICATION) private readonly app: CustomerApplication) {}

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

  @Post('me')
  bootstrap(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    return this.mutation(response, () => this.app.bootstrapProfile(requestContext(request)));
  }

  @Get('me')
  async profile(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    const view = await this.run(response, () => this.app.getProfile(requestContext(request)));
    response.setHeader('etag', `"${view.revision}"`);
    return view;
  }

  @Patch('me')
  updateProfile(
    @Req() request: HttpRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.mutation(response, () =>
      this.app.updateProfile(
        requestContext(request),
        expectedRevision(request),
        idempotencyKey(request),
        body,
      ),
    );
  }

  @Get('me/addresses')
  async addresses(
    @Req() request: HttpRequest,
    @Query('includeArchived') includeArchived: string | undefined,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const items = await this.run(response, () =>
      this.app.listAddresses(requestContext(request), includeArchived === 'true'),
    );
    return { items };
  }

  @Post('me/addresses')
  createAddress(
    @Req() request: HttpRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.mutation(response, () =>
      this.app.createAddress(requestContext(request), idempotencyKey(request), body),
    );
  }

  @Get('me/addresses/:addressId')
  async address(
    @Req() request: HttpRequest,
    @Param('addressId') id: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const view = await this.run(response, () =>
      this.app.getAddress(requestContext(request), addressId(id)),
    );
    response.setHeader('etag', `"${view.revision}"`);
    return view;
  }

  @Patch('me/addresses/:addressId')
  updateAddress(
    @Req() request: HttpRequest,
    @Param('addressId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.mutation(response, () =>
      this.app.updateAddress(
        requestContext(request),
        addressId(id),
        expectedRevision(request),
        idempotencyKey(request),
        body,
      ),
    );
  }

  @Post('me/addresses/:addressId/archive')
  @HttpCode(200)
  archiveAddress(
    @Req() request: HttpRequest,
    @Param('addressId') id: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    return this.mutation(response, () =>
      this.app.archiveAddress(requestContext(request), addressId(id), expectedRevision(request)),
    );
  }
}
