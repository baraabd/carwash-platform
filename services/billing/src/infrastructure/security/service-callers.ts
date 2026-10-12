import { ServiceClientAuthenticator, parseServiceClients } from '@carwash/service-kit';
import {
  BILLING_SERVICE_SCOPES,
  type BillingServiceScope,
  type ServiceCallerAuthority,
  type ServiceDecision,
} from '../../ports';

/**
 * Workload callers of Billing (interim x-service-client / x-service-token
 * mechanism from @carwash/service-kit, P04-E3, until the platform issues
 * workload identity).
 *
 * BILLING_SERVICE_CLIENTS holds SHA-256 digests only, e.g.
 *   [{"id":"booking","tokenSha256":"<64 hex>","scopes":["billing.obligation.write"]}]
 * Unset or empty means no workload may call Billing: every service-scoped
 * route answers 401. A malformed value fails startup instead of opening access.
 */
export const SERVICE_CLIENTS_ENV = 'BILLING_SERVICE_CLIENTS';

export class ServiceClientCallerAuthority implements ServiceCallerAuthority {
  private readonly authenticator: ServiceClientAuthenticator<BillingServiceScope>;

  constructor(raw: string | undefined) {
    this.authenticator = new ServiceClientAuthenticator(
      parseServiceClients(raw, BILLING_SERVICE_SCOPES),
    );
  }

  static fromEnv(env: NodeJS.ProcessEnv): ServiceClientCallerAuthority {
    return new ServiceClientCallerAuthority(env[SERVICE_CLIENTS_ENV]);
  }

  authorize(
    clientId: string | undefined,
    token: string | undefined,
    scope: BillingServiceScope,
  ): ServiceDecision {
    const decision = this.authenticator.authorize(clientId, token, scope);
    return decision.ok
      ? { ok: true, clientId: decision.clientId }
      : { ok: false, reason: decision.reason };
  }
}
