import { pricingV1 } from '@carwash/contracts';
import { PricingUnavailable, type SchedulingQuote, type SchedulingQuoteReader } from '../../ports';

export interface PricingReaderConfig {
  readonly origin: URL | null;
  readonly timeoutMs: number;
}

/** Only a configured owner origin receives the already-validated bearer. */
export function pricingReaderConfigFromEnv(env: NodeJS.ProcessEnv): PricingReaderConfig {
  const rawTimeout = env.PRICING_TIMEOUT_MS ?? '2000';
  const timeoutMs = Number(rawTimeout);
  if (!/^[0-9]+$/.test(rawTimeout) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error('PRICING_TIMEOUT_MS_INVALID');
  }
  const raw = env.PRICING_ORIGIN;
  if (!raw) return { origin: null, timeoutMs };
  const origin = new URL(raw);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) {
    throw new Error('PRICING_ORIGIN_HTTPS_REQUIRED');
  }
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new Error('PRICING_ORIGIN_INVALID');
  }
  return { origin, timeoutMs };
}

const MAX_RESPONSE_BYTES = 65_536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new PricingUnavailable();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new PricingUnavailable();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new PricingUnavailable();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
  ) as unknown;
}

/**
 * Public pricing.v1 read as the authenticated beneficiary. Redirects, malformed
 * contracts and a bounded deadline/size failure are unavailable; none can grant
 * capacity. There is no service-local quote cache or guessed fallback duration.
 */
export class PricingQuoteHttpReader implements SchedulingQuoteReader {
  constructor(
    private readonly config: PricingReaderConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async read(
    quoteId: string,
    credential: string | undefined,
    correlationId: string,
  ): Promise<SchedulingQuote | null> {
    if (
      !this.config.origin ||
      !UUID.test(quoteId) ||
      !credential ||
      !/^Bearer [A-Za-z0-9._~+/=-]{16,8192}$/.test(credential)
    ) {
      throw new PricingUnavailable();
    }
    try {
      const response = await this.fetcher(
        new URL(`/internal/v1/pricing/quotes/${quoteId}`, this.config.origin),
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: credential,
            'x-correlation-id': correlationId,
          },
          redirect: 'error',
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
      if ([401, 403, 404].includes(response.status)) {
        await response.body?.cancel();
        return null;
      }
      if (
        response.status !== 200 ||
        (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() !==
          'application/json'
      ) {
        await response.body?.cancel();
        throw new PricingUnavailable();
      }
      const quote = pricingV1.parseQuoteV1(await boundedJson(response));
      if (quote.quoteId !== quoteId.toLowerCase()) throw new PricingUnavailable();
      return {
        quoteId: quote.quoteId,
        revision: quote.revision,
        status: quote.status,
        beneficiary: quote.beneficiary,
        zoneId: quote.zoneId,
        durationMinutes: quote.durationMinutes,
        expiresAt: new Date(quote.expiresAt),
      };
    } catch {
      // Never propagate an upstream body, URL or bearer into diagnostic logs.
      throw new PricingUnavailable();
    }
  }
}
