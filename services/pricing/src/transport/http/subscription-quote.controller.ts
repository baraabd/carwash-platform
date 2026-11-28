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
import { SubscriptionQuoteService } from '../../application/subscription-quote.service';
import { PricingErrorFilter, envelopeIds } from './error-envelope';
export const SUBSCRIPTION_QUOTE_SERVICE = 'SUBSCRIPTION_QUOTE_SERVICE';
@Controller('internal/v1/pricing/subscription-quotes')
@UseFilters(PricingErrorFilter)
export class SubscriptionQuoteController {
  constructor(
    @Inject(SUBSCRIPTION_QUOTE_SERVICE) private readonly quotes: SubscriptionQuoteService,
  ) {}
  @Post()
  async create(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
    @Res()
    response: {
      status(code: number): unknown;
      setHeader(name: string, value: string): void;
      json(body: unknown): unknown;
    },
  ) {
    const result = await this.quotes.create(
      { credential: headers.authorization, correlationId: envelopeIds(headers).correlationId },
      headers['idempotency-key'],
      body,
    );
    response.setHeader('idempotency-replayed', String(result.replayed));
    response.setHeader('cache-control', 'no-store');
    response.status(result.status);
    response.json(result.body);
  }
  @Get(':quoteId')
  get(@Headers() headers: Record<string, string | undefined>, @Param('quoteId') id: string) {
    return this.quotes.get(
      { credential: headers.authorization, correlationId: envelopeIds(headers).correlationId },
      id,
    );
  }
}
