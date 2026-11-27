import { isServiceOriginAllowed } from '@carwash/service-kit';
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
  if (origin && !isServiceOriginAllowed(origin, env))
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

  private async command(
    path: string,
    body: unknown,
    correlationId: string,
    key?: string,
  ): Promise<Record<string, unknown> | null> {
    const { origin, clientId, token, timeoutMs } = this.config;
    if (!origin || !clientId || !token) return null;
    try {
      const response = await this.fetcher(new URL(path, origin), {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-service-client': clientId,
          'x-service-token': token,
          'x-correlation-id': correlationId,
          ...(key ? { 'idempotency-key': key } : {}),
        },
        body: JSON.stringify(body),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const parts: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16384) {
          await reader.cancel();
          return null;
        }
        parts.push(chunk.value);
      }
      const result: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
      return result !== null && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  async claim(
    input: Parameters<FundingAuthority['claim']>[0],
  ): Promise<'CLAIMED' | 'NOT_VERIFIED' | 'UNAVAILABLE'> {
    const proof = await this.command(
      '/internal/v1/billing/subscription-funding/claims',
      {
        obligationId: input.obligationId,
        subscriptionId: input.subscriptionId,
        periodNo: input.periodNo,
        beneficiary: { kind: 'account', subjectId: input.customerSubject },
        amount: input.amount.toWire(),
        ...(input.quoteId ? { quoteId: input.quoteId } : {}),
      },
      input.correlationId,
      `subscription-claim-${input.subscriptionId}-${input.periodNo}`,
    );
    if (!proof) return 'UNAVAILABLE';
    if (
      proof.claimed === false &&
      ['PAYMENT_NOT_VERIFIED', 'FUNDING_ALREADY_CLAIMED', 'SUBSCRIPTION_CANCELLED'].includes(
        String(proof.reason),
      )
    )
      return 'NOT_VERIFIED';
    const beneficiary = proof.beneficiary as Record<string, unknown> | undefined;
    try {
      if (
        proof.claimed !== true ||
        proof.obligationId !== input.obligationId ||
        proof.subscriptionId !== input.subscriptionId ||
        proof.periodNo !== input.periodNo ||
        beneficiary?.kind !== 'account' ||
        beneficiary.subjectId !== input.customerSubject ||
        !Money.parse(proof.amount).equals(input.amount) ||
        (input.quoteId !== undefined && proof.quoteId !== input.quoteId)
      )
        return 'UNAVAILABLE';
      return 'CLAIMED';
    } catch {
      return 'UNAVAILABLE';
    }
  }

  async release(
    input: Parameters<FundingAuthority['release']>[0],
  ): Promise<'RELEASED' | 'UNAVAILABLE'> {
    const proof = await this.command(
      `/internal/v1/billing/subscription-funding/subscriptions/${input.subscriptionId}/release`,
      { beneficiary: { kind: 'account', subjectId: input.customerSubject } },
      input.correlationId,
      `subscription-release-${input.subscriptionId}`,
    );
    const beneficiary = proof?.beneficiary as Record<string, unknown> | undefined;
    return proof?.released === true &&
      proof.subscriptionId === input.subscriptionId &&
      beneficiary?.kind === 'account' &&
      beneficiary.subjectId === input.customerSubject
      ? 'RELEASED'
      : 'UNAVAILABLE';
  }

  async verify(
    input: Parameters<FundingAuthority['verify']>[0],
  ): Promise<'VERIFIED' | 'NOT_VERIFIED' | 'UNAVAILABLE'> {
    const proof = await this.command(
      '/internal/v1/billing/subscription-funding/verify',
      {
        obligationId: input.obligationId,
        beneficiary: { kind: 'account', subjectId: input.customerSubject },
        amount: input.amount.toWire(),
      },
      input.correlationId,
    );
    if (!proof) return 'UNAVAILABLE';
    if (proof.verified === false && proof.reason === 'PAYMENT_NOT_VERIFIED') return 'NOT_VERIFIED';
    const beneficiary = proof.beneficiary as Record<string, unknown> | undefined;
    try {
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
        return 'UNAVAILABLE';
      return 'VERIFIED';
    } catch {
      return 'UNAVAILABLE';
    }
  }
}
