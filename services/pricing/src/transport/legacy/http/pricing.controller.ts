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
  PricingApplicationError,
  PricingService,
  PromotionService,
  type CommandResult,
  type RequestContext,
  type ServiceRequestContext,
} from '../../../application/legacy';

export const LEGACY_PRICING_SERVICE = 'LEGACY_PRICING_SERVICE';
export const PROMOTION_SERVICE = 'PROMOTION_SERVICE';
export const PRICING_LEGACY_OWNER_PREFIX = 'internal/v1/pricing';

/** Fixed public messages. Internal exception text is never reflected. */
const MESSAGES: Readonly<Record<string, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  IDEMPOTENCY_KEY_INVALID: 'A valid Idempotency-Key header is required.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  AUTH_UNAVAILABLE: 'Authorization is temporarily unavailable.',
  NOT_FOUND: 'The requested resource was not found.',
  PRICES_NOT_PUBLISHED: 'No price version is in force.',
  IDEMPOTENCY_CONFLICT: 'The Idempotency-Key was already used for a different request.',
  RATES_INVALID: 'The rates do not match the catalog revision or policy.',
  CATALOG_REVISION_UNKNOWN: 'The catalog revision does not exist.',
  CATALOG_REVISION_MISMATCH: 'The catalog changed; refetch it and request a new quote.',
  SELECTION_INVALID: 'The selected services are not compatible.',
  AMOUNT_LIMIT_EXCEEDED: 'The amount exceeds the accepted limit.',
  QUOTE_EXPIRED: 'The quote has expired; request a new quote.',
  QUOTE_SELECTION_MISMATCH: 'The quote was issued for a different selection.',
  POLICY_UNAVAILABLE: 'Pricing policy is not available.',
  UPSTREAM_UNAVAILABLE: 'A required upstream service is unavailable.',
  VERSION_CONFLICT: 'Prices changed; refetch and retry with a new command.',
  EFFECTIVE_FROM_IN_PAST: 'The effective time is in the past.',
  EFFECTIVE_FROM_NOT_AFTER_PREVIOUS: 'The effective time must follow the previous version.',
  EFFECTIVE_FROM_TOO_FAR: 'The effective time is too far in the future.',
  PRICE_PRECEDES_CATALOG: 'Prices cannot take effect before their catalog revision.',
  SERVICE_AUTH_REQUIRED: 'A service credential with the required scope is required.',
  PROMOTION_TERMS_INVALID: 'The promotion terms are invalid.',
  COUPON_CODE_TAKEN: 'The coupon code is already used by another promotion.',
  COUPON_NOT_VALID: 'The coupon is not valid.',
  PROMOTION_NOT_APPLICABLE: 'The coupon does not apply to this selection.',
  PROMOTION_EXHAUSTED: 'The promotion has no uses left.',
  CUSTOMER_LIMIT_REACHED: 'The promotion was already used the maximum number of times.',
  QUOTE_HAS_NO_PROMOTION: 'The quote carries no promotion.',
  QUOTE_ALREADY_REDEEMED: 'The quote was already redeemed.',
  REDEMPTION_CONFLICT: 'The booking already redeemed this promotion with another quote.',
  BOOKING_ALREADY_REDEEMED: 'The booking already holds a promotion.',
  REDEMPTION_NOT_RESERVED: 'The redemption is no longer reserved.',
  PROMOTION_INACTIVE: 'The promotion is no longer active.',
  REVISION_CONFLICT: 'The promotion changed; refetch and retry with a new command.',
};

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): unknown;
}

/**
 * Pricing owner API. Extracts credential/correlation/key, renders results and
 * maps application failures to fixed public errors. No business logic here.
 */
@Controller(PRICING_LEGACY_OWNER_PREFIX)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'pricing' })))
export class LegacyPricingController {
  private readonly logger = createLogger({
    service: 'pricing',
    base: { component: 'pricing-http' },
  });

