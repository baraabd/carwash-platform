import type { PrincipalKind } from '../../domain';

/**
 * Resolves a bearer token to Identity's own session view
 * (`GET /internal/v1/identity/session`, IdentitySessionView).
 *
 * Identity remains the only authority for who the caller is: it verifies the
 * token, the session and its revocation and derives permissions. This service
 * never decodes the token and never trusts x-auth-* headers.
 *
 * Fail closed: a timeout or an unexpected answer is UNAVAILABLE (503), never a
 * guessed identity. No response body, token or header is logged.
 */
export class IdentityAuthFailure extends Error {
  constructor(readonly reason: 'UNAUTHENTICATED' | 'UNAVAILABLE') {
    super(reason);
    this.name = 'IdentityAuthFailure';
  }
}

export interface IdentitySession {
  readonly subject: string;
  readonly principalKind: PrincipalKind;
  readonly permissions: readonly string[];
}

export interface IdentitySessionClientOptions {
  readonly baseUrl: string | undefined;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION = /^[a-z][a-z.-]*(?::[a-z.-]+)?$/;

export class IdentitySessionClient {
  private readonly url: URL | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IdentitySessionClientOptions) {
    this.url = options.baseUrl
      ? new URL('/internal/v1/identity/session', options.baseUrl)
      : undefined;
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async resolve(authorization: string, correlationId: string): Promise<IdentitySession> {
    if (!/^Bearer [A-Za-z0-9._~+/=-]{16,8192}$/.test(authorization)) {
      throw new IdentityAuthFailure('UNAUTHENTICATED');
    }
    if (!this.url) throw new IdentityAuthFailure('UNAVAILABLE');
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'GET',
        headers: { accept: 'application/json', authorization, 'x-correlation-id': correlationId },
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new IdentityAuthFailure('UNAVAILABLE');
    }
    if (response.status === 401 || response.status === 403) {
      throw new IdentityAuthFailure('UNAUTHENTICATED');
    }
    if (response.status !== 200) throw new IdentityAuthFailure('UNAVAILABLE');
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new IdentityAuthFailure('UNAVAILABLE');
    }
    return parseSession(body);
  }
}

/**
 * Anti-corruption parse of IdentitySessionView. `principalKind` decides whether
 * the caller books as an account or a guest; a session without it is refused
 * rather than assumed to be an account.
 */
function parseSession(body: unknown): IdentitySession {
  if (typeof body !== 'object' || body === null) throw new IdentityAuthFailure('UNAVAILABLE');
  const { subject, permissions, principalKind } = body as Record<string, unknown>;
  if (
    typeof subject !== 'string' ||
    !UUID.test(subject) ||
    (principalKind !== 'account' && principalKind !== 'guest') ||
    !Array.isArray(permissions) ||
    permissions.length > 64 ||
    !permissions.every((p): p is string => typeof p === 'string' && PERMISSION.test(p))
  ) {
    throw new IdentityAuthFailure('UNAVAILABLE');
  }
  return { subject: subject.toLowerCase(), principalKind, permissions };
}
