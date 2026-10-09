import {
  AccessFault,
  type SessionAuthority,
  type VerifiedSession,
} from '../../ports/identity.ports';

const SESSION_PATH = '/internal/v1/identity/session';
const BEARER = /^Bearer [A-Za-z0-9_.-]{20,8192}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION = /^[a-z][a-z.-]{1,62}(:[a-z]{2,16})?$/;
const MAX_BODY_BYTES = 16_384;

/**
 * Asks Identity, the only authority, who the caller is and what it may do.
 *
 * Tolerant reader: it reads only subject, sessionId, authVersion and
 * permissions from Identity's published session view and rejects anything
 * malformed. It is a stand-in for importing `@carwash/contracts` until Lane E
 * adds that dependency (CR-D-P01-03; the same reader exists in configuration and reporting), not a second definition of the contract.
 */
export class IdentitySessionClient implements SessionAuthority {
  private readonly url: URL;

  constructor(
    identityOrigin: URL,
    private readonly timeoutMs = 2_000,
  ) {
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(identityOrigin.hostname);
    // Inside the private network the origin may be plain HTTP only when it is
    // loopback or an explicitly internal service name without a dot.
    const internalName = !identityOrigin.hostname.includes('.');
    if (
      identityOrigin.protocol !== 'https:' &&
      !(identityOrigin.protocol === 'http:' && (loopback || internalName))
    )
      throw new Error('IDENTITY_ORIGIN_INVALID');
    if (
      identityOrigin.username ||
      identityOrigin.password ||
      identityOrigin.hash ||
      identityOrigin.search
    )
      throw new Error('IDENTITY_ORIGIN_INVALID');
    this.url = new URL(SESSION_PATH, identityOrigin);
  }

  async verify(input: {
    authorization: string | undefined;
    forwardedSubject: string | undefined;
  }): Promise<VerifiedSession> {
    const authorization = input.authorization;
    if (!authorization || !BEARER.test(authorization)) throw new AccessFault('AUTH_REQUIRED');
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json', authorization },
      });
    } catch {
      throw new AccessFault('AUTH_UNAVAILABLE');
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      throw new AccessFault('AUTH_REQUIRED');
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new AccessFault('AUTH_UNAVAILABLE');
    }
    const session = await this.read(response);
    // The gateway forwards its own view of the subject. If present it must
    // agree with Identity's; disagreement means a forged or confused header.
    if (
      input.forwardedSubject !== undefined &&
      input.forwardedSubject.toLowerCase() !== session.subject.toLowerCase()
    )
      throw new AccessFault('AUTH_REQUIRED');
    return session;
  }

  private async read(response: Response): Promise<VerifiedSession> {
    let body: unknown;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('EMPTY');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new Error('TOO_LARGE');
        }
        chunks.push(value);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new AccessFault('AUTH_UNAVAILABLE');
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body))
      throw new AccessFault('AUTH_UNAVAILABLE');
    const view = body as Record<string, unknown>;
    const { subject, sessionId, authVersion, permissions } = view;
    if (
      typeof subject !== 'string' ||
      !UUID.test(subject) ||
      typeof sessionId !== 'string' ||
      !UUID.test(sessionId) ||
      typeof authVersion !== 'number' ||
      !Number.isSafeInteger(authVersion) ||
      authVersion < 1 ||
      !Array.isArray(permissions) ||
      permissions.length > 64 ||
      !permissions.every((p): p is string => typeof p === 'string' && PERMISSION.test(p))
    )
      throw new AccessFault('AUTH_UNAVAILABLE');
    return {
      subject: subject.toLowerCase(),
      sessionId,
      authVersion,
      permissions: Object.freeze([...permissions]),
    };
  }
}

/**
 * Used when no Identity origin is configured. Every read fails closed with
 * AUTH_UNAVAILABLE (503): the process still boots (image probes start it
 * without an Identity), but nothing is ever authorized without Identity.
 */
export class UnconfiguredSessionAuthority implements SessionAuthority {
  verify(): Promise<VerifiedSession> {
    return Promise.reject(new AccessFault('AUTH_UNAVAILABLE'));
  }
}
