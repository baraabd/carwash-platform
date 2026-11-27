import { Money } from '../../domain';
import type { FundingAuthority } from '../../ports';

export interface BillingFundingConfig {
  readonly origin: URL | null;
  readonly clientId: string | undefined;
  readonly token: string | undefined;
  readonly timeoutMs: number;
}

export function billingFundingConfigFromEnv(env: NodeJS.ProcessEnv): BillingFundingConfig {
  const raw = env.SUBSCRIPTION_BILLING_ORIGIN;
  const origin = raw ? new URL(raw) : null;
  if (
    origin &&
    ((origin.protocol !== 'https:' &&
      !(
        origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
      )) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.hash ||
      origin.search)
  )
    throw new Error('SUBSCRIPTION_BILLING_ORIGIN_INVALID');
  const timeoutMs = Number(env.SUBSCRIPTION_BILLING_TIMEOUT_MS ?? '2500');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000)
    throw new Error('SUBSCRIPTION_BILLING_TIMEOUT_MS_INVALID');
  return {
    origin,
    timeoutMs,
    clientId: env.SUBSCRIPTION_BILLING_CLIENT_ID,
    token: env.SUBSCRIPTION_BILLING_SERVICE_TOKEN,
  };
}

/** Workload-only bounded query; a human-supplied reference is never proof. */
export class BillingFundingAuthority implements FundingAuthority {
  constructor(
    private readonly config: BillingFundingConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async verify(input: Parameters<FundingAuthority['verify']>[0]) {
    const { origin, clientId, token, timeoutMs } = this.config;
    if (!origin || !clientId || !token) return 'UNAVAILABLE' as const;
    try {
      const response = await this.fetcher(
        new URL('/internal/v1/billing/subscription-funding/verify', origin),
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-service-client': clientId,
            'x-service-token': token,
            'x-correlation-id': input.correlationId,
          },
          body: JSON.stringify({
            obligationId: input.obligationId,
            beneficiary: { kind: 'account', subjectId: input.customerSubject },
            amount: input.amount.toWire(),
          }),
        },
      );
      if (response.status !== 200) {
        await response.body?.cancel();
        return 'UNAVAILABLE' as const;
      }
      const reader = response.body?.getReader();
      if (!reader) return 'UNAVAILABLE' as const;
      const parts: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16384) {
          await reader.cancel();
          return 'UNAVAILABLE' as const;
        }
        parts.push(chunk.value);
      }
      const proof = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>;
      if (proof.verified === false && proof.reason === 'PAYMENT_NOT_VERIFIED')
        return 'NOT_VERIFIED' as const;
      const beneficiary = proof.beneficiary as Record<string, unknown> | null;
      if (
        proof.verified !== true ||
        proof.obligationId !== input.obligationId ||
        typeof proof.revision !== 'number' ||
        !Number.isSafeInteger(proof.revision) ||
        proof.revision < 1 ||
        beneficiary?.kind !== 'account' ||
        beneficiary.subjectId !== input.customerSubject ||
        !Money.parse(proof.amount).equals(input.amount) ||
        (input.quoteId !== undefined && proof.quoteId !== input.quoteId)
      )
        return 'UNAVAILABLE' as const;
      return 'VERIFIED' as const;
    } catch {
      return 'UNAVAILABLE' as const;
    }
  }
}
