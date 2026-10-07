import { ApplicationError } from '../../application/errors';
import type {
  AccessIntent,
  AuthorizedSession,
  IdentityAuthorizer,
  SessionCredentials,
} from '../../ports';

const IDENTITY_V1 = '/internal/v1/identity';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function parseSession(body: unknown): AuthorizedSession {
  if (body === null || typeof body !== 'object') throw new ApplicationError('IDENTITY_UNAVAILABLE');
  const view = body as Record<string, unknown>;
  const permissions = view.permissions;
  if (
    typeof view.subject !== 'string' ||
    !UUID.test(view.subject) ||
    typeof view.sessionId !== 'string' ||
    !UUID.test(view.sessionId) ||
    typeof view.authVersion !== 'number' ||
    !Number.isSafeInteger(view.authVersion) ||
    view.authVersion < 1 ||
    !Array.isArray(permissions) ||
    !permissions.every((permission): permission is string => typeof permission === 'string')
  ) {
    throw new ApplicationError('IDENTITY_UNAVAILABLE');
  }
  return {
    // Identity V1 issues account sessions only. Guest sessions are a pending
    // Identity contract; until one exists no request can carry a guest principal.
    principal: { kind: 'account', subject: view.subject.toLowerCase() },
    sessionId: view.sessionId.toLowerCase(),
    permissions,
  };
}

/**
 * Asks Identity whether the presented session is CURRENT (account active,
 * session not revoked or expired, authVersion unchanged). A token signature
 * alone is not enough, because a revoked session still carries a valid token.
 *
 * Fails closed: timeouts, transport errors, 5xx and malformed bodies become
 * IDENTITY_UNAVAILABLE, never a session. There is no retry - authorization sits
 * on the request path and one bounded attempt keeps the latency budget honest.
 */
export class HttpIdentityAuthorizer implements IdentityAuthorizer {
  private readonly config: IdentityAuthorizerConfig;

  constructor(config: IdentityAuthorizerConfig) {
    this.config = validateIdentityAuthorizerConfig(config);
  }

  async authorize(
    credentials: SessionCredentials,
    intent: AccessIntent,
  ): Promise<AuthorizedSession> {
    const cookie = sessionCookies(credentials.cookie);
    if (!credentials.authorization && !cookie) throw new ApplicationError('AUTH_REQUIRED');
    // A cookie-authenticated write must pass Identity's signed-CSRF and origin
    // check; a bearer request or a read uses the read-only session endpoint.
    const cookieWrite = intent === 'write' && !credentials.authorization;
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-correlation-id': credentials.correlationId,
    };
    if (credentials.authorization) headers.authorization = credentials.authorization;
    if (cookie) headers.cookie = cookie;
    if (cookieWrite) {
      headers['content-type'] = 'application/json';
      if (credentials.origin) headers.origin = credentials.origin;
      if (credentials.secFetchSite) headers['sec-fetch-site'] = credentials.secFetchSite;
      if (credentials.csrfToken) headers['x-csrf-token'] = credentials.csrfToken;
    }
    let response: Response;
    try {
      response = await fetch(
        `${this.config.origin}${IDENTITY_V1}/${cookieWrite ? 'authorize' : 'session'}`,
        {
          method: cookieWrite ? 'POST' : 'GET',
          headers,
          ...(cookieWrite ? { body: '{}' } : {}),
          redirect: 'error',
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
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
  authorize(): Promise<AuthorizedSession> {
    return Promise.reject(new ApplicationError('IDENTITY_UNAVAILABLE'));
  }
}
