import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import { AppExceptionFilter, createLogger } from '@carwash/service-kit';
import { BillingService } from '../../application';
import {
  BILLING_V1,
  contextOf,
  run,
  sendCommand,
  type HttpResponse,
  type RequestHeaders,
} from './http-support';

export { BILLING_V1 } from './http-support';
export const BILLING_SERVICE = 'BILLING_SERVICE';

/**
 * Billing owner API. Extracts credential/correlation/key, renders results and
 * maps application failures to fixed public errors. No business logic here.
 * Logs carry status codes only: never amounts, references or subjects.
 */
@Controller(BILLING_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'billing' })))
export class BillingController {
  private readonly logger = createLogger({
    service: 'billing',
    base: { component: 'billing-http' },
  });

  constructor(@Inject(BILLING_SERVICE) private readonly billing: BillingService) {}

  @Post('obligations')
  async create(
    @Headers() headers: RequestHeaders,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_obligation_create', headers, response, (context, key) =>
      this.billing.createObligation(context, key, body),
    );
  }

  @Get('obligations/:id')
  obligation(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    return run(() => this.billing.getObligation(contextOf(headers), id));
  }

  @Get('obligations/:id/financial-status')
  status(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    return run(() => this.billing.getFinancialStatus(contextOf(headers), id));
  }

  @Post('obligations/:id/payment-intents')
  async initialize(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_intent_initialize', headers, response, (context, key) =>
      this.billing.initializePayment(context, id, key, body),
    );
  }

  @Post('obligations/:id/payment-attempts')
  async submit(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_attempt_submit', headers, response, (context, key) =>
      this.billing.submitAttempt(context, id, key, body),
    );
  }

  @Post('obligations/:id/void')
  async void(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_obligation_void', headers, response, (context, key) =>
      this.billing.voidObligation(context, id, key, body),
    );
  }

  @Post('payment-attempts/:id/reconciliation')
  async reconcile(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_attempt_reconcile', headers, response, (context, key) =>
      this.billing.reconcileAttempt(context, id, key, body),
    );
  }
}
