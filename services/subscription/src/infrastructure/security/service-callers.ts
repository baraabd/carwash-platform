import { EVENT_PRODUCERS } from '@carwash/event-contracts';
import { ServiceClientAuthenticator, parseServiceClients } from '@carwash/service-kit';
import { SERVICE_SCOPES, type ServiceCallerAuthority, type ServiceScope } from '../../ports';

/**
 * Service-to-service callers of Subscription (the Booking saga), configured in
 * SUBSCRIPTION_SERVICE_CLIENTS as SHA-256 digests with explicit scopes through
 * the shared P04-E3 primitive. Absent configuration means "no service caller":
 * every entitlement route is refused, never allowed by default.
 *
 * A client id must be a platform producer name (e.g. `booking`) because it is
 * recorded as the event actor, and envelope v2 names workloads that way.
 */
export const SERVICE_CLIENTS_ENV = 'SUBSCRIPTION_SERVICE_CLIENTS';

export class ConfiguredServiceCallers implements ServiceCallerAuthority {
  private readonly authenticator: ServiceClientAuthenticator<ServiceScope>;

  constructor(raw: string | undefined) {
    const clients = parseServiceClients(raw, SERVICE_SCOPES);
    for (const client of clients)
      if (!(EVENT_PRODUCERS as readonly string[]).includes(client.id))
        throw new Error('SUBSCRIPTION_SERVICE_CLIENT_ID_NOT_A_PRODUCER');
    this.authenticator = new ServiceClientAuthenticator(clients);
  }

  static fromEnv(env: NodeJS.ProcessEnv): ConfiguredServiceCallers {
    return new ConfiguredServiceCallers(env[SERVICE_CLIENTS_ENV]);
  }

  authorize(
    clientId: string | undefined,
    token: string | undefined,
    scope: ServiceScope,
  ): string | null {
    const decision = this.authenticator.authorize(clientId, token, scope);
    return decision.ok ? decision.clientId : null;
  }
}
