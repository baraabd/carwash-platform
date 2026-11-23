import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  AppError,
  AppExceptionFilter,
  CORRELATION_HEADER,
  SERVICE_CLIENT_HEADER,
  SERVICE_TOKEN_HEADER,
  createLogger,
  resolveCorrelationId,
} from '@carwash/service-kit';
import {
  EntitlementService,
  MESSAGES,
  asApplicationError,
  SubscriptionApplicationError,
  SubscriptionService,
  type CommandResult,
  type RequestContext,
  type SubscriptionErrorCode,
} from '../../application';

export const SUBSCRIPTION_SERVICE = 'SUBSCRIPTION_SERVICE';
export const ENTITLEMENT_SERVICE = 'ENTITLEMENT_SERVICE';
export const SUBSCRIPTION_V1 = 'internal/v1/subscription';

type Headers_ = Record<string, string | undefined>;

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): unknown;
}

function message(code: string): string {
  return (
    (MESSAGES as Readonly<Record<string, string>>)[code] ?? 'The request could not be completed.'
  );
}

/**
 * Subscription owner API. Extracts credentials/correlation/key, renders results
 * and maps application failures to fixed public errors. No business logic here.
 * Service credentials are read from headers and never logged.
 */
@Controller(SUBSCRIPTION_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'subscription' })))
export class SubscriptionController {
  private readonly logger = createLogger({
    service: 'subscription',
    base: { component: 'subscription-http' },
  });

  constructor(
    @Inject(SUBSCRIPTION_SERVICE) private readonly subscriptions: SubscriptionService,
    @Inject(ENTITLEMENT_SERVICE) private readonly entitlements: EntitlementService,
  ) {}

  private context(headers: Headers_): RequestContext {
    return {
      credential: headers.authorization,
      correlationId: resolveCorrelationId(headers[CORRELATION_HEADER]),
      serviceClient: headers[SERVICE_CLIENT_HEADER],
      serviceToken: headers[SERVICE_TOKEN_HEADER],
    };
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (raw: unknown) {
      const error = asApplicationError(raw);
      if (error instanceof SubscriptionApplicationError)
        throw new AppError({
          status: error.status,
          code: error.code,
          message: message(error.code),
          ...(error.details ? { details: error.details } : {}),
        });
      throw error;
    }
  }

  private async send(
    event: string,
    headers: Headers_,
    response: HttpResponse,
    work: (context: RequestContext) => Promise<CommandResult>,
  ): Promise<void> {
    const context = this.context(headers);
    const result = await this.run(() => work(context));
    const code = typeof result.body.code === 'string' ? result.body.code : null;
    this.logger.info(event, { status: result.status, replayed: result.replayed, code });
    response.setHeader(CORRELATION_HEADER, context.correlationId);
    response.setHeader('idempotency-replayed', String(result.replayed));
    if (result.status >= 400) {
      const errorCode = (code ?? 'CONFLICT') as SubscriptionErrorCode;
      response.status(result.status).json({
        error: {
          code: errorCode,
          message: message(errorCode),
          correlationId: context.correlationId,
          status: result.status,
        },
      });
      return;
    }
    response.status(result.status).json(result.body);
  }

  // ---------------------------------------------------------------- plans

  @Get('plans')
  plans(@Headers() headers: Headers_) {
    return this.run(() => this.subscriptions.listPlans(this.context(headers)));
  }

  @Get('plans/:code')
  plan(@Headers() headers: Headers_, @Param('code') code: string) {
    return this.run(() => this.subscriptions.getPlan(this.context(headers), code));
  }

  @Post('plans/:code/revisions')
  publish(
    @Headers() headers: Headers_,
    @Param('code') code: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_plan_publish_outcome', headers, response, (context) =>
      this.subscriptions.publishRevision(context, headers['idempotency-key'], code, body),
    );
  }

  @Get('offers')
  offers(@Headers() headers: Headers_) {
    return this.run(() => this.subscriptions.offers(this.context(headers)));
  }

  // -------------------------------------------------------- subscriptions

  @Post('subscriptions')
  request(@Headers() headers: Headers_, @Body() body: unknown, @Res() response: HttpResponse) {
    return this.send('subscription_request_outcome', headers, response, (context) =>
      this.subscriptions.request(context, headers['idempotency-key'], body),
    );
  }

  @Get('subscriptions')
  mine(@Headers() headers: Headers_) {
    return this.run(() => this.subscriptions.mySubscriptions(this.context(headers)));
  }

  @Get('subscriptions/:id')
  subscription(@Headers() headers: Headers_, @Param('id') id: string) {
    return this.run(() => this.subscriptions.getSubscription(this.context(headers), id));
  }

  @Get('subscriptions/:id/ledger')
  ledger(@Headers() headers: Headers_, @Param('id') id: string) {
    return this.run(() => this.entitlements.ledger(this.context(headers), id));
  }

  @Get('customers/:subject/subscriptions')
  customer(@Headers() headers: Headers_, @Param('subject') subject: string) {
    return this.run(() => this.subscriptions.customerSubscriptions(this.context(headers), subject));
  }

  @Post('subscriptions/:id/activate')
  activate(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_activate_outcome', headers, response, (context) =>
      this.subscriptions.activate(context, headers['idempotency-key'], id, body),
    );
  }

  @Post('subscriptions/:id/renew')
  renew(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_renew_outcome', headers, response, (context) =>
      this.subscriptions.renew(context, headers['idempotency-key'], id, body),
    );
  }

  @Post('subscriptions/:id/freeze')
  freeze(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_freeze_outcome', headers, response, (context) =>
      this.subscriptions.freeze(context, headers['idempotency-key'], id, body),
    );
  }

  @Post('subscriptions/:id/unfreeze')
  unfreeze(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_unfreeze_outcome', headers, response, (context) =>
      this.subscriptions.unfreeze(context, headers['idempotency-key'], id, body),
    );
  }

  @Post('subscriptions/:id/cancel')
  cancel(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_cancel_outcome', headers, response, (context) =>
      this.subscriptions.cancel(context, headers['idempotency-key'], id, body),
    );
  }

  // --------------------------------------------------------- entitlements

  @Post('reservations')
  reserve(@Headers() headers: Headers_, @Body() body: unknown, @Res() response: HttpResponse) {
    return this.send('subscription_reserve_outcome', headers, response, (context) =>
      this.entitlements.reserve(context, body),
    );
  }

  @Get('reservations')
  forBooking(@Headers() headers: Headers_, @Query('bookingId') bookingId: string | undefined) {
    return this.run(() => this.entitlements.forBooking(this.context(headers), bookingId));
  }

  @Post('reservations/:id/commit')
  commit(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_commit_outcome', headers, response, (context) =>
      this.entitlements.complete(context, id, 'COMMIT', body),
    );
  }

  @Post('reservations/:id/release')
  release(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_release_outcome', headers, response, (context) =>
      this.entitlements.complete(context, id, 'RELEASE', body),
    );
  }

  @Post('reservations/:id/reverse')
  reverse(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_reverse_outcome', headers, response, (context) =>
      this.entitlements.reverse(context, headers['idempotency-key'], id, body),
    );
  }
}
