import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  AppExceptionFilter,
  CORRELATION_HEADER,
  SERVICE_CLIENT_HEADER,
  SERVICE_TOKEN_HEADER,
  createLogger,
  resolveCorrelationId,
} from '@carwash/service-kit';
import { SubscriptionFundingService } from '../../application/subscription-funding.service';
import { BILLING_V1, run, type RequestHeaders } from './http-support';

export const SUBSCRIPTION_FUNDING_SERVICE = 'SUBSCRIPTION_FUNDING_SERVICE';
@Controller(BILLING_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'billing' })))
export class SubscriptionFundingController {
  constructor(
    @Inject(SUBSCRIPTION_FUNDING_SERVICE) private readonly funding: SubscriptionFundingService,
  ) {}
  private context(headers: RequestHeaders) {
    return {
      clientId: headers[SERVICE_CLIENT_HEADER],
      token: headers[SERVICE_TOKEN_HEADER],
      bearerPresent: headers.authorization !== undefined || headers.cookie !== undefined,
      correlationId: resolveCorrelationId(headers[CORRELATION_HEADER]),
    };
  }
  @Post('subscription-funding/claims')
  @HttpCode(200)
  claim(@Headers() headers: RequestHeaders, @Body() body: unknown) {
    return run(() => this.funding.claim(this.context(headers), body, headers['idempotency-key']));
  }
  @Post('subscription-funding/subscriptions/:id/release')
  @HttpCode(200)
  release(@Headers() headers: RequestHeaders, @Param('id') id: string, @Body() body: unknown) {
    return run(() =>
      this.funding.release(this.context(headers), id, body, headers['idempotency-key']),
    );
  }
  @Post('subscription-funding/verify')
  @HttpCode(200)
  verify(@Headers() headers: RequestHeaders, @Body() body: unknown) {
    return run(() =>
      this.funding.verify(
        {
          clientId: headers[SERVICE_CLIENT_HEADER],
          token: headers[SERVICE_TOKEN_HEADER],
          bearerPresent: headers.authorization !== undefined || headers.cookie !== undefined,
          correlationId: resolveCorrelationId(headers[CORRELATION_HEADER]),
        },
        body,
      ),
    );
  }
}
