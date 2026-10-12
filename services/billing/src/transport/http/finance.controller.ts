import { Controller, Get, Headers, Inject, Query, UseFilters } from '@nestjs/common';
import { AppExceptionFilter, createLogger } from '@carwash/service-kit';
import { FinanceQueryService } from '../../application';
import { BILLING_V1, contextOf, run, type RequestHeaders } from './http-support';

export const FINANCE_QUERY_SERVICE = 'FINANCE_QUERY_SERVICE';

/**
 * Admin finance reads (P06-B6): GET summary and GET payment-attempts (work
 * queue). Transport only; authorization and every rule live in
 * FinanceQueryService. Not yet part of the published billing.v1 contract
 * (docs/production/B/CONTRACT_REQUEST_E_BILLING_ADMIN.md).
 */
@Controller(BILLING_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'billing' })))
export class FinanceController {
  constructor(@Inject(FINANCE_QUERY_SERVICE) private readonly finance: FinanceQueryService) {}

  @Get('summary')
  summary(@Headers() headers: RequestHeaders) {
    return run(() => this.finance.summary(contextOf(headers)));
  }

  @Get('payment-attempts')
  queue(@Headers() headers: RequestHeaders, @Query() query: unknown) {
    return run(() => this.finance.attemptQueue(contextOf(headers), query));
  }
}
