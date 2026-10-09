import { ApplicationError } from '../../application/errors';
import type { ServiceActor, WorkloadAuthenticator } from '../../ports';

/**
 * Workload identity (service-to-service scopes) is P01-E5 and is not on main.
 * Until a verified workload credential exists, every caller of a `service:`
 * route is refused. A header such as `x-service-client` is NOT a credential and
 * is never trusted here.
 */
export class DenyAllWorkloadAuthenticator implements WorkloadAuthenticator {
  authenticate(): Promise<ServiceActor> {
    return Promise.reject(new ApplicationError('AUTH_FORBIDDEN'));
  }
}
