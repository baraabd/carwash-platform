import { createHash } from 'node:crypto';
import { MERCHANT_ACCOUNT, PROVIDERS, type ProviderId } from '../../domain';
import {
  ProviderCapabilityMissing,
  type AuthenticatedNotification,
  type CreditQueryResult,
  type PaymentProviderAdapter,
  type PaymentProviderRegistry,
  type ProviderCapabilities,
  type ProviderDiagnostics,
  type RefundProviderAnswer,
} from '../../ports';

/**
 * ShamCash and Syriatel Cash merchant integrations.
 *
 * No approved merchant API documentation, credentials or sandbox exist for
 * either provider in this repository (docs/parallel/B/W05/PROVIDER_CAPABILITIES.md,
 * docs/production/B/P04-B1-PROVIDER-RECONCILIATION-REFUNDS.md). An adapter may
 * declare an automated capability only when it is implemented from the
 * provider's official, approved merchant documentation; no unofficial or
 * reverse-engineered API is used. Until then both declare exactly what is
 * possible without one:
 *  - credits are established from the merchant's own statement, recorded by
 *    one Finance person and approved by another (statementEvidence);
 *  - refunds are out-of-band manual transfers recorded with evidence;
 *  - notifications and verified queries are NOT available (fail closed).
 * Live/sandbox acceptance of a real adapter is blocker LIVE_PROVIDER_ACCEPTANCE.
 */
export const DOCUMENTATION_PENDING_CAPABILITIES: ProviderCapabilities = Object.freeze({
  notifications: false,
  creditQuery: false,
  refunds: 'MANUAL_OUT_OF_BAND',
  statementEvidence: true,
});

/** Env names an automated adapter would need. Setting them now is a misconfiguration. */
const AUTOMATION_SETTINGS = ['API_ORIGIN', 'API_KEY', 'API_SECRET', 'WEBHOOK_SECRET', 'CLIENT_ID'];

export class ProviderConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ProviderConfigurationError';
  }
}

export interface MerchantProviderConfig {
  readonly provider: ProviderId;
  /** Opaque identifiers of the company's receiving merchant accounts. */
  readonly merchantAccounts: readonly string[];
}

function envPrefix(provider: ProviderId): string {
  return `BILLING_${provider}`;
}

/**
 * Reads `BILLING_<PROVIDER>_MERCHANT_ACCOUNTS` (comma separated). An unset list
 * leaves the provider with no accepted account, so every credit for it is
 * refused (fail closed). Automation settings for an adapter that does not exist
 * fail startup instead of being silently ignored.
 */
export function merchantProviderConfigFromEnv(
  provider: ProviderId,
  env: Readonly<Record<string, string | undefined>>,
): MerchantProviderConfig {
  const prefix = envPrefix(provider);
  for (const setting of AUTOMATION_SETTINGS)
    if (env[`${prefix}_${setting}`] !== undefined || env[`${prefix}_${setting}_FILE`] !== undefined)
      throw new ProviderConfigurationError(`${prefix}_AUTOMATION_NOT_IMPLEMENTED`);
  const raw = env[`${prefix}_MERCHANT_ACCOUNTS`];
  const merchantAccounts =
    raw === undefined || raw.trim() === '' ? [] : raw.split(',').map((account) => account.trim());
  for (const account of merchantAccounts)
    if (!MERCHANT_ACCOUNT.test(account))
      throw new ProviderConfigurationError(`${prefix}_MERCHANT_ACCOUNTS_INVALID`);
  if (new Set(merchantAccounts).size !== merchantAccounts.length)
    throw new ProviderConfigurationError(`${prefix}_MERCHANT_ACCOUNTS_DUPLICATE`);
  return { provider, merchantAccounts };
}

/** Short fingerprint of the account set: lets operators compare configs, reveals nothing. */
export function accountsFingerprint(accounts: readonly string[]): string | null {
  if (accounts.length === 0) return null;
  return createHash('sha256')
    .update([...accounts].sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
}

/** A merchant provider limited to the capabilities possible without an official API. */
export class DocumentationPendingProvider implements PaymentProviderAdapter {
  readonly provider: ProviderId;
  readonly capabilities = DOCUMENTATION_PENDING_CAPABILITIES;
  private readonly accounts: ReadonlySet<string>;

  constructor(private readonly config: MerchantProviderConfig) {
    this.provider = config.provider;
    this.accounts = new Set(config.merchantAccounts);
  }

  acceptsMerchantAccount(account: string): boolean {
    return this.accounts.has(account);
  }

  authenticateNotification(): Promise<AuthenticatedNotification> {
    return Promise.reject(new ProviderCapabilityMissing());
  }

  queryCredit(): Promise<CreditQueryResult> {
    return Promise.reject(new ProviderCapabilityMissing());
  }

  submitRefund(): Promise<RefundProviderAnswer> {
    return Promise.reject(new ProviderCapabilityMissing());
  }

  refundStatus(): Promise<RefundProviderAnswer> {
    return Promise.reject(new ProviderCapabilityMissing());
  }

  diagnostics(): ProviderDiagnostics {
    return {
      provider: this.provider,
      integration: 'OFFICIAL_DOCUMENTATION_PENDING',
      capabilities: { ...this.capabilities },
      merchantAccountCount: this.accounts.size,
      merchantAccountsFingerprint: accountsFingerprint(this.config.merchantAccounts),
      secretsConfigured: [],
    };
  }
}

export function createShamCashProvider(
  env: Readonly<Record<string, string | undefined>>,
): PaymentProviderAdapter {
  return new DocumentationPendingProvider(merchantProviderConfigFromEnv('SHAM_CASH', env));
}

export function createSyriatelCashProvider(
  env: Readonly<Record<string, string | undefined>>,
): PaymentProviderAdapter {
  return new DocumentationPendingProvider(merchantProviderConfigFromEnv('SYRIATEL_CASH', env));
}

/** Exactly one adapter per provider; a missing one is a wiring error. */
export class StaticProviderRegistry implements PaymentProviderRegistry {
  private readonly byProvider: ReadonlyMap<ProviderId, PaymentProviderAdapter>;

  constructor(adapters: readonly PaymentProviderAdapter[]) {
    const map = new Map<ProviderId, PaymentProviderAdapter>();
    for (const adapter of adapters) {
      if (map.has(adapter.provider)) throw new ProviderConfigurationError('PROVIDER_DUPLICATE');
      map.set(adapter.provider, adapter);
    }
    for (const provider of PROVIDERS)
      if (!map.has(provider)) throw new ProviderConfigurationError(`PROVIDER_MISSING_${provider}`);
    this.byProvider = map;
  }

  adapter(provider: ProviderId): PaymentProviderAdapter {
    const found = this.byProvider.get(provider);
    if (!found) throw new ProviderConfigurationError(`PROVIDER_MISSING_${provider}`);
    return found;
  }

  all(): readonly PaymentProviderAdapter[] {
    return PROVIDERS.map((provider) => this.adapter(provider));
  }
}

export function productionProviderRegistry(
  env: Readonly<Record<string, string | undefined>>,
): PaymentProviderRegistry {
  return new StaticProviderRegistry([createShamCashProvider(env), createSyriatelCashProvider(env)]);
}
