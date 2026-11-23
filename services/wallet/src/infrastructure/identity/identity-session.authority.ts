import { AccessDenied, type AccessAuthority, type VerifiedPrincipal } from '../../ports';

/**
 * Asks Identity for a CURRENT session/permission decision on every protected
 * request (ADR 0003: critical operations need an authoritative decision and
 * fail closed when verification is unavailable).
 *
 * The Gateway forwards the caller's own bearer token; the `x-auth-*` hint
 * headers are never trusted here. No retry is attempted: a timeout or a
 * malformed answer is AUTH_UNAVAILABLE, never an anonymous or cached grant.
 */
export const IDENTITY_SESSION_PATH = '/internal/v1/identity/session';
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION = /^[a-z][a-z0-9.:_-]{1,63}$/;
const MAX_CREDENTIAL = 8_192;
const MAX_RESPONSE_BYTES = 16_384;

export interface IdentityAuthorityConfig {
  /** null when not configured: every protected request then fails closed. */
  readonly origin: URL | null;
  readonly timeoutMs: number;
}

export function identityAuthorityConfigFromEnv(env: NodeJS.ProcessEnv): IdentityAuthorityConfig {
  const rawTimeout = env.IDENTITY_SESSION_TIMEOUT_MS ?? '2000';
  const timeoutMs = Number(rawTimeout);
  if (!/^[0-9]+$/.test(rawTimeout) || timeoutMs < 100 || timeoutMs > 10_000)
    throw new Error('IDENTITY_SESSION_TIMEOUT_MS_INVALID');
  const raw = env.IDENTITY_SESSION_ORIGIN;
  if (raw === undefined || raw === '') return { origin: null, timeoutMs };
  const origin = new URL(raw);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))
    throw new Error('IDENTITY_SESSION_ORIGIN_HTTPS_REQUIRED');
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
    throw new Error('IDENTITY_SESSION_ORIGIN_INVALID');
  return { origin, timeoutMs };
}

function parsePrincipal(value: unknown): VerifiedPrincipal | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const { subject, sessionId, authVersion, permissions } = body;
  if (typeof subject !== 'string' || !UUID.test(subject)) return null;
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return null;
  if (typeof authVersion !== 'number' || !Number.isSafeInteger(authVersion) || authVersion < 1)
    return null;
  if (!Array.isArray(permissions) || permissions.length > 64) return null;
  const granted: string[] = [];
  for (const permission of permissions) {
    if (typeof permission !== 'string' || !PERMISSION.test(permission)) return null;
    granted.push(permission);
  }
  return { subject: subject.toLowerCase(), sessionId, permissions: granted };
}

async function boundedText(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_RESPONSE_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class IdentitySessionAuthority implements AccessAuthority {
  constructor(
    private readonly config: IdentityAuthorityConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async verify(credential: string | undefined, correlationId: string): Promise<VerifiedPrincipal> {
    if (
      typeof credential !== 'string' ||
      credential.length > MAX_CREDENTIAL ||
      !BEARER.test(credential)
    )
      throw new AccessDenied('AUTH_REQUIRED');
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
