import { EVENT_PRODUCERS } from '@carwash/event-contracts';
import { ServiceClientAuthenticator, parseServiceClients } from '@carwash/service-kit';
import {
  PRICING_SERVICE_SCOPES,
  type PricingServiceScope,
  type ServiceCallerAuthority,
} from '../../ports';

/**
 * Service-to-service callers of Pricing promotions (the Booking saga), configured in
 * PRICING_SERVICE_CLIENTS as SHA-256 digests with explicit scopes through
 * the shared P04-E3 primitive. Absent configuration means "no service caller":
 * every redemption route is refused, never allowed by default.
 *
 * A client id must be a platform producer name (e.g. `booking`) because it is
 * recorded as the event actor, and envelope v2 names workloads that way.
 */
export const SERVICE_CLIENTS_ENV = 'PRICING_SERVICE_CLIENTS';

export class ConfiguredServiceCallers implements ServiceCallerAuthority {
  private readonly authenticator: ServiceClientAuthenticator<PricingServiceScope>;

  constructor(raw: string | undefined) {
    const clients = parseServiceClients(raw, PRICING_SERVICE_SCOPES);
    for (const client of clients)
      if (!(EVENT_PRODUCERS as readonly string[]).includes(client.id))
        throw new Error('PRICING_SERVICE_CLIENT_ID_NOT_A_PRODUCER');
    this.authenticator = new ServiceClientAuthenticator(clients);
  }

  static fromEnv(env: NodeJS.ProcessEnv): ConfiguredServiceCallers {
    return new ConfiguredServiceCallers(env[SERVICE_CLIENTS_ENV]);
  }

  authorize(
    clientId: string | undefined,
    token: string | undefined,
    scope: PricingServiceScope,
  ): string | null {
    const decision = this.authenticator.authorize(clientId, token, scope);
    return decision.ok ? decision.clientId : null;
  }
}
