import { ApplicationError } from '../../application/errors';
import type { AuthorizedPrincipal, IdentityAuthorizer, SessionCredentials } from '../../ports';

const IDENTITY_V1 = '/internal/v1/identity';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_COOKIE = /^(?:__Host-)?wg_(?:access|refresh|csrf|pre)$/;
const MAX_RESPONSE_BYTES = 16 * 1024;

export interface IdentityAuthorizerConfig {
  /** Identity's origin, e.g. https://identity.internal or http://127.0.0.1:PORT. */
  readonly origin: string;
  readonly timeoutMs: number;
}

export function validateIdentityAuthorizerConfig(
  config: IdentityAuthorizerConfig,
): IdentityAuthorizerConfig {
  const url = new URL(config.origin);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new Error('INVALID_IDENTITY_ORIGIN');
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 50 || config.timeoutMs > 10_000) {
    throw new Error('INVALID_IDENTITY_TIMEOUT');
  }
  return { origin: url.origin, timeoutMs: config.timeoutMs };
}

/** Only Identity's own session cookies are forwarded; anything else stays here. */
function sessionCookies(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const kept = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => SESSION_COOKIE.test(part.slice(0, part.indexOf('='))));
  return kept.length > 0 ? kept.join('; ') : undefined;
}

/**
 * Identity session view (P01-E3). The principal kind is taken from Identity's
 * `principalKind`, never assumed: a guest is a first-class principal.
 */
function parseSession(body: unknown): AuthorizedPrincipal {
  if (body === null || typeof body !== 'object') throw new ApplicationError('IDENTITY_UNAVAILABLE');
  const view = body as Record<string, unknown>;
  const permissions = view.permissions;
  const kind = view.principalKind;
  if (
    typeof view.subject !== 'string' ||
    !UUID.test(view.subject) ||
    typeof view.sessionId !== 'string' ||
    !UUID.test(view.sessionId) ||
    typeof view.authVersion !== 'number' ||
    !Number.isSafeInteger(view.authVersion) ||
    view.authVersion < 1 ||
    (kind !== 'account' && kind !== 'guest') ||
    !Array.isArray(view.roles) ||
    // A guest never holds roles (P01-E3); a view claiming otherwise is refused.
    (kind === 'guest' && view.roles.length > 0) ||
    !Array.isArray(permissions) ||
    !permissions.every((permission): permission is string => typeof permission === 'string')
  ) {
    throw new ApplicationError('IDENTITY_UNAVAILABLE');
  }
  return {
    principal: { kind, subject: view.subject.toLowerCase() },
    sessionId: view.sessionId.toLowerCase(),
    permissions,
  };
}

/**
 * Asks Identity whether the presented session is CURRENT (principal active,
 * session not revoked or expired, authVersion unchanged). A token signature
 * alone is not enough: a revoked session still carries a valid token.
 *
 * Serviceability is a safe (read-only) POST, so the read-only session endpoint
 * is used for bearer and cookie callers alike.
 *
 * Fails closed: timeouts, transport errors, 5xx and malformed bodies become
 * IDENTITY_UNAVAILABLE, never a session. One bounded attempt, no retry.
 */
export class HttpIdentityAuthorizer implements IdentityAuthorizer {
  private readonly config: IdentityAuthorizerConfig;

  constructor(config: IdentityAuthorizerConfig) {
    this.config = validateIdentityAuthorizerConfig(config);
  }

  async authorize(credentials: SessionCredentials): Promise<AuthorizedPrincipal> {
    const cookie = sessionCookies(credentials.cookie);
    if (!credentials.authorization && !cookie) throw new ApplicationError('AUTH_REQUIRED');
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-correlation-id': credentials.correlationId,
    };
    if (credentials.authorization) headers.authorization = credentials.authorization;
    if (cookie) headers.cookie = cookie;
    let response: Response;
    try {
      response = await fetch(`${this.config.origin}${IDENTITY_V1}/session`, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new ApplicationError('IDENTITY_UNAVAILABLE');
    }
    if (response.status === 401) throw new ApplicationError('AUTH_REQUIRED');
    if (response.status === 403) throw new ApplicationError('AUTH_FORBIDDEN');
    if (response.status !== 200) throw new ApplicationError('IDENTITY_UNAVAILABLE');
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ApplicationError('IDENTITY_UNAVAILABLE');
    }
    if (text.length > MAX_RESPONSE_BYTES) throw new ApplicationError('IDENTITY_UNAVAILABLE');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApplicationError('IDENTITY_UNAVAILABLE');
    }
    return parseSession(body);
  }
}

/** Used when no Identity origin is configured: every request fails closed. */
export class UnconfiguredIdentityAuthorizer implements IdentityAuthorizer {
  authorize(): Promise<AuthorizedPrincipal> {
    return Promise.reject(new ApplicationError('IDENTITY_UNAVAILABLE'));
  }
}
