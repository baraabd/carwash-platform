import {
  ServiceClientAuthenticator,
  parseServiceClients,
  type ServiceClient,
} from '@carwash/service-kit';
import {
  PRICING_SERVICE_SCOPES,
  type PricingServiceScope,
  type ServiceAuthority,
  type ServiceCredential,
  type ServiceDecision,
} from '../../ports';

/**
 * Interim workload authentication for pricing.v1 `service:` routes using the
 * shared P04-E3 primitive (`x-service-client` / `x-service-token`, digests only
 * in configuration, constant-time comparison, deny by default).
 *
 *   PRICING_SERVICE_CLIENTS  [{"id":"booking","tokenSha256":"<64 hex>","scopes":["pricing.quote.validate"]}]
 *
 * Absent or empty means "no service callers": every service route is refused.
 * A present but invalid value aborts startup instead of being ignored.
 */
export function pricingServiceClientsFromEnv(
  env: NodeJS.ProcessEnv,
): ServiceClient<PricingServiceScope>[] {
  return parseServiceClients(env.PRICING_SERVICE_CLIENTS, PRICING_SERVICE_SCOPES);
}

export class ServiceClientAuthority implements ServiceAuthority {
  private readonly authenticator: ServiceClientAuthenticator<PricingServiceScope>;

  constructor(clients: readonly ServiceClient<PricingServiceScope>[]) {
    this.authenticator = new ServiceClientAuthenticator(clients);
  }

  authorize(credential: ServiceCredential, scope: PricingServiceScope): ServiceDecision {
    const decision = this.authenticator.authorize(credential.clientId, credential.token, scope);
    return decision.ok
      ? { ok: true, clientId: decision.clientId }
      : { ok: false, reason: decision.reason };
  }
}
