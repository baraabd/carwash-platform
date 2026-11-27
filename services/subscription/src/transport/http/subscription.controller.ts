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
import { CanonicalSubscriptionService } from '../../application/canonical-subscription.service';

export const SUBSCRIPTION_SERVICE = 'SUBSCRIPTION_SERVICE';
export const ENTITLEMENT_SERVICE = 'ENTITLEMENT_SERVICE';
export const CANONICAL_SUBSCRIPTION_SERVICE = 'CANONICAL_SUBSCRIPTION_SERVICE';
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
    @Inject(CANONICAL_SUBSCRIPTION_SERVICE)
    private readonly canonical: CanonicalSubscriptionService,
  ) {}

  private context(headers: Headers_): RequestContext {
    return {
      credential: headers.authorization,
      correlationId: resolveCorrelationId(headers[CORRELATION_HEADER]),
      serviceClient: headers[SERVICE_CLIENT_HEADER],
      serviceToken: headers[SERVICE_TOKEN_HEADER],
      bearerPresent: headers.authorization !== undefined || headers.cookie !== undefined,
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

  @Get('administration/plans')
  plans(@Headers() headers: Headers_) {
    return this.run(() => this.subscriptions.listPlans(this.context(headers)));
  }

  @Get('administration/plans/:code')
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

  @Get('plans')
  canonicalPlans(@Query() query: { limit?: unknown; cursor?: unknown }) {
    return this.run(() => this.canonical.listPlans(query));
  }
  @Get('plans/:planId')
  canonicalPlan(@Param('planId') id: string) {
    return this.run(() => this.canonical.getPlan(id));
  }
  @Post('plans/:planId/versions')
  canonicalPublish(
    @Headers() headers: Headers_,
    @Param('planId') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_canonical_plan_publish', headers, response, (context) =>
      this.canonical.publish(context, headers['idempotency-key'], id, body),
    );
  }
  @Post('purchases')
  purchase(@Headers() headers: Headers_, @Body() body: unknown, @Res() response: HttpResponse) {
    return this.send('subscription_purchase_create', headers, response, (context) =>
      this.canonical.createPurchase(context, headers['idempotency-key'], body),
    );
  }
  @Post('subscriptions/:id/renewals')
  createRenewal(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_renewal_purchase', headers, response, (context) =>
      this.canonical.createRenewal(context, headers['idempotency-key'], id, body),
    );
  }
  @Get('purchases/by-request/:idempotencyKey')
  purchaseByRequest(@Headers() headers: Headers_, @Param('idempotencyKey') key: string) {
    return this.run(() => this.canonical.getPurchaseByRequest(this.context(headers), key));
  }
  @Get('purchases/:id')
  getPurchase(@Headers() headers: Headers_, @Param('id') id: string) {
    return this.run(() => this.canonical.getPurchase(this.context(headers), id));
  }
  @Post('subscriptions/:id/eligibility')
  @HttpCode(200)
  eligibility(@Headers() headers: Headers_, @Param('id') id: string, @Body() body: unknown) {
    return this.run(() => this.canonical.eligibility(this.context(headers), id, body));
  }

  @Post('subscriptions')
  request(@Headers() headers: Headers_, @Body() body: unknown, @Res() response: HttpResponse) {
    return this.send('subscription_request_outcome', headers, response, (context) =>
      this.subscriptions.request(context, headers['idempotency-key'], body),
    );
  }

  @Get('legacy/subscriptions')
  mine(@Headers() headers: Headers_) {
    return this.run(() => this.subscriptions.mySubscriptions(this.context(headers)));
  }

  @Get('legacy/subscriptions/:id')
  subscription(@Headers() headers: Headers_, @Param('id') id: string) {
    return this.run(() => this.subscriptions.getSubscription(this.context(headers), id));
  }

  @Get('subscriptions')
  canonicalMine(
    @Headers() headers: Headers_,
    @Query() query: { limit?: unknown; cursor?: unknown },
  ) {
    return this.run(() => this.canonical.listSubscriptions(this.context(headers), query));
  }
  @Get('subscriptions/:id')
  canonicalSubscription(@Headers() headers: Headers_, @Param('id') id: string) {
    return this.run(() => this.canonical.getSubscription(this.context(headers), id));
  }

  @Post('subscriptions/:id/changes')
  canonicalChange(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_change_requested', headers, response, (context) =>
      this.canonical.requestChange(context, headers['idempotency-key'], id, body),
    );
  }
  @Get('administration/changes')
  pendingChanges(@Headers() headers: Headers_) {
    return this.run(() => this.canonical.pendingChanges(this.context(headers)));
  }
  @Get('administration/funding-recovery')
  fundingRecoveries(@Headers() headers: Headers_) {
    return this.run(() => this.canonical.fundingRecoveries(this.context(headers)));
  }
  @Post('administration/funding-recovery/:id/retry')
  retryFundingRelease(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_funding_release_retried', headers, response, (context) =>
      this.canonical.retryFundingRelease(context, headers['idempotency-key'], id, body),
    );
  }
  @Post('subscriptions/:id/changes/:changeId/decision')
  decideChange(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Param('changeId') changeId: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_change_decided', headers, response, (context) =>
      this.canonical.decideChange(context, headers['idempotency-key'], id, changeId, body),
    );
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

  @Post('entitlement-reservations')
  reserveCanonical(
    @Headers() headers: Headers_,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_canonical_reserve', headers, response, (context) =>
      this.entitlements.reserveCanonical(context, headers['idempotency-key'], body),
    );
  }

  @Post('entitlement-reservations/:id/resolution')
  resolveCanonical(
    @Headers() headers: Headers_,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ) {
    return this.send('subscription_canonical_resolution', headers, response, (context) =>
      this.entitlements.resolveCanonical(context, headers['idempotency-key'], id, body),
    );
  }

  @Get('entitlement-reservations/:id')
  getCanonical(@Headers() headers: Headers_, @Param('id') id: string) {
    return this.run(() => this.entitlements.getCanonical(this.context(headers), id));
  }

  @Get('entitlement-reservations')
  findCanonical(@Headers() headers: Headers_, @Query('bookingId') bookingId: string | undefined) {
    return this.run(() => this.entitlements.findCanonical(this.context(headers), bookingId));
  }

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
