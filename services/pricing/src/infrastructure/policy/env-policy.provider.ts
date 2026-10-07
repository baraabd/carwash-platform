import { parseCurrencyPolicy, type CurrencyPolicy } from '../../domain';
import type { PolicyProvider } from '../../ports';

/**
 * Owner policy supplied by the deployment (B-03 currency/exponent/max and B-05
 * quote TTL are still OPEN decisions). Absent values are allowed so the
 * foundation image boots, but then every price/quote command fails closed with
 * POLICY_UNAVAILABLE. A PRESENT but invalid value aborts startup instead of
 * being silently ignored.
 *
 *   PRICING_CURRENCY_POLICY   {"revision","currency","minorUnitExponent","maxAmountMinor"}
 *   PRICING_QUOTE_TTL_SECONDS integer 60..86400
 */
export class EnvPolicyProvider implements PolicyProvider {
  private readonly policy: CurrencyPolicy | null;
  private readonly ttl: number | null;

  constructor(env: NodeJS.ProcessEnv) {
    const rawPolicy = env.PRICING_CURRENCY_POLICY;
    this.policy =
      rawPolicy === undefined || rawPolicy === ''
        ? null
        : parseCurrencyPolicy(JSON.parse(rawPolicy) as unknown);
    const rawTtl = env.PRICING_QUOTE_TTL_SECONDS;
    if (rawTtl === undefined || rawTtl === '') {
      this.ttl = null;
    } else {
      const ttl = Number(rawTtl);
      if (!/^[0-9]+$/.test(rawTtl) || ttl < 60 || ttl > 86_400)
        throw new Error('PRICING_QUOTE_TTL_SECONDS_INVALID');
      this.ttl = ttl;
    }
  }

  currencyPolicy(): CurrencyPolicy | null {
    return this.policy;
  }

  quoteTtlSeconds(): number | null {
    return this.ttl;
  }
}
