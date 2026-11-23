import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  CORRELATION_HEADER,
  SERVICE_CLIENT_HEADER,
  SERVICE_TOKEN_HEADER,
  createLogger,
} from '@carwash/service-kit';
import {
  PricingService,
  type CommandResult,
  type FieldIssue,
  type RequestContext,
} from '../../application';
import { PricingErrorFilter, envelopeIds, errorEnvelope } from './error-envelope';

export const PRICING_SERVICE = 'PRICING_SERVICE';
/** pricing.v1 prefix (`/internal/v1/pricing`). */
export const PRICING_V1_PREFIX = 'internal/v1/pricing';

type HeaderBag = Record<string, string | undefined>;

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): unknown;
}

function issuesOf(value: unknown): FieldIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { field, code } = entry as Record<string, unknown>;
    return typeof field === 'string' && typeof code === 'string' ? [{ field, code }] : [];
  });
}

/**
 * pricing.v1 owner API. Extracts credentials, correlation and idempotency key,
 * renders results and the contract error envelope. No business logic here.
 */
@Controller(PRICING_V1_PREFIX)
@UseFilters(PricingErrorFilter)
export class PricingController {
  private readonly logger = createLogger({
    service: 'pricing',
    base: { component: 'pricing-http' },
  });

  constructor(@Inject(PRICING_SERVICE) private readonly pricing: PricingService) {}

  private context(headers: HeaderBag): RequestContext {
    return {
      credential: headers.authorization,
      correlationId: envelopeIds(headers).correlationId,
    };
  }

  private send(event: string, headers: HeaderBag, result: CommandResult, res: HttpResponse) {
    const ids = envelopeIds(headers);
    const code = typeof result.body.code === 'string' ? result.body.code : null;
    this.logger.info(event, {
      status: result.status,
      replayed: result.replayed,
      code,
      correlationId: ids.correlationId,
    });
    res.setHeader(CORRELATION_HEADER, ids.correlationId);
    res.setHeader('idempotency-replayed', String(result.replayed));
    if (result.status >= 400) {
      const reason = typeof result.body.reason === 'string' ? result.body.reason : null;
      res
        .status(result.status)
        .json(errorEnvelope(code ?? 'INTERNAL_ERROR', ids, reason, issuesOf(result.body.issues)));
      return;
    }
    res.status(result.status).json(result.body);
  }

  @Post('quotes')
  async createQuote(
    @Headers() headers: HeaderBag,
    @Body() body: unknown,
    @Res() res: HttpResponse,
  ): Promise<void> {
    const result = await this.pricing.createQuote(
      this.context(headers),
      headers['idempotency-key'],
      body,
    );
    this.send('pricing_quote_outcome', headers, result, res);
  }

  @Get('quotes/:quoteId')
  getQuote(@Headers() headers: HeaderBag, @Param('quoteId') quoteId: string) {
    return this.pricing.getQuote(this.context(headers), quoteId);
  }

  @Post('quotes/:quoteId/validate')
  @HttpCode(200)
  validateQuote(
    @Headers() headers: HeaderBag,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ) {
    return this.pricing.validateQuote(
      { clientId: headers[SERVICE_CLIENT_HEADER], token: headers[SERVICE_TOKEN_HEADER] },
      envelopeIds(headers).correlationId,
      quoteId,
      body,
    );
  }

  @Post('price-books')
  async publishPriceBook(
    @Headers() headers: HeaderBag,
    @Body() body: unknown,
    @Res() res: HttpResponse,
  ): Promise<void> {
    const result = await this.pricing.publishPriceBook(
      this.context(headers),
      headers['idempotency-key'],
      body,
    );
    this.send('pricing_price_book_outcome', headers, result, res);
  }
}
