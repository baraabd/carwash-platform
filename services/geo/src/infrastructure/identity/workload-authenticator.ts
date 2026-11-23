import { ServiceClientAuthenticator, parseServiceClients } from '@carwash/service-kit';
import { ApplicationError } from '../../application/errors';
import type { ServiceActor, WorkloadAuthenticator } from '../../ports';

const SCOPES = ['geo.serviceability.validate'] as const;

/**
 * The platform's owner-scoped, digest-only workload credentials. Identity is
 * established by the credential pair, never by a caller's service-name header
 * alone. Missing configuration keeps the route closed; malformed configuration
 * fails startup. Browser/session credentials cannot be mixed with a workload.
 */
export class ServiceWorkloadAuthenticator implements WorkloadAuthenticator {
  private readonly clients: ServiceClientAuthenticator<(typeof SCOPES)[number]>;

  constructor(rawClients: string | undefined) {
    this.clients = new ServiceClientAuthenticator(parseServiceClients(rawClients, SCOPES));
  }

  authenticate(headers: Readonly<Record<string, string | undefined>>): Promise<ServiceActor> {
    if (Object.hasOwn(headers, 'authorization') || Object.hasOwn(headers, 'cookie'))
      return Promise.reject(new ApplicationError('AUTH_FORBIDDEN'));
    const actor = this.clients.authenticate(
      headers['x-service-client'],
      headers['x-service-token'],
    );
    if (!actor) return Promise.reject(new ApplicationError('AUTH_FORBIDDEN'));
    return Promise.resolve({ service: actor.id, scopes: actor.scopes });
  }
}
