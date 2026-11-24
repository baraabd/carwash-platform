import {
  isAccessPrincipal,
  isIdentityPermission,
  isIdentityPrincipalKind,
  isIdentityRole,
  record,
} from '@carwash/contracts';
import { ReviewsError } from '../../application/errors';
import type { IdentityAuthority, VerifiedActor } from '../../ports/reviews.ports';
import { bearer, ownerGet, ownerJson, type OwnerEndpoint } from '../http/owner-http';

export class IdentitySessionAuthority implements IdentityAuthority {
  constructor(
    private readonly endpoint: OwnerEndpoint,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async verify(credential: string | undefined, correlationId: string): Promise<VerifiedActor> {
    if (!bearer(credential)) throw new ReviewsError('AUTH_REQUIRED');
    const response = await ownerGet(
      this.endpoint,
      '/internal/v1/identity/session',
      credential,
      correlationId,
      this.fetcher,
    );
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new ReviewsError(
        response.status === 401 || response.status === 403
          ? 'AUTH_REQUIRED'
          : 'DEPENDENCY_UNAVAILABLE',
      );
    }
    try {
      const session = record(await ownerJson(response, 16_384), '$');
      if (
        !isAccessPrincipal(session) ||
        !isIdentityPrincipalKind(session.principalKind) ||
        !Array.isArray(session.roles) ||
        session.roles.length > 7 ||
        !session.roles.every(isIdentityRole) ||
        !Array.isArray(session.permissions) ||
        session.permissions.length > 64 ||
        !session.permissions.every(isIdentityPermission) ||
        new Set(session.permissions).size !== session.permissions.length ||
        (session.principalKind === 'guest' && session.roles.length !== 0)
      )
        throw new Error('IDENTITY_SESSION_INVALID');
      return {
        principal: { kind: session.principalKind, subjectId: session.subject.toLowerCase() },
        permissions: session.permissions,
      };
    } catch {
      throw new ReviewsError('DEPENDENCY_UNAVAILABLE');
    }
  }
}
