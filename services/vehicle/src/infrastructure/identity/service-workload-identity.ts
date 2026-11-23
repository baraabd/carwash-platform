import { ServiceClientAuthenticator, parseServiceClients } from '@carwash/service-kit';
import { ApplicationError } from '../../application/errors';
import type { ServiceActor, SessionCredentials, WorkloadAuthenticator } from '../../ports';

const SCOPES = ['vehicle.snapshot.resolve'] as const;

/** Uses the platform's digest-only, scoped service credentials. Empty config denies all. */
export class ServiceWorkloadIdentity implements WorkloadAuthenticator {
  private readonly clients: ServiceClientAuthenticator<(typeof SCOPES)[number]>;

  constructor(rawClients: string | undefined) {
    this.clients = new ServiceClientAuthenticator(parseServiceClients(rawClients, SCOPES));
  }

  authenticate(credentials: SessionCredentials): Promise<ServiceActor> {
    if (credentials.authorization !== undefined || credentials.cookie !== undefined)
      return Promise.reject(new ApplicationError('AUTH_FORBIDDEN'));
    const actor = this.clients.authenticate(credentials.serviceClient, credentials.serviceToken);
    if (!actor) {
      const presented =
        credentials.serviceClient !== undefined || credentials.serviceToken !== undefined;
      return Promise.reject(new ApplicationError(presented ? 'AUTH_FORBIDDEN' : 'AUTH_REQUIRED'));
    }
    return Promise.resolve({ service: actor.id, scopes: actor.scopes });
  }
}
