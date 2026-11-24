import { Body, Controller, Get, Headers, Inject, Param, Post, Res } from '@nestjs/common';
import { CORRELATION_HEADER, createLogger } from '@carwash/service-kit';
import { CanonicalRefundService, type CommandResult, type RequestContext } from '../../application';
import { BILLING_V1, contextOf, type HttpResponse, type RequestHeaders } from './http-support';
import { canonicalBillingFailure } from './canonical-http-support';

export const CANONICAL_REFUND_SERVICE = 'CANONICAL_REFUND_SERVICE';

@Controller(BILLING_V1)
export class CanonicalRefundController {
  private readonly logger = createLogger({
    service: 'billing',
    base: { component: 'canonical-refund-http' },
  });

  constructor(@Inject(CANONICAL_REFUND_SERVICE) private readonly refunds: CanonicalRefundService) {}

  private async reply(
    headers: RequestHeaders,
    response: HttpResponse,
    work: (
      context: RequestContext,
    ) => Promise<{ status: number; body: unknown; replayed?: boolean }>,
  ): Promise<void> {
    const context = contextOf(headers);
    response.setHeader(CORRELATION_HEADER, context.correlationId);
    response.setHeader('cache-control', 'no-store');
    try {
      const result = await work(context);
      if (result.replayed !== undefined)
        response.setHeader('idempotency-replayed', String(result.replayed));
      this.logger.info('billing_canonical_refund', {
        correlationId: context.correlationId,
        status: result.status,
        replayed: result.replayed ?? false,
      });
      response.status(result.status).json(result.body);
    } catch (error: unknown) {
      const result = canonicalBillingFailure(error, headers, context.correlationId);
      this.logger.info('billing_canonical_refund_rejected', {
        correlationId: context.correlationId,
        status: result.status,
      });
      response.status(result.status).json(result.body);
    }
  }

  @Post('obligations/:id/refunds')
  request(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    return this.reply(headers, response, (context): Promise<CommandResult> =>
      this.refunds.requestRefund(context, id, headers['idempotency-key'], body),
    );
  }

  @Get('obligations/:id/refunds')
  list(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Res() response: HttpResponse,
  ): Promise<void> {
    return this.reply(headers, response, async (context) => ({
      status: 200,
      body: await this.refunds.listObligationRefunds(context, id),
    }));
  }

  @Get('refunds/:id')
  get(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Res() response: HttpResponse,
  ): Promise<void> {
    return this.reply(headers, response, async (context) => ({
      status: 200,
      body: await this.refunds.getRefund(context, id),
    }));
  }

  @Post('refunds/:id/outcome')
  outcome(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    return this.reply(headers, response, (context): Promise<CommandResult> =>
      this.refunds.recordOutcome(context, id, headers['idempotency-key'], body),
    );
  }
}
