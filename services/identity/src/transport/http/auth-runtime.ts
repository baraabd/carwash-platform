import { randomUUID } from 'node:crypto';
import {
  AccessTokenVerifier,
  CsrfTokens,
  allowedOrigin,
  opaqueSecret,
  readCookies,
  sessionCookie,
  type RedisRateBudget,
} from '@carwash/security-kit';
import type { AccessPrincipal } from '@carwash/contracts';
import { AUTH_POLICY, AuthFault } from '../../domain/auth-policy';
import type {
  AuthContext,
  IdentityAuthService,
  SessionTokens,
} from '../../application/identity-auth.service';
import type { IdentityConfig } from '../../infrastructure/security/config';
import type { IdentitySigningKeys } from '../../infrastructure/security/signing-keys';
import type { IdentityStore } from '../../ports/identity.ports';

export interface AuthRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly socket: { readonly remoteAddress?: string };
  authRequestId?: string;
}
export interface AuthResponse {
  setHeader(name: string, value: string | readonly string[]): void;
  status(code: number): AuthResponse;
  json(value: unknown): unknown;
}
export class IdentityHttpRuntime {
  readonly csrf: CsrfTokens;
  readonly verifier: AccessTokenVerifier;
  readonly cookies: {
    readonly access: string;
    readonly refresh: string;
    readonly csrf: string;
    readonly pre: string;
  };
  constructor(
    readonly config: IdentityConfig,
    readonly auth: IdentityAuthService,
    readonly signing: IdentitySigningKeys,
    private readonly store: IdentityStore,
    private readonly budget: RedisRateBudget,
  ) {
    this.csrf = new CsrfTokens(config.csrfKey);
    this.verifier = new AccessTokenVerifier(
      { issuer: config.issuer, audience: config.audience },
      signing.jwks,
    );
    const prefix = config.cookieSecure ? '__Host-wg_' : 'wg_';
    this.cookies = {
      access: `${prefix}access`,
      refresh: `${prefix}refresh`,
      csrf: `${prefix}csrf`,
      pre: `${prefix}pre`,
    };
  }
  context(request: AuthRequest): AuthContext {
    return {
      ip: request.socket.remoteAddress ?? 'unknown',
      requestId: request.authRequestId ?? randomUUID(),
    };
  }
  cookieValues(request: AuthRequest): Readonly<Record<string, string>> {
    try {
      return readCookies(request.headers.cookie);
    } catch {
      throw new AuthFault('AUTH_INVALID_REQUEST');
    }
  }
  private cookie(name: string, value: string, httpOnly: boolean, maxAge: number): string {
    return sessionCookie(name, value, { secure: this.config.cookieSecure, httpOnly, maxAge });
  }
  issueCsrf(request: AuthRequest, response: AuthResponse): { readonly csrfToken: string } {
    const cookies = this.cookieValues(request);
    let pre = cookies[this.cookies.pre];
    if (!pre || !/^[A-Za-z0-9_-]{43}$/.test(pre)) pre = opaqueSecret();
    const binding = cookies[this.cookies.refresh] ?? pre;
    const csrfToken = this.csrf.issue(binding);
    response.setHeader('set-cookie', [
      this.cookie(this.cookies.pre, pre, true, 900),
      this.cookie(this.cookies.csrf, csrfToken, false, 900),
    ]);
    response.setHeader('cache-control', 'no-store');
    return { csrfToken };
  }
  assertCsrf(request: AuthRequest): void {
    const cookies = this.cookieValues(request);
    if (
      !allowedOrigin(
        request.headers.origin,
        this.config.origins,
        request.headers['sec-fetch-site'],
      ) ||
      !this.csrf.verify(
        request.headers['x-csrf-token'],
        cookies[this.cookies.csrf],
        cookies[this.cookies.refresh] ?? cookies[this.cookies.pre],
      )
    )
      throw new AuthFault('AUTH_CSRF');
  }
  async principal(request: AuthRequest): Promise<AccessPrincipal> {
    const cookies = this.cookieValues(request);
    const header = request.headers.authorization;
    let token = cookies[this.cookies.access];
    if (header !== undefined) {
      if (typeof header !== 'string' || !header.startsWith('Bearer '))
        throw new AuthFault('AUTH_REQUIRED');
      const bearer = header.slice(7);
      if (token && token !== bearer) throw new AuthFault('AUTH_REQUIRED');
      token = bearer;
    }
    if (!token) throw new AuthFault('AUTH_REQUIRED');
    try {
      return await this.verifier.verify(token);
    } catch {
      throw new AuthFault('AUTH_REQUIRED');
    }
  }
  setSession(response: AuthResponse, tokens: SessionTokens): void {
    const csrfToken = this.csrf.issue(tokens.refreshToken);
    const seconds = Math.max(0, Math.floor((tokens.expiresAt.getTime() - Date.now()) / 1_000));
    response.setHeader('set-cookie', [
      this.cookie(this.cookies.access, tokens.accessToken, true, AUTH_POLICY.accessTtlSeconds),
      this.cookie(this.cookies.refresh, tokens.refreshToken, true, seconds),
      this.cookie(this.cookies.csrf, csrfToken, false, seconds),
      this.cookie(this.cookies.pre, '', true, 0),
    ]);
    response.setHeader('cache-control', 'no-store');
  }
  clearSession(response: AuthResponse): void {
    response.setHeader(
      'set-cookie',
      Object.values(this.cookies).map((name) =>
        this.cookie(name, '', name !== this.cookies.csrf, 0),
      ),
    );
    response.setHeader('cache-control', 'no-store');
  }
  async ready(): Promise<boolean> {
    try {
      await Promise.all([this.store.ping(), this.budget.ping()]);
      return true;
    } catch {
      return false;
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.budget.close();
    await this.store.close();
  }
}
