import { Body, Controller, Headers, HttpCode, Inject, Post, UseFilters } from '@nestjs/common';
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
