import {
  ServiceClientAuthenticator,
  parseServiceClients,
  type ServiceClient,
} from '@carwash/service-kit';
import {
  CONFIGURATION_SERVICE_SCOPES,
  type ConfigurationServiceScope,
  type ServiceCaller,
  type ServiceCallerAuthenticator,
} from '../../ports/configuration-v1.ports';
import { AccessFault } from '../../ports/identity.ports';

/**
 * configuration.v1 `service:configuration.read` through the shared P04-E3
 * service-client primitive (constant-time digest comparison, explicit scopes,
 * deny by default). This is the interim mechanism until the platform issues
 * workload identity; `x-service-client` alone is never trusted.
 *
 * CONFIGURATION_SERVICE_CLIENTS holds SHA-256 digests only, e.g.
 *   [{"id":"scheduling","tokenSha256":"<64 hex>","scopes":["configuration.read"]}]
 * Absent or empty: no service caller is accepted.
 */
export class ConfigurationServiceClients implements ServiceCallerAuthenticator {
  private readonly authenticator: ServiceClientAuthenticator<ConfigurationServiceScope>;

  constructor(clients: readonly ServiceClient<ConfigurationServiceScope>[]) {
    this.authenticator = new ServiceClientAuthenticator(clients);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ConfigurationServiceClients {
    return new ConfigurationServiceClients(
      parseServiceClients(env.CONFIGURATION_SERVICE_CLIENTS, CONFIGURATION_SERVICE_SCOPES),
    );
  }

  authorize(input: {
    readonly clientId: string | undefined;
    readonly token: string | undefined;
    readonly scope: ConfigurationServiceScope;
  }): ServiceCaller {
    if (input.clientId === undefined && input.token === undefined)
      throw new AccessFault('AUTH_REQUIRED');
    const decision = this.authenticator.authorize(input.clientId, input.token, input.scope);
    if (decision.ok) return { clientId: decision.clientId };
    throw new AccessFault(
      decision.reason === 'UNAUTHENTICATED' ? 'AUTH_REQUIRED' : 'AUTH_FORBIDDEN',
    );
  }
}
