import { parseServiceClients, ServiceClientAuthenticator } from '@carwash/service-kit';
import { ApplicationError } from '../../application/errors';
import type { SessionCredentials, WorkloadAuthenticator } from '../../ports';

export const CUSTOMER_SNAPSHOT_SCOPE = 'customer.address-snapshot.resolve';

/** Service credentials are provisioned separately from browser/user sessions. */
export class ServiceWorkloadAuthenticator implements WorkloadAuthenticator {
  private readonly clients: ServiceClientAuthenticator<typeof CUSTOMER_SNAPSHOT_SCOPE>;

  constructor(raw: string | undefined) {
    this.clients = new ServiceClientAuthenticator(
      parseServiceClients(raw, [CUSTOMER_SNAPSHOT_SCOPE]),
    );
  }

  authenticate(credentials: SessionCredentials): ReturnType<WorkloadAuthenticator['authenticate']> {
    if (credentials.authorization !== undefined || credentials.cookie !== undefined) {
      return Promise.reject(new ApplicationError('AUTH_FORBIDDEN'));
    }
    const client = this.clients.authenticate(credentials.serviceClient, credentials.serviceToken);
    if (!client) return Promise.reject(new ApplicationError('AUTH_REQUIRED'));
    return Promise.resolve({ service: client.id, scopes: client.scopes });
  }
}