  constructor(
    @Inject(LEGACY_PRICING_SERVICE) private readonly pricing: PricingService,
    @Inject(PROMOTION_SERVICE) private readonly promotions: PromotionService,
  ) {}

  private context(headers: Record<string, string | undefined>): ServiceRequestContext {
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
    } catch (error: unknown) {
      if (error instanceof PricingApplicationError)
        throw new AppError({
          status: error.status,
          code: error.code,
          message: MESSAGES[error.code] ?? 'The request could not be completed.',
          ...(error.details ? { details: error.details } : {}),
        });
      throw error;
    }
  }

  private send(
    event: string,
    context: RequestContext,
    result: CommandResult,
    response: HttpResponse,
  ): void {
    this.logger.info(event, {
      status: result.status,
      replayed: result.replayed,
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

  @Get('legacy/prices')
  inForce(@Headers() headers: Record<string, string | undefined>) {
    return this.run(() => this.pricing.versionInForce(this.context(headers)));
  }

  @Get('legacy/price-versions')
  versions(@Headers() headers: Record<string, string | undefined>) {
    return this.run(() => this.pricing.listVersions(this.context(headers)));
  }

  @Post('legacy/prices')
  async publish(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const context = this.context(headers);
    const result = await this.run(() =>
      this.pricing.publish(context, headers['idempotency-key'], body),
    );
    this.send('pricing_publish_outcome', context, result, response);
  }

  @Post('legacy/quotes')
  async issue(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const context = this.context(headers);
    const result = await this.run(() =>
      this.pricing.issueQuote(context, headers['idempotency-key'], body),
    );
    this.send('pricing_quote_outcome', context, result, response);
  }

  @Get('legacy/quotes/:id')
  quote(@Headers() headers: Record<string, string | undefined>, @Param('id') id: string) {
    return this.run(() => this.pricing.getQuote(this.context(headers), id));
  }

  @Post('legacy/quotes/:id/validate')
  @HttpCode(200)
  validate(
    @Headers() headers: Record<string, string | undefined>,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.run(() => this.pricing.validateQuote(this.context(headers), id, body));
  }

  // ------------------------------------------------------------ promotions

  @Post('promotions/:code/revisions')
  async publishPromotion(
    @Headers() headers: Record<string, string | undefined>,
    @Param('code') code: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const context = this.context(headers);
    const result = await this.run(() =>
      this.promotions.publishRevision(context, headers['idempotency-key'], code, body),
    );
    this.send('pricing_promotion_publish_outcome', context, result, response);
  }

  @Get('promotions')
  listPromotions(@Headers() headers: Record<string, string | undefined>) {
    return this.run(() => this.promotions.listPromotions(this.context(headers)));
  }

  @Get('promotions/:code')
  promotion(@Headers() headers: Record<string, string | undefined>, @Param('code') code: string) {
    return this.run(() => this.promotions.getPromotion(this.context(headers), code));
  }

  @Post('promotion-redemptions')
  async reserveRedemption(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const context = this.context(headers);
    const result = await this.run(() => this.promotions.reserve(context, body));
    this.send('pricing_redemption_reserve_outcome', context, result, response);
  }

  @Get('promotion-redemptions')
  redemptions(
    @Headers() headers: Record<string, string | undefined>,
    @Query('bookingId') bookingId: string | undefined,
  ) {
    return this.run(() => this.promotions.forBooking(this.context(headers), bookingId));
  }

  @Post('promotion-redemptions/:id/commit')
  async commitRedemption(
    @Headers() headers: Record<string, string | undefined>,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const context = this.context(headers);
    const result = await this.run(() => this.promotions.complete(context, id, 'COMMIT', body));
    this.send('pricing_redemption_commit_outcome', context, result, response);
  }

  @Post('promotion-redemptions/:id/release')
  async releaseRedemption(
    @Headers() headers: Record<string, string | undefined>,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const context = this.context(headers);
    const result = await this.run(() => this.promotions.complete(context, id, 'RELEASE', body));
    this.send('pricing_redemption_release_outcome', context, result, response);
  }
}
