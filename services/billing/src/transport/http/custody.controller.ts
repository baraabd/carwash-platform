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
import { CashCustodyService } from '../../application';
import {
  BILLING_V1,
  contextOf,
  run,
  sendCommand,
  type HttpResponse,
  type RequestHeaders,
} from './http-support';

export const CASH_CUSTODY_SERVICE = 'CASH_CUSTODY_SERVICE';

/**
 * Cash collection / custody / settlement owner API. Transport only: every rule
 * lives in CashCustodyService and the domain. Logs carry status codes only.
 */
@Controller(BILLING_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'billing' })))
export class CustodyController {
  private readonly logger = createLogger({
    service: 'billing',
    base: { component: 'billing-custody-http' },
  });

  constructor(@Inject(CASH_CUSTODY_SERVICE) private readonly custody: CashCustodyService) {}

  @Post('obligations/:id/cash-collections')
  async collect(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_cash_collect', headers, response, (context, key) =>
      this.custody.recordCollection(context, id, key, body),
    );
  }

  @Get('cash-receipts/:id')
  receipt(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    return run(() => this.custody.getReceipt(contextOf(headers), id));
  }

  @Post('cash-receipts/:id/reversal')
  async reverse(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_cash_reverse', headers, response, (context, key) =>
      this.custody.reverseCollection(context, id, key, body),
    );
  }

  @Post('custody/handovers')
  async declare(
    @Headers() headers: RequestHeaders,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_handover_declare', headers, response, (context, key) =>
      this.custody.declareHandover(context, key, body),
    );
  }

  @Get('custody/handovers/:id')
  handover(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    return run(() => this.custody.getHandover(contextOf(headers), id));
  }

  @Post('custody/handovers/:id/cancel')
  async cancel(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_handover_cancel', headers, response, (context, key) =>
      this.custody.cancelHandover(context, id, key, body),
    );
  }

  @Post('custody/handovers/:id/treasury-receipt')
  async receive(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(this.logger, 'billing_handover_receive', headers, response, (context, key) =>
      this.custody.receiveHandover(context, id, key, body),
    );
  }

  @Post('custody/handovers/:id/reconciliation')
  async reconcile(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await sendCommand(
      this.logger,
      'billing_handover_reconcile',
      headers,
      response,
      (context, key) => this.custody.reconcileHandover(context, id, key, body),
    );
  }

  // Declared before `custody/holders/:subject` so "me" is never read as a subject.
  @Get('custody/holders/me')
  mine(@Headers() headers: RequestHeaders) {
    return run(() => this.custody.myCustody(contextOf(headers)));
  }

  @Get('custody/holders/:subject')
  holder(@Headers() headers: RequestHeaders, @Param('subject') subject: string) {
    return run(() => this.custody.holderCustody(contextOf(headers), subject));
  }

  @Get('custody/reconciliation')
  reconciliation(@Headers() headers: RequestHeaders) {
    return run(() => this.custody.reconciliation(contextOf(headers)));
  }
}
