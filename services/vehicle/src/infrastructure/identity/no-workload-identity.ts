import { ApplicationError } from '../../application/errors';
import type { ServiceActor, WorkloadAuthenticator } from '../../ports';

/**
 * Deny-by-default workload authentication for `service:` routes.
 *
 * Service-to-service identity (verified workload credentials and scope grants)
 * is Lane E's P01-E5 and is not on main. Until a verifier exists no caller can
 * prove it is Booking or Pricing, so every call is refused: an unauthenticated
 * call is AUTH_REQUIRED and a call presenting any credential is AUTH_FORBIDDEN.
 * A user session is never accepted as a workload identity.
 */
export class NoWorkloadIdentity implements WorkloadAuthenticator {
  authenticate(credentials: {
    readonly authorization?: string;
    readonly cookie?: string;
  }): Promise<ServiceActor> {
    const presented = credentials.authorization !== undefined || credentials.cookie !== undefined;
    return Promise.reject(new ApplicationError(presented ? 'AUTH_FORBIDDEN' : 'AUTH_REQUIRED'));
  }
}