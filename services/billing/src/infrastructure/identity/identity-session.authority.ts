import { AccessDenied, type AccessAuthority, type VerifiedPrincipal } from '../../ports';
import {
  boundedText,
  isBearer,
  upstreamConfigFromEnv,
  type UpstreamConfig,
} from '../http/bounded-fetch';

/**
 * Asks Identity for a CURRENT session/permission decision on every protected
 * request (ADR 0003: critical operations need an authoritative decision and
 * fail closed when verification is unavailable).
 *
 * The Gateway forwards the caller's own bearer token; `x-auth-*` hint headers
 * are never trusted here. No retry is attempted: a timeout or malformed answer
 * is AUTH_UNAVAILABLE, never an anonymous or cached grant. The principal kind
 * (account/guest) is required because obligations are owned by PrincipalRef.
 */
export const IDENTITY_SESSION_PATH = '/internal/v1/identity/session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION = /^[a-z][a-z0-9.:_-]{1,63}$/;

export function identityAuthorityConfigFromEnv(env: NodeJS.ProcessEnv): UpstreamConfig {
  return upstreamConfigFromEnv(env, 'IDENTITY_SESSION_ORIGIN', 'IDENTITY_SESSION_TIMEOUT_MS');
}

function parsePrincipal(value: unknown): VerifiedPrincipal | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const { subject, sessionId, authVersion, principalKind, permissions } = body;
  if (typeof subject !== 'string' || !UUID.test(subject)) return null;
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return null;
  if (typeof authVersion !== 'number' || !Number.isSafeInteger(authVersion) || authVersion < 1)
    return null;
  if (principalKind !== 'account' && principalKind !== 'guest') return null;
  if (!Array.isArray(permissions) || permissions.length > 64) return null;
  const granted: string[] = [];
  for (const permission of permissions) {
    if (typeof permission !== 'string' || !PERMISSION.test(permission)) return null;
    granted.push(permission);
  }
  return {
    kind: principalKind,
    subject: subject.toLowerCase(),
    sessionId: sessionId.toLowerCase(),
    permissions: granted,
  };
}

export class IdentitySessionAuthority implements AccessAuthority {
  constructor(
    private readonly config: UpstreamConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async verify(credential: string | undefined, correlationId: string): Promise<VerifiedPrincipal> {
    if (!isBearer(credential)) throw new AccessDenied('AUTH_REQUIRED');
    if (!this.config.origin) throw new AccessDenied('AUTH_UNAVAILABLE');

    let response: Response;
    try {
      response = await this.fetcher(new URL(IDENTITY_SESSION_PATH, this.config.origin), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: credential,
          'x-correlation-id': correlationId,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new AccessDenied('AUTH_UNAVAILABLE');
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new AccessDenied('AUTH_REQUIRED');
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new AccessDenied('AUTH_UNAVAILABLE');
    }
    let principal: VerifiedPrincipal | null;
    try {
      const text = await boundedText(response);
      principal = text === null ? null : parsePrincipal(JSON.parse(text));
    } catch {
      principal = null;
    }
    if (!principal) throw new AccessDenied('AUTH_UNAVAILABLE');
    return principal;
  }
}