import { subscriptionV1 } from '@carwash/contracts';
import type { SubscriptionPlanReader } from '../../ports/subscription-quote.ports';
import {
  catalogReaderConfigFromEnv,
  type CatalogReaderConfig,
} from '../catalog/catalog-v1-http.reader';
import { boundedText } from '../http/bounded-text';

export function subscriptionPlanConfigFromEnv(env: NodeJS.ProcessEnv): CatalogReaderConfig {
  return catalogReaderConfigFromEnv({
    ...env,
    CATALOG_ORIGIN: env.SUBSCRIPTION_ORIGIN,
    CATALOG_TIMEOUT_MS: env.SUBSCRIPTION_TIMEOUT_MS,
  });
}
export class SubscriptionPlanHttpReader implements SubscriptionPlanReader {
  constructor(
    private readonly config: CatalogReaderConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async read(planId: string, correlationId: string) {
    if (!this.config.origin) throw new Error('SUBSCRIPTION_UNAVAILABLE');
    const response = await this.fetcher(
      new URL(`/internal/v1/subscription/plans/${planId}`, this.config.origin),
      {
        headers: { accept: 'application/json', 'x-correlation-id': correlationId },
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      },
    );
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error('SUBSCRIPTION_UNAVAILABLE');
    }
    const text = await boundedText(response, 32768);
    if (text === null) throw new Error('SUBSCRIPTION_UNAVAILABLE');
    const plan = subscriptionV1.parsePlanV1(JSON.parse(text));
    if (plan.planId !== planId) throw new Error('SUBSCRIPTION_PLAN_MISMATCH');
    return plan;
  }
}
