import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  AppExceptionFilter,
  CORRELATION_HEADER,
  createLogger,
  resolveCorrelationId,
} from '@carwash/service-kit';
import { BillingApplicationError, ProviderPaymentsService, RefundService } from '../../application';
import {
  BILLING_V1,
  contextOf,
  run,
  sendCommand,
  type HttpResponse,
  type RequestHeaders,
} from './http-support';

export const PROVIDER_PAYMENTS_SERVICE = 'PROVIDER_PAYMENTS_SERVICE';
export const REFUND_SERVICE = 'REFUND_SERVICE';

/** Largest notification body Billing hands to an adapter. */
const MAX_NOTIFICATION_BYTES = 16 * 1024;

/** The raw bytes Nest keeps when the application is created with `rawBody: true`. */
interface RawBodyRequest {
  readonly rawBody?: Buffer;
}

/**
 * Provider credits, reconciliation and refunds owner API. Transport only: every
 * rule lives in the application services and the domain. Logs carry status
 * codes only: never amounts, references, merchant accounts or subjects.
 */
@Controller(BILLING_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'billing' })))
export class ProviderController {
  private readonly logger = createLogger({
    service: 'billing',
    base: { component: 'billing-provider-http' },
  });

  constructor(
    @Inject(PROVIDER_PAYMENTS_SERVICE) private readonly payments: ProviderPaymentsService,
    @Inject(REFUND_SERVICE) private readonly refunds: RefundService,
  ) {}

  @Get('providers')
  providers(@Headers() headers: RequestHeaders) {
    return run(() => this.payments.providers(contextOf(headers)));
  }

  /**
   * Provider-to-Billing notification. No Identity session: the adapter
   * authenticates the exact received bytes or the request is rejected.
   */
  @Post('providers/:provider/notifications')
  async notification(
    @Headers() headers: RequestHeaders,
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const correlationId = resolveCorrelationId(headers[CORRELATION_HEADER]);
    const result = await run(() => {
      const raw = request.rawBody;
      if (!raw || raw.byteLength === 0 || raw.byteLength > MAX_NOTIFICATION_BYTES)
        throw new BillingApplicationError('NOTIFICATION_REJECTED');
      return this.payments.receiveNotification(
        provider,
        { rawBody: new Uint8Array(raw), headers },
        correlationId,
      );
    });
    this.logger.info('billing_provider_notification', { correlationId, status: result.status });
    response.setHeader(CORRELATION_HEADER, correlationId);
    response.status(result.status).json(result.body);
  }

  @Post('provider-credits')
  async recordStatement(
    @Headers() headers: RequestHeaders,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_credit_statement', headers, response, (context, key) =>
      this.payments.recordStatementCredit(context, key, body),
    );
  }

  @Get('provider-credits')
  credits(
    @Headers() headers: RequestHeaders,
    @Query('status') status: unknown,
    @Query('limit') limit: unknown,
  ) {
    return run(() => this.payments.credits(contextOf(headers), status, limit));
  }

  @Get('provider-credits/:id')
  credit(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    return run(() => this.payments.getCredit(contextOf(headers), id));
  }

  @Post('provider-credits/:id/decision')
  async decideStatement(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_credit_decide', headers, response, (context, key) =>
      this.payments.decideStatementCredit(context, id, key, body),
    );
  }

  @Post('payment-attempts/:id/provider-verification')
  async verify(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_attempt_verify', headers, response, (context, key) =>
      this.payments.verifyAttemptWithProvider(context, id, key, body),
    );
  }

  @Post('provider-credits/:id/refunds')
  async requestRefund(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_refund_request', headers, response, (context, key) =>
      this.refunds.requestRefund(context, id, key, body),
    );
  }

  @Get('refunds')
  refundQueue(
    @Headers() headers: RequestHeaders,
    @Query('status') status: unknown,
    @Query('limit') limit: unknown,
  ) {
    return run(() => this.refunds.refunds(contextOf(headers), status, limit));
  }

  @Get('refunds/:id')
  refund(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    return run(() => this.refunds.getRefund(contextOf(headers), id));
  }

  @Post('refunds/:id/decision')
  async decideRefund(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_refund_decide', headers, response, (context, key) =>
      this.refunds.decideRefund(context, id, key, body),
    );
  }

  @Post('refunds/:id/provider-execution')
  async executeRefund(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_refund_execute', headers, response, (context, key) =>
      this.refunds.executeRefund(context, id, key, body),
    );
  }

  @Post('refunds/:id/manual-completion')
  async completeRefund(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_refund_complete', headers, response, (context, key) =>
      this.refunds.completeManualRefund(context, id, key, body),
    );
  }
}
