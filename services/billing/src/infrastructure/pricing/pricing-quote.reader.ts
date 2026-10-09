import { Money } from '../../domain';
import { QuoteUnavailable, type QuoteReader, type VerifiedQuote } from '../../ports';
import {
  boundedText,
  isBearer,
  upstreamConfigFromEnv,
  type UpstreamConfig,
} from '../http/bounded-fetch';

/**
 * Reads a quote through the PUBLISHED pricing.v1 `getQuote` route
 * (`GET /internal/v1/pricing/quotes/:quoteId`, access: principal), forwarding
 * the caller's own bearer token so Pricing enforces quote ownership.
 *
 * Only the fields Billing needs are read, and they are checked exactly against
 * the published QuoteV1 shape: `quoteId`, `status` (USABLE|EXPIRED|REVOKED),
 * `currency` and `total` (Money with explicit scale, same currency). Billing
 * cannot import @carwash/contracts until Lane E adds the dependency
 * (CONTRACT_REQUEST_E_BILLING.md CR-B-04); this parser must track pricing.v1.
 *
 * 404 means "not this caller's quote" (Pricing does not enumerate). Every other
 * non-200, a timeout or a malformed body is QuoteUnavailable: never a guessed
 * amount and never a retry from here (the request is a safe GET, but the
 * caller's latency budget belongs to the Gateway).
 */
export const PRICING_QUOTE_PATH = '/internal/v1/pricing/quotes/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATUSES = ['USABLE', 'EXPIRED', 'REVOKED'] as const;

export function pricingConfigFromEnv(env: NodeJS.ProcessEnv): UpstreamConfig {
  return upstreamConfigFromEnv(env, 'PRICING_ORIGIN', 'PRICING_TIMEOUT_MS');
}

function parseQuote(value: unknown, quoteId: string): VerifiedQuote | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.quoteId !== quoteId) return null;
  const status = STATUSES.find((candidate) => candidate === body.status);
  if (!status) return null;
  let total: Money;
  try {
    total = Money.parse(body.total);
  } catch {
    return null;
  }
  if (body.currency !== total.currency) return null;
  return { quoteId, total, usable: status === 'USABLE' };
}

export class PricingQuoteReader implements QuoteReader {
  constructor(
    private readonly config: UpstreamConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async read(
    quoteId: string,
    credential: string,
    correlationId: string,
  ): Promise<VerifiedQuote | null> {
    if (!UUID.test(quoteId) || !isBearer(credential)) throw new QuoteUnavailable();
    if (!this.config.origin) throw new QuoteUnavailable();
    let response: Response;
    try {
      response = await this.fetcher(new URL(PRICING_QUOTE_PATH + quoteId, this.config.origin), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: credential,
          'x-correlation-id': correlationId,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new QuoteUnavailable();
    }
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new QuoteUnavailable();
    }
    let quote: VerifiedQuote | null;
    try {
      const text = await boundedText(response);
      quote = text === null ? null : parseQuote(JSON.parse(text), quoteId);
    } catch {
      quote = null;
    }
    if (!quote) throw new QuoteUnavailable();
    return quote;
  }
}