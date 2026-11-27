import { billingV1, pricingV1 } from '@carwash/contracts';
import { Money } from '../../domain';
import { PurchaseOwnerRefusal, type PurchaseOwners, type PurchaseRecord } from '../../ports';
import { billingFundingConfigFromEnv } from './billing-funding.authority';

export interface PurchaseOwnersConfig {
  readonly billing: URL | null;
  readonly pricing: URL | null;
  readonly timeoutMs: number;
}
export function purchaseOwnersConfigFromEnv(env: NodeJS.ProcessEnv): PurchaseOwnersConfig {
  const billing = billingFundingConfigFromEnv(env);
  const pricing = billingFundingConfigFromEnv({
    ...env,
    SUBSCRIPTION_BILLING_ORIGIN: env.SUBSCRIPTION_PRICING_ORIGIN,
  });
  return { billing: billing.origin, pricing: pricing.origin, timeoutMs: billing.timeoutMs };
}
export class PurchaseOwnersClient implements PurchaseOwners {
  constructor(
    private readonly config: PurchaseOwnersConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async call(
    origin: URL | null,
    path: string,
    credential: string,
    correlationId: string,
    body?: unknown,
    key?: string,
  ) {
    if (!origin || !/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(credential))
      throw new Error('PURCHASE_OWNER_UNAVAILABLE');
    const response = await this.fetcher(new URL(path, origin), {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        accept: 'application/json',
        authorization: credential,
        'x-correlation-id': correlationId,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(key ? { 'idempotency-key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status >= 400) {
      await response.body?.cancel();
      if ([400, 404, 409, 412, 422].includes(response.status))
        throw new PurchaseOwnerRefusal(`HTTP_${response.status}`);
      throw new Error('PURCHASE_OWNER_UNAVAILABLE');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('PURCHASE_OWNER_UNAVAILABLE');
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error('PURCHASE_OWNER_UNAVAILABLE');
      }
      parts.push(next.value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  }
  async quote(id: string, credential: string, correlationId: string) {
    try {
      const quote = pricingV1.parseSubscriptionQuoteV1(
        await this.call(
          this.config.pricing,
          `/internal/v1/pricing/subscription-quotes/${id}`,
          credential,
          correlationId,
        ),
      );
      if (quote.quoteId !== id || quote.status !== 'USABLE' || quote.beneficiary.kind !== 'account')
        return null;
      return {
        quoteId: id,
        planId: quote.planId,
        planVersion: quote.planVersion,
        customerSubject: quote.beneficiary.subjectId,
        amount: Money.parse(quote.total),
        expiresAt: new Date(quote.expiresAt),
      };
    } catch (error) {
      if (error instanceof PurchaseOwnerRefusal && error.code === 'HTTP_404') return null;
      throw error;
    }
  }
  private view(value: unknown) {
    const obligation = billingV1.parseObligationV1(value);
    return {
      obligationId: obligation.obligationId,
      quoteId: obligation.quoteId,
      status: obligation.status,
      financialStatus: obligation.financialStatus,
      amount: Money.parse(obligation.amount),
    };
  }
  async createObligation(
    quoteId: string,
    method: PurchaseRecord['paymentMethod'],
    credential: string,
    key: string,
    correlationId: string,
  ) {
    const first = billingV1.parseObligationV1(
      await this.call(
        this.config.billing,
        '/internal/v1/billing/obligations',
        credential,
        correlationId,
        { quoteId },
        `${key}-obligation`,
      ),
    );
    if (first.quoteId !== quoteId) throw new Error('PURCHASE_OWNER_MISMATCH');
    // Same fixed initialization key is replayed after a lost answer. Never
    // replace a later method choice by issuing a new command on a polling read.
    if (first.status === 'OPEN' && first.activeIntent === null)
      await this.call(
        this.config.billing,
        `/internal/v1/billing/obligations/${first.obligationId}/payment-intents`,
        credential,
        correlationId,
        { expectedRevision: first.revision, method },
        `${key}-method`,
      );
    return this.obligation(first.obligationId, credential, correlationId);
  }
  async obligation(id: string, credential: string, correlationId: string) {
    const result = this.view(
      await this.call(
        this.config.billing,
        `/internal/v1/billing/obligations/${id}`,
        credential,
        correlationId,
      ),
    );
    if (result.obligationId !== id) throw new Error('PURCHASE_OWNER_MISMATCH');
    return result;
  }
}
